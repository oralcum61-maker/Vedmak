// Правила недели поселения по журналу мира manorlords с уровнями построек, налогами, вместимостью склада и
// торговым постом (PLAN 4.185) — чистые функции без Foundry. Броски — своим разбором формул «1d6+3»: ход бросает,
// прогноз берёт среднее. Постройка — предмет «Постройка», правила получают её простым объектом (buildingState).
// Неделя: выработка построек → содержание → нужды семей (еда 1, топливо 1, зимой 2) → налог в казну → склад по
// вместимости → в конце месяца приход семей, бунт, довольство и одобрение от налога → стройка → календарь.
// Обустройство (PLAN 4.198, 4.200): купленные ступени постройки сводятся в upgradeMods; activeLevel — её уровень с ними.
// Бонусы ступеней — броски, каждый столько раз, какой уровень постройки: к выработке ресурса (после строк, долей сырья),
// в минус сырью и содержанию, к шансам бунта и прихода в конце месяца; налоги, одобрение и торговля — в сводке поселения.
// Ступень в стройке занимает строителя, как уровень.

import { effectDice } from "../config/building-upgrades.mjs";
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

/** Среднее списка бросков [{f, times}] (для шансов в сводке). */
export function diceAverage(list = []) {
  return list.reduce((n, x) => n + averageOf(x.f) * x.times, 0);
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
  controlPerFamily: l.controlPerFamily ?? 0, taxes: l.taxes ?? 0, storage: l.storage ?? 0, drill: l.drill ?? 0, defense: l.defense ?? 0,
  consume: (l.consume ?? []).map(normRow).filter(r => r.resource),
  produce: (l.produce ?? []).map(normRow).filter(r => r.resource),
  upkeep: (l.upkeep ?? []).map(normRow).filter(r => r.resource)
});

/**
 * Сводка эффектов купленных ступеней (config/building-upgrades.mjs). Проценты — по ресурсу, «*» — всем.
 * @param {object[]} branches — ветки постройки
 * @param {string[]} upgrades — id купленных ступеней
 */
export function upgradeMods(branches = [], upgrades = []) {
  const bought = new Set(upgrades);
  const m = { produce: {}, consume: {}, upkeep: {}, produceAdd: [], consumeAdd: [], upkeepAdd: [], families: 0, housing: 0, control: 0, storage: 0, drill: 0,
    taxes: 0, approval: 0, revolt: [], arrival: [], trade: false, defense: 0 };
  for (const br of branches) for (const nd of br.nodes ?? []) {
    if (!bought.has(nd.id)) continue;
    for (const e of nd.effects ?? []) {
      const v = Number(e.value) || 0;
      if (e.type === "produce" || e.type === "consume" || e.type === "upkeep") {
        const k = String(e.resource ?? "").trim() || "*";
        const d = effectDice(e);
        if (d) (m[e.type][k] ??= []).push(d);
      } else if (e.type === "revolt" || e.type === "arrival") {
        const d = effectDice(e);
        if (d) m[e.type].push(d);
      } else if (e.type === "produceAdd" || e.type === "consumeAdd" || e.type === "upkeepAdd") {
        if (String(e.resource ?? "").trim()) m[e.type].push(normRow({ resource: e.resource, formula: e.formula, per: e.per, period: e.period }));
      } else if (e.type === "trade") m.trade = true;
      else if (e.type in m) m[e.type] += v;
    }
  }
  return m;
}

/** Ступени постройки списком (по веткам). */
export function upgradeNodes(b) {
  return (b?.branches ?? []).flatMap(br => (br.nodes ?? []).map(nd => ({ ...nd, branch: br.id })));
}

/**
 * Постройка для правил из данных актёра «Постройка» (или прежнего предмета).
 * @param {{id?: string, _id?: string, name: string, img?: string, system: object}} item
 */
