// Худ «Медальон на цепи» (PLAN 4.163; макет — design/12-hud-medallion): внизу по центру, без сплошной плиты. В центре —
// портрет токена в кованом ободе с дугами ПЗ и Вын, медальон стоит на подставке с выбитыми числами; по верхней дуге —
// камешки состояний. По цепи — два гнезда (удар или заклинание) и ярлыки «Действия», «Защита», «Магия», «Алхимия»:
// щелчок открывает список над медальоном. В бою: игроку — его персонаж, мастеру — выделенный токен или тот, чей ход.
// Вне боя — актор выделенного своего токена (настройка клиента «Худ вне боя»).

import { SYSTEM_ID, compareRu, setting } from "../util.mjs";
import { SKILLS } from "../config/skills.mjs";
import { STATUS_EFFECTS, STATUS_HINTS } from "../combat/statuses.mjs";
import { attackSources } from "../combat/attack.mjs";
import { manualDamage, restTurn, aimTurn, aimBonus } from "../combat/manual.mjs";
import { controlCheck } from "../combat/mounted.mjs";
import { MOUNTS } from "../config/combat.mjs";
import { verbalAction, VERBAL_GROUPS } from "../combat/verbal.mjs";
import { castSpell, vigorUsed, maintainedSpells } from "../magic/cast.mjs";
import { endMaintained } from "../magic/effects.mjs";
import { useAlchemical } from "../crafting/alchemy.mjs";
import { flipToken, canFlip } from "./token-flip.mjs";
import { transform, extendForm, endForm, regainControl, trueFormState } from "../character/true-form.mjs";
import { bearFormState, bearTransform, bearRevert, MARDREM } from "../character/bear-form.mjs";
import { isSnail, igniSlime, applyIgniSlime } from "../character/snail-school.mjs";
import { hudMotion } from "../fx/hud-motion.mjs";
import { bindVolumeSlider } from "../fx/volume.mjs";
import { levelLabel } from "../config/magic.mjs";
import { removeZones } from "../combat/zones.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Словесные действия на худе — самые ходовые; остальные — на вкладке «Социальный бой» листа. */
const VERBAL_QUICK = ["persuade", "seduce", "deceive", "intimidate", "ignore", "changeSubject"];
// Защиты (стр. 151–153): что делает и каким навыком — так же, как в окне защиты (DEFENSE_TYPES)
const HUD_DEFENSES = [
  { key: "dodge", label: "Уклонение", sub: "от удара и выстрела", hint: "Уклонение/Изворотливость: уйти от удара или выстрела" },
  { key: "athletics", label: "Смена позиции", sub: "Атлетика · ½ Скор", hint: "При успехе можно сместиться на ½ Скор" },
  { key: "melee", label: "Блок оружием", sub: "Ближний бой · парир. −3", hint: "Блок оружием тратит 1 надёжности; парирование −3, атакующий ошеломлён" },
  { key: "brawling", label: "Блок рукой", sub: "Борьба · урон в руку", hint: "Удар приходится в подставленную руку, броня работает" }
];
/** Глагол флакона: что сделает щелчок. Группы списка «Алхимия». */
const ALCH_VERB = { drink: "выпить", apply: "применить", mutagen: "принять", oil: "нанести", throw: "бросить", trap: "поставить" };
const ALCH_GROUPS = [
  { id: "drink", label: "Эликсиры и отвары", actions: ["drink", "apply", "mutagen"] },
  { id: "throw", label: "Бомбы и ловушки", actions: ["throw", "trap"] },
  { id: "oil", label: "Масла", actions: ["oil"] }
];
/** Полезные состояния — зелёная эмаль, остальные — киноварь. */
const GOOD_STATUSES = ["activeDodge", "invisible"];
/** Виды магии в гримуаре — порядок и подписи; уровни — порядок внутри вида. */
const MAGIC_ORDER = ["sign", "spell", "invocation", "ritual", "hex", "gift", "vampire"];
const MAGIC_GROUP_LABELS = { sign: "Знаки", spell: "Заклинания", invocation: "Инвокации", ritual: "Ритуалы", hex: "Порчи", gift: "Дары", vampire: "Вампирская" };
const LEVEL_ORDER = ["novice", "journeyman", "master", "archPriest"];
const ELEMENT_ORDER = ["fire", "water", "air", "earth", "mixed"];

/* Геометрия медальона: SVG 240×210, центр кольца (75, 75) в координатах рисунка = (120, 105) в пикселях */
const CX = 120, CY = 105, R_GROOVE = 57;
const P = (r, a) => [CX + r * Math.sin(a * Math.PI / 180), CY - r * Math.cos(a * Math.PI / 180)];
const arc = (r, a1, a2, sweep) => {
  const [x1, y1] = P(r, a1), [x2, y2] = P(r, a2);
  const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 ${large} ${sweep} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
};
/** Пути дуг: ПЗ — слева снизу вверх, Вын — справа снизу вверх, Энергия — внутри, через верх. */
const ARCS = {
  hp: arc(R_GROOVE, 205, 358, 1),
  sta: arc(R_GROOVE, 155, 2, 0),
  en: arc(49.6, 208, 512, 1)
};
/** Насечки обода: каждые 10°, у сторон света длиннее. */
const TICKS = Array.from({ length: 36 }, (_, i) => {
  const a = i * 10, long = a % 90 === 0, [x1, y1] = P(long ? 63 : 67.5, a), [x2, y2] = P(71, a);
  return { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1), w: long ? 1.3 : .8 };
});
/** Места камешков на ободе: сначала ближе к верху, потом ниже. */
const STONE_ANGLES = [-40, 40, -57, 57, -73, 73];

