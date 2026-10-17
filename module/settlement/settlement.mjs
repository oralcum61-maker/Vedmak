// Действия поселения (PLAN 4.183, 4.185, 4.198): стройка, снос, семьи на работе, склад, Богатство и ход недели.
// Постройки — актёры «Постройка» с uuid поселения, в папке «Постройки: <поселение>»: заложить можно встроенную по журналу
// мира (config/settlement.mjs), образец ведущего из каталога (актёр-постройка без поселения) или перетащить образец на
// лист. Владелец поселения (игрок-правитель) строит и ставит семьи на работу; создавать актёров и папки Foundry даёт
// только ведущему — это делает его клиент (asGM). Неделю двигает ведущий, он же правит одобрение, Контроль и склад.

import { BUILDINGS, WEALTH_RATE, BUY_MARKUP, resourceIcon, buildingItemData, priceOf, orderTypes, orderCost, ORDER_TYPES } from "../config/settlement.mjs";
import { simulateWeek, canAfford, costLabel, buildingState, levelDef, activeLevel, upgradeNodes, WEALTH, FOOD } from "./rules.mjs";
import { worldCurrency } from "../config/money.mjs";
import { postCard, asGM, registerGMHandler, userOwnsAny } from "../combat/common.mjs";
import { unitsWeek, clearBesieging, settlementUnits } from "../army/army.mjs";
import { autoResolve, rollMonthEvent, postPending, SETTLEMENT_EVENTS } from "./events.mjs";
import { playSound } from "../fx/sounds.mjs";
import { refuse, once } from "../util.mjs";
import { realmConfirm } from "../apps/realm-dialog.mjs";

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
  if (!check.ok) return refuse(check.why);
  Object.assign(data.system, { level: check.weeks ? 0 : 1, constructing: !!check.weeks, progress: 0, workers: 0 });
  if (!game.user.isGM && !game.users.activeGM) return refuse("Заложить постройку можно, когда ведущий в игре.");
  await pay(actor, check.cost);
  if (!game.user.isGM) { await asGM("settlementBuild", { settlementUuid: actor.uuid, data }); return true; }
  const [made] = await createBuildings(actor, [data]);
  playSound("ui-coin");
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
  if (miss) return refuse(miss.why);
  await pay(actor, next.cost);
  playSound("ui-coin");
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
  if (!check.ok) return refuse(check.why);
  await pay(settlement, check.node.cost);
  playSound("ui-coin");
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
  if (!types.includes(item.type)) return refuse(`«${b.name}» не делает такого: ${types.map(t => ORDER_TYPES[t]).join(", ") || "заказов не берёт"}.`);
  if (!b.system.level) return refuse("Сначала постройте.");
  qty = Math.max(1, Math.floor(Number(qty) || 1));
  const { cost, weeks } = orderCost(item.type, item.system.cost, qty, item.name);
  const miss = affordable(settlement, cost);
  if (miss) return refuse(miss.why);
  await pay(settlement, cost);
  playSound("ui-coin");
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
async function ordersWeek(settlement, given = []) {
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
        const [made] = await who.createEmbeddedDocuments("Item", [data]);
        if (made) given.push(made.uuid);
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
  if (!to || to === settlement.uuid || !resource || !qty) return refuse("Укажите, куда, какой ресурс и сколько.");
  if (resource.includes(".")) return refuse("Название ресурса — без точек.");
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
  if (!sys.summary.trade) return refuse("Без торгового поста купцы не заезжают.");
  qty = Math.floor(Number(qty) || 0);
  if (!resource || qty <= 0 || resource === WEALTH) return;
  const have = sys.stockMap[resource] ?? 0;
  if (mode === "sell") {
    if (have < qty) return refuse("На складе меньше: " + have + ".");
    const gain = (priceOf(resource) * qty) / WEALTH_RATE;
    await actor.update({ ["system.stock." + resource]: have - qty, "system.wealth": Math.round((sys.wealth + gain) * 1000) / 1000 });
    playSound("ui-coin");
  } else {
    const price = (Math.ceil(priceOf(resource) * BUY_MARKUP) * qty) / WEALTH_RATE;
    if (sys.wealth < price) return refuse("В казне меньше " + Math.round(price * 1000) / 1000 + " Богатства.");
    const room = Math.max(0, sys.summary.storage - have);
    if (qty > room) return refuse("На складе места на " + room + ".");
    await actor.update({ ["system.stock." + resource]: have + qty, "system.wealth": Math.round((sys.wealth - price) * 1000) / 1000 });
    playSound("ui-coin");
  }
}