export function buildingState(item) {
  const s = item.system ?? {};
  return {
    id: item.id ?? item._id, name: item.name, img: item.img, key: s.key || item.name?.toLowerCase().trim() || "",
    group: s.group ?? "craft", unique: !!s.unique, trade: !!s.trade, levels: (s.levels ?? []).map(normLevel),
    level: s.level ?? 0, constructing: !!s.constructing, progress: s.progress ?? 0, workers: s.workers ?? 0,
    branches: s.branches ?? [], upgrades: [...(s.upgrades ?? [])],
    research: { node: s.research?.node ?? "", progress: s.research?.progress ?? 0 },
    mods: upgradeMods(s.branches ?? [], s.upgrades ?? [])
  };
}

/**
 * Бросок бонусов ступеней по ресурсу: формулы ресурса и «*», каждая — times раз (уровень постройки).
 * @returns {{total: number, dice: number[], formula: string}}
 */
export function bonusRoll(map, res, times, roll) {
  const list = [...(map?.[res] ?? []), ...(map?.["*"] ?? [])];
  let total = 0;
  const dice = [];
  if (times > 0) for (const f of list) for (let i = 0; i < times; i++) { const x = roll(f); total += x.total; dice.push(...x.dice); }
  return { total, dice, formula: list.map(f => (times > 1 ? `${f}×${times}` : f)).join(" + ") };
}

/**
 * Действующий уровень постройки — с купленными ступенями: прибавки мест, жилья, Контроля, склада, тренировки; новые
 * строки выработки — в конец; броски ступеней (bonus) — к выработке, сырью и содержанию, каждый уровень раз. null — не
 * построена.
 */
