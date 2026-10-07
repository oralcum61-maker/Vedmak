// Справочники магии (корник стр. 99–123, 166–168).

export const MAGIC_BRANCHES = {
  druid: "Друид", preacher: "Проповедник", archPriest: "Верховный жрец",
  // «Том Хаоса», стр. 126–149: запретные школы, которым учатся вне академий
  necromancy: "Некромантия", goetia: "Гоэтия",
  // Роли высшего вампира — ветки вампирской магии
  monarch: "Монарх", bloodMage: "Заклинатель крови", shadowLord: "Повелитель Теней"
};

export const HEX_DANGER = { novice: "Низкая", journeyman: "Средняя", master: "Высокая" };

/** Подписи уровня в зависимости от вида магии. */
export function levelLabel(kind, level) {
  if (kind === "sign") return level === "novice" ? "Базовый" : "Продвинутый";
  if (kind === "gift") return level === "novice" ? "Малый дар" : "Большой дар";
  if (kind === "hex") return `Опасность: ${(HEX_DANGER[level] ?? "").toLowerCase()}`;
  return { novice: "Новичок", journeyman: "Подмастерье", master: "Мастер", archPriest: "Верховный жрец" }[level] ?? level;
}

/** Защиты от магии. `defenses` — какие кнопки защиты показать в карточке. */
export const SPELL_DEFENSES = {
  none:        { label: "Нет", defenses: ["auto"] },
  dodge:       { label: "Уклонение", defenses: ["dodge", "reposition", "none"] },
  dodgeBlock:  { label: "Уклонение или блокирование", defenses: ["dodge", "reposition", "block", "none"] },
  resistMagic: { label: "Сопротивление магии", defenses: ["resistMagic", "none"] },
  resistReposition: { label: "Сопротивление магии или смена позиции", defenses: ["resistMagic", "reposition", "none"] },
  willx3:      { label: "Воля существа ×3", defenses: ["willx3"] },
  casting:     { label: "Сотворение заклинаний", defenses: ["auto"] },
  other:       { label: "Особая (ведущий)", defenses: ["auto", "none"] }
};

/** Навык проверки по виду магии. */
export const MAGIC_SKILL = {
  spell: "spellCasting", invocation: "spellCasting", sign: "spellCasting", gift: "spellCasting",
  ritual: "ritualCrafting", hex: "hexWeaving"
};

/** Последствия магического провала по величине провала (стр. 166). */
export function magicFumble(value) {
  if (value <= 6) return { works: true, elemental: false, focusExplodes: false,
    text: "Магия трещит вокруг заклинателя: урон, равный величине провала, но заклинание срабатывает." };
  if (value <= 9) return { works: false, elemental: true, focusExplodes: false,
    text: "Магия загорается внутри заклинателя: заклинание не срабатывает, стихийный эффект провала." };
  return { works: false, elemental: true, focusExplodes: true,
    text: "Магия взрывается: стихийный эффект провала, фокусирующий предмет взрывается (1d10 урона в радиусе 2 м)." };
}

/** Стихийный эффект провала и перегрузки (стр. 166–167). Урон — величина провала. */
export const ELEMENTAL_FUMBLE = {
  earth: { label: "Земля", status: "disoriented", text: "Земля ходит ходуном: дезориентация." },
  air:   { label: "Воздух", status: null, text: "Воздух завихряется: заклинателя отбрасывает на 2 м." },
  fire:  { label: "Огонь", status: "burning", text: "Тело охватывает пламя: горение." },
  water: { label: "Вода", status: "frozen", text: "Тело покрывается льдом: заморожен." },
  mixed: { label: "Смешанные", status: null, text: "Магия трещит и полыхает; ведущий выбирает один из стихийных эффектов." }
};

/** Изучение магии (стр. 123). */
export const MAGIC_LEARNING = {
  novice:     { ip: 10, time: "4 дня",    dc: 14, checks: 2 },
  journeyman: { ip: 20, time: "1 неделя", dc: 18, checks: 4 },
  master:     { ip: 30, time: "3 недели", dc: 22, checks: 6 },
  archPriest: { ip: 40, time: "5 недель", dc: 24, checks: 8 }
};

/** Прерывание ритуала (стр. 168). */
export const RITUAL_INTERRUPTIONS = {
  shaken:   { label: "Толкнули, накричали, бросили что-то", dc: 15 },
  wounded:  { label: "Напали и ранили", dc: 18 },
  removed:  { label: "Вытолкнули из круга, вернулся за 1 раунд", dc: 16 }
};

