// Общая основа листов актора: действия с предметами, эффектами и бросками.

import { DERIVED, SKILL_STATS, STATS } from "../config/stats.mjs";
import { SKILLS, skillsByStat } from "../config/skills.mjs";
import { CRIT_LEVELS, CRIT_STATES, CRIT_WOUNDS, HEALING_DAYS, LOCATIONS_HUMANOID, LOCATIONS_MONSTER } from "../config/combat.mjs";
import { attackSources } from "../combat/attack.mjs";
import { STATUS_EFFECTS, STATUS_HINTS } from "../combat/statuses.mjs";
import { manualDamage, restTurn, restDays } from "../combat/manual.mjs";
import { controlCheck } from "../combat/mounted.mjs";
import { MOUNTS } from "../config/combat.mjs";
import { levelLabel, ELEMENT_GLYPHS, SIGN_FORMS, MAGIC_LEARNING } from "../config/magic.mjs";
import { spellAutomation } from "../config/spell-auto.mjs";
import { castSpell, vigorUsed, maintainedSpells, costNote } from "../magic/cast.mjs";
import { endMaintained } from "../magic/effects.mjs";
import { dimeritiumRow, touchDimeritium, endDimeritium } from "../magic/dimeritium.mjs";
import { describeChanges } from "../config/effects.mjs";
import { currencies, toCrowns, coinWeightKg, coinWeightEnabled, formatRate } from "../config/money.mjs";
import { compareRu, balanceColumns, worldSetting } from "../util.mjs";
import { profileSheet } from "../apps/perf.mjs";
import { verbalAction, verbalContext, resetDuel, setDuelResolve } from "../combat/verbal.mjs";
import { detachEnhancement, detachCrossbowMod } from "../crafting/enhancements.mjs";
import { markLockedActions, guardLockedActions } from "./view-only.mjs";
import { animateTab, animateVitals } from "../fx/sheet-motion.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

/** Шаблон листа для тех, у кого право «Ограниченный»: только то, что видно со стороны. */
const LIMITED_TEMPLATE = "systems/vedmak/templates/actor/limited.hbs";

/**
 * Действия, которые остаются у того, кто лист только смотрит (наблюдатель, закрытый компендиум):
 * вкладки, просмотр предмета и эффекта, карточка в чат, монеты из добычи в свой кошелёк.
 */
const VIEW_ACTIONS = new Set(["tab", "itemEdit", "effectEdit", "itemPost", "abilityPost", "lootCoins",
  "toggleTrainedOnly", "showPortrait"]);

/**
 * Действия на строках, которые сами что-то показывают (основа проверки, надето ли, включён ли эффект, какие
 * состояния висят): без права правки строка остаётся, но не нажимается. Остальные кнопки правки прячутся.
 */
const INERT_ACTIONS = new Set(["rollSkill", "rollStat", "rollDefining", "rollAbility", "attack", "verbalAction",
  "stunSave", "deathSave", "toggleStatus", "itemToggleEquip", "effectToggle", "toggleMemorized", "editImage"]);

/* ----------------------- Вкладка «Снаряжение»: строки ----------------------- */

/** Насечки шкалы: по одной на единицу; длинная шкала (больше 20) — просто доля полосы. */
function notches(value, max) {
  if (!(max > 0)) return { segs: [], pct: 0, long: false };
  const long = max > 20;
  return {
    long, pct: Math.max(0, Math.min(100, Math.round((value / max) * 100))),
    segs: long ? [] : Array.from({ length: max }, (_, i) => ({ on: i < value }))
  };
}

/** Оружие: символы урона и хвата, насечки надёжности, ленты состояния. */
function weaponRow(item) {
  const s = item.system;
  const types = new Set(s.damageTypes ?? []);
  const rel = s.reliability ?? { value: 0, max: 0 };
  return {
    id: item.id, img: item.img, name: item.name, system: s,
    equipped: !!s.equipped, broken: rel.max > 0 && rel.value <= 0, relic: !!s.relic,
    oil: s.activeOil ? s.oil.name : "", runes: s.runes ?? [], crossbowMods: s.crossbowMods ?? [],
    skillLabel: SKILLS[s.skill]?.label ?? "", silver: s.isSilver ? `серебро ${s.silverDamage}` : "",
    acc: s.accuracy > 0 ? `+${s.accuracy}` : `${s.accuracy}`,
    slashing: types.has("slashing"), piercing: types.has("piercing"), bludgeoning: types.has("bludgeoning"), elemental: types.has("elemental"),
    typesLabel: [...types].map(t => CONFIG.VEDMAK.DAMAGE_TYPES[t]?.label ?? t).join(", ") || "—",
    twoHanded: (s.hands ?? 1) >= 2, noHands: (s.hands ?? 1) === 0,
    rel: { value: rel.value, max: rel.max, ...notches(rel.value, rel.max) },
    range: s.range || "—", weight: s.weight ?? 0, goLabel: s.isRanged ? "Выстрел" : "Атака"
  };
}

/** Части тела по таблице попаданий: символ части, в левой половине тела — зеркально. */
/* --------------------------------- Магия --------------------------------- */

const LEVEL_ORDER = { novice: 0, journeyman: 1, master: 2, archPriest: 3 };
// Описание без разметки: одно и то же описание чистится регулярками на каждую перерисовку «Магии» — запоминаем
const PLAIN_CACHE = new Map();
const plainText = html => {
  const src = String(html ?? "");
  let out = PLAIN_CACHE.get(src);
  if (out === undefined) {
    out = src.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (PLAIN_CACHE.size > 1000) PLAIN_CACHE.clear();
    PLAIN_CACHE.set(src, out);
  }
  return out;
};
// Эмаль кнопки по виду магии: заклинание, знак и дар — фиолет, инвокация — золото, ритуал — сталь, порча — багрянец
const CAST_GO = { spell: "arcane", sign: "arcane", gift: "arcane", invocation: "holy", ritual: "ritual", hex: "hex" };

/** Карточка заклинания, знака, инвокации, ритуала или порчи для вкладки «Магия». */
function spellCard(item) {
  const s = item.system;
  const kind = s.kind;
  const levels = kind === "sign" || kind === "gift" ? 2 : kind === "invocation" ? 4 : 3;
  const level = (LEVEL_ORDER[s.level] ?? 0) + 1;
  const glyph = ELEMENT_GLYPHS[s.element];
  const max = s.maxCost || 7;
  const keep = s.maintainMode === "half" ? "½ стоимости / раунд" : s.maintainMode ? "стоимость / раунд"
    : s.maintainCost ? `+${s.maintainCost} Вын / раунд` : "";
  return {
    id: item.id, name: item.name, img: item.img, kind, system: s,
    levelLabel: levelLabel(kind, s.level),
    pips: Array.from({ length: levels }, (_, n) => ({ on: n < level })),
    element: glyph && ["spell", "sign"].includes(kind)
      ? { ...glyph, label: CONFIG.VEDMAK.MAGIC_ELEMENTS[s.element] ?? "" } : null,
    cost: s.variableCost ? `1–${max}` : String(s.staCost ?? 0),
    variable: !!s.variableCost, maxCost: max, keep,
    text: plainText(s.effect || s.description),
    range: s.range, duration: s.duration,
    defense: s.defenseText || CONFIG.VEDMAK.MAGIC_DEFENSES?.[s.defense] || "",
    dc: s.dc || s.dcText || "", preparation: s.preparation,
    castLabel: kind === "ritual" ? "Провести" : kind === "hex" ? "Навести" : "Сотворить",
    go: CAST_GO[kind] ?? "arcane"
  };
}

