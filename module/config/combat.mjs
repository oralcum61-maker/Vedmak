// Справочники боя (корник стр. 151–165, 173–174).

/** Части тела гуманоида: d10 → часть, штраф прицельной атаки, множитель урона (стр. 154). */
export const LOCATIONS_HUMANOID = {
  head:     { label: "Голова",      roll: [1, 1],  penalty: -6, mult: 3,   crit: "head" },
  torso:    { label: "Туловище",    roll: [2, 4],  penalty: -1, mult: 1,   crit: "torso" },
  rightArm: { label: "Правая рука", roll: [5, 5],  penalty: -3, mult: 0.5, crit: "arm" },
  leftArm:  { label: "Левая рука",  roll: [6, 6],  penalty: -3, mult: 0.5, crit: "arm" },
  rightLeg: { label: "Правая нога", roll: [7, 8],  penalty: -2, mult: 0.5, crit: "leg" },
  leftLeg:  { label: "Левая нога",  roll: [9, 10], penalty: -2, mult: 0.5, crit: "leg" }
};

/** Части тела чудовища (стр. 154). Броня чудовища одна на всё тело. */
export const LOCATIONS_MONSTER = {
  head:      { label: "Голова",            roll: [1, 1],  penalty: -6, mult: 3,   crit: "head" },
  torso:     { label: "Туловище",          roll: [2, 5],  penalty: -1, mult: 1,   crit: "torso" },
  rightLimb: { label: "Правая конечность", roll: [6, 7],  penalty: -3, mult: 0.5, crit: "arm" },
  leftLimb:  { label: "Левая конечность",  roll: [8, 9],  penalty: -3, mult: 0.5, crit: "arm" },
  tail:      { label: "Хвост или крыло",   roll: [10, 10], penalty: -2, mult: 0.5, crit: "leg" }
};

export const BODY_TYPES = { humanoid: "Гуманоид", monster: "Чудовище" };

/** Какая часть брони персонажа закрывает часть тела чудовищной таблицы (для НИП с бронёй). */
export const ARMOR_SLOT_FOR = {
  head: "head", torso: "torso", rightArm: "rightArm", leftArm: "leftArm", rightLeg: "rightLeg", leftLeg: "leftLeg",
  rightLimb: "rightArm", leftLimb: "leftArm", tail: "torso"
};

/** Дистанции стрельбы (стр. 164). `upTo` — доля от дистанции оружия. */
export const RANGE_BANDS = {
  pointBlank: { label: "В упор (до 0,5 м)", dc: 10, mod: 5 },
  close:      { label: "Близкая (¼)",       dc: 15, mod: 0,  upTo: 0.25 },
  medium:     { label: "Средняя (½)",       dc: 20, mod: -2, upTo: 0.5 },
  long:       { label: "Дальняя",           dc: 25, mod: -4, upTo: 1 },
  extreme:    { label: "Экстремальная (×2)", dc: 30, mod: -6, upTo: 2 }
};

/** Модификаторы размера цели для СЛ неподвижных целей (стр. 164). */
export const SIZE_MODS = {
  small:  { label: "Небольшой (кошка, накер)", mod: 2 },
  medium: { label: "Средний (человек)",        mod: 0 },
  large:  { label: "Крупный (тролль, лошадь)", mod: -2 },
  huge:   { label: "Огромный (бес)",           mod: -4 }
};

/** Ситуационные модификаторы атаки (стр. 152). */
export const ATTACK_SITUATIONS = {
  immobilized: { label: "Цель обездвижена",                 mod: 4 },
  activeDodge: { label: "Цель активно уклоняется (ближний)", mod: -2 },
  movingFast:  { label: "Цель движется, её Реа > 10",       mod: -3 },
  quickDraw:   { label: "Быстрое выхватывание",             mod: -3 },
  ambush:      { label: "Засада",                           mod: 5 },
  ricochet:    { label: "Рикошет",                          mod: -5 },
  blinded:     { label: "Ослеплён светом или пылью",        mod: -3 },
  silhouetted: { label: "Цель на контрастном фоне",         mod: 2 },
  outOfVision: { label: "Цель вне конуса зрения",           mod: -3 },
  darkness:    { label: "Темнота",                          mod: -2 },
  sunInEyes:   { label: "Против яркого солнца",             mod: -3 },
  // Прицеливание: +1 за раунд (стр. 151) — отметить один пункт; дольше — полем модификатора
  aim1:        { label: "Прицеливание 1 раунд",              mod: 1 },
  aim2:        { label: "Прицеливание 2 раунда",             mod: 2 },
  aim3:        { label: "Прицеливание 3 раунда",             mod: 3 },
  // «Страх»: −3 к атакам против источника страха (отмечается сам, если цель — источник)
  frightened:  { label: "Страх перед целью",                 mod: -3 }
};

