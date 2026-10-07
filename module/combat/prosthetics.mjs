// Удары протезом («Лавка Клауса и Нострадамуса»): надетый протез — свой источник атаки (Борьба, удары рукой и ногой)
// со свойствами протеза и надетых модификаций (config/items.mjs, PROSTHETIC_PARTS). Протезное покрытие даёт
// Надёжность 15 и позволяет блокировать и парировать протезом Борьбой; Надёжность живёт во флаге протеза
// vedmak.reliability. Двимеритовый протез: цели — касание двимерита (кнопка в карточке урона), носителю — Энергия 0
// (data/actor/common.mjs).
//
// Модификация стоит на протезе, выбранном в её листе (флаг vedmak.prosthesis — id протеза у того же персонажа);
// без выбора — на всех надетых протезах, как было до PLAN 4.124. Починка — craft.mjs `repair`.

import { PROSTHETIC_RELIABILITY, prostheticPart, prostheticKey } from "../config/items.mjs";

const isProsthesis = i => i.type === "gear" && i.system.equipped && i.system.category === "prosthetic";
const isMod = i => i.type === "gear" && i.system.equipped && i.system.category === "prostheticMod";

/**
 * Оружие в протезе («Лавка Клауса и Нострадамуса»): модификация с выбранным в её листе оружием (флаг vedmak.weapon).
 * Ручной арбалет — выстрелы −3, но без штрафов протеза; скрытый клинок — +4 к атаке им и к скрытному выхватыванию.
 * Такое оружие готово к бою, даже если не «в руках».
 */
export const PROSTHETIC_WEAPON_MODS = {
  "ручной арбалет (протез)": { label: "Ручной арбалет в протезе", mod: -3, fits: w => !!w.system.isCrossbow },
  "скрытый клинок": { label: "Скрытый клинок", mod: 4, fits: w => !w.system.isRanged && w.system.category !== "natural" }
};
export const prostheticWeaponCfg = mod => PROSTHETIC_WEAPON_MODS[prostheticKey(mod?.name)] ?? null;

/** Модификация, в которой стоит это оружие, — надетая и на надетом протезе (или без привязки к протезу). */
export function weaponMount(actor, weapon) {
  if (!actor || !weapon) return null;
  const mod = actor.itemTypes?.gear?.find(m => isMod(m) && prostheticWeaponCfg(m) && m.flags?.vedmak?.weapon === weapon.id);
  if (!mod) return null;
  const on = actor.items.get(mod.flags?.vedmak?.prosthesis);
  if (on && !on.system.equipped) return null;
  return { mod, ...prostheticWeaponCfg(mod) };
}

/** Надетые протезы актора. */
export const equippedProstheses = actor => actor?.itemTypes?.gear?.filter(isProsthesis) ?? [];

/** Протез — предмет снаряжения «Протезы». */
export const isProstheticItem = item => item?.type === "gear" && item.system.category === "prosthetic";

/** Модификация стоит на этом протезе: выбран он или не выбран никакой. */
export const modOnProsthesis = (mod, item) => {
  const on = mod.flags?.vedmak?.prosthesis;
  return !on || on === item.id || !mod.parent?.items.has(on);
};

/**
 * Что даёт удар протезом: сам протез и надетые модификации, стоящие на нём.
 * @returns {{item: Item, accuracy: number, effects: object[], silver: string, lethal: boolean, damage: string,
 *   dimeritium: boolean, coating: boolean, relMod: number, mods: string[], reliability: {value, max}|null,
 *   fallsOff: boolean}|null}
 */
export function prostheticStrike(actor, itemId = null) {
  const list = equippedProstheses(actor);
  const item = itemId ? list.find(i => i.id === itemId) : list[0];
  if (!item) return null;
  return prostheticStats(actor, item);
}

/** Свойства протеза с его модификациями — и у снятого (лист предмета, починка). */
export function prostheticStats(actor, item) {
  const out = { item, accuracy: 0, effects: [], silver: "", lethal: false, damage: "", dimeritium: false, coating: false,
    relMod: 0, mods: [] };
  for (const part of [item, ...actor.itemTypes.gear.filter(i => isMod(i) && modOnProsthesis(i, item))]) {
    const cfg = prostheticPart(part.name);
    if (part !== item) out.mods.push(part.name);
    if (!cfg) continue;
    out.accuracy += cfg.accuracy ?? 0;
    for (const e of cfg.effects ?? []) if (!out.effects.some(x => x.key === e.key)) out.effects.push({ ...e });
    if (cfg.silver) out.silver = cfg.silver;
    if (cfg.lethal) out.lethal = true;
    if (cfg.damage) out.damage = cfg.damage;
    if (cfg.dimeritium) out.dimeritium = true;
    if (cfg.coating) out.coating = true;
    out.relMod += cfg.reliability ?? 0;
  }
  const max = (out.coating ? PROSTHETIC_RELIABILITY : 0) + out.relMod;
  out.reliability = max > 0 ? { value: Math.max(0, Math.min(max, item.flags?.vedmak?.reliability ?? max)), max } : null;
  // «Лёгкое покрытие»: без Надёжности протез отпадает после удара
  out.fallsOff = out.relMod < 0 && max <= 0;
  return out;
}

/**
 * Износ протеза (блок, критический провал защиты). Надёжность 0 — протез отпадает (снимается).
 * @returns {Promise<{value: number, max: number, fell: boolean}|null>} null — у протеза нет Надёжности
 */
export async function wearProsthesis(actor, item, amount = 1) {
  const rel = prostheticStrike(actor, item.id)?.reliability;
  if (!rel) return null;
  const value = Math.max(0, rel.value - amount);
  await item.setFlag("vedmak", "reliability", value);
  if (!value) await item.update({ "system.equipped": false });
  return { value, max: rel.max, fell: !value };
}

/** Строка отчёта об износе протеза. */
export function wearLine(item, wear) {
  if (!wear) return "";
  return wear.fell ? `${item.name}: Надёжность 0 — протез отпал (снят).` : `${item.name}: Надёжность ${wear.value}/${wear.max}.`;
}