/**
 * Данные вкладки «Магия»: источник (Энергия, Вын, навыки, фокус, щит), поддерживаемое, знаки ведьмака парами
 * «основной / второй» с подробностью выбранного и карточки остальной магии по видам.
 */
function magicContext(actor, spells) {
  const system = actor.system;
  const d = system.derived;
  const used = vigorUsed(actor).used;
  const skill = key => system.skills[key]?.base ?? 0;
  const sorted = spells.slice().sort((a, b) =>
    (LEVEL_ORDER[a.system.level] - LEVEL_ORDER[b.system.level]) || compareRu(a.name, b.name));

  // Знаки: пять пар по названию, прочие (Сомна, Супирре, свои) — отдельными медалями
  const signs = sorted.filter(s => s.system.kind === "sign");
  const byName = new Map(signs.map(s => [s.name, s]));
  const paired = new Set();
  const signForms = [];
  for (const f of SIGN_FORMS) {
    const base = byName.get(f.base);
    if (!base) continue;
    const alt = byName.get(f.alt);
    paired.add(base.id);
    if (alt) paired.add(alt.id);
    signForms.push({ base: spellCard(base), alt: alt ? spellCard(alt) : null, altName: f.alt, altImg: alt?.img ?? f.altImg });
  }
  for (const s of signs) if (!paired.has(s.id)) signForms.push({ base: spellCard(s), alt: null, altName: "", altImg: "" });
  // Подробность выбранного знака: Вын ступенькой, что даёт каждое очко — подсказкой
  const signDetails = signForms.flatMap(f => [f.base, f.alt].filter(Boolean).map(card => {
    const item = actor.items.get(card.id);
    const auto = spellAutomation(item);
    const max = card.variable ? card.maxCost : 0;
    const start = card.variable ? Math.min(max, Math.max(1, d.vigor - used || 1)) : Number(card.system.staCost) || 0;
    return { ...card, pairId: f.base.id, isAlt: card.id !== f.base.id, hasAlt: !!f.alt, altId: f.alt?.id ?? "",
      start, notes: JSON.stringify(card.variable ? Array.from({ length: max }, (_, n) => costNote(auto, n + 1)) : [costNote(auto, start)]) };
  }));

  const spellGroups = Object.entries(CONFIG.VEDMAK.MAGIC_KINDS).filter(([kind]) => kind !== "sign").map(([kind, label]) => ({
    kind, label, go: CAST_GO[kind],
    note: kind === "ritual" ? `Воля + Проведение ритуалов · ${skill("ritualCrafting")}`
      : kind === "hex" ? `Воля + Наведение порчи · ${skill("hexWeaving")}` : `Воля + Сотворение заклинаний · ${skill("spellCasting")}`,
    items: sorted.filter(s => s.system.kind === kind).map(spellCard)
  }));
  const has = kind => sorted.some(s => s.system.kind === kind);

  // Щит Квена: сколько осталось — по метке щита (timed.key = "shield")
  const shieldFx = actor.effects.find(e => e.flags?.vedmak?.timed?.key === "shield");
  const shieldLeft = shieldFx ? (shieldFx.flags.vedmak.timed.rounds ? `ещё ${shieldFx.flags.vedmak.timed.rounds} р.`
    : Number.isFinite(shieldFx.duration?.secondsRemaining) ? `ещё ${Math.max(0, Math.ceil(shieldFx.duration.secondsRemaining / (CONFIG.time.roundTime || 3)))} р.` : "") : "";
  const sta = system.sta ?? { value: 0, max: 0 };
  const maintained = maintainedSpells(actor).map(e => {
    const cost = e.flags.vedmak.maintain.cost;
    return { id: e.id, name: e.name, img: e.img, cost, segs: Array.from({ length: Math.min(cost || 0, 10) }, () => ({})) };
  });
  return {
    spellGroups, signForms, signDetails,
    hasSigns: !!signForms.length,
    hasMagic: !!sorted.length,
    magic: {
      used, vigor: d.vigor ?? 0,
      energy: energySegments(d.vigor ?? 0, used, 0),
      energyNote: d.dimeritium ? "Касание двимерита: Энергия 0"
        : used ? `${used} из ${d.vigor} уже влито в этом раунде` : "Энергия — сколько Вын можно без вреда влить за раунд",
      sta: { value: sta.value, max: sta.max, pct: sta.max ? Math.round(Math.max(0, Math.min(1, sta.value / sta.max)) * 100) : 0 },
      skills: [
        { key: "spellCasting", label: "Сотворение", value: skill("spellCasting"), show: true },
        { key: "ritualCrafting", label: "Ритуалы", value: skill("ritualCrafting"), show: has("ritual") },
        { key: "hexWeaving", label: "Порча", value: skill("hexWeaving"), show: has("hex") }
      ].filter(k => k.show).map(k => ({ ...k, title: `Воля + ${SKILLS[k.key]?.label ?? k.label}` })),
      focus: d.focus ?? 0, focusItem: d.focusItem ?? "", showFocus: !!d.focus || sorted.some(x => x.system.kind !== "sign"),
      signNote: `Воля + Сотворение заклинаний · ${skill("spellCasting")}`,
      kinds: Object.entries(CONFIG.VEDMAK.MAGIC_KINDS).map(([kind, label]) => ({ kind, label })),
      shield: system.shield?.value ?? 0, shieldLeft, showShield: !!(system.shield?.value || has("sign")),
      maintained,
      // Двимерит: касание и его последствия (стр. 167); ячейка — у тех, кто владеет магией
      showDimeritium: !!sorted.length || (d.vigor ?? 0) > 0 || !!d.dimeritium,
      dimeritium: dimeritiumRow(actor)?.text ?? "",
      learning: Object.entries(MAGIC_LEARNING).map(([level, l]) => ({
        label: levelLabel("spell", level), pips: [1, 2, 3, 4].map(n => ({ on: n <= LEVEL_ORDER[level] + 1 })), ...l,
        checksLabel: `${l.checks} ${l.checks < 5 ? "проверки" : "проверок"}`
      }))
    }
  };
}

/** Деления Энергии: влито в этом раунде, будет влито сейчас, перегрузка сверх Энергии и свободное. */
function energySegments(vigor, used, planned) {
  const total = Math.max(vigor, used + planned);
  return Array.from({ length: Math.min(total, 20) }, (_, n) => ({
    cls: n < used ? (n < vigor ? "spent" : "burn") : n < used + planned ? (n < vigor ? "plan" : "burn") : "free"
  }));
}

