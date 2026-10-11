// Жизненный путь (корник стр. 25–36), жизненный путь ведьмака (стр. 238–245), высшего вампира
// («Высший вампир. Вторая редакция», стр. 2–11), а также пути из книг: на чужой земле («Офир и Зеррикания»,
// стр. 38–46) и мага («Том Хаоса», стр. 18–32).
//
// Все броски хранятся в плоском словаре `rolls` (путь → число). Функция `buildLifepath` по нему
// строит разделы с результатами и собирает механические последствия (кроны, навыки, предметы…).
// Недостающие броски делаются на лету, поэтому переброс одного результата пересобирает только
// зависящие от него строки. В пошаговом режиме (`step`) сборка останавливается на первом
// недостающем броске и сообщает, какой бросок следующий: так путь бросается по одному броску,
// и каждый уходит в чат (`rollLifepathStep`). Следующий результат можно и выбрать самому — строка-заглушка
// несёт список вариантов. Свои описания событий (`notes`: путь → {was, text}) меняют только текст летописи.

import { LIFEPATH_TABLES } from "../config/lifepath-tables.mjs";
import { VAMPIRE_TABLES, VAMPIRE_ROLE_BY_ROW, VAMPIRE_EVENTS_BY_AGE } from "../config/lifepath-vampire.mjs";
import { OFIR_TABLES } from "../config/lifepath-ofir.mjs";
import { TOME_TABLES } from "../config/lifepath-tome.mjs";
import { SKILLS } from "../config/skills.mjs";
import { renderTemplate, plural } from "../util.mjs";

const T = { ...LIFEPATH_TABLES, ...VAMPIRE_TABLES, ...OFIR_TABLES, ...TOME_TABLES };

/** Раса, у которой свой жизненный путь вместо семьи и десятилетий корника. */
export const VAMPIRE_RACE = "highVampire";

/**
 * Дополнительные жизненные пути из книг (вместо обычного пути корника): «Офир и Зеррикания» — на чужой земле,
 * «Том Хаоса» — путь мага. Ключ хранится в сохранённом жизненном пути (`kind`).
 */
export const LIFEPATH_KINDS = {
  ofir:      { label: "На чужой земле (Офир и Зеррикания)" },
  tomeMage:  { label: "Путь мага (Том Хаоса)" }
};

/** Бросок кости с `sides` гранями. */
export function rollDie(sides = 10) {
  return Math.min(sides, Math.floor(CONFIG.Dice.randomUniform() * sides) + 1);
}

/** Строка таблицы по результату броска. */
export function lookup(tableKey, value) {
  const t = T[tableKey];
  return t?.rows.find(r => value >= r.min && value <= r.max) ?? null;
}

function cellOf(row, col = 0) {
  const c = row?.cells[col];
  if (c === undefined) return { title: "", text: "" };
  return typeof c === "string" ? { title: "", text: c } : c;
}

/** Варианты для выпадающего списка: по одному на строку таблицы. */
function tableOptions(tableKey, col = 0) {
  return T[tableKey].rows.map(r => {
    const c = cellOf(r, col);
    const range = r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
    return { value: r.min, label: `${range}: ${c.title || c.text}`.slice(0, 90) };
  });
}

/** Небольшие подтаблицы, описанные прямо в тексте строк («Сделайте бросок 1d10: от 1 до 5 — …»). */
const SUB = {
  "fortune.7": [[1, 7, "Дикая собака (параметры на стр. 310)"], [8, 10, "Волк (стр. 286)"]],
  "misfortune.4": [[1, 5, "Несчастный случай"], [6, 8, "Убит чудовищами"], [9, 10, "Убит разбойниками"]],
  "misfortune.5": [[1, 3, "Воровство"], [4, 5, "Трусость или предательство"], [6, 8, "Убийство"], [9, 9, "Изнасилование"], [10, 10, "Нелегальное колдовство"]],
  "misfortune.6": [[1, 3, "Разыскивают несколько стражников"], [4, 6, "Разыскивают в посёлке"], [7, 8, "Разыскивают в городе"], [9, 10, "Разыскивают во всём королевстве"]],
  "misfortune.7": [[1, 3, "Вас шантажируют"], [4, 7, "Ваша тайна раскрыта"], [8, 10, "Вас предал кто-то из близких"]],
  "misfortune.8": [[1, 4, "Вы изуродованы — социальный статус: опасение"], [5, 6, "Вы лечились 1d10 месяцев"], [7, 8, "Вы потеряли память о 1d10 месяцах того года"], [9, 10, "Вас мучают жуткие кошмары (7 из 10 каждый раз во время сна)"]],
  "misfortune.9": [[1, 3, "Вас отравили: навсегда −5 ПЗ"], [4, 7, "Панические атаки: испытание Устойчивости каждые 5 раундов в стрессовой ситуации"], [8, 10, "Серьёзное душевное расстройство: агрессия, иррациональность, депрессия, голоса"]],
  "love": [[1, 1, "Счастливая любовь"], [2, 4, "Романтическая трагедия"], [5, 6, "Трудная любовь"], [7, 10, "Шлюхи и разгул"]],
  "wBenefit.1": [[1, 1, "Ребёнок"], [2, 2, "Собака"], [3, 3, "Лошадь"], [4, 4, "Новый плуг"], [5, 5, "Кошка"], [6, 6, "Бочка эля"], [7, 7, "Драгоценность стоимостью 1d6 × 10 крон"], [8, 8, "Оружие стоимостью до 500 крон"], [9, 9, "Вол"], [10, 10, "Мул"]],
  "wBenefit.2": [[1, 6, "Всё длилось пару недель"], [7, 8, "Всё длилось пару месяцев"], [9, 10, "Роман до сих пор продолжается с переменным успехом"]],
  "wBenefit.8": [[1, 2, "Эльфское усиление"], [3, 4, "Эльфский мессер"], [5, 6, "Краснолюдское усиление"], [7, 8, "Гномий ручной арбалет"], [9, 10, "Краснолюдский плащ"]],
  "wEvents.5": [[1, 3, "Воровство"], [4, 5, "Трусость или предательство"], [6, 8, "Убийство"], [9, 9, "Изнасилование"], [10, 10, "Нелегальное колдовство"]],
  "wEvents.6": [[1, 3, "Вас шантажировали"], [4, 7, "Раскрыли вашу тайну"], [8, 10, "На вас напали"]],
  "wEvents.7": [[1, 3, "Убит чудовищем"], [4, 6, "Его казнили"], [7, 8, "Жертва убийцы"], [9, 10, "Его отравили"]],
  "parentWho": [[1, 4, "Отец"], [5, 8, "Мать"], [9, 10, "Оба родителя"]],
  "eventKind": [[1, 4, "Удача или неудача"], [5, 7, "Союзники и враги"], [8, 10, "Любовь"]],
  "allyWhere": [[1, 3, "Королевства Севера"], [4, 6, "Империя Нильфгаард"], [7, 9, "Земли Старших Народов"], [10, 10, "За пределами"]],
  // Путь мага («Том Хаоса»): подброски из текста строк
  "mgAccuse": [[1, 2, "Кража"], [3, 3, "Измена"], [4, 4, "Трусость"], [5, 5, "Изнасилование"], [6, 6, "Убийство"], [7, 7, "Мошенничество"], [8, 8, "Запретная магия"], [9, 9, "Уклонение от уплаты налогов"], [10, 10, "Неэтичные действия"]],
  "mgLove": [[1, 6, "Роман длился несколько месяцев"], [7, 8, "Роман длился несколько лет"], [9, 10, "Роман продолжается до сих пор"]],
  "mgTrophy": [[1, 4, "Эльфский дорожный посох"], [5, 8, "Гномий посох"], [9, 10, "Хрустальный череп"]],
  "mgPortal": [[1, 3, "Старая поляна в Дол Блатанна"], [4, 5, "Горы Тир Тохаир"], [6, 8, "Болото в северном Каэдвене"], [9, 10, "Глубоко под Новиградом"]]
};

function subLookup(key, value) {
  return SUB[key]?.find(([a, b]) => value >= a && value <= b)?.[2] ?? "";
}
function subOptions(key) {
  return SUB[key].map(([a, b, text]) => ({ value: a, label: `${a === b ? a : `${a}–${b}`}: ${text}`.slice(0, 90) }));
}

/** Уровни риска ведьмака за десятилетие: шанс опасности и исходы (стр. 241). */
export const WITCHER_RISK = {
  careful: { label: "Осторожное (10%)", danger: 10, outcome: [[1, 1, "benefit"], [2, 2, "ally"], [3, 3, "hunt"], [4, 10, "nothing"]] },
  normal:  { label: "Нормальное (25%)", danger: 25, outcome: [[1, 1, "benefit"], [2, 2, "ally"], [3, 5, "hunt"], [6, 10, "nothing"]] },
  medium:  { label: "Среднее (50%)",    danger: 50, outcome: [[1, 2, "benefit"], [3, 7, "ally"], [8, 8, "hunt"], [9, 10, "nothing"]] },
  risky:   { label: "Рискованное (75%)", danger: 75, outcome: [[1, 5, "benefit"], [6, 7, "ally"], [8, 9, "hunt"], [10, 10, "nothing"]] }
};
const OUTCOME_LABELS = { benefit: "Выгода", ally: "Союзник", hunt: "Охота", nothing: "Ничего особенного" };

/* ------------------------------------------------------------------------- */

/**
 * Построитель: оборачивает словарь бросков и копит разделы и последствия.
 */
/** Сигнал пошаговой сборки: дальше нужен бросок, которого ещё нет. */
const PENDING = Symbol("lifepath-pending");

class Builder {
  constructor(rolls, { column = 0, step = false } = {}) {
    this.rolls = rolls;
    this.column = column;
    this.step = step;
    this.next = null;
    this.pendingEntry = null;
    this.owners = {};    // бросок без своей строки («1d10 × 100 крон») → строка, куда записан его итог
    this.sections = [];
    this.effects = {
      crowns: 0, reputation: 0, luck: 0, hpBonus: 0, staBonus: 0, vigorBonus: 0, feared: false,
      skills: {},          // ключ → +N к значению (не выше предела при создании)
      skillChoices: [],    // {path, label, stat|combat, bonus} — выбор игрока «+1 к навыку или новый +2»
      statMods: {},        // постоянные поправки параметров (эффектом)
      skillMods: {},       // постоянные штрафы навыков (эффектом)
      definingBonus: 0,    // «Глубокое изучение»: +1 к Подготовке ведьмака
      items: [],           // названия предметов
      addictions: [],
      notes: [],
      school: "",
      vampireRole: "",     // роль высшего вампира, выпавшая в жизненном пути
      // Магия из пути мага «Тома Хаоса»: сверх квоты профессии — в шаг «Магия» мастера создания
      spells: { novice: 0, journeyman: 0, named: [], choice: [] }
    };
  }

  /**
   * Значение броска: сохранённое или новое. В пошаговом режиме недостающий бросок не делается:
   * в раздел ставится строка-заглушка, и сборка останавливается.
   */
  roll(path, sides = 10, { label = "", section = null, owner = null, options = null, mod = 0 } = {}) {
    if (owner) this.owners[path] = owner;
    if (!(path in this.rolls)) {
      if (this.step) {
        this.next = { path, sides, label, section: section?.title ?? "" };
        // Варианты — чтобы выбрать результат самому, не бросая; у числовых бросков («1d10 × 100 крон») — числа
        options ??= sides <= 20 ? Array.from({ length: sides }, (_, i) => ({ value: i + 1, label: String(i + 1) })) : null;
        this.pendingEntry = { path, label, sides, mod, options, pending: true, text: "" };
        section?.entries.push(this.pendingEntry);
        throw PENDING;
      }
      this.rolls[path] = rollDie(sides);
    }
    return this.rolls[path];
  }

  section(title) {
    const s = { title, entries: [] };
    this.sections.push(s);
    return s;
  }

  /** Строка по таблице книги. */
  table(section, path, tableKey, { label, col = 0, sides = 10, mod = 0 } = {}) {
    label ??= T[tableKey].label;
    const options = tableOptions(tableKey, col);
    const raw = this.roll(path, sides, { label, section, options, mod });
    const value = Math.max(1, Math.min(T[tableKey].rows.at(-1).max, raw + mod));
    const row = lookup(tableKey, value);
    const cell = cellOf(row, col);
    const entry = {
      path, label, value: raw, shown: value, mod, sides,
      options, title: cell.title, text: cell.text, row
    };
    section.entries.push(entry);
    return entry;
  }