export class CombatHud extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "vedmak-combat-hud",
    classes: ["vedmak", "vedmak-hud"],
    window: { frame: false, positioned: false },
    actions: {
      togglePop: CombatHud.#onTogglePop,
      attack: CombatHud.#onAttack,
      socket: CombatHud.#onSocket,
      rollSkill: CombatHud.#onRollSkill,
      castSpell: CombatHud.#onCastSpell,
      endMaintained: CombatHud.#onEndMaintained,
      useAlchemical: CombatHud.#onUseAlchemical,
      restTurn: CombatHud.#onRestTurn,
      aimTurn: CombatHud.#onAimTurn,
      trueForm: CombatHud.#onTrueForm,
      bearForm: CombatHud.#onBearForm,
      igniSlime: CombatHud.#onIgniSlime,
      manualDamage: CombatHud.#onManualDamage,
      controlCheck: CombatHud.#onControlCheck,
      ram: CombatHud.#onRam,
      flipToken: CombatHud.#onFlipToken,
      verbal: CombatHud.#onVerbal,
      stunSave: CombatHud.#onStunSave,
      deathSave: CombatHud.#onDeathSave,
      toggleStatus: CombatHud.#onToggleStatus,
      nextTurn: CombatHud.#onNextTurn,
      toggleCollapse: CombatHud.#onToggleCollapse,
      magicKind: CombatHud.#onMagicKind,
      endZone: CombatHud.#onEndZone
    }
  };

  static PARTS = {
    hud: { template: "systems/vedmak/templates/hud/combat-hud.hbs" }
  };

  static #instance = null;

  static get instance() {
    return CombatHud.#instance ??= new CombatHud();
  }

  /** Актор, чьи кнопки показывать. */
  static actorFor() {
    // Хранилище (сундук, повозка) — не боец: худа у него нет
    const first = canvas?.tokens?.controlled?.[0]?.actor ?? null;
    const controlled = first?.type === "loot" ? null : first;
    if (!game.combat?.started) {
      return setting("hudOutOfCombat", true) && controlled?.isOwner ? controlled : null;
    }
    const current = game.combat.combatant?.actor ?? null;
    if (game.user.isGM) return controlled ?? current;
    // Игроку нужен свой лист и на чужом ходу — он защищается
    if (controlled?.isOwner) return controlled;
    if (game.user.character?.isOwner) return game.user.character;
    return current?.isOwner ? current : null;
  }

  /** Показать, спрятать или перерисовать худ по текущему состоянию. */
  static refresh() {
    if (!game.ready) return;
    const hud = CombatHud.instance;
    const actor = setting("combatHud", true) ? CombatHud.actorFor() : null;
    if (!actor) {
      // Элемент живёт не в body, а в нижней панели: убираем его сами, чтобы полоса не осталась висеть
      const el = document.getElementById(CombatHud.DEFAULT_OPTIONS.id);
      // Без анимации: закрытие с ней ждёт кадров, а в фоновой вкладке их нет — полоса оставалась висеть
      if (hud.rendered) hud.close({ animate: false }).finally(() => el?.remove());
      else el?.remove();
      document.body.classList.remove("vd-hud", "vd-hud-open");
      return;
    }
    hud.render({ force: true });
  }

  /**
   * Перерисовать, если изменился показанный сейчас актор, его предмет или эффект — и эффект на предмете:
   * у него родитель — предмет, а актор — родитель предмета, поэтому актор ищется вверх по родителям.
   */
  static refreshFor(doc, changes) {
    let actor = doc;
    while (actor && actor.documentName !== "Actor") actor = actor.parent;
    if (!CombatHud.#instance?.rendered) return;
    if (!actor) return;
    if (CombatHud.#instance.actor && actor.id !== CombatHud.#instance.actor.id) return;
    // Удар, лечение, Выносливость, Удача — правка чисел и дуг на месте, без перерисовки всего худа
    if (doc === actor && changes && !CombatHud.#timer && CombatHud.#instance.#patchVitals(changes)) return;
    CombatHud.schedule();
  }

  /** Поля актора, которые худ умеет обновить без перерисовки. */
  static #LIGHT = new Set(["system.hp.value", "system.sta.value", "system.luck.value"]);

  /**
   * Числа, дуги и монеты — прямо в готовом худе (PLAN 4.163): полная перерисовка на каждый удар стоила ~80 мс
   * пересчёта стилей. Возвращает false, если изменилось что-то ещё — тогда худ перерисуется целиком.
   */
  #patchVitals(changes) {
    const keys = Object.keys(foundry.utils.flattenObject(changes)).filter(k => !k.startsWith("_stats"));
    if (!keys.length || !keys.every(k => CombatHud.#LIGHT.has(k))) return false;
    // В открытом гримуаре и алхимии от Выносливости зависят пометки «не хватает» — там честная перерисовка
    if (this.pop === "magic" || this.pop === "alc") return false;
    const root = this.element, actor = this.actor, sys = actor.system;
    const medal = root?.querySelector(".hm-medal");
    if (!medal) return false;
    const pct = (v, m) => +(100 * (m > 0 ? Math.max(0, Math.min(1, v / m)) : 0)).toFixed(2);
    const hp = { value: sys.hp.value, pct: pct(sys.hp.value, sys.hp.max) }, sta = { value: sys.sta.value, pct: pct(sys.sta.value, sys.sta.max) };
    for (const path of medal.querySelectorAll(".hm-arc.hp, .hm-trail")) path.style.strokeDasharray = `${hp.pct} 100`;
    for (const path of medal.querySelectorAll(".hm-arc.sta")) path.style.strokeDasharray = `${sta.pct} 100`;
    const hpNum = medal.querySelector(".hm-num.hp");
    hpNum.querySelector("b").textContent = String(hp.value);
    hpNum.classList.toggle("hurt", hp.value < sys.hp.max);
    hpNum.classList.toggle("bad", hp.value <= 0);
    medal.querySelector(".hm-num.sta b").textContent = String(sta.value);
    const luck = sys.luck?.value ?? null;
    medal.querySelectorAll(".hm-coin").forEach((c, k, all) => { if (all.length > 1 || !medal.querySelector(".hm-coins em")) c.classList.toggle("spent", k >= luck); });
    const em = medal.querySelector(".hm-coins em");
    if (em) em.textContent = String(luck);
    const prev = this._hmPrev;
    hudMotion(this, root, { ...prev, hp: hp.value, hpPct: hp.pct, sta: sta.value, staPct: sta.pct, luck: medal.querySelector(".hm-coins") ? luck : null, popIn: null });
    return true;
  }

  static #timer = null;

  /** Перерисовать одним разом после пачки изменений (удар — это ПЗ, эффект состояния и смена хода). */
  static schedule(delay = 50) {
    clearTimeout(CombatHud.#timer);
    CombatHud.#timer = setTimeout(() => {
      CombatHud.#timer = null;
      CombatHud.refresh();
    }, delay);
  }

  static registerHooks() {
    const refresh = () => CombatHud.schedule();
    for (const hook of ["ready", "createCombat", "deleteCombat", "updateCombat", "createCombatant",
      "deleteCombatant", "updateCombatant", "controlToken", "createRegion", "deleteRegion"]) Hooks.on(hook, refresh);
    Hooks.on("updateActor", (doc, changes) => CombatHud.refreshFor(doc, changes));
    for (const hook of ["createItem", "updateItem", "deleteItem",
      "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) Hooks.on(hook, doc => CombatHud.refreshFor(doc));
    // Клавиши и щелчок мимо — на документе, один раз: список закрывается, гримуар слушает «/» и 1–5
    document.addEventListener("pointerdown", event => CombatHud.#instance?.#onOutside(event), true);
    document.addEventListener("keydown", event => CombatHud.#instance?.#onKey(event));
  }

  /** Актор, показанный в последней отрисовке. */
  actor = null;
  /** Открытый список: act, def, magic, alc, more — или ничего. Переживает перерисовки. */
  pop = null;
  /** Список только что открыт — проиграть появление (обычные перерисовки — без него). */
  popIn = false;
  /** Гримуар: вид, строка поиска, стихия и выбранное заклинание — живут, пока открыт клиент. */
  magicKind = "all";
  magicQuery = "";
  magicElement = "";
  magicSel = "";

  get collapsed() {
    return !!setting("combatHudCollapsed", false);
  }

  /** Худ живёт в нижней панели интерфейса, над макросами. */
  _insertElement(element) {
    const bottom = document.getElementById("ui-bottom");
    const hotbar = document.getElementById("hotbar");
    if (hotbar?.parentElement === bottom) bottom.insertBefore(element, hotbar);
    else if (bottom) bottom.prepend(element);
    else document.body.append(element);
    return element;
  }

  /* ------------------------------ Данные ------------------------------ */

  /** Ключ удара для гнезда: «вид:предмет». */
  static #attackKey(src) { return `attack:${src.kind}:${src.item?.id ?? ""}`; }

  async _prepareContext(options) {
    const actor = this.actor = CombatHud.actorFor();
    const context = await super._prepareContext(options);
    if (!actor) return context;
    const system = actor.system;
    const d = system.derived;
    const combat = game.combat?.started ? game.combat : null;
    const isCurrent = !!combat?.combatant && combat.combatant.actor === actor;
    const isCharacter = actor.type === "character";
    const frac = (v, m) => (m > 0 ? Math.max(0, Math.min(1, v / m)) : 0);
    const pct = (v, m) => +(100 * frac(v, m)).toFixed(2);

    // Медальон: дуги, насечка порога ранения, Энергия, Удача
    const hp = { value: system.hp.value, max: system.hp.max, pct: pct(system.hp.value, system.hp.max), hurt: system.hp.value < system.hp.max,
      bad: system.hp.value <= 0 };
    const sta = { value: system.sta.value, max: system.sta.max, pct: pct(system.sta.value, system.sta.max) };
    const woundA = 205 + 153 * frac(d.woundThreshold ?? 0, system.hp.max);
    const [w1x, w1y] = P(R_GROOVE - 7, woundA), [w2x, w2y] = P(R_GROOVE + 7, woundA);
    const wound = (d.woundThreshold ?? 0) > 0 ? { x1: w1x.toFixed(1), y1: w1y.toFixed(1), x2: w2x.toFixed(1), y2: w2y.toFixed(1) } : null;
    const vigor = d.vigor ?? 0;
    const used = vigor ? vigorUsed(actor).used : 0;
    const energy = vigor ? { left: Math.max(0, vigor - used), max: vigor, pct: pct(vigor - used, vigor) } : null;
    const luckMax = isCharacter ? system.luck?.max ?? 0 : 0, luckValue = system.luck?.value ?? 0;
    // Монеты в нижнем зазоре — пока их до пяти; больше — одна монета с числом
    const luck = luckMax ? (luckMax <= 5
      ? { coins: Array.from({ length: luckMax }, (_, k) => ({ on: k < luckValue, x: (k - (luckMax - 1) / 2) * 11 })), value: luckValue, max: luckMax }
      : { many: true, value: luckValue, max: luckMax }) : null;
    const tox = system.toxicity ? { value: system.toxicity.total, max: system.toxicity.max, pct: pct(system.toxicity.total, system.toxicity.max) } : null;

    // Удары: только то, что в руках (isReadyWeapon); два — в гнёздах, остальное — за «+N»
    const sources = attackSources(actor);
    const attack = src => {
      const oil = src.item?.system.activeOil?.name ?? "";
      return {
        key: CombatHud.#attackKey(src), type: "attack", kind: src.kind, itemId: src.item?.id ?? "", label: src.label, img: src.img,
        base: system.skills[src.skill].base + (src.accuracy || 0),
        damage: src.weapon.punch !== undefined ? `${src.weapon.punch} / ${src.weapon.kick}` : src.weapon.damage,
        verb: src.isRanged ? "выстрел" : "атака",
        tip: [src.label, SKILLS[src.skill]?.label, `урон ${src.weapon.punch !== undefined ? `${src.weapon.punch} / ${src.weapon.kick}` : src.weapon.damage}`,
          oil ? `масло: ${oil}` : "", src.isRanged ? `дистанция ${src.weapon.range}` : ""].filter(Boolean).join(" · ")
      };
    };
    const attacks = sources.map(attack);
    const spells = actor.itemTypes.spell;
    const resolve = key => {
      if (!key) return null;
      if (key.startsWith("spell:")) {
        const item = spells.find(i => i.id === key.slice(6));
        return item ? { key, type: "spell", itemId: item.id, label: item.name, img: item.img,
          base: item.system.variableCost ? "1+" : item.system.staCost ?? 0, tip: `${item.name} · ${item.system.staCost ?? 0} Вын`, spell: true } : null;
      }
      return attacks.find(a => a.key === key) ?? null;
    };
    const saved = actor.getFlag(SYSTEM_ID, "hudSockets") ?? [];
    const sockets = [0, 1].map(i => resolve(saved[i]) ?? null);
    // Пустое или пропавшее гнездо — первый удар, которого ещё нет в гнёздах
    for (const i of [0, 1]) {
      if (sockets[i]) continue;
      sockets[i] = attacks.find(a => !sockets.some(s => s?.key === a.key)) ?? null;
    }
    const more = attacks.filter(a => !sockets.some(s => s?.key === a.key));

    // Камешки: щит, поддержание, зоны, состояния и эффекты; что не влезло — «+N»
    const maintained = maintainedSpells(actor);
    const maintainedIds = new Set(maintained.map(e => e.id));
    const stoneList = [];
    if (system.shield?.value) stoneList.push({ kind: "steel", img: "icons/svg/shield.svg", num: system.shield.value, tip: `Щит — ${system.shield.value} ПЗ` });
    for (const e of maintained) stoneList.push({ kind: "arcane", img: e.img, key: `m:${e.id}`,
      tip: `${e.name.replace(/^Поддержание:\s*/, "")} · ${e.flags.vedmak.maintain.cost} Вын за раунд`, close: { action: "endMaintained", attr: "data-effect-id", id: e.id, tip: "Снять поддержание" } });
    for (const r of canvas?.scene?.regions ?? []) {
      const z = r.flags?.vedmak?.zone;
      if (z?.actorUuid !== actor.uuid) continue;
      const left = z.until && combat ? Math.max(0, z.until - combat.round) : null;
      stoneList.push({ kind: "arcane", img: "icons/svg/target.svg", key: `z:${r.id}`, tip: `Зона «${r.name}»${left !== null ? ` · ${left} р.` : z.maintain ? " · поддерживается" : ""}`,
        close: { action: "endZone", attr: "data-region-id", id: r.id, tip: "Убрать зону со сцены" } });
    }
    for (const e of actor.appliedEffects) {
      if (maintainedIds.has(e.id) || !(e.isTemporary || e.statuses.size)) continue;
      const status = [...e.statuses][0];
      const left = e.flags?.vedmak?.timed?.rounds ? `${e.flags.vedmak.timed.rounds} р.` : (e.isTemporary ? e.duration.label : "");
      stoneList.push({ kind: GOOD_STATUSES.includes(status) ? "good" : "bad", img: e.img, key: `e:${e.id}`, left,
        tip: `${e.name}${left ? ` — ${left}` : ""}${status && STATUS_HINTS[status] ? `<br>${STATUS_HINTS[status]}` : ""}`,
        close: status ? { action: "toggleStatus", attr: "data-status", id: status, tip: "Снять состояние" } : null });
    }
    const shown = stoneList.length > STONE_ANGLES.length ? STONE_ANGLES.length - 1 : stoneList.length;
    const stones = stoneList.slice(0, shown).map((s, i) => {
      const [x, y] = P(72, STONE_ANGLES[i]);
      return { ...s, x: x.toFixed(1), y: y.toFixed(1) };
    });
    const extraStones = stoneList.length - shown;
    const extraAt = extraStones > 0 ? (([x, y]) => ({ x: x.toFixed(1), y: y.toFixed(1) }))(P(72, STONE_ANGLES[shown])) : null;

    // Защита и испытания
    const defenses = HUD_DEFENSES.map(def => ({ ...def, base: system.skills[def.key]?.base ?? 0 }));
    const deathThreshold = (d.stun ?? 0) - (system.deathSaves?.penalty ?? 0);

    // Магия: виды, уровни, избранное (флаг актора), поиск и стихии — без перерисовки, в _onRender
    const favIds = actor.getFlag(SYSTEM_ID, "hudFavorites") ?? [];
    const staNow = system.sta?.value ?? 0, blood = system.blood?.value ?? 0;
    const spellRow = i => {
      const sy = i.system;
      const need = sy.variableCost ? 1 : sy.staCost ?? 0;
      // Вампирская магия платится ОК, при нехватке — Выносливостью
      const short = sy.kind === "vampire" ? (sy.resource === "sta" ? staNow < need : blood < need && staNow < need) : staNow < need;
      const element = sy.element || "mixed";
      const elementLabel = (sy.kind === "spell" || sy.kind === "sign") ? (CONFIG.VEDMAK.MAGIC_ELEMENTS?.[element] ?? "") : "";
      return {
        id: i.id, name: i.name, img: i.img, kind: sy.kind, element, need, short, fav: favIds.includes(i.id),
        cost: sy.variableCost ? "1+" : String(sy.staCost ?? 0), search: i.name.toLowerCase(),
        sub: [levelLabel(sy.kind, sy.level), elementLabel].filter(Boolean).join(" · "),
        range: sy.range ?? "", duration: sy.duration ?? "",
        resource: sy.kind === "vampire" ? (sy.resource === "sta" ? "Вын" : "ОК") : "Вын"
      };
    };
    const allSpells = spells.slice().sort((a, b) => compareRu(a.name, b.name)).map(spellRow);
    // Уровни: заголовок — вид и уровень; у заклинаний — ромбы по уровню
    const levelGroups = [];
    for (const kind of MAGIC_ORDER) for (const level of [...LEVEL_ORDER, ""]) {
      const rows = allSpells.filter(sp => sp.kind === kind && (spells.find(i => i.id === sp.id).system.level ?? "") === level);
      if (!rows.length) continue;
      const li = LEVEL_ORDER.indexOf(level);
      levelGroups.push({ kind, rows, label: `${MAGIC_GROUP_LABELS[kind] ?? kind}${level ? ` · ${levelLabel(kind, level)}` : ""}`,
        diamonds: kind === "spell" && li >= 0 ? "◆".repeat(li + 1) + "◇".repeat(Math.max(0, 2 - li)) : "" });
    }
    const favorites = favIds.map(id => allSpells.find(sp => sp.id === id)).filter(Boolean).slice(0, 5)
      .map((sp, n) => ({ ...sp, hotkey: n + 1 }));
    const magicKinds = [
      { id: "all", label: "Все", count: allSpells.length },
      ...(favorites.length ? [{ id: "fav", label: "★", count: favIds.filter(id => allSpells.some(sp => sp.id === id)).length }] : []),
      ...MAGIC_ORDER.filter(k => allSpells.some(sp => sp.kind === k)).map(k => ({ id: k, label: MAGIC_GROUP_LABELS[k], count: allSpells.filter(sp => sp.kind === k).length }))
    ];
    if (!magicKinds.some(k => k.id === this.magicKind)) this.magicKind = "all";
    for (const k of magicKinds) k.active = k.id === this.magicKind;
    const elements = ELEMENT_ORDER.filter(e => allSpells.some(sp => sp.element === e && (sp.kind === "spell" || sp.kind === "sign")))
      .map(e => ({ id: e, label: CONFIG.VEDMAK.MAGIC_ELEMENTS?.[e] ?? e }));

    // Алхимия: всё, чем можно воспользоваться сейчас, группами
    const flasks = (actor.itemTypes.alchemical ?? [])
      .filter(i => i.system.quantity > 0 && i.system.use?.action && !(i.system.isMutagen && i.system.applied) && !i.system.applied)
      .map(i => ({ id: i.id, name: i.name, img: i.img, quantity: i.system.quantity, action: i.system.use.action,
        verb: ALCH_VERB[i.system.use.action] ?? "применить", tox: i.system.toxicity || 0,
        tip: [i.name, i.system.toxicity ? `токсичность ${i.system.toxicity}%` : "", i.system.duration, i.system.effect].filter(Boolean).join(" · ") }));
    const alchemy = ALCH_GROUPS.map(g => ({ ...g, flasks: flasks.filter(f => g.actions.includes(f.action)) })).filter(g => g.flasks.length);
    // Масло на клинке — пометка на флаконе
    const oiled = new Set(actor.itemTypes.weapon.map(w => w.system.activeOil?.name).filter(Boolean));
    for (const g of alchemy) for (const f of g.flasks) f.onBlade = f.action === "oil" && oiled.has(f.name);

    // Действия
    const verbal = VERBAL_GROUPS.flatMap(g => g.actions).filter(a => VERBAL_QUICK.includes(a.key))
      .map(a => ({ key: a.key, label: a.label, base: system.skills?.[a.skill]?.base ?? 0 }));
    const quickSkills = ["awareness", "stealth"].map(key => ({ key, label: SKILLS[key].label.split("/")[0], base: system.skills?.[key]?.base ?? 0 }));
    const token = actor.token ?? canvas?.tokens?.controlled?.find(t => t.actor?.id === actor.id)?.document ?? null;
    const aim = aimBonus(actor, null);
    const leftOf = id => {
      const e = actor.appliedEffects.find(x => x.statuses.has(id) && (x.flags?.vedmak?.timed?.rounds || x.isTemporary));
      return e?.flags?.vedmak?.timed?.rounds ? `${e.flags.vedmak.timed.rounds}` : "";
    };
    const statusList = STATUS_EFFECTS.map(s => {
      const on = actor.statuses.has(s.id);
      return { id: s.id, name: s.name, img: s.img, on, good: on && GOOD_STATUSES.includes(s.id), left: on ? leftOf(s.id) : "", hint: STATUS_HINTS[s.id] ?? s.name };
    });

    const pops = { act: true, def: true, magic: allSpells.length > 0, alc: isCharacter || alchemy.length > 0, more: more.length > 0 };
    if (this.pop && !pops[this.pop]) this.pop = null;
    const volume = Number(setting("fxVolume", 0.7));

    return Object.assign(context, {
      actor, hp, sta, energy, luck, tox, wound, arcs: ARCS, ticks: TICKS,
      sockets, more, stones, extraStones, extraAt, defenses, stun: d.stun, deathThreshold, dying: d.dying,
      allSpells, levelGroups, favorites, magicKinds, elements, magicQuery: this.magicQuery, alchemy, flaskCount: flasks.reduce((n, f) => n + f.quantity, 0),
      verbal, quickSkills, statusList, rec: d.rec, aim, aimPips: [1, 2, 3].map(n => n <= aim),
      canFlip: !!token && token.isOwner && canFlip(token),
      // Высший вампир: Истинная форма одной кнопкой (превратиться / вернуть разум / выйти)
      trueForm: actor.system.race?.system.power?.("trueForm") ? (() => {
        const st = trueFormState(actor);
        if (!st.active) return { action: "go", label: "Истинная форма", hint: st.cooldown ? `Откат: ещё ${st.cooldown}` : st.blocked
          ? "Провал — до следующей сцены" : "Превращение: уровень + d10 против СЛ 16, 30 ОК", off: !!st.cooldown || st.blocked };
        if (st.frenzy) return { action: "regain", label: `Вернуть разум ${st.streak}/3`, hint: "Сопротивление Зверю СЛ 20, 3 успеха подряд", bad: true };
        return { action: "end", label: `Выйти из формы${st.rounds ? ` · ${st.rounds} р.` : ""}`, hint: "Shift — продлить на 1d6 раундов за 10 ОК" };
      })() : null,
      // Берсерк: медвежья форма одной кнопкой
      bearForm: isCharacter ? (() => {
        const st = bearFormState(actor);
        if (!st.available) return null;
        if (st.active) return { action: "end", label: `Снова человек${st.hours ? ` · ${st.hours} ч` : ""}`, hint: `Самоконтроль в бою — СЛ ${st.dc}. ПЗ при возврате вдвое меньше` };
        return { action: "go", label: "Медвежья форма", hint: st.mardrem ? `Съесть ${MARDREM} (есть ${st.mardrem})` : `Нет грибов «${MARDREM}»`, off: !st.mardrem };
      })() : null,
      // Школа Улитки: слизь Игни на руках (1 Вын)
      snailSlime: isSnail(actor) ? { on: !!igniSlime(actor) } : null,
      adrenalineRule: !!setting("adrenaline", false) && isCharacter,
      adrenaline: system.adrenaline?.value ?? 0,
      skillOptions: Object.entries(SKILLS).filter(([k]) => system.skills?.[k]).map(([, s]) => s.label),
      pops, pop: this.pop, popIn: this.popIn, collapsed: this.collapsed, isCurrent, isCharacter, inCombat: !!combat,
      canAdvance: !!combat && (isCurrent || game.user.isGM),
      volume, volPct: Math.round(volume * 100)
    });
  }

  /* ------------------------------ Отрисовка ------------------------------ */

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    // Класс на body вместо :has() в стилях: :has() перепроверялся при каждой правке внутри худа
    document.body.classList.add("vd-hud");
    document.body.classList.toggle("vd-hud-open", !this.collapsed);
    const justOpened = this.popIn ? this.pop : null;
    this.popIn = false;
    if (this.actor) hudMotion(this, root, {
      id: this.actor.id, hp: context.hp?.value, hpPct: context.hp?.pct, sta: context.sta?.value, staPct: context.sta?.pct,
      en: context.energy?.left ?? null, enPct: context.energy?.pct ?? null,
      luck: context.luck?.value ?? null, turn: !!(context.isCurrent && context.inCombat),
      stones: (context.stones ?? []).map(s => s.key).filter(Boolean), popIn: justOpened
    });
    // Двойной щелчок по портрету — лист персонажа
    root.querySelector(".hm-face")?.addEventListener("dblclick", () => this.actor?.sheet.render(true));
    bindVolumeSlider(root.querySelector(".hm-vol input"));
    this.#bindMagic(justOpened === "magic");
    this.#bindSkill();
    this.#bindAlchemy();
    this.#bindSockets();
  }

  /** Щелчок мимо худа закрывает список (но не по окнам, которые список открыл, — они поверх). */
  #onOutside(event) {
    if (!this.pop || !this.rendered) return;
    if (this.element.contains(event.target)) return;
    if (event.target.closest?.(".application, .dialog, #tooltip, .locked-tooltip, #context-menu")) return;
    this.#setPop(null);
  }

  /** Esc закрывает список; в открытом гримуаре «/» — к поиску, 1–5 — избранное. */
  #onKey(event) {
    if (!this.pop || !this.rendered) return;
    const typing = event.target.closest?.("input, textarea, [contenteditable]");
    if (event.key === "Escape" && !typing) { this.#setPop(null); return; }
    if (this.pop !== "magic" || typing || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === "/") {
      event.preventDefault();
      this.element.querySelector(".hm-grim .hm-find")?.focus();
      return;
    }
    const fav = this.element.querySelector(`.hm-fav[data-hotkey="${event.key}"]`);
    if (fav) {
      event.preventDefault();
      const item = this.actor?.items.get(fav.dataset.itemId);
      if (item) castSpell(this.actor, item, { skipDialog: event.shiftKey });
    }
  }

  #setPop(id) {
    this.pop = id;
    this.popIn = !!id;
    this.render();
  }

  /**
   * Гримуар: вид, поиск и стихия прячут строки без перерисовки (фокус остаётся в поле); стрелки двигают выбор,
   * Enter — сотворить, правый щелчок — в избранное. Карточка слева показывает выбранное.
   */
  #bindMagic(justOpened = false) {
    const grim = this.element.querySelector(".hm-grim");
    if (!grim) return;
    const input = grim.querySelector(".hm-find");
    const list = grim.querySelector(".hm-glist");
    const rows = [...grim.querySelectorAll(".hm-sp")];
    const groups = [...grim.querySelectorAll(".hm-lvl")];
    const els = [...grim.querySelectorAll(".hm-el")];
    const empty = grim.querySelector(".hm-gempty");
    const card = grim.querySelector(".hm-gcard");
    const left = Number(grim.dataset.energy ?? 0);
    const show = row => {
      for (const r of rows) r.classList.toggle("sel", r === row);
      if (!row) { card.hidden = true; return; }
      this.magicSel = row.dataset.itemId;
      const ds = row.dataset, need = Number(ds.need) || 0, over = grim.dataset.energy !== "" ? need - left : 0;
      card.hidden = false;
      card.querySelector("img").src = row.querySelector("img").src;
      card.querySelector(".hm-gn").textContent = ds.name;
      card.querySelector(".hm-gs").textContent = ds.sub;
      card.querySelector(".hm-gcost").textContent = `${ds.cost} ${ds.resource}`;
      const en = card.querySelector(".hm-gen");
      en.textContent = grim.dataset.energy === "" ? "—" : over > 0 ? `перегрузка на ${over}` : "хватает";
      en.classList.toggle("warn", over > 0);
      for (const [cls, val] of [["range", ds.range], ["dur", ds.duration]]) {
        card.querySelector(`.hm-g${cls}`).textContent = val || "—";
      }
    };
    const apply = () => {
      const q = this.magicQuery.trim().toLowerCase();
      const kind = this.magicKind, el = this.magicElement;
      let shownCount = 0;
      for (const r of rows) {
        const ok = (q ? r.dataset.search.includes(q) : kind === "all" || (kind === "fav" ? r.dataset.fav === "1" : r.dataset.kind === kind))
          && (!el || r.dataset.element === el);
        r.hidden = !ok;
        if (ok) shownCount++;
      }
      for (const g of groups) g.hidden = !g.querySelector(".hm-sp:not([hidden])");
      for (const b of els) b.classList.toggle("on", b.dataset.element === el);
      if (empty) empty.hidden = shownCount > 0;
      const sel = rows.find(r => !r.hidden && r.dataset.itemId === this.magicSel) ?? rows.find(r => !r.hidden);
      show(sel ?? null);
    };
    const visible = () => rows.filter(r => !r.hidden);
    input.value = this.magicQuery;
    input.addEventListener("input", () => { this.magicQuery = input.value; apply(); });
    input.addEventListener("keydown", event => {
      const v = visible(), i = v.findIndex(r => r.classList.contains("sel"));
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = v[Math.max(0, Math.min(v.length - 1, i + (event.key === "ArrowDown" ? 1 : -1)))];
        show(next);
        next?.scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter") {
        event.preventDefault();
        const item = v[i] && this.actor?.items.get(v[i].dataset.itemId);
        if (item) castSpell(this.actor, item, { skipDialog: event.shiftKey });
      } else if (event.key === "Escape" && input.value) {
        event.stopPropagation();
        input.value = ""; this.magicQuery = ""; apply();
      }
    });
    for (const b of els) b.addEventListener("click", () => { this.magicElement = this.magicElement === b.dataset.element ? "" : b.dataset.element; apply(); });
    list.addEventListener("pointerover", event => { const r = event.target.closest(".hm-sp"); if (r) show(r); });
    grim.addEventListener("contextmenu", event => {
      const r = event.target.closest(".hm-sp, .hm-fav");
      if (!r) return;
      event.preventDefault();
      this.#toggleFavorite(r.dataset.itemId);
    });
    apply();
    // Только что открытый гримуар сразу ловит ввод в поиск
    if (justOpened) input.focus({ preventScroll: true });
  }

  /** Навык по имени: Enter или выбор из подсказок — бросок. */
  #bindSkill() {
    const input = this.element.querySelector("input.hm-skill");
    if (!input) return;
    const roll = event => {
      const label = input.value.trim().toLowerCase();
      if (!label || !this.actor) return;
      const key = Object.entries(SKILLS).find(([, s]) => s.label.toLowerCase() === label)?.[0]
        ?? Object.entries(SKILLS).find(([, s]) => s.label.toLowerCase().startsWith(label))?.[0];
      if (!key || !this.actor.system.skills?.[key]) return ui.notifications.warn(`Навык «${input.value}» не найден.`);
      input.value = "";
      this.actor.rollSkill(key, { skipDialog: event.shiftKey });
    };
    input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); roll(event); } });
    // Выбор из подсказки (datalist) приходит событием input без набора с клавиатуры
    input.addEventListener("input", event => {
      const exact = Object.values(SKILLS).some(s => s.label.toLowerCase() === input.value.trim().toLowerCase());
      if (exact && (!event.inputType || event.inputType === "insertReplacementText")) roll(event);
    });
  }

  /** Наведение на флакон: полосы на трубке токсичности — сколько он добавит. */
  #bindAlchemy() {
    const pop = this.element.querySelector(".hm-pop.alc");
    const tube = pop?.querySelector(".hm-tube");
    if (!tube) return;
    const ghost = tube.querySelector(".ghost"), note = pop.querySelector(".hm-toxnote");
    const value = Number(tube.dataset.value), max = Number(tube.dataset.max) || 100;
    const base = note.textContent;
    pop.addEventListener("pointerover", event => {
      const f = event.target.closest(".hm-flask");
      const add = Number(f?.dataset.tox) || 0;
      ghost.hidden = !add;
      if (!add) { note.textContent = base; note.classList.remove("warn"); return; }
      ghost.style.left = `${Math.min(100, 100 * value / max)}%`;
      ghost.style.width = `${Math.max(0, Math.min(100, 100 * (value + add) / max) - Math.min(100, 100 * value / max))}%`;
      const after = value + add;
      note.textContent = `«${f.dataset.name}» добавит ${add}%: ${after > max ? "больше предела — отравление" : after === max ? "ровно предел" : `будет ${after}%`}`;
      note.classList.toggle("warn", after >= max);
    });
  }

  /** Перетаскивание в гнездо: удар из «+N» или заклинание из гримуара. */
  #bindSockets() {
    for (const src of this.element.querySelectorAll("[data-socket-key]")) {
      src.draggable = true;
      src.addEventListener("dragstart", event => {
        event.dataTransfer.setData("text/vedmak-socket", src.dataset.socketKey);
        event.dataTransfer.effectAllowed = "copy";
        this.element.classList.add("hm-dragging");
      });
      src.addEventListener("dragend", () => this.element.classList.remove("hm-dragging"));
    }
    for (const sock of this.element.querySelectorAll(".hm-sock")) {
      sock.addEventListener("dragover", event => {
        if (!event.dataTransfer.types.includes("text/vedmak-socket")) return;
        event.preventDefault();
        sock.classList.add("drop");
      });
      sock.addEventListener("dragleave", () => sock.classList.remove("drop"));
      sock.addEventListener("drop", async event => {
        const key = event.dataTransfer.getData("text/vedmak-socket");
        sock.classList.remove("drop");
        if (!key || !this.actor?.isOwner) return;
        event.preventDefault();
        const i = Number(sock.dataset.index);
        const keys = [...this.element.querySelectorAll(".hm-sock")].map(s => s.dataset.key ?? "");
        const other = keys.indexOf(key);
        if (other >= 0 && other !== i) keys[other] = keys[i];   // уже в другом гнезде — поменять местами
        keys[i] = key;
        await this.actor.setFlag(SYSTEM_ID, "hudSockets", keys);
      });
    }
  }

  /* ------------------------------ Действия ------------------------------ */

  static #onTogglePop(event, target) {
    const id = target.dataset.pop;
    if (this.collapsed && id) game.settings.set(SYSTEM_ID, "combatHudCollapsed", false);
    this.#setPop(this.pop === id ? null : id);
  }

  static async #onAttack(event, target) {
    await this.actor?.attack({ kind: target.dataset.kind, itemId: target.dataset.itemId || undefined }, { skipDialog: event.shiftKey });
  }

  /** Гнездо: удар или заклинание. */
  static async #onSocket(event, target) {
    if (!this.actor) return;
    if (target.dataset.type === "spell") {
      const item = this.actor.items.get(target.dataset.itemId);
      if (item) await castSpell(this.actor, item, { skipDialog: event.shiftKey });
      return;
    }
    await this.actor.attack({ kind: target.dataset.kind, itemId: target.dataset.itemId || undefined }, { skipDialog: event.shiftKey });
  }

  static async #onRollSkill(event, target) {
    await this.actor?.rollSkill(target.dataset.skill, { skipDialog: event.shiftKey });
  }

  static async #onCastSpell(event, target) {
    const item = this.actor?.items.get(target.dataset.itemId);
    if (item) await castSpell(this.actor, item, { skipDialog: event.shiftKey });
  }

  static async #onEndMaintained(event, target) {
    if (this.actor) await endMaintained(this.actor, target.dataset.effectId);
  }

  static async #onUseAlchemical(event, target) {
    const item = this.actor?.items.get(target.dataset.itemId);
    if (item) await useAlchemical(this.actor, item);
  }

  static async #onIgniSlime() {
    if (this.actor) return applyIgniSlime(this.actor);
  }

  /** Медвежья форма берсерка: обратиться (съесть мардрём) или вернуться в человеческий облик. */
  static async #onBearForm(event, target) {
    if (!this.actor) return;
    return target.dataset.form === "go" ? bearTransform(this.actor) : bearRevert(this.actor);
  }

  /** Истинная форма: превратиться, вернуть разум при срыве или выйти (Shift — продлить). */
  static async #onTrueForm(event, target) {
    const actor = this.actor;
    if (!actor) return;
    const what = target.dataset.form;
    if (what === "go") return transform(actor, { skipDialog: event.shiftKey });
    if (what === "regain") return regainControl(actor);
    return event.shiftKey ? extendForm(actor) : endForm(actor);
  }

  static async #onRestTurn() { if (this.actor) await restTurn(this.actor); }

  static async #onAimTurn() { if (this.actor) await aimTurn(this.actor); }

  static async #onManualDamage() { if (this.actor) await manualDamage([this.actor]); }

  static async #onControlCheck() { if (this.actor) await controlCheck(this.actor); }

  /** Таран: выбрать скакуна или транспорт, затем обычное окно атаки (как на листе). */
  static async #onRam() {
    if (!this.actor) return;
    const options = Object.entries(MOUNTS).map(([k, m]) => `<option value="${k}">${m.label} (${m.ram})</option>`).join("");
    const key = await foundry.applications.api.DialogV2.wait({
      window: { title: "Таран" }, classes: ["vedmak", "vedmak-dialog"],
      content: `<div class="vedmak-roll-dialog"><div class="form-group"><label>Чем таранить</label><select name="mount">${options}</select></div></div>`,
      buttons: [{ action: "ok", label: "Далее", default: true, callback: (e, b) => b.form.elements.mount.value },
        { action: "cancel", label: "Отмена" }],
      rejectClose: false
    });
    if (!key || key === "cancel") return;
    await this.actor.attack({ kind: "ram", key }, { chargeMeters: 10 });
  }

  static async #onFlipToken() {
    const token = this.actor?.token ?? canvas.tokens.controlled.find(t => t.actor?.id === this.actor?.id)?.document;
    if (token) await flipToken(token);
  }

  static async #onVerbal(event, target) {
    if (this.actor) await verbalAction(this.actor, target.dataset.verbal, { skipDialog: event.shiftKey });
  }

  static async #onStunSave() { await this.actor?.rollStunSave(); }

  static async #onDeathSave() { await this.actor?.rollDeathSave(); }

  static async #onToggleStatus(event, target) { await this.actor?.toggleStatusEffect(target.dataset.status); }

  static async #onNextTurn() { await game.combat?.nextTurn(); }

  /** Снять свою зону (у игрока — через ведущего, если область не его). */
  static async #onEndZone(event, target) {
    const region = canvas.scene?.regions.get(target.dataset.regionId);
    if (region) await removeZones([region]);
  }

  /** Вид магии в гримуаре: Все, Избранное, Знаки, Заклинания… — без перерисовки. */
  static #onMagicKind(event, target) {
    this.magicKind = target.dataset.kind;
    this.magicQuery = "";
    for (const k of this.element.querySelectorAll(".hm-kind")) k.classList.toggle("on", k === target);
    const input = this.element.querySelector(".hm-grim .hm-find");
    if (input) { input.value = ""; input.dispatchEvent(new Event("input")); }
  }

  /** Правый щелчок по заклинанию — в «Избранное» или из него (флаг актора, видно всем, кто им играет). */
  async #toggleFavorite(itemId) {
    const actor = this.actor;
    if (!actor?.isOwner || !itemId) return;
    const fav = actor.getFlag(SYSTEM_ID, "hudFavorites") ?? [];
    const next = fav.includes(itemId) ? fav.filter(id => id !== itemId) : [...fav, itemId];
    // Удалённые заклинания из списка вычищаются заодно
    await actor.setFlag(SYSTEM_ID, "hudFavorites", next.filter(id => actor.items.has(id)));
  }

  static async #onToggleCollapse() {
    await game.settings.set(SYSTEM_ID, "combatHudCollapsed", !this.collapsed);
    this.pop = null;
    this.render();
  }
}
