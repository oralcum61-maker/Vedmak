// Персонаж: расы, социальный статус, родина, ведьмачьи школы, развитие за О.У (корник стр. 20–60, 124, 237–245).

/** Ключи рас: механика черт завязана на ключ, а не на название предмета. */
export const RACES = {
  human:   { label: "Человек" },
  elf:     { label: "Эльф" },
  dwarf:   { label: "Краснолюд" },
  witcher: { label: "Ведьмак" },
  // «Книга сказаний» (стр. 3–6)
  gnome:   { label: "Гном" },
  vran:    { label: "Вран" },
  bobolak: { label: "Боболак" }
};

/* ---------------------------- Социальный статус --------------------------- */

/** Территории из таблицы социального статуса (стр. 21). */
export const REGIONS = {
  north:        { label: "Королевства Севера" },
  nilfgaard:    { label: "Империя Нильфгаард" },
  skellige:     { label: "Скеллиге" },
  dolBlathanna: { label: "Доль Блатанна" },
  mahakam:      { label: "Махакам" }
};

/**
 * Отношение к группе на территории. `level`: equal | tolerated | hated; `feared` — ещё и опасение.
 * Группы: люди, эльфы, краснолюды, ведьмаки, маги (корник стр. 21); гномы, враны, боболаки
 * («Книга сказаний», стр. 3).
 */
const E = { level: "equal" }, T = { level: "tolerated" }, H = { level: "hated" };
const HF = { level: "hated", feared: true }, TF = { level: "tolerated", feared: true };
export const SOCIAL_TABLE = {
  north:        { human: E, elf: H, dwarf: T, witcher: HF, mage: HF, gnome: T, vran: HF, bobolak: T },
  nilfgaard:    { human: E, elf: E, dwarf: E, witcher: HF, mage: T,  gnome: E, vran: TF, bobolak: T },
  skellige:     { human: E, elf: E, dwarf: E, witcher: T,  mage: T,  gnome: E, vran: HF, bobolak: T },
  dolBlathanna: { human: H, elf: E, dwarf: E, witcher: T,  mage: E,  gnome: E, vran: H,  bobolak: T },
  mahakam:      { human: T, elf: E, dwarf: E, witcher: T,  mage: T,  gnome: E, vran: T,  bobolak: E }
};

export const SOCIAL_LEVELS = {
  equal:     { label: "Равенство", rank: 0 },
  tolerated: { label: "Терпимость", rank: 1 },
  hated:     { label: "Ненависть", rank: 2 }
};

/** Навыки, на которые влияет терпимость/ненависть (стр. 21). */
export const SOCIAL_SKILLS = ["seduction", "charisma", "persuasion", "leadership"];

/**
 * Модификаторы бросков социального навыка.
 * Терпимость −1, ненависть −2 к Соблазнению, Харизме, Убеждению и Лидерству;
 * опасение +1 к Запугиванию и −1 к Харизме.
 */
export function socialModifier(status, skill) {
  let value = 0;
  if (SOCIAL_SKILLS.includes(skill)) value -= status.level === "hated" ? 2 : status.level === "tolerated" ? 1 : 0;
  if (status.feared && skill === "intimidation") value += 1;
  if (status.feared && skill === "charisma") value -= 1;
  return value;
}

export function socialLabel(status) {
  const base = SOCIAL_LEVELS[status.level]?.label ?? "Равенство";
  if (!status.feared) return base;
  return status.level === "equal" ? "Опасение" : `${base} и опасение`;
}

/* --------------------------------- Родина -------------------------------- */