  /** Строка по подтаблице из текста. */
  sub(section, path, key, label) {
    const options = subOptions(key);
    const value = this.roll(path, 10, { label, section, options });
    const entry = { path, label, value, sides: 10, options, title: "", text: subLookup(key, value), sub: true };
    section.entries.push(entry);
    return entry;
  }

  /** Строка «чёт/нечет» или произвольный бросок без таблицы. */
  plain(section, path, label, text, { sides = 10, options = null } = {}) {
    const describe = v => (typeof text === "function" ? text(v) : text);
    if (!options && sides <= 10) options = Array.from({ length: sides }, (_, i) => ({ value: i + 1, label: `${i + 1}: ${describe(i + 1)}`.slice(0, 90) }));
    const value = this.roll(path, sides, { label, section, options });
    const entry = { path, label, value, sides, options, title: "", text: describe(value), sub: true };
    section.entries.push(entry);
    return entry;
  }
}

const EVEN_OPTIONS = (even, odd) => [{ value: 2, label: `Чёт: ${even}` }, { value: 1, label: `Нечет: ${odd}` }];
/** Бросок d100 против порога — два исхода списком: «1–25: …» и «26–100: …». */
const THRESHOLD_OPTIONS = (n, hit, miss) => [{ value: 1, label: `1–${n}: ${hit}` }, { value: n + 1, label: `${n + 1}–100: ${miss}` }];

/** Бонусы предметов положения семьи (стр. 28). */
function familyStatusEffects(entry, fx) {
  const text = entry.text;
  const m = text.match(/Начальное снаряжение:\s*(.+)$/);
  const gear = m?.[1] ?? "";
  if (/дворянская грамота/.test(gear)) { fx.items.push("Дворянская грамота (+2 к репутации)"); fx.reputation += 2; }
  if (/летопись/.test(gear)) { fx.items.push("Летопись (+1 к образованию)"); fx.skills.education = (fx.skills.education ?? 0) + 1; }
  if (/священный символ/.test(gear)) { fx.items.push("Священный символ"); fx.skills.courage = (fx.skills.courage ?? 0) + 1; }
  if (/личный герб/.test(gear)) { fx.items.push("Личный герб (+1 к репутации)"); fx.reputation += 1; }
  if (/2 знакомых/.test(gear)) fx.notes.push("Положение семьи: 2 знакомых");
  if (/чертежа\/формулы/.test(gear)) fx.notes.push("Положение семьи: 3 обычных чертежа или формулы на выбор");
  if (/музыкальный инструмент/.test(gear)) { fx.items.push("Музыкальный инструмент"); fx.notes.push("Положение семьи: 1 друг"); }
  if (/птица или змея/.test(gear)) fx.notes.push("Положение семьи: обученная птица или змея");
  if (/счастливый талисман/.test(gear)) { fx.items.push("Счастливый талисман (+1 к удаче)"); fx.luck += 1; }
}

/* ----------------------------- Обычный путь ----------------------------- */

function buildRegular(b, { age = 25, region = "north", race = "human" }) {
  const col = region === "nilfgaard" ? 1 : region === "elder" ? 2 : 0;
  const fx = b.effects;

  // Семья
  const fam = b.section("Семья");
  const family = b.plain(fam, "family", "Семья", v => (v % 2 === 0 ? "Хотя бы кто-то из семьи жив" : "С семьёй что-то случилось"),
    { options: EVEN_OPTIONS("хотя бы кто-то жив", "с семьёй что-то случилось") });
  let parentsDead;
  if (family.value % 2 === 1) {
    b.table(fam, "familyFate", "familyFate", { col });
    parentsDead = true;
  } else {
    const parents = b.plain(fam, "parents", "Родители", v => (v % 2 === 0 ? "Родители живы" : "С родителями что-то случилось"),
      { options: EVEN_OPTIONS("родители живы", "с родителями что-то случилось") });
    parentsDead = parents.value % 2 === 1;
  }
  if (parentsDead) {
    b.table(fam, "parentsFate", "parentsFate", { col });
    b.sub(fam, "parentWho", "parentWho", "Кого из родителей это касается");
  }
  const status = b.table(fam, "familyStatus", "familyStatus", { col });
  familyStatusEffects(status, fx);

  const friend = b.table(fam, "friend", "friend", { col, label: "Друг, оказавший влияние" });
  const gift = friend.text.match(/Снаряжение:\s*(.+)$/)?.[1];
  if (gift) fx.items.push(gift.charAt(0).toUpperCase() + gift.slice(1));

  // Братья и сёстры: северяне 1–8, нильфгаардцы и краснолюды 1–5, эльфы 1–2 → 1, 9–10 → 2
  const sib = b.section("Братья и сёстры");
  const countEntry = b.plain(sib, "siblingsCount", "Сколько братьев и сестёр", v => {
    const n = siblingsCount(v, race, region);
    if (!n) return "Единственный ребёнок";
    return n === 1 ? "Один брат или сестра" : n <= 4 ? `${n} брата или сестры` : `${n} братьев или сестёр`;
  });
  const count = siblingsCount(countEntry.value, race, region);
  for (let i = 0; i < count; i++) {
    // Строка таблицы — сразу после броска: в пошаговом режиме брат или сестра бывает брошен не до конца
    ["Пол", "Возраст", "Отношение", "Черта"].forEach((label, c) => {
      b.table(sib, `sibling.${i}.${c}`, "siblings", { col: c, label: `${i + 1}-й: ${label.toLowerCase()}` }).group = i;
    });
  }

  // Важные события — за каждые полные 10 лет (общие для обычного пути и пути на чужой земле)
  lifeEvents(b, { age });

  styleAndValues(b);
}

/** Важные события взрослой жизни: по одному за каждые полные 10 лет (стр. 31). */
function lifeEvents(b, { age = 25 }) {
  const ev = b.section("Важные события");
  const decades = Math.floor((Number(age) || 0) / 10);
  for (let i = 0; i < decades; i++) lifeEvent(b, ev, `event.${i}`, `${(i + 1) * 10} лет: событие`);
  if (!decades) ev.entries.push({ label: "Событий нет", text: "Персонажу меньше 10 лет — важных событий не было.", static: true });
}

/** Одно важное событие (стр. 31): удача или неудача, союзник или враг, любовь. Броски — под путём `base`. */
function lifeEvent(b, ev, base, label) {
  const fx = b.effects;
  const kind = b.sub(ev, `${base}.kind`, "eventKind", label);
  if (kind.value <= 4) {
    const luck = b.plain(ev, `${base}.luck`, "Удача или неудача", v => (v % 2 === 0 ? "Удача" : "Неудача"),
      { options: EVEN_OPTIONS("удача", "неудача") });
    if (luck.value % 2 === 0) fortune(b, ev, base, fx);
    else misfortune(b, ev, base, fx);
  } else if (kind.value <= 7) {
    const who = b.plain(ev, `${base}.side`, "Союзник или враг", v => (v % 2 === 0 ? "Союзник" : "Враг"),
      { options: EVEN_OPTIONS("союзник", "враг") });
    if (who.value % 2 === 0) {
      ["Пол", "Кто", "Как познакомились"].forEach((l, c) => b.table(ev, `${base}.ally.${c}`, "allies", { col: c, label: `Союзник: ${l.toLowerCase()}` }));
      b.table(ev, `${base}.ally.close`, "closeness", { label: "Насколько близки" });
      b.sub(ev, `${base}.ally.where`, "allyWhere", "Где союзник");
    } else {
      ["Пол", "Кто", "Причина"].forEach((l, c) => b.table(ev, `${base}.enemy.${c}`, "enemies", { col: c, label: `Враг: ${l.toLowerCase()}` }));
      b.plain(ev, `${base}.enemy.victim`, "Кто пострадал", v => (v % 2 === 0 ? "Пострадавшая сторона — вы" : "Пострадавшая сторона — враг"),
        { options: EVEN_OPTIONS("вы", "враг") });
      // Столбец 0 таблицы enemyPower — номера строк из вёрстки книги, а не значения: сила врага — столбец 2
      b.table(ev, `${base}.enemy.far`, "enemyPower", { col: 1, label: "Насколько далеко зашло" });
      b.table(ev, `${base}.enemy.kind`, "enemyPower", { col: 2, label: "В чём сила" });
    }
  } else {
    const love = b.sub(ev, `${base}.love`, "love", "Любовь");
    if (love.value >= 2 && love.value <= 4) b.table(ev, `${base}.tragedy`, "tragedy");
    else if (love.value >= 5 && love.value <= 6) b.table(ev, `${base}.problem`, "problematic");
  }
}

function siblingsCount(v, race, region) {
  if (race === "elf") return v <= 2 ? 1 : v >= 9 ? 2 : 0;
  if (race === "dwarf" || region === "nilfgaard") return v <= 5 ? v : 0;
  return v <= 8 ? v : 0;
}

function fortune(b, section, base, fx) {
  const e = b.table(section, `${base}.fortune`, "fortune");
  const v = e.row?.min;
  if (v === 1) {
    const n = b.roll(`${base}.fortune.d10`, 10, { label: "Сколько крон (1d10 × 100)", section, owner: e });
    e.detail = `Получено ${n * 100} крон (1d10 = ${n}).`;
    fx.crowns += n * 100;
  } else if (v === 2) {
    fx.skillChoices.push({ path: `${base}.fortune.skill`, label: "Учитель: +1 к навыку Инт или новый навык Инт +2", stat: "int" });
  } else if (v === 4) {
    fx.skillChoices.push({ path: `${base}.fortune.skill`, label: "Боевой инструктор: +1 к боевому навыку или новый боевой навык +2", combat: true });
  } else if (v === 7) {
    const beast = b.sub(section, `${base}.fortune.beast`, "fortune.7", "Какой зверь");
    fx.notes.push(`Приручённый зверь: ${beast.text}`);
  } else if (v === 9) {
    fx.items.push("Священный символ");
    fx.notes.push("Благословение жреца: +2 к Харизме с единоверцами");
  } else if (v === 10) {
    fx.notes.push("Рыцарство: +2 к репутации в одном королевстве");
  } else if (e.title) {
    fx.notes.push(e.title);
  }
}

function misfortune(b, section, base, fx) {
  const e = b.table(section, `${base}.misfortune`, "misfortune");
  const v = e.row?.min;
  if (v === 1) {
    const n = b.roll(`${base}.misfortune.d10`, 10, { label: "Сколько долга (1d10 × 100 крон)", section, owner: e });
    e.detail = `Долг: ${n * 100} крон (1d10 = ${n}).`;
    fx.notes.push(e.detail);
  } else if (v === 2) {
    const n = b.roll(`${base}.misfortune.d10`, 10, { label: "Сколько месяцев в тюрьме", section, owner: e });
    e.detail = `В тюрьме ${n} мес.`;
  } else if (v === 3) {
    fx.addictions.push("");
  } else if (SUB[`misfortune.${v}`]) {
    const sub = b.sub(section, `${base}.misfortune.sub`, `misfortune.${v}`, "Подробности");
    if (v === 8 && sub.value <= 4) fx.feared = true;
    if (v === 9 && sub.value <= 3) fx.hpBonus -= 5;
    if (v === 8 && (sub.value === 5 || sub.value === 6 || sub.value === 7 || sub.value === 8)) {
      sub.detail = `${b.roll(`${base}.misfortune.months`, 10, { label: "Сколько месяцев", section, owner: sub })} мес.`;
    }
  } else if (v === 10) {
    fx.notes.push("Проклятие (стр. 230)");
  }
}

function styleAndValues(b) {
  const st = b.section("Личный стиль");
  ["Одежда", "Характер", "Причёска", "Украшения"].forEach((l, c) => b.table(st, `style.${c}`, "style", { col: c, label: l }));
  const val = b.section("Ценности");
  T.values.cols.forEach((l, c) => b.table(val, `values.${c}`, "values", { col: c, label: l }));
}

/* ----------------------------- Путь ведьмака ----------------------------- */

/** Числовые поправки из текста строки «(−1 к Скор)», «(+1 к Владению мечом)». */
function witcherTrainingEffects(v, fx) {
  switch (v) {
    case 1: fx.statMods.spd = (fx.statMods.spd ?? 0) - 1; break;
    case 2: fx.notes.push("Украденное знание: 1 ведьмачий чертёж"); break;
    case 3: fx.notes.push("Соперник: 1 враг-ведьмак"); break;
    case 5: fx.vigorBonus -= 1; break;
    case 6: fx.skills.swordsmanship = (fx.skills.swordsmanship ?? 0) + 1; break;
    case 8: fx.notes.push("Друг-ведьмак"); break;
    case 9: fx.statMods.ref = (fx.statMods.ref ?? 0) - 1; break;
    case 10: fx.definingBonus += 1; break;
  }
}

