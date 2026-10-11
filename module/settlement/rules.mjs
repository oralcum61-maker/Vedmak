// Правила недели поселения по журналу мира manorlords с уровнями построек, налогами, вместимостью склада и
// торговым постом (PLAN 4.185) — чистые функции без Foundry. Броски — своим разбором формул «1d6+3»: ход бросает,
// прогноз берёт среднее. Постройка — предмет «Постройка», правила получают её простым объектом (buildingState).
// Неделя: выработка построек → содержание → нужды семей (еда 1, топливо 1, зимой 2) → налог в казну → склад по
// вместимости → в конце месяца приход семей, бунт, довольство и одобрение от налога → стройка → календарь.

import { FOOD, FUEL, WEALTH, NEEDS, WINTER_FUEL, ARRIVALS, HOMELESS_CAP, CONTENT_LEVEL, WEEKS_PER_MONTH, BASE_STORAGE,
  APPROVAL_MAX, TAXES, WEALTH_RATE, revoltChance, calendar } from "../config/settlement.mjs";

const round1 = n => Math.round(n * 10) / 10;
const round3 = n => Math.round(n * 1000) / 1000;

/* ------------------------------ Броски ------------------------------ */

/** Разбор формулы: [{sign, n, d}] — d = 0 у числа. Неверная формула — пустой список (0). */
export function parseFormula(formula) {
  const terms = [];
  const src = String(formula ?? "").replace(/\s+/g, "").replace(/[дД]/g, "d");
  if (!src) return terms;
  const re = /([+-]?)(\d*(?:[.,]\d+)?)(?:d(\d+))?/gy;
  let m, pos = 0;
  while (pos < src.length && (m = re.exec(src)) && m[0]) {
    pos = re.lastIndex;
    const sign = m[1] === "-" ? -1 : 1;
    const n = m[2] ? Number(m[2].replace(",", ".")) : 1;
    if (m[3]) terms.push({ sign, n: Math.max(1, Math.floor(n)), d: Number(m[3]) });
    else if (m[2]) terms.push({ sign, n, d: 0 });
  }
  return pos === src.length ? terms : [];
}

/** Среднее формулы (для прогноза). */
export function averageOf(formula) {
  return parseFormula(formula).reduce((s, t) => s + t.sign * (t.d ? t.n * (t.d + 1) / 2 : t.n), 0);
}

/** Бросок формулы: {total, dice}; rand — равномерное [0, 1). */
export function rollFormula(formula, rand = Math.random) {
  let total = 0;
  const dice = [];
  for (const t of parseFormula(formula)) {
    if (!t.d) { total += t.sign * t.n; continue; }
    for (let i = 0; i < t.n; i++) {
      const v = Math.floor(rand() * t.d) + 1;
      dice.push(v);
      total += t.sign * v;
    }
  }
  return { total, dice };
}

/* ------------------------------ Постройка ------------------------------ */

const normRow = r => ({ resource: String(r.resource ?? "").trim(), formula: r.formula || "1", per: r.per ?? "building",
  period: r.period ?? "week", noWinter: !!r.noWinter, minFamilies: r.minFamilies ?? 0, same: !!r.same });
const normLevel = (l = {}) => ({
  cost: (l.cost ?? []).filter(c => c.resource && c.qty > 0).map(c => ({ resource: String(c.resource).trim(), qty: c.qty })),
  weeks: l.weeks ?? 1, families: l.families ?? 0, housing: l.housing ?? 0, control: l.control ?? 0,
  controlPerFamily: l.controlPerFamily ?? 0, taxes: l.taxes ?? 0, storage: l.storage ?? 0,
  consume: (l.consume ?? []).map(normRow).filter(r => r.resource),
  produce: (l.produce ?? []).map(normRow).filter(r => r.resource),
  upkeep: (l.upkeep ?? []).map(normRow).filter(r => r.resource)
});

/**
 * Постройка для правил из данных предмета «Постройка».
 * @param {{id?: string, _id?: string, name: string, img?: string, system: object}} item
 */
export function buildingState(item) {
  const s = item.system ?? {};
  return {
    id: item.id ?? item._id, name: item.name, img: item.img, key: s.key || item.name?.toLowerCase().trim() || "",
    group: s.group ?? "craft", unique: !!s.unique, trade: !!s.trade, levels: (s.levels ?? []).map(normLevel),
    level: s.level ?? 0, constructing: !!s.constructing, progress: s.progress ?? 0, workers: s.workers ?? 0
  };
}