const ARMOR_PARTS = [
  { key: "head", kind: "head" }, { key: "torso", kind: "torso" },
  { key: "rightArm", kind: "arm" }, { key: "leftArm", kind: "arm", flip: true },
  { key: "rightLeg", kind: "leg" }, { key: "leftLeg", kind: "leg", flip: true }
];

/** Броня: символы закрытых частей с прочностью (цела, изношена, разбита, не закрыта), класс щитками. */
function armorRow(item) {
  const s = item.system;
  const LOC = CONFIG.VEDMAK.ARMOR_LOCATIONS ?? {};
  const parts = ARMOR_PARTS.map(p => {
    const sp = s.sp?.[p.key] ?? { value: 0, max: 0 };
    const covered = sp.max > 0;
    const state = !covered ? "none" : sp.value <= 0 ? "broken" : sp.value <= sp.max / 2 ? "worn" : "ok";
    return {
      ...p, state, covered, value: sp.value, max: sp.max,
      tip: covered ? `${LOC[p.key] ?? p.key}: ${sp.value} / ${sp.max}` : `${LOC[p.key] ?? p.key}: не закрыта`
    };
  });
  const cls = { light: 1, medium: 2, heavy: 3 }[s.weightClass] ?? 1;
  const rel = s.reliability ?? { value: 0, max: 0 };
  return {
    id: item.id, img: item.img, name: item.name, system: s,
    equipped: !!s.equipped, relic: !!s.relic, enhancements: s.enhancements ?? [],
    isShield: !!s.isShield, parts, pips: [1, 2, 3].map(i => ({ on: i <= cls })),
    classLabel: CONFIG.VEDMAK.ARMOR_WEIGHT_CLASS?.[s.weightClass] ?? "",
    rel: { value: rel.value, max: rel.max, ...notches(rel.value, rel.max) },
    encumbrance: s.encumbrance ?? 0, weight: s.weight ?? 0
  };
}

