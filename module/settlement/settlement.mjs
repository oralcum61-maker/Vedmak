// Действия поселения (PLAN 4.183, 4.185): стройка, снос, семьи на работе, склад, Богатство и ход недели.
// Постройки — вложенные предметы «Постройка»: заложить можно встроенную по журналу мира (config/settlement.mjs), свою
// постройку ведущего из мира или перетащить предмет на лист. Владелец поселения (игрок-правитель) строит и ставит
// семьи на работу; неделю двигает ведущий, он же правит одобрение, Контроль, Ополчение и склад.

import { BUILDINGS, WEALTH_RATE, BUY_MARKUP, resourceIcon, buildingItemData, priceOf } from "../config/settlement.mjs";
import { simulateWeek, canAfford, costLabel, buildingState, levelDef, WEALTH } from "./rules.mjs";
import { worldCurrency } from "../config/money.mjs";
import { postCard } from "../combat/common.mjs";

const { DialogV2 } = foundry.applications.api;
const LOG_LIMIT = 40;
const rand = () => (CONFIG.Dice.randomUniform ?? Math.random)();

/** Цена подписью. */
export const priceLabel = cost => costLabel(cost);

/** Данные постройки: ключ встроенной, uuid предмета мира или сами данные предмета. */
export async function buildingSource(src) {
  if (!src) return null;
  if (typeof src === "object") return foundry.utils.deepClone(src);
  if (BUILDINGS[src]) return buildingItemData(src);
  const item = await fromUuid(src);
  return item?.type === "building" ? item.toObject() : null;
}

/** Хватает ли склада и казны: null — да, иначе {ok: false, why}. */
function affordable(actor, cost) {
  const state = { stock: actor.system.stockMap, wealth: actor.system.wealth };
  if (canAfford(state, cost)) return null;
  const miss = cost.filter(c => (c.resource === WEALTH ? state.wealth : state.stock[c.resource] ?? 0) < c.qty).map(c => c.resource);
  return { ok: false, why: "Не хватает: " + miss.join(", ") + "." };
}

/** Можно ли заложить: уникальная — одна на поселение; хватает ли склада и казны на первый уровень. */
export function canBuild(actor, data) {
  if (!data || data.type !== "building") return { ok: false, why: "Это не постройка." };
  const b = buildingState(data);
  const first = b.levels[0];
  if (!first) return { ok: false, why: "У постройки нет ни одного уровня." };
  if (b.unique && actor.system.buildings.some(x => x.key === b.key)) return { ok: false, why: "Такая постройка уже есть." };
  return affordable(actor, first.cost) ?? { ok: true, cost: first.cost, weeks: first.weeks };
}

/** Списать цену со склада и казны. */
async function pay(actor, cost) {
  const stock = actor.system.stockMap;
  const update = {};
  for (const c of cost) {
    if (c.resource === WEALTH) update["system.wealth"] = Math.round((actor.system.wealth - c.qty) * 1000) / 1000;
    else update["system.stock." + c.resource] = Math.round((stock[c.resource] - c.qty) * 10) / 10;
  }
  if (Object.keys(update).length) await actor.update(update);
}

/** Заложить постройку: цена списывается сразу; строят свободные семьи (0 недель — готова сразу). */
export async function build(actor, src) {
  const data = await buildingSource(src);
  const check = canBuild(actor, data);
  if (!check.ok) return ui.notifications.warn(check.why);
  delete data._id;
  Object.assign(data.system, { level: check.weeks ? 0 : 1, constructing: !!check.weeks, progress: 0, workers: 0 });
  await pay(actor, check.cost);
  const [item] = await actor.createEmbeddedDocuments("Item", [data]);
  return item;
}

/** Улучшить постройку до следующего уровня: цена сразу, стройка — свободными семьями. */
export async function upgrade(actor, id) {
  const item = actor.items.get(id);
  if (!item) return;
  const b = buildingState(item);
  const next = levelDef(b, b.level + 1);
  if (b.constructing || !next || b.level >= b.levels.length) return;
  const miss = affordable(actor, next.cost);
  if (miss) return ui.notifications.warn(miss.why);
  await pay(actor, next.cost);
  if (!next.weeks) await item.update({ "system.level": b.level + 1 });
  else await item.update({ "system.constructing": true, "system.progress": 0 });
}

/**
 * Торговый пост: продать или купить ресурс. Цена — монет валюты мира за единицу (config/settlement.mjs), покупка
 * ×1,5; в казне это Богатство по курсу.
 */
export async function trade(actor, resource, qty, mode) {
  const sys = actor.system;
  if (!sys.summary.trade) return ui.notifications.warn("Без торгового поста купцы не заезжают.");
  qty = Math.floor(Number(qty) || 0);
  if (!resource || qty <= 0 || resource === WEALTH) return;
  const have = sys.stockMap[resource] ?? 0;
  if (mode === "sell") {
    if (have < qty) return ui.notifications.warn("На складе меньше: " + have + ".");
    const gain = (priceOf(resource) * qty) / WEALTH_RATE;
    await actor.update({ ["system.stock." + resource]: have - qty, "system.wealth": Math.round((sys.wealth + gain) * 1000) / 1000 });
  } else {
    const price = (Math.ceil(priceOf(resource) * BUY_MARKUP) * qty) / WEALTH_RATE;
    if (sys.wealth < price) return ui.notifications.warn("В казне меньше " + Math.round(price * 1000) / 1000 + " Богатства.");
    const room = Math.max(0, sys.summary.storage - have);
    if (qty > room) return ui.notifications.warn("На складе места на " + room + ".");
    await actor.update({ ["system.stock." + resource]: have + qty, "system.wealth": Math.round((sys.wealth - price) * 1000) / 1000 });
  }
}

