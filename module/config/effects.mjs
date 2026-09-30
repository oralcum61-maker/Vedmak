// Активные эффекты: во что можно целиться и как это называется по-человечески.
// Эффекты Foundry пишут в пути данных (`system.stats.ref.mod`); здесь они собраны в список для выпадающего меню.

import { STATS, SKILL_STATS } from "./stats.mjs";
import { SKILLS, skillsByStat } from "./skills.mjs";
import { signed } from "../util.mjs";

/** Как эффект меняет значение. «custom» не предлагаем — он для кода. */
export const CHANGE_TYPES = {
  add: "Прибавить",
  subtract: "Вычесть",
  multiply: "Умножить",
  override: "Заменить",
  upgrade: "Не ниже",
  downgrade: "Не выше"
};

/** Бонусы к максимумам: складываются с формулой (стр. 47–48). */
export const MAX_BONUSES = {
  hp: "Пункты здоровья", sta: "Выносливость", vigor: "Энергия", stun: "Устойчивость",
  rec: "Отдых", run: "Бег", enc: "Переносимый вес"
};

/** Скрытые поля для временных бонусов — их не трогают формы листа. */
export const FX_TARGETS = {
  damage: "Урон любыми атаками", meleeDamage: "Урон в ближнем бою",
  hp: "Пункты здоровья (временно)", sta: "Выносливость (временно)", vigor: "Энергия (временно)",
  stun: "Устойчивость (временно)", rec: "Отдых (временно)", run: "Бег (временно)", enc: "Переносимый вес (временно)"
};

/** Цели, сгруппированные для выпадающего списка. */
export function effectTargets() {
  const groups = [
    { label: "Параметры", options: Object.entries(STATS).map(([key, s]) => ({ value: `system.stats.${key}.mod`, label: s.label })) }
  ];
  const byStat = skillsByStat();
  for (const stat of SKILL_STATS) {
    groups.push({
      label: `Навыки: ${STATS[stat].label}`,
      options: (byStat[stat] ?? []).map(s => ({ value: `system.skills.${s.key}.mod`, label: s.label }))
    });
  }
  groups.push({ label: "Максимумы", options: Object.entries(MAX_BONUSES).map(([k, label]) => ({ value: `system.bonus.${k}`, label })) });
  groups.push({ label: "Бой и алхимия", options: Object.entries(FX_TARGETS).map(([k, label]) => ({ value: `system.fx.${k}`, label })) });
  return groups;
}

let CACHE = null;

/** Название цели по пути данных; неизвестный путь возвращается как есть. */
export function targetLabel(key) {
  if (!key) return "";
  if (!CACHE) {
    CACHE = new Map();
    for (const g of effectTargets()) {
      for (const o of g.options) CACHE.set(o.value, g.label.startsWith("Навыки") ? `${o.label}` : o.label);
    }
  }
  if (CACHE.has(key)) return CACHE.get(key);
  // Пути, которых нет в списке: `system.stats.ref.mod` → «Реакция»
  const stat = key.match(/^system\.stats\.(\w+)\./);
  if (stat && STATS[stat[1]]) return STATS[stat[1]].label;
  const skill = key.match(/^system\.skills\.(\w+)\./);
  if (skill && SKILLS[skill[1]]) return SKILLS[skill[1]].label;
  return key;
}

/** Одно изменение словами: «Реакция −1», «Выносливость ×2». */
export function describeChange(change) {
  const label = targetLabel(change?.key);
  const value = change?.value ?? "";
  switch (change?.type) {
    case "add": return `${label} ${signed(value)}`;
    case "subtract": return `${label} −${value}`;
    case "multiply": return `${label} ×${value}`;
    case "override": return `${label} = ${value}`;
    case "upgrade": return `${label} не ниже ${value}`;
    case "downgrade": return `${label} не выше ${value}`;
    default: return `${label} ${value}`.trim();
  }
}

/** Все изменения эффекта одной строкой. */
export function describeChanges(changes) {
  return (changes ?? []).map(describeChange).filter(Boolean).join(" · ");
}
