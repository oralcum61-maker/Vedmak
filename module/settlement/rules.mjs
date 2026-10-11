// Правила недели поселения (PLAN 4.183) — чистые функции без Foundry: одна и та же неделя считается для прогноза на
// листе и для хода «Прошла неделя». Порядок: работники → добыча и еда → ремесло и службы (тратят запас) → нужды семей
// → кроны → одобрение → склад по вместимости → стройка → приток или отток семей.

import { BUILDINGS, RESOURCE_KEYS, RESOURCES, BASE_STORAGE, NEEDS, WINTER_FUEL, TAXES, APPROVAL, calendar } from "../config/settlement.mjs";

const round1 = n => Math.round(n * 10) / 10;
const emptyStock = () => Object.fromEntries(RESOURCE_KEYS.map(k => [k, 0]));

/** Описание уровня постройки (уровень с единицы); null — нет такого. */
export function levelDef(key, level) {
  const def = BUILDINGS[key];
  if (!def || level < 1) return null;
  return def.levels[Math.min(level, def.levels.length) - 1] ?? null;
}

/** Хватает ли запаса и казны на цену. */
export function canAfford(state, cost = {}) {
  if ((cost.money ?? 0) > (state.money ?? 0)) return false;
  return RESOURCE_KEYS.every(k => (cost[k] ?? 0) <= (state.stock?.[k] ?? 0));
}

/** Что даёт поселение без хода: жильё, вместимость склада, места работы, строители. */
export function summarize(state) {
  const housing = { total: 0 };
  const storage = Object.fromEntries(RESOURCE_KEYS.map(k => [k, BASE_STORAGE]));
  let taxMult = 0, trade = false, assigned = 0;
  const jobs = [];
  for (const b of state.buildings ?? []) {
    const lv = levelDef(b.key, b.level);
    if (!lv) continue;
    housing.total += lv.housing ?? 0;
    for (const [k, v] of Object.entries(lv.storage ?? {})) storage[k] += v;
    if (lv.taxes) taxMult = Math.max(taxMult, lv.taxes);
    if (b.key === "tradepost") trade = true;
    const max = lv.workers ?? 0;
    if (max) jobs.push({ id: b.id, max, workers: Math.min(Math.max(0, b.workers ?? 0), max) });
  }
  // Семей стало меньше, чем рабочих мест занято, — снимаем работников с последних построек
  let left = Math.max(0, state.families ?? 0);
  for (const j of jobs) { j.workers = Math.min(j.workers, left); left -= j.workers; assigned += j.workers; }
  const constructing = (state.buildings ?? []).filter(b => b.constructing).length;
  const free = Math.max(0, (state.families ?? 0) - assigned);
  return {
    housing: housing.total, storage, taxMult, trade, assigned, free, constructing,
    builders: Math.min(free, constructing), workers: Object.fromEntries(jobs.map(j => [j.id, j.workers]))
  };
}

/**
 * Неделя поселения.
 * @param {object} state — {week, families, money, taxes, stock, buildings}
 * @returns {{next: object, report: object}} — новое состояние и отчёт (что выработано, потрачено, одобрение по частям)
 */
