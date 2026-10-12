// Действия ополчений и армий (PLAN 4.187): набор (из Ополчения, из семей, наёмники), роспуск, снаряжение со склада
// поселения (оружие и броня — отдельно, PLAN 4.198), командир, обучение (ступени веток неделями на плацу), неделя отрядов
// поселения (еда, плата, тренировка, опыт, боевой дух). Битва — apps/battle-app.mjs.

import { UNIT_KINDS, TRAINING, ORIGINS, FAMILY_SOLDIERS, MERCENARY, MAX_GEAR, GEAR } from "../config/army.mjs";
import { FOOD, WEALTH } from "../config/settlement.mjs";
import { RANKS, unitTree, kindBranch } from "../config/unit-upgrades.mjs";
import { unitState, unitWeek, equipCost, unitFood, unitPay, unitNodes } from "./rules.mjs";
import { asGM, registerGMHandler } from "../combat/common.mjs";
import { playSound } from "../fx/sounds.mjs";

const r3 = n => Math.round(n * 1000) / 1000;
const r1 = n => Math.round(n * 10) / 10;

/** Отряды поселения. */
export function settlementUnits(settlement) {
  return game.actors.filter(a => a.type === "unit" && a.system.settlement === settlement.uuid);
}

/** Хватает ли склада поселения на список [{resource, qty}]: null — да, иначе строка «чего не хватает». */
function missing(settlement, cost) {
  const stock = settlement.system.stockMap;
  const miss = cost.filter(c => (stock[c.resource] ?? 0) < c.qty).map(c => `${c.resource} ${c.qty - (stock[c.resource] ?? 0)}`);
  return miss.length ? miss.join(", ") : null;
}

/** Списать со склада поселения. */
async function take(settlement, cost) {
  const stock = settlement.system.stockMap;
  const update = Object.fromEntries(cost.map(c => [`system.stock.${c.resource}`, r1((stock[c.resource] ?? 0) - c.qty)]));
  if (Object.keys(update).length) await settlement.update(update);
}

/**
 * Набор: origin — militia (count бойцов из Ополчения), families (count семей — по 5 бойцов), mercenary (count
 * наёмников за Богатство). В новый отряд (kind, name) или в существующий того же происхождения: новички должны быть
 * снаряжены как отряд — снаряжение берётся со склада. Выучка отряда — средняя (новички — новобранцы).
 */
export async function recruit(settlement, { origin, count, kind = "infantry", name = "", unit = null }) {
  const sys = settlement.system;
  count = Math.floor(Number(count) || 0);
  if (count <= 0) return null;
  let soldiers = count, update = {};
  if (origin === "militia") {
    if (sys.militia < count) return ui.notifications.warn(`В Ополчении только ${sys.militia}.`);
    update["system.militia"] = sys.militia - count;
  } else if (origin === "families") {
    if (sys.summary.idle < count) return ui.notifications.warn(`Без дела только ${sys.summary.idle} сем. — снимите семьи с работы.`);
    update["system.families"] = sys.families - count;
    soldiers = count * FAMILY_SOLDIERS;
  } else if (origin === "mercenary") {
    const price = r3(count * MERCENARY.hire);
    if (sys.wealth < price) return ui.notifications.warn(`Найм стоит ${price} Богатства, в казне ${sys.wealth}.`);
    update["system.wealth"] = r3(sys.wealth - price);
    playSound("ui-coin");
  } else return null;

  if (unit) {
    if (unit.system.origin !== origin) return ui.notifications.warn(`«${unit.name}» набран иначе (${ORIGINS[unit.system.origin].label.toLowerCase()}) — наберите новый отряд.`);
    const gear = origin === "mercenary" ? [] : [...equipCost(unit.system.kind, "weapons", 0, unit.system.weapons, soldiers),
      ...equipCost(unit.system.kind, "armor", 0, unit.system.armor, soldiers)];
    const miss = missing(settlement, gear);
    if (miss) return ui.notifications.warn(`Новичков нечем снарядить как отряд: не хватает ${miss}.`);
    await take(settlement, gear);
    await settlement.update(update);
    const was = unit.system.soldiers;
    const training = was ? Math.floor((unit.system.training * was + (origin === "mercenary" ? MERCENARY.training : 0) * soldiers) / (was + soldiers)) : 0;
    await unit.update({ "system.soldiers": was + soldiers, "system.training": training });
    return unit;
  }
  await settlement.update(update);
  const merc = origin === "mercenary";
  const folder = game.folders.find(f => f.type === "Actor" && f.name === "Войско")
    ?? (game.user.isGM ? await Folder.create({ name: "Войско", type: "Actor", color: "#7a3b2e" }) : null);
  return Actor.create({
    name: name || `${UNIT_KINDS[kind].label}: ${settlement.name}`, type: "unit", img: UNIT_KINDS[kind].img, folder: folder?.id,
    ownership: foundry.utils.deepClone(settlement.ownership),
    system: { kind, origin, soldiers, training: merc ? MERCENARY.training : 0, weapons: merc ? MERCENARY.weapons : 0,
      armor: merc ? MERCENARY.armor : 0, morale: merc ? MERCENARY.morale : TRAINING[0].morale, settlement: settlement.uuid,
      branches: unitTree(kind) },
    prototypeToken: { name: name || UNIT_KINDS[kind].label, actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY }
  });
}

