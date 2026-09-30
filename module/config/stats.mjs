// Параметры и производные (корник стр. 47–48).

/** Девять основных параметров. `abbr` — как в книге и на листе. */
export const STATS = {
  int:  { label: "Интеллект",    abbr: "Инт",   about: "знания, дедукция, внимание" },
  ref:  { label: "Реакция",      abbr: "Реа",   about: "уклонение, порядок хода" },
  dex:  { label: "Ловкость",     abbr: "Лвк",   about: "оружие, стрельба, скрытность" },
  body: { label: "Телосложение", abbr: "Тел",   about: "ПЗ, Вын, переносимый вес" },
  spd:  { label: "Скорость",     abbr: "Скор",  about: "бег и прыжок" },
  emp:  { label: "Эмпатия",      abbr: "Эмп",   about: "убеждение, обман, харизма" },
  cra:  { label: "Ремесло",      abbr: "Рем",   about: "изготовление, алхимия, починка" },
  will: { label: "Воля",         abbr: "Воля",  about: "знаки, сопротивление магии" },
  luck: { label: "Удача",        abbr: "Удача", about: "тратится на любой бросок" }
};

/** Параметры по смыслу: два столбца на вкладке «Параметры», Удача стоит отдельно. */
export const STAT_GROUPS = [
  { key: "body", label: "ТЕЛО",  stats: ["body", "ref", "dex", "spd"] },
  { key: "mind", label: "РАЗУМ", stats: ["int", "will", "emp", "cra"] }
];

/** Параметры, из которых растут навыки (Удача и Скорость навыков не имеют). */
export const SKILL_STATS = ["int", "ref", "dex", "body", "emp", "cra", "will"];

/** Производные параметры и их подписи. */
export const DERIVED = {
  vigor:  { label: "Энергия",            abbr: "Энергия" },
  stun:   { label: "Устойчивость",       abbr: "Уст" },
  run:    { label: "Бег",                abbr: "Бег" },
  leap:   { label: "Прыжок",             abbr: "Прж" },
  hp:     { label: "Пункты здоровья",    abbr: "ПЗ" },
  sta:    { label: "Выносливость",       abbr: "Вын" },
  enc:    { label: "Переносимый вес",    abbr: "Вес" },
  rec:    { label: "Отдых",              abbr: "Отдых" },
  woundThreshold: { label: "Порог ранения", abbr: "ПР" },
  resolve: { label: "Решительность",     abbr: "Реш" }
};

/** Шкала значений параметров и навыков (стр. 47, 49). */
export const RANK_LABELS = [
  { max: 2,  label: "Неумёха" },
  { max: 4,  label: "Ничего особенного" },
  { max: 6,  label: "Способный" },
  { max: 8,  label: "Герой" },
  { max: 10, label: "Потрясающий" },
  { max: 12, label: "Легенда" },
  { max: Infinity, label: "Супергерой" }
];

/** Очки на параметры по уровню игры (стр. 47). */
export const STAT_POINT_BUY = {
  average:  { label: "Середнячки", points: 60 },
  skilled:  { label: "Опытные",    points: 70 },
  heroic:   { label: "Герои",      points: 75 },
  legendary:{ label: "Легенды",    points: 80 }
};

/**
 * Бонус урона в ближнем бою и удары без оружия по Телосложению (стр. 48).
 * Значение Тел выше 13 считается как 13.
 */
const BODY_ROWS = [
  { upTo: 2,  meleeBonus: -4, punch: "1d6-4", kick: "1d6" },
  { upTo: 4,  meleeBonus: -2, punch: "1d6-2", kick: "1d6+2" },
  { upTo: 6,  meleeBonus: 0,  punch: "1d6",   kick: "1d6+4" },
  { upTo: 8,  meleeBonus: 2,  punch: "1d6+2", kick: "1d6+6" },
  { upTo: 10, meleeBonus: 4,  punch: "1d6+4", kick: "1d6+8" },
  { upTo: 12, meleeBonus: 6,  punch: "1d6+6", kick: "1d6+10" },
  { upTo: 13, meleeBonus: 8,  punch: "1d6+8", kick: "1d6+12" }
];

export function bodyTable(body) {
  const b = Math.max(1, Math.min(13, Number(body) || 0));
  const { meleeBonus, punch, kick } = BODY_ROWS.find(r => b <= r.upTo);
  return { meleeBonus, punch, kick };
}

/**
 * Удар рукой на `steps` строк таблицы выше (атака щитом: средний +2, тяжёлый +4 — стр. 164).
 * Выше последней строки каждая ступень добавляет +2.
 */
export function punchSteps(body, steps = 0) {
  const b = Math.max(1, Math.min(13, Number(body) || 0));
  const idx = BODY_ROWS.findIndex(r => b <= r.upTo) + steps;
  const last = BODY_ROWS.length - 1;
  if (idx <= last) return BODY_ROWS[Math.max(0, idx)].punch;
  return `1d6+${8 + (idx - last) * 2}`;
}