/** Снести постройку (или бросить стройку): потраченное не возвращается. */
export async function demolish(actor, id) {
  const item = buildingOf(actor, id);
  if (!item) return;
  const ok = await realmConfirm("demolish", { title: `Снести: ${item.name}`,
    head: { img: item.img, name: item.name, sub: [item.system.level ? `уровень ${item.system.level}` : "стройка", actor.name], danger: true },
    text: `${item.system.level ? "Постройка будет снесена" : "Стройка будет брошена"}; потраченное не вернётся.` });
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
  if (!name || name.includes(".")) return refuse("Название ресурса — без точек.");
  // Удаление ключа в v14 — значением _del (ключ «-=имя» устарел и при строгой совместимости обрывает обновление)
  if (qty === null) return actor.update({ [`system.stock.${name}`]: _del });
  return actor.update({ [`system.stock.${name}`]: Math.max(0, Math.round((Number(qty) || 0) * 10) / 10) });
}

/**
 * Казна и кошелёк персонажа пользователя: внести (deposit) или взять Богатство. Единица Богатства — WEALTH_RATE
 * монет валюты мира (журнал: 500 оренов).
 */
export async function moveWealth(actor, units, mode) {
  const hero = game.user.character;
  if (!hero) return refuse("Назначьте себе персонажа (настройки пользователя), чтобы вносить и брать Богатство.");
  if (!hero.isOwner) return refuse(`${hero.name} — не ваш персонаж.`);
  const cur = worldCurrency();
  // Десятыми долями: казна копит дробное Богатство (торговля, налог), и остаток раньше было не взять
  const n = Math.floor((Number(units) || 0) * 10) / 10;
  if (n <= 0) return;
  const purse = hero.system.money?.[cur.key] ?? 0;
  const coins = Math.round(n * WEALTH_RATE);
  if (mode === "deposit") {
    if (purse < coins) return refuse(`Нужно ${coins} ${cur.abbr}, у ${hero.name} — ${purse}.`);
    await hero.update({ [`system.money.${cur.key}`]: purse - coins });
    await actor.update({ "system.wealth": Math.round((actor.system.wealth + n) * 1000) / 1000 });
    playSound("ui-coin");
  } else {
    if (actor.system.wealth < n) return refuse(`В казне только ${actor.system.wealth} Богатства.`);
    await actor.update({ "system.wealth": Math.round((actor.system.wealth - n) * 1000) / 1000 });
    await hero.update({ [`system.money.${cur.key}`]: purse + coins });
    playSound("ui-coin");
  }
}

/**
 * Ход недели (ведущий): броски построек, нужды, итоги месяца, стройка, летопись и карточка в чат. Одна неделя за раз:
 * двойной щелчок (лист, Совет правителя) гнал две недели с одного и того же состояния.
 */
export function advanceWeek(actor) {
  return once(actor, "week", () => runWeek(actor));
}

/**
 * «Неделя прошла» с листа и из Совета (PLAN 4.239): сначала предпросмотр по прогнозу (средние броски), потом ход.
 * Предпросмотр выключается настройкой или отметкой «больше не спрашивать» в самом окне.
 */
export async function askWeek(actor) {
  if (!game.user.isGM) return refuse("Время двигает ведущий.");
  let ask = true;
  try { ask = game.settings.get("vedmak", "settlementWeekPreview"); } catch { /* настройки нет — спрашивать */ }
  if (!ask) return advanceWeek(actor);
  const ok = await realmConfirm("week", {
    title: `Неделя прошла: ${actor.name}`, template: "week", data: weekPreview(actor), yesLabel: "Неделя прошла", noLabel: "Отмена",
    head: { img: actor.img, name: actor.name, sub: ["неделя прошла", weekPreview(actor).when] },
    onYes: form => { if (form?.elements?.skip?.checked) game.settings.set("vedmak", "settlementWeekPreview", false); }
  });
  if (ok) return advanceWeek(actor);
}