/** Распустить отряд: ополченцы — в Ополчение, семьи — по домам, наёмники уходят. */
export async function disband(unit) {
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: `Распустить: ${unit.name}` },
    content: `<p>${{ militia: "Бойцы вернутся в Ополчение поселения.", families: `Семьи вернутся домой (${Math.floor(unit.system.soldiers / FAMILY_SOLDIERS)} сем.).`, mercenary: "Наёмники уйдут." }[unit.system.origin]} Снаряжение не вернётся на склад.</p>`,
    rejectClose: false
  });
  if (!ok) return;
  const home = unit.system.settlementActor;
  if (home?.isOwner) {
    if (unit.system.origin === "militia") await home.update({ "system.militia": home.system.militia + unit.system.soldiers });
    if (unit.system.origin === "families") await home.update({ "system.families": home.system.families + Math.floor(unit.system.soldiers / FAMILY_SOLDIERS) });
  }
  await unit.delete();
}

/**
 * Снарядить отряд по дорожке track («weapons» — оружие, «armor» — броня) до ступени tier: на каждого бойца — по роду
 * войск, со склада родного поселения.
 */
export async function equip(unit, track, tier) {
  const sys = unit.system;
  if (!GEAR[track]) return;
  tier = Math.max(0, Math.min(MAX_GEAR, tier));
  if (tier <= sys[track]) return;
  const home = sys.settlementActor;
  if (!home) return ui.notifications.warn("У отряда нет родного поселения — снаряжение берётся с его склада.");
  const cost = equipCost(sys.kind, track, sys[track], tier, sys.soldiers);
  const miss = missing(home, cost);
  if (miss) return ui.notifications.warn(`На складе «${home.name}» не хватает: ${miss}.`);
  await take(home, cost);
  playSound("ui-coin");
  await unit.update({ [`system.${track}`]: tier });
  ui.notifications.info(`«${unit.name}»: ${GEAR[track].label.toLowerCase()} — ${GEAR[track].tiers[tier].label.toLowerCase()}.`);
}

/**
 * Можно ли начать ступень обучения: нет другой в работе, звание, оружие и броня достаточны, предыдущая ступень ветки
 * освоена; хватает ли склада родного поселения.
 * @returns {{ok: boolean, why?: string, node?: object}}
 */
