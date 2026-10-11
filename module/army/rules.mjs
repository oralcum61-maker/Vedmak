// Правила ополчений и армий (PLAN 4.187) — чистые функции без Foundry: сила отряда, цена снаряжения, неделя отряда
// (тренировка, еда, плата, боевой дух) и раунд битвы (бросок сил сторон, потери, бегство).

import { UNIT_KINDS, TRAINING, EQUIPMENT, MAX_TRAINING, MAX_EQUIPMENT, MORALE_MAX, ROUT_AT, TERRAIN, SOLDIERS_PER_POWER,
  FOOD_PER_SOLDIER, MERCENARY } from "../config/army.mjs";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Отряд для правил из данных актёра «Отряд». */
export function unitState(actor) {
  const s = actor.system ?? {};
  return { id: actor.id ?? actor._id, name: actor.name, kind: s.kind ?? "infantry", origin: s.origin ?? "militia",
    soldiers: Math.max(0, s.soldiers ?? 0), training: clamp(s.training ?? 0, 0, MAX_TRAINING), progress: s.progress ?? 0,
    drilling: !!s.drilling, equipment: clamp(s.equipment ?? 0, 0, MAX_EQUIPMENT), morale: clamp(s.morale ?? 5, 0, MORALE_MAX),
    commanderBonus: s.commanderBonus ?? 0, routed: !!s.routed };
}

/**
 * Сила отряда: род + выучка + снаряжение + численность (1 за 10 бойцов) + командир + боевой дух ((дух − 5) / 2) и,
 * в бою, — против рода врага, первый раунд стрелков, местность.
 * @returns {{total: number, parts: {label: string, value: number}[]}}
 */
export function unitPower(u, { enemyKinds = [], round = 0, terrain = "field" } = {}) {
  if (!u.soldiers || u.routed) return { total: 0, parts: [] };
  const kind = UNIT_KINDS[u.kind] ?? UNIT_KINDS.infantry;
  const parts = [
    { label: kind.label, value: kind.base },
    { label: TRAINING[u.training].label, value: TRAINING[u.training].power },
    { label: `Снаряжение: ${EQUIPMENT[u.equipment].label.toLowerCase()}`, value: EQUIPMENT[u.equipment].power },
    { label: `Бойцов ${u.soldiers}`, value: Math.floor(u.soldiers / SOLDIERS_PER_POWER) }
  ];
  if (u.commanderBonus) parts.push({ label: "Командир", value: u.commanderBonus });
  const morale = Math.trunc((u.morale - 5) / 2);
  if (morale) parts.push({ label: "Боевой дух", value: morale });
  const vs = Math.max(0, ...enemyKinds.map(k => kind.vs?.[k] ?? 0));
  if (vs) parts.push({ label: "Против рода врага", value: vs });
  if (round === 1 && kind.firstRound) parts.push({ label: "Залп издали", value: kind.firstRound });
  if (u.kind === "cavalry" && TERRAIN[terrain]?.cavalry) parts.push({ label: TERRAIN[terrain].label, value: TERRAIN[terrain].cavalry });
  return { total: parts.reduce((s, p) => s + p.value, 0), parts: parts.filter(p => p.value) };
}

/** Что нужно со склада, чтобы снарядить бойцов с уровня from до уровня to. */
export function equipCost(kind, from, to, count) {
  const gear = UNIT_KINDS[kind]?.gear ?? [];
  const sum = {};
  for (let t = from + 1; t <= to; t++) for (const g of gear[t - 1] ?? []) sum[g.resource] = (sum[g.resource] ?? 0) + g.qty * count;
  return Object.entries(sum).map(([resource, qty]) => ({ resource, qty }));
}

/** Еда отряда в неделю. */
export const unitFood = u => Math.round(u.soldiers * FOOD_PER_SOLDIER * 10) / 10;
/** Плата наёмникам в неделю (Богатство). */
export const unitPay = u => (u.origin === "mercenary" ? Math.round(u.soldiers * MERCENARY.pay * 1000) / 1000 : 0);

