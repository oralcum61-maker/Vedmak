// Худ персонажа (PLAN 4.58; облик «Медальон» — холст «Худ: новый облик», PLAN 4.123): пульт внизу экрана вместо панели
// макросов. Слева портрет в кольце дуг ПЗ и Вын, выступающий над худом, под ним числа, Энергия и Удача; в середине
// имя, вкладки «Бой», «Магия», «Алхимия», «Действия», «Состояния»; справа (в бою) — раунд, кто дальше и «Конец хода». В бою: игроку — его персонаж, мастеру — выделенный токен или тот, чей ход. Вне боя —
// актор выделенного своего токена (настройка клиента «Худ вне боя»): зелья и знаки нужны не только в бою.

import { SYSTEM_ID, compareRu } from "../util.mjs";
import { SKILLS } from "../config/skills.mjs";
import { STATUS_EFFECTS, STATUS_HINTS } from "../combat/statuses.mjs";
import { attackSources } from "../combat/attack.mjs";
import { manualDamage, restTurn } from "../combat/manual.mjs";
import { controlCheck } from "../combat/mounted.mjs";
import { MOUNTS } from "../config/combat.mjs";
import { verbalAction, VERBAL_GROUPS } from "../combat/verbal.mjs";
import { castSpell, vigorUsed, maintainedSpells } from "../magic/cast.mjs";
import { endMaintained } from "../magic/effects.mjs";
import { useAlchemical } from "../crafting/alchemy.mjs";
import { ALCHEMY_ACTIONS } from "../config/crafting.mjs";
import { flipToken, canFlip } from "./token-flip.mjs";
import { transform, extendForm, endForm, regainControl, trueFormState } from "../character/true-form.mjs";
import { animateVitals } from "../fx/sheet-motion.mjs";
import { bindVolumeSlider, volumeIcon } from "../fx/volume.mjs";
import { levelLabel } from "../config/magic.mjs";
import { removeZones } from "../combat/zones.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TABS = [
  { id: "fight", label: "Бой" }, { id: "magic", label: "Магия" }, { id: "alchemy", label: "Алхимия" },
  { id: "actions", label: "Действия" }, { id: "states", label: "Состояния" }
];
/** Цвет кнопки алхимии по действию: выпить и применить — фиолет, масло — зелень, бросок и ловушка — киноварь. */
const ALCH_GO = { drink: "violet", apply: "violet", mutagen: "violet", oil: "green", throw: "", trap: "" };
/** Словесные действия на худе — самые ходовые; остальные — на вкладке «Социальный бой» листа. */
const VERBAL_QUICK = ["persuade", "seduce", "deceive", "intimidate", "ignore", "changeSubject"];
// Защиты на вкладке «Бой» (стр. 151–153): что делает и каким навыком — так же, как в окне защиты (DEFENSE_TYPES)
const HUD_DEFENSES = [
  { key: "dodge", label: "Уклонение", sub: "от удара и выстрела", hint: "Уклонение/Изворотливость: уйти от удара или выстрела" },
  { key: "athletics", short: "Смена позиции", label: "Изменение позиции", sub: "Атлетика · ½ Скор", hint: "При успехе можно сместиться на ½ Скор" },
  { key: "brawling", label: "Блок рукой", sub: "Борьба · урон в руку", hint: "Удар приходится в подставленную руку, броня работает" },
  { key: "melee", short: "Блок оружием", label: "Блок и парирование", sub: "Ближний бой · парир. −3", hint: "Блок оружием тратит 1 надёжности; парирование −3, атакующий ошеломлён" }
];
/** Длина дуги шкалы медальона (радиус 70, 152°) и точка на ней по доле. */
const ARC = 185.7;
const arcPoint = (f, r) => {
  const a = (194 + 152 * Math.max(0, Math.min(1, f))) * Math.PI / 180;
  return [+(80 + r * Math.sin(a)).toFixed(1), +(80 - r * Math.cos(a)).toFixed(1)];
};
/** Глагол плитки алхимии: что сделает щелчок, и его цвет. */
const ALCH_VERB = { drink: ["выпить", "violet"], apply: ["применить", "violet"], mutagen: ["принять", "violet"], oil: ["нанести", "green"],
  throw: ["бросить", "red"], trap: ["поставить", "red"] };
