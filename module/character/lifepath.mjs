// Жизненный путь (корник стр. 25–36) и жизненный путь ведьмака (стр. 238–245).
//
// Все броски хранятся в плоском словаре `rolls` (путь → число). Функция `buildLifepath` по нему
// строит разделы с результатами и собирает механические последствия (кроны, навыки, предметы…).
// Недостающие броски делаются на лету, поэтому переброс одного результата пересобирает только
// зависящие от него строки. В пошаговом режиме (`step`) сборка останавливается на первом
// недостающем броске и сообщает, какой бросок следующий: так путь бросается по одному броску,
// и каждый уходит в чат (`rollLifepathStep`).

import { LIFEPATH_TABLES as T } from "../config/lifepath-tables.mjs";
import { SKILLS } from "../config/skills.mjs";
import { renderTemplate } from "../util.mjs";

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
  "allyWhere": [[1, 3, "Королевства Севера"], [4, 6, "Империя Нильфгаард"], [7, 9, "Земли Старших Народов"], [10, 10, "За пределами"]]
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
      school: ""
    };
  }

  /**
   * Значение броска: сохранённое или новое. В пошаговом режиме недостающий бросок не делается:
   * в раздел ставится строка-заглушка, и сборка останавливается.
   */
  roll(path, sides = 10, { label = "", section = null, owner = null } = {}) {
    if (owner) this.owners[path] = owner;
    if (!(path in this.rolls)) {
      if (this.step) {
        this.next = { path, sides, label, section: section?.title ?? "" };
        section?.entries.push({ path, label, sides, pending: true, text: "" });
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
    const raw = this.roll(path, sides, { label, section });
    const value = Math.max(1, Math.min(10, raw + mod));
    const row = lookup(tableKey, value);
    const cell = cellOf(row, col);
    const entry = {
      path, label, value: raw, shown: value, mod, sides,
      options: tableOptions(tableKey, col), title: cell.title, text: cell.text, row
    };
    section.entries.push(entry);
    return entry;
  }

  /** Строка по подтаблице из текста. */
  sub(section, path, key, label) {
    const value = this.roll(path, 10, { label, section });
    const entry = { path, label, value, sides: 10, options: subOptions(key), title: "", text: subLookup(key, value), sub: true };
    section.entries.push(entry);
    return entry;
  }

  /** Строка «чёт/нечет» или произвольный бросок без таблицы. */
  plain(section, path, label, text, { sides = 10, options = null } = {}) {
    const value = this.roll(path, sides, { label, section });
    const describe = v => (typeof text === "function" ? text(v) : text);
    if (!options && sides <= 10) options = Array.from({ length: sides }, (_, i) => ({ value: i + 1, label: `${i + 1}: ${describe(i + 1)}`.slice(0, 90) }));
    const entry = { path, label, value, sides, options, title: "", text: describe(value), sub: true };
    section.entries.push(entry);
    return entry;
  }
}

const EVEN_OPTIONS = (even, odd) => [{ value: 2, label: `Чёт: ${even}` }, { value: 1, label: `Нечет: ${odd}` }];

/** Бонусы предметов положения семьи (стр. 28). */
function familyStatusEffects(entry, fx) {
  const text = entry.text;
  const m = text.match(/Начальное снаряжение:\s*(.+)$/);
  const gear = m?.[1] ?? "";
  if (/дворянская грамота/.test(gear)) { fx.items.push("Дворянская грамота"); fx.reputation += 2; }
  if (/летопись/.test(gear)) { fx.items.push("Летопись"); fx.skills.education = (fx.skills.education ?? 0) + 1; }
  if (/священный символ/.test(gear)) { fx.items.push("Священный символ"); fx.skills.courage = (fx.skills.courage ?? 0) + 1; }
  if (/личный герб/.test(gear)) { fx.items.push("Личный герб"); fx.reputation += 1; }
  if (/2 знакомых/.test(gear)) fx.notes.push("Положение семьи: 2 знакомых");
  if (/чертежа\/формулы/.test(gear)) fx.notes.push("Положение семьи: 3 обычных чертежа или формулы на выбор");
  if (/музыкальный инструмент/.test(gear)) { fx.items.push("Музыкальный инструмент"); fx.notes.push("Положение семьи: 1 друг"); }
  if (/птица или змея/.test(gear)) fx.notes.push("Положение семьи: обученная птица или змея");
  if (/счастливый талисман/.test(gear)) { fx.items.push("Счастливый талисман"); fx.luck += 1; }
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

  // Важные события — за каждые полные 10 лет
  const ev = b.section("Важные события");
  const decades = Math.floor((Number(age) || 0) / 10);
  for (let i = 0; i < decades; i++) {
    const base = `event.${i}`;
    const kind = b.sub(ev, `${base}.kind`, "eventKind", `${(i + 1) * 10} лет: событие`);
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
        b.table(ev, `${base}.enemy.power`, "enemyPower", { col: 0, label: "Сила врага" });
        b.table(ev, `${base}.enemy.far`, "enemyPower", { col: 1, label: "Насколько далеко зашло" });
        b.table(ev, `${base}.enemy.kind`, "enemyPower", { col: 2, label: "В чём сила" });
      }
    } else {
      const love = b.sub(ev, `${base}.love`, "love", "Любовь");
      if (love.value >= 2 && love.value <= 4) b.table(ev, `${base}.tragedy`, "tragedy");
      else if (love.value >= 5 && love.value <= 6) b.table(ev, `${base}.problem`, "problematic");
    }
  }
  if (!decades) ev.entries.push({ label: "Событий нет", text: "Персонажу меньше 10 лет — важных событий не было.", static: true });

  styleAndValues(b);
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
      v => (v <= risk.danger ? `Что-то стряслось (${v} ≤ ${risk.danger}%)` : `Обошлось (${v} > ${risk.danger}%)`), { sides: 100 });
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
        const alive = b.plain(sec, `${base}.enemy.alive`, "Жив ли враг (d100)", v => (v <= 30 ? "Враг умер" : "Враг жив"), { sides: 100 });
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
      const alive = b.plain(sec, `${base}.ally.alive`, "Жив ли союзник (d100)", v => (v <= 30 ? "Союзник мёртв" : "Союзник жив"), { sides: 100 });
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

