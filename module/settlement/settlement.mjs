// Действия поселения (PLAN 4.183, 4.185, 4.198): стройка, снос, семьи на работе, склад, Богатство и ход недели.
// Постройки — актёры «Постройка» с uuid поселения, в папке «Постройки: <поселение>»: заложить можно встроенную по журналу
// мира (config/settlement.mjs), образец ведущего из каталога (актёр-постройка без поселения) или перетащить образец на
// лист. Владелец поселения (игрок-правитель) строит и ставит семьи на работу; создавать актёров и папки Foundry даёт
// только ведущему — это делает его клиент (asGM). Неделю двигает ведущий, он же правит одобрение, Контроль и склад.

import { BUILDINGS, WEALTH_RATE, BUY_MARKUP, resourceIcon, buildingItemData, priceOf, orderTypes, orderCost, ORDER_TYPES } from "../config/settlement.mjs";
import { simulateWeek, canAfford, costLabel, buildingState, levelDef, activeLevel, upgradeNodes, WEALTH } from "./rules.mjs";
import { worldCurrency } from "../config/money.mjs";
import { postCard, asGM, registerGMHandler, userOwnsAny } from "../combat/common.mjs";
import { unitsWeek, clearBesieging } from "../army/army.mjs";

const { DialogV2 } = foundry.applications.api;
const LOG_LIMIT = 40;
const rand = () => (CONFIG.Dice.randomUniform ?? Math.random)();

/** Цена подписью. */
export const priceLabel = cost => costLabel(cost);

/** Состояние в поселении — не часть образца: копия закладывается заново. */
const STATE_KEYS = ["level", "constructing", "progress", "workers", "settlement", "upgrades", "research"];

/**
 * Данные постройки для стройки: ключ встроенной, uuid образца (актёр-постройка или старый предмет «Постройка») или
 * сами данные. Без состояния и без _id — это чертёж.
 */
export async function buildingSource(src) {
  if (!src) return null;
  let data = null;
  if (typeof src === "object") data = foundry.utils.deepClone(src);
  else if (BUILDINGS[src]) data = buildingItemData(src);
  else {
    const doc = await fromUuid(src);
    if (doc?.type === "building") data = doc.toObject();
  }
  if (!data) return null;
  data.type = "building";
  for (const k of ["_id", "folder", "ownership", "sort", "_stats", "items", "effects"]) delete data[k];
  for (const k of STATE_KEYS) delete data.system?.[k];
  // Старый образец без дерева — дерево встроенной постройки с тем же кодом
  const key = data.system?.key;
  if (data.system && !data.system.branches?.length && BUILDINGS[key]) data.system.branches = buildingItemData(key).system.branches;
  return data;
}

/** Актёр-постройка этого поселения по id (чужие и образцы — нет). */
export function buildingOf(actor, id) {
  const b = game.actors.get(id);
  return b?.type === "building" && b.system.settlement === actor.uuid ? b : null;
}

/** Папки в создании: две стройки подряд (стартовые постройки и первая заложенная) не создают две папки. */
const folderMaking = new Map();

/** Папка «Постройки: <поселение>» — внутри папки поселения; создаёт ведущий. */
async function buildingFolder(settlement) {
  const SYS = "vedmak";
  const found = game.folders.find(f => f.type === "Actor" && f.getFlag(SYS, "settlement") === settlement.uuid);
  if (found) return found;
  if (!folderMaking.has(settlement.uuid)) {
    folderMaking.set(settlement.uuid, Folder.create({ name: `Постройки: ${settlement.name}`, type: "Actor",
      folder: settlement.folder?.id ?? null, color: "#5c4a32", flags: { [SYS]: { settlement: settlement.uuid } } })
      .finally(() => folderMaking.delete(settlement.uuid)));
  }
  return folderMaking.get(settlement.uuid);
}

/**
 * Создать актёров-построек поселения (ведущий): папка поселения, права — как у поселения, жетон связан с актёром.
 * @param {Actor} settlement
 * @param {object[]} list — данные построек (buildingSource) с состоянием в system
 */
export async function createBuildings(settlement, list) {
  if (!list.length) return [];
  const folder = await buildingFolder(settlement);
  const ownership = foundry.utils.deepClone(settlement.ownership);
  const last = Math.max(0, ...settlement.system.buildingActors.map(a => a.sort));
  const data = list.map((d, i) => foundry.utils.mergeObject(d, {
    folder: folder.id, ownership, sort: last + (i + 1) * CONST.SORT_INTEGER_DENSITY,
    system: { settlement: settlement.uuid }, prototypeToken: { name: d.name, actorLink: true }
  }, { inplace: false }));
  return Actor.implementation.createDocuments(data);
}