/** Полезные состояния горят зелёным, остальные — красным. */
const GOOD_STATUSES = ["activeDodge", "invisible"];
/** Разделы магии в худе — порядок и короткие подписи. */
const MAGIC_ORDER = ["sign", "spell", "invocation", "ritual", "hex", "gift", "vampire"];
const MAGIC_GROUP_LABELS = { sign: "Знаки", spell: "Заклинания", invocation: "Инвокации", ritual: "Ритуалы", hex: "Порчи", gift: "Дары", vampire: "Вампирская" };

export class CombatHud extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "vedmak-combat-hud",
    classes: ["vedmak", "vedmak-hud"],
    window: { frame: false, positioned: false },
    actions: {
      openSheet: CombatHud.#onOpenSheet,
      setTab: CombatHud.#onSetTab,
      attack: CombatHud.#onAttack,
      rollSkill: CombatHud.#onRollSkill,
      castSpell: CombatHud.#onCastSpell,
      endMaintained: CombatHud.#onEndMaintained,
      useAlchemical: CombatHud.#onUseAlchemical,
      restTurn: CombatHud.#onRestTurn,
      trueForm: CombatHud.#onTrueForm,
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
      toggleVolume: CombatHud.#onToggleVolume,
      magicGroup: CombatHud.#onMagicGroup,
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

  /** Вкладка худа — одна на клиента, переживает перерисовки. */
  tab = "fight";

  /** Актор, чьи кнопки показывать. */
  static actorFor() {
    // Хранилище (сундук, повозка) — не боец: худа у него нет
    const first = canvas?.tokens?.controlled?.[0]?.actor ?? null;
    const controlled = first?.type === "loot" ? null : first;
    if (!game.combat?.started) {
      let outside = true;
      try { outside = game.settings.get(SYSTEM_ID, "hudOutOfCombat"); } catch { /* до регистрации */ }
      return outside && controlled?.isOwner ? controlled : null;
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
    let enabled = true;
    try { enabled = game.settings.get(SYSTEM_ID, "combatHud"); } catch { /* до регистрации настроек */ }
    const hud = CombatHud.instance;
    const actor = enabled ? CombatHud.actorFor() : null;
    if (!actor) {
      // Элемент живёт не в body, а в нижней панели: убираем его сами, чтобы полоса не осталась висеть
      const el = document.getElementById(CombatHud.DEFAULT_OPTIONS.id);
      // Без анимации: закрытие с ней ждёт кадров, а в фоновой вкладке их нет — полоса оставалась висеть
      if (hud.rendered) hud.close({ animate: false }).finally(() => el?.remove());
      else el?.remove();
      return;
    }
    hud.render({ force: true });
  }

  /**
   * Перерисовать, если изменился показанный сейчас актор, его предмет или эффект — и эффект на предмете:
   * у него родитель — предмет, а актор — родитель предмета, поэтому актор ищется вверх по родителям.
   */
  static refreshFor(doc) {
    let actor = doc;
    while (actor && actor.documentName !== "Actor") actor = actor.parent;
    if (!CombatHud.#instance?.rendered) return;
    if (!actor) return;
    if (CombatHud.#instance.actor && actor.id !== CombatHud.#instance.actor.id) return;
    CombatHud.schedule();
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
    for (const hook of ["updateActor", "createItem", "updateItem", "deleteItem",
      "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) Hooks.on(hook, doc => CombatHud.refreshFor(doc));
  }

  /** Актор, показанный в последней отрисовке. */
  actor = null;

  get collapsed() {
    try { return !!game.settings.get(SYSTEM_ID, "combatHudCollapsed"); } catch { return false; }
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

  /**
   * Вкладка магии: поиск по всем разделам сразу (прячет плитки, не перерисовывая худ — фокус остаётся в поле),
   * Enter — сотворить первое найденное, правый щелчок по плитке — «Избранное».
   */
  #bindMagic() {
    const deck = this.element.querySelector(".vh-magic");
    if (!deck || deck.dataset.bound) return;
    deck.dataset.bound = "1";
    const input = deck.querySelector("input.vh-magic-search");
    const rows = [...deck.querySelectorAll(".vh-spell")];
    const empty = deck.querySelector(".vh-magic-empty");
    const chips = [...deck.querySelectorAll(".vh-elc")];
    const apply = () => {
      const q = (this.magicQuery ?? "").trim().toLowerCase();
      const el = this.magicElement ?? "";
      // Пусто — свой раздел; набран текст — все разделы. Стихия — поверх; на кнопках стихий — сколько их в выборке
      const base = rows.filter(t => (q ? t.dataset.search.includes(q) : t.dataset.inGroup === "1"));
      let shown = 0;
      for (const t of rows) {
        const on = base.includes(t) && (!el || t.dataset.element === el);
        t.hidden = !on;
        t.classList.remove("first");
        if (on) shown++;
      }
      if (q) rows.find(t => !t.hidden)?.classList.add("first");
      // Имя, что не влезло в строку, — в две строки мельче (сначала все замеры, потом правки)
      const names = rows.filter(t => !t.hidden).map(t => t.querySelector(".n"));
      for (const n of names) n.classList.remove("long");
      for (const n of names.filter(n => n.scrollWidth > n.clientWidth + 1)) n.classList.add("long");
      for (const c of chips) {
        const n = base.filter(t => t.dataset.element === c.dataset.element).length;
        c.querySelector("b").textContent = String(n);
        c.classList.toggle("on", el === c.dataset.element);
        c.classList.toggle("none", !n);
      }
      deck.classList.toggle("searching", !!q);
      if (empty) empty.hidden = shown > 0;
    };
    input?.addEventListener("input", () => { this.magicQuery = input.value; apply(); });
    input?.addEventListener("keydown", event => {
      if (event.key === "Escape") { input.value = ""; this.magicQuery = ""; apply(); }
      if (event.key !== "Enter") return;
      event.preventDefault();
      const first = rows.find(t => !t.hidden);
      const item = first && this.actor?.items.get(first.dataset.itemId);
      if (item) castSpell(this.actor, item, { skipDialog: event.shiftKey });
    });
    for (const c of chips) c.addEventListener("click", () => {
      this.magicElement = this.magicElement === c.dataset.element ? "" : c.dataset.element;
      apply();
    });
    deck.addEventListener("contextmenu", event => {
      const tile = event.target.closest(".vh-spell");
      if (!tile) return;
      event.preventDefault();
      this.#toggleFavorite(tile.dataset.itemId);
    });
    apply();
  }

  /** Навык из поля поиска: Enter или выбор из подсказок — бросок. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    // Смена вкладки — колода проявляется; обычные перерисовки (ПЗ, ход) — без анимации, чтобы не мигало
    if (this.deckIn) {
      this.deckIn = false;
      this.element.querySelector(".vh-deck")?.classList.add("vh-in");
    }
    if (this.actor) animateVitals(this, this.element, this.actor.id);
    bindVolumeSlider(this.element.querySelector(".vh-volpop input"));
    this.#bindMagic();
    // Плитки ударов и флаконов (и столбцы действий в узком худе) листаются колесом; не всё влезло — край угасает
    for (const tiles of this.element.querySelectorAll(".vh-tiles, .vh-acts")) {
      const mark = () => tiles.classList.toggle("more", tiles.scrollLeft + tiles.clientWidth < tiles.scrollWidth - 2);
      tiles.addEventListener("wheel", event => {
        if (tiles.scrollWidth <= tiles.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
        event.preventDefault();
        tiles.scrollLeft += event.deltaY;
      }, { passive: false });
      tiles.addEventListener("scroll", mark, { passive: true });
      requestAnimationFrame(mark);
    }
    const input = this.element.querySelector("input.vh-skill");
    if (!input || input.dataset.bound) return;
    input.dataset.bound = "1";
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
    // Выбор из подсказки (datalist) приходит событием input без набора с клавиатуры; уход фокуса не бросает
    input.addEventListener("input", event => {
      const exact = Object.values(SKILLS).some(s => s.label.toLowerCase() === input.value.trim().toLowerCase());
      if (exact && (!event.inputType || event.inputType === "insertReplacementText")) roll(event);
    });
  }

  async _prepareContext(options) {
    const actor = this.actor = CombatHud.actorFor();
    const context = await super._prepareContext(options);
    if (!actor) return context;
    const system = actor.system;
    const d = system.derived;
    const combat = game.combat?.started ? game.combat : null;
    const isCurrent = !!combat?.combatant && combat.combatant.actor === actor;
    const pct = (v, m) => (m > 0 ? Math.max(0, Math.min(100, Math.round((v / m) * 100))) : 0);
    const isCharacter = actor.type === "character";

    const vitals = [
      { key: "hp", label: "пз", value: system.hp.value, max: system.hp.max, pct: pct(system.hp.value, system.hp.max),
        notch: pct(d.woundThreshold, system.hp.max), bad: system.hp.value <= 0, hint: `Порог ранения ${d.woundThreshold}` },
      { key: "sta", label: "вын", value: system.sta.value, max: system.sta.max, pct: pct(system.sta.value, system.sta.max),
        hint: `Отдых восстанавливает ${d.rec}` }
    ];
    if (system.toxicity) vitals.push({
      key: "tox", label: "токс", value: system.toxicity.total, max: system.toxicity.max, suffix: "%",
      pct: pct(system.toxicity.total, system.toxicity.max), hint: `Токсичность ${system.toxicity.total}% из ${system.toxicity.max}%`
    });
    // Медальон: дуги ПЗ (слева) и Вын (справа), насечка порога ранения на дуге ПЗ
    const frac = (v, m) => (m > 0 ? Math.max(0, Math.min(1, v / m)) : 0);
    const hpF = frac(system.hp.value, system.hp.max);
    const woundF = frac(d.woundThreshold, system.hp.max);
    const [w1x, w1y] = arcPoint(woundF, 63), [w2x, w2y] = arcPoint(woundF, 77);
    const medal = {
      hpArc: +(hpF * ARC).toFixed(1), staArc: +(frac(system.sta.value, system.sta.max) * ARC).toFixed(1),
      wound: { x1: w1x, y1: w1y, x2: w2x, y2: w2y }, hasWound: (d.woundThreshold ?? 0) > 0
    };
    const vigor = d.vigor ?? 0;
    const used = vigor ? vigorUsed(actor).used : 0;
    // Ячейки — пока их немного; у магов (Энергия 15–25) — числом «осталось из», иначе полоса вылезает из колонки
    const energy = vigor <= 6 ? Array.from({ length: vigor }, (_, k) => ({ on: k < Math.max(0, vigor - used) })) : [];
    const luck = isCharacter ? Array.from({ length: Math.min(system.luck?.max ?? 0, 12) }, (_, k) => ({ on: k < (system.luck?.value ?? 0) })) : [];

    // Бой: чем бить (только то, что в руках — см. isReadyWeapon), защиты, испытания
    // Строка удара: навык и основа, урон; масло — пометкой, полностью — в подсказке
    const attacks = attackSources(actor).map(src => {
      const oil = src.item?.system.activeOil?.name ?? "";
      return {
        kind: src.kind, itemId: src.item?.id ?? "", label: src.label, img: src.img,
        skill: SKILLS[src.skill]?.label.split("/")[0] ?? "",
        base: system.skills[src.skill].base + (src.accuracy || 0),
        damage: src.weapon.punch !== undefined ? `${src.weapon.punch} / ${src.weapon.kick}` : src.weapon.damage,
        note: oil ? "масло" : src.kind === "prosthetic" ? "протез" : "",
        tip: [SKILLS[src.skill]?.label, oil ? `масло: ${oil}` : "", src.isRanged ? `дистанция ${src.weapon.range}` : "",
          src.weapon.mods?.length ? `модификации: ${src.weapon.mods.join(", ")}` : ""].filter(Boolean).join(" · "),
        isRanged: !!src.isRanged
      };
    });
    const defenses = HUD_DEFENSES.map(def => ({ ...def, short: def.short ?? def.label, base: system.skills[def.key]?.base ?? 0 }));
    const quickSkills = ["awareness", "stealth"].map(key => ({ key, label: SKILLS[key].label.split("/")[0], base: system.skills[key]?.base ?? 0 }));
    const deathThreshold = (d.stun ?? 0) - (system.deathSaves?.penalty ?? 0);

    // Магия: разделы по видам, «Избранное» (флаг актора), плитки по алфавиту; поиск — в _onRender, без перерисовки
    const favIds = new Set(actor.getFlag(SYSTEM_ID, "hudFavorites") ?? []);
    const sta = system.sta?.value ?? 0;
    const blood = system.blood?.value ?? 0;
    const allSpells = actor.itemTypes.spell.slice().sort((a, b) => compareRu(a.name, b.name)).map(i => {
      const sy = i.system;
      const need = sy.variableCost ? 1 : sy.staCost ?? 0;
      // Вампирская магия платится ОК, при нехватке — Выносливостью
      const short = sy.kind === "vampire" ? (sy.resource === "sta" ? sta < need : blood < need && sta < need) : sta < need;
      return {
        id: i.id, name: i.name, img: i.img, kind: sy.kind, sign: sy.kind === "sign", element: sy.element || "mixed",
        fav: favIds.has(i.id), cost: sy.variableCost ? "1+" : String(sy.staCost ?? 0), short,
        search: i.name.toLowerCase(),
        tip: [CONFIG.VEDMAK.MAGIC_KINDS[sy.kind], sy.kind === "vampire" ? `${CONFIG.VEDMAK.MAGIC_BRANCHES[sy.branch]}, ${sy.staCost} ${sy.resource === "sta" ? "Вын" : "ОК"}` : "", levelLabel(sy.kind, sy.level), sy.kind === "spell" || sy.kind === "sign"
          ? CONFIG.VEDMAK.MAGIC_ELEMENTS[sy.element] : "", sy.range, sy.duration].filter(Boolean).join(" · ")
      };
    });
    const magicGroups = [
      ...(allSpells.length > 1 ? [{ id: "all", label: "Все" }] : []),
      ...(favIds.size ? [{ id: "fav", label: "Избранное", icon: "fa-solid fa-star" }] : []),
      ...MAGIC_ORDER.filter(k => allSpells.some(sp => sp.kind === k)).map(k => ({ id: k, label: MAGIC_GROUP_LABELS[k] }))
    ].map(g => ({ ...g, count: g.id === "all" ? allSpells.length : g.id === "fav" ? allSpells.filter(sp => sp.fav).length : allSpells.filter(sp => sp.kind === g.id).length }));
    if (!magicGroups.some(g => g.id === this.magicGroup)) this.magicGroup = magicGroups.find(g => g.id !== "all")?.id ?? "all";
    for (const g of magicGroups) g.active = g.id === this.magicGroup;
    // Рисуются все плитки (поиск идёт по всем разделам), свой раздел помечен
    for (const sp of allSpells) sp.inGroup = this.magicGroup === "all" ? true : this.magicGroup === "fav" ? sp.fav : sp.kind === this.magicGroup;
    // Кнопки стихий: какие есть у персонажа; числа и выбор пересчитывает #bindMagic
    const ELEMENT_ORDER = ["fire", "water", "air", "earth", "mixed"];
    const elementChips = ELEMENT_ORDER.filter(e => allSpells.some(sp => sp.element === e))
      .map(e => ({ id: e, label: CONFIG.VEDMAK.MAGIC_ELEMENTS?.[e] ?? e }));
    // Колонка и так подписана «держится» — приставку «Поддержание:» в ней не повторяем
    const maintained = maintainedSpells(actor).map(e => ({ id: e.id, name: e.name.replace(/^Поддержание:\s*/, ""), full: e.name, img: e.img,
      cost: e.flags.vedmak.maintain.cost }));
    // Зоны этого персонажа на открытой сцене — каждую можно снять
    const zones = (canvas?.scene?.regions ?? []).filter(r => r.flags?.vedmak?.zone?.actorUuid === actor.uuid).map(r => {
      const z = r.flags.vedmak.zone;
      const left = z.until && game.combat?.started ? Math.max(0, z.until - game.combat.round) : null;
      return { id: r.id, name: r.name, left: left !== null ? `${left} р.` : z.maintain ? "поддерживается" : "" };
    });

    // Алхимия: всё, чем можно воспользоваться сейчас
    const alchemy = (actor.itemTypes.alchemical ?? [])
      .filter(i => i.system.quantity > 0 && i.system.use?.action && !(i.system.isMutagen && i.system.applied) && !i.system.applied)
      .map(i => {
        const action = i.system.use.action;
        const [verb, verbCls] = ALCH_VERB[action] ?? ["применить", "violet"];
        return {
          id: i.id, name: i.name, img: i.img, quantity: i.system.quantity, verb, verbCls,
          tox: i.system.toxicity ? `${i.system.toxicity}%` : "",
          note: [i.system.toxicity ? `токс. ${i.system.toxicity}%` : "", i.system.duration].filter(Boolean).join(" · "),
          actionLabel: ALCHEMY_ACTIONS[action] ?? "Применить", go: ALCH_GO[action] ?? "violet",
          hint: i.system.effect ?? ""
        };
      });

    // Действия: словесная дуэль — ходовые атаки и защиты
    const verbal = VERBAL_GROUPS.flatMap(g => g.actions).filter(a => VERBAL_QUICK.includes(a.key))
      .map(a => ({ key: a.key, label: a.label, base: system.skills?.[a.skill]?.base ?? 0 }));
    const token = actor.token ?? canvas?.tokens?.controlled?.find(t => t.actor?.id === actor.id)?.document ?? null;

    // Состояния: что действует (эффекты со сроком и состояния) и сетка всех состояний
    const effects = actor.appliedEffects.filter(e => e.isTemporary || e.statuses.size).map(e => ({
      name: e.name, img: e.img,
      left: e.flags?.vedmak?.timed?.rounds ? `${e.flags.vedmak.timed.rounds} р.` : (e.isTemporary ? e.duration.label : ""),
      bad: [...e.statuses].some(s => ["bleeding", "poisoned", "burning", "dying", "staggered", "stunned"].includes(s))
    }));
    // Сетка состояний: включённые горят (полезные — зелёным), у срочных — сколько раундов осталось
    const leftOf = id => {
      const e = actor.appliedEffects.find(x => x.statuses.has(id) && (x.flags?.vedmak?.timed?.rounds || x.isTemporary));
      return e?.flags?.vedmak?.timed?.rounds ? `${e.flags.vedmak.timed.rounds} р.` : "";
    };
    const statusList = STATUS_EFFECTS.map(s => {
      const on = actor.statuses.has(s.id);
      return { id: s.id, name: s.name, img: s.img, on, good: on && GOOD_STATUSES.includes(s.id), bad: on && !GOOD_STATUSES.includes(s.id),
        left: on ? leftOf(s.id) : "", hint: STATUS_HINTS[s.id] ?? s.name };
    });
    // Значок в нижнем зазоре медальона: самое тревожное из того, что действует
    const badge = effects.find(e => e.bad) ?? effects[0] ?? null;

    const counts = { magic: allSpells.length, alchemy: alchemy.length, states: effects.length };
    const tabs = TABS.filter(t => !(t.id === "magic" && !allSpells.length && !maintained.length)
      && !(t.id === "alchemy" && !alchemy.length && !isCharacter))
      .map(t => ({ ...t, active: t.id === this.tab, count: counts[t.id] || "" }));
    if (!tabs.some(t => t.active)) { this.tab = "fight"; tabs[0].active = true; }

    // Кто дальше: как в Foundry — поверженных пропускаем, если так настроено в трекере
    const turns = combat?.turns ?? [];
    let next = null;
    for (let k = 1; combat && k <= turns.length; k++) {
      const c = turns[(combat.turn + k) % turns.length];
      if (c && !(combat.settings?.skipDefeated && c.isDefeated)) { next = c; break; }
    }
    return Object.assign(context, {
      actor, vitals, energy, luck, tabs, tab: this.tab, medal, badge,
      hp: vitals[0], sta: vitals[1], elementChips,
      statusChip: isCurrent ? "твой ход" : combat ? "ждёт хода" : "вне боя",
      energyMax: vigor, energyLeft: Math.max(0, vigor - used), tox: vitals.find(v => v.key === "tox") ?? null,
      showFight: this.tab === "fight", showMagic: this.tab === "magic", showAlchemy: this.tab === "alchemy",
      showActions: this.tab === "actions", showStates: this.tab === "states",
      attacks, defenses, quickSkills, stun: d.stun, deathThreshold, dying: d.dying,
      allSpells, magicGroups, magicQuery: this.magicQuery, maintained, zones, shield: system.shield?.value ?? 0,
      alchemy, verbal, canFlip: !!token && token.isOwner && canFlip(token), rec: d.rec,
      // Высший вампир: Истинная форма одной кнопкой (превратиться / вернуть разум / выйти)
      trueForm: actor.system.race?.system.power?.("trueForm") ? (() => {
        const st = trueFormState(actor);
        if (!st.active) return { action: "go", label: "Истинная форма", hint: st.cooldown ? `Откат: ещё ${st.cooldown}` : st.blocked
          ? "Провал — до следующей сцены" : "Превращение: уровень + d10 против СЛ 16, 30 ОК", off: !!st.cooldown || st.blocked };
        if (st.frenzy) return { action: "regain", label: `Вернуть разум ${st.streak}/3`, hint: "Сопротивление Зверю СЛ 20, 3 успеха подряд", bad: true };
        return { action: "end", label: `Выйти из формы${st.rounds ? ` · ${st.rounds} р.` : ""}`, hint: "Shift — продлить на 1d6 раундов за 10 ОК" };
      })() : null,
      adrenalineRule: (() => { try { return game.settings.get(SYSTEM_ID, "adrenaline") && isCharacter; } catch { return false; } })(),
      adrenaline: system.adrenaline?.value ?? 0,
      skillOptions: Object.entries(SKILLS).filter(([k]) => system.skills?.[k]).map(([, s]) => s.label),
      effects, statusList,
      collapsed: this.collapsed, isCurrent, isCharacter, inCombat: !!combat,
      round: combat?.round ?? 0, nextName: combat ? (next?.name ?? "—") : "",
      canAdvance: !!combat && (isCurrent || game.user.isGM),
      ...(() => {
        let volume = 0.7;
        try { volume = Number(game.settings.get(SYSTEM_ID, "fxVolume")); } catch { /* до регистрации */ }
        return { volume, volPct: Math.round(volume * 100), volIcon: volumeIcon(volume), volOpen: this.volOpen };
      })()
    });
  }

  /* ------------------------------ Действия ------------------------------ */

  static #onOpenSheet() { this.actor?.sheet.render(true); }

  static async #onSetTab(event, target) {
    this.tab = target.dataset.tab;
    this.deckIn = true;
    if (this.collapsed) await game.settings.set(SYSTEM_ID, "combatHudCollapsed", false);
    this.render();
  }

  static async #onAttack(event, target) {
    await this.actor?.attack({ kind: target.dataset.kind, itemId: target.dataset.itemId }, { skipDialog: event.shiftKey });
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

  /** Раздел магии: Избранное, Знаки, Заклинания… */
  static #onMagicGroup(event, target) {
    this.magicGroup = target.dataset.group;
    this.magicQuery = "";
    this.magicElement = "";
    this.deckIn = true;
    this.render();
  }

  /** Текущий раздел магии и строка поиска — живут, пока открыт клиент. */
  magicGroup = "";
  magicQuery = "";
  magicElement = "";

  /** Правый щелчок по плитке заклинания — в «Избранное» или из него (флаг актора, видно всем, кто им играет). */
  async #toggleFavorite(itemId) {
    const actor = this.actor;
    if (!actor?.isOwner || !itemId) return;
    const fav = new Set(actor.getFlag(SYSTEM_ID, "hudFavorites") ?? []);
    if (fav.has(itemId)) fav.delete(itemId);
    else fav.add(itemId);
    // Удалённые заклинания из списка вычищаются заодно
    await actor.setFlag(SYSTEM_ID, "hudFavorites", [...fav].filter(id => actor.items.has(id)));
  }

  /** Ползунок громкости под динамиком: открыть или спрятать. */
  static #onToggleVolume() {
    this.volOpen = !this.volOpen;
    this.render();
  }

  /** Ползунок громкости открыт. */
  volOpen = false;

  static async #onToggleCollapse() {
    await game.settings.set(SYSTEM_ID, "combatHudCollapsed", !this.collapsed);
    this.render();
  }
}
