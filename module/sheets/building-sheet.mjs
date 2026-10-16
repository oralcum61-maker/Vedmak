// Лист постройки (PLAN 4.198). Главное — производственная линия текущего уровня: сырьё → герб постройки → выработка
// (значками ресурсов с бросками), под ней — содержание и что постройка даёт поселению. Ниже — лестница уровней: каждая
// ступень — цена значками, срок, семьи; пройденные посеребрены, текущая выделена, следующая подсвечена. Ведущий правит
// ступень кнопкой «Править» — под лестницей раскрывается её чертёж (поля, цена, строки выработки); так же делаются свои
// типы сооружений. Вкладка «Обустройство» (кусок Б): ветки колонками, ступени цепочкой — взята, строится, доступна («Взять»),
// закрыта (почему); ведущий правит дерево на месте и выдаёт ступени даром. Облик — общий с листом поселения
// (styles/settlement.css), своё — раздел «Лист постройки».

import { BUILDING_GROUPS, PERIODS, fullRow, resourceIcon, resourceNames, managerSkillOf, managerDice, orderTypes, orderCost, ORDER_TYPES } from "../config/settlement.mjs";
import { SKILLS } from "../config/skills.mjs";
import { buildingState, levelDef, WEALTH } from "../settlement/rules.mjs";
import { BUILDING_EFFECTS, effectDice } from "../config/building-upgrades.mjs";
import * as S from "../settlement/settlement.mjs";
import { patchFormArrays, treeAdd, treeDel } from "./upgrade-tree.mjs";
import { animateRealm } from "../fx/realm-fx.mjs";
import { once } from "../util.mjs";
import { realmPrompt } from "../apps/realm-dialog.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

const TABS = { overview: "Обзор", tree: "Обустройство", notes: "Описание" };

/** Числовые поля ступени: ключ, подпись, подсказка. */
const LEVEL_FIELDS = [
  ["weeks", "Стройка, нед.", "Сколько недель строится ступень (одна семья без дела — неделя); 0 — сразу"],
  ["families", "Работают", "Сколько семей можно поставить работать"],
  ["housing", "Живут", "Сколько семей здесь живёт (дома)"],
  ["control", "Контроль", "Прибавка к Контролю поселения (каждый — −5% к шансу бунта)"],
  ["controlPerFamily", "Контроль / семья", "Прибавка к Контролю за каждую семью на работе (стража)"],
  ["drill", "Тренировка", "Скорость тренировки отрядов поселения (плац, казарма): 0 — здесь не тренируют"],
  ["taxes", "Налоги ×", "Без постройки с налогами (усадьба) налог не собрать: 1 — обычный, 1,5 — в полтора раза больше"],
  ["storage", "Склад +", "Прибавка к вместимости склада по каждому ресурсу"],
  ["defense", "Укрепления", "Прибавка защитникам в битве у стен поселения"]
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
  if (lv.defense) out.push({ label: "Укрепления", value: `+${lv.defense}`, icon: "fa-chess-rook" });
  if (lv.drill) out.push({ label: "Тренировка", value: `×${lv.drill}`, icon: "fa-person-rifle" });
  if (lv.taxes) out.push({ label: "Налоги", value: lv.taxes > 1 ? `×${lv.taxes}` : "собираются", icon: "fa-coins" });
  if (trade) out.push({ label: "Торговля", value: "купцы", icon: "fa-scale-balanced" });
  return out;
}

