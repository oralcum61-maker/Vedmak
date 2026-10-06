// Автоматика эликсиров и отваров, у которых в данных только текст (корник стр. 247–251, «Фургончик Родольфа»,
// «Том Хаоса»). Ключ — название без кавычек в нижнем регистре: так справочник работает и для предметов
// из компендиума, и для созданных руками, и не пропадает при пересборке компендиумов.
//
// Поля записи:
//   changes      — изменения активного эффекта [{key, type, value}]
//   rounds       — длительность в раундах, число или формула («2d6»), если у предмета её нет
//   minutes      — длительность в минутах, если у предмета её нет
//   regen        — ПЗ за ход
//   immune       — невосприимчивость к состояниям (id статусов), действующие снимаются
//   vision       — зрение токена {visionMode, range}; прежнее возвращается, когда эффект кончится
//   restore      — сразу: {sta: "3d6"}
//   spPerFreeEnc — ПБ за каждые 10 свободных единиц Переносимого веса (отвар главоглаза)
//   doubleEnc    — Переносимый вес вдвое (отвар беса)
//   onKill       — после убийства: {changes, once} или {regen}
//   onHit        — каждое нанесённое попадание: {damage} (складывается), сброс — когда ранят самого
//   onDamaged    — получил урона больше over: {over, sp} (складывается)
//   untilHit     — эффект снимается после следующего нанесённого физического урона
//   doubleAdrenaline — каждая кость адреналина — две
//   healCrit     — вылечить одно критическое ранение на выбор
//   hpNow        — сразу прибавить к текущим ПЗ (вместе с ростом максимума), не выше нового максимума
//   anyone       — эликсир не ведьмачий: пьёт кто угодно без Стойкости СЛ 18 у не-мутанта
//   note         — что осталось текстом
//   action       — действие, если у предмета оно не задано (составы без кнопки в данных)
//   hours        — длительность в часах (число или формула «1d10»); minutes и rounds тоже понимают формулы
//   statuses     — состояния на время эффекта (кома «Коматозника»)
//   save         — Стойкость при приёме: {dc, statuses, minutes} — провал даёт состояния (на minutes или срок эффекта)
//   addiction    — Стойкость против зависимости после приёма (СЛ)
//   staNow       — сразу прибавить к текущей Вын (вместе с ростом максимума)
//   noStunSave   — испытаний Уст нет: проходят сами (опиат)
//   adrenaline   — адреналиновый эликсир: при смерти — испытания против смерти удаются сами, иначе нет штрафов порога
//   burnVuln     — +% к шансу поджечь носителя («Быстрый огонь»)
//   blackBlood   — «Чёрная кровь»: кто укусит или выпьет кровь, отравлен (Стойкость СЛ dc)
//   stunSave     — «Применить» на цель: испытание Уст с поправкой mod, провал — состояние status (хлороформ)
//   targetStatus — «Применить» на цель: состояние (яд аконита)
//   coat         — яд на клинок: {statuses, types (тип урона оружия), rounds (срок), once (до первого урона)}
//   zone         — флаги облака бомбы ({noMagic} — двимерит)
//   ignite       — облако горючего газа: кнопка взрыва {formula, status, chance}
//   trapSave     — ловушка: Стойкость {dc}, провал — исступление до успешной проверки
//   mark         — ловушка-метка: эффект на целях на minutes

const M = (key, value) => ({ key, type: "add", value, phase: "initial" });