export function canTrain(unit, nodeId) {
  const u = unitState(unit);
  const node = unitNodes(u).find(x => x.id === nodeId);
  if (!node) return { ok: false, why: "Нет такой ступени." };
  if (u.upgrades.includes(node.id)) return { ok: false, why: "Уже освоена." };
  if (u.rank < node.rank) return { ok: false, why: `Нужно звание «${RANKS[node.rank].label}».` };
  if (u.weapons < node.weapons) return { ok: false, why: `Нужно оружие «${GEAR.weapons.tiers[node.weapons].label}».` };
  if (u.armor < node.armor) return { ok: false, why: `Нужна броня «${GEAR.armor.tiers[node.armor].label}».` };
  if (node.requires && !u.upgrades.includes(node.requires)) {
    const prev = unitNodes(u).find(x => x.id === node.requires);
    return { ok: false, why: `Сначала — «${prev?.name ?? "предыдущая ступень"}».` };
  }
  if (u.research.node) return { ok: false, why: "Другая ступень уже осваивается." };
  const home = unit.system.settlementActor;
  if (!home) return { ok: false, why: "Нет родного поселения — учиться негде." };
  const miss = missing(home, node.cost);
  return miss ? { ok: false, why: `На складе не хватает: ${miss}.` } : { ok: true, node };
}

/** Начать ступень обучения: цена со склада поселения сразу; недели — на плацу (отряд должен тренироваться). */
export async function train(unit, nodeId) {
  const check = canTrain(unit, nodeId);
  if (!check.ok) return ui.notifications.warn(check.why);
  await take(unit.system.settlementActor, check.node.cost);
  playSound("ui-coin");
  if (!check.node.weeks) await unit.update({ "system.upgrades": [...unit.system.upgrades, nodeId] });
  else await unit.update({ "system.research": { node: nodeId, progress: 0 }, "system.drilling": true });
  return check.node;
}

/**
 * В поход (PLAN 4.203): припасы на weeks недель — еда со склада родного поселения; в походе отряд ест их, а не склад.
 */
export async function marchOut(unit, weeks) {
  const home = unit.system.settlementActor;
  weeks = Math.max(0, Math.floor(Number(weeks) || 0));
  const need = r1(unitFood(unitState(unit)) * weeks);
  if (home && need) {
    const have = home.system.stockMap[FOOD] ?? 0;
    if (have < need) return ui.notifications.warn(`На складе «${home.name}» еды ${have}, нужно ${need}.`);
    await home.update({ [`system.stock.${FOOD}`]: r1(have - need) });
  }
  await unit.update({ "system.campaign": true, "system.drilling": false, "system.supplies": r1(unit.system.supplies + need) });
}

/** Домой: остаток припасов — на склад родного поселения; осада, если была, снимается. */
export async function returnHome(unit) {
  if (unit.system.besieging) await liftSiege(unit);
  const home = unit.system.settlementActor;
  const left = unit.system.supplies;
  if (home && left) await home.update({ [`system.stock.${FOOD}`]: r1((home.system.stockMap[FOOD] ?? 0) + left) });
  await unit.update({ "system.campaign": false, "system.supplies": 0 });
}

/**
 * Осадить поселение (отряд в походе): отряд — в осаде поселения; поля и промыслы там стоят, купцы и новые семьи не
 * приходят, одобрение падает каждый месяц. Битва у стен — с укреплениями поселения.
 */
export async function besiege(unit, target) {
  if (!unit.system.campaign) return ui.notifications.warn("Осадить можно только из похода.");
  if (target?.type !== "settlement" || target.uuid === unit.system.settlement) return;
  if (unit.system.besieging) await liftSiege(unit);
  const units = [...new Set([...target.system.siege.units, unit.uuid])];
  await asGMUpdate(target, { "system.siege.units": units });
  await unit.update({ "system.besieging": target.uuid });
}

/** Снять осаду этого отряда (или всю — по поселению: liftSiege(null, settlement)). */
export async function liftSiege(unit, settlement = null) {
  const target = settlement ?? (unit?.system.besieging ? fromUuidSync(unit.system.besieging) : null);
  if (target?.type === "settlement") {
    const was = [...target.system.siege.units];
    const units = settlement ? [] : was.filter(u => u !== unit.uuid);
    await asGMUpdate(target, { "system.siege.units": units, ...(units.length ? {} : { "system.siege.weeks": 0 }) });
    if (settlement) await clearBesieging(was, target.uuid);
  }
  if (unit) await unit.update({ "system.besieging": "" });
}