/**
 * Неделя отряда.
 * @param {object} u — unitState
 * @param {{fed: number, paid: boolean, drill: number}} ctx — доля еды (0–1), заплачено ли наёмникам, скорость
 *   тренировки (0 — негде тренироваться: нет плаца или казармы)
 * @returns {{training, progress, morale, soldiers, notes: string[]}}
 */
export function unitWeek(u, { fed = 1, paid = true, drill = 0, rand = Math.random } = {}) {
  let { training, progress, morale, soldiers } = u;
  const notes = [];
  if (u.drilling && training < MAX_TRAINING) {
    if (!drill) notes.push("тренироваться негде — нужен плац или казарма");
    else {
      progress += drill;
      if (progress >= TRAINING[training].weeks) {
        training += 1; progress = 0;
        notes.push(`выучка выросла: ${TRAINING[training].label.toLowerCase()}`);
      }
    }
  }
  if (fed < 1) { morale -= 2; notes.push(`не хватило еды — боевой дух падает`); }
  else if (morale < TRAINING[training].morale) morale += 1;
  if (u.origin === "mercenary" && !paid) {
    morale -= 3;
    const gone = Math.ceil(soldiers * 0.1);
    soldiers -= gone;
    notes.push(`наёмникам не заплатили: ушли ${gone}`);
  }
  morale = clamp(morale, 0, MORALE_MAX);
  return { training, progress, morale, soldiers: Math.max(0, soldiers), notes };
}

/**
 * Раунд битвы. Стороны — [{units: unitState[], defender: boolean}]; каждая бросает d10 + сила своих не бежавших
 * отрядов (+ местность обороняющимся). Проигравший теряет 5 % + 2 % за каждое очко разницы (не больше 40 %) и
 * 1 + разница/4 боевого духа; победитель — 2 % (5 % при разнице меньше 3). Ничья — по 3 % и −1 духа обоим.
 * Отряд с духом 2 и ниже бежит. Битва кончается, когда у стороны не осталось стоящих отрядов.
 */
export function battleRound(sides, { round = 1, terrain = "field", rand = Math.random } = {}) {
  const kindsOf = side => side.units.filter(u => u.soldiers && !u.routed).map(u => u.kind);
  const rolls = sides.map((side, i) => {
    const enemy = kindsOf(sides[1 - i]);
    const powers = side.units.map(u => ({ id: u.id, ...unitPower(u, { enemyKinds: enemy, round, terrain }) }));
    const power = powers.reduce((s, p) => s + p.total, 0);
    const ground = side.defender ? TERRAIN[terrain]?.defender ?? 0 : 0;
    const d10 = Math.floor(rand() * 10) + 1;
    return { d10, power, ground, total: d10 + power + ground, powers };
  });
  const diff = rolls[0].total - rolls[1].total;
  const winner = diff > 0 ? 0 : diff < 0 ? 1 : null;
  const margin = Math.abs(diff);
  const units = [];
  sides.forEach((side, i) => {
    const lost = winner === null ? 0.03 : i === winner ? (margin < 3 ? 0.05 : 0.02) : Math.min(0.4, 0.05 + margin * 0.02);
    const moraleLoss = winner === null ? 1 : i === winner ? 0 : 1 + Math.floor(margin / 4);
    for (const u of side.units) {
      if (!u.soldiers || u.routed) { units.push({ side: i, id: u.id, name: u.name, lost: 0, soldiers: u.soldiers, morale: u.morale, routed: u.routed }); continue; }
      const dead = Math.min(u.soldiers, Math.ceil(u.soldiers * lost));
      const morale = clamp(u.morale - moraleLoss + (i === winner && margin >= 6 ? 1 : 0), 0, MORALE_MAX);
      const soldiers = u.soldiers - dead;
      units.push({ side: i, id: u.id, name: u.name, lost: dead, soldiers, morale, routed: morale <= ROUT_AT || !soldiers });
    }
  });
  const standing = i => units.some(u => u.side === i && !u.routed && u.soldiers > 0);
  const over = !standing(0) || !standing(1);
  const victor = over ? (standing(0) ? 0 : standing(1) ? 1 : null) : null;
  return { round, rolls, winner, margin, units, over, victor };
}