export class VedmakActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["vedmak", "sheet", "actor"],
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      rollSkill: VedmakActorSheet.#onRollSkill,
      rollStat: VedmakActorSheet.#onRollStat,
      itemCreate: VedmakActorSheet.#onItemCreate,
      itemEdit: VedmakActorSheet.#onItemEdit,
      itemDelete: VedmakActorSheet.#onItemDelete,
      itemToggleEquip: VedmakActorSheet.#onItemToggleEquip,
      itemPost: VedmakActorSheet.#onItemPost,
      effectCreate: VedmakActorSheet.#onEffectCreate,
      effectEdit: VedmakActorSheet.#onEffectEdit,
      effectDelete: VedmakActorSheet.#onEffectDelete,
      effectToggle: VedmakActorSheet.#onEffectToggle,
      toggleTrainedOnly: VedmakActorSheet.#onToggleTrainedOnly,
      attack: VedmakActorSheet.#onAttack,
      stunSave: VedmakActorSheet.#onStunSave,
      deathSave: VedmakActorSheet.#onDeathSave,
      toggleStatus: VedmakActorSheet.#onToggleStatus,
      critCreate: VedmakActorSheet.#onCritCreate,
      restTurn: VedmakActorSheet.#onRestTurn,
      restDays: VedmakActorSheet.#onRestDays,
      manualDamage: VedmakActorSheet.#onManualDamage,
      controlCheck: VedmakActorSheet.#onControlCheck,
      ram: VedmakActorSheet.#onRam,
      castSpell: VedmakActorSheet.#onCastSpell,
      endMaintained: VedmakActorSheet.#onEndMaintained,
      dimeritiumTouch: function () { return touchDimeritium(this.actor); },
      dimeritiumEnd: function () { return endDimeritium(this.actor); },
      profileSheet: VedmakActorSheet.#onProfileSheet,
      verbalAction: VedmakActorSheet.#onVerbalAction,
      duelReset: VedmakActorSheet.#onDuelReset,
      detachEnhancement: VedmakActorSheet.#onDetachEnhancement,
      detachCrossbowMod: VedmakActorSheet.#onDetachCrossbowMod,
      showPortrait: VedmakActorSheet.#onShowPortrait
    }
  };

  /* ------------------------- Ограниченный доступ ------------------------- */

  /**
   * Право ниже «Наблюдателя»: Foundry открывает лист уже с «Ограниченного» (viewPermission), и игрок видел бы
   * всё — у чудовища заметки ведущего, знания, которые по правилам открывает проверка, добычу и параметры.
   * Такому зрителю — один короткий лист: имя, портрет и то, что видно со стороны.
   */
  get limitedView() {
    return !this.document.testUserPermission(game.user, "OBSERVER");
  }

  /**
   * Имя для короткого листа — с токена, если лист открыт с несвязанного токена: ведущий мог назвать токен
   * «Тварь из болота», чтобы не выдать, кто это.
   */
  get limitedName() {
    return this.token?.name || this.actor.name;
  }

  /** Заголовок окна короткого листа — тем же именем, без вида актора. */
  get title() {
    return this.document && this.limitedView ? this.limitedName : super.title;
  }

  /** Какой вид листа нарисован сейчас: права могут смениться при открытом листе. */
  #limited = false;

  /** Размер окна для вида листа: короткий — узкий и по высоте содержимого, полный — как в DEFAULT_OPTIONS класса. */
  #viewPosition(limited) {
    if (limited) return { width: 480, height: "auto" };
    const position = {};
    // DEFAULT_OPTIONS есть у каждого класса цепочки: от общего предка к листу, поздние перекрывают ранние
    const chain = [...this.constructor.inheritanceChain()].reverse();
    for (const cls of chain) {
      if (Object.hasOwn(cls, "DEFAULT_OPTIONS")) Object.assign(position, cls.DEFAULT_OPTIONS.position);
    }
    return position;
  }

  /** Короткий лист — узким окном по высоте содержимого. */
  _initializeApplicationOptions(options) {
    options = super._initializeApplicationOptions(options);
    if (!options.document.testUserPermission(game.user, "OBSERVER")) {
      options.position = { ...options.position, width: 480, height: "auto" };
      options.classes.push("limited");
    }
    return options;
  }

  /** Вместо вкладок — одна часть «limited» (так же Foundry меняет набор частей в своих листах). */
  _configureRenderParts(options) {
    if (!this.#limited) return super._configureRenderParts(options);
    return { limited: { template: LIMITED_TEMPLATE, templates: [] } };
  }

  /** Сменился вид листа — старые части убрать целиком, иначе новые встанут рядом с ними. */
  _replaceHTML(result, content, options) {
    if (options.vedmakResetParts) content.replaceChildren();
    super._replaceHTML(result, content, options);
    // Ненарисованным вкладкам — пустое место в своём порядке: когда их откроют, Foundry заменит его на месте,
    // а не допишет вкладку в конец окна
    if (this.#limited) return;
    let prev = null;
    for (const id of Object.keys(this.constructor.PARTS)) {
      let el = content.querySelector(`:scope > [data-application-part="${id}"]`);
      if (!el && this.#staleParts.has(id)) {
        el = document.createElement("section");
        el.className = "tab";
        el.dataset.group = "primary";
        el.dataset.tab = id;
        el.dataset.applicationPart = id;
        if (prev) prev.after(el);
        else content.prepend(el);
      }
      if (el) prev = el;
    }
  }

  static #onShowPortrait() {
    const actor = this.actor;
    new foundry.applications.apps.ImagePopout({ src: actor.img, uuid: actor.uuid, window: { title: this.limitedName } })
      .render({ force: true });
  }

  /** В меню «…» заголовка — замер скорости листа (module/apps/perf.mjs): цифры с компьютера игрока. */
  _getHeaderControls() {
    const controls = super._getHeaderControls();
    if (!this.#limited) controls.push({ label: "Замер скорости листа", action: "profileSheet" });
    return controls;
  }

  static async #onProfileSheet() {
    await profileSheet(this);
  }

  static async #onVerbalAction(event, target) {
    await verbalAction(this.actor, target.dataset.verbal, { skipDialog: event.shiftKey });
  }

  /** Новая словесная дуэль: Решительность снова полная, накопленные бонусы противников сброшены. */
  static async #onDuelReset() {
    await resetDuel(this.actor);
  }

  /** Снять набор усиления с брони (Изготовление СЛ 15): у чудовища броня с усилениями тоже бывает. */
  static async #onDetachEnhancement(event, target) {
    const item = VedmakActorSheet.#itemFrom.call(this, target);
    if (item) await detachEnhancement(this.actor, item, Number(target.dataset.index));
  }

  /** Снять модификацию арбалета — обратно в снаряжение. */
  static async #onDetachCrossbowMod(event, target) {
    const item = VedmakActorSheet.#itemFrom.call(this, target);
    if (item) await detachCrossbowMod(this.actor, item, Number(target.dataset.index));
  }

  /** Показывать только изученные навыки (состояние окна, не документа). */
  trainedOnly = false;

  /* ------------------------- Перерисовка видимого ------------------------- */

  /** Вкладки, которые изменились, пока были скрыты: дорисуются, когда их откроют. */
  #staleParts = new Set();

  /**
   * Повторная перерисовка без явного списка частей (изменился актор, его предмет или эффект, действие листа)
   * рисует только шапку, полосу вкладок и открытую вкладку. Остальные вкладки помечаются устаревшими:
   * раньше каждое изменение поля перестраивало все семь-девять вкладок, и лист подвисал на каждой правке.
   */
  _configureRenderOptions(options) {
    const firstRender = options.isFirstRender ?? !this.rendered;
    // Права сменились при открытом листе (дали «Наблюдателя» или отняли) — другой вид, рисуем всё заново
    const limited = this.limitedView;
    const modeChanged = !firstRender && limited !== this.#limited;
    this.#limited = limited;
    if (modeChanged) {
      options.parts = undefined;
      options.vedmakResetParts = true;
      this.#staleParts.clear();
      // Размер короткого листа («auto» по высоте) записан в options.position, а ApplicationV2 после каждой
      // отрисовки применяет его снова — позже _onRender, и setPosition оттуда перебивался бы. Поэтому меняем сами
      // параметры окна, до super: тогда и автоподбор размера не вернётся, и после смены размер правильный.
      Object.assign(this.options.position, this.#viewPosition(limited));
    }
    // Первое открытие — тоже только открытая вкладка: остальные дорисует changeTab (PLAN 4.73). Раньше лист при
    // открытии строил все семь-девять вкладок разом — одна задача на 180–280 мс
    const lazy = !modeChanged && !options.parts;
    super._configureRenderOptions(options);
    // Заголовок окна Foundry обновляет, только когда у документа сменилось имя; у короткого листа заголовок —
    // имя с токена, у полного — с видом актора, так что при смене вида обновляем его принудительно
    if (modeChanged && this.hasFrame) options.window = Object.assign(options.window ?? {}, { title: this.title });
    if (this.#limited) {
      options.parts = ["limited"];
      return;
    }
    const parts = options.parts ??= Object.keys(this.constructor.PARTS);
    if (!lazy) {
      for (const p of parts) this.#staleParts.delete(p);
      return;
    }
    const tabIds = new Set(this.constructor.TABS?.primary?.tabs?.map(t => t.id) ?? []);
    // До первой отрисовки tabGroups ещё пуст — открытой будет начальная вкладка
    const primary = this.constructor.TABS?.primary;
    const active = this.tabGroups.primary ?? primary?.initial ?? primary?.tabs?.[0]?.id;
    if (!active) return;
    options.parts = parts.filter(p => {
      if (!tabIds.has(p) || p === active) {
        this.#staleParts.delete(p);
        return true;
      }
      this.#staleParts.add(p);
      return false;
    });
  }

  /** Открыли вкладку, которая менялась в скрытом виде, — дорисовать её. */
  changeTab(tab, group, options = {}) {
    super.changeTab(tab, group, options);
    if (group === "primary" && this.#staleParts.has(tab)) {
      this.#staleParts.delete(tab);
      // Вкладка рисуется впервые — проявить уже нарисованную, а не пустое место под неё
      this.render({ parts: [tab] }).then(() => animateTab(this.element, group, tab));
      return;
    }
    animateTab(this.element, group, tab);
  }

  /**
   * Привести вкладки к текущему состоянию `tabGroups`. Отрисовка идёт долго (контекст готовится асинхронно), и если
   * за это время переключили вкладку, перерисованная часть приходит с классом `active` по старому состоянию, а новая
   * вкладка уже получила его от changeTab: открытыми оказываются две. Поэтому после каждой отрисовки класс
   * расставляется заново — только у вкладки из `tabGroups`.
   */
  #syncTabs() {
    if (this.#limited) return;
    for (const [group, tab] of Object.entries(this.tabGroups)) {
      if (!tab) continue;
      const sections = this.element.querySelectorAll(`.tab[data-group="${group}"]`);
      // Нужной вкладки в разметке нет (часть ещё не нарисована) — ничего не гасим, иначе не останется ни одной
      if (!Array.from(sections).some(s => s.dataset.tab === tab)) continue;
      for (const section of sections) section.classList.toggle("active", section.dataset.tab === tab);
      for (const nav of this.element.querySelectorAll(`.tabs [data-group="${group}"]`)) {
        const on = nav.dataset.tab === tab;
        nav.classList.toggle("active", on);
        if (nav.localName === "button") nav.ariaPressed = `${on}`;
      }
    }
  }

  /** Какие слушатели уже висят на элементе: элементы вкладок, которые не перерисовывались, второй не получают. */
  #bound = new WeakMap();

  /**
   * Повесить слушатель на элементы листа по селектору — по одному разу на элемент.
   * @param {string} selector
   * @param {string} type — событие
   * @param {(event: Event, el: HTMLElement) => any} handler
   */
  _listen(selector, type, handler) {
    const key = `${type} ${selector}`;
    for (const el of this.element.querySelectorAll(selector)) {
      let keys = this.#bound.get(el);
      if (!keys) this.#bound.set(el, keys = new Set());
      if (keys.has(key)) continue;
      keys.add(key);
      el.addEventListener(type, event => handler(event, el));
    }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;
    Object.assign(context, {
      actor, system,
      systemFields: system.schema.fields,
      editable: this.isEditable,
      owner: actor.isOwner,
      isGM: game.user.isGM,
      config: CONFIG.VEDMAK,
      isCharacter: actor.type === "character",
      trainedOnly: this.trainedOnly,
      limited: this.#limited
    });
    // Короткому листу хватает имени и портрета; что ещё видно со стороны — добавляют листы персонажа и чудовища
    if (this.#limited) {
      context.limitedName = this.limitedName;
      return context;
    }

    context.stats = Object.entries(system.stats).map(([key, s]) => ({ key, ...s, rollable: key !== "luck" }));

    // Навыки по параметрам
    const groups = skillsByStat();
    context.skillGroups = SKILL_STATS.map(stat => ({
      stat,
      label: STATS[stat].label,
      abbr: STATS[stat].abbr,
      value: system.stats[stat].effective,
      skills: groups[stat]
        .map(def => ({ ...def, ...system.skills[def.key], key: def.key }))
        .filter(s => !this.trainedOnly || s.trained || s.profession)
    }));
    context.hasSkills = context.skillGroups.some(g => g.skills.length);
    // Две колонки групп навыков примерно равной высоты: заголовок группы — как две строки
    context.skillCols = balanceColumns(context.skillGroups.filter(g => g.skills.length), g => g.skills.length + 2)
      .filter(col => col.length);

    // Предметы по типам
    const byType = type => actor.itemTypes[type]?.slice().sort((a, b) => a.sort - b.sort) ?? [];
    context.items = {
      weapons: byType("weapon"),
      armor: byType("armor"),
      gear: byType("gear"),
      spells: byType("spell")
    };

    // Вкладка «Снаряжение»: строки оружия и брони символами вместо букв (тип урона, хват, насечки надёжности,
    // части тела с прочностью) — шаблону остаётся только выводить
    context.weaponRows = context.items.weapons.map(weaponRow);
    context.armorRows = context.items.armor.map(armorRow);

    // Снаряжение по категориям книги; пустые категории не показываем
    const CATS = CONFIG.VEDMAK.GEAR_CATEGORIES ?? {};
    const line = item => ({
      id: item.id, name: item.name, img: item.img, system: item.system,
      total: Math.round((item.system.weight ?? 0) * (item.system.quantity ?? 1) * 10) / 10
    });
    const known = new Set(Object.keys(CATS));
    // Места татуировок — подписью ленты на нанесённой («Офир и Зеррикания»)
    context.tattooPlaces = Object.fromEntries(Object.entries(CONFIG.VEDMAK.TATTOO_LOCATIONS ?? {}).map(([k, l]) => [k, l.label]));
    context.gearGroups = Object.entries(CATS).map(([key, label]) => ({
      key, label, items: context.items.gear.filter(i => (i.system.category || "general") === key).map(line)
    })).concat([{ key: "unknown", label: "Прочее",
      items: context.items.gear.filter(i => !known.has(i.system.category || "general")).map(line) }])
      .filter(g => g.items.length);

    // Полосы ПЗ, Вын и Токсичности в шапке
    const d = system.derived;
    const pct = (v, m) => (m > 0 ? Math.max(0, Math.min(100, Math.round((v / m) * 100))) : 0);
    context.vitals = [
      {
        key: "hp", label: "ПЗ", full: "ПЗ", name: "system.hp.value", value: system.hp.value, max: system.hp.max,
        pct: pct(system.hp.value, system.hp.max), notch: pct(d.woundThreshold, system.hp.max),
        state: d.dying ? "dying" : d.wounded ? "wounded" : "",
        hint: d.dying ? "При смерти: все параметры ⅓, нужны испытания против смерти"
          : `Порог ранения ${d.woundThreshold}: ниже него Реа, Лвк, Инт и Воля вдвое`
      },
      {
        key: "sta", label: "Вын", full: "ВЫНОСЛИВОСТЬ", name: "system.sta.value", value: system.sta.value, max: system.sta.max,
        pct: pct(system.sta.value, system.sta.max),
        hint: `Отдых восстанавливает ${d.rec} за ход`
      }
    ];
    if (system.toxicity) {
      const tox = system.toxicity;
      context.vitals.push({
        key: "tox", label: "Токс", full: "ТОКСИЧНОСТЬ", name: "system.toxicity.value", value: tox.value, max: tox.max, suffix: "%",
        notch: 50, notchHint: "Выше половины — дурнота",
        pct: pct(tox.value, tox.max), extraPct: pct(tox.active, tox.max), state: tox.over ? "over" : "",
        hint: tox.active ? `Своё ${tox.value}% + эликсиры и отвары ${tox.active}% = ${tox.total}% из ${tox.max}%`
          : `Сверх ${tox.max}% — отравление и испытание Стойкости`
      });
    }
    context.load = {
      carried: d.carried, enc: d.enc, liftMax: d.liftMax, overload: d.overload,
      pct: pct(d.carried, d.enc), over: d.carried > d.enc
    };
    // Кошелёк по валютам: итог в кронах и вес монет
    if (system.money) {
      context.purse = {
        rows: currencies().map(c => ({ ...c, main: c.key === "crowns", value: system.money[c.key] ?? 0, rateText: formatRate(c.rate) })),
        crowns: formatRate(toCrowns(system.money)),
        kg: formatRate(coinWeightKg(system.money)),
        weightOn: coinWeightEnabled()
      };
    }

    // Производные — порядок как на листе книги
    context.derived = [
      { key: "vigor", value: d.vigor },
      { key: "stun", value: d.stun },
      { key: "run", value: d.run, unit: "м" },
      { key: "leap", value: d.leap, unit: "м" },
      { key: "enc", value: d.enc, unit: "кг" },
      { key: "rec", value: d.rec },
      { key: "woundThreshold", value: d.woundThreshold },
      { key: "resolve", value: d.resolve }
    ].map(x => ({ ...DERIVED[x.key], ...x }));

    Object.assign(context, magicContext(actor, context.items.spells));

    // Бой
    context.attacks = attackSources(actor).map(src => {
      const skill = system.skills[src.skill];
      const rel = src.item?.system.reliability;
      const w = src.weapon ?? {};
      return {
        kind: src.kind, itemId: src.item?.id ?? "", label: src.label, img: src.img,
        skillLabel: SKILLS[src.skill]?.label ?? "", base: skill.base + (src.accuracy || 0),
        damage: src.kind === "unarmed" ? `${system.derived.punch} / ${system.derived.kick}` : w.damage,
        damageLabel: src.kind === "unarmed" ? "рука / нога" : "урон",
        // Естественное оружие (когти, клыки) не надевают — оно готово всегда
        equipped: src.item ? !!src.item.system.equipped || src.item.system.category === "natural" : true,
        reliability: rel, relPct: rel?.max ? Math.round((rel.value / rel.max) * 100) : 0,
        isRanged: src.isRanged,
        range: src.isRanged ? w.range : null,
        // Чем примечательно оружие: масло, серебро, свойства — одной строкой под названием
        oil: w.oil ? `масло: ${w.oil.target || w.oil.name}` : "",
        silver: w.silverDamage ? `серебро ${w.silverDamage}` : "",
        traits: (w.effects ?? []).map(e => {
          const cfg = CONFIG.VEDMAK.WEAPON_EFFECTS?.[e.key];
          return `${cfg?.label ?? e.key}${e.value ? ` ${e.value}` : ""}`;
        }).join(", "),
        nonLethal: !!w.nonLethal,
        attackSpeed: actor.type === "monster" && src.kind === "weapon" ? src.item.system.attackSpeed : null
      };
    });
    const DEFENSE_ABOUT = {
      dodge: "уйти с линии удара",
      athletics: "изменение позиции: шаг на ½ Скор",
      brawling: "блок рукой и приёмы",
      melee: "блок и парирование оружием"
    };
    context.defenses = ["dodge", "athletics", "brawling", "melee"].map(key => ({
      key, label: SKILLS[key].label, base: system.skills[key].base, about: DEFENSE_ABOUT[key] ?? ""
    }));
    const armorLocs = Object.entries(system.derived.armor ?? {}).map(([key, loc]) => ({ key, ...loc }));
    // Шкала общая для всех частей: сразу видно, где в защите дыра
    const spScale = Math.max(10, ...armorLocs.map(l => l.sp || 0));
    context.armorLocations = armorLocs.map(loc => ({
      ...loc,
      pct: Math.round(((loc.sp || 0) / spScale) * 100),
      multLabel: loc.mult === 0.5 ? "×½" : `×${loc.mult}`,
      layerNames: loc.layers.map(l => `${l.name} ${l.value}/${l.max}`).join(", "),
      resistLabels: loc.resist.map(k => CONFIG.VEDMAK.DAMAGE_TYPES[k]?.label ?? k).join(", ")
    }));
    // Доспешный манекен (гуманоид): части тела значками, слева — правая сторона тела, справа — левая и туловище
    const byKey = Object.fromEntries(context.armorLocations.map(l => [l.key, l]));
    if (["head", "torso", "rightArm", "leftArm", "rightLeg", "leftLeg"].every(k => byKey[k])) {
      const state = k => (byKey[k].sp > 0 ? "ok" : "dim");
      context.armorDoll = {
        left: [byKey.head, byKey.rightArm, byKey.rightLeg], right: [byKey.torso, byKey.leftArm, byKey.leftLeg],
        head: state("head"), torso: state("torso"), rightArm: state("rightArm"), leftArm: state("leftArm"),
        rightLeg: state("rightLeg"), leftLeg: state("leftLeg")
      };
    }
    context.armorLayers = [...new Set(armorLocs.flatMap(l => l.layers.map(x => x.name)))].join(" · ");
    context.armorResists = [...new Set(armorLocs.flatMap(l => l.resist))]
      .map(k => CONFIG.VEDMAK.DAMAGE_TYPES[k]?.label ?? k).join(", ");
    context.shields = (system.derived.shields ?? []).map(i => ({
      id: i.id, name: i.name, img: i.img,
      reliability: `${i.system.reliability.value}/${i.system.reliability.max}`
    }));
    const locTable = system.derived.bodyType === "monster" ? LOCATIONS_MONSTER : LOCATIONS_HUMANOID;
    context.critWounds = (actor.itemTypes.critWound ?? []).map(item => {
      const cfg = item.system.config;
      const level = CRIT_LEVELS[item.system.level];
      return {
        id: item.id, name: item.name, img: item.img, state: item.system.state,
        levelKey: item.system.level, levelLabel: level?.label ?? "",
        locationLabel: (LOCATIONS_HUMANOID[item.system.location] ?? LOCATIONS_MONSTER[item.system.location])?.label ?? "",
        text: item.system.current.text, teeth: item.system.teeth, healingDays: item.system.healingDays,
        states: Object.entries(CRIT_STATES).map(([key, label]) => ({ key, label, selected: key === item.system.state })),
        hint: level ? `Стабилизация: Первая помощь СЛ ${level.stabilizeDC}. Лечение: Лечащее прикосновение СЛ ${level.treatDC} (${level.treatRounds} раунда) или ${level.magicCount} заклинаний СЛ ${level.magicDC}.` : "",
        unknown: !cfg
      };
    });
    context.statusList = STATUS_EFFECTS.map(s => {
      const hint = STATUS_HINTS[s.id] ?? s.name;
      return {
        id: s.id, name: s.name, img: s.img, active: actor.statuses.has(s.id), hint,
        // Чем состояние обходится — первая фраза подсказки, чтобы цена была видна без наведения
        cost: hint.split(". ")[0].replace(/\.$/, "")
      };
    });
    context.activeStatuses = context.statusList.filter(s => s.active);
    context.locTable = locTable;
    context.adrenalineRule = worldSetting("adrenaline", false) && actor.type === "character";

    // Эффекты
    context.effects = [...actor.allApplicableEffects()].map(e => ({
      id: e.id, uuid: e.uuid, name: e.name, img: e.img, disabled: e.disabled,
      source: e.parent === actor ? "" : e.parent?.name, parentId: e.parent === actor ? "" : e.parent?.id,
      changes: describeChanges(e.system?.changes),
      duration: e.flags?.vedmak?.timed?.rounds ? `${e.flags.vedmak.timed.rounds} р.` : (e.isTemporary ? e.duration.label : ""),
      expired: e.isTemporary && !e.active && !e.disabled
    }));

    // Словесная дуэль (стр. 176–177) — у персонажа и чудовища. Необязательное правило: без неё «Бой» —
    // только обычный бой. Решительность — (Воля + Инт) / 2 × 5 у любого актора
    context.showSocialCombat = worldSetting("verbalDuel", true);
    if (context.showSocialCombat) context.verbal = verbalContext(actor);
    if (this.constructor.TABS?.combat) context.combatTabs = this._prepareTabs("combat");

    return context;
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (context.tabs?.[partId]) context.tab = context.tabs[partId];
    return context;
  }

  /** Обогатить HTML-поле для просмотра в редакторе. */
  async enrich(html) {
    return TextEditor.enrichHTML(html ?? "", { secrets: this.document.isOwner, relativeTo: this.document });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (options.vedmakResetParts) {
      this.element.classList.toggle("limited", this.#limited);
      this.setPosition(this.#viewPosition(this.#limited));
    }
    // Наблюдатель: кнопки правки спрятаны, строки с проверками и переключателями видны, но не нажимаются
    markLockedActions(this, { view: VIEW_ACTIONS, inert: INERT_ACTIONS });
    // Устаревшие скрытые вкладки держат прежние значения, а форма листа отправляется целиком: их поля ушли бы
    // вместе с правкой на открытой вкладке и откатили бы чужие изменения (кроны от ведущего, навыки из мастера).
    // Отключённые поля в форму не попадают; вкладку перерисует changeTab, когда её откроют.
    for (const part of this.#staleParts) {
      for (const el of this.element.querySelectorAll(`[data-application-part="${part}"] :is(input, select, textarea, prose-mirror, multi-checkbox, multi-select)`)) {
        el.disabled = true;
        el.setAttribute("disabled", "");
      }
    }
    this.#syncTabs();
    // Шкалы ПЗ/Вын/Токсичности доезжают от прежнего значения к новому (PLAN 4.67)
    animateVitals(this, this.element, this.actor.id);
    // Решительность в дуэли — не поле формы: форма писала бы текущий максимум во флаг при каждом сохранении,
    // и после смены Воли или Инт Решительность не была бы полной («нет флага — максимум», verbal.mjs)
    this._listen("input.duel-resolve-value", "change", async (event, input) => {
      event.stopPropagation();
      if (!(await setDuelResolve(this.actor, input.value))) this.render();
    });
    // Поля предметов прямо в списках (количество): пишем в предмет, а не в актора
    this._listen("input.item-field", "change", async (event, input) => {
      event.stopPropagation();
      const item = this.actor.items.get(input.closest("[data-item-id]")?.dataset.itemId);
      if (item) await item.update({ [input.dataset.field]: Number(input.value) || 0 });
    });
    // Состояние критического ранения меняется прямо в списке
    this._listen("select.crit-state", "change", async (event, select) => {
      const item = this.actor.items.get(select.closest("[data-item-id]")?.dataset.itemId);
      if (!item) return;
      const state = select.value;
      const update = { "system.state": state };
      if (state === "treated") {
        const body = Math.max(3, Math.min(13, this.actor.system.stats.body.raw));
        const idx = ["simple", "complex", "difficult"].indexOf(item.system.level);
        update["system.healingDays"] = idx >= 0 ? HEALING_DAYS[body][idx] : 0;
      }
      await item.update(update);
    });
    // «Магия»: выбор знака, его формы и Вын ступенькой — без перерисовки листа, выбор живёт в окне
    this._listen("button[data-sign-pick]", "click", (event, btn) => {
      event.preventDefault();
      this.signPick = btn.dataset.signPick;
      this.#applySignPick();
    });
    this._listen("button.cost-step", "click", (event, btn) => {
      event.preventDefault();
      const detail = btn.closest(".sign-detail");
      this.signCost[detail.dataset.itemId] = (Number(detail.dataset.cost) || 1) + Number(btn.dataset.step);
      this.#applySignCost(detail);
    });
    this.#applySignPick();
  }

  /* --------------------------- Магия: выбор знака --------------------------- */

  /** Выбранный знак (id предмета) и вложенная Вын по знакам. */
  signPick = "";
  signCost = {};

  #applySignPick() {
    const tab = this.element?.querySelector(".magic-tab");
    const details = [...(tab?.querySelectorAll(".sign-detail") ?? [])];
    if (!details.length) return;
    const cur = details.find(d => d.dataset.itemId === this.signPick) ?? details[0];
    this.signPick = cur.dataset.itemId;
    for (const d of details) d.hidden = d !== cur;
    for (const btn of tab.querySelectorAll("button.sign-medal")) {
      const on = btn.dataset.pairId === cur.dataset.pairId;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    this.#applySignCost(cur);
  }

  /** Вын выбранного знака: число, что даёт каждое очко, и как это ляжет на Энергию раунда. */
  #applySignCost(detail) {
    const id = detail.dataset.itemId;
    const variable = detail.dataset.variable === "true";
    const max = Number(detail.dataset.max) || 7;
    const cost = variable ? Math.max(1, Math.min(max, this.signCost[id] ?? (Number(detail.dataset.start) || 1)))
      : Number(detail.dataset.start) || 0;
    if (variable) this.signCost[id] = cost;
    detail.dataset.cost = String(cost);
    const out = detail.querySelector(".cost-value");
    if (out) out.textContent = String(cost);
    for (const btn of detail.querySelectorAll("button.cost-step")) {
      btn.disabled = Number(btn.dataset.step) < 0 ? cost <= 1 : cost >= max;
    }
    const notes = JSON.parse(detail.dataset.notes || "[]");
    const strip = this.element.querySelector(".magic-tab .energy");
    if (!strip) return;
    const vigor = Number(strip.dataset.vigor) || 0;
    const used = Number(strip.dataset.used) || 0;
    const focus = Number(strip.dataset.focus) || 0;
    const paid = focus ? Math.max(1, cost - focus) : cost;
    const over = Math.max(0, used + paid - vigor);
    const segs = strip.querySelector(".segs");
    segs.replaceChildren(...energySegments(vigor, used, paid).map(s => {
      const i = document.createElement("i");
      i.className = s.cls;
      return i;
    }));
    strip.querySelector(".cap b").textContent = `${Math.min(used + paid, vigor)} из ${vigor}`;
    const note = strip.querySelector(".energy-note");
    note.classList.toggle("bad", !!over);
    note.textContent = over ? `«${detail.dataset.name}» за ${cost}: перегрузка на ${over} — −${over * 5} ПЗ и стихийный откат`
      : `«${detail.dataset.name}» за ${cost}: уйдёт ${paid} Вын${focus ? ` (фокус −${focus})` : ""}`;
    const what = detail.querySelector(".cost-note");
    if (what) {
      const gives = notes[variable ? cost - 1 : 0] || "";
      what.textContent = over ? `сверх Энергии на ${over}` : gives || `в пределах Энергии (${vigor})`;
      what.classList.toggle("bad", !!over);
    }
  }

  /* ------------------------- Лист без права правки ------------------------- */

  /** Перехват щелчков по кнопкам правки без права правки (view-only.mjs). */
  _attachFrameListeners() {
    super._attachFrameListeners();
    guardLockedActions(this, VIEW_ACTIONS);
  }

  /* ------------------------------ Действия ------------------------------ */

  static #itemFrom(target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return this.actor.items.get(id);
  }

  static async #onRollSkill(event, target) {
    await this.actor.rollSkill(target.dataset.skill, { skipDialog: event.shiftKey });
  }

  static async #onRollStat(event, target) {
    await this.actor.rollStat(target.dataset.stat, { skipDialog: event.shiftKey });
  }

  static async #onItemCreate(event, target) {
    if (event?.detail > 1) return; // двойной щелчок — второй клик не создаёт дубль
    const type = target.dataset.type;
    const extra = target.dataset.kind ? { "system.kind": target.dataset.kind } : {};
    const label = game.i18n.localize(`TYPES.Item.${type}`);
    const [item] = await this.actor.createEmbeddedDocuments("Item", [{ name: `Новый: ${label}`, type, ...foundry.utils.expandObject(extra) }]);
    item?.sheet.render(true);
  }

  static #onItemEdit(event, target) {
    VedmakActorSheet.#itemFrom.call(this, target)?.sheet.render(true);
  }

  static async #onItemDelete(event, target) {
    const item = VedmakActorSheet.#itemFrom.call(this, target);
    if (!item) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Удалить предмет" },
      content: `<p>Удалить «${item.name}»?</p>`
    });
    if (ok) await item.delete();
  }

  static async #onItemToggleEquip(event, target) {
    const item = VedmakActorSheet.#itemFrom.call(this, target);
    if (item) await item.update({ "system.equipped": !item.system.equipped });
  }

  static async #onItemPost(event, target) {
    await VedmakActorSheet.#itemFrom.call(this, target)?.toChat();
  }

  static async #onEffectCreate(event) {
    if (event?.detail > 1) return; // двойной щелчок — второй клик не создаёт дубль
    const [effect] = await this.actor.createEmbeddedDocuments("ActiveEffect", [{
      name: "Новый эффект", img: "icons/svg/aura.svg"
    }]);
    effect?.sheet.render(true);
  }

  static #effectFrom(target) {
    const row = target.closest("[data-effect-id]");
    const parentId = row?.dataset.parentId;
    const parent = parentId ? this.actor.items.get(parentId) : this.actor;
    return parent?.effects.get(row?.dataset.effectId);
  }

  static #onEffectEdit(event, target) {
    VedmakActorSheet.#effectFrom.call(this, target)?.sheet.render(true);
  }

  static async #onEffectDelete(event, target) {
    const effect = VedmakActorSheet.#effectFrom.call(this, target);
    if (!effect) return;
    // Эффект предмета удаляется из самого предмета — навсегда, а не только с персонажа: спрашиваем
    if (effect.parent?.documentName === "Item") {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Удалить эффект предмета" },
        content: `<p>Эффект «${effect.name}» принадлежит предмету «${effect.parent.name}» и будет удалён из предмета.
          Чтобы только отключить его, нажмите переключатель.</p>`,
        rejectClose: false
      });
      if (!ok) return;
    }
    await effect.delete();
  }

  static async #onEffectToggle(event, target) {
    const effect = VedmakActorSheet.#effectFrom.call(this, target);
    if (effect) await effect.update({ disabled: !effect.disabled });
  }

  static async #onAttack(event, target) {
    const kind = target.dataset.kind;
    await this.actor.attack({ kind, itemId: target.dataset.itemId || target.closest("[data-item-id]")?.dataset.itemId },
      { skipDialog: event.shiftKey });
  }

  static async #onRestTurn() {
    await restTurn(this.actor);
  }

  static async #onRestDays() {
    await restDays(this.actor);
  }

  static async #onCastSpell(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    // Из подробности знака — с Вын, выставленной ступенькой (окно сотворения откроется с ней же)
    const cost = item?.system.variableCost ? Number(target.closest(".sign-detail")?.dataset.cost) || undefined : undefined;
    if (item) await castSpell(this.actor, item, { skipDialog: event.shiftKey, cost });
  }

  static async #onEndMaintained(event, target) {
    await endMaintained(this.actor, target.closest("[data-effect-id]")?.dataset.effectId);
  }

  static async #onControlCheck() {
    await controlCheck(this.actor);
  }

  /** Таран: выбрать скакуна или транспорт, затем обычное окно атаки. */
  static async #onRam(event) {
    if (event?.detail > 1) return; // двойной щелчок — второй клик не создаёт дубль
    const options = Object.entries(MOUNTS).map(([k, m]) => `<option value="${k}">${m.label} (${m.ram})</option>`).join("");
    const key = await foundry.applications.api.DialogV2.wait({
      window: { title: "Таран" },
      classes: ["vedmak", "vedmak-dialog"],
      content: `<div class="vedmak-roll-dialog"><div class="form-group"><label>Чем таранить</label><select name="mount">${options}</select></div></div>`,
      buttons: [{ action: "ok", label: "Далее", default: true, callback: (e, b) => b.form.elements.mount.value },
        { action: "cancel", label: "Отмена" }],
      rejectClose: false
    });
    if (!key || key === "cancel") return;
    await this.actor.attack({ kind: "ram", key }, { chargeMeters: 10 });
  }

  static async #onManualDamage() {
    await manualDamage([this.actor]);
  }

  static async #onStunSave() {
    await this.actor.rollStunSave();
  }

  static async #onDeathSave() {
    await this.actor.rollDeathSave();
  }

  static async #onToggleStatus(event, target) {
    await this.actor.toggleStatusEffect(target.dataset.status);
  }

  /** Добавить критическое ранение вручную. */
  static async #onCritCreate(event) {
    if (event?.detail > 1) return; // двойной щелчок — второй клик не создаёт дубль
    const table = this.actor.system.derived.bodyType === "monster" ? LOCATIONS_MONSTER : LOCATIONS_HUMANOID;
    const groups = Object.entries(CRIT_LEVELS).map(([level, cfg]) => {
      const options = Object.entries(CRIT_WOUNDS).filter(([, w]) => w.level === level)
        .map(([key, w]) => `<option value="${key}">${w.label} (${w.roll[0] === w.roll[1] ? w.roll[0] : w.roll.join("–")})</option>`).join("");
      return `<optgroup label="${cfg.label}">${options}</optgroup>`;
    }).join("");
    const locations = Object.entries(table).map(([k, l]) => `<option value="${k}">${l.label}</option>`).join("");
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Критическое ранение" },
      classes: ["vedmak", "vedmak-dialog"],
      content: `<div class="vedmak-roll-dialog">
        <div class="form-group"><label>Ранение</label><select name="wound">${groups}</select></div>
        <div class="form-group"><label>Часть тела</label><select name="location">${locations}</select></div></div>`,
      buttons: [{ action: "ok", label: "Добавить", default: true,
        callback: (e, b) => ({ wound: b.form.elements.wound.value, location: b.form.elements.location.value }) },
        { action: "cancel", label: "Отмена" }],
      rejectClose: false
    });
    if (!result || result === "cancel") return;
    const cfg = CRIT_WOUNDS[result.wound];
    await this.actor.createEmbeddedDocuments("Item", [{
      name: cfg.label, type: "critWound", img: cfg.img ?? "icons/skills/wounds/injury-body-pain-gray.webp",
      system: { wound: result.wound, location: result.location, state: "fresh" }
    }]);
  }

  static #onToggleTrainedOnly() {
    this.trainedOnly = !this.trainedOnly;
    this.render();
  }
}
