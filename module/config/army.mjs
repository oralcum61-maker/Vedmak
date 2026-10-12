// Ополчение и армии (PLAN 4.187): справочник отрядов — рода войск, выучка, снаряжение, набор, содержание, местность.
// Правила — module/army/rules.mjs; модель отряда — data/actor/unit.mjs; связь с поселением — settlement/settlement.mjs.
// Журнал мира manorlords: «Ополчение — мужчины 16–50 лет, которых можно снарядить оружием и доспехами и отправить
// сражаться»; остальное — домашние правила системы.

const g = (resource, qty = 1) => ({ resource, qty });

/**
 * Рода войск: base — сила рода, vs — прибавка против рода, firstRound — прибавка в первом раунде (стрелки бьют
 * издали), mount — нужны лошади. gear.weapons и gear.armor — что тратится на каждого бойца на ступени оружия и брони
 * (1–3) поверх прежних (PLAN 4.198: оружие и броня — отдельно).
 */
export const UNIT_KINDS = {
  infantry: { label: "Пехота", img: "icons/skills/melee/weapons-crossed-swords-yellow.webp", base: 2,
    gear: { weapons: [[g("Оружие")], [g("Оружие")], [g("Оружие"), g("Железо")]], armor: [[g("Кожа")], [g("Доспехи")], [g("Доспехи")]] } },
  pikes: { label: "Копейщики", img: "icons/weapons/polearms/spear-flared-steel.webp", base: 2, vs: { cavalry: 3 },
    gear: { weapons: [[g("Оружие")], [g("Оружие"), g("Доски")], [g("Оружие")]], armor: [[g("Кожа")], [g("Доспехи")], [g("Доспехи")]] } },
  archers: { label: "Стрелки", img: "icons/weapons/bows/longbow-recurve-brown.webp", base: 1, firstRound: 3,
    gear: { weapons: [[g("Луки")], [g("Луки")], [g("Луки"), g("Оружие")]], armor: [[g("Кожа")], [g("Кожа")], [g("Доспехи")]] } },
  cavalry: { label: "Конница", img: "icons/environment/creatures/horse-brown.webp", base: 4, mount: true, vs: { archers: 2 },
    gear: { weapons: [[g("Лошади"), g("Оружие")], [g("Оружие")], [g("Оружие")]], armor: [[g("Кожа")], [g("Доспехи")], [g("Доспехи"), g("Кожа")]] } }
};

/** Выучка: подпись, сила, боевой дух по умолчанию, недель тренировки до следующей. */
export const TRAINING = [
  { label: "Новобранцы", power: 0, morale: 4, weeks: 2 },
  { label: "Ополченцы",  power: 1, morale: 5, weeks: 3 },
  { label: "Обученные",  power: 2, morale: 6, weeks: 4 },
  { label: "Солдаты",    power: 3, morale: 7, weeks: 6 },
  { label: "Ветераны",   power: 4, morale: 8, weeks: 0 }
];
export const MAX_TRAINING = TRAINING.length - 1;

/** Оружие: подпись и сила. */
export const WEAPONS = [
  { label: "Вилы и топоры", power: 0 },
  { label: "Простое", power: 1 },
  { label: "Добротное", power: 2 },
  { label: "Мастерское", power: 3 }
];
/** Броня: подпись, сила и сколько процентов потерь снимает. */
export const ARMOR = [
  { label: "Без брони", power: 0, losses: 0 },
  { label: "Стёганка", power: 0, losses: 10 },
  { label: "Кольчуга", power: 1, losses: 20 },
  { label: "Латы", power: 1, losses: 30 }
];
/** Снаряжение по дорожкам: оружие и броня — каждое со своей шкалой. */
export const GEAR = { weapons: { label: "Оружие", tiers: WEAPONS }, armor: { label: "Броня", tiers: ARMOR } };
export const MAX_GEAR = 3;

/** Боевой дух 0–10; при таком и ниже отряд бежит с поля. */
export const MORALE_MAX = 10;
export const ROUT_AT = 2;

/** Откуда набирают. */
export const ORIGINS = {
  militia:   { label: "Ополчение", hint: "Мужчины из Ополчения поселения: уходят из его числа, при роспуске возвращаются." },
  families:  { label: "Семьи", hint: "Семья уходит в строй и не работает на постройках: одна семья — 5 бойцов." },
  mercenary: { label: "Наёмники", hint: "За Богатство: сразу обучены и со своим снаряжением, но каждую неделю ждут платы." }
};
export const FAMILY_SOLDIERS = 5;

/** Наёмники: найм за бойца и плата в неделю — в Богатстве (1 = 500 монет); выучка и снаряжение при найме. */
export const MERCENARY = { hire: 0.04, pay: 0.01, training: 3, weapons: 2, armor: 2, morale: 6 };

/** Еда в неделю на бойца (семья из 5–10 человек ест 1 — боец 0,2). */
export const FOOD_PER_SOLDIER = 0.2;

/** Местность битвы: прибавка обороняющимся (side 1) и запреты. */
export const TERRAIN = {
  field:  { label: "Поле", defender: 0 },
  forest: { label: "Лес", defender: 2, cavalry: -2 },
  hill:   { label: "Холм", defender: 2 },
  river:  { label: "Брод", defender: 3 },
  walls:  { label: "Частокол или стены", defender: 4, cavalry: -3 }
};

/** Сколько бойцов дают +1 к силе (численность). */
export const SOLDIERS_PER_POWER = 10;
/** Командир: (Эмпатия + Лидерство) / 3, не больше 5. */
export const COMMANDER_MAX = 5;