function buildWitcher(b, { age = 80 }) {
  const fx = b.effects;
  const school = b.section("Школа и испытания");
  const when = b.table(school, "wAge", "wAge");
  const trialMod = when.row?.min === 1 ? -2 : when.row?.min === 9 ? 2 : 0;
  const sch = b.table(school, "wSchool", "wSchool");
  fx.school = ["wolf", "wolf", "griffin", "griffin", "cat", "cat", "viper", "viper", "bear", "bear"][(sch.row?.min ?? 1) - 1];
  const training = b.table(school, "wTraining", "wTraining");
  const tv = training.row?.min;
  witcherTrainingEffects(tv, fx);
  const mod = trialMod + (tv === 4 ? 2 : tv === 7 ? -2 : 0);
  const trials = b.table(school, "wTrials", "wTrials", { mod });
  if (mod) trials.detail = `Бросок ${trials.value} ${mod > 0 ? "+" : "−"} ${Math.abs(mod)} = ${trials.shown}`;
  const tr = trials.row?.min;
  if (tr === 1) { fx.statMods.emp = (fx.statMods.emp ?? 0) - 1; fx.statMods.body = (fx.statMods.body ?? 0) - 1; }
  else if (tr === 2) fx.statMods.emp = (fx.statMods.emp ?? 0) - 1;
  else if (tr === 10) { fx.statMods.emp = (fx.statMods.emp ?? 0) + 1; fx.statMods.dex = (fx.statMods.dex ?? 0) + 1; }

  const life = b.section("Жизнь ведьмака");
  b.table(life, "wEvent", "wEvent");
  b.table(life, "wSituation", "wSituation");
  const startEntry = b.plain(life, "wStart", "Начал странствовать", v => `В ${19 + v} лет`);
  const start = 19 + startEntry.value;
  const decades = Math.max(0, Math.floor(((Number(age) || 0) - start) / 10));

  for (let i = 0; i < decades; i++) {
    const base = `decade.${i}`;
    const sec = b.section(`Десятилетие ${i + 1} (${start + i * 10}–${start + (i + 1) * 10} лет)`);
    sec.decade = i;
    const riskKey = b.rolls[`${base}.risk`] ?? "normal";
    const risk = WITCHER_RISK[riskKey] ?? WITCHER_RISK.normal;
    sec.risk = riskKey;
    const danger = b.plain(sec, `${base}.danger`, "Опасность (d100)",
      v => (v <= risk.danger ? `Что-то стряслось (${v} ≤ ${risk.danger}%)` : `Обошлось (${v} > ${risk.danger}%)`),
      { sides: 100, options: THRESHOLD_OPTIONS(risk.danger, "что-то стряслось", "обошлось") });
    if (danger.value <= risk.danger) {
      const kind = b.table(sec, `${base}.dangerKind`, "wDanger");
      const k = kind.row?.min;
      if (k === 1) {
        const e = b.table(sec, `${base}.event`, "wEventsWounds", { col: 0, label: "Событие" });
        const ev = e.row?.min;
        if (SUB[`wEvents.${ev}`]) b.sub(sec, `${base}.event.sub`, `wEvents.${ev}`, "Подробности");
        if (ev === 1) e.detail = `Долг: ${b.roll(`${base}.event.d10`, 10, { label: "Сколько долга (1d10 × 100 крон)", section: sec, owner: e }) * 100} крон.`;
        if (ev === 3) fx.addictions.push("");
        if (ev === 4) e.detail = `В тюрьме ${b.roll(`${base}.event.d10`, 10, { label: "Сколько лет в тюрьме", section: sec, owner: e })} лет.`;
        if (ev === 1) fx.notes.push(e.detail);
      } else if (k === 4) {
        const w = b.table(sec, `${base}.wound`, "wEventsWounds", { col: 1, label: "Рана" });
        witcherWound(w.row?.min, fx);
      } else {
        ["Пол", "Кто", "Причина", "Сила", "Насколько далеко зашло"].forEach((l, c) =>
          b.table(sec, `${base}.enemy.${c}`, "wEnemies", { col: c, label: `Враг: ${l.toLowerCase()}` }));
        const alive = b.plain(sec, `${base}.enemy.alive`, "Жив ли враг (d100)", v => (v <= 30 ? "Враг умер" : "Враг жив"),
          { sides: 100, options: THRESHOLD_OPTIONS(30, "враг умер", "враг жив") });
        if (alive.value <= 30) {
          b.plain(sec, `${base}.enemy.when`, "Когда умер", v => `Через ${v} десятилетий`);
          b.table(sec, `${base}.enemy.death`, "wEnemyDeath");
        }
      }
    }
    const outcomeRoll = b.plain(sec, `${base}.outcome`, "Исход десятилетия", v => {
      const o = risk.outcome.find(([a, c]) => v >= a && v <= c)?.[2];
      return OUTCOME_LABELS[o] ?? "";
    });
    const outcome = risk.outcome.find(([a, c]) => outcomeRoll.value >= a && outcomeRoll.value <= c)?.[2];
    if (outcome === "benefit") {
      const e = b.table(sec, `${base}.benefit`, "wBenefit");
      const v = e.row?.min;
      if (SUB[`wBenefit.${v}`]) {
        const sub = b.sub(sec, `${base}.benefit.sub`, `wBenefit.${v}`, "Подробности");
        if (v === 8) fx.items.push(sub.text);
        if (v === 1) fx.notes.push(`Право Неожиданности: ${sub.text}`);
      }
      if (v === 3) {
        const n = b.roll(`${base}.benefit.d10`, 10, { label: "Сколько крон (1d10 × 100)", section: sec, owner: e });
        e.detail = `Получено ${n * 100} крон (1d10 = ${n}).`;
        fx.crowns += n * 100;
      }
      if (v === 5) fx.notes.push("Ведьмачьи тайны: формула эликсира, масла или отвара на выбор");
      if (v === 6) fx.notes.push("Рыцарство: +1 к репутации в одной стране");
      if (v === 10) fx.skillChoices.push({ path: `${base}.benefit.skill`, label: "Учитель: +1 к навыку Инт или новый навык Инт +2", stat: "int" });
      if ([4, 7, 9].includes(v)) fx.notes.push(e.title);
    } else if (outcome === "ally") {
      ["Пол", "Кто", "Как познакомились"].forEach((l, c) => b.table(sec, `${base}.ally.${c}`, "wAllies", { col: c, label: `Союзник: ${l.toLowerCase()}` }));
      b.table(sec, `${base}.ally.close`, "wCloseness", { label: "Близость" });
      const alive = b.plain(sec, `${base}.ally.alive`, "Жив ли союзник (d100)", v => (v <= 30 ? "Союзник мёртв" : "Союзник жив"),
        { sides: 100, options: THRESHOLD_OPTIONS(30, "союзник мёртв", "союзник жив") });
      if (alive.value <= 30) {
        b.plain(sec, `${base}.ally.when`, "Когда умер", v => `Через ${v} десятилетий`);
        b.table(sec, `${base}.ally.death`, "wAllyDeath");
      }
    } else if (outcome === "hunt") {
      const target = b.table(sec, `${base}.hunt.target`, "wHuntTarget");
      target.detail = "+2 к Подготовке ведьмака против этого класса чудовищ.";
      fx.notes.push(`Охота: ${target.text} (+2 к Подготовке ведьмака против них)`);
      b.table(sec, `${base}.hunt.place`, "wHuntPlace");
      b.table(sec, `${base}.hunt.end`, "wHuntEnd");
      const twist = b.plain(sec, `${base}.hunt.twist`, "Был ли поворот", v => (v <= 4 ? "Да" : "Нет"));
      if (twist.value <= 4) b.table(sec, `${base}.hunt.twistWhat`, "wTwist");
    }
  }
  if (!decades) life.entries.push({ label: "Десятилетия", text: "Возраст меньше начала странствий — десятилетий нет.", static: true });
  styleAndValues(b);
}

/** Раны ведьмака (стр. 245): постоянные штрафы. */
function witcherWound(v, fx) {
  const skill = (k, n) => (fx.skillMods[k] = (fx.skillMods[k] ?? 0) + n);
  switch (v) {
    case 1: fx.statMods.spd = (fx.statMods.spd ?? 0) - 1; break;
    case 2: fx.notes.push("Повреждённый глаз: −1 к Вниманию, основанному на зрении"); break;
    case 3: fx.notes.push("Плохо гнётся рука: −1 к Ближнему бою этой рукой"); break;
    case 4: fx.notes.push("Повреждённые пальцы: нельзя сотворять знаки этой рукой"); break;
    case 5: skill("physique", -1); break;
    case 6: fx.staBonus -= 5; break;
    case 7: skill("charisma", -2); skill("seduction", -2); break;
    case 8: fx.notes.push("Повреждённый нос: −2 к Выживанию в дикой природе при выслеживании по запаху"); break;
    case 9: fx.hpBonus -= 5; break;
    case 10: fx.notes.push("Полуглухой: −1 к Вниманию, основанному на слухе"); break;
  }
}

/* --------------------------- Путь высшего вампира --------------------------- */

/** Механика строк таблиц вампира: навыки, параметры, репутация, предметы, заметки. */
function vampireEffects(table, v, fx, entry) {
  const skill = (k, n) => (fx.skills[k] = (fx.skills[k] ?? 0) + n);
  if (table === "vClan") {
    if (v <= 2) for (const k of ["perception", "charisma", "deceit", "persuasion", "seduction"]) skill(k, 1);
    else if (v <= 4) { skill("sailing", 3); fx.notes.push("Клан Аммурун: нет штрафов при сражении под водой"); }
    else fx.notes.push("Клан Тдет: шанс отравления вдвое меньше");
    return;
  }
  if (table === "vAge") {
    skill(v <= 2 ? "streetwise" : v <= 5 ? "etiquette" : "education", 2);
    return;
  }
  if (table === "vEvent") {
    switch (v) {
      case 1: skill("perception", 2); break;
      case 2: skill("seduction", 2); break;
      case 3: skill("courage", 2); fx.notes.push("Заклятый враг — другой высший вампир"); break;
      case 4: skill("endurance", 2); break;
      case 5: skill("monsterLore", 2); fx.notes.push("В логове — дикое простое чудовище-питомец"); break;
      case 6: skill("dodge", 2); fx.notes.push("Был «убит»: воскрешение временем вдвое быстрее"); break;
      case 7: skill("intimidation", 2); fx.notes.push("Ушёл в запой: сородичи относятся с подозрением"); break;
      case 9: skill("persuasion", 1); skill("charisma", 1); fx.notes.push("Основал секту"); break;
      case 10: fx.reputation += 2; fx.notes.push("Рыцарь в окрестностях своего логова"); break;
    }
    return;
  }
  if (table === "vHobby") {
    switch (v) {
      case 1: skill("business", 2); fx.notes.push("Торговля: 50 крон в неделю"); break;
      case 2: skill("alchemy", 2); fx.notes.push("Лаборатория в логове и 2 формулы новичка"); break;
      case 3: skill("fineArts", 2); fx.notes.push("Своя мастерская"); break;
      case 4: skill("deduction", 2); fx.notes.push("Друг в местной страже"); break;
      case 5: fx.notes.push("«Ферма»: двое домашних людей — раз в неделю 1d10 ОК без проверки Сопротивления Жажде"); break;
      case 6: skill("gambling", 2); fx.notes.push("Много должников в округе"); break;
      case 7: skill("sailing", 2); fx.notes.push("Парусная лодка"); break;
      case 8: skill("riding", 2); fx.items.push("Лошадь", "Скаковое седло"); break;
      case 9: skill("etiquette", 2); fx.notes.push("Виноградник: 50 крон в неделю"); break;
      case 10: skill("athletics", 2); break;
    }
    return;
  }
  if (table === "vBlood") fx.notes.push(`Особенность питья крови: ${entry.title}`);
}

