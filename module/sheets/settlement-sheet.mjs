// Лист поселения (PLAN 4.183, 4.185) по журналу мира manorlords: шапка — герб, месяц и неделя; пластины — семьи,
// одобрение 0–10 (шансы прихода семей и бунта), казна в Богатстве, налог, Ополчение и Контроль; вкладки «Хозяйство»
// (склад с вместимостью и прогнозом недели, торговля, нужды, конец месяца), «Постройки» (карточки с уровнями, семьями
// на работе, стройкой; каталог), «Летопись» и «Описание». Владелец строит, ставит семьи, налог и торгует; ведущий ещё
// двигает неделю и правит числа. Постройки — актёры (PLAN 4.198): карточка открывает лист постройки.

import { BUILDINGS, BUILDING_GROUPS, PERIODS, WEALTH_RATE, APPROVAL_MAX, WEEKS_PER_MONTH, RESOURCE_ORDER, TAXES, BUY_MARKUP, MONTHS,
  resourceIcon, buildingItemData, priceOf } from "../config/settlement.mjs";
import { buildingState, levelDef, averageOf, WEALTH } from "../settlement/rules.mjs";
import * as S from "../settlement/settlement.mjs";
import { worldCurrency } from "../config/money.mjs";
import { compareRu } from "../util.mjs";
import { UNIT_KINDS, TRAINING, EQUIPMENT, ORIGINS, FAMILY_SOLDIERS, MERCENARY } from "../config/army.mjs";
import * as ARMY from "../army/army.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

const TABS = { economy: "Хозяйство", buildings: "Постройки", army: "Войско", chronicle: "Летопись", notes: "Описание" };
const fmt = n => (Math.round(n * 100) / 100).toLocaleString("ru-RU");
const signed = n => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));
const plain = html => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Строка выработки подписью: «Древесина 1d6+3», «Древесина 1d6 за семью», «раз в два месяца», «кроме зимы». */
export function rowLabel(r) {
  const bits = [`${r.resource} ${r.same ? "столько же" : r.formula}`];
  if (r.per === "family") bits.push("за семью");
  if (r.period !== "week") bits.push(PERIODS[r.period]);
  if (r.minFamilies) bits.push(`от ${r.minFamilies} сем.`);
  if (r.noWinter) bits.push("кроме зимы");
  return bits.join(" ");
}

