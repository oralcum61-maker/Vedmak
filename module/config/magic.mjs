// Справочники магии (корник стр. 99–123, 166–168).

export const MAGIC_BRANCHES = {
  druid: "Друид", preacher: "Проповедник", archPriest: "Верховный жрец",
  // «Том Хаоса», стр. 126–149: запретные школы, которым учатся вне академий
  necromancy: "Некромантия", goetia: "Гоэтия"
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

/** Двимерит при касании: Стойкость СЛ 16 (стр. 167). [порог, текст] — от лучшего к худшему. */
export const DIMERITIUM_TOUCH = [
  [19, "Кожа чешется — дискомфорт, не более."],
  [17, "Кожа чешется, слегка подташнивает."],
  [15, "Подташнивает, спазмы: каждые 1d6 ходов Стойкость СЛ 15, иначе ошеломлён."],
  [13, "Кожа горит, желудок крутит: тошнота."],
  [11, "Словно в огне, едва может сосредоточиться: испытание Уст каждый раунд."],
  [-99, "Двимерит возжигает магию в теле: 1d6 урона каждый раунд касания."]
];

/** Разбор вида цели по дистанции (стр. 168). */
export function targetingFor(range) {
  const r = String(range ?? "").toLowerCase();
  if (r.startsWith("на себя") && !/\d/.test(r)) return "self";
  if (/зона|конус|радиус/.test(r)) return "area";
  return "direct";
}