function buildVampire(b) {
  const fx = b.effects;
  const origin = b.section("Клан и юность");
  const clan = b.table(origin, "vClan", "vClan", { sides: 6 });
  vampireEffects("vClan", clan.value, fx, clan);
  const age = b.table(origin, "vAge", "vAge");
  vampireEffects("vAge", age.value, fx, age);
  b.table(origin, "vYouth", "vYouth");

  const ev = b.section("События жизни");
  const count = VAMPIRE_EVENTS_BY_AGE[age.row?.min] ?? 1;
  for (let i = 0; i < count; i++) {
    const e = b.table(ev, `vEvent.${i}`, "vEvent", { label: `${i + 1}-е событие` });
    if (e.value === 8) {
      const fame = b.plain(ev, `vEvent.${i}.fame`, "Добрая или дурная слава", v => (v % 2 === 0 ? "Добрая слава: +2 к репутации" : "Дурная слава: +2 к Запугиванию"),
        { options: EVEN_OPTIONS("добрая слава, +2 к репутации", "дурная слава, +2 к Запугиванию") });
      if (fame.value % 2 === 0) fx.reputation += 2;
      else fx.skills.intimidation = (fx.skills.intimidation ?? 0) + 2;
    } else vampireEffects("vEvent", e.value, fx, e);
  }

  const life = b.section("Увлечение, кровь и роль");
  const hobby = b.table(life, "vHobby", "vHobby");
  vampireEffects("vHobby", hobby.value, fx, hobby);
  const blood = b.table(life, "vBlood", "vBlood");
  vampireEffects("vBlood", blood.value, fx, blood);
  const role = b.table(life, "vRole", "vRole");
  fx.vampireRole = VAMPIRE_ROLE_BY_ROW[role.row?.min] ?? "";

  const ch = b.section("Характер");
  T.vChar.cols.forEach((l, c) => b.table(ch, `vChar.${c}`, "vChar", { col: c, label: l }));
}

/* ------------------------------------------------------------------------- */

/**
 * Раздел броска для «Бросить раздел»: десятилетие важных событий, один брат или сестра или раздел целиком.
 * @returns {{card: string, cardTitle: string}} card — ключ, cardTitle — коротко для кнопки
 */
function cardOf(next) {
  const decade = next.path.match(/^event\.(\d+)/)?.[1];
  if (decade !== undefined) return { card: `event.${decade}`, cardTitle: `${(Number(decade) + 1) * 10} лет` };
  // Братьев и сестёр бывает до восьми, по четыре броска: раздел — каждый отдельно
  const vev = next.path.match(/^vEvent\.(\d+)/)?.[1];
  if (vev !== undefined) return { card: `vEvent.${vev}`, cardTitle: `${Number(vev) + 1}-е событие` };
  const sib = next.path.match(/^sibling\.(\d+)/)?.[1];
  if (sib !== undefined) return { card: `sibling.${sib}`, cardTitle: `${Number(sib) + 1}-й брат или сестра` };
  const osib = next.path.match(/^ofir\.sib\.(\d+)/)?.[1];
  if (osib !== undefined) return { card: `ofir.sib.${osib}`, cardTitle: `${Number(osib) + 1}-й брат или сестра` };
  // «Десятилетие 1 (29–39 лет)» → «Десятилетие 1»
  return { card: next.section, cardTitle: next.section.replace(/\s*\(.*\)$/, "") };
}

/**
 * Собрать жизненный путь.
 * @param {object} rolls — словарь бросков (изменяется: дописываются недостающие, кроме пошагового режима)
 * @param {object} opts — {witcher, age, region: north|nilfgaard|elder, race, step, notes}; notes — свои описания событий
 * @returns {{sections: object[], effects: object, next: {path, sides, label, section}|null, resultOf: Function}}
 *   next — следующий бросок в пошаговом режиме; null — путь брошен до конца;
 *   resultOf(path) — что выпало по броску: {title, text, detail}
 */
export function buildLifepath(rolls, opts) {
  const b = new Builder(rolls, { step: !!opts.step });
  try {
    if (opts.witcher) buildWitcher(b, opts);
    else if (opts.race === VAMPIRE_RACE) buildVampire(b, opts);
    else if (opts.kind === "ofir") buildOfir(b, opts);
    else if (opts.kind === "tomeMage") buildMage(b, opts);
    else buildRegular(b, opts);
  } catch (err) {
    if (err !== PENDING) throw err;
  }
  applyNotes(b.sections, opts.notes);
  const resultOf = path => {
    const own = b.sections.flatMap(sec => sec.entries).find(e => e.path === path && !e.pending);
    if (own) return { title: own.title ?? "", text: own.text ?? "", detail: own.detail ?? "" };
    return { title: "", text: b.owners[path]?.detail ?? "", detail: "" };
  };
  if (b.next) {
    Object.assign(b.next, cardOf(b.next));
    Object.assign(b.pendingEntry, { cardTitle: b.next.cardTitle });
  }
  return { sections: b.sections, effects: b.effects, next: b.next, resultOf };
}

/**
 * Что выпало строке — как в книге: «Заголовок. Пояснение». К этому тексту привязано своё описание:
 * переброс или другой выбор дают другой результат, и своё описание прежнего уже не показывается.
 */
export function resultText(e) {
  if (!e.title) return e.text ?? "";
  return e.text ? `${e.title}${/[.!?…]$/.test(e.title) ? "" : "."} ${e.text}` : e.title;
}

/** Свои описания событий — строкам, чей результат не сменился с тех пор, как его переписали. */
function applyNotes(sections, notes) {
  if (!notes) return;
  for (const sec of sections) for (const e of sec.entries) {
    const n = e.path && !e.pending ? notes[e.path] : null;
    if (n?.text && n.was === resultText(e)) e.note = n.text;
  }
}

/** Записать своё описание строки; пустое или как в книге — убрать. */
export function setLifepathNote(notes, entry, text) {
  const t = String(text ?? "").trim();
  if (!t || t === resultText(entry)) delete notes[entry.path];
  else notes[entry.path] = { was: resultText(entry), text: t };
}

/**
 * Окно своего описания строки: текст книги для сравнения и поле со своим.
 * @param {object} entry — строка из buildLifepath
 * @param {object} notes — свои описания (меняются)
 * @returns {Promise<boolean>} поменялось ли
 */
export async function editLifepathNote(entry, notes) {
  const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
  const original = resultText(entry);
  const label = plainLabel(entry.label);
  const content = `<div class="vedmak lp-note-form">
    <p class="lp-note-orig"><span class="lp-k">По книге</span> ${esc(original)}${entry.detail ? ` <i class="lp-detail">${esc(entry.detail)}</i>` : ""}</p>
    <textarea name="text" rows="6" placeholder="Как это было у вашего персонажа">${esc(entry.note ?? original)}</textarea>
    <p class="hint">Своё описание меняет только текст летописи. Что выпало и что это дало — кроны, навыки, предметы — остаётся как было.
      Переброс или другой результат из списка вернёт текст книги.</p>
  </div>`;
  const buttons = [{ action: "save", label: "Сохранить", icon: "fa-solid fa-feather", default: true,
    callback: (event, button) => button.form.elements.text.value }];
  if (entry.note) buttons.push({ action: "reset", label: "Как в книге", icon: "fa-solid fa-book", callback: () => "" });
  const text = await foundry.applications.api.DialogV2.wait({
    window: { title: `Своё описание: ${label}` }, position: { width: 460 }, content, buttons, rejectClose: false
  });
  if (text === null || text === undefined) return false;
  const before = JSON.stringify(notes[entry.path] ?? null);
  setLifepathNote(notes, entry, text);
  return JSON.stringify(notes[entry.path] ?? null) !== before;
}

/** Строка пути по пути броска — для окна своего описания. */
export function findEntry(lp, path) {
  return lp.sections.flatMap(sec => sec.entries).find(e => e.path === path && !e.pending) ?? null;
}

/** Удалить бросок и все зависящие от него (пути, начинающиеся с него). */
export function clearRoll(rolls, path) {
  for (const key of Object.keys(rolls)) {
    if (key === path || key.startsWith(`${path}.`)) delete rolls[key];
  }
}

/** Все броски, зависящие от пути, — чтобы переброс пересобрал ветку. */
export function dependents(path) {
  // Бросок семьи и родителей меняет всю семейную ветку
  if (path === "family") return ["familyFate", "parents", "parentsFate", "parentWho"];
  if (path === "parents") return ["parentsFate", "parentWho"];
  if (path === "siblingsCount") return ["sibling"];
  if (path === "wAge" || path === "wTraining") return ["wTrials"];
  if (path === "wStart") return ["decade"];
  // Путь на чужой земле: регион выбирает колонку всех таблиц, число братьев и сестёр — их броски
  if (path === "ofir.region") return ["ofir.home", "ofir.region2", "ofir.family", "ofir.parents", "ofir.familyFate",
    "ofir.parent", "ofir.parentsFate", "ofir.status", "ofir.friend", "ofir.sibCount", "ofir.sib"];
  if (path === "ofir.home") return ["ofir.region2"];
  if (path === "ofir.family") return ["ofir.parents", "ofir.parent", "ofir.parentsFate", "ofir.familyFate"];
  if (path === "ofir.parents") return ["ofir.parent", "ofir.parentsFate"];
  if (path === "ofir.sibCount") return ["ofir.sib"];
  // Путь мага: место рождения — колонка реакции и школа по умолчанию, школа — колонка академии и ученичества
  const MAGE_SCHOOL_DEPS = ["mage.acad", "mage.appr", "mage.mentor", "mage.teach", "mage.moment", "mage.mentorEnd"];
  if (path === "mage.birth") return ["mage.reaction", "mage.school", ...MAGE_SCHOOL_DEPS];
  if (path === "mage.school") return MAGE_SCHOOL_DEPS;
  if (path === "mage.appr") return ["mage.mentor", "mage.teach", "mage.moment", "mage.mentorEnd"];
  // «Портал активен?» решает, бросать ли, куда он ведёт
  if (/\.benefit\.portal$/.test(path)) return [path.replace(/portal$/, "sub")];
  // Декада академии: её подброски (союзник, обида, знание, кроны, событие) и ученичество, которое она могла дать
  if (/^mage\.acad\.\d+$/.test(path)) return [`${path}.ally`, `${path}.grudge`, `${path}.knowledge`, `${path}.d6`, `${path}.ev`,
    `${path}.skill`, "mage.appr", "mage.mentor", "mage.teach", "mage.moment", "mage.mentorEnd"];
  // Возраст вампира решает, сколько событий; восьмое событие — ещё бросок славы
  if (path === "vAge") return ["vEvent"];
  if (/^vEvent\.\d+$/.test(path)) return [`${path}.fame`];
  // Броски-соседи, а не вложенные пути: «жив ли» решает, бросать ли «когда умер» и «как», поворот охоты —
  // бросать ли, какой он, подробности неудачи — бросать ли месяцы (у «Изуродован» их нет)
  const near = path.match(/^(decade\.\d+\.(?:enemy|ally))\.alive$/);
  if (near) return [`${near[1]}.when`, `${near[1]}.death`];
  if (/^decade\.\d+\.hunt\.twist$/.test(path)) return [`${path}What`];
  const sub = path.match(/^(event\.\d+\.misfortune)\.sub$/);
  if (sub) return [`${sub[1]}.months`];
  const m = path.match(/^(event\.\d+|decade\.\d+|mage\.acad\.\d+\.ev)\.(kind|luck|side|love|danger|dangerKind|outcome|event|benefit|fortune|misfortune|trouble|knowledge)$/);
  if (m) {
    const [, base, what] = m;
    const children = {
      kind: ["luck", "side", "love", "fortune", "misfortune", "ally", "enemy", "tragedy", "problem"],
      luck: ["fortune", "misfortune"], side: ["ally", "enemy"], love: ["tragedy", "problem"],
      danger: ["dangerKind", "event", "wound", "enemy", "trouble"], dangerKind: ["event", "wound", "enemy"],
      outcome: ["benefit", "ally", "hunt", "knowledge"], event: [], benefit: [], fortune: [], misfortune: [], trouble: [], knowledge: []
    }[what] ?? [];
    return [...children.map(c => `${base}.${c}`), `${path}.sub`, `${path}.d10`, `${path}.d6`, `${path}.beast`, `${path}.skill`, `${path}.months`,
      `${path}.grudge`, `${path}.portal`];
  }
  return [];
}

/** Навыки для выбора «+1 или новый +2»: Инт-навыки или боевые. */
export function choiceSkillOptions(choice) {
  return Object.entries(SKILLS)
    .filter(([, s]) => (choice.combat ? s.combat : s.stat === choice.stat))
    .map(([key, s]) => ({ value: key, label: s.label }));
}

/* ------------------------- Путь на чужой земле ------------------------- */
/* «Офир и Зеррикания», стр. 38–46: детство — по таблицам книги, взрослая жизнь (события,
   стиль и ценности) — из основного пути. */

/** +1 к навыку по строке «Региона места рождения»: колонка Офир или Зеррикания. */
const OFIR_REGION_SKILLS = [
  ["wilderness", "riding", "firstAid", "endurance", "trapcraft", "courage", "intimidation", "sailing", "awareness", "resistMagic"],
  ["wilderness", "awareness", "endurance", "courage", "sailing", "riding", "trapcraft", "firstAid", "intimidation", "resistMagic"]
];