/** Ситуационные модификаторы защиты. */
export const DEFENSE_SITUATIONS = {
  darkness:  { label: "Темнота",                     mod: -2 },
  sunInEyes: { label: "Против яркого солнца",        mod: -3 },
  swamp:     { label: "Болото/заросли (уклон., позиция)", mod: -2 },
  water:     { label: "В воде (блок, парирование)",  mod: -2 },
  unseen:    { label: "Атакующий вне конуса зрения", mod: -3 }
};

/**
 * Виды атаки. `damage`: множитель урона оружия (0 — урона нет); `nonLethal` — несмертельный;
 * `hit` — что происходит при попадании помимо урона.
 */
export const ATTACK_TYPES = {
  fast:     { label: "Быстрая атака",   mod: 0,  damage: 1, hint: "Две атаки за раунд без штрафа (каждая — отдельный бросок)." },
  strong:   { label: "Сильная атака",   mod: -3, damage: 2, hint: "Одна атака, урон ×2." },
  single:   { label: "Обычная атака",   mod: 0,  damage: 1, hint: "Одна атака (СА чудовищ, арбалеты)." },
  charge:   { label: "Атака с разбега", mod: -3, damage: 2, hint: "Полный раунд: бег и сильная атака. Если заблокирована — встречная Сила, чтобы сбить с ног." },
  pommel:   { label: "Удар эфесом",     mod: 0,  damage: 0.5, nonLethal: true, hint: "Половина урона, несмертельный." },
  disarm:   { label: "Разоружение",     mod: 0,  damage: 0, hit: "Оружие цели отлетает на 1d6 м в случайную сторону." },
  trip:     { label: "Подсечка",        mod: 0,  damage: 0, hit: "Цель сбита с ног.", status: "prone" },
  feint:    { label: "Финт (Обман)",    mod: 0,  damage: 0, skill: "deceit", hit: "Обман против Внимания: вторая атака в этом раунде с +3." },
  dual:     { label: "Парное оружие",   mod: -3, damage: 1, hint: "Две атаки, каждая −3. Без парного оружия или щита вторую нельзя блокировать и парировать." }
};

/** Приёмы без оружия (Борьба, стр. 163). */
export const UNARMED_ATTACKS = {
  punch:     { label: "Удар рукой",       mod: 0,  damage: "punch", nonLethal: true },
  punchStrong: { label: "Удар рукой (сильный)", mod: -3, damage: "punch", mult: 2, nonLethal: true },
  kick:      { label: "Удар ногой",       mod: 0,  damage: "kick", nonLethal: true },
  kickStrong: { label: "Удар ногой (сильный)", mod: -3, damage: "kick", mult: 2, nonLethal: true },
  pushKick:  { label: "Толчок ногой",     mod: -3, damage: "kick", mult: 0.5, nonLethal: true, location: "torso",
               hit: "Цель отброшена на Тел/3 м." },
  charge:    { label: "Атака с разбега",  mod: -3, damage: "punch", mult: 2, nonLethal: true,
               hit: "Если заблокирована — встречная Сила против Силы, чтобы сбить с ног." },
  disarm:    { label: "Разоружение",      mod: 0,  damage: null, hit: "Выбить оружие на 1d6/2 м или отнять (−3)." },
  grapple:   { label: "Захват",           mod: 0,  damage: null, status: "grappled",
               hit: "Цель в захвате: не может отойти, −2 к физическим действиям. Освобождение — Уклонение против Борьбы." },
  pin:       { label: "Обездвиживание",   mod: 0,  damage: null, status: "immobilized", hit: "Только из захвата." },
  choke:     { label: "Душение",          mod: 0,  damage: null, status: "suffocating", hit: "Только из захвата: цель задыхается." },
  throw:     { label: "Бросок",           mod: 0,  damage: "punch", nonLethal: false, status: "prone",
               hit: "Только из захвата: сбит с ног, урон удара рукой, испытание Уст −1.", stunSave: -1 },
  trip:      { label: "Подсечка",         mod: 0,  damage: null, status: "prone", hit: "Цель сбита с ног." }
};

/** Защиты (стр. 164). `skill: "weapon"` — навык оружия, которым защищаются. */
export const DEFENSE_TYPES = {
  dodge:      { label: "Уклонение",          skill: "dodge" },
  reposition: { label: "Изменение позиции",  skill: "athletics", hint: "При успехе можно сместиться на ½ Скор." },
  block:      { label: "Блокирование",       skill: "weapon", hint: "Предмет теряет 1 надёжность. Дистанционные атаки — только щитом." },
  parry:      { label: "Парирование",        skill: "weapon", mod: -3, hint: "Успех: атака отменена, оружие цело, атакующий ошеломлён. Стрелы и болты — нельзя, метательное −5." },
  brawlBlock: { label: "Блок рукой (Борьба)", skill: "brawling", hint: "Урон приходится в подставленную руку, броня работает." },
  resistMagic: { label: "Сопротивление магии", skill: "resistMagic", magicOnly: true },
  // Рассеивание как защита (стр. 102): только против магии и только знающим заклинание; ничья — в пользу заклинателя
  dispel:     { label: "Рассеивание", skill: "spellCasting", magicOnly: true,
    hint: "Половина Вын заклинания противника. Успех — только если бросок больше броска заклинателя." }
};

