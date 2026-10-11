// Лист постройки (PLAN 4.198). Главное — производственная линия текущего уровня: сырьё → герб постройки → выработка
// (значками ресурсов с бросками), под ней — содержание и что постройка даёт поселению. Ниже — лестница уровней: каждая
// ступень — цена значками, срок, семьи; пройденные посеребрены, текущая выделена, следующая подсвечена. Ведущий правит
// ступень кнопкой «Править» — под лестницей раскрывается её чертёж (поля, цена, строки выработки); так же делаются свои
// типы сооружений. Облик — общий с листом поселения (styles/settlement.css), своё — раздел «Лист постройки».

import { BUILDING_GROUPS, PERIODS, RESOURCE_ICONS, fullRow, resourceIcon } from "../config/settlement.mjs";
import { buildingState, levelDef, WEALTH } from "../settlement/rules.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

const TABS = { overview: "Обзор", notes: "Описание" };
const LISTS = ["cost", "consume", "produce", "upkeep"];

/** Числовые поля ступени: ключ, подпись, подсказка. */
const LEVEL_FIELDS = [
  ["weeks", "Стройка, нед.", "Сколько недель строится ступень (одна семья без дела — неделя); 0 — сразу"],
  ["families", "Работают", "Сколько семей можно поставить работать"],
  ["housing", "Живут", "Сколько семей здесь живёт (дома)"],
  ["control", "Контроль", "Прибавка к Контролю поселения (каждый — −5% к шансу бунта)"],
  ["controlPerFamily", "Контроль / семья", "Прибавка к Контролю за каждую семью на работе (стража)"],
  ["drill", "Тренировка", "Скорость тренировки отрядов поселения (плац, казарма): 0 — здесь не тренируют"],
  ["taxes", "Налоги ×", "Без постройки с налогами (усадьба) налог не собрать: 1 — обычный, 1,5 — в полтора раза больше"],
  ["storage", "Склад +", "Прибавка к вместимости склада по каждому ресурсу"]
];

/** Строка выработки — значком: ресурс, бросок, кому, как часто, условия. */
function chip(r) {
  const notes = [];
  if (r.per === "family") notes.push("за семью");
  if (r.period !== "week") notes.push(PERIODS[r.period]?.toLowerCase());
  if (r.minFamilies) notes.push(`от ${r.minFamilies} сем.`);
  if (r.noWinter) notes.push("не зимой");
  return { img: resourceIcon(r.resource), name: r.resource, amount: r.same ? "столько же" : r.formula, notes: notes.join(" · ") };
}

/** Что ступень даёт поселению, кроме выработки, — клеймами. */
function tagsOf(lv, trade) {
  const out = [];
  if (!lv) return out;
  if (lv.housing) out.push({ label: "Жильё", value: `${lv.housing} сем.`, icon: "fa-house" });
  if (lv.control) out.push({ label: "Контроль", value: `+${lv.control}`, icon: "fa-shield-halved" });
  if (lv.controlPerFamily) out.push({ label: "Контроль", value: `+${lv.controlPerFamily} / сем.`, icon: "fa-shield-halved" });
  if (lv.storage) out.push({ label: "Склад", value: `+${lv.storage}`, icon: "fa-boxes-stacked" });
  if (lv.drill) out.push({ label: "Тренировка", value: `×${lv.drill}`, icon: "fa-person-rifle" });
  if (lv.taxes) out.push({ label: "Налоги", value: lv.taxes > 1 ? `×${lv.taxes}` : "собираются", icon: "fa-coins" });
  if (trade) out.push({ label: "Торговля", value: "купцы", icon: "fa-scale-balanced" });
  return out;
}