/** Механика строк «Положения семьи»: снаряжение, репутация, Удача, навыки. */
function ofirStatusEffects(col, v, fx) {
  const skill = (k, n) => (fx.skills[k] = (fx.skills[k] ?? 0) + n);
  const items = [];
  if (col === 0) {
    switch (v) {
      case 1: items.push("Дворянская грамота"); fx.reputation += 2; break;
      case 2: items.push("Летопись"); skill("education", 1); break;
      case 3: items.push("Личный герб"); fx.reputation += 1; break;
      case 4: fx.notes.push("Положение семьи: 2 знакомых"); break;
      case 5: fx.notes.push("Положение семьи: 3 обычных чертежа или формулы на выбор"); break;
      case 6: items.push("Музыкальный инструмент"); fx.notes.push("Положение семьи: 1 друг"); break;
      case 7: items.push("Счастливый талисман"); fx.luck += 1; break;
      case 8: items.push("Обычные формулы"); skill("alchemy", 1); break;
      case 9: items.push("Бандитская метка"); skill("streetwise", 1); break;
      case 10: items.push("Сбор трав"); skill("wilderness", 1); break;
    }
  } else {
    switch (v) {
      case 1: items.push("Дворянский герб"); fx.reputation += 2; break;
      case 2: items.push("Короткий лук"); break;
      case 3: items.push("Седло"); break;
      case 4: fx.notes.push("Положение семьи: 3 обычных чертежа или формулы на выбор"); break;
      case 5: items.push("Старинные схемы"); skill("crafting", 1); break;
      case 6: fx.notes.push("Положение семьи: 2 знакомых"); break;
      case 7: items.push("Счастливый талисман"); fx.luck += 1; break;
      case 8: items.push("Сбор трав"); skill("wilderness", 1); break;
      case 9: items.push("Обычные формулы"); skill("firstAid", 1); break;
      case 10: items.push("Дрессированная птица или змея"); break;
    }
  }
  fx.items.push(...items);
}

function buildOfir(b, { age = 25 }) {
  const fx = b.effects;
  // Офир или Зеррикания — бросок или выбор («выберите свою судьбу, или определите её броском костей»)
  const reg = b.plain(b.section("Чужие края"), "ofir.region", "Офир или Зеррикания",
    v => (v % 2 === 0 ? "Офир" : "Зеррикания"), { options: EVEN_OPTIONS("Офир", "Зеррикания") });
  const col = reg.value % 2 === 0 ? 0 : 1;

  const fam = b.section("Семья");
  const home = b.table(fam, "ofir.home", "ofHome", { col, label: "Родина" });
  if (home.value <= 3) fx.skills[col === 0 ? "crafting" : "alchemy"] = (fx.skills[col === 0 ? "crafting" : "alchemy"] ?? 0) + 1;
  if (home.value >= 4) {
    const region = b.table(fam, "ofir.region2", "ofRegion", { col, label: "Регион места рождения" });
    const sk = OFIR_REGION_SKILLS[col][Math.max(0, Math.min(9, region.value - 1))];
    if (sk) fx.skills[sk] = (fx.skills[sk] ?? 0) + 1;
  }

  const family = b.plain(fam, "ofir.family", "Семья", v => (v % 2 === 0 ? "Хотя бы кто-то из семьи жив" : "С семьёй что-то случилось"),
    { options: EVEN_OPTIONS("хотя бы кто-то жив", "с семьёй что-то случилось") });
  let parentsDead;
  if (family.value % 2 === 1) {
    b.table(fam, "ofir.familyFate", "ofFamilyFate", { col });
    parentsDead = true;
  } else {
    const parents = b.plain(fam, "ofir.parents", "Родители", v => (v % 2 === 0 ? "Родители живы" : "С родителями что-то случилось"),
      { options: EVEN_OPTIONS("родители живы", "с родителями что-то случилось") });
    parentsDead = parents.value % 2 === 1;
  }
  if (parentsDead) {
    b.table(fam, "ofir.parent", "ofParent", { label: "Кого из родителей это касается" });
    b.table(fam, "ofir.parentsFate", "ofParentsFate", { col });
  }
  const status = b.table(fam, "ofir.status", "ofStatus", { col });
  ofirStatusEffects(col, status.value, fx);

  const friend = b.table(fam, "ofir.friend", "ofFriend", { col, label: "Друг, оказавший влияние" });
  const gift = friend.text.match(/Снаряжение:\s*(.+)$/)?.[1];
  if (gift) fx.items.push(gift.charAt(0).toUpperCase() + gift.slice(1));

  // Братья и сёстры: в ячейке таблицы — число (Офир 1–5, Зеррикания 1–8) или «Единственный ребёнок»
  const sib = b.section("Братья и сёстры");
  const countEntry = b.table(sib, "ofir.sibCount", "ofSibCount", { col, label: "Сколько братьев и сестёр" });
  const count = /^\d+$/.test(countEntry.text) ? Number(countEntry.text) : 0;
  for (let i = 0; i < count; i++) {
    ["Пол", "Возраст", "Отношение", "Черта"].forEach((label, c) => {
      b.table(sib, `ofir.sib.${i}.${c}`, "ofSib", { col: c, label: `${i + 1}-й: ${label.toLowerCase()}` }).group = i;
    });
  }

  lifeEvents(b, { age });
  styleAndValues(b);
}

/* ------------------------------- Путь мага ------------------------------- */
/* «Том Хаоса», стр. 18–32: детство, школа магии и ученичество — по таблицам книги, затем жизнь мага:
   за каждое десятилетие после 20 лет — поведение, бросок опасности (d100) и событие. Стиль и ценности —
   из основного пути. */

/** Поведение мага за десятилетие (стр. 25): рейтинг опасности, колонка таблиц и исходы d10. */
export const MAGE_BEHAVIOR = {
  careful:     { label: "Осторожность (20%)", danger: 20, col: 0,
    outcome: [[1, 1, "benefit"], [2, 2, "ally"], [3, 3, "knowledge"], [4, 10, "nothing"]] },
  politics:    { label: "Политиканство (50%)", danger: 50, col: 1,
    outcome: [[1, 2, "benefit"], [3, 7, "ally"], [8, 8, "knowledge"], [9, 10, "nothing"]] },
  experiments: { label: "Эксперименты (70%)", danger: 70, col: 2,
    outcome: [[1, 3, "benefit"], [4, 4, "ally"], [5, 10, "knowledge"]] },
  research:    { label: "Магические исследования (50%)", danger: 50, col: 3,
    outcome: [[1, 5, "benefit"], [6, 7, "ally"], [8, 8, "knowledge"], [9, 10, "nothing"]] }
};
const MAGE_OUTCOMES = { benefit: "Выгода", ally: "Союзник", knowledge: "Знание", nothing: "Ничего особенного" };

/** Поведение десятилетия: справочник ведьмака или мага — по ключу. */
function riskOf(key) {
  return MAGE_BEHAVIOR[key] ?? WITCHER_RISK[key] ?? null;
}

/** Колонка «Как люди реагировали» по месту рождения: Север (и Скеллиге), Старшие земли, Нильфгаард. */
const mageRegionCol = birth => (birth === 11 ? 1 : birth >= 6 ? 2 : 0);

/** Школа по месту рождения и полу (стр. 20) — только подсказка, игрок может выбрать другую. */
function mageDefaultSchool(birth, gender = "") {
  if (birth === 11) return 4;
  if (birth >= 6) return 3;
  return /^ж|жен/i.test(String(gender).trim()) ? 1 : 2;
}

/** Обида (стр. 28): профессия, причина, обострение, сила — четыре броска под путём `base`. */
function mageGrudge(b, sec, base, label = "Обида") {
  T.mgGrudge.cols.forEach((l, c) => b.table(sec, `${base}.${c}`, "mgGrudge", { col: c, label: `${label}: ${l.toLowerCase()}` }));
}

/** Союзник (стр. 30): профессия, как встретились, близость, значимость. */
function mageAlly(b, sec, base, label = "Союзник") {
  T.mgAllies.cols.forEach((l, c) => b.table(sec, `${base}.${c}`, "mgAllies", { col: c, label: `${label}: ${l.toLowerCase()}` }));
}

/** Знание (стр. 31). Повтор «Магического биолога», «Энциклопедии Арканы» книга велит перебросить — помечаем. */
function mageKnowledge(b, sec, path, seen) {
  const fx = b.effects;
  const skill = (k, n) => (fx.skills[k] = (fx.skills[k] ?? 0) + n);
  const e = b.table(sec, path, "mgKnowledge", { label: "Знание" });
  const v = e.row?.min;
  if ([3, 6].includes(v) && seen.has(`knowledge.${v}`)) {
    e.detail = "Это знание уже есть — по книге этот результат перебрасывается.";
    return e;
  }
  seen.add(`knowledge.${v}`);
  switch (v) {
    case 1: fx.definingBonus += 1; skill("hexWeaving", 1); fx.notes.push("Сведущий в порче: +1 к Магическому познанию (вписано в определяющий навык)"); break;
    case 2: fx.notes.push("Заученные формулы: 1 заклинание новичка и 1 подмастерья сверх обычного"); fx.spells.novice += 1; fx.spells.journeyman += 1; break;
    case 3: fx.notes.push("Магический биолог: ритуал «Наполнение трофея» («Том Хаоса», стр. 102)"); fx.spells.named.push("Наполнение трофея"); break;
    case 4: fx.notes.push("Зерриканская алхимия: формула зерриканского огня"); break;
    case 5: fx.notes.push("Знаки и предзнаменования: видение будущего события — решает Мастер"); break;
    case 6: fx.definingBonus += 2; fx.notes.push("Энциклопедия Арканы: +2 к Магическому познанию (вписано в определяющий навык)"); break;
    case 7: fx.notes.push("Исследования лей-линий: +2 к попыткам черпать силу лей-линии, заклинание «Обнаружение лей-линий»"); fx.spells.named.push("Обнаружение лей-линий"); break;
    case 8: fx.notes.push("Помощник учителя: обучая магов заклинаниям, вдвое меньше проверок обучения"); break;
    case 9: skill("alchemy", 1); fx.notes.push("Ученик алхимика: 2 алхимические формулы новичка"); break;
    case 10: fx.notes.push("Эксперт по предсказаниям: ритуал Гидромантии, Пиромантии, Тиромантии или Онейромантии");
      fx.spells.choice.push({ label: "Ритуал предсказания (жизненный путь)", names: ["Гидромантия", "Пиромантия", "Тиромантия", "Онейромантия"], count: 1 }); break;
  }
  return e;
}

/**
 * Жизнь в академии (стр. 21–22): одна из двух декад обучения, колонка своей школы.
 * @returns {boolean} сделали ли вас учеником
 */
function mageAcademy(b, sec, base, col, n, seen) {
  const fx = b.effects;
  const skill = (k, v) => (fx.skills[k] = (fx.skills[k] ?? 0) + v);
  const e = b.table(sec, base, "mgAcademy", { col, label: `Жизнь в академии: ${n}-я декада` });
  const v = e.row?.min;
  const note = text => fx.notes.push(text);
  // [строка][школа]: Аретуза, Бан Ард, Гвейсон Хайль, Малая академия
  switch (`${v}.${col}`) {
    case "1.0": case "1.1": case "1.2": case "1.3": fx.vigorBonus -= 1; break;
    case "2.0": case "8.2": mageAlly(b, sec, `${base}.ally`, "Союзник-маг"); break;
    case "2.1": case "2.2": e.detail = "Вас сделали учеником."; return true;
    case "2.3": note("Тёмная магия: вы носите Люцифуг демона — он всегда знает, где вы"); break;
    case "3.0": case "6.1": case "6.2": mageGrudge(b, sec, `${base}.grudge`, "Враг"); break;
    case "3.1": case "5.2": note("Свиток заклинания подмастерья — какого, решает Мастер"); break;
    case "3.2": note("Формула бомбы — какой, решает Мастер"); break;
    case "3.3": note("Цель ведьмака: вас ищет ведьмак школы Кота"); break;
    case "4.0": case "9.3": note("Заклинание новичка сверх обычного"); fx.spells.novice += 1; break;
    case "4.1": mageKnowledge(b, sec, `${base}.knowledge`, seen); break;
    case "4.2": note("Законник: +2 к репутации у властей Нильфгаарда"); break;
    case "4.3": skill("firstAid", 2); break;
    case "5.0": note("Впечатлили сановника: +2 к репутации при дворе одного королевства"); break;
    case "5.1": case "8.3": skill("monsterLore", 1); break;
    case "5.3": skill("wilderness", 2); break;
    case "6.0": note("Ритуальные компоненты на 100 крон"); break;
    case "6.3": note("Помогали местным: в своей области — социальное положение «Равенство»"); break;
    case "7.0": note("Материал для шантажа учителя: одна услуга на усмотрение Мастера"); break;
    case "7.1": {
      const n6 = b.roll(`${base}.d6`, 6, { label: "Сколько крон (1d6 × 100)", section: sec, owner: e });
      e.detail = `Получено ${n6 * 100} крон (1d6 = ${n6}).`;
      fx.crowns += n6 * 100;
      break;
    }
    case "7.2": fx.skillChoices.push({ path: `${base}.skill`, label: "Охота на мага-отступника: +1 к боевому навыку или новый боевой навык +2", combat: true }); break;
    case "7.3": case "8.1": case "10.0": note("Проклятие (корник, стр. 230) — выбирается с Мастером"); break;
    case "8.0": note("Подсказки о реликвии — какой, решает Мастер"); break;
    case "9.0":
      lifeEvent(b, sec, `${base}.ev`, "Событие в открытом мире");
      e.detail = "Вас сделали учеником.";
      return true;
    case "9.1": note("Тайное общество: +2 к репутации у выпускников Бан Арда"); break;
    case "9.2": skill("charisma", 1); skill("etiquette", 1); break;
    case "10.1": skill("langElder", 2); break;
    case "10.2": skill("disguise", 1); note("Шпионская выучка: маскировка без набора для маскировки без штрафа"); break;
    case "10.3": note("Свой фокус: амулет — предмет фокусировки (2)"); break;
  }
  return false;
}