/** Какой ключ невосприимчивости защищает от статуса. */
export const STATUS_RESIST_KEY = {
  burning: "fire", frozen: "frost", poisoned: "poison", bleeding: "bleeding", disoriented: "stun"
};

/** Уровни критических ранений: насколько атака превысила защиту (стр. 158). */
export const CRIT_LEVELS = {
  simple:    { label: "Лёгкое",      margin: 7,  bonus: 3,  spiritBonus: 5,  stabilizeDC: 12, treatRounds: 2, treatDC: 12, magicCount: 4,  magicDC: 14 },
  complex:   { label: "Среднее",     margin: 10, bonus: 5,  spiritBonus: 10, stabilizeDC: 14, treatRounds: 4, treatDC: 14, magicCount: 6,  magicDC: 16 },
  difficult: { label: "Тяжёлое",     margin: 13, bonus: 8,  spiritBonus: 15, stabilizeDC: 16, treatRounds: 6, treatDC: 16, magicCount: 8,  magicDC: 18 },
  deadly:    { label: "Смертельное", margin: 15, bonus: 10, spiritBonus: 20, stabilizeDC: 18, treatRounds: 8, treatDC: 18, magicCount: 10, magicDC: 20 }
};

export const CRIT_STATES = { fresh: "Свежее", stabilized: "Стабилизировано", treated: "Вылечено" };

/** Уровень крита по превышению защиты. */
export function critLevelFor(margin) {
  let level = null;
  for (const [key, cfg] of Object.entries(CRIT_LEVELS)) if (margin >= cfg.margin) level = key;
  return level;
}

/**
 * Критические ранения (стр. 158–160). `roll` — диапазон 2d6; `zone` — где рана при прицельной атаке.
 * `states.*.mods`:
 *   stats / skills — прибавки к параметрам и навыкам;
 *   mult — множители итогов: "stats.spd", "skills.dodge", "sta", "rec";
 *   derived — прибавки к производным (stun, enc, rec);
 *   action — ко всем действиям; magic — к Сотворению, Ритуалам, Порче; duel / empathicDuel — в словесной дуэли;
 *   headMult — множитель урона по голове; bleeding / poisoned / suffocating — наложить статус; acid — урон за раунд;
 *   stunEvery — испытание Уст каждые N раундов ("1d6" — случайно).
 */