/** Родина: регион жизненного пути, бонус к навыку (+1) и родной язык (стр. 25). */
export const HOMELANDS = {
  // Королевства Севера — d10
  redania:     { label: "Редания",             region: "north", roll: 1,  skill: "education" },
  kaedwen:     { label: "Каэдвен",             region: "north", roll: 2,  skill: "endurance" },
  temeria:     { label: "Темерия",             region: "north", roll: 3,  skill: "charisma" },
  aedirn:      { label: "Аэдирн",              region: "north", roll: 4,  skill: "crafting" },
  lyria:       { label: "Лирия и Ривия",       region: "north", roll: 5,  skill: "resistCoercion" },
  kovir:       { label: "Ковир и Повисс",      region: "north", roll: 6,  skill: "business" },
  skellige:    { label: "Скеллиге",            region: "north", roll: 7,  skill: "courage", language: "langElder" },
  cidaris:     { label: "Цидарис",             region: "north", roll: 8,  skill: "sailing" },
  verden:      { label: "Вердэн",              region: "north", roll: 9,  skill: "wilderness" },
  cintra:      { label: "Цинтра",              region: "north", roll: 10, skill: "perception" },
  // Империя Нильфгаард: 1–3 — сердце Империи, 4–10 — вассальное государство (ещё d10)
  nilfgaard:   { label: "Сердце Нильфгаарда",  region: "nilfgaard", roll: 1, skill: "deceit" },
  vicovaro:    { label: "Виковаро",            region: "nilfgaard", vassal: 1,  skill: "education" },
  angren:      { label: "Ангрен",              region: "nilfgaard", vassal: 2,  skill: "wilderness" },
  nazair:      { label: "Назаир",              region: "nilfgaard", vassal: 3,  skill: "brawling" },
  metinna:     { label: "Метинна",             region: "nilfgaard", vassal: 4,  skill: "riding" },
  magTurga:    { label: "Маг Турга",           region: "nilfgaard", vassal: 5,  skill: "endurance" },
  geso:        { label: "Гесо",                region: "nilfgaard", vassal: 6,  skill: "stealth" },
  ebbing:      { label: "Эббинг",              region: "nilfgaard", vassal: 7,  skill: "deduction" },
  mecht:       { label: "Мехт",                region: "nilfgaard", vassal: 8,  skill: "charisma" },
  gemmera:     { label: "Геммера",             region: "nilfgaard", vassal: 9,  skill: "intimidation" },
  etolia:      { label: "Этолия",              region: "nilfgaard", vassal: 10, skill: "courage" },
  // Земли Старших Народов
  dolBlathanna: { label: "Доль Блатанна",      region: "elder", skill: "etiquette", race: "elf" },
  mahakam:     { label: "Махакам",             region: "elder", skill: "crafting", race: "dwarf" }
};

/** Регион происхождения → колонка таблиц жизненного пути и родной язык. */
export const ORIGIN_REGIONS = {
  north:     { label: "Королевства Севера", column: 0, language: "langCommon" },
  nilfgaard: { label: "Империя Нильфгаард", column: 1, language: "langElder" },
  elder:     { label: "Земли Старших Народов", column: 2, language: "langElder" }
};

/** Родной язык по родине: Махакам — краснолюдский, Скеллиге и Доль Блатанна — Старшая Речь (стр. 25). */
export function nativeLanguage(homelandKey) {
  const h = HOMELANDS[homelandKey];
  if (!h) return "langCommon";
  if (homelandKey === "mahakam") return "langDwarven";
  return h.language ?? ORIGIN_REGIONS[h.region]?.language ?? "langCommon";
}

/** Родная речь даётся бесплатно на уровне 8 (стр. 25). */
export const NATIVE_LANGUAGE_LEVEL = 8;

/** В какой регион социального статуса попадает родина. */
export function socialRegionOf(homelandKey) {
  const h = HOMELANDS[homelandKey];
  if (!h) return "north";
  if (homelandKey === "skellige") return "skellige";
  if (homelandKey === "dolBlathanna") return "dolBlathanna";
  if (homelandKey === "mahakam") return "mahakam";
  return h.region === "nilfgaard" ? "nilfgaard" : "north";
}

/* ---------------------------- Ведьмачьи школы ---------------------------- */

export const WITCHER_SCHOOLS = {
  "":      { label: "—" },
  wolf:    { label: "Школа Волка",   hint: "Нет штрафа при сильной атаке." },
  griffin: { label: "Школа Грифона", hint: "+2 к Энергии.", vigor: 2 },
  cat:     { label: "Школа Кота",    hint: "Невосприимчивость ко всем немагическим попыткам обольщения." },
  viper:   { label: "Школа Змеи",    hint: "Нет штрафа за парное оружие." },
  bear:    { label: "Школа Медведя", hint: "−2 к скованности движений (СД).", ev: -2 }
};

/* ------------------------------- Создание -------------------------------- */

