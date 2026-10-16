// Лист поселения (PLAN 4.183, 4.185) по журналу мира manorlords: шапка — герб, месяц и неделя; пластины — семьи,
// одобрение 0–10 (шансы прихода семей и бунта), казна в Богатстве, налог, Ополчение и Контроль; вкладки «Хозяйство»
// (склад с вместимостью и прогнозом недели, торговля, нужды, конец месяца), «Постройки» (карточки с уровнями, семьями
// на работе, стройкой; каталог), «Летопись» и «Описание». Владелец строит, ставит семьи, налог и торгует; ведущий ещё
// двигает неделю и правит числа. Постройки — актёры (PLAN 4.198): карточка открывает лист постройки.

import { BUILDINGS, BUILDING_GROUPS, PERIODS, WEALTH_RATE, APPROVAL_MAX, WEEKS_PER_MONTH, RESOURCE_ORDER, TAXES, BUY_MARKUP, MONTHS,
  resourceIcon, buildingItemData, priceOf } from "../config/settlement.mjs";
import { buildingState, levelDef, activeLevel, upgradeNodes, WEALTH } from "../settlement/rules.mjs";
import * as S from "../settlement/settlement.mjs";
import { worldCurrency } from "../config/money.mjs";
import { compareRu, once } from "../util.mjs";
import { UNIT_KINDS, TRAINING, WEAPONS, ARMOR, ORIGINS, FAMILY_SOLDIERS, MERCENARY } from "../config/army.mjs";
import { RANKS } from "../config/unit-upgrades.mjs";
import * as ARMY from "../army/army.mjs";
import { ResourceLibrary, RESOURCE_DRAG } from "../apps/resource-library.mjs";
import { addResource } from "../settlement/resources.mjs";
import { bindUnitMenu } from "../army/unit-menu.mjs";
import * as EV from "../settlement/events.mjs";
import { effectLabel } from "../config/settlement-events.mjs";
import { animateRealm, animateNew } from "../fx/realm-fx.mjs";
import { realmPrompt, realmConfirm } from "../apps/realm-dialog.mjs";

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
      tradeStep: SettlementSheet.#onTradeStep,
      catalog: SettlementSheet.#onCatalog,
      editBuilding: SettlementSheet.#onEditBuilding,
      approval: SettlementSheet.#onApproval,
      addResource: SettlementSheet.#onAddResource,
      removeResource: SettlementSheet.#onRemoveResource,
      recruit: SettlementSheet.#onRecruit,
      unitDrill: SettlementSheet.#onUnitDrill,
      openUnit: SettlementSheet.#onOpenUnit,
      battle: SettlementSheet.#onBattle,
      library: SettlementSheet.#onLibrary,
      addRoute: SettlementSheet.#onAddRoute,
      removeRoute: SettlementSheet.#onRemoveRoute,
      liftSiege: SettlementSheet.#onLiftSiege,
      decide: SettlementSheet.#onDecide,
      addEvent: SettlementSheet.#onAddEvent,
      removeModifier: SettlementSheet.#onRemoveModifier,
      openChronicle: SettlementSheet.#onOpenChronicle,
      moveChronicle: SettlementSheet.#onMoveChronicle
    }
  };

  static PARTS = {
    body: { template: "systems/vedmak/templates/actor/settlement-sheet.hbs", scrollable: [".rs-scroll"] }
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
      // Тающий запас: на сколько недель хватит при нынешней убыли (макет склада, PLAN 4.230)
      const weeks = net < 0 ? Math.floor(value / -net) : Infinity;
      const left = weeks > 6 ? "" : value <= 0 ? "на складе нет" : weeks === 0 ? "кончится на этой неделе"
        : weeks === 1 ? "хватит на неделю" : `хватит на ${weeks} нед.`;
      return { name, img: resourceIcon(name), value: fmt(value), raw: value, cap: sum.storage, left,
        pct: Math.min(100, Math.round((value / sum.storage) * 100)), full: value >= sum.storage,
        net: net ? `≈ ${signed(net)}` : "", up: net > 0, down: net < 0, need: RESOURCE_ORDER.includes(name),
        sell: `${priceOf(name)} ${cur.abbr}`, buy: `${Math.ceil(priceOf(name) * BUY_MARKUP)} ${cur.abbr}`,
        // Цены числом для плитки торговли (лист по холсту): валюта — подписью рядом
        sellN: priceOf(name), buyN: Math.ceil(priceOf(name) * BUY_MARKUP) };
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
      needs: (() => { try { return game.settings.get("vedmak", "settlementNeedsApproval"); } catch { return false; } })()
        && ((sys.monthShort ?? 0) > 0 || Object.values(fc.needs).some(n => n.short > 0))
        ? `Нужд ${sys.monthShort ? `не хватало недель: ${sys.monthShort}` : "не хватит"} — в конце месяца одобрение −1.` : "",
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
      tabs: Object.entries(TABS).map(([id, label]) => ({ id, label, active: id === this.tab, badge: id === "economy" ? sys.decisions.length : 0 })),
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
      resources, needs, month, groups, catalog, chronicle, trade: sum.trade, storage: sum.storage, abbr: cur.abbr,
      army: this.#army(sum),
      routes: sys.routes.map(r => ({ ...r, to: fromUuidSync(r.to)?.name ?? "—", img: resourceIcon(r.resource) })),
      routeTargets: game.actors.filter(a => a.type === "settlement" && a.id !== actor.id && a.visible).map(a => ({ uuid: a.uuid, name: a.name })),
      // События месяца (PLAN 4.206)
      decisions: sys.decisions.map(d => EV.decisionView(actor, d)).filter(Boolean),
      modifiers: (sys.modifiers ?? []).map(m => ({ id: m.id, label: m.label, weeks: m.weeks, text: effectLabel({ mod: m }).replace(/^.*?»:?\s*/, "") })),
      siege: sys.siege.units.length ? { weeks: sys.siege.weeks, units: sys.siege.units.map(u => fromUuidSync(u)?.name ?? "?").join(", ") } : null,
      enrichedDescription: await TextEditor.enrichHTML(sys.description, { relativeTo: actor, secrets: actor.isOwner })
    });
    return context;
  }

  /** Войско поселения: отряды, откуда набирать, кормёжка и тренировка. */
  #army(sum) {
    const units = ARMY.settlementUnits(this.actor).map(a => ({
      id: a.id, name: a.name, img: a.img, kind: UNIT_KINDS[a.system.kind]?.label, origin: ORIGINS[a.system.origin]?.label,
      soldiers: a.system.soldiers, training: TRAINING[a.system.training].label, rank: RANKS[a.system.rank ?? 0].label,
      equipment: `${WEAPONS[a.system.weapons].label.toLowerCase()}, ${ARMOR[a.system.armor].label.toLowerCase()}`,
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
    const lv = activeLevel(b);
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
      if (lv.defense) gives.push(`укрепления +${lv.defense}`);
      if (lv.taxes) gives.push(lv.taxes > 1 ? `налог ×${lv.taxes}` : "налоги");
      if (b.trade) gives.push("торговля");
    }
    // Обустройство (PLAN 4.198): взято ступеней и какая строится
    const all = upgradeNodes(b);
    const working = b.research?.node ? all.find(x => x.id === b.research.node) : null;
    const tree = all.length ? { done: b.upgrades.length, total: all.length, stalled: !!working && !this.#hasBuilder(b, sum),
      working: working ? { name: working.name, done: b.research.progress, weeks: working.weeks } : null } : null;
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
      gives: gives.join(" · "), tree,
      manager: b.manager ? `${b.manager.name} — ${b.manager.label.toLowerCase()} ${b.manager.value}${b.manager.dice ? `, +${b.manager.dice}d4` : ""}` : "",
      idle: !!lv?.families && !workers && lv.produce.some(r => r.per === "family" || r.minFamilies),
      upgrade: !b.constructing && next && b.level >= 1 && b.level < b.levels.length ? { cost: S.priceLabel(next.cost), weeks: next.weeks, ok: canPay } : null
    };
  }

  /** Достанется ли строящейся постройке строитель на этой неделе (по очереди списка). */
  #hasBuilder(b, sum) {
    const queue = this.actor.system.buildings.filter(x => x.constructing || x.research?.node);
    return queue.findIndex(x => x.id === b.id) < sum.builders;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    // Правая кнопка по отряду во «Войске»: лист, картинка, жетон, роспуск, удаление
    bindUnitMenu(this.element, ".rs-units .rs-urow[data-id]");
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Движение, как у листа персонажа (PLAN 4.212): вкладка проявляется, числа и шкалы — перетекают и вспыхивают
    animateRealm(this, this.element, this.actor.uuid, this.tab);
    animateNew(this, this.element, ".rs-bcard[data-id]");
    animateNew(this, this.element, ".rs-event[data-decision]");
    animateNew(this, this.element, ".rs-urow[data-id]");
  }

  /* ------------------------------ Действия ------------------------------ */

  // Действия с ценой — через once: двойной щелчок не платит и не двигает неделю дважды
  static #onTab(event, target) { this.tab = target.dataset.tab; this.render(); }
  static #onCatalog() { this.showCatalog = !this.showCatalog; this.render(); }
  static async #onWeek() { await S.advanceWeek(this.actor); }
  static async #onBuild(event, target) {
    if (await once(this.actor, "build", () => S.build(this.actor, target.dataset.src))) { this.showCatalog = false; this.render(); }
  }
  static async #onUpgrade(event, target) { await once(this.actor, "upgrade", () => S.upgrade(this.actor, target.closest("[data-id]").dataset.id)); }
  static async #onDemolish(event, target) { await S.demolish(this.actor, target.closest("[data-id]").dataset.id); }
  static #onEditBuilding(event, target) { game.actors.get(target.closest("[data-id]").dataset.id)?.sheet.render(true); }
  static async #onWorkers(event, target) {
    const id = target.closest("[data-id]").dataset.id;
    await S.setWorkers(this.actor, id, (this.actor.system.summary.workers[id] ?? 0) + Number(target.dataset.delta));
  }
  /** «−/+» у «Торговать по»: сколько единиц за раз (не меньше одной). */
  static #onTradeStep(event, target) {
    this.tradeQty = Math.max(1, this.tradeQty + Number(target.dataset.delta || 0));
    this.render();
  }
  static async #onTrade(event, target) { await once(this.actor, "trade", () => S.trade(this.actor, target.dataset.name, this.tradeQty, target.dataset.mode)); }
  static async #onApproval(event, target) {
    const v = Math.max(0, Math.min(APPROVAL_MAX, this.actor.system.approval + Number(target.dataset.delta)));
    await this.actor.update({ "system.approval": v });
  }
  static async #onAddResource() {
    const name = this.element.querySelector(".rs-new-res")?.value.trim();
    const qty = this.element.querySelector(".rs-new-qty")?.valueAsNumber || 0;
    if (name) await S.setStock(this.actor, name, qty);
  }
  static async #onRemoveResource(event, target) { await S.setStock(this.actor, target.dataset.name, null); }
  static async #onWealth(event, target) {
    const mode = target.dataset.mode;
    const cur = worldCurrency();
    const hero = game.user.character;
    const purse = hero?.system.money?.[cur.key] ?? 0;
    // Сколько можно: внести — сколько есть в кошельке, взять — сколько в казне (десятыми долями)
    const max = Math.floor((mode === "deposit" ? purse / WEALTH_RATE : this.actor.system.wealth) * 10) / 10;
    const units = await realmPrompt("wealth", {
      title: mode === "deposit" ? "Внести в казну" : "Взять из казны", okLabel: mode === "deposit" ? "Внести" : "Взять",
      data: { max, value: Math.min(1, max) || 1, rate: WEALTH_RATE, abbr: cur.abbr, treasury: fmt(this.actor.system.wealth),
        hero: hero?.name ?? "", purse, verb: mode === "deposit" ? "внести" : "взять", maxLabel: fmt(max) },
      read: form => form.elements.units.valueAsNumber
    });
    if (units) await S.moveWealth(this.actor, units, mode);
  }

  static async #onUnitDrill(event, target) {
    const unit = game.actors.get(target.closest("[data-id]").dataset.id);
    if (unit?.isOwner) await unit.update({ "system.drilling": !unit.system.drilling });
  }
  static #onOpenUnit(event, target) { game.actors.get(target.closest("[data-id]").dataset.id)?.sheet.render(true); }
  static #onBattle() { game.vedmak.army.battle(ARMY.settlementUnits(this.actor)); }
  static #onLibrary() { ResourceLibrary.open(this.actor); }
  static async #onAddRoute() {
    const el = this.element;
    await S.addRoute(this.actor, el.querySelector(".rs-route-to")?.value, el.querySelector(".rs-route-res")?.value, el.querySelector(".rs-route-qty")?.valueAsNumber);
  }
  static async #onRemoveRoute(event, target) { await S.removeRoute(this.actor, target.closest("[data-route]").dataset.route); }
  static async #onLiftSiege() { if (game.user.isGM) await ARMY.liftSiege(null, this.actor); }
  static async #onDecide(event, target) {
    // Двойной щелчок по решению платил его цену дважды
    await once(this.actor, "decide", () => EV.decide(this.actor, target.closest("[data-decision]").dataset.decision, Number(target.dataset.choice)));
  }
  static async #onOpenChronicle() { await S.openChronicle(this.actor); }
  static async #onMoveChronicle() {
    const ok = await realmConfirm("chronicle", { title: "Летопись — в журнал",
      text: "Все недели с листа перейдут в журнал «Летопись», а лист очистится. Продолжить?" });
    if (ok) await S.moveChronicle(this.actor);
  }
  static async #onRemoveModifier(event, target) { await EV.removeModifier(this.actor, target.closest("[data-modifier]").dataset.modifier); }
  /** Ведущий: событие месяца по выбору или случайное из подходящих. */
  static async #onAddEvent() {
    if (!game.user.isGM) return;
    const s = EV.eventState(this.actor);
    const events = Object.entries(EV.SETTLEMENT_EVENTS).map(([key, e]) => {
      let fits = true; try { fits = e.when(s); } catch { fits = false; }
      return { key, label: e.label, fits };
    });
    const key = await realmPrompt("event", { title: `Событие: ${this.actor.name}`, okLabel: "Случилось", data: { events },
      read: form => form.elements.key.value });
    if (key !== null && key !== undefined) await EV.addEvent(this.actor, key);
  }

  /** Ресурс из библиотеки (PLAN 4.201) — склад начинает его учитывать; остальное — как обычно. */
  async _onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type === RESOURCE_DRAG) {
      if (await addResource(this.actor, data.name)) ui.notifications.info(`«${data.name}» — на складе «${this.actor.name}».`);
      return;
    }
    return super._onDrop(event);
  }

  /** Набор: откуда, род войск, сколько, в новый или существующий отряд. */
  static async #onRecruit() {
    const town = this.actor;
    const sys = town.system;
    const units = ARMY.settlementUnits(town);
    const data = await realmPrompt("recruit", {
      title: `Набор войска: ${town.name}`, okLabel: "Набрать",
      data: { town: town.name, militia: sys.militia, idle: sys.summary.idle, familySoldiers: FAMILY_SOLDIERS, hire: MERCENARY.hire, wealth: sys.wealth,
        units: units.map(u => ({ id: u.id, name: u.name, origin: ORIGINS[u.system.origin].label.toLowerCase() })),
        kinds: Object.entries(UNIT_KINDS).map(([key, v]) => ({ key, label: v.label, selected: key === "infantry" })) },
      read: form => Object.fromEntries(new FormData(form))
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
    // Свой ресурс ведущего — склад начинает его учитывать
    if (item.type === "resource") return addResource(this.actor, item.name);
    if (item.type !== "building") { ui.notifications.warn("Поселению из предметов нужны постройки и ресурсы."); return null; }
    return S.build(this.actor, item.toObject());
  }
}
