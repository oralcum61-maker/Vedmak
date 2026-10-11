// Справочники предметов (корник стр. 71–98).

export const DAMAGE_TYPES = {
  slashing:    { label: "Режущий",   abbr: "Р" },
  piercing:    { label: "Колющий",   abbr: "К" },
  bludgeoning: { label: "Дробящий",  abbr: "Д" },
  elemental:   { label: "Стихийный", abbr: "С" }
};

export const AVAILABILITY = {
  everywhere: { label: "Повсеместное", abbr: "П" },
  common:     { label: "Обычное",      abbr: "О" },
  rare:       { label: "Редкое",       abbr: "Р" },
  unique:     { label: "Уникальное",   abbr: "У" }
};

export const CONCEALMENT = {
  tiny:   { label: "Маленькое (в карман)", abbr: "М" },
  small:  { label: "Небольшое (под куртку)", abbr: "Н" },
  large:  { label: "Крупное (под плащ)", abbr: "К" },
  none:   { label: "Не спрятать", abbr: "Н/С" }
};

/** Навыки, которыми атакуют (стр. 72–74). */
export const WEAPON_SKILLS = {
  swordsmanship: "Владение мечом",
  smallBlades:   "Владение лёгкими клинками",
  melee:         "Ближний бой",
  staffSpear:    "Владение древковым оружием",
  brawling:      "Борьба",
  athletics:     "Атлетика (метательное)",
  archery:       "Стрельба из лука",
  crossbow:      "Стрельба из арбалета"
};

export const WEAPON_CATEGORIES = {
  sword: "Мечи", smallBlade: "Лёгкие клинки", axe: "Топоры", bludgeon: "Дробящее",
  pole: "Древковое", staff: "Посохи", thrown: "Метательное", bow: "Луки", crossbow: "Арбалеты",
  natural: "Естественное (чудовища)", other: "Прочее"
};

/** Эффекты оружия (стр. 72). `param` — что пишется в скобках после названия (если есть). */
export const WEAPON_EFFECTS = {
  concealable:     { label: "Незаметное" },
  bleeding:        { label: "Кровопускающее", param: "%" },
  armorPiercing:   { label: "Пробивающее броню" },
  improvedAP:      { label: "Улучшенное пробивающее броню" },
  stun:            { label: "Дезориентирующее", param: "мод." },
  meteorite:       { label: "Метеоритное" },
  longReach:       { label: "Длинное" },
  focus:           { label: "Фокусирующее", param: "ед." },
  greaterFocus:    { label: "Улучшенное фокусирующее" },
  grappling:       { label: "Захватное" },
  slowReload:      { label: "Медленно перезаряжающееся" },
  nonLethal:       { label: "Несмертельное" },
  balanced:        { label: "Сбалансированное" },
  parrying:        { label: "Парирующее" },
  ablating:        { label: "Разрушающее" },
  hands:           { label: "Рукопашное" },
  poison:          { label: "Отравление", param: "%" },
  burning:         { label: "Горение", param: "%" },
  freeze:          { label: "Замораживание", param: "%" },
  staggering:      { label: "Ошеломление", param: "%" },
  // Шанс дезориентировать сразу, без испытания (хвост золотого дракона, руна Триглава «Офира и Зеррикании»)
  disorient:       { label: "Дезориентация", param: "%" },
  charge:          { label: "Разбег" },
  bladeCatcher:    { label: "Ловящий лезвия" },
  calculatedReload: { label: "Расчётная перезарядка" },
  magicBinding:    { label: "Магические путы" },
  entangling:      { label: "Опутывающее" },
  syringe:         { label: "Шприц" },
  mounted:         { label: "Устанавливаемое" },
  rune:            { label: "Руна (особый эффект)", param: "текст" }
};

/** Части тела, которые закрывает броня (стр. 79–80). */
export const ARMOR_LOCATIONS = {
  head: "Голова",
  torso: "Туловище",
  rightArm: "Правая рука",
  leftArm: "Левая рука",
  rightLeg: "Правая нога",
  leftLeg: "Левая нога"
};

export const ARMOR_WEIGHT_CLASS = { light: "Лёгкая", medium: "Средняя", heavy: "Тяжёлая" };

/** Виды магии (стр. 99–123). */
export const MAGIC_KINDS = {
  spell:      "Заклинание мага",
  invocation: "Инвокация жреца",
  sign:       "Ведьмачий знак",
  gift:       "Магический дар",
  ritual:     "Ритуал",
  hex:        "Порча",
  // «Высший вампир. Вторая редакция»: магия ролей, платится Очками Крови
  vampire:    "Вампирская магия"
};

export const MAGIC_LEVELS = {
  novice: "Новичок", journeyman: "Подмастерье", master: "Мастер", archPriest: "Верховный жрец"
};

export const MAGIC_ELEMENTS = {
  mixed: "Смешанные элементы", earth: "Земля", air: "Воздух", fire: "Огонь", water: "Вода"
};

