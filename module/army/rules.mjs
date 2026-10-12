// Правила ополчений и армий (PLAN 4.187, 4.198) — чистые функции без Foundry: сила отряда, цена снаряжения (оружие и броня
// отдельно), неделя отряда (тренировка, опыт, ступень обучения, еда, плата, боевой дух) и раунд битвы (бросок сил сторон,
// потери с бронёй, бегство, опыт). Ступени обучения (config/unit-upgrades.mjs) сводятся в unitMods.

import { UNIT_KINDS, TRAINING, WEAPONS, ARMOR, MAX_TRAINING, MAX_GEAR, MORALE_MAX, ROUT_AT, TERRAIN, SOLDIERS_PER_POWER,
  FOOD_PER_SOLDIER, MERCENARY } from "../config/army.mjs";
import { RANKS, XP, rankOf } from "../config/unit-upgrades.mjs";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Сводка эффектов купленных ступеней обучения. */
export function unitMods(branches = [], upgrades = []) {
  const bought = new Set(upgrades);
  const m = { power: 0, firstRound: 0, defend: 0, morale: 0, rout: 0, losses: 0, food: 0, pay: 0, drill: 0, vs: {}, terrain: {} };
  for (const br of branches) for (const nd of br.nodes ?? []) {
    if (!bought.has(nd.id)) continue;
    for (const e of nd.effects ?? []) {
      const v = Number(e.value) || 0;
      if (e.type === "vs") { if (e.kind) m.vs[e.kind] = (m.vs[e.kind] ?? 0) + v; }
      else if (e.type === "terrain") { if (e.terrain) m.terrain[e.terrain] = (m.terrain[e.terrain] ?? 0) + v; }
      else if (e.type in m) m[e.type] += v;
    }
  }
  return m;
}

/** Ступени обучения списком (по веткам). */
export function unitNodes(u) {
  return (u?.branches ?? []).flatMap(br => (br.nodes ?? []).map(nd => ({ ...nd, branch: br.id })));
}

/** Отряд для правил из данных актёра «Отряд». */
export function unitState(actor) {
  const s = actor.system ?? {};
  const branches = s.branches ?? [];
  const upgrades = [...(s.upgrades ?? [])];
  const xp = Math.max(0, s.xp ?? 0);
  return { id: actor.id ?? actor._id, name: actor.name, kind: s.kind ?? "infantry", origin: s.origin ?? "militia",
    soldiers: Math.max(0, s.soldiers ?? 0), training: clamp(s.training ?? 0, 0, MAX_TRAINING), progress: s.progress ?? 0,
    drilling: !!s.drilling, weapons: clamp(s.weapons ?? 0, 0, MAX_GEAR), armor: clamp(s.armor ?? 0, 0, MAX_GEAR),
    morale: clamp(s.morale ?? 5, 0, MORALE_MAX), commanderBonus: s.commanderBonus ?? 0, routed: !!s.routed,
    xp, rank: rankOf(xp), branches, upgrades, research: { node: s.research?.node ?? "", progress: s.research?.progress ?? 0 },
    mods: unitMods(branches, upgrades) };
}

/** Порог бегства отряда (ступени «Стойкости» опускают его). */
export const routAt = u => Math.max(0, ROUT_AT - (u.mods?.rout ?? 0));

/**
 * Сила отряда: род + выучка + оружие + броня + численность (1 за 10 бойцов) + опыт (звание) + командир + боевой дух
 * ((дух − 5) / 2) + обучение и, в бою, — против рода врага, первый раунд, местность, оборона.
 * @returns {{total: number, parts: {label: string, value: number}[]}}
 */