export const CRIT_WOUNDS = {
  // ---------------- Лёгкие ----------------
  crackedJaw: {
    level: "simple", roll: [12, 12], zone: "head", label: "Треснувшая челюсть",
    img: "icons/skills/wounds/injury-face-impact-orange.webp",
    states: {
      fresh:      { text: "−2 к магическим навыкам и в словесной дуэли.", mods: { magic: -2, duel: -2 } },
      stabilized: { text: "−1 к магическим навыкам и в словесной дуэли.", mods: { magic: -1, duel: -1 } },
      treated:    { text: "−1 к магическим навыкам.", mods: { magic: -1 } }
    }
  },
  disfiguringScar: {
    level: "simple", roll: [11, 11], zone: "head", label: "Уродующий шрам",
    img: "icons/skills/wounds/injury-stitched-flesh-red.webp",
    states: {
      fresh:      { text: "−3 к эмпатической словесной дуэли.", mods: { empathicDuel: -3 } },
      stabilized: { text: "−1 к эмпатической словесной дуэли.", mods: { empathicDuel: -1 } },
      treated:    { text: "−1 к Соблазнению.", mods: { skills: { seduction: -1 } } }
    }
  },
  crackedRibs: {
    level: "simple", roll: [9, 10], zone: "torso", label: "Треснувшие рёбра",
    img: "icons/skills/wounds/anatomy-bone-joint.webp",
    states: {
      fresh:      { text: "−2 к Тел (не влияет на ПЗ).", mods: { stats: { body: -2 } } },
      stabilized: { text: "−1 к Тел.", mods: { stats: { body: -1 } } },
      treated:    { text: "−10 к Переносимому весу.", mods: { derived: { enc: -10 } } }
    }
  },
  foreignObject: {
    level: "simple", roll: [6, 8], zone: "torso", label: "Инородный объект",
    img: "icons/skills/wounds/injury-pain-impaled-hand-blood.webp", organ: true,
    states: {
      fresh:      { text: "Отдых и исцеление критических ранений снижены вчетверо.", mods: { mult: { rec: 0.25 } } },
      stabilized: { text: "Отдых и исцеление критических ранений снижены вдвое.", mods: { mult: { rec: 0.5 } } },
      treated:    { text: "−2 к Отдыху и −1 к исцелению критических ранений.", mods: { derived: { rec: -2 } } }
    }
  },
  sprainedArm: {
    level: "simple", roll: [4, 5], zone: "arm", label: "Вывих руки",
    img: "icons/skills/wounds/injury-hand-blood-red.webp",
    states: {
      fresh:      { text: "−2 к действиям этой рукой.", mods: { arm: -2 } },
      stabilized: { text: "−1 к действиям этой рукой.", mods: { arm: -1 } },
      treated:    { text: "−1 к Силе.", mods: { skills: { physique: -1 } } }
    }
  },
  sprainedLeg: {
    level: "simple", roll: [2, 3], zone: "leg", label: "Вывих ноги",
    img: "icons/skills/wounds/bone-broken-knee-beam.webp",
    states: {
      fresh:      { text: "−2 к Скор, Уклонению/Изворотливости и Атлетике.", mods: { stats: { spd: -2 }, skills: { dodge: -2, athletics: -2 } } },
      stabilized: { text: "−1 к Скор, Уклонению/Изворотливости и Атлетике.", mods: { stats: { spd: -1 }, skills: { dodge: -1, athletics: -1 } } },
      treated:    { text: "−1 к Скор.", mods: { stats: { spd: -1 } } }
    }
  },
  // ---------------- Средние ----------------
  minorHeadWound: {
    level: "complex", roll: [12, 12], zone: "head", label: "Небольшая травма головы",
    img: "icons/skills/wounds/injury-body-pain-gray.webp",
    states: {
      fresh:      { text: "−1 к Инт, Воле и Уст.", mods: { stats: { int: -1, will: -1 }, derived: { stun: -1 } } },
      stabilized: { text: "−1 к Инт и Воле.", mods: { stats: { int: -1, will: -1 } } },
      treated:    { text: "−1 к Воле.", mods: { stats: { will: -1 } } }
    }
  },
  lostTeeth: {
    level: "complex", roll: [11, 11], zone: "head", label: "Выбитые зубы",
    img: "icons/commodities/bones/tooth-molar-white-red.webp",
    states: {
      fresh:      { text: "Выбито 1d10 зубов. −3 к магическим навыкам и в словесной дуэли.", mods: { magic: -3, duel: -3 } },
      stabilized: { text: "−2 к магическим навыкам и в словесной дуэли.", mods: { magic: -2, duel: -2 } },
      treated:    { text: "−1 к магическим навыкам и в словесной дуэли.", mods: { magic: -1, duel: -1 } }
    }
  },
  rupturedSpleen: {
    level: "complex", roll: [9, 10], zone: "torso", label: "Разрыв селезёнки",
    img: "icons/skills/wounds/blood-cells-vessel-red.webp", organ: true,
    states: {
      fresh:      { text: "Испытание Уст каждые 5 раундов. Кровотечение.", mods: { stunEvery: 5, bleeding: true } },
      stabilized: { text: "Испытание Уст каждые 10 раундов.", mods: { stunEvery: 10 } },
      treated:    { text: "−2 к Уст.", mods: { derived: { stun: -2 } } }
    }
  },
  brokenRibs: {
    level: "complex", roll: [6, 8], zone: "torso", label: "Сломанные рёбра",
    img: "icons/skills/wounds/bone-broken-marrow-yellow.webp",
    states: {
      fresh:      { text: "−2 к Тел, −1 к Реа и Лвк.", mods: { stats: { body: -2, ref: -1, dex: -1 } } },
      stabilized: { text: "−1 к Тел и Реа.", mods: { stats: { body: -1, ref: -1 } } },
      treated:    { text: "−1 к Тел.", mods: { stats: { body: -1 } } }
    }
  },
  fracturedArm: {
    level: "complex", roll: [4, 5], zone: "arm", label: "Перелом руки",
    img: "icons/skills/wounds/bone-broken-marrow-red.webp",
    states: {
      fresh:      { text: "−3 ко всем действиям этой рукой.", mods: { arm: -3 } },
      stabilized: { text: "−2 ко всем действиям этой рукой.", mods: { arm: -2 } },
      treated:    { text: "−1 ко всем действиям этой рукой.", mods: { arm: -1 } }
    }
  },
  fracturedLeg: {
    level: "complex", roll: [2, 3], zone: "leg", label: "Перелом ноги",
    img: "icons/skills/wounds/blood-cells-vessel-red-orange.webp",
    states: {
      fresh:      { text: "−3 к Скор, Уклонению/Изворотливости и Атлетике.", mods: { stats: { spd: -3 }, skills: { dodge: -3, athletics: -3 } } },
      stabilized: { text: "−2 к Скор, Уклонению/Изворотливости и Атлетике.", mods: { stats: { spd: -2 }, skills: { dodge: -2, athletics: -2 } } },
      treated:    { text: "−1 к Скор, Уклонению/Изворотливости и Атлетике.", mods: { stats: { spd: -1 }, skills: { dodge: -1, athletics: -1 } } }
    }
  },
  // ---------------- Тяжёлые ----------------
  crackedSkull: {
    level: "difficult", roll: [12, 12], zone: "head", label: "Проломленный череп",
    img: "icons/skills/wounds/injury-pain-body-orange.webp",
    states: {
      fresh:      { text: "−1 к Инт и Лвк, урон по голове ×4. Кровотечение.", mods: { stats: { int: -1, dex: -1 }, headMult: 4, bleeding: true } },
      stabilized: { text: "−1 к Инт и Лвк, урон по голове ×4.", mods: { stats: { int: -1, dex: -1 }, headMult: 4 } },
      treated:    { text: "Урон по голове ×4.", mods: { headMult: 4 } }
    }
  },
  concussion: {
    level: "difficult", roll: [11, 11], zone: "head", label: "Контузия",
    img: "icons/skills/wounds/anatomy-organ-brain-pink-red.webp",
    states: {
      fresh:      { text: "Испытание Уст каждые 1d6 раундов. −2 к Инт, Реа и Лвк.", mods: { stats: { int: -2, ref: -2, dex: -2 }, stunEvery: "1d6" } },
      stabilized: { text: "−1 к Инт, Реа и Лвк.", mods: { stats: { int: -1, ref: -1, dex: -1 } } },
      treated:    { text: "−1 к Инт и Лвк.", mods: { stats: { int: -1, dex: -1 } } }
    }
  },
  gutWound: {
    level: "difficult", roll: [9, 10], zone: "torso", label: "Рана в живот",
    img: "icons/skills/wounds/injury-triple-slash-bleed.webp", organ: true,
    states: {
      fresh:      { text: "−2 ко всем действиям, 4 урона кислотой за раунд.", mods: { action: -2, acid: 4 } },
      stabilized: { text: "−2 ко всем действиям.", mods: { action: -2 } },
      treated:    { text: "−1 ко всем действиям.", mods: { action: -1 } }
    }
  },
  suckingChestWound: {
    level: "difficult", roll: [6, 8], zone: "torso", label: "Сосущая рана грудной клетки",
    img: "icons/skills/wounds/blood-spurt-spray-red.webp", organ: true,
    states: {
      fresh:      { text: "−3 к Тел и Скор. Удушье.", mods: { stats: { body: -3, spd: -3 }, suffocating: true } },
      stabilized: { text: "−2 к Тел и Скор.", mods: { stats: { body: -2, spd: -2 } } },
      treated:    { text: "−1 к Тел и Скор.", mods: { stats: { body: -1, spd: -1 } } }
    }
  },
  compoundArmFracture: {
    level: "difficult", roll: [4, 5], zone: "arm", label: "Открытый перелом руки",
    img: "icons/skills/wounds/injury-stapled-flesh-tan.webp",
    states: {
      fresh:      { text: "Рукой невозможно двигать. Кровотечение.", mods: { armDisabled: true, bleeding: true } },
      stabilized: { text: "Рукой невозможно двигать.", mods: { armDisabled: true } },
      treated:    { text: "Рука на перевязи, но ею можно держать предметы.", mods: {} }
    }
  },
  compoundLegFracture: {
    level: "difficult", roll: [2, 3], zone: "leg", label: "Открытый перелом ноги",
    img: "icons/skills/wounds/blood-drip-droplet-red.webp",
    states: {
      fresh:      { text: "Скор, Уклонение/Изворотливость и Атлетика ×¼. Кровотечение.", mods: { mult: { "stats.spd": 0.25, "skills.dodge": 0.25, "skills.athletics": 0.25 }, bleeding: true } },
      stabilized: { text: "Скор, Уклонение/Изворотливость и Атлетика ×½.", mods: { mult: { "stats.spd": 0.5, "skills.dodge": 0.5, "skills.athletics": 0.5 } } },
      treated:    { text: "−2 к Скор, Уклонению/Изворотливости и Атлетике.", mods: { stats: { spd: -2 }, skills: { dodge: -2, athletics: -2 } } }
    }
  },
  // ---------------- Смертельные ----------------
  decapitation: {
    level: "deadly", roll: [12, 12], zone: "head", label: "Сломанная шея / отсечение головы",
    img: "icons/commodities/bones/skull-hollow-worn-white.webp",
    states: {
      fresh:      { text: "Персонаж немедленно умирает.", mods: { death: true } },
      stabilized: { text: "Это ранение нельзя стабилизировать.", mods: { death: true } },
      treated:    { text: "Это ранение нельзя вылечить.", mods: { death: true } }
    }
  },
  damagedEye: {
    level: "deadly", roll: [11, 11], zone: "head", label: "Повреждение глаза",
    img: "icons/commodities/biological/eye-red-pink.webp",
    states: {
      fresh:      { text: "−5 к Вниманию (зрение), −4 к Лвк. Кровотечение.", mods: { stats: { dex: -4 }, sight: -5, bleeding: true } },
      stabilized: { text: "−3 к Вниманию (зрение), −2 к Лвк.", mods: { stats: { dex: -2 }, sight: -3 } },
      treated:    { text: "Навсегда −1 к Вниманию (зрение) и Лвк.", mods: { stats: { dex: -1 }, sight: -1 } }
    }
  },
  heartDamage: {
    level: "deadly", roll: [9, 10], zone: "torso", label: "Травма сердца",
    img: "icons/skills/wounds/anatomy-organ-heart-red.webp",
    states: {
      fresh:      { text: "Немедленно испытание против смерти. Кровотечение. Вын, Скор и Тел ×¼.", mods: { mult: { sta: 0.25, "stats.spd": 0.25, "stats.body": 0.25 }, bleeding: true, deathSave: true } },
      stabilized: { text: "Вын, Скор и Тел ×½.", mods: { mult: { sta: 0.5, "stats.spd": 0.5, "stats.body": 0.5 } } },
      treated:    { text: "Навсегда +2 урона за раунд от кровотечения.", mods: { bleedExtra: 2 } }
    }
  },
  septicShock: {
    level: "deadly", roll: [6, 8], zone: "torso", label: "Септический шок",
    img: "icons/skills/wounds/illness-disease-glowing-green.webp", organ: true,
    states: {
      fresh:      { text: "Вын ×¼, −3 к Инт, Воле, Реа и Лвк. Отравление.", mods: { mult: { sta: 0.25 }, stats: { int: -3, will: -3, ref: -3, dex: -3 }, poisoned: true } },
      stabilized: { text: "Вын ×½, −1 к Инт, Воле, Реа и Лвк.", mods: { mult: { sta: 0.5 }, stats: { int: -1, will: -1, ref: -1, dex: -1 } } },
      treated:    { text: "Навсегда −5 к Вын.", mods: { derived: { sta: -5 } } }
    }
  },
  dismemberedArm: {
    level: "deadly", roll: [4, 5], zone: "arm", label: "Потеря руки",
    img: "icons/commodities/biological/hand-green-red.webp",
    states: {
      fresh:      { text: "Рукой нельзя пользоваться. Кровотечение.", mods: { armDisabled: true, bleeding: true } },
      stabilized: { text: "Рукой нельзя пользоваться.", mods: { armDisabled: true } },
      treated:    { text: "Руку можно заменить протезом.", mods: { armDisabled: true } }
    }
  },
  dismemberedLeg: {
    level: "deadly", roll: [2, 3], zone: "leg", label: "Потеря ноги",
    img: "icons/commodities/biological/foot-black-grey.webp",
    states: {
      fresh:      { text: "Скор, Уклонение/Изворотливость и Атлетика ×¼. Кровотечение.", mods: { mult: { "stats.spd": 0.25, "skills.dodge": 0.25, "skills.athletics": 0.25 }, bleeding: true } },
      stabilized: { text: "Скор, Уклонение/Изворотливость и Атлетика ×¼.", mods: { mult: { "stats.spd": 0.25, "skills.dodge": 0.25, "skills.athletics": 0.25 } } },
      treated:    { text: "Ногу можно заменить протезом.", mods: { mult: { "stats.spd": 0.25, "skills.dodge": 0.25, "skills.athletics": 0.25 } } }
    }
  }
};