/* ------------------------------------------------------------------------- */

/**
 * Собрать жизненный путь.
 * @param {object} rolls — словарь бросков (изменяется: дописываются недостающие, кроме пошагового режима)
 * @param {object} opts — {witcher, age, region: north|nilfgaard|elder, race, step}
 * @returns {{sections: object[], effects: object, next: {path, sides, label, section}|null, resultOf: Function}}
 *   next — следующий бросок в пошаговом режиме; null — путь брошен до конца;
 *   resultOf(path) — что выпало по броску: {title, text, detail}
 */
export function buildLifepath(rolls, opts) {
  const b = new Builder(rolls, { step: !!opts.step });
  try {
    if (opts.witcher) buildWitcher(b, opts);
    else buildRegular(b, opts);
  } catch (err) {
    if (err !== PENDING) throw err;
  }
  const resultOf = path => {
    const own = b.sections.flatMap(sec => sec.entries).find(e => e.path === path && !e.pending);
    if (own) return { title: own.title ?? "", text: own.text ?? "", detail: own.detail ?? "" };
    return { title: "", text: b.owners[path]?.detail ?? "", detail: "" };
  };
  return { sections: b.sections, effects: b.effects, next: b.next, resultOf };
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
  const m = path.match(/^(event\.\d+|decade\.\d+)\.(kind|luck|side|love|danger|dangerKind|outcome|event|benefit|fortune|misfortune)$/);
  if (m) {
    const [, base, what] = m;
    const children = {
      kind: ["luck", "side", "love", "fortune", "misfortune", "ally", "enemy", "tragedy", "problem"],
      luck: ["fortune", "misfortune"], side: ["ally", "enemy"], love: ["tragedy", "problem"],
      danger: ["dangerKind", "event", "wound", "enemy"], dangerKind: ["event", "wound", "enemy"],
      outcome: ["benefit", "ally", "hunt"], event: [], benefit: [], fortune: [], misfortune: []
    }[what] ?? [];
    return [...children.map(c => `${base}.${c}`), `${path}.sub`, `${path}.d10`, `${path}.beast`, `${path}.skill`, `${path}.months`];
  }
  return [];
}

/** Навыки для выбора «+1 или новый +2»: Инт-навыки или боевые. */
export function choiceSkillOptions(choice) {
  return Object.entries(SKILLS)
    .filter(([, s]) => (choice.combat ? s.combat : s.stat === choice.stat))
    .map(([key, s]) => ({ value: key, label: s.label }));
}

