// Действия ополчений и армий (PLAN 4.187): набор (из Ополчения, из семей, наёмники), роспуск, снаряжение со склада
// поселения, командир, неделя отрядов поселения (еда, плата, тренировка, боевой дух). Битва — apps/battle-app.mjs.

import { UNIT_KINDS, TRAINING, ORIGINS, FAMILY_SOLDIERS, MERCENARY, MAX_EQUIPMENT, EQUIPMENT } from "../config/army.mjs";
import { FOOD, WEALTH } from "../config/settlement.mjs";
import { unitState, unitWeek, equipCost, unitFood, unitPay } from "./rules.mjs";

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
  } else return null;

  if (unit) {
    if (unit.system.origin !== origin) return ui.notifications.warn(`«${unit.name}» набран иначе (${ORIGINS[unit.system.origin].label.toLowerCase()}) — наберите новый отряд.`);
    const gear = origin === "mercenary" ? [] : equipCost(unit.system.kind, 0, unit.system.equipment, soldiers);
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
    system: { kind, origin, soldiers, training: merc ? MERCENARY.training : 0, equipment: merc ? MERCENARY.equipment : 0,
      morale: merc ? MERCENARY.morale : TRAINING[0].morale, settlement: settlement.uuid },
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

/** Снарядить отряд до уровня tier: на каждого бойца — по роду войск, со склада родного поселения. */
export async function equip(unit, tier) {
  const sys = unit.system;
  tier = Math.max(0, Math.min(MAX_EQUIPMENT, tier));
  if (tier <= sys.equipment) return;
  const home = sys.settlementActor;
  if (!home) return ui.notifications.warn("У отряда нет родного поселения — снаряжение берётся с его склада.");
  const cost = equipCost(sys.kind, sys.equipment, tier, sys.soldiers);
  const miss = missing(home, cost);
  if (miss) return ui.notifications.warn(`На складе «${home.name}» не хватает: ${miss}.`);
  await take(home, cost);
  await unit.update({ "system.equipment": tier });
  ui.notifications.info(`«${unit.name}»: снаряжение — ${EQUIPMENT[tier].label.toLowerCase()}.`);
}

/**
 * Неделя отрядов поселения (вызывает ход поселения): еда со склада, плата наёмникам из казны, тренировка (нужен плац
 * или казарма), боевой дух. Меняет данные поселения после недели (stock, wealth) — возвращает их и строки отчёта.
 */
export async function unitsWeek(settlement, { stock, wealth, drill, rand = Math.random }) {
  const units = settlementUnits(settlement);
  const lines = [];
  if (!units.length) return { stock, wealth, lines };
  const needFood = units.reduce((s, u) => s + unitFood(unitState(u)), 0);
  const food = Math.min(stock[FOOD] ?? 0, needFood);
  const fed = needFood ? food / needFood : 1;
  stock = { ...stock, [FOOD]: r1((stock[FOOD] ?? 0) - food) };
  const updates = [];
  for (const actor of units) {
    const u = unitState(actor);
    const pay = unitPay(u);
    const paid = !pay || wealth >= pay;
    if (pay && paid) wealth = r3(wealth - pay);
    const w = unitWeek(u, { fed, paid, drill, rand });
    updates.push({ _id: actor.id, "system.training": w.training, "system.progress": w.progress, "system.morale": w.morale,
      "system.soldiers": w.soldiers, "system.routed": false });
    lines.push({ name: actor.name, notes: w.notes, food: unitFood(u), pay });
  }
  await Actor.updateDocuments(updates);
  return { stock, wealth, lines, food: r1(needFood), fed };
}

export { WEALTH };
