// Статусы «Ведьмака» (эффекты стр. 161, состояния боя стр. 153–163) и их влияние на броски.

const change = (key, value) => ({ key, type: "add", value, phase: "initial" });

/** Статусы для HUD токена. Механика без `changes` учитывается при бросках (см. statusRollMods). */
export const STATUS_EFFECTS = [
  { id: "dead",         name: "Мёртв",               img: "systems/vedmak/assets/fan/status/st-dead.webp" },
  { id: "dying",        name: "При смерти",          img: "systems/vedmak/assets/fan/status/st-dying.webp" },
  { id: "unconscious",  name: "Без сознания",        img: "systems/vedmak/assets/fan/status/st-unconscious.webp" },
  { id: "disoriented",  name: "Дезориентация",       img: "systems/vedmak/assets/fan/status/st-disoriented.webp" },
  { id: "staggered",    name: "Ошеломление",         img: "systems/vedmak/assets/fan/status/st-staggered.webp" },
  { id: "bleeding",     name: "Кровотечение",        img: "systems/vedmak/assets/fan/status/st-bleeding.webp" },
  { id: "poisoned",     name: "Отравление",          img: "systems/vedmak/assets/fan/status/st-poisoned.webp" },
  { id: "burning",      name: "Горение",             img: "systems/vedmak/assets/fan/status/st-burning.webp" },
  { id: "frozen",       name: "Замораживание",       img: "systems/vedmak/assets/fan/status/st-frozen.webp",
    system: { changes: [change("system.stats.spd.mod", -3), change("system.stats.ref.mod", -1)] } },
  { id: "intoxicated",  name: "Опьянение",           img: "systems/vedmak/assets/fan/status/st-intoxicated.webp",
    system: { changes: [change("system.stats.ref.mod", -2), change("system.stats.dex.mod", -2), change("system.stats.int.mod", -2)] } },
  { id: "hallucinating", name: "Галлюцинации",       img: "systems/vedmak/assets/fan/status/st-hallucinating.webp" },
  { id: "nauseated",    name: "Тошнота",             img: "systems/vedmak/assets/fan/status/st-nauseated.webp" },
  { id: "suffocating",  name: "Удушье",              img: "systems/vedmak/assets/fan/status/st-suffocating.webp" },
  { id: "blind",        name: "Слепота",             img: "systems/vedmak/assets/fan/status/st-blind.webp" },
  { id: "prone",        name: "Сбит с ног",          img: "systems/vedmak/assets/fan/status/st-prone.webp" },
  { id: "grappled",     name: "В захвате",           img: "systems/vedmak/assets/fan/status/st-grappled.webp" },
  { id: "immobilized",  name: "Обездвижен",          img: "systems/vedmak/assets/fan/status/st-immobilized.webp" },
  { id: "activeDodge",  name: "Активное уклонение",  img: "systems/vedmak/assets/fan/status/st-activeDodge.webp" },
  { id: "invisible",    name: "Невидимость",         img: "systems/vedmak/assets/fan/status/st-invisible.webp" },
  { id: "withdrawal",   name: "Ломка",               img: "systems/vedmak/assets/fan/status/st-withdrawal.webp" }
];

/** Описания статусов для подсказок и листа. */
export const STATUS_HINTS = {
  dying: "Все параметры ×⅓. Каждый раунд — испытание против смерти с накапливающимся −1.",
  unconscious: "Без сознания: считается дезориентированным, пока не восстановит 20 Вын и не пройдёт испытание Уст.",
  disoriented: "Не может действовать; попасть по нему — СЛ 10. Выход — испытание Уст полным ходом или любое попадание.",
  staggered: "−2 к атаке и защите до начала своего следующего хода.",
  bleeding: "2 урона за ход. Остановить — лечащее заклинание или Первая помощь СЛ 15 (действие).",
  poisoned: "3 урона за ход мимо брони. Стойкость СЛ 15 (действие).",
  burning: "5 урона по каждой части тела за ход; броня поглощает и теряет 1 ПБ. Потушить — ход.",
  frozen: "−3 Скор, −1 Реа. Сила СЛ 16 (действие).",
  intoxicated: "−2 Реа, Лвк, Инт; −3 в словесной дуэли.",
  hallucinating: "Отличить иллюзию — Дедукция СЛ 15.",
  nauseated: "Каждые 3 раунда d10 < Тел, иначе раунд рвоты.",
  suffocating: "3 урона за раунд мимо брони.",
  blind: "−3 к атаке и защите, −5 к Вниманию (зрение). Ход — восстановить зрение.",
  prone: "−2 к атаке и защите. Встать — потратить перемещение.",
  grappled: "Не может отойти, −2 к физическим действиям. Освобождение — Уклонение против Борьбы.",
  immobilized: "Не может двигаться и действовать. Атаки по нему +4.",
  activeDodge: "Полный ход: атакующие в ближнем бою −2, доп. защиты без затрат Вын.",
  withdrawal: "Зависимость без дозы: −5 ко всем действиям, не связанным с получением объекта зависимости (стр. 32)."
};

export function registerStatusEffects() {
  CONFIG.statusEffects.length = 0;
  for (const s of STATUS_EFFECTS) CONFIG.statusEffects[s.id] = { ...s, description: STATUS_HINTS[s.id] ?? "" };
  CONFIG.specialStatusEffects.DEFEATED = "dead";
  CONFIG.specialStatusEffects.BLIND = "blind";
  CONFIG.specialStatusEffects.INVISIBLE = "invisible";
}

/**
 * Модификаторы бросков от статусов.
 * @param {Actor} actor
 * @param {"attack"|"defense"|"skill"} kind
 * @param {object} [opts]
 * @param {string} [opts.skill] — ключ навыка (для Внимания при слепоте)
 * @returns {{label: string, value: number}[]}
 */
export function statusRollMods(actor, kind, { skill } = {}) {
  const has = id => actor?.statuses?.has(id);
  const parts = [];
  const physical = kind === "attack" || kind === "defense" ||
    ["athletics", "physique", "dodge", "brawling", "melee", "swordsmanship", "smallBlades", "staffSpear",
     "archery", "crossbow", "riding", "stealth", "sleight"].includes(skill);
  if (kind === "attack" || kind === "defense") {
    if (has("staggered")) parts.push({ label: "Ошеломление", value: -2 });
    if (has("prone")) parts.push({ label: "Сбит с ног", value: -2 });
    if (has("blind")) parts.push({ label: "Слепота", value: -3 });
  }
  if (physical && has("grappled")) parts.push({ label: "В захвате", value: -2 });
  if (has("withdrawal")) parts.push({ label: "Ломка", value: -5 });
  if (skill === "awareness") {
    if (has("blind")) parts.push({ label: "Слепота (зрение)", value: -5 });
    const sight = actor?.system?.derived?.sightMod;
    if (sight) parts.push({ label: "Ранение глаза (зрение)", value: sight });
  }
  return parts;
}