/** Навыки, которые считаются «магическими» для штрафов ранений. */
export const MAGIC_SKILLS = ["spellCasting", "ritualCrafting", "hexWeaving"];

/** Найти рану по уровню и результату 2d6 (результат зажимается в 2–12). */
export function critWoundFor(level, roll) {
  const r = Math.max(2, Math.min(12, roll));
  return Object.entries(CRIT_WOUNDS).find(([, w]) => w.level === level && r >= w.roll[0] && r <= w.roll[1])?.[0] ?? null;
}

/** Рана при прицельной атаке: зона части тела и 1d6 (1–4 — меньший эффект, 5–6 — больший; стр. 158). */
export function aimedCritWound(level, zone, d6) {
  const byZone = Object.entries(CRIT_WOUNDS).filter(([, w]) => w.level === level && w.zone === zone);
  if (byZone.length <= 1) return byZone[0]?.[0] ?? null;
  byZone.sort((a, b) => a[1].roll[0] - b[1].roll[0]);
  return (d6 >= 5 ? byZone.at(-1) : byZone[0])[0];
}

/** Дни до снятия штрафов после лечения по Тел (стр. 174). */
export const HEALING_DAYS = {
  3: [5, 9, 12], 4: [4, 8, 11], 5: [3, 7, 10], 6: [2, 6, 9], 7: [1, 5, 8], 8: [1, 4, 7],
  9: [1, 3, 6], 10: [1, 2, 5], 11: [1, 1, 4], 12: [1, 1, 3], 13: [1, 1, 2]
};