/** Описание уровня (с единицы); null — нет такого. */
export function levelDef(b, level) {
  if (!b?.levels?.length || level < 1) return null;
  return b.levels[Math.min(level, b.levels.length) - 1] ?? null;
}

/** Хватает ли склада и казны на цену. */
export function canAfford(state, cost = []) {
  return cost.every(c => (c.resource === WEALTH ? state.wealth ?? 0 : state.stock?.[c.resource] ?? 0) >= c.qty);
}

/* ------------------------------ Сводка ------------------------------ */

/** Что есть у поселения без хода: дома, бездомные, работа, строители, вместимость, налоги, Контроль, шансы месяца. */
export function summarize(state) {
  let houses = 0, control = state.control ?? 0, assigned = 0, storage = BASE_STORAGE, taxMult = 0, trade = false;
  const jobs = [];
  for (const b of state.buildings ?? []) {
    const lv = levelDef(b, b.level);
    if (!lv) continue;
    houses += lv.housing;
    control += lv.control;
    storage += lv.storage;
    taxMult = Math.max(taxMult, lv.taxes);
    if (b.trade) trade = true;
    if (lv.families) jobs.push({ id: b.id, max: lv.families, workers: Math.min(Math.max(0, b.workers), lv.families) });
  }
  const families = Math.max(0, state.families ?? 0);
  let left = families;
  for (const j of jobs) { j.workers = Math.min(j.workers, left); left -= j.workers; assigned += j.workers; }
  // Контроль за семью на работе (стража в казарме)
  for (const b of state.buildings ?? []) {
    const lv = levelDef(b, b.level);
    const j = jobs.find(x => x.id === b.id);
    if (lv?.controlPerFamily && j) control += lv.controlPerFamily * j.workers;
  }
  const constructing = (state.buildings ?? []).filter(b => b.constructing).length;
  const idle = families - assigned;
  const approval = Math.max(0, Math.min(APPROVAL_MAX, state.approval ?? 5));
  const arrival = ARRIVALS[approval] ?? null;
  const tax = TAXES[state.taxes] ?? TAXES.low;
  return {
    houses, homeless: Math.max(0, families - houses), freeHouses: Math.max(0, houses - families),
    assigned, idle, constructing, builders: Math.min(idle, constructing), control, storage, trade,
    taxMult, taxCoins: families * tax.perFamily * taxMult,
    workers: Object.fromEntries(jobs.map(j => [j.id, j.workers])),
    revolt: revoltChance(approval, control),
    arrival: arrival ? { chance: arrival[0], formula: arrival[1] } : null,
    content: approval >= CONTENT_LEVEL
  };
}

/* ------------------------------ Неделя ------------------------------ */

/**
 * Неделя поселения.
 * @param {object} state — {year, month, week, families, approval, control, wealth, taxes, stock: {ресурс: число}, buildings}
 * @param {object} [opts]
 * @param {boolean} [opts.forecast] — прогноз: средние вместо бросков, без случайных событий месяца
 * @param {Function} [opts.rand] — равномерное [0, 1) для бросков
 */