export function activeLevel(b) {
  const lv = levelDef(b, b?.level ?? 0);
  if (!lv) return null;
  const m = b.mods;
  if (!m) return lv;
  return {
    ...lv,
    families: lv.families + m.families, housing: lv.housing + m.housing, control: lv.control + m.control,
    storage: lv.storage + m.storage, drill: lv.drill ? lv.drill + m.drill : m.drill, defense: (lv.defense ?? 0) + m.defense,
    produce: [...lv.produce, ...m.produceAdd],
    consume: [...lv.consume, ...(m.consumeAdd ?? [])],
    upkeep: [...lv.upkeep, ...(m.upkeepAdd ?? [])],
    bonus: { produce: m.produce, consume: m.consume, upkeep: m.upkeep, times: b.level }
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
  let houses = 0, control = state.control ?? 0, assigned = 0, storage = BASE_STORAGE, taxMult = 0, trade = false, drill = 0, defense = 0;
  let taxBonus = 0, approvalBonus = 0;
  const revoltDice = [], arrivalDice = [];
  const jobs = [];
  for (const b of state.buildings ?? []) {
    const lv = activeLevel(b);
    if (!lv) continue;
    houses += lv.housing;
    control += lv.control;
    storage += lv.storage;
    taxMult = Math.max(taxMult, lv.taxes);
    drill = Math.max(drill, lv.drill);
    defense += lv.defense ?? 0;
    if ((b.trade || b.mods?.trade) && !state.siege) trade = true;
    if (b.mods) {
      taxBonus += b.mods.taxes; approvalBonus += b.mods.approval;
      for (const f of b.mods.revolt ?? []) revoltDice.push({ f, times: b.level });
      for (const f of b.mods.arrival ?? []) arrivalDice.push({ f, times: b.level });
    }
    if (lv.families) jobs.push({ id: b.id, max: lv.families, workers: Math.min(Math.max(0, b.workers), lv.families) });
  }
  // Последствия событий месяца (PLAN 4.206): закрытые ворота, слава, обиды
  const mods = state.modifiers ?? [];
  if (mods.some(m => m.trade === false)) trade = false;
  const modRevolt = mods.reduce((n, m) => n + (Number(m.revolt) || 0), 0);
  const modArrival = mods.reduce((n, m) => n + (Number(m.arrival) || 0), 0);
  const families = Math.max(0, state.families ?? 0);
  let left = families;
  for (const j of jobs) { j.workers = Math.min(j.workers, left); left -= j.workers; assigned += j.workers; }
  // Контроль за семью на работе (стража в казарме)
  for (const b of state.buildings ?? []) {
    const lv = activeLevel(b);
    const j = jobs.find(x => x.id === b.id);
    if (lv?.controlPerFamily && j) control += lv.controlPerFamily * j.workers;
    // Управляющий постройки без выработки — порядок: Контроль, 1 за каждые 4 очка навыка
    if (lv && b.manager?.value && !lv.produce.length) control += Math.floor(b.manager.value / 4);
  }
  // Стройка: уровни и ступени прокачки — каждой нужна свободная семья
  const constructing = (state.buildings ?? []).filter(b => b.constructing || b.research?.node).length;
  // Налог без постройки с налогами (усадьбы) не собрать — прибавки ступеней только поверх
  const idle = families - assigned;
  const approval = Math.max(0, Math.min(APPROVAL_MAX, state.approval ?? 5));
  // В осаде (PLAN 4.203) новые семьи не приходят
  const arrival = state.siege ? null : ARRIVALS[approval] ?? null;
  const tax = TAXES[state.taxes] ?? TAXES.low;
  const revoltBase = Math.min(100, Math.max(0, revoltChance(approval, control) + modRevolt));
  return {
    houses, homeless: Math.max(0, families - houses), freeHouses: Math.max(0, houses - families),
    assigned, idle, constructing, builders: Math.min(idle, constructing), control, storage, trade, drill, defense,
    taxMult: taxMult ? taxMult + taxBonus : 0, taxCoins: families * tax.perFamily * (taxMult ? taxMult + taxBonus : 0),
    approvalBonus, revoltDice, arrivalDice, revoltBase,
    revoltMinus: diceAverage(revoltDice), arrivalPlus: diceAverage(arrivalDice),
    workers: Object.fromEntries(jobs.map(j => [j.id, j.workers])),
    revolt: revoltBase ? Math.max(0, Math.round(revoltBase - diceAverage(revoltDice))) : 0,
    arrival: arrival ? { chance: Math.min(100, Math.max(0, Math.round(arrival[0] + modArrival + diceAverage(arrivalDice)))), base: Math.max(0, arrival[0] + modArrival), formula: arrival[1] } : null,
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
export function simulateWeek(state, { forecast = false, rand = Math.random, needsApproval = false } = {}) {
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

  // Последствия событий: множители выработки (группа, ресурс или вся) и нужд
  const mods = state.modifiers ?? [];
  const prodMult = (group, res) => mods.reduce((m, x) => m * (x.produce ?? []).reduce((k, p) =>
    ((!p.group && !p.resource) || p.group === group || p.resource === res) ? k * (Number(p.mult) || 0) : k, 1), 1);
  const active = (r, workers) => (r.period === "week" || (r.period === "month" && monthEnd) || (r.period === "bimonth" && bimonth))
    && !(r.noWinter && cal.winter) && workers >= r.minFamilies && !(r.per === "family" && workers <= 0);

  // Выработка: сначала постройки без сырья, потом те, что его берут (мельница — зерно с фермы этой же недели);
  // сырья не хватает — постройка работает частью: выработка во столько же раз меньше
  // В осаде (PLAN 4.203) поля и промыслы за стенами стоят
  const outside = b => state.siege && (b.group === "food" || b.group === "raw");
  const order = (state.buildings ?? []).map(b => ({ b, lv: activeLevel(b) })).filter(x => x.lv && !outside(x.b));
  if (state.siege) events.push({ kind: "siege", text: "Осада: поля и промыслы за стенами стоят, купцы и новые семьи не приходят.", danger: true });
  const takes = x => x.lv.consume.length > 0;
  for (const { b, lv } of [...order.filter(x => !takes(x)), ...order.filter(takes)]) {
    const workers = sum.workers[b.id] ?? 0;
    let ratio = 1;
    const inputs = [];
    for (const r of lv.consume) {
      if (!active(r, workers)) continue;
      const base = Math.max(0, averageOf(r.formula)) * (r.per === "family" ? workers : 1);
      const need = round1(Math.max(0, base - bonusRoll(lv.bonus?.consume, r.resource, lv.bonus?.times ?? 0, roll).total));
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
    const made = new Set();
    for (const r of lv.produce) {
      if (!active(r, workers)) { last = null; continue; }
      const times = r.per === "family" ? workers : 1;
      let amount = 0;
      const dice = [];
      if (r.same && last !== null) amount = last;
      else for (let i = 0; i < times; i++) { const x = roll(r.formula); amount += x.total; dice.push(...x.dice); }
      last = amount;
      made.add(r.resource);
      const pm = prodMult(b.group, r.resource);
      amount = r.resource === WEALTH ? round3(Math.max(0, amount * ratio * pm)) : round1(Math.max(0, amount * ratio * pm));
      if (!amount) continue;
      if (r.resource === WEALTH) wealth = round3(wealth + amount);
      else add(r.resource, amount);
      produced[r.resource] = r.resource === WEALTH ? round3((produced[r.resource] ?? 0) + amount) : round1((produced[r.resource] ?? 0) + amount);
      lines.push({ building: b.name, resource: r.resource, amount, formula: r.same ? "столько же" : (times > 1 ? `${r.formula} ×${times}` : r.formula), dice });
    }
    // Броски ступеней к выработке — по ресурсу, уровень постройки раз (с той же долей сырья)
    for (const res of made) {
      const bonus = bonusRoll(lv.bonus?.produce, res, lv.bonus?.times ?? 0, roll);
      const pm = prodMult(b.group, res);
      const amount = res === WEALTH ? round3(Math.max(0, bonus.total * ratio * pm)) : round1(Math.max(0, bonus.total * ratio * pm));
      if (!amount) continue;
      if (res === WEALTH) wealth = round3(wealth + amount);
      else add(res, amount);
      produced[res] = res === WEALTH ? round3((produced[res] ?? 0) + amount) : round1((produced[res] ?? 0) + amount);
      lines.push({ building: b.name, resource: res, amount, formula: `обустройство ${bonus.formula}`, dice: bonus.dice });
    }
    // Управляющий (PLAN 4.203): 1d4 за каждые 3 очка навыка — к главной выработке (первой строки), с долей сырья
    const main = lv.produce.find(r => made.has(r.resource))?.resource;
    if (main && b.manager?.dice) {
      const x = roll(`${b.manager.dice}d4`);
      const pm = prodMult(b.group, main);
      const amount = main === WEALTH ? round3(Math.max(0, x.total * ratio * pm)) : round1(Math.max(0, x.total * ratio * pm));
      if (amount) {
        if (main === WEALTH) wealth = round3(wealth + amount);
        else add(main, amount);
        produced[main] = main === WEALTH ? round3((produced[main] ?? 0) + amount) : round1((produced[main] ?? 0) + amount);
        lines.push({ building: b.name, resource: main, amount, formula: `управляющий ${b.manager.name}: ${b.manager.dice}d4`, dice: x.dice });
      }
    }
  }

  // Содержание построек
  for (const b of state.buildings ?? []) {
    const lv = activeLevel(b);
    if (!lv) continue;
    const workers = sum.workers[b.id] ?? 0;
    for (const r of lv.upkeep) {
      if (!active(r, workers)) continue;
      const times = r.per === "family" ? workers : 1;
      let need = 0;
      for (let i = 0; i < times; i++) need += roll(r.formula).total;
      need = round1(Math.max(0, need - bonusRoll(lv.bonus?.upkeep, r.resource, lv.bonus?.times ?? 0, roll).total));
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
    const needMult = mods.reduce((m, x) => m * (Number(x.needs?.[k]) || 1), 1);
    const need = families * per * (k === FUEL && cal.winter ? WINTER_FUEL : 1) * needMult;
    const got = Math.min(stock[k] ?? 0, need);
    if (got) { add(k, -got); consumed[k] = round1((consumed[k] ?? 0) + got); }
    needs[k] = { need: round1(need), got: round1(got), short: round1(need - got) };
    if (got < need) shortages.push({ resource: k, need: round1(need), got: round1(got) });
  }

  // Нехватка нужд за месяц (PLAN 4.210): недели с голодом или холодом копятся до конца месяца
  const monthShort = (state.monthShort ?? 0) + (Object.values(needs).some(n => n.short > 0) ? 1 : 0);

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
    // Броски ступеней к шансам (уровень постройки раз)
    const rollAll = list => list.reduce((n, x) => { for (let i = 0; i < x.times; i++) n += rollFormula(x.f, rand).total; return n; }, 0);
    if (sum.arrival) {
      if (sum.homeless > 0) events.push({ kind: "arrival", text: "Новые семьи не придут, пока есть бездомные." });
      else {
        const plus = rollAll(sum.arrivalDice);
        const chance = Math.min(100, sum.arrival.base + plus);
        const d = rollFormula("1d100", rand).total;
        if (d <= chance) {
          const cap = sum.freeHouses > 0 ? sum.freeHouses : HOMELESS_CAP;
          arrived = Math.min(cap, Math.max(1, rollFormula(sum.arrival.formula, rand).total));
          events.push({ kind: "arrival", text: `Пришли семьи: ${arrived}${sum.freeHouses ? "" : " (домов нет — бездомными)"}. Бросок ${d} из ${chance}${plus ? ` (обустройство +${plus})` : ""}.` });
        } else events.push({ kind: "arrival", text: `Новые семьи не пришли (бросок ${d}, нужно ${chance} и меньше${plus ? `, обустройство +${plus}` : ""}).` });
      }
    }
    if (sum.revoltBase > 0) {
      const minus = rollAll(sum.revoltDice);
      const chance = Math.max(0, sum.revoltBase - minus);
      const d = rollFormula("1d100", rand).total;
      const note = minus ? `, обустройство −${minus}` : "";
      if (chance > 0 || minus) events.push(d <= chance
        ? { kind: "revolt", text: `Бунт! Народ поднялся против правителя (бросок ${d}, шанс ${chance}%${note}).`, danger: true }
        : { kind: "revolt", text: `Ропот без бунта (бросок ${d}, шанс ${chance}%${note}).` });
    }
    // Настройка «одобрение от нужд»: был в месяце голод или холод — одобрение −1
    if (needsApproval && monthShort > 0) {
      approval = Math.max(0, approval - 1);
      events.push({ kind: "needs", text: `Голод и холод (недель с нехваткой: ${monthShort}): одобрение падает до ${approval}.`, danger: true });
    }
    if (state.siege) {
      approval = Math.max(0, approval - 1);
      events.push({ kind: "siege", text: `Осада тянется: одобрение падает до ${approval}.`, danger: true });
    }
    if (sum.approvalBonus) {
      const was = approval;
      approval = Math.max(0, Math.min(APPROVAL_MAX, approval + sum.approvalBonus));
      if (approval !== was) events.push({ kind: "approval", text: `Постройки радуют народ: одобрение ${approval > was ? "растёт" : "падает"} до ${approval}.` });
    }
    if (sum.content) events.push({ kind: "content", text: "Народ доволен правителем: в конце месяца возможны дополнительные ресурсы — решает ведущий." });
  }

  // Стройка: каждой строящейся постройке — одна свободная семья
  let builders = sum.builders;
  const buildings = (state.buildings ?? []).map(b => ({ ...b }));
  const built = [];
  for (const b of buildings) {
    if (builders <= 0) break;
    if (!b.constructing && b.research?.node) {
      const node = upgradeNodes(b).find(x => x.id === b.research.node);
      builders--;
      b.research = { node: b.research.node, progress: b.research.progress + 1 };
      if (!node || b.research.progress >= node.weeks) {
        if (node) { b.upgrades = [...b.upgrades, node.id]; built.push({ name: `${b.name}: ${node.name}`, upgrade: true }); }
        b.research = { node: "", progress: 0 };
      }
      continue;
    }
    if (!b.constructing) continue;
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
  // Модификаторы событий — на неделю короче; кончились — строкой в отчёте
  const modifiers = [];
  for (const m of mods) {
    if ((m.weeks ?? 0) > 1) modifiers.push({ ...m, weeks: m.weeks - 1 });
    else events.push({ kind: "modifier", text: `Закончилось: «${m.label}».` });
  }
  const next = { year, month, week, families: families + arrived, approval, wealth, stock, buildings, modifiers, monthShort: monthEnd ? 0 : monthShort };
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