/** Последствия критического провала (стр. 157): [от, до, текст]. */
export const FUMBLES = {
  melee: { label: "Атака ближнего боя", rows: [
    [1, 5, "Нет особых последствий."],
    [6, 6, "Оружие проходит вскользь — персонаж ошеломлён."],
    [7, 7, "Оружие застревает в ближайшем объекте: 1 раунд, чтобы достать."],
    [8, 8, "Оружие сильно повреждено: −1d10 надёжности."],
    [9, 9, "Персонаж ранил сам себя (бросок места попадания)."],
    [10, 999, "Персонаж ранил ближайшего союзника (бросок места попадания)."]
  ] },
  weaponDefense: { label: "Защита оружием", rows: [
    [1, 5, "Нет особых последствий."],
    [6, 6, "Оружие получает дополнительно 1d6 урона надёжности."],
    [7, 7, "Оружие выбито из рук и отлетает на 1d6 м."],
    [8, 8, "Персонаж сбит с ног и проходит испытание Уст."],
    [9, 9, "Оружие получает дополнительно 2d6 урона надёжности."],
    [10, 999, "Оружие рикошетит и попадает по персонажу (бросок места попадания)."]
  ] },
  ranged: { label: "Дистанционная атака", rows: [
    [1, 5, "Нет особых последствий."],
    [6, 7, "Снаряд или брошенное оружие врезается во что-то и ломается."],
    [8, 9, "Слетает тетива, заклинивает арбалет или оружие выронено: 1 раунд на исправление."],
    [10, 999, "Снаряд рикошетит в случайного союзника в пределах дистанции."]
  ] },
  unarmed: { label: "Атака или защита без оружия", rows: [
    [1, 5, "Нет особых последствий."],
    [6, 6, "Персонаж теряет равновесие — ошеломлён."],
    [7, 7, "Персонаж спотыкается и падает (сбит с ног)."],
    [8, 8, "Сбит с ног и проходит испытание Уст."],
    [9, 9, "Сбит с ног, 1d6 несмертельного урона по голове, испытание Уст."],
    [10, 999, "Сбит с ног, 1d6 смертельного урона по голове, испытание Уст."]
  ] }
};