/** Опасность десятилетия (стр. 26–27): колонка поведения. */
function mageDanger(b, sec, base, col, seen) {
  const fx = b.effects;
  const skillMod = (k, n) => (fx.skillMods[k] = (fx.skillMods[k] ?? 0) + n);
  const e = b.table(sec, base, "mgDanger", { col, label: "Что пошло не так" });
  const v = e.row?.min;
  const note = text => fx.notes.push(text);
  switch (`${v}.${col}`) {
    case "1.0": {
      const n = b.roll(`${base}.d10`, 10, { label: "Сколько долга (1d10 × 100 крон)", section: sec, owner: e });
      e.detail = `Долг: ${n * 100} крон (1d10 = ${n}).`;
      note(e.detail);
      break;
    }
    case "1.1": case "5.1": case "9.1": mageGrudge(b, sec, `${base}.grudge`, "Враг"); break;
    case "1.2": fx.hpBonus -= 2; break;
    case "1.3": note("Магическая блокировка: −2 к Сотворению заклинаний одной стихии (накопительно)"); break;
    case "2.0": fx.addictions.push(""); break;
    case "2.1": { const sub = b.sub(sec, `${base}.sub`, "mgAccuse", "В чём обвинили"); note(`Ложное обвинение: ${sub.text.toLowerCase()}`); break; }
    case "2.2": note("Встреча с демоном: вы носите Люцифуг — демон всегда знает, где вы"); break;
    case "2.3": note("Фобия чудовища: −2 к Храбрости против него, при первой встрече — Храбрость СЛ 15"); break;
    case "3.0": case "4.2": fx.staBonus -= 2; break;
    case "3.1": note("Предательство: друг стал врагом"); break;
    case "3.2": note("Признаны опасным: в одном королевстве вас разыскивают власти"); break;
    case "3.3": note("Перегрузка с Места силы: каждое Место силы — испытание Вын, как при втором заборе"); break;
    case "4.0": note("Разгневанные горожане: в одном крупном городе вас считают угрозой"); break;
    case "4.1": note("Друг или любовник убит"); break;
    case "4.3": note("Вас преследует голем могущественного мага"); break;
    case "5.0": {
      const sub = b.sub(sec, `${base}.sub`, "misfortune.8", "Подробности");
      if (sub.value <= 4) fx.feared = true;
      else if (sub.value <= 8) sub.detail = `${b.roll(`${base}.months`, 10, { label: "Сколько месяцев", section: sec, owner: sub })} мес.`;
      break;
    }
    case "5.2": fx.feared = true; break;
    case "5.3": note("Громкая телепатия: цель слежки замечает вас Вниманием СЛ 15"); break;
    case "6.0": e.detail = `В тюрьме ${b.roll(`${base}.d10`, 10, { label: "Сколько месяцев в тюрьме", section: sec, owner: e })} мес.`; break;
    case "6.1": note("Социальная оплошность: маги относятся к вам как к «Терпимому»"); break;
    case "6.2": note("Магическая аллергия: зелья и эликсиры вызывают тошноту на время действия"); break;
    case "6.3": skillMod("etiquette", -2); break;
    case "7.0": note("Наставник скончался"); break;
    case "7.1": {
      const n = b.roll(`${base}.d6`, 6, { label: "Сколько охотников за головами (1d6 + 5)", section: sec, owner: e });
      e.detail = `Вас ищут ${n + 5} охотников за головами (1d6 = ${n}).`;
      note(e.detail);
      break;
    }
    case "7.2": note("Опьянение: выпив зелье или эликсир — Тел против СЛ (Тел + 1d10), иначе опьянение"); break;
    case "7.3": note("Экстремальная уязвимость: −3 к Стойкости против двимерита"); break;
    case "8.0": note("Выпадение волос: волосы больше не растут"); break;
    case "8.1": note("Враг государства: в одной стране — «Ненависть»"); break;
    case "8.2": fx.addictions.push("Эликсиры"); break;
    case "8.3": note("Телепортационная болезнь: после портала Стойкость СЛ 12, иначе тошнота на 10 минут"); break;
    case "9.0": note("Артрит: −1 к Сотворению заклинаний с движением рук"); break;
    case "9.2": note("Потеряли вкус, обоняние или осязание: −2 к проверкам по этому чувству"); break;
    case "9.3": note("Вас разыскивают охотники на колдуний (или на магов)"); break;
    case "10.0": note("Порча (корник, стр. 105 и 120) — ещё не снята, выбирается с Мастером"); break;
    case "10.1": note("На службе у дворянина: 100 крон в месяц, по зову — немедленно"); break;
    case "10.2": note("Малая мутация мутагена на выбор: облик и социальное положение"); break;
    case "10.3": note("Проклятие (корник, стр. 230) — выбирается с Мастером"); break;
  }
  return e;
}

/** Выгода десятилетия (стр. 29). */
function mageBenefit(b, sec, base, seen) {
  const fx = b.effects;
  const e = b.table(sec, base, "mgBenefit", { label: "Выгода" });
  const v = e.row?.min;
  if (v === 10 && seen.has("benefit.10")) {
    e.detail = "Это преимущество уже есть — по книге этот результат перебрасывается.";
    return e;
  }
  seen.add(`benefit.${v}`);
  switch (v) {
    case 1: fx.notes.push("Союзник-маг: ваш ученик"); break;
    case 2: fx.notes.push("Своё сообщество: в той области к вам относятся как к Равным"); break;
    case 3: fx.notes.push("Вам должны 600 крон — можно взыскать в любой момент"); break;
    case 4: fx.notes.push("Фамильяр: обученное животное (кошка, собака, птица или змея)"); break;
    case 5: b.sub(sec, `${base}.sub`, "mgLove", "Сколько длился роман"); break;
    case 6: { const sub = b.sub(sec, `${base}.sub`, "mgTrophy", "Трофей"); fx.items.push(sub.text); break; }
    case 7: {
      const act = b.plain(sec, `${base}.portal`, "Портал активен?", x => (x % 2 === 0 ? "Портал всё ещё активен" : "Портал не действует"),
        { options: EVEN_OPTIONS("активен", "не действует") });
      if (act.value % 2 === 0) {
        const dest = b.sub(sec, `${base}.sub`, "mgPortal", "Куда ведёт портал");
        fx.notes.push(`Активный эльфийский портал: ${dest.text.toLowerCase()}`);
      } else fx.notes.push("Заброшенный эльфийский портал");
      break;
    }
    case 8: fx.skills.resistMagic = (fx.skills.resistMagic ?? 0) + 1; break;
    case 9: fx.notes.push("Место силы: 5 единиц Пятой сущности"); break;
    case 10: fx.notes.push("Колдовство в доспехах: −1 к общему СД доспехов для заклинаний"); break;
  }
  return e;
}

function buildMage(b, { age = 25, gender = "" }) {
  const fx = b.effects;
  const seen = new Set();

  // Детство: где родились, семья, как открылся дар и как на него отреагировали
  const kid = b.section("Детство");
  const birth = b.table(kid, "mage.birth", "mgBirth", { label: "Где вы родились" });
  const regionCol = mageRegionCol(birth.value);
  T.mgFamily.cols.forEach((l, c) => b.table(kid, `mage.family.${c}`, "mgFamily", { col: c, label: l }));
  const disc = b.table(kid, "mage.discovery", "mgDiscovery", { label: "Как открылся дар" });
  // «Вычтите N из вашего следующего броска» — следующий бросок — реакция на магию (1d6); ниже 1 — первая строка
  const dv = disc.row?.min;
  const mod = dv === 1 || dv === 10 ? -3 : dv === 2 || dv === 9 ? -2 : 0;
  const react = b.table(kid, "mage.reaction", "mgReaction", { col: regionCol, sides: 6, mod, label: "Как люди реагировали на вашу магию" });
  if (mod) react.detail = `Бросок ${react.value} − ${Math.abs(mod)} = ${react.shown}`;

  // Школа — без броска: по месту рождения и полу, игрок может выбрать другую («Вдали от дома», стр. 20).
  // Подсказка не хранится среди бросков — иначе смена пола или «переброс» оставляли бы прежнюю школу
  const sch = b.section("Школа магии");
  const chosen = "mage.school" in b.rolls;
  if (!chosen) b.rolls["mage.school"] = mageDefaultSchool(birth.value, gender);
  const school = b.table(sch, "mage.school", "mgSchool", { sides: 4, label: "Школа" });
  if (!chosen) { delete b.rolls["mage.school"]; school.detail = "По месту рождения и полу — можно выбрать другую."; }
  const col = Math.max(0, Math.min(3, (school.row?.min ?? 4) - 1));
  const perk = cellOf(T.mgPerk.rows[col]);
  sch.entries.push({ label: "Дар школы", title: perk.title, text: perk.text, static: true });
  fx.notes.push(`${perk.title}: ${perk.text}`);
  // Обучение — около 20 лет, две декады
  let apprentice = false;
  for (let n = 0; n < 2; n++) apprentice = mageAcademy(b, sch, `mage.acad.${n}`, col, n + 1, seen) || apprentice;

  const ap = b.section("Ученичество");
  if (apprentice) ap.entries.push({ label: "Вы были учеником?", text: "Да — вас сделали учеником в академии.", static: true });
  else apprentice = b.table(ap, "mage.appr", "mgApprentice", { col, sides: 6, label: "Вы были учеником?" }).text === "Да";
  if (apprentice) {
    T.mgMentor.cols.forEach((l, c) => b.table(ap, `mage.mentor.${c}`, "mgMentor", { col: c, label: `Наставник: ${l.toLowerCase()}` }));
    b.table(ap, "mage.teach", "mgTeach", { sides: 6, label: "Стиль преподавания" });
    b.table(ap, "mage.moment", "mgMoment", { label: "Самый запоминающийся момент" });
    b.table(ap, "mage.mentorEnd", "mgMentorEnd", { label: "Как вы расстались" });
    fx.notes.push("Привязь к наставнику: в 10 м друг от друга оба мага творят известное обоим («Том Хаоса», стр. 23)");
  }

  // Жизнь мага: за каждое десятилетие после 20 лет — поведение, опасность (d100) и событие
  const decades = Math.max(0, Math.floor(((Number(age) || 0) - 20) / 10));
  for (let i = 0; i < decades; i++) {
    const base = `decade.${i}`;
    const sec = b.section(`Десятилетие ${i + 1} (${20 + i * 10}–${30 + i * 10} лет)`);
    sec.decade = i;
    const key = MAGE_BEHAVIOR[b.rolls[`${base}.risk`]] ? b.rolls[`${base}.risk`] : "careful";
    const beh = MAGE_BEHAVIOR[key];
    sec.risk = key;
    const danger = b.plain(sec, `${base}.danger`, "Опасность (d100)",
      v => (v <= beh.danger ? `Что-то пошло не так (${v} ≤ ${beh.danger}%)` : `Обошлось (${v} > ${beh.danger}%)`),
      { sides: 100, options: THRESHOLD_OPTIONS(beh.danger, "что-то пошло не так", "обошлось") });
    if (danger.value <= beh.danger) mageDanger(b, sec, `${base}.trouble`, beh.col, seen);
    const outcomeOf = v => beh.outcome.find(([a, c]) => v >= a && v <= c)?.[2] ?? "nothing";
    const outcomeRoll = b.plain(sec, `${base}.outcome`, "Что пошло правильно", v => MAGE_OUTCOMES[outcomeOf(v)]);
    const outcome = outcomeOf(outcomeRoll.value);
    if (outcome === "benefit") mageBenefit(b, sec, `${base}.benefit`, seen);
    else if (outcome === "ally") mageAlly(b, sec, `${base}.ally`);
    else if (outcome === "knowledge") mageKnowledge(b, sec, `${base}.knowledge`, seen);
  }
  if (!decades) b.section("Жизнь мага").entries.push({ label: "Десятилетия", text: "Магу меньше 30 лет — он только окончил обучение.", static: true });

  styleAndValues(b);
}