/** Эффект ступени подписью: «+1d3 древесины за уровень», «Топливо 1d2 за семью», «−1d6 к шансу бунта за уровень». */
export function effectLabel(e) {
  const res = String(e.resource ?? "").trim().toLowerCase();
  const v = Number(e.value) || 0;
  switch (e.type) {
    case "produce": return `+${effectDice(e)} ${res ? `выработки: ${res}` : "к каждой выработке"} за уровень`;
    case "produceAdd": return `${e.resource || "?"} ${e.formula}${e.per === "family" ? " за семью" : ""}${e.period !== "week" ? ` ${PERIODS[e.period]?.toLowerCase() ?? ""}` : ""}`;
    case "consume": return `−${effectDice(e)} сырья${res ? `: ${res}` : ""} за уровень`;
    case "upkeep": return `−${effectDice(e)} содержания${res ? `: ${res}` : ""} за уровень`;
    case "families": return `+${v} рабочих мест`;
    case "housing": return `+${v} жилья`;
    case "control": return `Контроль +${v}`;
    case "storage": return `склад +${v}`;
    case "drill": return `тренировка +${v}`;
    case "taxes": return `налог +${v}`;
    case "approval": return `+${v} одобрения в месяц`;
    case "revolt": return `−${effectDice(e)} к шансу бунта за уровень`;
    case "arrival": return `+${effectDice(e)} к шансу прихода семей за уровень`;
    case "trade": return "торговля";
    case "defense": return `укрепления +${v}`;
    default: return `${BUILDING_EFFECTS[e.type]?.label ?? e.type} ${v}`;
  }
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
      research: BuildingSheet.#onResearch,
      cancelResearch: BuildingSheet.#onCancelResearch,
      grant: BuildingSheet.#onGrant,
      treeEdit: BuildingSheet.#onTreeEdit,
      treeAdd: BuildingSheet.#onTreeAdd,
      treeDel: BuildingSheet.#onTreeDel,
      openActor: BuildingSheet.#onOpenActor,
      clearManager: BuildingSheet.#onClearManager,
      cancelOrder: BuildingSheet.#onCancelOrder,
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
  /** Правка дерева обустройства (ведущий). */
  treeEdit = false;

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
      resourceNames: [...resourceNames(), WEALTH], codePlaceholder: actor.name.toLowerCase(),
      manager: this.#manager(lv),
      orders: this.#orders(),
      tree: this.#tree(town, stock, have), treeEdit: gm && this.treeEdit,
      effectTypes: Object.fromEntries(Object.entries(BUILDING_EFFECTS).map(([k, v]) => [k, v.label])),
      enrichedDescription: await TextEditor.enrichHTML(sys.description, { relativeTo: actor, secrets: actor.isOwner })
    });
    return context;
  }

  /** Управляющий: кто, навык, бонус (1d4 за 3 очка навыка к главной выработке; без выработки — Контроль). */
  #manager(lv) {
    const sys = this.actor.system;
    const skill = managerSkillOf(sys.key, sys.group, sys.managerSkill);
    const who = sys.managerActor;
    const value = who?.system.skills?.[skill]?.total ?? 0;
    const main = lv?.produce?.[0]?.resource;
    const dice = managerDice(value);
    return {
      who: who ? { uuid: who.uuid, name: who.name, img: who.img } : null, skill, skillLabel: SKILLS[skill]?.label ?? skill, value,
      bonus: !who ? "" : main ? (dice ? `+${dice}d4 к «${main}» в неделю` : "навык 0 — бонуса нет") : `Контроль +${Math.floor(value / 4)}`,
      skills: Object.fromEntries(Object.entries(SKILLS).map(([k, v]) => [k, v.label])), override: sys.managerSkill
    };
  }

  /** Заказы мастерской: что берёт, очередь с прогрессом. */
  #orders() {
    const sys = this.actor.system;
    const types = orderTypes(sys.key, sys.group);
    if (!types.length) return null;
    return {
      types: types.map(t => ORDER_TYPES[t]).join(", "),
      list: sys.orders.map((o, i) => ({ ...o, first: !i, pct: Math.round((o.progress / o.weeks) * 100),
        cost: o.cost.map(c => `${c.resource} ${c.qty}`).join(", ") }))
    };
  }

  /** Перетащенный предмет — заказ мастерской: для кого и сколько; цена — со склада поселения. */
  async _onDropItem(event, item) {
    const town = this.actor.system.settlementActor;
    if (!town?.isOwner) return null;
    const types = orderTypes(this.actor.system.key, this.actor.system.group);
    if (!types.includes(item.type)) { ui.notifications.warn(`«${this.actor.name}» не делает такого.`); return null; }
    const heroes = game.actors.filter(a => a.type === "character" && a.isOwner);
    const mine = game.user.character?.id ?? item.parent?.id;
    const { cost, weeks } = orderCost(item.type, item.system.cost, 1, item.name);
    const data = await realmPrompt("order", { title: `Заказ: ${item.name}`, okLabel: "Заказать",
      data: { heroes: heroes.map(a => ({ uuid: a.uuid, name: a.name, selected: a.id === mine })), town: town.name, weeks,
        cost: cost.map(c => `${c.resource} ${c.qty}`).join(", ") },
      read: form => Object.fromEntries(new FormData(form)) });
    if (!data) return null;
    return game.vedmak.settlement.placeOrder(town, this.actor.id, item, fromUuidSync(data.for), data.qty);
  }

  /** Перетащенный персонаж — управляющий постройки. */
  async _onDropActor(event, actor) {
    if (!this.isEditable) return null;
    if (actor.type !== "character") { ui.notifications.warn("Управляющим может быть только персонаж."); return null; }
    await this.actor.update({ "system.manager": actor.uuid });
    return actor;
  }

  /** Ветки обустройства: ступени с состоянием, ценой значками, эффектами подписью; для правки — пути полей. */
  #tree(town, stock, have) {
    const actor = this.actor;
    const sys = actor.system;
    const all = sys.branches.flatMap(br => br.nodes);
    return sys.branches.map((br, bi) => {
      const path = `system.branches.${bi}`;
      const nodes = br.nodes.map((nd, ni) => {
        const bought = sys.upgrades.includes(nd.id);
        const working = sys.research.node === nd.id;
        const check = bought || working ? null : S.canResearch(town, actor, nd.id);
        const npath = `${path}.nodes.${ni}`;
        return {
          index: ni, id: nd.id, name: nd.name, description: nd.description, level: nd.level, weeks: nd.weeks, path: npath,
          state: bought ? "bought" : working ? "working" : check?.ok ? "open" : "locked", why: check?.ok ? "" : check?.why ?? "",
          progress: working ? { done: sys.research.progress, weeks: nd.weeks, pct: nd.weeks ? Math.round((sys.research.progress / nd.weeks) * 100) : 0 } : null,
          requires: nd.requires ? all.find(x => x.id === nd.requires)?.name ?? "" : "",
          cost: nd.cost.map((c, ci) => ({ index: ci, path: `${npath}.cost.${ci}`, resource: c.resource, qty: c.qty, img: resourceIcon(c.resource),
            short: town && !bought && !working && !have(c) })),
          effects: nd.effects.map((e, ei) => ({ index: ei, path: `${npath}.effects.${ei}`, ...e, label: effectLabel(e),
            row: e.type === "produceAdd", dice: BUILDING_EFFECTS[e.type]?.kind === "dice", res: !!BUILDING_EFFECTS[e.type]?.resource,
            diceFormula: effectDice(e) }))
        };
      });
      return { index: bi, id: br.id, name: br.name, icon: br.icon, path, nodes,
        done: nodes.filter(x => x.state === "bought").length, total: nodes.length };
    });
  }

  /**
   * В форме — только открытая ступень: её поля ложатся поверх сохранённых уровней (иначе остальные стёрлись бы);
   * строки списков — поверх сохранённых строк по номеру.
   */
  _processFormData(event, form, formData) {
    return patchFormArrays(super._processFormData(event, form, formData), this.actor._source.system, ["levels", "branches"]);
  }

  /* ------------------------------ Обустройство ------------------------------ */

  static async #onResearch(event, target) {
    const town = this.actor.system.settlementActor;
    if (town) await once(this.actor, "research", () => S.research(town, this.actor.id, target.closest("[data-node]").dataset.node));
  }
  static async #onCancelResearch() {
    const town = this.actor.system.settlementActor;
    if (town) await S.cancelResearch(town, this.actor.id);
  }
  /** Ведущий: выдать ступень даром или забрать. */
  static async #onGrant(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-node]").dataset.node;
    const ups = new Set(this.actor.system.upgrades);
    if (ups.has(id)) ups.delete(id); else ups.add(id);
    const update = { "system.upgrades": [...ups] };
    if (this.actor.system.research.node === id) update["system.research"] = { node: "", progress: 0 };
    await this.actor.update(update);
  }
  static #onTreeEdit() { this.treeEdit = !this.treeEdit; this.render(); }

  /** Ведущий: добавить ветку, ступень, эффект или ресурс цены (data-kind, data-path — путь к массиву: «system.branches.0.nodes»). */
  static async #onTreeAdd(event, target) {
    const sys = foundry.utils.deepClone(this.actor._source.system);
    treeAdd(sys, target.dataset.kind, target.dataset.path, {
      node: () => ({ name: "Новая ступень", description: "", level: 1, weeks: 1, cost: [], effects: [] }),
      effect: () => ({ type: "produce", resource: "", value: 0, formula: "1d4", per: "building", period: "week" })
    });
    await this.actor.update({ "system.branches": sys.branches });
  }

  /** Ведущий: убрать ветку, ступень, эффект или ресурс цены (data-path — путь к массиву, data-index). */
  static async #onTreeDel(event, target) {
    const sys = foundry.utils.deepClone(this.actor._source.system);
    treeDel(sys, target.dataset.path, target.dataset.index);
    await this.actor.update({ "system.branches": sys.branches, "system.upgrades": sys.upgrades, "system.research": sys.research });
  }

  static #onTab(event, target) { this.tab = target.dataset.tab; this.render(); }

  /** Движение, как у листа персонажа (PLAN 4.212): вкладка проявляется, числа и шкалы — перетекают и вспыхивают. */
  _onRender(context, options) {
    super._onRender(context, options);
    animateRealm(this, this.element, this.actor.uuid, this.tab);
  }
  static async #onClearManager() { await this.actor.update({ "system.manager": "" }); }
  static async #onCancelOrder(event, target) {
    const town = this.actor.system.settlementActor;
    if (town) await game.vedmak.settlement.cancelOrder(town, this.actor.id, target.closest("[data-order]").dataset.order);
  }
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
