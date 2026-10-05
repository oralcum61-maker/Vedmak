// Лист предмета: общая шапка, вкладка свойств по типу, описание, эффекты.

import { SKILLS } from "../config/skills.mjs";
import { STATS } from "../config/stats.mjs";
import { CRIT_LEVELS, CRIT_STATES, CRIT_WOUNDS, LOCATIONS_HUMANOID, LOCATIONS_MONSTER } from "../config/combat.mjs";
import { levelLabel, targetingFor, MAGIC_SKILL } from "../config/magic.mjs";
import { STATUS_EFFECTS } from "../combat/statuses.mjs";
import { RACES, ABILITY_MECHANICS, modTargets } from "../config/character.mjs";
import { SUBSTANCES } from "../config/crafting.mjs";
import { describeChanges } from "../config/effects.mjs";
import { markLockedActions, guardLockedActions } from "./view-only.mjs";
import { animateTab } from "../fx/sheet-motion.mjs";

/**
 * Ключи рас для выпадающих списков: корник (RACES) и все расы компендиумов (дополнения, фанатские книги).
 * Без них лист расы из книги сбрасывал бы её ключ, а лист профессии терял бы такие расы из «Разрешённых рас».
 */
let raceKeyCache = null;
// Своя раса, созданная или удалённая в мире, — в списках сразу, без перезагрузки
for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, item => { if (item.type === "race") raceKeyCache = null; });
async function raceKeyLabels() {
  if (raceKeyCache) return raceKeyCache;
  const out = Object.fromEntries(Object.entries(RACES).map(([k, v]) => [k, v.label]));
  for (const pack of game.packs.filter(p => p.documentName === "Item")) {
    const index = await pack.getIndex({ fields: ["system.key"] });
    for (const e of index) if (e.type === "race" && e.system?.key && !(e.system.key in out)) out[e.system.key] = e.name;
  }
  for (const i of game.items) if (i.type === "race" && i.system.key && !(i.system.key in out)) out[i.system.key] = i.name;
  return raceKeyCache = out;
}

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

/** Поля-массивы объектов, которые на форме идут как name="system.x.0.key". */
const OBJECT_ARRAYS = ["effects", "traits", "automation.statuses", "mods", "skillChoices", "branches", "components"];

/** Без права правки: что работает (вкладки, просмотр эффекта, в чат) и что видно, но не нажимается. */
const VIEW_ACTIONS = new Set(["tab", "effectEdit", "post"]);
const INERT_ACTIONS = new Set(["effectToggle", "editImage"]);

/** Новая пустая строка для массива. */
const ROW_TEMPLATES = {
  effects: { key: "bleeding", value: "" },
  traits: { name: "", effect: "" },
  mods: { target: "stats.ref", value: 1 },
  skillChoices: { label: "", count: 1, options: [] },
  components: { name: "", quantity: 1 },
  "automation.statuses": { status: "staggered", chance: "100" }
};

