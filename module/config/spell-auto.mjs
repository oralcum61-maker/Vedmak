// Автоматика заклинаний, у которых в данных только текст: баффы на себя и на цель, урон «Тома Хаоса».
// Ключ — название в нижнем регистре: справочник работает и для компендиума, и для созданных руками
// заклинаний и не пропадает при пересборке компендиумов.
//
// Поля записи:
//   automation — чего не хватает в поле автоматизации заклинания (урон, статусы, урон Вын);
//                берётся, только если у самого заклинания автоматизация пустая
//   self       — эффект на заклинателя при успехе
//   target     — эффект на цели (через защиту: «Применить эффекты» или сразу, если защиты нет)
//   note       — что осталось текстом
// Эффект: changes, immune (состояния), rollMods {attack, defense, skill, all}, statuses (id статусов
// на время эффекта), vision {visionMode, range}. Длительность — из поля «Длительность» заклинания.

const M = (key, value) => ({ key, type: "add", value, phase: "initial" });
const S = (skill, value) => M(`system.skills.${skill}.mod`, value);

export const SPELL_AUTO = {
  // Урон «Тома Хаоса»
  "дыхание огня": { automation: { damage: "3d6", statuses: [{ status: "burning", chance: "100" }] } },
  "струя воды": { automation: { damage: "4d6", damageType: "bludgeoning", statuses: [{ status: "prone", chance: "100" }] },
    note: "Тип урона — на выбор заклинателя: по умолчанию дробящий." },
  "сагитта аурея": { automation: { damage: "7d6" }, note: "Летит по прямой через цели; одержимый демон вытесняется." },
  "свет покаяния": { automation: { staDamage: "2d6" }, note: "У цели с порогом Энергии 1+ — ещё 2d6 Вын." },
  "извлечение айнфры": { automation: { staDamage: "8d6" } },

  // Рассеивание (стр. 102): снимает с целей магию, чей бросок заклинателя ниже (cast.mjs dispelOn)
  "рассеивание": { dispel: true },

  // На себя
  "очарование": { self: { changes: [S("seduction", 3), S("charisma", 3), S("leadership", 3)] } },
  "благословение любви": { self: { changes: [S("charisma", 3), S("seduction", 3)] } },
  "обострение чувств": { self: { changes: [S("awareness", 2)], vision: { visionMode: "darkvision", range: 20 } },
    note: "Яркий свет или громкий шум — ошеломление." },
  "божественное присутствие": { self: { changes: [S("intimidation", 4)] } },
  "голос советника": { self: { changes: [S("leadership", 4)] } },
  "покров": { self: { changes: [S("stealth", 10)], rollMods: { attack: 5, defense: 5 }, statuses: ["invisible"] },
    note: "Атаковали невидимого — заклинание прекращается. Ирден и «Лунная пыль» снижают бонусы до +5 и +3." },

  // На цель
  "животная сила": { target: { changes: [M("system.fx.meleeDamage", 2), M("system.stats.int.mod", -2)] } },
  "двойственная тьма": { target: { changes: [S("deceit", 2)] } },
  "кровь горы": { target: { immune: ["prone"] },
    note: "Атаки цели нельзя парировать, разрушающий урон ×2 — учитывайте сами." },
  "храбрость фрейи": { self: { changes: [M("system.fx.hp", 25)] }, target: { changes: [M("system.fx.hp", 25)] },
    note: "Невосприимчивость к ужасу; вышедший из зоны сохраняет эффект ещё 1d6 раундов." },
  "чемпион реки": { target: { rollMods: { all: 5 } }, note: "Сопротивление всем источникам урона — учитывайте сами." }
};

export const spellKey = name => String(name ?? "").toLowerCase().replace(/[«»"„“”]/g, "").replace(/\s+/g, " ").trim();

export function spellAuto(name) {
  return SPELL_AUTO[spellKey(name)] ?? null;
}

/** Автоматизация боя заклинания: своя, а если пустая — из справочника. */
export function spellAutomation(item) {
  const own = item.system.automation;
  const extra = spellAuto(item.name)?.automation;
  if (!extra || item.system.hasEffect) return own;
  return { ...own, ...foundry.utils.deepClone(extra) };
}