/** Ведущий по просьбе игрока: заложить постройку его поселения (цену игрок уже заплатил). */
async function buildForUser({ settlementUuid, data }, userId) {
  const settlement = await fromUuid(settlementUuid);
  if (settlement?.type !== "settlement" || !userOwnsAny(userId, settlement)) return;
  await createBuildings(settlement, [data]);
}

/** Ведущий по просьбе игрока: снести постройку его поселения. */
async function demolishForUser({ uuid }, userId) {
  const b = await fromUuid(uuid);
  if (b?.type !== "building" || !userOwnsAny(userId, b.system.settlementActor)) return;
  await b.delete();
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

/**
 * Заложить постройку: цена списывается сразу; строят свободные семьи (0 недель — готова сразу). Ведущему возвращает
 * актёра; игроку — true (актёра создаст клиент ведущего).
 */
export async function build(actor, src) {
  const data = await buildingSource(src);
  const check = canBuild(actor, data);
  if (!check.ok) return ui.notifications.warn(check.why);
  Object.assign(data.system, { level: check.weeks ? 0 : 1, constructing: !!check.weeks, progress: 0, workers: 0 });
  if (!game.user.isGM && !game.users.activeGM) return ui.notifications.warn("Заложить постройку можно, когда ведущий в игре.");
  await pay(actor, check.cost);
  if (!game.user.isGM) { await asGM("settlementBuild", { settlementUuid: actor.uuid, data }); return true; }
  const [made] = await createBuildings(actor, [data]);
  return made;
}

/** Улучшить постройку до следующего уровня: цена сразу, стройка — свободными семьями. */
export async function upgrade(actor, id) {
  const item = buildingOf(actor, id);
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
 * Можно ли взять ступень прокачки: постройка готова и не строится, другой ступени в работе нет, уровень постройки
 * достаточен, предыдущая ступень ветки взята; хватает ли склада и казны поселения.
 * @returns {{ok: boolean, why?: string, node?: object}}
 */
export function canResearch(settlement, building, nodeId) {
  const b = buildingState(building);
  const node = upgradeNodes(b).find(x => x.id === nodeId);
  if (!node) return { ok: false, why: "Нет такой ступени." };
  if (b.upgrades.includes(node.id)) return { ok: false, why: "Уже взята." };
  if (!b.level) return { ok: false, why: "Сначала постройте." };
  if (b.constructing) return { ok: false, why: "Идёт стройка уровня." };
  if (b.level < node.level) return { ok: false, why: `Нужен ${node.level}-й уровень постройки.` };
  if (node.requires && !b.upgrades.includes(node.requires)) {
    const prev = upgradeNodes(b).find(x => x.id === node.requires);
    return { ok: false, why: `Сначала — «${prev?.name ?? "предыдущая ступень"}».` };
  }
  if (b.research.node) return { ok: false, why: "Другая ступень уже строится." };
  if (!settlement) return { ok: false, why: "Постройка не в поселении." };
  return affordable(settlement, node.cost) ?? { ok: true, node };
}

/** Взять ступень прокачки: цена со склада поселения сразу; недели строят семьи без дела (0 — готова сразу). */
export async function research(settlement, buildingId, nodeId) {
  const building = buildingOf(settlement, buildingId);
  if (!building) return;
  const check = canResearch(settlement, building, nodeId);
  if (!check.ok) return ui.notifications.warn(check.why);
  await pay(settlement, check.node.cost);
  if (!check.node.weeks) await building.update({ "system.upgrades": [...building.system.upgrades, nodeId] });
  else await building.update({ "system.research": { node: nodeId, progress: 0 } });
  return check.node;
}

/** Бросить ступень в работе (потраченное не возвращается). */
export async function cancelResearch(settlement, buildingId) {
  const building = buildingOf(settlement, buildingId);
  if (building?.system.research.node) await building.update({ "system.research": { node: "", progress: 0 } });
}

/**
 * Заказ в мастерской (PLAN 4.203): предмет (из компендиума, мира или с листа) для персонажа forActor. Цена со склада
 * поселения сразу; делается неделями, пока в постройке работают; готовый предмет — у заказчика.
 */
export async function placeOrder(settlement, buildingId, item, forActor, qty = 1) {
  const b = buildingOf(settlement, buildingId);
  if (!b || !item) return;
  const types = orderTypes(b.system.key, b.system.group);
  if (!types.includes(item.type)) return ui.notifications.warn(`«${b.name}» не делает такого: ${types.map(t => ORDER_TYPES[t]).join(", ") || "заказов не берёт"}.`);
  if (!b.system.level) return ui.notifications.warn("Сначала постройте.");
  qty = Math.max(1, Math.floor(Number(qty) || 1));
  const { cost, weeks } = orderCost(item.type, item.system.cost, qty, item.name);
  const miss = affordable(settlement, cost);
  if (miss) return ui.notifications.warn(miss.why);
  await pay(settlement, cost);
  const order = { id: foundry.utils.randomID(), uuid: item.uuid, name: item.name, img: item.img, type: item.type, qty,
    for: forActor?.uuid ?? "", forName: forActor?.name ?? "", weeks, progress: 0, cost };
  await b.update({ "system.orders": [...b.system.toObject().orders, order] });
  return order;
}

/** Снять заказ (потраченное не возвращается). */
export async function cancelOrder(settlement, buildingId, orderId) {
  const b = buildingOf(settlement, buildingId);
  if (b) await b.update({ "system.orders": b.system.toObject().orders.filter(o => o.id !== orderId) });
}

/**
 * Неделя мастерских (ведущий): у каждой постройки с заказами и людьми на работе первый заказ — на неделю ближе;
 * готовый — предметом у заказчика. Строки отчёта.
 */
async function ordersWeek(settlement) {
  const lines = [];
  const workers = settlement.system.summary.workers;
  for (const b of settlement.system.buildingActors) {
    const orders = b.system.toObject().orders;
    if (!orders.length || !b.system.level) continue;
    const lv = activeLevel(buildingState(b));
    if (lv?.families && !(workers[b.id] > 0)) { lines.push(`${b.name}: заказ «${orders[0].name}» стоит — никто не работает`); continue; }
    const o = orders[0];
    o.progress += 1;
    if (o.progress >= o.weeks) {
      orders.shift();
      const src = await fromUuid(o.uuid);
      const who = o.for ? await fromUuid(o.for) : null;
      if (src && who) {
        const data = src.toObject();
        delete data._id;
        if (data.system && "quantity" in data.system) data.system.quantity = o.qty;
        await who.createEmbeddedDocuments("Item", [data]);
        lines.push(`${b.name}: готово «${o.name}»${o.qty > 1 ? ` ×${o.qty}` : ""} — у ${who.name}`);
      } else lines.push(`${b.name}: готово «${o.name}», но ${src ? "заказчика нет" : "образца больше нет"} — выдайте вручную`);
    } else lines.push(`${b.name}: «${o.name}» — ${o.progress} из ${o.weeks} нед.`);
    await b.update({ "system.orders": orders });
  }
  return lines;
}

/** Караван (PLAN 4.203): добавить маршрут — каждую неделю qty ресурса в поселение to. */
export async function addRoute(settlement, to, resource, qty) {
  resource = String(resource ?? "").trim();
  qty = Math.max(0, Number(qty) || 0);
  if (!to || to === settlement.uuid || !resource || !qty) return ui.notifications.warn("Укажите, куда, какой ресурс и сколько.");
  if (resource.includes(".")) return ui.notifications.warn("Название ресурса — без точек.");
  await settlement.update({ "system.routes": [...settlement.system.toObject().routes, { id: foundry.utils.randomID(), to, resource, qty }] });
}

export async function removeRoute(settlement, id) {
  await settlement.update({ "system.routes": settlement.system.toObject().routes.filter(r => r.id !== id) });
}

/**
 * Караваны недели (ведущий): со своего склада (после недели) — в другие поселения, не больше, чем там поместится.
 * Без торговли (торговый пост, рынок) и в осаде караваны не ходят. Возвращает склад после отправки и строки отчёта.
 */
async function caravansWeek(settlement, stock) {
  const lines = [];
  const routes = settlement.system.routes;
  if (!routes.length) return { stock, lines };
  if (!settlement.system.summary.trade) return { stock, lines: ["Караваны стоят: нет торгового поста или рынка."] };
  if (settlement.system.siege.units.length) return { stock, lines: ["Караваны стоят: поселение в осаде."] };
  stock = { ...stock };
  for (const r of routes) {
    const to = fromUuidSync(r.to);
    if (to?.type !== "settlement") { lines.push(`Караван «${r.resource}» — поселения назначения больше нет`); continue; }
    if (to.system.siege.units.length) { lines.push(`В ${to.name} караван не прошёл — осада`); continue; }
    const have = Math.round(((stock[r.resource] ?? 0)) * 10) / 10;
    const room = Math.max(0, to.system.summary.storage - (to.system.stockMap[r.resource] ?? 0));
    const sent = Math.min(r.qty, have, room);
    if (sent <= 0) { lines.push(`В ${to.name}: ${r.resource.toLowerCase()} — ${have <= 0 ? "нечего везти" : "там некуда сложить"}`); continue; }
    stock[r.resource] = Math.round((have - sent) * 10) / 10;
    await to.update({ [`system.stock.${r.resource}`]: Math.round(((to.system.stockMap[r.resource] ?? 0) + sent) * 10) / 10 });
    lines.push(`В ${to.name}: ${r.resource.toLowerCase()} ${sent}`);
  }
  return { stock, lines };
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
  const item = buildingOf(actor, id);
  if (!item) return;
  const ok = await DialogV2.confirm({
    window: { title: `Снести: ${item.name}` },
    content: `<p>${item.system.level ? "Постройка будет снесена" : "Стройка будет брошена"}; потраченное не вернётся.</p>`,
    rejectClose: false
  });
  if (!ok) return;
  if (game.user.isGM || item.canUserModify(game.user, "delete")) await item.delete();
  else await asGM("settlementDemolish", { uuid: item.uuid });
}

/** Поставить семьи на работу: не больше мест и свободных семей. */
export async function setWorkers(actor, id, value) {
  const item = buildingOf(actor, id);
  const max = item ? activeLevel(buildingState(item))?.families ?? 0 : 0;
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
  // Отряды поселения: еда со склада, плата наёмникам, тренировка, боевой дух (PLAN 4.187)
  const army = await unitsWeek(actor, { stock: next.stock, wealth: next.wealth, drill: actor.system.summary.drill, rand });
  next.stock = army.stock; next.wealth = army.wealth;
  report.army = army.lines; report.armyFood = army.food ?? 0; report.armyFed = army.fed ?? 1;
  report.orders = await ordersWeek(actor);
  // Осада (PLAN 4.203): под стенами остаются отряды в походе, не бежавшие; нет никого — осада снята
  const besiegers = actor.system.siege.units.map(u => fromUuidSync(u)).filter(u => u?.system.campaign && !u.system.routed && u.system.soldiers > 0
    && u.system.besieging === actor.uuid);
  const siegeUpdate = besiegers.length
    ? { "system.siege.units": besiegers.map(u => u.uuid), "system.siege.weeks": actor.system.siege.weeks + 1 }
    : (actor.system.siege.units.length ? { "system.siege.units": [], "system.siege.weeks": 0 } : {});
  // Отпавшим (бежали, вернулись, перебиты) — отметку осады снять
  await clearBesieging(actor.system.siege.units.filter(u => !besiegers.some(b => b.uuid === u)), actor.uuid);
  if (besiegers.length) report.events.push({ kind: "siege", text: `Под стенами ${besiegers.map(u => u.name).join(", ")} — ${actor.system.siege.weeks + 1}-я неделя осады.`, danger: true });
  else if (actor.system.siege.units.length) report.events.push({ kind: "siege", text: "Осада снята: под стенами никого." });
  const caravans = await caravansWeek(actor, next.stock);
  next.stock = caravans.stock; report.caravans = caravans.lines;
  const before = new Map(actor.system.buildings.map(b => [b.id, b]));
  const changes = next.buildings.filter(b => {
    const was = before.get(b.id);
    return was && (was.level !== b.level || was.constructing !== b.constructing || was.progress !== b.progress
      || was.research.node !== b.research.node || was.research.progress !== b.research.progress || was.upgrades.length !== b.upgrades.length);
  }).map(b => ({ _id: b.id, "system.level": b.level, "system.constructing": b.constructing, "system.progress": b.progress,
    "system.research": b.research, "system.upgrades": b.upgrades }));
  await actor.update({
    "system.year": next.year, "system.month": next.month, "system.week": next.week,
    "system.families": next.families, "system.approval": next.approval, "system.wealth": next.wealth, "system.stock": next.stock,
    "system.log": [...actor.system.log, report].slice(-LOG_LIMIT), ...siegeUpdate
  });
  if (changes.length) await Actor.implementation.updateDocuments(changes);
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
    army: (report.army ?? []).map(a => ({ name: a.name, notes: a.notes.join("; ") })), armyHungry: (report.armyFed ?? 1) < 1,
    orders: report.orders ?? [], caravans: report.caravans ?? [],
    built: report.built.map(b => b.name + (b.level > 1 ? " (" + b.level + " ур.)" : "")).join(", ")
  };
}

/** Действия, которые за игрока делает клиент ведущего. */
export function registerSettlementGMHandlers() {
  registerGMHandler("settlementBuild", buildForUser);
  registerGMHandler("settlementDemolish", demolishForUser);
}
