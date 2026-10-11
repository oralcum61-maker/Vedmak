// Действия поселения (PLAN 4.183): стройка, улучшение, снос, работники, торговля, казна и ход недели.
// Владелец поселения (игрок-лорд) строит, ставит работников, налоги и торгует; неделю двигает ведущий.

import { BUILDINGS, RESOURCES, RESOURCE_KEYS, BUY_MARKUP } from "../config/settlement.mjs";
import { simulateWeek, levelDef, canAfford, costLabel } from "./rules.mjs";
import { worldCurrency, worldLabel, crownsToWorld } from "../config/money.mjs";
import { postCard } from "../combat/common.mjs";

const { DialogV2 } = foundry.applications.api;
const LOG_LIMIT = 40;

/** Списать цену с запаса и казны: данные обновления. */
function payUpdate(sys, cost = {}) {
  const update = {};
  for (const k of RESOURCE_KEYS) if (cost[k]) update[`system.stock.${k}`] = Math.round((sys.stock[k] - cost[k]) * 10) / 10;
  if (cost.money) update["system.money"] = Math.round((sys.money - cost.money) * 10) / 10;
  return update;
}

/** Цена подписью в валюте мира. */
export const priceLabel = cost => costLabel(cost, worldLabel);

/** Можно ли поставить постройку: уникальная — одна на поселение. */
export function canBuild(actor, key) {
  const def = BUILDINGS[key];
  if (!def) return { ok: false, why: "Нет такой постройки." };
  if (def.unique && actor.system.buildings.some(b => b.key === key)) return { ok: false, why: "Такая постройка уже есть." };
  if (!canAfford(actor.system, def.levels[0].cost)) return { ok: false, why: "Не хватает запасов или крон." };
  return { ok: true };
}

/** Заложить постройку: цена списывается сразу, строят свободные семьи. */
export async function build(actor, key) {
  const check = canBuild(actor, key);
  if (!check.ok) return ui.notifications.warn(check.why);
  const def = BUILDINGS[key];
  const buildings = [...actor.system.toObject().buildings,
    { id: foundry.utils.randomID(), key, name: def.label, level: 0, constructing: true, progress: 0, workers: 0 }];
  await actor.update({ ...payUpdate(actor.system, def.levels[0].cost), "system.buildings": buildings });
}

/** Улучшить постройку до следующего уровня. */
export async function upgrade(actor, id) {
  const list = actor.system.toObject().buildings;
  const b = list.find(x => x.id === id);
  const next = b && levelDef(b.key, b.level + 1);
  if (!b || b.constructing || !next || b.level >= BUILDINGS[b.key].levels.length) return;
  if (!canAfford(actor.system, next.cost)) return ui.notifications.warn("Не хватает запасов или крон на улучшение.");
  b.constructing = true; b.progress = 0;
  await actor.update({ ...payUpdate(actor.system, next.cost), "system.buildings": list });
}

/** Снести постройку (или бросить стройку): запасы не возвращаются. */
export async function demolish(actor, id) {
  const b = actor.system.buildings.find(x => x.id === id);
  if (!b) return;
  const ok = await DialogV2.confirm({
    window: { title: `Снести: ${b.name}` },
    content: `<p>${b.level ? "Постройка будет снесена" : "Стройка будет брошена"}; потраченное не вернётся.</p>`,
    rejectClose: false
  });
  if (!ok) return;
  await actor.update({ "system.buildings": actor.system.toObject().buildings.filter(x => x.id !== id) });
}

/** Поставить работников: не больше мест и свободных семей. */
export async function setWorkers(actor, id, value) {
  const list = actor.system.toObject().buildings;
  const b = list.find(x => x.id === id);
  const max = levelDef(b?.key, b?.level)?.workers ?? 0;
  if (!b || !max) return;
  const others = list.filter(x => x.id !== id).reduce((s, x) => s + (actor.system.summary.workers[x.id] ?? 0), 0);
  b.workers = Math.max(0, Math.min(max, value, actor.system.families - others));
  await actor.update({ "system.buildings": list });
}