export function unitPower(u, { enemyKinds = [], round = 0, terrain = "field", defender = false } = {}) {
  if (!u.soldiers || u.routed) return { total: 0, parts: [] };
  const kind = UNIT_KINDS[u.kind] ?? UNIT_KINDS.infantry;
  const m = u.mods ?? unitMods();
  const w = WEAPONS[u.weapons ?? 0] ?? WEAPONS[0];
  const a = ARMOR[u.armor ?? 0] ?? ARMOR[0];
  const parts = [
    { label: kind.label, value: kind.base },
    { label: TRAINING[u.training].label, value: TRAINING[u.training].power },
    { label: `Оружие: ${w.label.toLowerCase()}`, value: w.power },
    { label: `Броня: ${a.label.toLowerCase()}`, value: a.power },
    { label: `Бойцов ${u.soldiers}`, value: Math.floor(u.soldiers / SOLDIERS_PER_POWER) },
    { label: `Опыт: ${RANKS[u.rank ?? 0].label.toLowerCase()}`, value: RANKS[u.rank ?? 0].power }
  ];
  if (u.commanderBonus) parts.push({ label: "Командир", value: u.commanderBonus });
  const morale = Math.trunc((u.morale - 5) / 2);
  if (morale) parts.push({ label: "Боевой дух", value: morale });
  if (m.power) parts.push({ label: "Обучение", value: m.power });
  const vs = Math.max(0, ...enemyKinds.map(k => (kind.vs?.[k] ?? 0) + (m.vs[k] ?? 0)));
  if (vs) parts.push({ label: "Против рода врага", value: vs });
  if (round === 1 && (kind.firstRound || m.firstRound)) parts.push({ label: "Первый удар", value: (kind.firstRound ?? 0) + m.firstRound });
  const ground = (u.kind === "cavalry" ? TERRAIN[terrain]?.cavalry ?? 0 : 0) + (m.terrain[terrain] ?? 0);
  if (ground) parts.push({ label: TERRAIN[terrain]?.label ?? terrain, value: ground });
  if (defender && m.defend) parts.push({ label: "Оборона", value: m.defend });
  return { total: parts.reduce((s, p) => s + p.value, 0), parts: parts.filter(p => p.value) };
}

/**
 * Что нужно со склада, чтобы снарядить бойцов по дорожке track («weapons» или «armor») со ступени from до to.
 */
export function equipCost(kind, track, from, to, count) {
  const gear = UNIT_KINDS[kind]?.gear?.[track] ?? [];
  const sum = {};
  for (let t = from + 1; t <= to; t++) for (const g of gear[t - 1] ?? []) sum[g.resource] = (sum[g.resource] ?? 0) + g.qty * count;
  return Object.entries(sum).map(([resource, qty]) => ({ resource, qty }));
}

/** Еда отряда в неделю («Снабжение» сокращает). */
export const unitFood = u => Math.round(u.soldiers * FOOD_PER_SOLDIER * Math.max(0, 1 - (u.mods?.food ?? 0) / 100) * 10) / 10;
/** Плата наёмникам в неделю (Богатство). */
export const unitPay = u => (u.origin === "mercenary"
  ? Math.round(u.soldiers * MERCENARY.pay * Math.max(0, 1 - (u.mods?.pay ?? 0) / 100) * 1000) / 1000 : 0);

/**
 * Неделя отряда.
 * @param {object} u — unitState
 * @param {{fed: number, paid: boolean, drill: number}} ctx — доля еды (0–1), заплачено ли наёмникам, скорость
 *   тренировки (0 — негде тренироваться: нет плаца или казармы)
 * @returns {{training, progress, morale, soldiers, xp, research, upgrades, notes: string[]}}
 */
