// Расовые навыки высшего вампира («Высший вампир. Вторая редакция»): Очки Крови, Шкала Зверя, роль и ветки
// навыков. Значения хранятся в предмете расы на персонаже — как очки древа в предмете профессии.

import { STATS } from "../config/stats.mjs";
import { trueFormState, formTier } from "./true-form.mjs";

const KIND_LABELS = {
  base: "база роли",
  tree: "ступень древа",
  skill: "навык за опыт",
  level: "уровень + d10",
  stages: "стадии"
};
const STAGE_LABELS = ["Лёгкий", "Средний", "Тяжёлый", "Смертельный"];

/** Что даёт следующий щелчок «за ОК»: открытие ступени, стадия или уровень. null — нечего. */
export function powerStep(rs, p) {
  if (p.kind === "stages") {
    if (p.value >= p.stageCosts.length) return null;
    return { cost: p.stageCosts[p.value], label: `Открыть стадию «${STAGE_LABELS[p.value] ?? p.value + 1}»` };
  }
  if (p.kind === "tree" && p.value === 0 && p.unlockCost) {
    if (!rs.isUnlockable(p)) return null;
    return { cost: p.unlockCost, label: "Открыть ступень" };
  }
  if (p.levelCost && p.value < p.max) return { cost: p.levelCost, label: `Повысить до ${p.value + 1}` };
  return null;
}

/** Записать уровень навыка в предмет расы (массив целиком: у навыков нет своих id). */
export async function setPowerValue(race, key, value) {
  if (!race) return;
  const powers = race.system.toObject().powers;
  const p = powers.find(x => x.key === key);
  if (!p) return;
  p.value = Math.max(0, Math.min(p.max || 10, Math.round(value)));
  await race.update({ "system.powers": powers });
}

/** Контекст подвкладки «Высший вампир» на листе; null — у расы нет расовых навыков. */
export function racePowersContext(actor) {
  const race = actor.system.race;
  const rs = race?.system;
  if (!rs?.powers?.length) return null;
  const system = actor.system;
  const blood = system.blood?.value ?? 0;
  const view = p => {
    const unlockable = rs.isUnlockable(p);
    const step = powerStep(rs, p);
    const stat = p.stat ? system.stats[p.stat] : null;
    return {
      ...p,
      learned: p.value > 0,
      locked: p.kind === "tree" && p.value === 0 && !unlockable,
      lockNote: p.requires ? `Сначала — «${rs.power(p.requires)?.name ?? p.requires}».` : "",
      kindLabel: p.stat ? `${STATS[p.stat]?.label ?? p.stat} · за опыт` : KIND_LABELS[p.kind] ?? "",
      base: p.roll ? (stat?.effective ?? 0) + p.value : null,
      baseHint: p.stat ? `Основа: ${STATS[p.stat]?.label} + уровень` : "Основа: уровень",
      unlock: step ? { ...step, short: blood < step.cost } : null,
      stages: p.kind === "stages" ? p.stageCosts.map((cost, i) => ({ label: STAGE_LABELS[i] ?? i + 1, cost, open: i < p.value })) : null,
      // Превращение: управление Истинной формой
      form: p.key === "trueForm" ? { ...trueFormState(actor), learned: p.value > 0, isGM: game.user.isGM,
        tier: formTier(p.value), enough: blood >= 30, canExtend: blood >= 10 } : null,
      meta: [p.dc ? `СЛ ${p.dc}` : "", p.cost ? `трата: ${p.cost}` : "", p.range, p.duration,
        p.defense ? `защита: ${p.defense}` : "", p.page ? `стр. ${p.page}` : ""].filter(Boolean).join(" · ")
    };
  };
  const powersOf = group => rs.powers.filter(p => p.group === group);
  const roleFull = key => !!key && powersOf(key).length > 0 && powersOf(key).every(p => p.value > 0);
  const roleInfo = key => rs.roles.find(r => r.key === key);
  const groups = [{ key: "core", name: "Общие расовые навыки", description: "", powers: powersOf("core").map(view) }];
  for (const key of rs.activeRoles) {
    const r = roleInfo(key);
    if (r) groups.push({ key, name: r.name, description: r.description, powers: powersOf(key).map(view) });
  }
  const isGM = game.user.isGM;
  return {
    id: race.id, name: race.name, img: race.img,
    blood: { value: blood, max: system.blood?.max ?? 0, pct: system.blood?.max ? Math.min(100, Math.round(blood / system.blood.max * 100)) : 0 },
    beast: Array.from({ length: 10 }, (_, i) => ({ n: i + 1, on: i < (system.beast?.value ?? 0) })),
    beastValue: system.beast?.value ?? 0,
    beastFull: (system.beast?.value ?? 0) >= 10,
    role: rs.role,
    roles: rs.roles.map(r => ({ key: r.key, name: r.name, selected: r.key === rs.role })),
    // Роль не меняется в процессе игры — выбрать один раз; ведущий может исправить
    roleEditable: actor.isOwner && (!rs.role || isGM),
    roles2: rs.roles.filter(r => r.key !== rs.role).map(r => ({ key: r.key, name: r.name, selected: r.key === rs.role2 })),
    secondOpen: roleFull(rs.role),
    role2Editable: actor.isOwner && (roleFull(rs.role) || isGM) && (!rs.role2 || isGM),
    groups
  };
}