export const MAGIC_DEFENSES = {
  none: "Нет",
  dodge: "Уклонение",
  dodgeBlock: "Уклонение или блокирование",
  resistMagic: "Сопротивление магии",
  resistReposition: "Сопротивление магии или смена позиции",
  willx3: "Воля существа ×3",
  casting: "Сотворение заклинаний",
  other: "Особая"
};

export const GEAR_CATEGORIES = {
  general: "Стандартное снаряжение", container: "Ёмкости", food: "Еда и питьё",
  clothing: "Одежда", tools: "Наборы инструментов", mount: "Упряжь и транспорт",
  alchemical: "Алхимические составы", component: "Компоненты", valuable: "Ценности",
  service: "Услуги", lodging: "Проживание", ammo: "Боеприпасы", tattoo: "Татуировки",
  prosthetic: "Протезы", prostheticMod: "Модификации протезов", other: "Прочее"
};

/**
 * Протезы и модификации «Лавки Клауса и Нострадамуса» в ударе протезом (module/combat/prosthetics.mjs). Ключ — название
 * в нижнем регистре без кавычек. accuracy — Точность; effects — свойства удара; silver — серебро (книга кубов не даёт —
 * 1d6, как у ведьмачьего протеза); lethal и damage — смертельный удар с прибавкой; coating — Надёжность 15, блок и
 * парирование Борьбой; reliability — поправка Надёжности; dimeritium — касание двимерита цели, Энергия 0 носителя.
 */
export const PROSTHETIC_PARTS = {
  "масштабируемый протез": { coating: true },
  "протез из сидерита": { coating: true, effects: [{ key: "meteorite" }, { key: "ablating" }] },
  "двимеритовый протез": { dimeritium: true },
  "серебряные шипы на кулаках/икрах": { silver: "1d6" },
  "крючковатые шипы на кулаках/икрах": { effects: [{ key: "bleeding", value: "35%" }] },
  "усиление пластины для пальцев/икр": { effects: [{ key: "armorPiercing" }] },
  "усиление пальцев/икр": { lethal: true, damage: "2d6" },
  "протезное покрытие": { coating: true },
  "лёгкое покрытие": { accuracy: 2, reliability: -5 }
};
/**
 * Особые боеприпасы в выстреле (корник стр. 84, 255; «Домашние правила BS & Tobi»). Ключ — название в нижнем регистре.
 * damageTypes — тип урона вместо оружейного; effects — свойства удара; nonLethal; silver — серебро; afterHit — после
 * попадания +N к результату атаки для крита; split — до N добавочных попаданий за каждый пункт свыше защиты;
 * explode — взрыв по всем частям тела всех в радиусе; note — что учитывается вручную.
 */
export const AMMO_PROPS = {
  "боеприпасы с затупленным наконечником": { damageTypes: ["bludgeoning"], nonLethal: true },
  "боеприпасы с широким наконечником": { effects: [{ key: "bleeding", value: "100%" }] },
  "бронебойные боеприпасы": { effects: [{ key: "armorPiercing" }] },
  "эльфские ввинчивающиеся боеприпасы": { effects: [{ key: "bleeding", value: "100%" }],
    note: "Кровотечение от ввинчивающегося наконечника останавливает только его извлечение: Первая помощь СЛ 16." },
  "краснолюдские пробивные боеприпасы": { damageTypes: ["bludgeoning"], effects: [{ key: "ablating" }] },
  "взрывные боеприпасы": { damageTypes: ["elemental"], explode: { formula: "4d6", radius: 2 } },
  "разделяющиеся боеприпасы": { split: 3 },
  "выслеживающие боеприпасы": { note: "Пока боеприпас в теле цели, по свежему (до полусуток) следу её выслеживают без проверок." },
  "серебряный боеприпас": { silver: "1d6" },
  "гавенкарский разбрызгивающий": { afterHit: 3, note: "СЛ стабилизации критического ранения от него +3." }
};
export const ammoProps = name => AMMO_PROPS[prostheticKey(name)] ?? null;

/** Надёжность протеза с протезным покрытием. */
export const PROSTHETIC_RELIABILITY = 15;
export const prostheticKey = name => String(name ?? "").toLowerCase().replace(/[«»"„“”]/g, "").replace(/\s+/g, " ").trim();
export const prostheticPart = name => PROSTHETIC_PARTS[prostheticKey(name)] ?? null;

/** Места татуировок и сколько их помещается («Офир и Зеррикания», стр. 78): руки и ноги — на каждой. */
export const TATTOO_LOCATIONS = {
  head:     { label: "Голова", max: 2 },
  torso:    { label: "Корпус", max: 4 },
  back:     { label: "Спина", max: 4 },
  rightArm: { label: "Правая рука", max: 3 },
  leftArm:  { label: "Левая рука", max: 3 },
  rightLeg: { label: "Правая нога", max: 3 },
  leftLeg:  { label: "Левая нога", max: 3 }
};

/** Ступени татуировок (стр. 79–81): цвет таблицы книги — трудность подвига. */
export const TATTOO_TIERS = {
  veryEasy: "Очень простая", easy: "Простая", medium: "Средняя", hard: "Сложная", veryHard: "Очень сложная", legendary: "Легендарная"
};