/* ------------------------------------------------------------------------- */
/*  Хранение в персонаже, переброс и показ карточками — общее для мастера      */
/*  создания и «Дневника»                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Жизненный путь персонажа — JSON в `system.lifepath`: броски и то, от чего они зависят.
 * В строке, а не в объекте: пути бросков содержат точки («event.0.kind»), а Foundry при обновлении
 * разворачивает такие ключи во вложенные объекты.
 * notes — свои описания событий: путь → {was: текст книги, к которому писали, text: своё}.
 * @returns {{rolls: object, witcher: boolean, age: number, region: string, race: string, notes?: object}|null}
 */
export function readLifepath(json) {
  try {
    const data = JSON.parse(json || "null");
    return data?.rolls && typeof data.rolls === "object" ? data : null;
  } catch {
    return null;
  }
}

export function writeLifepath({ rolls, witcher = false, age = 25, region = "north", race = "human", kind = "", gender = "", notes = null }) {
  const data = { rolls, witcher, age, region, race, kind, gender };
  if (notes && Object.keys(notes).length) data.notes = notes;
  return JSON.stringify(data);
}

/** Параметры сборки из сохранённого жизненного пути. */
export function savedOpts(data) {
  return { witcher: !!data.witcher, age: data.age, region: data.region, race: data.race, kind: data.kind || "", gender: data.gender || "",
    notes: data.notes ?? null };
}

/** Собрать сохранённый жизненный путь пошагово: недостающие броски не делаются, `next` — следующий. */
export function buildFromSaved(data) {
  return buildLifepath(data.rolls, { ...savedOpts(data), step: true });
}

/** Переброс: убрать бросок и всё, что от него зависит (новые значения бросит сборка). */
export function rerollPath(rolls, path) {
  delete rolls[path];
  for (const d of dependents(path)) clearRoll(rolls, d);
}

/** Выбор результата из списка: значение строки таблицы минус поправка броска. */
export function choosePath(rolls, path, value, mod = 0) {
  rerollPath(rolls, path);
  rolls[path] = Number(value) - (Number(mod) || 0);
}

/** Смена поведения ведьмака в десятилетии: всё десятилетие бросается заново. */
export function setDecadeRisk(rolls, decade, risk) {
  for (const key of Object.keys(rolls)) if (key.startsWith(`decade.${decade}.`)) delete rolls[key];
  rolls[`decade.${decade}.risk`] = risk;
}

/** Какой пункт списка выбран для строки. */
function selectedOption(e) {
  if (!e.options) return e.value;
  if (e.mod) return e.row?.min ?? e.shown;
  // Чёт/нечет: 2 — чёт, 1 — нечет
  if (e.options.length === 2 && e.options[0].value === 2) return e.value % 2 === 0 ? 2 : 1;
  const opt = [...e.options].reverse().find(o => e.value >= o.value);
  return opt?.value ?? e.value;
}

/**
 * Строка для шаблона: текст результата и, если можно править, кость, список и перо своего описания.
 * Своё описание показывается вместо текста книги; книжный — подсказкой.
 */
function entryView(e, { editable, action, noteAction }, label = e.label) {
  const view = { label, title: e.title ?? "", text: e.text ?? "", detail: e.detail ?? "", static: !!e.static || !e.path };
  if (e.note) Object.assign(view, { note: e.note, original: resultText(e) });
  if (editable && e.path) {
    const picked = selectedOption(e);
    Object.assign(view, {
      editable: true, action, noteAction, path: e.path, value: e.value, sides: e.sides ?? 10, mod: e.mod ?? 0,
      options: e.options?.map(o => ({ ...o, selected: o.value === picked })) ?? null
    });
  }
  return view;
}

const SIBLING_COLS = ["Пол", "Возраст", "Отношение", "Черта"];

/** Следующий бросок можно не бросать, а выбрать: путь, поправка и варианты для списка (если бросать можно). */
function pendingChoice(e, nextAction) {
  return nextAction && e.options?.length ? { path: e.path, mod: e.mod ?? 0, options: e.options } : {};
}

/**
 * Разделы жизненного пути → карточки для показа:
 * семья — строками, братья и сёстры — таблицей, события — карточкой на каждое десятилетие,
 * стиль и ценности — сеткой, десятилетия ведьмака — каждое своей карточкой.
 * Следующий бросок (пошаговый режим) — строкой с кнопкой в конце своей карточки.
 * @param {object[]} sections — из buildLifepath
 * @param {object} [opts] — editable: показать кости и списки; action — data-action переброса;
 *   nextAction — data-action следующего броска (null — бросать нельзя); sectionAction — «Бросить раздел»;
 *   noteAction — data-action своего описания строки (null — без пера)
 */
export function lifepathCards(sections, {
  editable = false, action = "reroll", nextAction = "lifepathStep", sectionAction = "lifepathSection", noteAction = null
} = {}) {
  const ctx = { editable, action, noteAction };
  // «20 лет: событие» → «Событие»: год уже в заголовке карточки
  const short = label => label.replace(/^\d+ лет:\s*/, "").replace(/^./, c => c.toUpperCase());
  const pendingOf = entries => {
    const e = entries.find(x => x.pending);
    return e ? {
      label: short(e.label), sides: e.sides, cardTitle: e.cardTitle ?? "",
      action: nextAction, sectionAction: nextAction ? sectionAction : null, ...pendingChoice(e, nextAction)
    } : null;
  };
  const cards = [];
  for (const sec of sections) {
    const done = sec.entries.filter(e => !e.pending);
    if (sec.title === "Братья и сёстры") {
      const rows = done.filter(e => e.group === undefined).map(e => entryView(e, ctx));
      const byGroup = new Map();
      for (const e of done.filter(x => x.group !== undefined)) {
        if (!byGroup.has(e.group)) byGroup.set(e.group, []);
        byGroup.get(e.group).push(entryView(e, ctx, ""));
      }
      cards.push({ title: sec.title, rows, pending: pendingOf(sec.entries),
        table: byGroup.size ? { cols: SIBLING_COLS, rows: [...byGroup.entries()].map(([i, cells]) => ({ n: i + 1, cells })) } : null });
      continue;
    }
    if (sec.title === "Важные события") {
      const byDecade = new Map();
      for (const e of sec.entries) {
        const key = e.path?.match(/^event\.(\d+)/)?.[1] ?? "none";
        if (!byDecade.has(key)) byDecade.set(key, []);
        byDecade.get(key).push(e);
      }
      for (const [i, list] of byDecade) {
        const rows = list.filter(e => !e.pending).map(e => entryView(e, ctx, short(e.label)));
        const pending = pendingOf(list);
        cards.push(i === "none"
          ? { title: sec.title, rows, pending }
          : { title: `${(Number(i) + 1) * 10} лет`, subtitle: "важное событие", cls: "event", rows, pending });
      }
      continue;
    }
    const grid = sec.title === "Личный стиль" || sec.title === "Ценности" || sec.title === "Характер";
    const icon = { "Семья": "fa-house-chimney", "Личный стиль": "fa-shirt", "Ценности": "fa-scale-balanced",
      "Школа и испытания": "fa-flask", "Жизнь ведьмака": "fa-road",
      "Клан и юность": "fa-chess-rook", "События жизни": "fa-hourglass-half", "Увлечение, кровь и роль": "fa-droplet",
      "Характер": "fa-masks-theater", "Чужие края": "fa-sun", "Детство": "fa-child", "Школа магии": "fa-hat-wizard",
      "Ученичество": "fa-user-graduate", "Жизнь мага": "fa-hourglass-half" }[sec.title] ?? (sec.risk ? "fa-hourglass-half" : "fa-scroll");
    cards.push({
      title: sec.title, icon, grid, cls: sec.risk ? "event" : grid ? "grid" : "",
      subtitle: sec.risk ? riskOf(sec.risk)?.label ?? "" : "",
      decade: sec.decade ?? null,
      // Поведение ведьмака выбирают в правке и пока десятилетие бросается: от него шанс опасности
      riskOptions: sec.risk && (editable || (nextAction && sec.entries.some(e => e.pending)))
        ? Object.entries(MAGE_BEHAVIOR[sec.risk] ? MAGE_BEHAVIOR : WITCHER_RISK).map(([k, v]) => ({ key: k, label: v.label, selected: k === sec.risk })) : null,
      rows: done.map(e => entryView(e, ctx)),
      pending: pendingOf(sec.entries)
    });
  }
  return cards;
}

/* ------------------------------------------------------------------------- */
/*  Летопись: жизненный путь для чтения в «Дневнике»                          */
/* ------------------------------------------------------------------------- */

/** Броски-развилки: их смысл виден по следующей строке («Удача или неудача» → сама удача). */
const STRUCTURAL = /\.(kind|luck|side|danger|dangerKind|outcome)$/;

/** Что за запись в событии десятилетия — по пути броска после «event.N.» / «decade.N.». */
const FACETS = {
  fortune: "Удача", misfortune: "Неудача", love: "Любовь", tragedy: "Любовь", problem: "Любовь",
  ally: "Союзник", enemy: "Враг", event: "Беда", wound: "Рана", benefit: "Выгода", hunt: "Охота",
  trouble: "Беда", knowledge: "Знание"
};

/** Разделы летописи «фактами»: заголовок блока и главные строки (крупно). */
const FACT_SECTIONS = {
  "Семья": { title: "Происхождение", featured: ["familyStatus", "friend", "ofir.status", "ofir.friend"] },
  "Чужие края": { title: "Чужие края", featured: ["ofir.region"] },
  "Школа и испытания": { title: "Школа и испытания", featured: ["wSchool"] },
  "Жизнь ведьмака": { title: "Жизнь ведьмака", featured: ["wSituation"] },
  "Детство": { title: "Детство", featured: ["mage.birth", "mage.discovery"] },
  "Школа магии": { title: "Школа магии", featured: ["mage.school"] },
  "Ученичество": { title: "Ученичество", featured: [] },
  "Жизнь мага": { title: "Жизнь мага", featured: [] }
};

const LONG = 70;
const lowerFirst = t => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const GENDER = { "Мужской": "мужчина", "Женский": "женщина" };

/** Длинный текст строки — заголовок (первое предложение) и остальное. */
function splitText(text = "") {
  if (text.length <= LONG) return { head: text, body: "" };
  const m = text.match(/^.{15,}?[.!?](?=\s|$)/);
  return m && m[0].length < text.length ? { head: m[0], body: text.slice(m[0].length).trim() } : { head: text, body: "" };
}

/** Подпись без механики броска: «Жив ли враг (d100)» → «Жив ли враг». */
const plainLabel = label => String(label ?? "").replace(/\s*\(d\d+\)/, "");

/** Строка для чтения: подпись, заголовок, пояснение, подробность. */
function fact(e, label = plainLabel(e.label)) {
  if (e.note) return { label, ...splitText(e.note), detail: e.detail ?? "" };
  if (e.title) return { label, head: e.title, body: e.text, detail: e.detail ?? "" };
  return { label, ...splitText(e.text), detail: e.detail ?? "" };
}

/** Строкой в абзаце: заголовок и пояснение подряд — после заголовка точка. */
function inlineFact(e) {
  const f = fact(e);
  if (f.body && !/[.!?…]$/.test(f.head)) f.head += ".";
  return f;
}