/** Чертёж ступени для правки: имена полей формы готовые, чтобы в шаблоне не было путей через ../. */
function blueprint(lv, i) {
  const rows = (list, arr) => arr.map((r, j) => {
    const p = `system.levels.${i}.${list}.${j}`;
    return { j, list, resource: { name: `${p}.resource`, value: r.resource }, formula: { name: `${p}.formula`, value: r.formula },
      per: { name: `${p}.per`, value: r.per }, period: { name: `${p}.period`, value: r.period },
      minFamilies: { name: `${p}.minFamilies`, value: r.minFamilies }, noWinter: { name: `${p}.noWinter`, value: r.noWinter },
      same: { name: `${p}.same`, value: r.same } };
  });
  return {
    index: i, n: i + 1,
    fields: LEVEL_FIELDS.map(([k, label, hint]) => ({ label, hint, name: `system.levels.${i}.${k}`, value: lv[k], step: k === "taxes" ? 0.5 : 1 })),
    cost: lv.cost.map((c, j) => ({ j, resource: { name: `system.levels.${i}.cost.${j}.resource`, value: c.resource },
      qty: { name: `system.levels.${i}.cost.${j}.qty`, value: c.qty } })),
    lists: [{ list: "consume", label: "Сырьё", hint: "Без него постройка работает частью", same: false, rows: rows("consume", lv.consume) },
      { list: "produce", label: "Выработка", hint: "Бросок — каждую неделю (или реже); за семью — на каждую семью на работе", same: true, rows: rows("produce", lv.produce) },
      { list: "upkeep", label: "Содержание", hint: "Что постройка съедает сама", same: false, rows: rows("upkeep", lv.upkeep) }]
  };
}