/** Купить или продать на торговом посту: цена — книжная в кронах, покупка ×1,5. */
export async function trade(actor, key, qty, mode) {
  const sys = actor.system;
  if (!sys.summary.trade) return ui.notifications.warn("Без торгового поста купцы не заезжают.");
  const res = RESOURCES[key];
  qty = Math.floor(Number(qty) || 0);
  if (!res || qty <= 0) return;
  if (mode === "sell") {
    if (sys.stock[key] < qty) return ui.notifications.warn(`На складе меньше: ${sys.stock[key]}.`);
    await actor.update({ [`system.stock.${key}`]: sys.stock[key] - qty, "system.money": sys.money + res.price * qty });
  } else {
    const price = Math.ceil(res.price * BUY_MARKUP * qty);
    if (sys.money < price) return ui.notifications.warn(`В казне меньше ${worldLabel(price)}.`);
    const room = sys.summary.storage[key] - sys.stock[key];
    if (qty > room) return ui.notifications.warn(`На складе места на ${Math.max(0, Math.floor(room))}.`);
    await actor.update({ [`system.stock.${key}`]: sys.stock[key] + qty, "system.money": sys.money - price });
  }
}

/**
 * Казна и кошелёк персонажа пользователя: внести (deposit) или взять. Сумма — в монетах валюты мира; кошелёк
 * персонажа — та же валюта (system.money.<ключ>), казна — в кронах по курсу.
 */
export async function moveMoney(actor, amount, mode) {
  const hero = game.user.character;
  if (!hero) return ui.notifications.warn("Назначьте себе персонажа (настройки пользователя), чтобы вносить и брать деньги.");
  if (!hero.isOwner) return ui.notifications.warn(`${hero.name} — не ваш персонаж.`);
  const cur = worldCurrency();
  const coins = Math.floor(Number(amount) || 0);
  if (coins <= 0) return;
  const purse = hero.system.money?.[cur.key] ?? 0;
  const crowns = coins * cur.rate;
  if (mode === "deposit") {
    if (purse < coins) return ui.notifications.warn(`У ${hero.name} только ${purse} ${cur.abbr}`);
    await hero.update({ [`system.money.${cur.key}`]: purse - coins });
    await actor.update({ "system.money": actor.system.money + crowns });
  } else {
    if (actor.system.money < crowns) return ui.notifications.warn(`В казне только ${worldLabel(actor.system.money)}`);
    await actor.update({ "system.money": actor.system.money - crowns });
    await hero.update({ [`system.money.${cur.key}`]: purse + coins });
  }
}

/** Ход недели (ведущий): правила недели, летопись и карточка в чат. */
export async function advanceWeek(actor) {
  if (!game.user.isGM) return ui.notifications.warn("Время двигает ведущий.");
  const { next, report } = simulateWeek(actor.system.state);
  const log = [...actor.system.log, report].slice(-LOG_LIMIT);
  await actor.update({
    "system.week": next.week, "system.families": next.families, "system.money": next.money,
    "system.stock": next.stock, "system.buildings": next.buildings, "system.log": log
  });
  await postCard({
    template: "systems/vedmak/templates/chat/settlement-week.hbs",
    data: weekCardData(actor, report),
    actor, speaker: ChatMessage.getSpeaker({ alias: actor.name })
  });
  return report;
}

/** Данные карточки недели: только ненулевые изменения. */
export function weekCardData(actor, report) {
  const lines = RESOURCE_KEYS.filter(k => report.net[k] || report.produced[k] || report.consumed[k]).map(k => ({
    label: RESOURCES[k].label, img: RESOURCES[k].img, net: report.net[k], plus: report.net[k] > 0,
    produced: report.produced[k], consumed: report.consumed[k]
  }));
  const short = Object.entries(report.needs).filter(([, n]) => n.ratio < 1).map(([k, n]) => `${RESOURCES[k].label.toLowerCase()} ${n.got} из ${n.need}`);
  return {
    name: actor.name, img: actor.img, report, lines, short: short.join(", "),
    income: report.income ? worldLabel(report.income) : "", taxes: report.taxes ? worldLabel(report.taxes) : "",
    overflow: Object.entries(report.overflow).map(([k, v]) => `${RESOURCES[k].label.toLowerCase()} ${v}`).join(", "),
    built: report.built.map(b => `${b.name}${b.level > 1 ? ` (${b.level} ур.)` : ""}`).join(", ")
  };
}

export { crownsToWorld };