export function fumbleText(kind, value) {
  return FUMBLES[kind]?.rows.find(([a, b]) => value >= a && value <= b)?.[2] ?? "";
}

/** Бонус многослойной брони по разности ПБ (стр. 155). */
export function layerBonus(diff) {
  if (diff <= 4) return 5;
  if (diff <= 8) return 4;
  if (diff <= 14) return 3;
  if (diff <= 20) return 2;
  return 0;
}

/** Укрытия и их ПБ (стр. 155). */
export const COVER = {
  none:       { label: "Нет", sp: 0 },
  stoneWall:  { label: "Каменная стена", sp: 30 },
  thickTree:  { label: "Толстое дерево", sp: 30 },
  brickWall:  { label: "Кирпичная стена", sp: 25 },
  woodWall:   { label: "Деревянная стена", sp: 10 },
  heavyDoor:  { label: "Тяжёлая деревянная дверь", sp: 15 },
  steelDoor:  { label: "Стальная дверь", sp: 20 },
  wagon:      { label: "Повозка", sp: 10 },
  tent:       { label: "Палатка", sp: 5 },
  thatch:     { label: "Соломенная крыша", sp: 7 },
  barrel:     { label: "Деревянная бочка", sp: 10 },
  bush:       { label: "Кустарник", sp: 7 }
};

/** Ключи сопротивлений, восприимчивостей и невосприимчивостей. */
export const RESIST_KEYS = {
  slashing: "Режущий", piercing: "Колющий", bludgeoning: "Дробящий", elemental: "Стихийный",
  fire: "Огонь (горение)", frost: "Холод (заморозка)", poison: "Отравление", bleeding: "Кровотечение",
  stun: "Дезориентация", silver: "Серебро", meteorite: "Метеоритная сталь"
};

/** Статусы, реагирующие на урон по типу эффекта оружия. */
export const EFFECT_STATUS = {
  bleeding: "bleeding", poison: "poisoned", burning: "burning", freeze: "frozen", staggering: "staggered"
};

/** Классы, против которых работает серебро / метеоритная сталь при правиле «Чудовища из книг» (стр. 162). */
export const BOOK_SILVER_CLASSES = ["cursed", "elementa", "necrophage", "relict", "specter", "vampire"];
export const BOOK_METEORITE_CLASSES = ["beast", "hybrid", "draconid", "insectoid", "ogroid"];

/* ------------------------- Верховая езда и транспорт (стр. 169–171) ------------------------- */