export class BuildingSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["vedmak", "sheet", "actor", "settlement", "building"],
    position: { width: 860, height: 820 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      buildingTab: BuildingSheet.#onTab,
      openActor: BuildingSheet.#onOpenActor,
      editLevel: BuildingSheet.#onEditLevel,
      blAdd: BuildingSheet.#onBlAdd,
      blDelete: BuildingSheet.#onBlDelete,
      blLevelAdd: BuildingSheet.#onBlLevelAdd,
      blLevelDelete: BuildingSheet.#onBlLevelDelete
    }
  };

  static PARTS = {
    body: { template: "systems/vedmak/templates/actor/building-sheet.hbs", scrollable: [".sv-scroll"] }
  };

  tab = "overview";
  /** Ступень, чертёж которой открыт (ведущий); null — ни одной. */
  editing = null;

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    const gm = game.user.isGM;
    const b = buildingState(actor);
    const town = sys.settlementActor;
    const workers = town?.system.summary.workers[actor.id] ?? sys.workers;
    // Линия — текущей ступени; пока не построена — первой («после постройки»)
    const shown = Math.max(1, b.level);
    const lv = levelDef(b, shown);
    const next = levelDef(b, b.level + 1);
    if (this.editing !== null && !b.levels[this.editing]) this.editing = null;
    const stock = town?.system.stockMap ?? {};
    const have = c => (c.resource === WEALTH ? town?.system.wealth ?? 0 : stock[c.resource] ?? 0) >= c.qty;

    const track = b.levels.map((l, i) => {
      const n = i + 1;
      const state = n <= b.level ? "done" : n === b.level + 1 ? "next" : "future";
      return {
        index: i, n, state, current: n === b.level, editing: this.editing === i,
        cost: l.cost.map(c => ({ img: resourceIcon(c.resource), name: c.resource, qty: c.qty, short: town && state === "next" && !have(c) })),
        weeks: l.weeks, families: l.families, housing: l.housing,
        produce: l.produce.map(r => ({ img: resourceIcon(r.resource), name: r.resource, amount: r.same ? "=" : r.formula })),
        tags: tagsOf(l, false).filter(t => t.label !== "Жильё").map(t => `${t.label} ${t.value}`).join(" · ")
      };
    });

    Object.assign(context, {
      actor, sys, systemFields: sys.schema.fields, gm, editable: this.isEditable, tab: this.tab,
      tabs: Object.entries(TABS).map(([id, label]) => ({ id, label, active: id === this.tab })),
      group: BUILDING_GROUPS[sys.group] ?? "", groups: BUILDING_GROUPS,
      town: town ? { uuid: town.uuid, name: town.name } : null,
      settlements: game.actors.filter(a => a.type === "settlement" && a.isOwner)
        .map(a => ({ uuid: a.uuid, name: a.name, selected: a.uuid === sys.settlement })),
      level: { value: b.level, max: b.levels.length, arc: b.levels.length ? Math.round((b.level / b.levels.length) * 360) : 0 },
      workers: { value: workers, max: lv && b.level ? lv.families : 0, slots: Array.from({ length: (b.level ? lv?.families : 0) ?? 0 }, (_, i) => i < workers) },
      build: b.constructing && next ? { n: b.level + 1, done: b.progress, weeks: next.weeks, pct: next.weeks ? Math.round((b.progress / next.weeks) * 100) : 0 } : null,
      flow: lv ? { built: b.level > 0, n: shown, consume: lv.consume.map(chip), produce: lv.produce.map(chip), upkeep: lv.upkeep.map(chip),
        tags: tagsOf(lv, b.trade) } : null,
      track, canDelete: b.levels.length > 1,
      edit: gm && this.editing !== null ? blueprint(b.levels[this.editing], this.editing) : null,
      perOptions: { building: "за постройку", family: "за семью" }, periodOptions: PERIODS,
      resourceNames: [...Object.keys(RESOURCE_ICONS), WEALTH], codePlaceholder: actor.name.toLowerCase(),
      enrichedDescription: await TextEditor.enrichHTML(sys.description, { relativeTo: actor, secrets: actor.isOwner })
    });
    return context;
  }

  /**
   * В форме — только открытая ступень: её поля ложатся поверх сохранённых уровней (иначе остальные стёрлись бы);
   * строки списков — поверх сохранённых строк по номеру.
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const v = data.system?.levels;
    if (!v || typeof v !== "object") return data;
    const levels = foundry.utils.deepClone(this.actor._source.system.levels ?? []);
    for (const [k, patch] of Object.entries(v)) {
      const lv = levels[Number(k)];
      if (!lv || !patch) continue;
      for (const [field, val] of Object.entries(patch)) {
        if (!LISTS.includes(field)) { lv[field] = val; continue; }
        const rows = lv[field] ?? [];
        for (const [j, row] of Object.entries(val ?? {})) rows[Number(j)] = { ...(rows[Number(j)] ?? {}), ...row };
        lv[field] = rows;
      }
    }
    data.system.levels = levels;
    return data;
  }

  static #onTab(event, target) { this.tab = target.dataset.tab; this.render(); }
  static async #onOpenActor(event, target) { (await fromUuid(target.dataset.uuid))?.sheet.render(true); }
  static #onEditLevel(event, target) {
    const i = Number(target.closest("[data-level]").dataset.level);
    this.editing = this.editing === i ? null : i;
    this.render();
  }

  /* Строки цены, сырья, выработки и содержания внутри ступени; ступени целиком */
  static async #onBlAdd(event, target) {
    const levels = foundry.utils.deepClone(this.actor._source.system.levels ?? []);
    const lv = levels[Number(target.dataset.level)];
    if (!lv) return;
    const list = target.dataset.list;
    (lv[list] ??= []).push(list === "cost" ? { resource: "", qty: 1 } : fullRow({ resource: "" }));
    await this.actor.update({ "system.levels": levels });
  }

  static async #onBlDelete(event, target) {
    const levels = foundry.utils.deepClone(this.actor._source.system.levels ?? []);
    levels[Number(target.dataset.level)]?.[target.dataset.list]?.splice(Number(target.dataset.index), 1);
    await this.actor.update({ "system.levels": levels });
  }

  static async #onBlLevelAdd() {
    const levels = foundry.utils.deepClone(this.actor._source.system.levels ?? []);
    // Новая ступень — копия последней: обычно улучшение меняет пару чисел
    levels.push(foundry.utils.deepClone(levels.at(-1) ?? {}));
    this.editing = levels.length - 1;
    await this.actor.update({ "system.levels": levels });
  }

  static async #onBlLevelDelete(event, target) {
    const levels = foundry.utils.deepClone(this.actor._source.system.levels ?? []);
    if (levels.length <= 1) return;
    levels.splice(Number(target.dataset.level), 1);
    this.editing = null;
    await this.actor.update({ "system.levels": levels });
  }
}