/** Данные предпросмотра недели: по прогнозу листа (sys.forecast — средние броски). */
export function weekPreview(actor) {
  const sys = actor.system;
  const fc = sys.forecast;
  const sum = sys.summary;
  const stock = sys.stockMap;
  const n = v => (Math.round((Number(v) || 0) * 10) / 10).toLocaleString("ru-RU");
  // Еда войска (отряды дома) — тоже со склада: в строку «Еда»
  const units = settlementUnits(actor);
  const armyFood = units.reduce((s, u) => s + (u.system.campaign ? 0 : u.system.food), 0);
  const net = { ...(fc.net ?? {}) };
  if (armyFood) net[FOOD] = (net[FOOD] ?? 0) - armyFood;
  const rows = Object.entries(net).filter(([k, v]) => v && k !== WEALTH).map(([k, v]) => {
    const before = stock[k] ?? 0;
    return { label: k, before: n(before), after: n(Math.max(0, before + v)), dir: v > 0 ? "up" : "down", bad: before + v < 0 };
  });
  if (fc.wealthGain) rows.push({ label: "Казна, Богатство", before: n(sys.wealth), after: n(sys.wealth + fc.wealthGain), dir: fc.wealthGain > 0 ? "up" : "down" });
  const warn = (fc.shortages ?? []).map(s => `Не хватит: ${s.building ? `${s.building} — ` : ""}${String(s.resource).toLowerCase()} ${n(s.got)} из ${n(s.need)}.`);
  if (armyFood && (stock[FOOD] ?? 0) + (net[FOOD] ?? 0) < 0) warn.push(`Войску нужно еды ${n(armyFood)} — на складе не хватит, боевой дух упадёт.`);
  if (sys.decisions.length) warn.push(`Ждёт решения: ${sys.decisions.length} — не решат до хода, будет решение по умолчанию.`);
  const good = (fc.built ?? []).length ? [`Достроится: ${fc.built.map(b => b.name ?? b).join(", ")}.`] : [];
  const notes = [];
  if (armyFood) notes.push(`Из них войско съест ${n(armyFood)} еды.`);
  if (fc.monthEnd) {
    notes.push("Конец месяца: налоги, приход семей и шанс бунта.");
    if (sum.arrival?.chance) notes.push(`Приход семей — шанс ${sum.arrival.chance}%.`);
    if (sum.revolt) warn.push(`Шанс бунта ${sum.revolt}%.`);
  }
  const cal = sys.calendar;
  return { when: `${cal.monthLabel}, ${cal.week}-я неделя`, rows, warn, good, notes };
}

async function runWeek(actor) {
  if (!game.user.isGM) return refuse("Время двигает ведущий.");
  // Снимок для «Отменить неделю» (PLAN 4.240): всё, что ход меняет; сообщения и выданные предметы — по ходу
  const snap = weekSnapshot(actor);
  const msgsBefore = new Set(game.messages.map(m => m.id));
  // События месяца (PLAN 4.206): правитель не решил до хода — решение по умолчанию
  const resolved = await autoResolve(actor);
  const needsApproval = (() => { try { return game.settings.get("vedmak", "settlementNeedsApproval"); } catch { return false; } })();
  const { next, report } = simulateWeek(actor.system.state, { rand, needsApproval });
  report.events.unshift(...resolved);
  let decision = null;
  if (report.monthEnd) {
    decision = rollMonthEvent(actor, actor.system.calendar);
    const ev = decision ? SETTLEMENT_EVENTS[decision.key] : null;
    if (ev) report.events.push({ kind: "event", text: `Событие — «${ev.label}». ${ev.text} Решение — на листе поселения до следующего хода.`, danger: true });
  }
  // Отряды поселения: еда со склада, плата наёмникам, тренировка, боевой дух (PLAN 4.187)
  const army = await unitsWeek(actor, { stock: next.stock, wealth: next.wealth, drill: actor.system.summary.drill, rand });
  next.stock = army.stock; next.wealth = army.wealth;
  report.army = army.lines; report.armyFood = army.food ?? 0; report.armyFed = army.fed ?? 1;
  report.orders = await ordersWeek(actor, snap.given);
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
  // Летопись (PLAN 4.210): недели, что не помещаются на лист, — в журнал «Летопись: <поселение>»
  const fullLog = [...actor.system.log, report];
  if (fullLog.length > LOG_LIMIT) await archiveChronicle(actor, fullLog.slice(0, fullLog.length - LOG_LIMIT));
  const before = new Map(actor.system.buildings.map(b => [b.id, b]));
  const changes = next.buildings.filter(b => {
    const was = before.get(b.id);
    return was && (was.level !== b.level || was.constructing !== b.constructing || was.progress !== b.progress
      || was.research.node !== b.research.node || was.research.progress !== b.research.progress || was.upgrades.length !== b.upgrades.length);
  }).map(b => ({ _id: b.id, "system.level": b.level, "system.constructing": b.constructing, "system.progress": b.progress,
    "system.research": b.research, "system.upgrades": b.upgrades }));
  await actor.update({
    "system.year": next.year, "system.month": next.month, "system.week": next.week,
    "system.families": next.families, "system.approval": next.approval, "system.monthShort": next.monthShort, "system.wealth": next.wealth, "system.stock": next.stock,
    "system.log": fullLog.slice(-LOG_LIMIT), "system.modifiers": next.modifiers, ...siegeUpdate,
    ...(decision ? { "system.decisions": [...actor.system.toObject().decisions, decision] } : {})
  });
  if (changes.length) await Actor.implementation.updateDocuments(changes);
  if (decision) await postPending(actor, decision);
  await postCard({
    template: "systems/vedmak/templates/chat/settlement-week.hbs",
    data: weekCardData(actor, report),
    actor, speaker: ChatMessage.getSpeaker({ alias: actor.name })
  });
  snap.messages = game.messages.filter(m => !msgsBefore.has(m.id)).map(m => m.id);
  await actor.setFlag("vedmak", "lastWeek", snap);
  return report;
}