export const ALCHEMY_AUTO = {
  // Эликсиры корника
  "кошка": { vision: { visionMode: "darkvision", range: 30 },
    note: "Невосприимчивость к гипнозу и +2 к раскрытию иллюзий — учитывайте сами." },
  // Кто укусит ведьмака или выпьет его кровь, отравлен до Стойкости СЛ 20 и отскакивает на 2 м (combat/damage.mjs)
  "чёрная кровь": { blackBlood: { dc: 20 } },
  "пурга": { onKill: { changes: [M("system.stats.ref.mod", 4)], once: true } },
  "иволга": { immune: ["poisoned"] },
  "лес марибора": { doubleAdrenaline: true },
  "косатка": { note: "Дыхание задерживается в полтора раза дольше, под водой нет штрафов зрения." },

  // Отвары
  "отвар из главоглаза": { spPerFreeEnc: 2 },
  "отвар из беса": { doubleEnc: true },
  "отвар из кладбищенской бабы": { regen: 0, onKill: { regen: 2 } },
  "отвар из грифона": { onDamaged: { over: 5, sp: 2 } },
  "отвар из катакана": { changes: [M("system.fx.critLocation", 3)] },
  "отвар из полуденницы": { immune: ["disoriented", "blind", "prone"] },
  "отвар из виверны": { onHit: { damage: 1 } },
  "отвар из волколака": { note: "Долгий бег не тратит Выносливость." },

  // «Фургончик Родольфа»: обычные эликсиры, пьются без проверки на отравление
  "зелье живучести": { anyone: true, rounds: "2d6", changes: [M("system.fx.ignoreWound", 1)] },
  "зелье выносливости": { anyone: true, restore: { sta: "3d6" } },
  "зелье раффара белого": { anyone: true, rounds: "4d6", regen: 1 },

  // «Том Хаоса»: эликсиры магов, «пить его может кто угодно»
  "анаболические стероиды": { anyone: true, minutes: 10, hpNow: 10,
    changes: [M("system.fx.hp", 10), M("system.skills.endurance.mod", 2), M("system.skills.physique.mod", 2)],
    note: "Час после приёма пьющий невыносимо зол на всех вокруг." },
  "молния": { anyone: true, changes: [M("system.fx.damage", 3)], untilHit: true },
  "мангуст": { anyone: true, minutes: 30, immune: ["poisoned"] },
  "буря": { anyone: true, changes: [M("system.fx.statusChance", 10)] },
  "последняя надежда": { anyone: true, healCrit: true },
  "путник": { anyone: true, minutes: 1440, note: "Сутки без сна и без последствий." },
  "церебральный эликсир": { anyone: true },

  // Не ведьмачьи составы других книг: лекарство от катрионы и зелье, которое подливают как яд
  "эликсир мец": { anyone: true },
  // Стойкость СЛ 16 сразу и в начале каждого хода; провал — в свой ход атакует ближайшего (1d10 раундов)
  "зелье берсерка": { anyone: true, rounds: "1d10", berserk: { dc: 16 } },

  // Составы корника (стр. 87–88)
  // Без сознания, пока не пройдёт испытание Уст: кнопка — в начале каждого хода
  "хлороформ": { stunSave: { mod: -2, status: "unconscious" } },
  "фисштех": { save: { dc: 16, statuses: ["disoriented"], minutes: 30 }, addiction: 18 },
  "эликсир пантаграна": { minutes: "1d6*30", changes: [M("system.skills.resistCoercion.mod", -2)] },
  "ароматное зелье": { hours: "1d10", save: { dc: 16, statuses: ["intoxicated"] } },
  "обезболивающие травы": { rounds: "2d10", changes: [{ key: "system.fx.pain", type: "upgrade", value: 2, phase: "initial" }] },
  "быстрый огонь": { minutes: 1440, burnVuln: 50, note: "+50 % к шансу загореться — до сожжения или суток." },
  "чёрный яд": { coat: { statuses: ["poisoned"], rounds: "1d10" } },

  // «Профессиональные инструменты»: составы Родольфа
  "адреналиновый эликсир": { anyone: true, action: "drink", rounds: 3, adrenaline: true },
  "пепельная мазь": { action: "apply", minutes: 60, immune: ["burning"] },
  "яд аконита": { action: "apply", targetStatus: "suffocating" },

  // «Компендиум BS & Tobi»: простые составы
  "возбудитель (киноварь + солнце)": { anyone: true, changes: [M("system.stats.ref.mod", 3)] },
  "соблазнитель (гидраген + ребис)": { anyone: true, changes: [M("system.skills.seduction.mod", 3)] },
  // Запугиванию противостоит Храбрость
  "устрашитель (фульгор + киноварь)": { anyone: true, changes: [M("system.skills.courage.mod", 3)] },
  "концентратор (эфир + купорос)": { anyone: true, changes: [M("system.skills.awareness.mod", 3)] },
  "энергетик (киноварь + квебрит)": { anyone: true, staNow: 15, changes: [M("system.fx.sta", 15)] },
  "укрепитель (купорос + ребис)": { anyone: true, hpNow: 15, changes: [M("system.fx.hp", 15)] },
  "коматозник (фульгор + солнце)": { anyone: true, statuses: ["unconscious"] },
  "обезболивающее (квебрит + солнце)": { anyone: true, changes: [{ key: "system.fx.pain", type: "upgrade", value: 4, phase: "initial" }] },
  // Слабый свет — как яркий: усиление света у токена; двойной штраф на ярком свету — учитывайте сами
  "полуночник (эфир + аер)": { anyone: true, vision: { visionMode: "lightAmplification", range: 30 } },
  "опиат киновари": { anyone: true, rounds: "1d10", noStunSave: true },

  // «Лорды и земли»
  "селестин": { anyone: true, changes: [M("system.skills.awareness.mod", -2)] },
  "трупный яд": { coat: { statuses: ["poisoned", "nauseated"], types: ["slashing", "piercing"], once: true } },

  // Бомбы и ловушки корника
  "двимеритовая бомба": { zone: { noMagic: true } },
  "сон дракона": { ignite: { formula: "5d6", status: "burning", chance: 75 } },
  "бешенство": { trapSave: { dc: 18 } },
  "метка": { mark: { minutes: 1440 } }
};

/** Число из числа или формулы («2d10», «1d6*30»); пусто — 0. */
export async function rollCount(value) {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  return (await new Roll(String(value)).evaluate()).total;
}

/**
 * Книги, где эликсиры не ведьмачьи: обычные эликсиры «Фургончика Родольфа» и эликсиры магов «Тома Хаоса».
 * Их пьёт кто угодно — проверки Стойкости СЛ 18 у не-мутанта нет (стр. 246 касается ведьмачьих).
 */
export const ANYONE_BOOKS = ["Фургончик Родольфа", "Том Хаоса"];

/** Пьёт ли состав кто угодно — по книге предмета или по пометке справочника. */
export function anyoneCanDrink(item) {
  return ANYONE_BOOKS.includes(item?.system?.source?.book) || !!alchemyAuto(item?.name)?.anyone;
}

/** Название без кавычек и регистра. */
export const alchemyKey = name => String(name ?? "").toLowerCase().replace(/[«»"„“”]/g, "").replace(/\s+/g, " ").trim();

/** Запись справочника для предмета или null. */
export function alchemyAuto(name) {
  return ALCHEMY_AUTO[alchemyKey(name)] ?? null;
}