/**
 * Эффекты двимерита (стр. 167): касание — Энергия 0 и проверка Стойкости СЛ 16, итог броска выбирает строку
 * (от лучшего к худшему, `min` — «результат не меньше»). Механика строки: `spasms` — каждые 1d6 ходов Стойкость
 * СЛ 15, иначе ошеломление; `status` — состояние на время контакта; `stunEachRound` — испытание Уст каждый раунд;
 * `damage` — урон каждый раунд. Проверка повторяется каждые полчаса, пока контакт не прерван.
 */
export const DIMERITIUM_DC = 16;
export const DIMERITIUM_TOUCH = [
  { min: 18, text: "Кожа чешется — дискомфорт, не более." },
  { min: 16, text: "Кожа чешется, слегка подташнивает, но в целом всё в порядке." },
  { min: 14, text: "Кожа чешется, подташнивает, скручивают спазмы: каждые 1d6 ходов Стойкость СЛ 15, иначе ошеломление.", spasms: 15 },
  { min: 12, text: "Кожа горит, желудок крутит: тошнота.", status: "nauseated" },
  { min: 10, text: "Словно в огне, едва может сосредоточиться: испытание Устойчивости каждый раунд.", stunEachRound: true },
  { min: -Infinity, text: "Двимерит возжигает магию в теле: 1d6 урона каждый раунд, пока длится касание.", damage: "1d6" }
];

/**
 * Ауры зон: пока токен в зоне (кроме заклинателя), на нём эффект с поправками параметров. Значение — потраченная Вын.
 * Ключ — название заклинания. `valueFrom: "vigor"` — штраф равен Энергии заклинателя, а не потраченной Вын.
 */
const YRDEN_AURA = { label: "Круг Ирдена", stats: ["spd", "ref"], reveals: true,
  text: "В круге Ирдена: штраф к Скор и Реа, пока не выйдет из круга. Бесплотное существо в круге становится материальным." };
export const ZONE_AURAS = {
  "Ирден": YRDEN_AURA,
  // Вживлённый глиф: круг 50 см (на сцене — одна клетка), штраф — уровень Энергии носителя
  "Вживлённый глиф: Ирден": { ...YRDEN_AURA, valueFrom: "vigor",
    text: "В круге вживлённого глифа Ирдена: штраф к Скор и Реа, пока не выйдет из круга. Бесплотное существо в круге становится материальным." },
  // Облако бомбы «Лунная пыль»: проявляет невидимое — «Покров» внутри слабее
  "Лунная пыль": { label: "Лунная пыль", stats: [], reveals: true,
    text: "В облаке лунной пыли: невидимое и неосязаемое проявляется, «Покров» даёт лишь +3 к атаке и защите и +5 к Скрытности." }
};
/** Аура зоны по названию заклинания или склянки (кавычки «» в названии не важны). */
export const zoneAuraFor = name => ZONE_AURAS[String(name ?? "").replace(/[«»]/g, "").trim()] ?? null;

/** Разбор вида цели по дистанции (стр. 168). */
export function targetingFor(range) {
  const r = String(range ?? "").toLowerCase();
  if (r.startsWith("на себя") && !/\d/.test(r)) return "self";
  if (/зона|конус|радиус|диаметр/.test(r)) return "area";
  return "direct";
}

/** Знаки стихий на листе — алхимические треугольники: путь в поле 20 × 20 и цвет обводки. */
export const ELEMENT_GLYPHS = {
  air:   { color: "#d6e0e8", path: "M10 3L17.5 16.5H2.5ZM4.8 11.5H15.2" },
  fire:  { color: "#e0604a", path: "M10 3L17.5 16.5H2.5Z" },
  water: { color: "#6a9fd4", path: "M10 17L2.5 3.5H17.5Z" },
  earth: { color: "#c09a58", path: "M10 17L2.5 3.5H17.5ZM4.8 8.5H15.2" },
  mixed: { color: "#cfc8b8", path: "M10 2.5A7.5 7.5 0 1 1 9.99 2.5ZM10 2.5V17.5M2.5 10H17.5" }
};

/**
 * Пять ведьмачьих знаков и их вторые формы (продвинутые, подмастерье; стр. 116–117) — по названию в компендиуме.
 * Значок второй формы нужен и тогда, когда она не выучена: на листе она видна погашенной.
 */
export const SIGN_FORMS = [
  { base: "Аард",  alt: "Сметающий Аард",     altImg: "systems/vedmak/assets/fan/magic/sg-sweep.webp" },
  { base: "Игни",  alt: "Огненный поток",     altImg: "systems/vedmak/assets/fan/magic/sg-firestream.webp" },
  { base: "Ирден", alt: "Магическая ловушка", altImg: "systems/vedmak/assets/fan/magic/sg-trap.webp" },
  { base: "Квен",  alt: "Активный щит",       altImg: "systems/vedmak/assets/fan/magic/sg-shield.webp" },
  { base: "Аксий", alt: "Марионетка",         altImg: "systems/vedmak/assets/fan/magic/sg-puppet.webp" }
];