/* ------------------------------ Отмена недели (PLAN 4.240) ------------------------------ */

const WEEK_FIELDS = ["year", "month", "week", "families", "approval", "monthShort", "wealth", "stock", "log", "modifiers", "siege", "decisions"];
const BUILDING_FIELDS = ["level", "constructing", "progress", "research", "upgrades", "orders"];
const UNIT_FIELDS = ["training", "progress", "morale", "soldiers", "routed", "xp", "research", "upgrades", "supplies", "besieging"];
const pick = (sys, keys) => Object.fromEntries(keys.map(k => [k, foundry.utils.deepClone(sys[k])]));

/** Снимок поселения, его построек, отрядов и складов, куда идут караваны, — до хода недели. */
function weekSnapshot(actor) {
  const sys = actor.system.toObject();
  return {
    when: `${actor.system.calendar.monthLabel}, ${actor.system.calendar.week}-я неделя`,
    settlement: pick(sys, WEEK_FIELDS),
    buildings: actor.system.buildingActors.map(b => ({ uuid: b.uuid, ...pick(b.system.toObject(), BUILDING_FIELDS) })),
    units: settlementUnits(actor).map(u => ({ uuid: u.uuid, ...pick(u.system.toObject(), UNIT_FIELDS) })),
    routes: [...new Set(actor.system.routes.map(r => r.to))].map(uuid => fromUuidSync(uuid)).filter(Boolean)
      .map(t => ({ uuid: t.uuid, stock: foundry.utils.deepClone(t.system.toObject().stock) })),
    given: [], messages: []
  };
}

/** Есть ли что отменить (только последняя неделя, только ведущему). */
export function lastWeek(actor) {
  return game.user.isGM ? actor.getFlag("vedmak", "lastWeek") ?? null : null;
}

/** Отменить последнюю неделю: вернуть снимок, убрать выданные по заказам предметы и сообщения хода. */
export async function undoWeek(actor) {
  const snap = lastWeek(actor);
  if (!snap) return refuse("Отменять нечего: неделя ещё не проходила или уже отменена.");
  const ok = await realmConfirm("undo-week", {
    title: `Отменить неделю: ${actor.name}`, yesLabel: "Отменить неделю", noLabel: "Оставить",
    head: { img: actor.img, name: actor.name, sub: ["отменить неделю", snap.when], danger: true },
    text: `Поселение вернётся к «${snap.when}»: склад, казна, семьи, стройки, заказы, отряды и караваны — как до хода.`,
    hint: `${snap.given.length ? `Выданное по заказам (${snap.given.length}) заберётся у персонажей. ` : ""}Карточки недели в чате удалятся. Летопись, уже перенесённая в журнал, останется там.`
  });
  if (!ok) return;
  // Объекты-словари (склад) — заменой целиком (оператор «==»): ресурсы, появившиеся за неделю, уходят; остальное — обычным
  // обновлением полей (recursive: false заменил бы весь system — пропадали постройки и караваны)
  const replace = new Set(["stock"]);
  const update = Object.fromEntries(Object.entries(snap.settlement).map(([k, v]) => [replace.has(k) ? `system.==${k}` : `system.${k}`, v]));
  await actor.update(update, { diff: false });
  const docs = [...snap.buildings, ...snap.units].map(s => {
    const doc = fromUuidSync(s.uuid);
    return doc ? { _id: doc.id, ...Object.fromEntries(Object.entries(s).filter(([k]) => k !== "uuid").map(([k, v]) => [`system.${k}`, v])) } : null;
  }).filter(Boolean);
  if (docs.length) await Actor.implementation.updateDocuments(docs, { diff: false });
  for (const r of snap.routes) await fromUuidSync(r.uuid)?.update({ "system.==stock": r.stock }, { diff: false });
  for (const uuid of snap.given) await (await fromUuid(uuid))?.delete();
  const msgs = snap.messages.filter(id => game.messages.has(id));
  if (msgs.length) await ChatMessage.implementation.deleteDocuments(msgs);
  await actor.unsetFlag("vedmak", "lastWeek");
  ui.notifications.info(`«${actor.name}»: неделя отменена — снова ${snap.when}.`);
}