/** Скакуны и транспорт: модификатор управления, таранящий урон, навык управления. */
export const MOUNTS = {
  horse:    { label: "Лошадь",           mod: 2,  ram: "3d6", skill: "riding" },
  warhorse: { label: "Боевой конь",      mod: -2, ram: "4d6", skill: "riding" },
  mule:     { label: "Мул",              mod: 0,  ram: "2d6", skill: "riding" },
  ox:       { label: "Вол",              mod: -2, ram: "4d6", skill: "riding" },
  cart:     { label: "Повозка",          mod: 0,  ram: "3d6", skill: "riding", drawn: true, vehicle: true },
  carriage: { label: "Карета",           mod: -1, ram: "4d6", skill: "riding", drawn: true, vehicle: true },
  sailboat: { label: "Парусная лодка",   mod: -1, ram: "2d6", skill: "sailing", vehicle: true, water: true },
  ship:     { label: "Парусный корабль", mod: -1, ram: "4d6", skill: "sailing", vehicle: true, water: true },
  cutter:   { label: "Куттер",           mod: 0,  ram: "5d6", skill: "sailing", vehicle: true, water: true }
};

export const MANEUVERS = {
  simple:        { label: "Простой (15): поворот, прыжок через низкое препятствие", dc: 15 },
  difficult:     { label: "Сложный (20): выход из заноса, резкая остановка", dc: 20 },
  veryDifficult: { label: "Очень сложный (25): прыжок транспорта, высокое препятствие", dc: 25 },
  attack:        { label: "Атака верхом (простой, 15)", dc: 15 }
};

/** Модификаторы веса цели для урона разбега и тарана (стр. 171). */
export const WEIGHT_MODS = {
  veryLight: { label: "Очень лёгкая (ящик, накер, кошка) ×½", mult: 0.5 },
  light:     { label: "Лёгкая (размером с человека) ×1", mult: 1 },
  medium:    { label: "Средняя (волколак, повозка, эндриага) ×2", mult: 2 },
  heavy:     { label: "Тяжёлая (главоглаз, тролль, ворота) ×3", mult: 3 }
};

/** Потеря управления транспортом (d6). */
export const LOSS_VEHICLE = [
  [1, 2, "Занос или разворот. Других эффектов нет."],
  [3, 4, "Сильный занос: транспорт скользит 1d10×2 м боком. При столкновении — урон как при атаке с разбега."],
  [5, 6, "Транспорт перевернулся: скользит 1d10×3 м и переворачивается. Наземный — персонаж, транспорт и животные получают 5d6 урона; водный — персонаж под водой до Атлетики СЛ 12."]
];

/** Потеря управления скакуном (d10): [от, до, наездник, скакун]. */
export const LOSS_MOUNT = [
  [1, 3, "Выронил поводья: −1 к управлению, пока не потратит ход, чтобы поймать их.",
    "Отказ: скакун не выполняет команду; новая проверка управления в следующем раунде."],
  [4, 4, "Брыкание: Атлетика СЛ 15, чтобы удержаться в седле.",
    "Напуган, встал на дыбы: Атлетика СЛ 16, чтобы удержаться, и Выживание СЛ 18, чтобы успокоить."],
  [5, 5, "Брыкание: Атлетика СЛ 18, иначе падение (сбит с ног).",
    "Споткнулся: Атлетика скакуна СЛ 14, чтобы не упасть."],
  [6, 6, "Брыкание: Атлетика СЛ 20, иначе падение (сбит с ног).",
    "Споткнулся: Атлетика скакуна СЛ 18, чтобы не упасть."],
  [7, 7, "Брыкание: Атлетика СЛ 25, иначе падение (сбит с ног).",
    "Споткнулся: Атлетика СЛ 15; при провале 1d10 урона по случайной ноге скакуна."],
  [8, 8, "Вылетел из седла на 1d6/2 м: 1d6 урона по случайной части тела (или столько d6, сколько метров, при столкновении).",
    "Споткнулся: Атлетика СЛ 20; при провале 2d10 урона по случайной ноге скакуна."],
  [9, 9, "Вылетел из седла на 1d6 м: 1d6 урона по случайной части тела (или столько d6, сколько метров, при столкновении).",
    "Падение: Атлетика персонажа СЛ 18, иначе придавлен — 2d10 по случайной части тела, скакуну столько же в туловище."],
  [10, 999, "Вылетел из седла на 1d10 м: 1d6 урона по случайной части тела (или столько d6, сколько метров, при столкновении).",
    "Потеря сознания: Атлетика СЛ 18, иначе придавлен (2d10); скакун каждый раунд проходит испытание Уст."]
];

/**
 * Кованый значок части тела для окон атаки и урона (parts/armor-part.hbs без числа): голова, туловище, рука,
 * нога; левая — зеркально, «наугад» — костью d10. `loc` — запись LOCATIONS_*, пусто — бросок.
 */
export function locationGlyph(key, loc) {
  return { kind: loc ? loc.crit : "die", flip: /^left/.test(key ?? ""), state: "worn", bare: true, tip: "" };
}
