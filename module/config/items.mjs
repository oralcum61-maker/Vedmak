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
  hex:        "Порча"
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
  willx3: "Воля существа ×3",
  casting: "Сотворение заклинаний",
  other: "Особая"
};

export const GEAR_CATEGORIES = {
  general: "Стандартное снаряжение", container: "Ёмкости", food: "Еда и питьё",
  clothing: "Одежда", tools: "Наборы инструментов", mount: "Упряжь и транспорт",
  alchemical: "Алхимические составы", component: "Компоненты", valuable: "Ценности",
  service: "Услуги", lodging: "Проживание", other: "Прочее"
};
