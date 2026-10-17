// Совет правителя (PLAN 4.203): все поселения, что видит пользователь, — одно окно: семьи, одобрение, казна, укрепления,
// осада; нужды и главные запасы с прогнозом; стройки, обустройство и заказы; войско и караваны; шансы конца месяца.
// Ведущий двигает неделю каждого или всех сразу.

import { WEALTH_RATE, resourceIcon, RESOURCE_ORDER } from "../config/settlement.mjs";
import { worldCurrency } from "../config/money.mjs";
import { upgradeNodes } from "../settlement/rules.mjs";
import { settlementUnits } from "../army/army.mjs";
import { SETTLEMENT_EVENTS } from "../config/settlement-events.mjs";
import { once } from "../util.mjs";
import { animateRealm } from "../fx/realm-fx.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const fmt = n => (Math.round(n * 10) / 10).toLocaleString("ru-RU");
const signed = n => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));

export class RulerCouncil extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "vedmak-council",
    classes: ["vedmak", "vedmak-dialog", "ruler-council"],
    window: { title: "Совет правителя", icon: "fa-solid fa-crown", resizable: true },
    position: { width: 980, height: 720 },
    actions: {
      openActor: RulerCouncil.#onOpen,
      week: RulerCouncil.#onWeek,
      weekAll: RulerCouncil.#onWeekAll,
      newTown: RulerCouncil.#onNewTown,
      worldCheck: RulerCouncil.#onWorldCheck
    }
  };

  static PARTS = { body: { template: "systems/vedmak/templates/apps/ruler-council.hbs", scrollable: [".rc-list"] } };

  _onRender(context, options) {
    super._onRender?.(context, options);
    // Числа поселений после «Прошла неделя» — вспыхивают, полосы перетекают (PLAN 4.240)
    animateRealm(this, this.element, "council");
  }

  static open() {
    const app = foundry.applications.instances.get("vedmak-council") ?? new RulerCouncil();
    app.render({ force: true });
    return app;
  }

  async _prepareContext() {
    const cur = worldCurrency();
    const towns = game.actors.filter(a => a.type === "settlement" && a.visible).map(a => this.#town(a, cur));
    return { towns, gm: game.user.isGM, empty: !towns.length };
  }

  #town(a, cur) {
    const sys = a.system;
    const sum = sys.summary;
    const fc = sys.forecast;
    const stock = sys.stockMap;
    const needs = RESOURCE_ORDER.map(k => ({ name: k, img: resourceIcon(k), value: fmt(stock[k] ?? 0), net: fc.net[k] ?? 0 }))
      .map(x => ({ ...x, netLabel: x.net ? signed(x.net) : "", down: x.net < 0, low: (stock[x.name] ?? 0) + x.net < 0 }));
    const top = Object.entries(stock).filter(([k, v]) => !RESOURCE_ORDER.includes(k) && v > 0).sort((x, y) => y[1] - x[1]).slice(0, 6)
      .map(([k, v]) => ({ name: k, img: resourceIcon(k), value: fmt(v), net: fc.net[k] ? signed(fc.net[k]) : "" }));
    const works = [];
    for (const b of sys.buildingActors) {
      const s = b.system;
      if (s.constructing) works.push(`${b.name}: ${s.level ? "улучшается" : "строится"}, ${s.progress} нед.`);
      if (s.research.node) {
        const nd = upgradeNodes(s).find(x => x.id === s.research.node);
        works.push(`${b.name}: «${nd?.name ?? "?"}» ${s.research.progress} из ${nd?.weeks ?? "?"} нед.`);
      }
      if (s.orders.length) works.push(`${b.name}: заказов ${s.orders.length} («${s.orders[0].name}» ${s.orders[0].progress}/${s.orders[0].weeks})`);
    }
    const units = settlementUnits(a);
    return {
      uuid: a.uuid, name: a.name, img: a.img, owner: a.isOwner,
      when: `${sys.calendar.monthLabel}, ${sys.calendar.week}-я неделя, год ${sys.calendar.year}`,
      families: sys.families, houses: sum.houses, homeless: sum.homeless, idle: sum.idle, approval: sys.approval,
      wealth: fmt(sys.wealth), coins: `${Math.round(sys.wealth * WEALTH_RATE).toLocaleString("ru-RU")} ${cur.abbr}`,
      wealthNet: fc.wealthGain ? signed(fc.wealthGain) : "", defense: sum.defense, control: sum.control,
      siege: sys.siege.units.length ? `${sys.siege.weeks} нед.` : "",
      needs, top, works,
      army: units.length ? { units: units.length, soldiers: units.reduce((n, u) => n + u.system.soldiers, 0),
        away: units.filter(u => u.system.campaign).length } : null,
      routes: sys.routes.map(r => `${r.resource.toLowerCase()} ${r.qty} → ${fromUuidSync(r.to)?.name ?? "?"}`),
      revolt: sum.revolt, arrival: sum.arrival?.chance ?? 0,
      warn: [...sys.decisions.map(d => `ждёт решения: «${SETTLEMENT_EVENTS[d.key]?.label ?? d.key}»`),
        ...(sys.modifiers ?? []).map(m => `«${m.label}» ещё ${m.weeks} нед.`), sum.homeless ? `бездомных ${sum.homeless}` : "", needs.some(x => x.low) ? "нужд не хватит" : "", sum.revolt ? `бунт ${sum.revolt}%` : ""].filter(Boolean)
    };
  }

  static async #onOpen(event, target) { (await fromUuid(target.closest("[data-uuid]").dataset.uuid))?.sheet.render(true); }

  static async #onWeek(event, target) {
    if (!game.user.isGM) return;
    const town = await fromUuid(target.closest("[data-uuid]").dataset.uuid);
    if (town) await game.vedmak.settlement.askWeek(town);
    this.render();
  }

  /** Новое поселение из шаблона или с нуля (PLAN 4.246). */
  static async #onNewTown() {
    if (!game.user.isGM) return;
    if (await once(this, "newTown", () => game.vedmak.settlement.templates.askNewSettlement())) this.render();
  }

  /** Проверка мира (PLAN 4.248): порванные связи королевства — список и «Починить». */
  static async #onWorldCheck() {
    if (!game.user.isGM) return;
    if (await once(this, "worldCheck", () => game.vedmak.worldCheck.askWorldCheck())) this.render();
  }

  /** Неделя для всех поселений по очереди (караваны везут в уже прошедшие — как и вручную). */
  static async #onWeekAll() {
    if (!game.user.isGM) return;
    await once(this, "weekAll", async () => {
      await game.vedmak.settlement.advanceAll(game.actors.filter(a => a.type === "settlement"));
    });
    this.render();
  }
}