/* ------------------------------------------------------------------------- */
/*  Хранение в персонаже, переброс и показ карточками — общее для мастера      */
/*  создания и «Дневника»                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Жизненный путь персонажа — JSON в `system.lifepath`: броски и то, от чего они зависят.
 * В строке, а не в объекте: пути бросков содержат точки («event.0.kind»), а Foundry при обновлении
 * разворачивает такие ключи во вложенные объекты.
 * @returns {{rolls: object, witcher: boolean, age: number, region: string, race: string}|null}
 */
export function readLifepath(json) {
  try {
    const data = JSON.parse(json || "null");
    return data?.rolls && typeof data.rolls === "object" ? data : null;
  } catch {
    return null;
  }
}

export function writeLifepath({ rolls, witcher = false, age = 25, region = "north", race = "human" }) {
  return JSON.stringify({ rolls, witcher, age, region, race });
}

/** Параметры сборки из сохранённого жизненного пути. */
export function savedOpts(data) {
  return { witcher: !!data.witcher, age: data.age, region: data.region, race: data.race };
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

/** Строка для шаблона: текст результата и, если можно править, кость и список. */
function entryView(e, { editable, action }, label = e.label) {
  const view = { label, title: e.title ?? "", text: e.text ?? "", detail: e.detail ?? "", static: !!e.static || !e.path };
  if (editable && e.path) {
    const picked = selectedOption(e);
    Object.assign(view, {
      editable: true, action, path: e.path, value: e.value, sides: e.sides ?? 10, mod: e.mod ?? 0,
      options: e.options?.map(o => ({ ...o, selected: o.value === picked })) ?? null
    });
  }
  return view;
}

const SIBLING_COLS = ["Пол", "Возраст", "Отношение", "Черта"];

/**
 * Разделы жизненного пути → карточки для показа:
 * семья — строками, братья и сёстры — таблицей, события — карточкой на каждое десятилетие,
 * стиль и ценности — сеткой, десятилетия ведьмака — каждое своей карточкой.
 * Следующий бросок (пошаговый режим) — строкой с кнопкой в конце своей карточки.
 * @param {object[]} sections — из buildLifepath
 * @param {object} [opts] — editable: показать кости и списки; action — data-action переброса;
 *   nextAction — data-action следующего броска
 */
export function lifepathCards(sections, { editable = false, action = "reroll", nextAction = "lifepathStep" } = {}) {
  const ctx = { editable, action };
  // «20 лет: событие» → «Событие»: год уже в заголовке карточки
  const short = label => label.replace(/^\d+ лет:\s*/, "").replace(/^./, c => c.toUpperCase());
  const pendingOf = entries => {
    const e = entries.find(x => x.pending);
    return e ? { label: short(e.label), sides: e.sides, action: nextAction } : null;
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
      cards.push({ title: sec.title, icon: "fa-people-group", rows, pending: pendingOf(sec.entries),
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
          ? { title: sec.title, icon: "fa-hourglass", rows, pending }
          : { title: `${(Number(i) + 1) * 10} лет`, subtitle: "важное событие", icon: "fa-hourglass-half", cls: "event", rows, pending });
      }
      continue;
    }
    const grid = sec.title === "Личный стиль" || sec.title === "Ценности";
    const icon = { "Семья": "fa-house-chimney", "Личный стиль": "fa-shirt", "Ценности": "fa-scale-balanced",
      "Школа и испытания": "fa-flask", "Жизнь ведьмака": "fa-road" }[sec.title] ?? (sec.risk ? "fa-hourglass-half" : "fa-scroll");
    cards.push({
      title: sec.title, icon, grid, cls: sec.risk ? "event" : grid ? "grid" : "",
      subtitle: sec.risk ? WITCHER_RISK[sec.risk]?.label ?? "" : "",
      decade: sec.decade ?? null,
      // Поведение ведьмака выбирают в правке и пока десятилетие бросается: от него шанс опасности
      riskOptions: sec.risk && (editable || (nextAction && sec.entries.some(e => e.pending)))
        ? Object.entries(WITCHER_RISK).map(([k, v]) => ({ key: k, label: v.label, selected: k === sec.risk })) : null,
      rows: done.map(e => entryView(e, ctx)),
      pending: pendingOf(sec.entries)
    });
  }
  return cards;
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

function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
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
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content, rolls: roll ? [roll] : [] });
}