export function simulateWeek(state, { forecast = false, rand = Math.random } = {}) {
  const sum = summarize(state);
  const cal = calendar(state);
  const monthEnd = cal.monthEnd;
  const bimonth = monthEnd && cal.month % 2 === 0;
  const stock = { ...(state.stock ?? {}) };
  const before = { ...stock };
  const add = (k, v) => { stock[k] = round1((stock[k] ?? 0) + v); };
  const roll = f => forecast ? { total: averageOf(f), dice: [] } : rollFormula(f, rand);
  const lines = [], shortages = [], events = [];
  const produced = {}, consumed = {};
  let wealth = state.wealth ?? 0;
  let approval = Math.max(0, Math.min(APPROVAL_MAX, state.approval ?? 5));

  const active = (r, workers) => (r.period === "week" || (r.period === "month" && monthEnd) || (r.period === "bimonth" && bimonth))
    && !(r.noWinter && cal.winter) && workers >= r.minFamilies && !(r.per === "family" && workers <= 0);

  // Выработка: сначала постройки без сырья, потом те, что его берут (мельница — зерно с фермы этой же недели);
  // сырья не хватает — постройка работает частью: выработка во столько же раз меньше
  const order = (state.buildings ?? []).map(b => ({ b, lv: levelDef(b, b.level) })).filter(x => x.lv);
  const takes = x => x.lv.consume.length > 0;
  for (const { b, lv } of [...order.filter(x => !takes(x)), ...order.filter(takes)]) {
    const workers = sum.workers[b.id] ?? 0;
    let ratio = 1;
    const inputs = [];
    for (const r of lv.consume) {
      if (!active(r, workers)) continue;
      const need = round1(Math.max(0, averageOf(r.formula)) * (r.per === "family" ? workers : 1));
      if (need <= 0) continue;
      const have = r.resource === WEALTH ? wealth : stock[r.resource] ?? 0;
      ratio = Math.min(ratio, have / need);
      inputs.push({ resource: r.resource, need });
    }
    ratio = Math.max(0, Math.min(1, ratio));
    if (inputs.length) {
      for (const x of inputs) {
        const used = round1(x.need * ratio);
        if (!used) continue;
        if (x.resource === WEALTH) wealth = round3(wealth - used);
        else { add(x.resource, -used); consumed[x.resource] = round1((consumed[x.resource] ?? 0) + used); }
      }
      if (ratio < 1) shortages.push({ building: b.name, resource: inputs.map(x => x.resource).join(", "), need: 100, got: Math.round(ratio * 100), input: true });
      if (ratio <= 0) continue;
    }
    let last = null;
    for (const r of lv.produce) {
      if (!active(r, workers)) { last = null; continue; }
      const times = r.per === "family" ? workers : 1;
      let amount = 0;
      const dice = [];
      if (r.same && last !== null) amount = last;
      else for (let i = 0; i < times; i++) { const x = roll(r.formula); amount += x.total; dice.push(...x.dice); }
      last = amount;
      amount = r.resource === WEALTH ? round3(Math.max(0, amount * ratio)) : round1(Math.max(0, amount * ratio));
      if (!amount) continue;
      if (r.resource === WEALTH) wealth = round3(wealth + amount);
      else add(r.resource, amount);
      produced[r.resource] = r.resource === WEALTH ? round3((produced[r.resource] ?? 0) + amount) : round1((produced[r.resource] ?? 0) + amount);
      lines.push({ building: b.name, resource: r.resource, amount, formula: r.same ? "столько же" : (times > 1 ? `${r.formula} ×${times}` : r.formula), dice });
    }
  }

  // Содержание построек
  for (const b of state.buildings ?? []) {
    const lv = levelDef(b, b.level);
    if (!lv) continue;
    const workers = sum.workers[b.id] ?? 0;
    for (const r of lv.upkeep) {
      if (!active(r, workers)) continue;
      const times = r.per === "family" ? workers : 1;
      let need = 0;
      for (let i = 0; i < times; i++) need += roll(r.formula).total;
      need = round1(Math.max(0, need));
      if (r.resource === WEALTH) {
        const got = Math.min(wealth, need);
        wealth = round3(wealth - got);
        if (got < need) shortages.push({ building: b.name, resource: r.resource, need, got, upkeep: true });
        continue;
      }
      const got = Math.min(stock[r.resource] ?? 0, need);
      if (got) { add(r.resource, -got); consumed[r.resource] = round1((consumed[r.resource] ?? 0) + got); }
      if (got < need) shortages.push({ building: b.name, resource: r.resource, need, got, upkeep: true });
    }
  }

  // Нужды семей
  const families = Math.max(0, state.families ?? 0);
  const needs = {};
  for (const [k, per] of Object.entries(NEEDS)) {
    const need = families * per * (k === FUEL && cal.winter ? WINTER_FUEL : 1);
    const got = Math.min(stock[k] ?? 0, need);
    if (got) { add(k, -got); consumed[k] = round1((consumed[k] ?? 0) + got); }
    needs[k] = { need: round1(need), got: round1(got), short: round1(need - got) };
    if (got < need) shortages.push({ resource: k, need: round1(need), got: round1(got) });
  }

  // Налог: монеты валюты мира → Богатство по курсу
  const taxWealth = round3(sum.taxCoins / WEALTH_RATE);
  if (taxWealth) wealth = round3(wealth + taxWealth);

  // Склад по вместимости: лишнее пропадает
  const overflow = {};
  for (const k of Object.keys(stock)) {
    if (stock[k] > sum.storage && stock[k] > (before[k] ?? 0)) {
      const cap = Math.max(sum.storage, before[k] ?? 0);
      if (stock[k] > cap) { overflow[k] = round1(stock[k] - cap); stock[k] = cap; }
    }
  }

  // Конец месяца: одобрение от налога, приход семей, бунт, довольство
  let arrived = 0;
  if (monthEnd && !forecast) {
    const tax = TAXES[state.taxes] ?? TAXES.low;
    if (sum.taxMult && tax.approval) {
      const was = approval;
      approval = Math.max(0, Math.min(APPROVAL_MAX, approval + tax.approval));
      if (approval !== was) events.push({ kind: "taxes", text: `${tax.label} налог: одобрение ${tax.approval > 0 ? "растёт" : "падает"} до ${approval}.` });
    }
    if (sum.arrival) {
      if (sum.homeless > 0) events.push({ kind: "arrival", text: "Новые семьи не придут, пока есть бездомные." });
      else {
        const d = rollFormula("1d100", rand).total;
        if (d <= sum.arrival.chance) {
          const cap = sum.freeHouses > 0 ? sum.freeHouses : HOMELESS_CAP;
          arrived = Math.min(cap, Math.max(1, rollFormula(sum.arrival.formula, rand).total));
          events.push({ kind: "arrival", text: `Пришли семьи: ${arrived}${sum.freeHouses ? "" : " (домов нет — бездомными)"}. Бросок ${d} из ${sum.arrival.chance}.` });
        } else events.push({ kind: "arrival", text: `Новые семьи не пришли (бросок ${d}, нужно ${sum.arrival.chance} и меньше).` });
      }
    }
    if (sum.revolt > 0) {
      const d = rollFormula("1d100", rand).total;
      events.push(d <= sum.revolt
        ? { kind: "revolt", text: `Бунт! Народ поднялся против правителя (бросок ${d}, шанс ${sum.revolt}%).`, danger: true }
        : { kind: "revolt", text: `Ропот без бунта (бросок ${d}, шанс ${sum.revolt}%).` });
    }
    if (sum.content) events.push({ kind: "content", text: "Народ доволен правителем: в конце месяца возможны дополнительные ресурсы — решает ведущий." });
  }

  // Стройка: каждой строящейся постройке — одна свободная семья
  let builders = sum.builders;
  const buildings = (state.buildings ?? []).map(b => ({ ...b }));
  const built = [];
  for (const b of buildings) {
    if (!b.constructing || builders <= 0) continue;
    builders--;
    b.progress += 1;
    const target = levelDef(b, b.level + 1);
    if (!target || b.progress >= target.weeks) {
      b.level = Math.min(b.level + 1, b.levels.length); b.constructing = false; b.progress = 0;
      built.push({ name: b.name, level: b.level });
    }
  }

  // Календарь
  let { year, month, week } = cal;
  week += 1;
  if (week > WEEKS_PER_MONTH) { week = 1; month += 1; }
  if (month > 12) { month = 1; year += 1; }

  const net = {};
  for (const k of new Set([...Object.keys(produced), ...Object.keys(consumed), ...Object.keys(overflow)])) {
    if (k === WEALTH) continue;
    net[k] = round1((stock[k] ?? 0) - (before[k] ?? 0));
  }
  const next = { year, month, week, families: families + arrived, approval, wealth, stock, buildings };
  const report = {
    year: cal.year, month: cal.month, monthLabel: cal.monthLabel, week: cal.week, season: cal.seasonLabel, monthEnd,
    lines, produced, consumed, net, needs, shortages, events, built, arrived, overflow, taxWealth,
    wealthGain: round3(wealth - (state.wealth ?? 0)), builders: sum.builders
  };
  return { next, report };
}

/** Строка цены: «Древесина 5, Камень 2». */
export function costLabel(cost = []) {
  return cost.map(c => `${c.resource} ${c.qty}`).join(", ") || "даром";
}

export { FOOD, FUEL, WEALTH };
