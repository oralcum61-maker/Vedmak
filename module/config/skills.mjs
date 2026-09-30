// Навыки (корник стр. 49–56). `difficult` — сложный навык (×2 к стоимости О.У).
// Порядок внутри параметра — как в таблице на стр. 49.

export const SKILLS = {
  // ИНТЕЛЛЕКТ
  awareness:      { stat: "int",  label: "Внимание" },
  wilderness:     { stat: "int",  label: "Выживание в дикой природе" },
  deduction:      { stat: "int",  label: "Дедукция" },
  monsterLore:    { stat: "int",  label: "Монстрология", difficult: true },
  education:      { stat: "int",  label: "Образование" },
  streetwise:     { stat: "int",  label: "Ориентирование в городе" },
  teaching:       { stat: "int",  label: "Передача знаний" },
  tactics:        { stat: "int",  label: "Тактика", difficult: true },
  business:       { stat: "int",  label: "Торговля" },
  etiquette:      { stat: "int",  label: "Этикет" },
  langCommon:     { stat: "int",  label: "Язык: всеобщий", difficult: true, language: true },
  langElder:      { stat: "int",  label: "Язык: Старшая Речь", difficult: true, language: true },
  langDwarven:    { stat: "int",  label: "Язык: краснолюдский", difficult: true, language: true },
  // РЕАКЦИЯ
  melee:          { stat: "ref",  label: "Ближний бой", combat: true },
  brawling:       { stat: "ref",  label: "Борьба", combat: true },
  riding:         { stat: "ref",  label: "Верховая езда", combat: true },
  staffSpear:     { stat: "ref",  label: "Владение древковым оружием", combat: true },
  smallBlades:    { stat: "ref",  label: "Владение лёгкими клинками", combat: true },
  swordsmanship:  { stat: "ref",  label: "Владение мечом", combat: true },
  sailing:        { stat: "ref",  label: "Мореходство" },
  dodge:          { stat: "ref",  label: "Уклонение/Изворотливость" },
  // ЛОВКОСТЬ
  athletics:      { stat: "dex",  label: "Атлетика", combat: true },
  sleight:        { stat: "dex",  label: "Ловкость рук" },
  stealth:        { stat: "dex",  label: "Скрытность" },
  crossbow:       { stat: "dex",  label: "Стрельба из арбалета", combat: true },
  archery:        { stat: "dex",  label: "Стрельба из лука", combat: true },
  // ТЕЛОСЛОЖЕНИЕ
  physique:       { stat: "body", label: "Сила" },
  endurance:      { stat: "body", label: "Стойкость" },
  // ЭМПАТИЯ
  gambling:       { stat: "emp",  label: "Азартные игры" },
  grooming:       { stat: "emp",  label: "Внешний вид" },
  performance:    { stat: "emp",  label: "Выступление" },
  fineArts:       { stat: "emp",  label: "Искусство" },
  leadership:     { stat: "emp",  label: "Лидерство" },
  deceit:         { stat: "emp",  label: "Обман" },
  perception:     { stat: "emp",  label: "Понимание людей" },
  seduction:      { stat: "emp",  label: "Соблазнение" },
  persuasion:     { stat: "emp",  label: "Убеждение" },
  charisma:       { stat: "emp",  label: "Харизма" },
  // РЕМЕСЛО
  alchemy:        { stat: "cra",  label: "Алхимия", difficult: true },
  picklock:       { stat: "cra",  label: "Взлом замков" },
  trapcraft:      { stat: "cra",  label: "Знание ловушек", difficult: true },
  crafting:       { stat: "cra",  label: "Изготовление", difficult: true },
  disguise:       { stat: "cra",  label: "Маскировка" },
  firstAid:       { stat: "cra",  label: "Первая помощь" },
  forgery:        { stat: "cra",  label: "Подделывание" },
  // ВОЛЯ
  intimidation:   { stat: "will", label: "Запугивание" },
  hexWeaving:     { stat: "will", label: "Наведение порчи", difficult: true },
  ritualCrafting: { stat: "will", label: "Проведение ритуалов", difficult: true },
  resistMagic:    { stat: "will", label: "Сопротивление магии", difficult: true },
  resistCoercion: { stat: "will", label: "Сопротивление убеждению" },
  spellCasting:   { stat: "will", label: "Сотворение заклинаний", difficult: true },
  courage:        { stat: "will", label: "Храбрость" }
};

/** Сложности проверок (стр. 58). */
export const DIFFICULTIES = [
  { value: 10, label: "Легко (10)" },
  { value: 14, label: "Средне (14)" },
  { value: 18, label: "Сложно (18)" },
  { value: 20, label: "Очень сложно (20)" },
  { value: 30, label: "Практически невозможно (30)" }
];

/** Типовые модификаторы к СЛ (стр. 58). */
export const SITUATIONAL_MODS = [
  { value: 2, label: "Нет нужных запчастей" },
  { value: 3, label: "Нет нужных инструментов" },
  { value: 3, label: "Вас что-то отвлекает" },
  { value: 5, label: "На вас нападают" },
  { value: 3, label: "На пьяную голову" },
  { value: 3, label: "Недосып" },
  { value: 4, label: "Неблагоприятная обстановка" }
];

/** Уровни освещения для проверок навыков (стр. 58). */
export const LIGHT_MODS = [
  { value: 0, label: "Дневной свет" },
  { value: 2, label: "Яркий свет" },
  { value: 2, label: "Слабый свет" },
  { value: 5, label: "Темнота" }
];

/** Навыки, сгруппированные по параметру — для листа. */
export function skillsByStat() {
  const groups = {};
  for (const [key, def] of Object.entries(SKILLS)) (groups[def.stat] ??= []).push({ key, ...def });
  return groups;
}
