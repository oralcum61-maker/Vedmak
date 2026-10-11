// Лист поселения (PLAN 4.183): шапка — герб, неделя и сезон, семьи, одобрение, казна, налог; вкладки «Хозяйство»
// (склад, прогноз недели, нужды, одобрение по частям, торговля), «Постройки» (карточки с уровнями, работниками и стройкой,
// каталог), «Летопись» (прошедшие недели) и «Описание». Владелец строит и распоряжается, ведущий ещё двигает неделю
// и правит числа напрямую.

import { BUILDINGS, BUILDING_GROUPS, RESOURCES, RESOURCE_KEYS, TAXES, BUY_MARKUP } from "../config/settlement.mjs";
import { levelDef, canAfford } from "../settlement/rules.mjs";
import * as S from "../settlement/settlement.mjs";
import { worldCurrency, worldLabel, crownsToWorld } from "../config/money.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

const SEASON_KEYS = ["spring", "summer", "autumn", "winter"];
const TABS = { economy: "Хозяйство", buildings: "Постройки", chronicle: "Летопись", notes: "Описание" };
const fmt = n => (Math.round(n * 10) / 10).toLocaleString("ru-RU");
const signed = n => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));

export class SettlementSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["vedmak", "sheet", "actor", "settlement"],
    position: { width: 860, height: 820 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      tab: SettlementSheet.#onTab,
      week: SettlementSheet.#onWeek,
      build: SettlementSheet.#onBuild,
      upgrade: SettlementSheet.#onUpgrade,
      demolish: SettlementSheet.#onDemolish,
      workers: SettlementSheet.#onWorkers,
      trade: SettlementSheet.#onTrade,
      money: SettlementSheet.#onMoney,
      catalog: SettlementSheet.#onCatalog
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
    const gm = game.user.isGM;
    const editable = this.isEditable;
    const cur = worldCurrency();

    const resources = RESOURCE_KEYS.map(k => {
      const cap = sum.storage[k];
      const value = sys.stock[k];
      const net = fc.net[k];
      return {
        key: k, label: RESOURCES[k].label, img: RESOURCES[k].img, value: fmt(value), raw: value, cap,
        pct: Math.min(100, Math.round((value / cap) * 100)), full: value >= cap,
        net: net ? signed(net) : "", up: net > 0, down: net < 0,
        sell: `${worldLabel(RESOURCES[k].price)}`, buy: `${worldLabel(Math.ceil(RESOURCES[k].price * BUY_MARKUP))}`
      };
    });

    const needs = Object.entries(fc.needs).map(([k, n]) => ({
      label: RESOURCES[k].label, need: fmt(n.need), got: fmt(n.got), ok: n.ratio >= 1, pct: Math.round(n.ratio * 100)
    }));

    const approval = fc.approval;
    const groups = Object.entries(BUILDING_GROUPS).map(([g, label]) => ({
      label,
      cards: sys.buildings.filter(b => BUILDINGS[b.key]?.group === g).map(b => this.#card(b, sum, fc))
    })).filter(g => g.cards.length);

    const catalog = Object.entries(BUILDINGS).map(([key, def]) => {
      const lv = def.levels[0];
      const check = S.canBuild(actor, key);
      const taken = def.unique && sys.buildings.some(b => b.key === key);
      return {
        key, label: def.label, img: def.img, hint: def.hint, cost: S.priceLabel(lv.cost), weeks: lv.weeks,
        levels: def.levels.length, ok: check.ok, why: check.ok ? "" : check.why, taken, group: BUILDING_GROUPS[def.group]
      };
    });

    const chronicle = [...sys.log].reverse().map(r => ({
      week: r.week, season: r.season, year: r.year, approval: r.approval,
      families: r.families?.change ? `${r.families.change > 0 ? "+" : "−"}${Math.abs(r.families.change)} сем.` : "",
      lines: RESOURCE_KEYS.filter(k => r.net?.[k]).map(k => `${RESOURCES[k].label} ${signed(r.net[k])}`).join(" · "),
      income: r.income ? worldLabel(r.income) : "", built: (r.built ?? []).map(b => b.name).join(", "), reason: r.families?.reason ?? ""
    }));

    Object.assign(context, {
      actor, sys, systemFields: sys.schema.fields, gm, editable, tab: this.tab, showCatalog: this.showCatalog || !sys.buildings.length, tradeQty: this.tradeQty,
      tabs: Object.entries(TABS).map(([id, label]) => ({ id, label, active: id === this.tab })),
      cal: sys.calendar, cur,
      families: { value: sys.families, housing: sum.housing, free: sum.free, builders: sum.builders, assigned: sum.assigned },
      approval: { value: approval, parts: fc.approvalParts.map(p => ({ label: p.label, value: signed(p.value), up: p.value > 0, down: p.value < 0 })),
        tone: approval >= 75 ? "high" : approval >= 50 ? "ok" : approval >= 25 ? "low" : "bad",
        arc: Math.round(approval * 3.6) },
      treasury: { label: worldLabel(sys.money), value: crownsToWorld(sys.money), income: fc.income ? signed(crownsToWorld(fc.income)) : "",
        hero: game.user.character?.name ?? "" },
      taxes: Object.entries(TAXES).map(([k, t]) => ({ key: k, label: t.label, selected: k === sys.taxes,
        hint: `${worldLabel(t.perFamily)} с семьи, одобрение ${signed(t.approval)}` })),
      taxNote: sum.taxMult ? "" : "Без усадьбы налог не собрать",
      resources, needs, groups, catalog, chronicle, trade: sum.trade,
      forecastNote: fc.families.reason,
      enrichedDescription: await TextEditor.enrichHTML(sys.description, { relativeTo: actor, secrets: actor.isOwner })
    });
    return context;
  }

  /** Карточка постройки: уровень, работа, стройка, что даёт. */
  #card(b, sum, fc) {
    const def = BUILDINGS[b.key];
    const lv = levelDef(b.key, b.level);
    const next = levelDef(b.key, b.level + 1);
    const max = lv?.workers ?? 0;
    const workers = sum.workers[b.id] ?? 0;
    const gives = [];
    if (lv) {
      const n = workers;
      for (const [k, per] of Object.entries(lv.produce ?? {})) if (n) gives.push(`+${fmt(per * n)} ${RESOURCES[k].label.toLowerCase()}`);
      for (const [k, per] of Object.entries(lv.consume ?? {})) if (n) gives.push(`−${fmt(per * n)} ${RESOURCES[k].label.toLowerCase()}`);
      if (lv.income && n) gives.push(`+${worldLabel(lv.income * n)}`);
      if (lv.housing) gives.push(`жильё на ${lv.housing} сем.`);
      if (lv.approval) gives.push(`одобрение +${lv.approval}`);
      for (const [k, v] of Object.entries(lv.storage ?? {})) if (k === "food" || k === "wood") gives.push(`склад: ${RESOURCES[k].label.toLowerCase()} +${v}`);
      if (lv.taxes) gives.push(lv.taxes > 1 ? `налог ×${lv.taxes}` : "налоги");
      for (const [k, v] of Object.entries(lv.boost ?? {})) gives.push(`${BUILDINGS[k].label.toLowerCase()} +${Math.round(v * 100)}%`);
    }
    const target = b.constructing ? levelDef(b.key, b.level + 1) : null;
    return {
      id: b.id, name: b.name || def.label, img: def.img, hint: def.hint, level: b.level, maxLevel: def.levels.length,
      pips: def.levels.map((_, i) => ({ on: i < b.level, next: b.constructing && i === b.level })),
      constructing: b.constructing, firstBuild: b.constructing && b.level === 0,
      progress: target ? { done: b.progress, weeks: target.weeks, pct: Math.round((b.progress / target.weeks) * 100) } : null,
      stalled: b.constructing && sum.builders < sum.constructing && !this.#hasBuilder(b, sum),
      max, workers, canMore: max && workers < max && sum.free > 0, canLess: workers > 0,
      gives: gives.join(" · "),
      offSeason: !!def.season && workers > 0 && def.season[SEASON_KEYS.indexOf(this.actor.system.calendar.season.key)] === 0,
      upgrade: !b.constructing && next ? { cost: S.priceLabel(next.cost), weeks: next.weeks, ok: canAfford(this.actor.system, next.cost) } : null
    };
  }

  /** Достанется ли строящейся постройке строитель на этой неделе (по очереди списка). */
  #hasBuilder(b, sum) {
    const queue = this.actor.system.buildings.filter(x => x.constructing);
    return queue.findIndex(x => x.id === b.id) < sum.builders;
  }

  /** Казна в листе правится в валюте мира — в данных она в кронах. */
  _prepareSubmitData(event, form, formData, updateData) {
    const data = super._prepareSubmitData(event, form, formData, updateData);
    if ("treasury" in data) {
      data.system ??= {};
      data.system.money = Math.max(0, (Number(data.treasury) || 0) * worldCurrency().rate);
      delete data.treasury;
    }
    return data;
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
  static async #onBuild(event, target) { await S.build(this.actor, target.dataset.key); this.showCatalog = false; this.render(); }
  static async #onUpgrade(event, target) { await S.upgrade(this.actor, target.closest("[data-id]").dataset.id); }
  static async #onDemolish(event, target) { await S.demolish(this.actor, target.closest("[data-id]").dataset.id); }
  static async #onWorkers(event, target) {
    const id = target.closest("[data-id]").dataset.id;
    const now = this.actor.system.summary.workers[id] ?? 0;
    await S.setWorkers(this.actor, id, now + Number(target.dataset.delta));
  }
  static async #onTrade(event, target) { await S.trade(this.actor, target.dataset.key, this.tradeQty, target.dataset.mode); }
  static async #onMoney(event, target) {
    const mode = target.dataset.mode;
    const cur = worldCurrency();
    const amount = await foundry.applications.api.DialogV2.prompt({
      window: { title: mode === "deposit" ? "Внести в казну" : "Взять из казны" },
      content: `<div class="vedmak-roll-dialog"><label class="num"><span class="cap">Сколько, ${cur.abbr}</span>
        <input type="number" name="amount" min="1" step="1" value="10" autofocus></label>
        <p class="hint">${mode === "deposit" ? "Из кошелька" : "В кошелёк"}: ${game.user.character?.name ?? "персонаж не назначен"}.</p></div>`,
      ok: { label: mode === "deposit" ? "Внести" : "Взять", callback: (ev, button) => button.form.elements.amount.valueAsNumber },
      rejectClose: false
    });
    if (amount) await S.moveMoney(this.actor, amount, mode);
  }
}