/** Записи десятилетия: соседние строки одного рода (союзник, враг, охота…) — одной записью. */
function facetsOf(entries, base) {
  const facets = [];
  let cur = null;
  for (const e of entries) {
    // Развилки не видны, если их не переписали своими словами
    if (STRUCTURAL.test(e.path ?? "") && !e.note) continue;
    const kind = (e.path ?? "").slice(base.length + 1).split(".")[0];
    const title = FACETS[kind] ?? "";
    if (!cur || cur.title !== title) facets.push(cur = { title, entries: [] });
    cur.entries.push(e);
  }
  return facets.map(({ title, entries }) => {
    // Главная строка: «кто» у союзника и врага, цель у охоты, иначе первая
    const lead = entries.find(e => /: кто$/.test(e.label)) ?? entries.find(e => /\.hunt\.target$/.test(e.path)) ?? entries[0];
    const main = fact(lead);
    const gender = entries.find(e => e !== lead && /: пол$/.test(e.label));
    if (gender) main.head += ` (${gender.note || GENDER[gender.text] || lowerFirst(gender.text)})`;
    const meta = [], notes = [];
    if (main.body) notes.push(main.body);
    if (main.detail) notes.push(main.detail);
    const prefix = new RegExp(`^${title}:\\s*`, "i");
    for (const e of entries) {
      if (e === lead || e === gender) continue;
      const value = e.note || e.title || e.text;
      const k = lowerFirst(plainLabel(e.label).replace(prefix, ""));
      if (value.length > LONG) notes.push(e.note || resultText(e));
      else meta.push({ k, v: e.note || lowerFirst(value) });
      if (e.detail) notes.push(e.detail);
    }
    return { title, head: main.head, meta, notes };
  });
}

/**
 * Жизненный путь для чтения — «летописью»: происхождение, братья и сёстры, хроника по десятилетиям
 * на линии времени, облик и нрав. Служебные броски-развилки не показываются, строки одного события
 * собраны в одну запись. Правка — прежними карточками (lifepathCards).
 * @param {object[]} sections — из buildLifepath
 * @param {object} [opts] — nextAction / sectionAction: data-action следующего броска и раздела (null — бросать нельзя)
 */
export function lifepathStory(sections, { nextAction = null, sectionAction = null } = {}) {
  const blocks = [];
  const chronicle = [];
  const traits = [];
  let pending = null;
  for (const sec of sections) {
    const pend = sec.entries.find(e => e.pending);
    if (pend && nextAction) pending = { label: pend.label, sides: pend.sides, cardTitle: pend.cardTitle ?? sec.title, action: nextAction, sectionAction,
      ...pendingChoice(pend, nextAction) };
    const done = sec.entries.filter(e => !e.pending);
    const has = path => done.some(e => e.path === path);

    const factSec = FACT_SECTIONS[sec.title];
    if (factSec) {
      // Развилка «с семьёй что-то случилось» не нужна, если следом сказано, что именно (и её не переписали)
      const rows = done.filter(e => e.note || (!(e.path === "family" && has("familyFate")) && !(e.path === "parents" && has("parentsFate"))
        && !(e.path === "ofir.family" && has("ofir.familyFate")) && !(e.path === "ofir.parents" && has("ofir.parentsFate"))));
      const featured = rows.filter(e => factSec.featured.includes(e.path)).map(e => fact(e));
      const facts = rows.filter(e => !factSec.featured.includes(e.path)).map(inlineFact);
      if (featured.length || facts.length) blocks.push({ kind: "facts", title: factSec.title, featured, facts });
      continue;
    }
    // Высший вампир: клан и юность, увлечение и роль — фактами; события — хроникой; характер — нравом
    if (sec.title === "Клан и юность" || sec.title === "Увлечение, кровь и роль") {
      const featuredPaths = sec.title === "Клан и юность" ? ["vClan", "vAge"] : ["vRole"];
      const featured = done.filter(e => featuredPaths.includes(e.path)).map(e => fact(e));
      const facts = done.filter(e => !featuredPaths.includes(e.path)).map(inlineFact);
      if (featured.length || facts.length) blocks.push({ kind: "facts", title: sec.title === "Клан и юность" ? "Происхождение" : "Увлечение и роль", featured, facts });
      continue;
    }
    if (sec.title === "События жизни") {
      done.filter(e => /^vEvent\.\d+$/.test(e.path)).forEach((e, i) => {
        const f = fact(e, "");
        const fame = done.find(x => x.path === `${e.path}.fame`);
        chronicle.push({ age: `${i + 1}`, unit: "событие",
          facets: [{ title: "", head: f.head, meta: [], notes: [f.body, fame?.note || fame?.text].filter(Boolean) }] });
      });
      continue;
    }
    if (sec.title === "Характер") {
      traits.push({ title: "Нрав", items: done.map(e => ({ k: e.label, v: e.note || e.title || e.text })) });
      continue;
    }
    if (sec.title === "Братья и сёстры") {
      const count = done.find(e => e.path === "siblingsCount" || e.path === "ofir.sibCount");
      const byGroup = new Map();
      for (const e of done.filter(x => x.group !== undefined)) {
        if (!byGroup.has(e.group)) byGroup.set(e.group, []);
        byGroup.get(e.group)[Number(e.path.split(".").pop())] = e;
      }
      // Своё описание — как написано; текст книги — со строчной, как продолжение строки
      const shown = e => e && (e.note || lowerFirst(e.title || e.text));
      const people = [...byGroup.values()].map(([gender, age, attitude, trait]) => {
        const g = gender?.title || gender?.text;
        return {
          icon: g === "Женский" ? "fa-venus" : g === "Мужской" ? "fa-mars" : "fa-user",
          who: gender?.note || (g === "Женский" ? "Сестра" : g === "Мужской" ? "Брат" : "Брат или сестра"),
          meta: [shown(age), shown(attitude), shown(trait)].filter(Boolean)
        };
      });
      blocks.push({ kind: "siblings", title: "Братья и сёстры", subtitle: count ? count.note || count.text : "", people });
      continue;
    }
    if (sec.title === "Важные события") {
      const byDecade = new Map();
      for (const e of done) {
        const i = e.path?.match(/^event\.(\d+)/)?.[1];
        if (i === undefined) continue;
        if (!byDecade.has(i)) byDecade.set(i, []);
        byDecade.get(i).push(e);
      }
      for (const [i, entries] of byDecade) {
        const facets = facetsOf(entries, `event.${i}`);
        if (facets.length) chronicle.push({ age: `${(Number(i) + 1) * 10}`, unit: "лет", facets });
      }
      const none = done.find(e => e.static);
      if (none && !byDecade.size) chronicle.push({ age: "—", facets: [{ title: "", head: none.text, meta: [], notes: [], quiet: true }] });
      continue;
    }
    if (sec.risk) {
      // Десятилетие ведьмака: возраст «22–32», поведение — подписью
      const years = sec.title.match(/\((\d+)–(\d+)/);
      let facets = facetsOf(done, `decade.${sec.decade}`);
      const rolledOutcome = done.some(e => /\.outcome$/.test(e.path));
      if (!facets.length && rolledOutcome) facets = [{ title: "", head: "Спокойное десятилетие", meta: [], notes: [], quiet: true }];
      if (!facets.length) continue;
      const risk = riskOf(sec.risk)?.label ?? "";
      const era = { from: years?.[1], to: years?.[2], unit: "лет", hint: `Поведение: ${risk}`,
        sub: sec.risk === "normal" ? "" : risk, quiet: facets.length === 1 && facets[0].quiet, risk: sec.risk, facets };
      // Спокойные десятилетия подряд с тем же поведением — одной записью: «23–53»
      const last = chronicle.at(-1);
      if (era.quiet && last?.quiet && last.risk === era.risk && last.to === era.from) {
        last.to = era.to;
        last.facets[0].head = "Спокойные десятилетия";
      } else chronicle.push(era);
      continue;
    }
    if (sec.title === "Личный стиль" || sec.title === "Ценности") {
      traits.push({ title: sec.title === "Личный стиль" ? "Облик" : "Ценности",
        items: done.map(e => ({ k: e.label, v: e.note || e.title || e.text })) });
    }
  }
  for (const era of chronicle) if (era.from) era.age = `${era.from}–${era.to}`;
  if (chronicle.length) blocks.push({ kind: "chronicle", title: "Хроника", eras: chronicle });
  if (traits.length) blocks.push({ kind: "traits", title: "Облик и нрав", groups: traits });
  return { blocks, pending };
}

/** Итоги жизненного пути словами: деньги, предметы, заметки (механику мастер применил при создании). */
export function lifepathSummary(fx) {
  if (!fx) return [];
  const lines = [];
  if (fx.crowns) lines.push(`+${fx.crowns} крон`);
  if (fx.reputation) lines.push(`+${fx.reputation} к репутации`);
  if (fx.luck) lines.push(`+${fx.luck} к Удаче`);
  if (fx.hpBonus) lines.push(`${fx.hpBonus} ПЗ навсегда`);
  if (fx.staBonus) lines.push(`${fx.staBonus} Вын навсегда`);
  if (fx.vigorBonus) lines.push(`${fx.vigorBonus} к Энергии`);
  if (fx.feared) lines.push("Социальный статус: опасение");
  if (fx.addictions?.length) lines.push(`Зависимость (${fx.addictions.length})`);
  for (const i of fx.items ?? []) lines.push(`Предмет: ${i}`);
  for (const n of fx.notes ?? []) lines.push(n);
  return lines;
}

/* ------------------------------------------------------------------------- */
/*  Бросок за броском: каждый — в чат                                         */
/* ------------------------------------------------------------------------- */

function firstSentence(text = "") {
  const m = text.match(/^.{20,}?[.!?](?=\s|$)/);
  return m && m[0].length < text.length ? `${m[0]} …` : text;
}

function stepRow(next, value, lp) {
  return { ...next, value, ...lp.resultOf(next.path) };
}

/**
 * Сделать следующий бросок жизненного пути (настоящий бросок Foundry — его видно в чате и в Dice So Nice).
 * @param {object} rolls — словарь бросков, дописывается
 * @param {object} opts — как у buildLifepath
 * @returns {Promise<{lp, roll: Roll, rows: object[]}|null>} null — бросать нечего
 */
export async function rollLifepathStep(rolls, opts) {
  const { next } = buildLifepath(rolls, { ...opts, step: true });
  if (!next) return null;
  const roll = await new Roll(`1d${next.sides}`).evaluate();
  rolls[next.path] = roll.total;
  const lp = buildLifepath(rolls, { ...opts, step: true });
  return { lp, roll, rows: [stepRow(next, roll.total, lp)] };
}

/**
 * Бросить раздел — все броски текущей карточки (семья, десятилетие, стиль…) по одному.
 * @param {Function} [onRoll] — после каждого броска (карточка в чат, показ на листе)
 * @returns {Promise<object[]>} результаты rollLifepathStep
 */
export async function rollLifepathSection(rolls, opts, onRoll = null) {
  const card = buildLifepath(rolls, { ...opts, step: true }).next?.card;
  const done = [];
  if (!card) return done;
  for (let i = 0; i < 200; i++) {
    const { next } = buildLifepath(rolls, { ...opts, step: true });
    if (!next || next.card !== card) break;
    const res = await rollLifepathStep(rolls, opts);
    done.push(res);
    await onRoll?.(res);
  }
  return done;
}

/** Добросить всё, что осталось, — по порядку, как при пошаговом броске. */
export function rollLifepathRest(rolls, opts) {
  const done = [];
  // Предел — на случай ошибки в таблицах: путь ведьмака в 260 лет — около 400 бросков
  for (let i = 0; i < 1000; i++) {
    const { next } = buildLifepath(rolls, { ...opts, step: true });
    if (!next) break;
    rolls[next.path] = rollDie(next.sides);
    done.push(next);
  }
  const lp = buildLifepath(rolls, { ...opts, step: true });
  return { lp, rows: done.map(n => stepRow(n, rolls[n.path], lp)) };
}

/**
 * Броски жизненного пути — карточкой в чат: по разделам, у каждого броска кость, подпись и что выпало.
 * @param {Actor} actor
 * @param {object[]} rows — из rollLifepathStep / rollLifepathRest
 * @param {object} [opts] — roll: бросок Foundry (для одного броска), name: имя персонажа в подзаголовке
 */
export async function postLifepathRolls(actor, rows, { roll = null, name = "" } = {}) {
  if (!rows.length) return null;
  // Много бросков разом — коротко: заголовок строки или первое предложение; полный текст — в «Дневнике»
  const brief = rows.length > 1;
  const groups = [];
  for (let r of rows) {
    if (brief) r = { ...r, text: r.title ? "" : firstSentence(r.text) };
    const last = groups.at(-1);
    if (last?.section === r.section) last.rows.push(r);
    else groups.push({ section: r.section, rows: [r] });
  }
  const content = await renderTemplate("systems/vedmak/templates/chat/lifepath.hbs", {
    title: brief ? `Жизненный путь — ${rows.length} ${plural(rows.length, "бросок", "броска", "бросков")}` : "Жизненный путь",
    subtitle: name || actor?.name || "", groups
  });
  // Режим чата (скрытый бросок, только ведущему) v14 применяет лишь по явной опции
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content, rolls: roll ? [roll] : [] },
    { messageMode: game.settings.get("core", "messageMode") });
}