/** Кнопка «Совет правителя» в боковой панели актёров. */
export function registerCouncilUi() {
  Hooks.on("renderActorDirectory", (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    const header = root?.querySelector(".directory-header .header-actions") ?? root?.querySelector(".directory-header");
    if (!header || header.querySelector(".vd-council")) return;
    if (!game.actors.some(a => a.type === "settlement" && a.visible) && !game.user.isGM) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vd-council";
    btn.innerHTML = '<i class="fa-solid fa-crown"></i> Совет правителя';
    btn.addEventListener("click", () => RulerCouncil.open());
    header.append(btn);
    paintAlerts(btn);
  });
  // Окно открыто — поселения и постройки меняются: перерисовать; тревоги на кнопке — пересчитать
  const again = foundry.utils.debounce(() => {
    const app = foundry.applications.instances.get("vedmak-council"); if (app?.rendered) app.render();
    for (const btn of document.querySelectorAll(".vd-council")) paintAlerts(btn);
  }, 200);
  for (const hook of ["updateActor", "createActor", "deleteActor"]) Hooks.on(hook, doc => { if (["settlement", "building", "unit"].includes(doc.type)) again(); });
}

/**
 * Тревоги королевства (PLAN 4.242): по видимым поселениям — ждёт решения, нехватка по прогнозу, шанс бунта, осада,
 * бездомные. Строки «Поселение: что».
 */
export function realmAlerts() {
  const out = [];
  for (const a of game.actors.filter(x => x.type === "settlement" && x.visible)) {
    const sys = a.system, sum = sys.summary, fc = sys.forecast;
    if (sys.decisions.length) out.push(`${a.name}: ждёт решения правителя`);
    if (sys.siege.units.length) out.push(`${a.name}: в осаде ${sys.siege.weeks} нед.`);
    const short = [...new Set((fc.shortages ?? []).map(s => String(s.resource).toLowerCase()))];
    if (short.length) out.push(`${a.name}: не хватит — ${short.join(", ")}`);
    if (sum.revolt) out.push(`${a.name}: шанс бунта ${sum.revolt}%`);
    if (sum.homeless) out.push(`${a.name}: бездомных ${sum.homeless}`);
  }
  return out;
}

/** Значок тревог на кнопке Совета: число и подсказка со списком; тревог нет — значка нет. */
function paintAlerts(btn) {
  const list = realmAlerts();
  let badge = btn.querySelector(".vd-council-badge");
  if (!list.length) { badge?.remove(); btn.removeAttribute("data-tooltip"); return; }
  if (!badge) { badge = document.createElement("b"); badge.className = "vd-council-badge"; btn.append(badge); }
  badge.textContent = String(list.length);
  btn.dataset.tooltip = list.join("<br>");
}