/** Отрядам из списка uuid, что ещё осаждают поселение town, — отметку осады снять (свои — сразу, разом). */
export async function clearBesieging(uuids, town) {
  const updates = uuids.map(u => fromUuidSync(u)).filter(a => a?.type === "unit" && a.isOwner && a.system.besieging === town)
    .map(a => ({ _id: a.id, "system.besieging": "" }));
  if (updates.length) await Actor.implementation.updateDocuments(updates);
}

/** Обновить чужое поселение (осада): своё — сразу, чужое — через ведущего. */
async function asGMUpdate(target, data) {
  if (target.isOwner) return target.update(data);
  return asGM("siegeUpdate", { uuid: target.uuid, data });
}

/** Бросить ступень обучения (потраченное не возвращается). */
export async function stopTraining(unit) {
  if (unit.system.research.node) await unit.update({ "system.research": { node: "", progress: 0 } });
}

/**
 * Неделя отрядов поселения (вызывает ход поселения): еда со склада, плата наёмникам из казны, тренировка (нужен плац
 * или казарма), боевой дух. Меняет данные поселения после недели (stock, wealth) — возвращает их и строки отчёта.
 */
export async function unitsWeek(settlement, { stock, wealth, drill, rand = Math.random }) {
  const units = settlementUnits(settlement);
  const lines = [];
  if (!units.length) return { stock, wealth, lines };
  const states = new Map(units.map(a => [a.id, unitState(a)]));
  const foods = new Map(units.map(a => [a.id, unitFood(states.get(a.id), rand)]));
  // Дома отряды едят со склада поселения, в походе — свои припасы (PLAN 4.203)
  const home = units.filter(a => !a.system.campaign);
  const needFood = home.reduce((s, a) => s + foods.get(a.id), 0);
  const food = Math.min(stock[FOOD] ?? 0, needFood);
  const fedHome = needFood ? food / needFood : 1;
  stock = { ...stock, [FOOD]: r1((stock[FOOD] ?? 0) - food) };
  const updates = [];
  for (const actor of units) {
    const u = states.get(actor.id);
    const pay = unitPay(u, rand);
    const paid = !pay || wealth >= pay;
    if (pay && paid) wealth = r3(wealth - pay);
    let fed = fedHome;
    const update = { _id: actor.id };
    if (actor.system.campaign) {
      const need = foods.get(actor.id);
      const eat = Math.min(actor.system.supplies, need);
      fed = need ? eat / need : 1;
      update["system.supplies"] = r1(actor.system.supplies - eat);
    }
    // В походе не тренируются: плаца нет
    const w = unitWeek(u, { fed, paid, drill: actor.system.campaign ? 0 : drill, rand });
    if (actor.system.campaign) w.notes.unshift(`в походе: припасов ${update["system.supplies"]}${fed < 1 ? " — кончились" : ""}`);
    Object.assign(update, { "system.training": w.training, "system.progress": w.progress, "system.morale": w.morale,
      "system.soldiers": w.soldiers, "system.routed": false, "system.xp": w.xp, "system.research": w.research, "system.upgrades": w.upgrades });
    updates.push(update);
    lines.push({ name: actor.name, notes: w.notes, food: foods.get(actor.id), pay });
  }
  await Actor.updateDocuments(updates);
  return { stock, wealth, lines, food: r1(needFood), fed: fedHome };
}

export { WEALTH };

/**
 * Дерево обучения (PLAN 4.198): новый отряд получает его сам; смена рода войск меняет ветку рода (освоенное в ней
 * забывается); отрядам, набранным до обучения, ведущий проставляет дерево при загрузке мира.
 */