export class VedmakItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["vedmak", "sheet", "item"],
    position: { width: 560, height: 620 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      rowAdd: VedmakItemSheet.#onRowAdd,
      rowDelete: VedmakItemSheet.#onRowDelete,
      branchAdd: VedmakItemSheet.#onBranchAdd,
      branchDelete: VedmakItemSheet.#onBranchDelete,
      abilityAdd: VedmakItemSheet.#onAbilityAdd,
      abilityDelete: VedmakItemSheet.#onAbilityDelete,
      effectCreate: VedmakItemSheet.#onEffectCreate,
      effectEdit: VedmakItemSheet.#onEffectEdit,
      effectDelete: VedmakItemSheet.#onEffectDelete,
      effectToggle: VedmakItemSheet.#onEffectToggle,
      post: VedmakItemSheet.#onPost
    }
  };

  static PARTS = {
    header:      { template: "systems/vedmak/templates/item/header.hbs" },
    tabs:        { template: "templates/generic/tab-navigation.hbs" },
    details:     { template: "systems/vedmak/templates/item/details-weapon.hbs", scrollable: [""] },
    description: { template: "systems/vedmak/templates/item/description.hbs", scrollable: [""] },
    effects:     { template: "systems/vedmak/templates/item/effects.hbs", scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "details",     label: "Свойства" },
        { id: "description", label: "Описание" },
        { id: "effects",     label: "Эффекты" }
      ],
      initial: "details"
    }
  };

  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    parts.details.template = `systems/vedmak/templates/item/details-${this.item.type}.hbs`;
    return parts;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const system = item.system;
    const V = CONFIG.VEDMAK;
    Object.assign(context, {
      item, system,
      systemFields: system.schema.fields,
      editable: this.isEditable,
      config: V,
      typeLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
      headerSub: item.type === "weapon"
        ? [V.WEAPON_CATEGORIES[system.category], V.WEAPON_SKILLS[system.skill]].filter(Boolean).join(" · ").toLowerCase()
        : "",
      enrichedDescription: await TextEditor.enrichHTML(system.description ?? "", {
        secrets: item.isOwner, relativeTo: item
      }),
      physical: ["weapon", "armor", "gear"].includes(item.type),
      skillOptions: Object.fromEntries(Object.entries(SKILLS).map(([k, v]) => [k, v.label])),
      statOptions: Object.fromEntries(Object.entries(STATS).map(([k, v]) => [k, v.label]))
    });

    if (item.type === "race" || item.type === "profession") {
      context.raceKeyOptions = { "": "—", ...await raceKeyLabels() };
      // Свой ключ, которого нет ни в корнике, ни в компендиумах, тоже остаётся в списке
      for (const k of [system.key, ...(system.allowedRaces ?? [])]) {
        if (k && !(k in context.raceKeyOptions)) context.raceKeyOptions[k] = item.type === "race" ? item.name : k;
      }
    }
    if (["race", "weapon", "armor", "alchemical"].includes(item.type)) {
      context.modTargets = modTargets(STATS, SKILLS);
    }
    if (item.type === "component") {
      context.substanceOptions = { "": "—", ...Object.fromEntries(Object.entries(SUBSTANCES).map(([k, v]) => [k, v.label])) };
      context.substance = SUBSTANCES[system.substance] ?? null;
    }
    if (item.type === "recipe") {
      context.skillChoice = { crafting: SKILLS.crafting.label, alchemy: SKILLS.alchemy.label };
      context.resultTypes = Object.fromEntries(["weapon", "armor", "gear", "component", "alchemical", "enhancement"]
        .map(t => [t, game.i18n.localize(`TYPES.Item.${t}`)]));
      context.substanceRows = Object.entries(SUBSTANCES).map(([key, s]) => ({ key, ...s, value: system.substances[key] }));
    }
    if (item.type === "alchemical") {
      context.damageTypeOptions = Object.fromEntries(Object.entries(V.DAMAGE_TYPES).map(([k, v]) => [k, v.label]));
      context.statusOptions = Object.fromEntries(STATUS_EFFECTS.map(s => [s.id, s.name]));
      context.statusChoice = { "": "—", ...context.statusOptions };
      context.changesText = system.changes.length ? JSON.stringify(system.changes) : "";
    }
    if (item.type === "enhancement") {
      context.resistOptions = { slashing: "Режущему", piercing: "Колющему", bludgeoning: "Дробящему", elemental: "Стихийному (огню)",
        bleeding: "Кровотечению", poison: "Яду" };
      context.weaponEffectOptions = { "": "—", ...Object.fromEntries(Object.entries(V.WEAPON_EFFECTS).map(([k, v]) => [k, v.label])) };
    }
    if (item.type === "profession") {
      delete context.raceKeyOptions[""];
      context.abilityStatOptions = { "": "— (пассивная)", ...context.statOptions };
      context.mechanicOptions = Object.fromEntries(Object.entries(ABILITY_MECHANICS).map(([k, v]) => [k, v.label]));
      context.gearOptionsText = system.gearChoice.options.join("\n");
      context.gearFixedText = system.gearFixed.join("\n");
    }
    if (item.type === "armor") {
      context.locations = Object.entries(V.ARMOR_LOCATIONS).map(([key, label]) => ({
        key, label, ...system.sp[key]
      }));
      context.resistances = Object.entries({
        slashing: "Режущий", piercing: "Колющий", bludgeoning: "Дробящий",
        elemental: "Стихийный", bleeding: "Кровотечение", poison: "Отравление"
      }).map(([key, label]) => ({ key, label, checked: system.resistances[key] }));
    }
    if (item.type === "weapon") {
      context.damageTypeOptions = Object.fromEntries(Object.entries(V.DAMAGE_TYPES).map(([k, v]) => [k, v.label]));
      // Строка главных чисел (холст design/11): точность, урон с типами, надёжность насечками
      const rel = system.reliability ?? {};
      context.weaponKey = {
        accuracy: `${(system.accuracy ?? 0) > 0 ? "+" : ""}${system.accuracy ?? 0}`,
        damage: system.damage || "—",
        types: (system.damageTypes ?? []).map(t => V.DAMAGE_TYPES[t]?.label?.toLowerCase()).filter(Boolean).join(", "),
        relValue: rel.value ?? 0, relMax: rel.max ?? 0
      };
      // Строки — из исходных данных: эффекты модификаций арбалета добавляются при подготовке и в данные не пишутся
      context.weaponEffects = item._source.system.effects.map((e, i) => ({ ...e, index: i, hasParam: !!V.WEAPON_EFFECTS[e.key]?.param, paramHint: V.WEAPON_EFFECTS[e.key]?.param }));
    }
    if (item.type === "critWound") {
      context.woundGroups = Object.entries(CRIT_LEVELS).map(([level, cfg]) => ({
        label: cfg.label,
        wounds: Object.entries(CRIT_WOUNDS).filter(([, w]) => w.level === level)
          .map(([key, w]) => ({ key, label: w.label, selected: key === system.wound }))
      }));
      context.woundLocations = { ...Object.fromEntries(Object.entries(LOCATIONS_HUMANOID).map(([k, v]) => [k, v.label])),
        ...Object.fromEntries(Object.entries(LOCATIONS_MONSTER).map(([k, v]) => [k, v.label])) };
      context.critStates = CRIT_STATES;
      const cfg = system.config;
      const lvl = system.levelConfig;
      context.woundStates = cfg ? Object.entries(CRIT_STATES).map(([key, label]) => ({
        key, label, text: cfg.states[key].text, current: key === system.state
      })) : [];
      context.levelInfo = lvl ? { ...lvl } : null;
    }
    if (item.type === "spell") {
      const kind = system.kind;
      const levels = ["sign", "gift"].includes(kind) ? ["novice", "journeyman"]
        : kind === "invocation" ? ["novice", "journeyman", "master", "archPriest"] : ["novice", "journeyman", "master"];
      context.levelOptions = Object.fromEntries(levels.map(l => [l, levelLabel(kind, l)]));
      context.showElement = kind === "spell" || kind === "sign";
      // ветвь есть у инвокаций и у запретных школ «Тома Хаоса» — они бывают и заклинанием, и ритуалом
      context.showBranch = kind === "invocation" || kind === "vampire" || ["necromancy", "goetia"].includes(system.branch);
      context.isVampire = kind === "vampire";
      context.resourceOptions = { blood: "Очки Крови (при нехватке — Вын)", sta: "Только Выносливость" };
      context.showGod = system.level === "archPriest" || !!system.god;
      // у магического дара своя сложность сотворения («Том Хаоса», стр. 74)
      context.showCastDc = kind === "gift";
      context.maintainModes = { "": "Фиксированное", half: "½ вложенной Вын", full: "Вся вложенная Вын" };
      context.damageTypeOptions = Object.fromEntries(Object.entries(V.DAMAGE_TYPES).map(([k, v]) => [k, v.label]));
      context.locationOptions = { "": "Бросок d10", head: "Голова", torso: "Туловище", all: "Все части тела" };
      context.statusOptions = Object.fromEntries(STATUS_EFFECTS.map(s => [s.id, s.name]));
      context.statusRows = system.automation.statuses.map((row, index) => ({ ...row, index }));
      context.targetingLabel = { self: "на себя", area: "зона", direct: "прямое воздействие" }[targetingFor(system.range)];
      context.skillLabel = SKILLS[MAGIC_SKILL[kind] ?? "spellCasting"].label;
      context.checkLabel = kind === "vampire"
        ? `уровень базового навыка роли «${CONFIG.VEDMAK.MAGIC_BRANCHES[system.branch] ?? "—"}» + d10`
        : `Воля + ${context.skillLabel}`;
      context.byCost = Object.entries(system.automation.statusesByCost ?? {})
        .map(([cost, status]) => `${cost} Вын — ${CONFIG.statusEffects[status]?.name ?? status}`).join(", ");
    }
    context.effects = item.effects.map(e => ({
      id: e.id, name: e.name, img: e.img, disabled: e.disabled, transfer: e.transfer,
      changes: describeChanges(e.system?.changes)
    }));
    return context;
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (context.tabs?.[partId]) context.tab = context.tabs[partId];
    return context;
  }

  /** Без права правки (наблюдатель, компендиум): строки и эффекты не добавить и не удалить — кнопки спрятаны. */
  _onRender(context, options) {
    super._onRender(context, options);
    markLockedActions(this, { view: VIEW_ACTIONS, inert: INERT_ACTIONS });
  }

  /** Смена вкладки — новая проявляется (PLAN 4.67). */
  changeTab(tab, group, options = {}) {
    super.changeTab(tab, group, options);
    animateTab(this.element, group, tab);
  }

  _attachFrameListeners() {
    super._attachFrameListeners();
    guardLockedActions(this, VIEW_ACTIONS);
  }

  /** name="system.effects.0.key" → массив (и вложенные способности ветвей древа). */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const toArray = v => (v && !Array.isArray(v) && typeof v === "object"
      ? Object.keys(v).sort((a, b) => a - b).map(k => v[k]) : v);
    for (const key of OBJECT_ARRAYS) {
      const v = foundry.utils.getProperty(data.system ?? {}, key);
      if (v && !Array.isArray(v) && typeof v === "object") foundry.utils.setProperty(data.system, key, toArray(v));
    }
    if (Array.isArray(data.system?.branches)) {
      // Массив ветвей заменяется целиком: поля, которых нет в форме (таблицы и пояснения ветви из книги — `extra`),
      // берём из сохранённой ветви, иначе правка любого поля листа их стирала бы
      const saved = this.document._source.system?.branches ?? [];
      data.system.branches.forEach((b, i) => {
        if (!b) return;
        b.abilities = toArray(b.abilities) ?? [];
        for (const [k, v] of Object.entries(saved[i] ?? {})) if (!(k in b)) b[k] = foundry.utils.deepClone(v);
      });
    }
    // Изменения эффекта алхимии — JSON в текстовом поле
    if (typeof data.system?.changes === "string") {
      const text = data.system.changes.trim();
      try {
        data.system.changes = text ? JSON.parse(text) : [];
        if (!Array.isArray(data.system.changes)) throw new Error("нужен массив");
      } catch (err) {
        ui.notifications.warn(`Изменения эффекта: неверный JSON (${err.message}).`);
        delete data.system.changes;
      }
    }
    // Списки снаряжения — по строке на предмет
    const lines = v => String(v ?? "").split("\n").map(s => s.trim()).filter(Boolean);
    if (typeof data.system?.gearChoice?.options === "string") data.system.gearChoice.options = lines(data.system.gearChoice.options);
    if (typeof data.system?.gearFixed === "string") data.system.gearFixed = lines(data.system.gearFixed);
    return data;
  }

  /* ------------------------------ Действия ------------------------------ */

  static async #onRowAdd(event, target) {
    const field = target.dataset.field;
    const rows = foundry.utils.deepClone(foundry.utils.getProperty(this.item._source.system, field) ?? []);
    rows.push(foundry.utils.deepClone(ROW_TEMPLATES[field] ?? {}));
    await this.item.update({ [`system.${field}`]: rows });
  }

  static async #onRowDelete(event, target) {
    const field = target.dataset.field;
    const index = Number(target.closest("[data-index]").dataset.index);
    const rows = foundry.utils.deepClone(foundry.utils.getProperty(this.item._source.system, field) ?? []);
    rows.splice(index, 1);
    await this.item.update({ [`system.${field}`]: rows });
  }

  /* Древо профессии: массивы обновляются целиком */

  #branches() {
    return this.item.system.toObject().branches;
  }

  static async #onBranchAdd() {
    const branches = this.#branches();
    branches.push({ name: "Новая ветвь", abilities: [] });
    await this.item.update({ "system.branches": branches });
  }

  static async #onBranchDelete(event, target) {
    const branches = this.#branches();
    branches.splice(Number(target.closest("[data-branch]").dataset.branch), 1);
    await this.item.update({ "system.branches": branches });
  }

  static async #onAbilityAdd(event, target) {
    const branches = this.#branches();
    const b = branches[Number(target.closest("[data-branch]").dataset.branch)];
    b?.abilities.push({ name: "Новая способность", stat: "int", description: "", mechanic: "", value: 0 });
    await this.item.update({ "system.branches": branches });
  }

  static async #onAbilityDelete(event, target) {
    const branches = this.#branches();
    const b = branches[Number(target.closest("[data-branch]").dataset.branch)];
    b?.abilities.splice(Number(target.closest("[data-ability]").dataset.ability), 1);
    await this.item.update({ "system.branches": branches });
  }

  static async #onEffectCreate() {
    const [effect] = await this.item.createEmbeddedDocuments("ActiveEffect", [{
      name: this.item.name, img: this.item.img, transfer: true
    }]);
    effect?.sheet.render(true);
  }

  static #effect(target) {
    return this.item.effects.get(target.closest("[data-effect-id]")?.dataset.effectId);
  }

  static #onEffectEdit(event, target) {
    VedmakItemSheet.#effect.call(this, target)?.sheet.render(true);
  }

  static async #onEffectDelete(event, target) {
    await VedmakItemSheet.#effect.call(this, target)?.delete();
  }

  static async #onEffectToggle(event, target) {
    const e = VedmakItemSheet.#effect.call(this, target);
    if (e) await e.update({ disabled: !e.disabled });
  }

  static async #onPost() {
    await this.item.toChat();
  }
}