export class SettlementSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["vedmak", "sheet", "actor", "settlement"],
    position: { width: 900, height: 860 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      // Не «tab»: это имя ядро ApplicationV2 забирает себе (_onClickTab → changeTab с обязательной data-group)
      settlementTab: SettlementSheet.#onTab,
      week: SettlementSheet.#onWeek,
      build: SettlementSheet.#onBuild,
      upgrade: SettlementSheet.#onUpgrade,
      demolish: SettlementSheet.#onDemolish,
      workers: SettlementSheet.#onWorkers,
      wealth: SettlementSheet.#onWealth,
      trade: SettlementSheet.#onTrade,
      catalog: SettlementSheet.#onCatalog,
      editBuilding: SettlementSheet.#onEditBuilding,
      approval: SettlementSheet.#onApproval,
      addResource: SettlementSheet.#onAddResource,
      removeResource: SettlementSheet.#onRemoveResource,
      recruit: SettlementSheet.#onRecruit,
      unitDrill: SettlementSheet.#onUnitDrill,
      openUnit: SettlementSheet.#onOpenUnit,
      battle: SettlementSheet.#onBattle
    }
  };

  static PARTS = {
    body: { template: "systems/vedmak/templates/actor/settlement-sheet.hbs", scrollable: [".sv-scroll"] }
  };

  tab = "economy";
  showCatalog = false;
  tradeQty = 5;

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    const sum = sys.summary;
    const fc = sys.forecast;
    const cal = sys.calendar;
    const gm = game.user.isGM;
    const editable = this.isEditable;
    const cur = worldCurrency();
    const coins = w => `${Math.round(w * WEALTH_RATE).toLocaleString("ru-RU")} ${cur.abbr}`;

    // Склад: нужды первыми, затем по алфавиту; то, что будет произведено, — тоже, даже если пока ноль
    const stock = sys.stockMap;
    const names = new Set([...RESOURCE_ORDER, ...Object.keys(stock), ...Object.keys(fc.net)]);
    const order = n => { const i = RESOURCE_ORDER.indexOf(n); return i < 0 ? 99 : i; };
    const resources = [...names].sort((a, b) => order(a) - order(b) || compareRu(a, b)).map(name => {
      const net = fc.net[name] ?? 0;
      const value = stock[name] ?? 0;
      return { name, img: resourceIcon(name), value: fmt(value), raw: value, cap: sum.storage,
        pct: Math.min(100, Math.round((value / sum.storage) * 100)), full: value >= sum.storage,
        net: net ? `≈ ${signed(net)}` : "", up: net > 0, down: net < 0, need: RESOURCE_ORDER.includes(name),
        sell: `${priceOf(name)} ${cur.abbr}`, buy: `${Math.ceil(priceOf(name) * BUY_MARKUP)} ${cur.abbr}` };
    });
    const needs = Object.entries(fc.needs).map(([k, n]) => ({
      label: k, need: fmt(n.need), got: fmt(n.got), ok: n.short <= 0, pct: n.need ? Math.round((n.got / n.need) * 100) : 100
    }));

    // Конец месяца
    const weeksLeft = WEEKS_PER_MONTH - cal.week;
    const tax = TAXES[sys.taxes] ?? TAXES.low;
    const month = {
      when: weeksLeft ? `через ${weeksLeft} нед.` : "в конце этой недели",
      arrival: sum.arrival ? (sum.homeless ? "Новые семьи не придут, пока есть бездомные."
        : `Приход семей: шанс ${sum.arrival.chance}%, ${sum.arrival.formula} сем.${sum.freeHouses ? "" : " Домов нет — не больше двух, бездомными."}`)
        : "Одобрение ниже 6 — новые семьи не придут.",
      revolt: sum.revolt ? `Шанс бунта ${sum.revolt}%${sum.control ? ` (Контроль ${sum.control} снимает ${sum.control * 5}%)` : ""}.` : "",
      content: sum.content,
      taxes: sum.taxMult && tax.approval ? `${tax.label} налог: одобрение ${tax.approval > 0 ? "+" : "−"}${Math.abs(tax.approval)}.` : ""
    };

    const approval = sys.approval;
    const groups = Object.entries(BUILDING_GROUPS).map(([g, label]) => ({
      label, cards: sys.buildings.filter(b => b.group === g).map(b => this.#card(b, sum))
    })).filter(g => g.cards.length);

    // Каталог: образцы ведущего — актёры-постройки без поселения (сверху) и встроенные; свой заменяет встроенную с тем же кодом
    const own = game.actors.filter(a => a.type === "building" && !a.system.settlement).sort((a, b) => compareRu(a.name, b.name));
    const ownKeys = new Set(own.map(i => buildingState(i).key));
    const entry = (data, src, mine) => {
      const b = buildingState(data);
      const first = b.levels[0] ?? { cost: [], weeks: 1 };
      const check = S.canBuild(actor, data);
      return { src, mine, label: data.name, img: data.img, hint: plain(data.system.description), cost: S.priceLabel(first.cost),
        weeks: first.weeks, levels: b.levels.length, ok: check.ok, why: check.ok ? "" : check.why,
        taken: b.unique && sys.buildings.some(x => x.key === b.key) };
    };
    const catalog = [
      ...own.map(i => entry(i.toObject(), i.uuid, true)),
      ...Object.keys(BUILDINGS).filter(k => !ownKeys.has(k)).map(k => entry(buildingItemData(k), k, false))
    ];

    const chronicle = [...sys.log].reverse().map(r => ({
      when: `${r.monthLabel ?? ""}, ${r.week}-я неделя`, year: r.year, season: r.season,
      lines: Object.entries(r.net ?? {}).filter(([, v]) => v).map(([k, v]) => `${k} ${signed(v)}`).join(" · "),
      wealth: r.wealthGain ? `${signed(r.wealthGain)} Богатства` : "",
      events: (r.events ?? []).map(e => e.text), built: (r.built ?? []).map(b => b.name ?? b).join(", "),
      shortages: (r.shortages ?? []).map(s => `${s.resource.toLowerCase()} ${s.got} из ${s.need}`).join(", ")
    }));

    Object.assign(context, {
      actor, sys, systemFields: sys.schema.fields, gm, editable, tab: this.tab, tradeQty: this.tradeQty,
      showCatalog: this.showCatalog || !sys.buildings.length,
      tabs: Object.entries(TABS).map(([id, label]) => ({ id, label, active: id === this.tab })),
      cal: { ...cal, months: MONTHS.map((label, i) => ({ n: i + 1, label, on: i + 1 === cal.month })) },
      families: { value: sys.families, ...sum },
      approval: {
        value: approval, max: APPROVAL_MAX, arc: Math.round((approval / APPROVAL_MAX) * 360),
        tone: approval >= 7 ? "high" : approval >= 4 ? "ok" : approval >= 1 ? "low" : "bad",
        note: sum.revolt ? `бунт: ${sum.revolt}%` : sum.arrival ? `приход семей: ${sum.arrival.chance}%` : approval >= 4 ? "спокойно" : "",
        canUp: editable && gm && approval < APPROVAL_MAX, canDown: editable && gm && approval > 0
      },
      wealth: { value: fmt(sys.wealth), raw: sys.wealth, coins: `≈ ${coins(sys.wealth)}`, rate: `1 Богатство = ${WEALTH_RATE} ${cur.abbr}`,
        gain: fc.wealthGain ? `${signed(fc.wealthGain)} в неделю` : "", hero: game.user.character?.name ?? "" },
      taxes: Object.entries(TAXES).map(([k, t]) => ({ key: k, label: t.label, selected: k === sys.taxes })),
      taxNote: sum.taxMult ? (sum.taxCoins ? `${sum.taxCoins} ${cur.abbr} в неделю` : "налог не берётся") : "без усадьбы налог не собрать",
      resources, needs, month, groups, catalog, chronicle, trade: sum.trade, storage: sum.storage,
      army: this.#army(sum),
      enrichedDescription: await TextEditor.enrichHTML(sys.description, { relativeTo: actor, secrets: actor.isOwner })
    });
    return context;
  }

  /** Войско поселения: отряды, откуда набирать, кормёжка и тренировка. */
  #army(sum) {
    const units = ARMY.settlementUnits(this.actor).map(a => ({
      id: a.id, name: a.name, img: a.img, kind: UNIT_KINDS[a.system.kind]?.label, origin: ORIGINS[a.system.origin]?.label,
      soldiers: a.system.soldiers, training: TRAINING[a.system.training].label, equipment: EQUIPMENT[a.system.equipment].label,
      morale: a.system.morale, power: a.system.power.total, drilling: a.system.drilling, food: a.system.food, pay: a.system.pay
    }));
    return {
      units, soldiers: units.reduce((n, u) => n + u.soldiers, 0),
      food: Math.round(units.reduce((n, u) => n + u.food, 0) * 10) / 10,
      pay: Math.round(units.reduce((n, u) => n + u.pay, 0) * 1000) / 1000,
      drill: sum.drill, militia: this.actor.system.militia, idle: sum.idle
    };
  }

  /** Карточка постройки: уровень, что даёт, семьи на работе, стройка, улучшение. */
  #card(b, sum) {
    const lv = levelDef(b, b.level);
    const next = levelDef(b, b.level + 1);
    const workers = sum.workers[b.id] ?? 0;
    const item = game.actors.get(b.id);
    const gives = [];
    if (lv) {
      if (lv.housing) gives.push(`дом на ${lv.housing} сем.`);
      for (const r of lv.consume) gives.push(`сырьё: ${rowLabel(r)}`);
      for (const r of lv.produce) gives.push(rowLabel(r));
      for (const r of lv.upkeep) gives.push(`содержание: ${rowLabel(r)}`);
      if (lv.control) gives.push(`Контроль +${lv.control}`);
      if (lv.controlPerFamily) gives.push(`Контроль +${lv.controlPerFamily} за семью`);
      if (lv.storage) gives.push(`склад +${lv.storage}`);
      if (lv.drill) gives.push(`тренировка войск ×${lv.drill}`);
      if (lv.taxes) gives.push(lv.taxes > 1 ? `налог ×${lv.taxes}` : "налоги");
      if (b.trade) gives.push("торговля");
    }
    const target = b.constructing ? next : null;
    const cost = next?.cost ?? [];
    const canPay = cost.every(c => (c.resource === WEALTH ? this.actor.system.wealth : this.actor.system.stockMap[c.resource] ?? 0) >= c.qty);
    return {
      id: b.id, name: b.name, img: b.img, hint: plain(item?.system.description), level: b.level,
      pips: b.levels.map((_, i) => ({ on: i < b.level, next: b.constructing && i === b.level })),
      constructing: b.constructing, firstBuild: b.constructing && !b.level,
      progress: target ? { done: b.progress, weeks: target.weeks, pct: target.weeks ? Math.round((b.progress / target.weeks) * 100) : 0 } : null,
      stalled: b.constructing && !this.#hasBuilder(b, sum),
      max: lv?.families ?? 0, workers, canMore: workers < (lv?.families ?? 0) && sum.idle > 0, canLess: workers > 0,
      gives: gives.join(" · "),
      idle: !!lv?.families && !workers && lv.produce.some(r => r.per === "family" || r.minFamilies),
      upgrade: !b.constructing && next && b.level >= 1 && b.level < b.levels.length ? { cost: S.priceLabel(next.cost), weeks: next.weeks, ok: canPay } : null
    };
  }

  /** Достанется ли строящейся постройке строитель на этой неделе (по очереди списка). */
  #hasBuilder(b, sum) {
    const queue = this.actor.system.buildings.filter(x => x.constructing);
    return queue.findIndex(x => x.id === b.id) < sum.builders;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const qty = this.element.querySelector(".sv-trade-qty");
    qty?.addEventListener("change", () => { this.tradeQty = Math.max(1, Math.floor(Number(qty.value) || 1)); });
  }

  /* ------------------------------ Действия ------------------------------ */

  static #onTab(event, target) { this.tab = target.dataset.tab; this.render(); }
  static #onCatalog() { this.showCatalog = !this.showCatalog; this.render(); }
  static async #onWeek() { await S.advanceWeek(this.actor); }
  static async #onBuild(event, target) { if (await S.build(this.actor, target.dataset.src)) { this.showCatalog = false; this.render(); } }
  static async #onUpgrade(event, target) { await S.upgrade(this.actor, target.closest("[data-id]").dataset.id); }
  static async #onDemolish(event, target) { await S.demolish(this.actor, target.closest("[data-id]").dataset.id); }
  static #onEditBuilding(event, target) { game.actors.get(target.closest("[data-id]").dataset.id)?.sheet.render(true); }
  static async #onWorkers(event, target) {
    const id = target.closest("[data-id]").dataset.id;
    await S.setWorkers(this.actor, id, (this.actor.system.summary.workers[id] ?? 0) + Number(target.dataset.delta));
  }
  static async #onTrade(event, target) { await S.trade(this.actor, target.dataset.name, this.tradeQty, target.dataset.mode); }
  static async #onApproval(event, target) {
    const v = Math.max(0, Math.min(APPROVAL_MAX, this.actor.system.approval + Number(target.dataset.delta)));
    await this.actor.update({ "system.approval": v });
  }
  static async #onAddResource() {
    const name = this.element.querySelector(".sv-new-res")?.value.trim();
    const qty = this.element.querySelector(".sv-new-qty")?.valueAsNumber || 0;
    if (name) await S.setStock(this.actor, name, qty);
  }
  static async #onRemoveResource(event, target) { await S.setStock(this.actor, target.dataset.name, null); }
  static async #onWealth(event, target) {
    const mode = target.dataset.mode;
    const cur = worldCurrency();
    const units = await foundry.applications.api.DialogV2.prompt({
      window: { title: mode === "deposit" ? "Внести в казну" : "Взять из казны" },
      content: `<div class="vedmak-roll-dialog"><label class="num"><span class="cap">Сколько Богатства</span>
        <input type="number" name="units" min="1" step="1" value="1" autofocus></label>
        <p class="hint">1 Богатство = ${WEALTH_RATE} ${cur.abbr}. ${mode === "deposit" ? "Из кошелька" : "В кошелёк"}: ${game.user.character?.name ?? "персонаж не назначен"}.</p></div>`,
      ok: { label: mode === "deposit" ? "Внести" : "Взять", callback: (ev, button) => button.form.elements.units.valueAsNumber },
      rejectClose: false
    });
    if (units) await S.moveWealth(this.actor, units, mode);
  }

  static async #onUnitDrill(event, target) {
    const unit = game.actors.get(target.closest("[data-id]").dataset.id);
    if (unit?.isOwner) await unit.update({ "system.drilling": !unit.system.drilling });
  }
  static #onOpenUnit(event, target) { game.actors.get(target.closest("[data-id]").dataset.id)?.sheet.render(true); }
  static #onBattle() { game.vedmak.army.battle(ARMY.settlementUnits(this.actor)); }

  /** Набор: откуда, род войск, сколько, в новый или существующий отряд. */
  static async #onRecruit() {
    const town = this.actor;
    const sys = town.system;
    const units = ARMY.settlementUnits(town);
    const opt = (v, l, sel) => `<option value="${v}" ${sel ? "selected" : ""}>${l}</option>`;
    const content = `<div class="vedmak-roll-dialog sv-recruit">
      <div class="form-group"><label>Откуда</label><select name="origin">
        ${opt("militia", `Ополчение — есть ${sys.militia} чел.`, true)}
        ${opt("families", `Семьи без дела — ${sys.summary.idle} (по ${FAMILY_SOLDIERS} бойцов)`)}
        ${opt("mercenary", `Наёмники — ${MERCENARY.hire} Богатства за бойца (в казне ${sys.wealth})`)}
      </select></div>
      <div class="form-group"><label>Сколько</label><input type="number" name="count" min="1" step="1" value="10">
        <p class="hint">Для семей — число семей, для остальных — бойцов.</p></div>
      <div class="form-group"><label>Куда</label><select name="unit">${opt("", "Новый отряд", true)}${units.map(u => opt(u.id, `${u.name} (${ORIGINS[u.system.origin].label.toLowerCase()})`)).join("")}</select></div>
      <div class="form-group"><label>Род войск</label><select name="kind">${Object.entries(UNIT_KINDS).map(([k, v]) => opt(k, v.label, k === "infantry")).join("")}</select></div>
      <div class="form-group"><label>Название</label><input type="text" name="name" placeholder="Ополчение ${town.name}"></div>
      <p class="hint">Наёмники приходят обученными и со своим снаряжением, но им платят каждую неделю. Новички в старом отряде снаряжаются со склада как весь отряд.</p>
    </div>`;
    const data = await foundry.applications.api.DialogV2.prompt({
      window: { title: `Набор войска: ${town.name}` }, content,
      ok: { label: "Набрать", callback: (ev, button) => Object.fromEntries(new FormData(button.form)) },
      rejectClose: false
    });
    if (!data) return;
    const unit = await ARMY.recruit(town, { origin: data.origin, count: data.count, kind: data.kind, name: data.name.trim(),
      unit: data.unit ? game.actors.get(data.unit) : null });
    if (unit) { this.render(); unit.sheet.render(true); }
  }

  /** Перетащенный образец постройки (актёр без поселения или старый предмет) закладывается со списанием цены. */
  async _onDropActor(event, actor) {
    if (!this.actor.isOwner) return null;
    if (actor.type !== "building") { ui.notifications.warn("На лист поселения можно перетащить постройку."); return null; }
    if (actor.system.settlement === this.actor.uuid) return null;
    return S.build(this.actor, actor.toObject());
  }

  async _onDropItem(event, item) {
    if (!this.actor.isOwner) return null;
    if (item.type !== "building") { ui.notifications.warn("Поселению предметы не нужны."); return null; }
    return S.build(this.actor, item.toObject());
  }
}