export function registerUnitHooks() {
  // Осада чужого поселения игроком: обновляет ведущий (только поле осады)
  registerGMHandler("siegeUpdate", async ({ uuid, data }) => {
    const target = await fromUuid(uuid);
    const clean = Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith("system.siege.")));
    if (target?.type === "settlement") await target.update(clean);
  });
  Hooks.on("preCreateActor", (actor, data) => {
    if (actor.type !== "unit") return;
    if (!data.system?.branches?.length) actor.updateSource({ "system.branches": unitTree(data.system?.kind ?? "infantry") });
    // Жетон отряда всегда связан с актёром (PLAN 4.210): потери и дух из битвы — на жетоне те же, что на листе
    actor.updateSource({ "prototypeToken.actorLink": true });
  });
  Hooks.on("preCreateToken", (token, data) => {
    if (token.actor?.type === "unit" && !data.actorLink && game.actors.get(data.actorId)) token.updateSource({ actorLink: true });
  });
  Hooks.on("preUpdateActor", (actor, changes) => {
    const kind = foundry.utils.getProperty(changes, "system.kind");
    if (actor.type !== "unit" || !kind || kind === actor.system.kind) return;
    const old = new Set((actor.system.branches.find(b => b.id === "kind")?.nodes ?? []).map(n => n.id));
    const branches = foundry.utils.deepClone(actor._source.system.branches).filter(b => b.id !== "kind");
    branches.push(kindBranch(kind));
    foundry.utils.setProperty(changes, "system.branches", branches);
    foundry.utils.setProperty(changes, "system.upgrades", actor.system.upgrades.filter(id => !old.has(id)));
    if (old.has(actor.system.research.node)) foundry.utils.setProperty(changes, "system.research", { node: "", progress: 0 });
  });
  Hooks.once("ready", async () => {
    if (!game.user.isGM || game.users.activeGM !== game.user) return;
    const updates = game.actors.filter(a => a.type === "unit" && !a.system.branches.length)
      .map(a => ({ _id: a.id, "system.branches": unitTree(a.system.kind) }));
    if (updates.length) await Actor.implementation.updateDocuments(updates);
    // Отряды, набранные вручную до 4.210: прототип и жетоны на сценах — связать с актёром
    const protos = game.actors.filter(a => a.type === "unit" && !a.prototypeToken.actorLink).map(a => ({ _id: a.id, "prototypeToken.actorLink": true }));
    if (protos.length) await Actor.implementation.updateDocuments(protos);
    for (const scene of game.scenes) {
      const toks = scene.tokens.filter(t => !t.actorLink && game.actors.get(t.actorId)?.type === "unit").map(t => ({ _id: t.id, actorLink: true }));
      if (toks.length) await scene.updateEmbeddedDocuments("Token", toks);
    }
  });
}

/**
 * Отряд на карте (PLAN 4.203): жетон отряда в походе подошёл вплотную (две клетки) к жетону чужого поселения — тому, кто
 * двигал, предлагается осада.
 */
export function registerMapSiege() {
  Hooks.on("moveToken", async (tokenDoc, movement, options, user) => {
    // Четвёртый аргумент — пользователь (документ), не его id
    if ((user?.id ?? user) !== game.user.id) return;
    const unit = tokenDoc.actor;
    if (unit?.type !== "unit" || !unit.system.campaign || unit.system.besieging || !unit.isOwner) return;
    const scene = tokenDoc.parent;
    const reach = (scene.grid.size ?? 100) * 2;
    // В хуке документ ещё на старом месте — середина по концу пути; поселение — актёр мира (жетон может быть не связан)
    const size = scene.grid.size ?? 100;
    const at = movement?.destination ?? tokenDoc;
    const c = { x: at.x + (tokenDoc.width * size) / 2, y: at.y + (tokenDoc.height * size) / 2 };
    const townOf = t => game.actors.get(t.actorId) ?? t.actor;
    const near = scene.tokens.find(t => townOf(t)?.type === "settlement" && townOf(t).uuid !== unit.system.settlement
      && Math.hypot(t.x + (t.width * size) / 2 - c.x, t.y + (t.height * size) / 2 - c.y) <= reach + (Math.max(t.width, t.height) * size) / 2);
    if (!near) return;
    const town = townOf(near);
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Под стенами" },
      content: `<p>«${unit.name}» подошёл к «${town.name}». Начать осаду?</p>`,
      rejectClose: false
    });
    if (ok) await besiege(unit, town);
  });
}