export const CREATION = {
  professionSkillPoints: 44,   // 11 навыков профессии (стр. 49)
  skillCapCreation: 6,         // максимум навыка при создании
  skillCap: 10,                // максимум навыка в игре (расовые бонусы — сверх)
  statCap: 10,                 // максимум параметра (стр. 47)
  statMin: 1,
  rollRerollBelow: 3           // при случайных параметрах 1 и 2 перебрасываются
};

/* -------------------------------- Развитие ------------------------------- */

/**
 * Стоимость повышения навыка или способности древа на 1 (стр. 59):
 * новый — 1 О.У, дальше — текущий уровень; сложный навык — вдвое дороже.
 */
export function skillStepCost(current, difficult = false) {
  return Math.max(1, current) * (difficult ? 2 : 1);
}

/** Сколько стоит поднять навык с `from` до `to`. */
export function skillCost(from, to, difficult = false) {
  let sum = 0;
  for (let v = from; v < to; v++) sum += skillStepCost(v, difficult);
  return sum;
}

/** Параметр: текущее значение × 10 (стр. 59). */
export function statStepCost(current) {
  return Math.max(1, current) * 10;
}

/** Стоимость очков навыков при создании: сложный навык — 2 очка за уровень (стр. 49). */
export function creationSkillCost(value, difficult = false) {
  return value * (difficult ? 2 : 1);
}

/** Изучение магии (стр. 124): О.У, время, СЛ и число успешных проверок. */
export const MAGIC_LEARNING = {
  novice:     { ip: 10, time: "4 дня",    dc: 14, checks: 2 },
  journeyman: { ip: 20, time: "1 неделя", dc: 18, checks: 4 },
  master:     { ip: 30, time: "3 недели", dc: 22, checks: 6 },
  archPriest: { ip: 40, time: "5 недель", dc: 24, checks: 8 }
};

/** Уровень опасности порчи → уровень изучения. */
export const HEX_DANGER_LEVEL = { "низкая": "novice", "средняя": "journeyman", "высокая": "master" };

/** Кто что может изучать (стр. 124). Ключи — `key` профессии. */
export const MAGIC_ACCESS = {
  mage:    ["spell", "ritual", "hex", "sign"],
  priest:  ["invocation", "ritual", "hex", "sign"],
  witcher: ["sign"]
};

/** Механика способностей древа, влияющая на производные (стр. 63–66). */
export const ABILITY_MECHANICS = {
  "":            { label: "—" },
  vigorPer2:     { label: "+1 Энергии за каждые 2 очка" },
  vigorPer1:     { label: "+1 Энергии за очко" },
  vigorDouble:   { label: "+2 Энергии за очко" },
  toxicityPer1:  { label: "+5% порога токсичности за очко" }
};

export function abilityBonus(mechanic, value) {
  switch (mechanic) {
    case "vigorPer2": return { vigor: Math.floor(value / 2) };
    case "vigorPer1": return { vigor: value };
    case "vigorDouble": return { vigor: value * 2 };
    case "toxicityPer1": return { toxicity: value * 5 };
    default: return {};
  }
}

/* ------------------------------ Модификаторы ------------------------------ */

/**
 * Цели для модификаторов расы (строки вида {target, value}).
 * stats.* и skills.* складываются в `mod`, bonus.* — в бонусы максимумов, armor — естественная броня,
 * cap.* / floor.* — пределы итогового параметра.
 */
export function modTargets(STATS, SKILLS) {
  const out = {};
  for (const [k, s] of Object.entries(STATS)) out[`stats.${k}`] = `Параметр: ${s.label}`;
  for (const [k, s] of Object.entries(SKILLS)) out[`skills.${k}`] = `Навык: ${s.label}`;
  Object.assign(out, {
    "bonus.hp": "Максимум ПЗ", "bonus.sta": "Максимум Вын", "bonus.vigor": "Энергия", "bonus.stun": "Устойчивость",
    "bonus.rec": "Отдых", "bonus.run": "Бег", "bonus.enc": "Переносимый вес",
    "bonus.damage": "Урон физическими атаками", "bonus.meleeDamage": "Урон в ближнем бою",
    armor: "Естественная броня (ПБ)",
    "melee.body": "Тел для урона в рукопашной и захвата"
  });
  for (const [k, s] of Object.entries(STATS)) {
    out[`cap.${k}`] = `Не выше: ${s.label}`;
    out[`floor.${k}`] = `Не ниже: ${s.label}`;
  }
  return out;
}