export function unitWeek(u, { fed = 1, paid = true, drill = 0, rand = Math.random } = {}) {
  let { training, progress, morale, soldiers } = u;
  let xp = u.xp ?? 0;
  let research = { node: u.research?.node ?? "", progress: u.research?.progress ?? 0 };
  const upgrades = [...(u.upgrades ?? [])];
  const m = u.mods ?? unitMods();
  const notes = [];
  if (u.drilling) {
    if (!drill) notes.push("тренироваться негде — нужен плац или казарма");
    else {
      const rankWas = rankOf(xp);
      xp += XP.drill;
      if (rankOf(xp) > rankWas) notes.push(`новое звание: ${RANKS[rankOf(xp)].label.toLowerCase()}`);
      if (training < MAX_TRAINING) {
        progress += drill + m.drill;
        if (progress >= TRAINING[training].weeks) {
          training += 1; progress = 0;
          notes.push(`выучка выросла: ${TRAINING[training].label.toLowerCase()}`);
        }
      }
      // Ступень обучения — неделями на плацу
      const node = research.node ? unitNodes(u).find(x => x.id === research.node) : null;
      if (research.node) {
        research = { node: research.node, progress: research.progress + 1 };
        if (!node || research.progress >= node.weeks) {
          if (node) { upgrades.push(node.id); notes.push(`освоили «${node.name}»`); }
          research = { node: "", progress: 0 };
        }
      }
    }
  }
  if (fed < 1) { morale -= 2; notes.push(`не хватило еды — боевой дух падает`); }
  else if (morale < TRAINING[training].morale + m.morale) morale += 1;
  if (u.origin === "mercenary" && !paid) {
    morale -= 3;
    const gone = Math.ceil(soldiers * 0.1);
    soldiers -= gone;
    notes.push(`наёмникам не заплатили: ушли ${gone}`);
  }
  morale = clamp(morale, 0, MORALE_MAX);
  return { training, progress, morale, soldiers: Math.max(0, soldiers), xp, research, upgrades, notes };
}

/**
 * Раунд битвы. Стороны — [{units: unitState[], defender: boolean}]; каждая бросает d10 + сила своих не бежавших
 * отрядов (+ местность обороняющимся). Проигравший теряет 5 % + 2 % за каждое очко разницы (не больше 40 %) и
 * 1 + разница/4 боевого духа; победитель — 2 % (5 % при разнице меньше 3). Ничья — по 3 % и −1 духа обоим. Броня и
 * обучение снимают часть потерь. Отряд с духом на пороге бегства и ниже бежит. Битва кончается, когда у стороны не
 * осталось стоящих отрядов. Опыт: каждому сражавшемуся — за раунд, стороне-победителю битвы — ещё за победу.
 */
export function battleRound(sides, { round = 1, terrain = "field", rand = Math.random } = {}) {
  const kindsOf = side => side.units.filter(u => u.soldiers && !u.routed).map(u => u.kind);
  const rolls = sides.map((side, i) => {
    const enemy = kindsOf(sides[1 - i]);
    const powers = side.units.map(u => ({ id: u.id, ...unitPower(u, { enemyKinds: enemy, round, terrain, defender: !!side.defender }) }));
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
      if (!u.soldiers || u.routed) { units.push({ side: i, id: u.id, name: u.name, lost: 0, soldiers: u.soldiers, morale: u.morale, routed: u.routed, xp: 0 }); continue; }
      const cut = Math.min(0.9, ((ARMOR[u.armor ?? 0]?.losses ?? 0) + (u.mods?.losses ?? 0)) / 100);
      const dead = Math.min(u.soldiers, Math.ceil(u.soldiers * lost * (1 - cut)));
      const morale = clamp(u.morale - moraleLoss + (i === winner && margin >= 6 ? 1 : 0), 0, MORALE_MAX);
      const soldiers = u.soldiers - dead;
      units.push({ side: i, id: u.id, name: u.name, lost: dead, soldiers, morale, routed: morale <= routAt(u) || !soldiers, xp: XP.round });
    }
  });
  const standing = i => units.some(u => u.side === i && !u.routed && u.soldiers > 0);
  const over = !standing(0) || !standing(1);
  const victor = over ? (standing(0) ? 0 : standing(1) ? 1 : null) : null;
  if (victor !== null) for (const u of units) if (u.side === victor && u.xp) u.xp += XP.victory;
  return { round, rolls, winner, margin, units, over, victor };
}