/* ------------------------------ Летопись в журнале (PLAN 4.210) ------------------------------ */

const CHRONICLE_FOLDER = "Летописи поселений";
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sgn = n => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(Math.round(n * 100) / 100).toLocaleString("ru-RU");

/** Неделя летописи — строками HTML для журнала. */
export function reportHtml(r) {
  const net = Object.entries(r.net ?? {}).filter(([, v]) => v).map(([k, v]) => `${k} ${sgn(v)}`).join(" · ");
  const short = (r.shortages ?? []).map(s => `${String(s.resource).toLowerCase()} ${s.got} из ${s.need}`).join(", ");
  const built = (r.built ?? []).map(b => b.name ?? b).join(", ");
  const lines = [
    net && `<p>${esc(net)}</p>`, r.wealthGain ? `<p>Казна: ${sgn(r.wealthGain)} Богатства</p>` : "",
    short && `<p><em>Не хватило:</em> ${esc(short)}</p>`, ...(r.events ?? []).map(e => `<p>${esc(e.text)}</p>`),
    built && `<p><em>Достроено:</em> ${esc(built)}</p>`
  ].filter(Boolean).join("");
  return `<h3>${esc(r.monthLabel ?? "")}, ${r.week}-я неделя</h3>${lines || "<p>Тихая неделя.</p>"}`;
}

/** Журнал «Летопись: <поселение>» (по флагу — переживает переименование); нет — создаётся (ведущий). */
async function chronicleJournal(actor, create = true) {
  let j = game.journal.get(actor.getFlag("vedmak", "chronicle") ?? "");
  if (j || !create || !game.user.isGM) return j ?? null;
  const folder = game.folders.find(f => f.type === "JournalEntry" && f.name === CHRONICLE_FOLDER)
    ?? await Folder.create({ name: CHRONICLE_FOLDER, type: "JournalEntry", color: "#5c4a32" });
  j = await JournalEntry.create({ name: `Летопись: ${actor.name}`, folder: folder.id, ownership: foundry.utils.deepClone(actor.ownership) });
  await actor.setFlag("vedmak", "chronicle", j.id);
  return j;
}

/** Дописать недели в журнал: страница на каждый год, недели — по порядку. */
export async function archiveChronicle(actor, reports) {
  if (!game.user.isGM || !reports.length) return null;
  const j = await chronicleJournal(actor);
  const byYear = new Map();
  for (const r of reports) byYear.set(r.year, [...(byYear.get(r.year) ?? []), r]);
  for (const [year, list] of byYear) {
    const name = `Год ${year}`;
    const html = list.map(reportHtml).join("");
    const page = j.pages.find(p => p.name === name);
    if (page) await page.update({ "text.content": (page.text.content ?? "") + html });
    else await j.createEmbeddedDocuments("JournalEntryPage", [{ name, type: "text", text: { content: html }, sort: year * 10 }]);
  }
  return j;
}

/** Ведущий: перенести всю летопись листа в журнал (лист очищается). */
export async function moveChronicle(actor) {
  if (!game.user.isGM) return;
  const log = actor.system.log;
  if (!log.length) return ui.notifications.info("Летопись пуста.");
  const j = await archiveChronicle(actor, log);
  await actor.update({ "system.log": [] });
  ui.notifications.info(`Летопись «${actor.name}» перенесена в журнал: недель ${log.length}.`);
  j?.sheet.render(true);
}

/** Открыть журнал летописи. */
export async function openChronicle(actor) {
  const j = await chronicleJournal(actor, false);
  if (!j) return ui.notifications.info("В журнале летописи ещё нет: недели уходят туда, когда на листе их больше " + LOG_LIMIT + ".");
  j.sheet.render(true);
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