export function simulateWeek(state) {
  const sum = summarize(state);
  const cal = calendar(state.week);
  const seasonIdx = ["spring", "summer", "autumn", "winter"].indexOf(cal.season.key);
  const stock = { ...emptyStock(), ...state.stock };
  const produced = emptyStock(), consumed = emptyStock();
  const buildings = (state.buildings ?? []).map(b => ({ ...b }));
  const worked = new Set();
  let income = 0;

  // Прибавки мельницы и т. п.: { farm: 0.3 }
  const boost = {};
  for (const b of buildings) {
    const lv = levelDef(b.key, b.level);
    for (const [k, v] of Object.entries(lv?.boost ?? {})) boost[k] = Math.max(boost[k] ?? 0, v);
  }

  // Сначала то, что только добывает, потом то, что тратит запас (ремесло, службы)
  const working = buildings.map(b => ({ b, lv: levelDef(b.key, b.level), n: sum.workers[b.id] ?? 0 })).filter(x => x.lv && x.n > 0);
  const consumes = x => Object.keys(x.lv.consume ?? {}).length > 0;
  for (const x of [...working.filter(x => !consumes(x)), ...working.filter(consumes)]) {
    const def = BUILDINGS[x.b.key];
    let ratio = 1;
    for (const [k, per] of Object.entries(x.lv.consume ?? {})) {
      const need = per * x.n;
      if (need > 0) ratio = Math.min(ratio, stock[k] / need);
    }
    ratio = Math.max(0, Math.min(1, ratio));
    if (ratio <= 0) continue;
    for (const [k, per] of Object.entries(x.lv.consume ?? {})) {
      const used = per * x.n * ratio;
      stock[k] -= used; consumed[k] += used;
    }
    const mult = (def.season ? def.season[seasonIdx] : 1) * (1 + (boost[x.b.key] ?? 0));
    for (const [k, per] of Object.entries(x.lv.produce ?? {})) {
      const got = per * x.n * ratio * mult;
      stock[k] += got; produced[k] += got;
    }
    income += (x.lv.income ?? 0) * x.n * ratio;
    if (ratio > 0 && (mult > 0 || !x.lv.produce)) worked.add(x.b.id);
  }

  // Нужды семей
  const families = Math.max(0, state.families ?? 0);
  const winter = cal.season.key === "winter";
  const needs = {};
  for (const [k, per] of Object.entries(NEEDS)) {
    const need = families * per * (k === "fuel" && winter ? WINTER_FUEL : 1);
    const got = Math.min(stock[k], need);
    stock[k] -= got; consumed[k] += got;
    needs[k] = { need: round1(need), got: round1(got), ratio: need > 0 ? got / need : 1 };
  }

  // Кроны: налог с семьи (нужна усадьба) и доход построек
  const tax = TAXES[state.taxes] ?? TAXES.low;
  const taxes = families * tax.perFamily * sum.taxMult;
  income += taxes;

  // Одобрение
  const parts = [{ label: "Основа", value: APPROVAL.base }];
  const needPart = (k, label) => {
    const r = needs[k].ratio, a = APPROVAL[k];
    if (!families) return;
    if (r >= 1) parts.push({ label, value: a.met });
    else parts.push({ label: `${label}: не хватает`, value: Math.round((winter && a.winterShort ? a.winterShort : a.short) * (1 - r)) });
  };
  needPart("food", "Еда"); needPart("fuel", winter ? "Дрова зимой" : "Дрова"); needPart("goods", "Товары");
  for (const b of buildings) {
    const lv = levelDef(b.key, b.level);
    if (!lv?.approval) continue;
    if ((lv.workers ?? 0) > 0 && !worked.has(b.id)) continue;
    parts.push({ label: b.name || BUILDINGS[b.key].label, value: lv.approval });
  }
  parts.push({ label: `Налог: ${tax.label.toLowerCase()}`, value: sum.taxMult ? tax.approval : TAXES.none.approval });
  const approval = Math.max(0, Math.min(100, parts.reduce((s, p) => s + p.value, 0)));

  // Склад по вместимости: лишнее пропадает
  const overflow = {};
  for (const k of RESOURCE_KEYS) {
    if (stock[k] > sum.storage[k]) { overflow[k] = round1(stock[k] - sum.storage[k]); stock[k] = sum.storage[k]; }
    stock[k] = round1(Math.max(0, stock[k]));
  }

  // Стройка: каждой строящейся постройке — один свободный работник, по очереди
  let builders = sum.builders;
  const built = [];
  for (const b of buildings) {
    if (!b.constructing || builders <= 0) continue;
    builders--;
    b.progress = (b.progress ?? 0) + 1;
    const target = levelDef(b.key, b.level + 1);
    if (target && b.progress >= (target.weeks ?? 1)) {
      b.level += 1; b.constructing = false; b.progress = 0;
      built.push({ name: b.name || BUILDINGS[b.key].label, level: b.level });
    }
  }

  // Семьи: при высоком одобрении приходят (если есть жильё), при низком — уходят
  let change = 0, reason = "";
  const room = Math.max(0, sum.housing - families);
  if (approval >= APPROVAL.arriveTwo && room >= 2) { change = 2; reason = "Слава о поселении растёт: пришли две семьи."; }
  else if (approval >= APPROVAL.arrive && room >= 1) { change = 1; reason = "Пришла новая семья."; }
  else if (approval >= APPROVAL.arrive && !room) reason = "Семьи хотели бы прийти, но жилья нет.";
  else if (approval < APPROVAL.leave && families > 0) { change = -1; reason = "Недовольная семья ушла."; }

  const net = Object.fromEntries(RESOURCE_KEYS.map(k => [k, round1(stock[k] - (state.stock?.[k] ?? 0))]));
  const next = {
    week: cal.week + 1, families: families + change, money: round1((state.money ?? 0) + income),
    stock, buildings
  };
  const report = {
    week: cal.week, season: cal.season.label, year: cal.year,
    produced: Object.fromEntries(Object.entries(produced).map(([k, v]) => [k, round1(v)])),
    consumed: Object.fromEntries(Object.entries(consumed).map(([k, v]) => [k, round1(v)])),
    net, needs, overflow, income: round1(income), taxes: round1(taxes),
    approval, approvalParts: parts, families: { before: families, after: families + change, change, reason },
    built, builders: sum.builders
  };
  return { next, report };
}

/** Строка цены: «4 дерева, 2 камня, 30 кр.». */
export function costLabel(cost = {}, moneyLabel = n => `${n} кр.`) {
  const parts = RESOURCE_KEYS.filter(k => cost[k]).map(k => `${cost[k]} ${RESOURCES[k].label.toLowerCase()}`);
  if (cost.money) parts.push(moneyLabel(cost.money));
  return parts.join(", ") || "даром";
}