/** Снести постройку (или бросить стройку): потраченное не возвращается. */
export async function demolish(actor, id) {
  const item = actor.items.get(id);
  if (!item) return;
  const ok = await DialogV2.confirm({
    window: { title: `Снести: ${item.name}` },
    content: `<p>${item.system.level ? "Постройка будет снесена" : "Стройка будет брошена"}; потраченное не вернётся.</p>`,
    rejectClose: false
  });
  if (ok) await item.delete();
}

/** Поставить семьи на работу: не больше мест и свободных семей. */
export async function setWorkers(actor, id, value) {
  const item = actor.items.get(id);
  const max = item ? levelDef(buildingState(item), item.system.level)?.families ?? 0 : 0;
  if (!max) return;
  const others = Object.entries(actor.system.summary.workers).filter(([k]) => k !== id).reduce((s, [, n]) => s + n, 0);
  await item.update({ "system.workers": Math.max(0, Math.min(max, value, actor.system.families - others)) });
}

/** Склад (ведущий): поставить количество ресурса, добавить новый или убрать. */
export async function setStock(actor, name, qty) {
  name = String(name ?? "").trim();
  if (!name || name.includes(".")) return ui.notifications.warn("Название ресурса — без точек.");
  if (qty === null) return actor.update({ [`system.stock.-=${name}`]: null });
  return actor.update({ [`system.stock.${name}`]: Math.max(0, Math.round((Number(qty) || 0) * 10) / 10) });
}

/**
 * Казна и кошелёк персонажа пользователя: внести (deposit) или взять Богатство. Единица Богатства — WEALTH_RATE
 * монет валюты мира (журнал: 500 оренов).
 */
export async function moveWealth(actor, units, mode) {
  const hero = game.user.character;
  if (!hero) return ui.notifications.warn("Назначьте себе персонажа (настройки пользователя), чтобы вносить и брать Богатство.");
  if (!hero.isOwner) return ui.notifications.warn(`${hero.name} — не ваш персонаж.`);
  const cur = worldCurrency();
  const n = Math.floor(Number(units) || 0);
  if (n <= 0) return;
  const purse = hero.system.money?.[cur.key] ?? 0;
  const coins = n * WEALTH_RATE;
  if (mode === "deposit") {
    if (purse < coins) return ui.notifications.warn(`Нужно ${coins} ${cur.abbr}, у ${hero.name} — ${purse}.`);
    await hero.update({ [`system.money.${cur.key}`]: purse - coins });
    await actor.update({ "system.wealth": actor.system.wealth + n });
  } else {
    if (actor.system.wealth < n) return ui.notifications.warn(`В казне только ${actor.system.wealth} Богатства.`);
    await actor.update({ "system.wealth": actor.system.wealth - n });
    await hero.update({ [`system.money.${cur.key}`]: purse + coins });
  }
}

/** Ход недели (ведущий): броски построек, нужды, итоги месяца, стройка, летопись и карточка в чат. */
export async function advanceWeek(actor) {
  if (!game.user.isGM) return ui.notifications.warn("Время двигает ведущий.");
  const { next, report } = simulateWeek(actor.system.state, { rand });
  const before = new Map(actor.system.buildings.map(b => [b.id, b]));
  const changes = next.buildings.filter(b => {
    const was = before.get(b.id);
    return was && (was.level !== b.level || was.constructing !== b.constructing || was.progress !== b.progress);
  }).map(b => ({ _id: b.id, "system.level": b.level, "system.constructing": b.constructing, "system.progress": b.progress }));
  await actor.update({
    "system.year": next.year, "system.month": next.month, "system.week": next.week,
    "system.families": next.families, "system.approval": next.approval, "system.wealth": next.wealth, "system.stock": next.stock,
    "system.log": [...actor.system.log, report].slice(-LOG_LIMIT)
  });
  if (changes.length) await actor.updateEmbeddedDocuments("Item", changes);
  await postCard({
    template: "systems/vedmak/templates/chat/settlement-week.hbs",
    data: weekCardData(actor, report),
    actor, speaker: ChatMessage.getSpeaker({ alias: actor.name })
  });
  return report;
}

/** Данные карточки недели. */
export function weekCardData(actor, report) {
  const net = Object.entries(report.net).filter(([, v]) => v).map(([k, v]) => ({ label: k, img: resourceIcon(k), net: v, plus: v > 0 }));
  return {
    name: actor.name, report, net,
    lines: report.lines.map(l => ({ ...l, dice: l.dice.length ? l.dice.join(", ") : "" })),
    shortages: report.shortages.map(s => `${s.building ? `${s.building}: ` : ""}${s.resource.toLowerCase()} ${s.got} из ${s.need}${s.upkeep ? " (содержание)" : ""}`).join("; "),
    wealth: report.wealthGain ? (report.wealthGain > 0 ? "+" : "") + report.wealthGain + " " + WEALTH + (report.taxWealth ? " (налог " + report.taxWealth + ")" : "") : "",
    overflow: Object.entries(report.overflow).map(([k, v]) => k.toLowerCase() + " " + v).join(", "),
    built: report.built.map(b => b.name + (b.level > 1 ? " (" + b.level + " ур.)" : "")).join(", ")
  };
}
