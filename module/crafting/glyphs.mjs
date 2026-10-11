// Глифы надетой брони (PLAN 4.179): сводка эффектов для боя, магии и лечения. Справочник — GLYPH_FX (config/crafting.mjs).
// ПБ, сопротивления, Скованность и поправки к навыкам и ПЗ считаются в данных брони и персонажа; здесь — то, что
// срабатывает в действии: заклинание своей стихии, кровотечение, «Возмездие», «Вращение», восстановление ПЗ.

import { glyphFx } from "../config/crafting.mjs";

/** Глифы на надетой броне актора: [{name, fx}]. */
export function wornGlyphs(actor) {
  const out = [];
  for (const armor of actor?.itemTypes?.armor ?? []) {
    if (!armor.system.equipped) continue;
    for (const e of armor.system.enhancements ?? []) {
      const fx = e.kind === "glyph" ? glyphFx(e.name) : null;
      if (fx) out.push({ name: e.name, fx });
    }
  }
  return out;
}

/** Сумма числового эффекта глифов и их названия: { value, names }. */
export function glyphSum(actor, key) {
  const hits = wornGlyphs(actor).filter(g => g.fx[key]);
  return { value: hits.reduce((n, g) => n + (Number(g.fx[key]) || 0), 0), names: hits.map(g => g.name) };
}

/** Есть ли глиф с флагом (noUnseen) — название первого или "". */
export function glyphFlag(actor, key) {
  return wornGlyphs(actor).find(g => g.fx[key])?.name ?? "";
}

/** Глиф стихии для заклинания мага: название глифа или "" (СЛ +3 или урон +1d6 на выбор). */
export function spellGlyph(actor, spell) {
  if (spell?.kind !== "spell") return "";
  const element = spell.element || "mixed";
  return wornGlyphs(actor).find(g => g.fx.spell === element)?.name ?? "";
}

/** ПБ брони с прибавкой глифа: копия sp, у закрытых частей max и value + delta (не ниже 0). */
export function spPlus(sp, delta) {
  const out = foundry.utils.deepClone(sp);
  if (!delta) return out;
  for (const part of Object.values(out)) {
    // Только закрытые бронёй части — как у набора усиления
    if (!(part.max > 0)) continue;
    part.max = Math.max(0, part.max + delta);
    part.value = Math.max(0, Math.min(part.max, part.value + delta));
  }
  return out;
}

/**
 * «Глиф восстановления»: при каждом восстановлении ПЗ — на 1 больше (до максимума). Ловится в preUpdateActor, поэтому
 * работает для любого источника: зелья, отдых, регенерация, лечение, ручная правка ведущего.
 */
export function healGlyphOnUpdate(actor, changes, options) {
  if (options?.vedmakNoHealGlyph) return;
  const next = foundry.utils.getProperty(changes, "system.hp.value");
  if (typeof next !== "number") return;
  const now = actor.system.hp?.value ?? 0, max = actor.system.hp?.max ?? 0;
  if (next <= now || next >= max) return;
  const { value } = glyphSum(actor, "heal");
  if (value) foundry.utils.setProperty(changes, "system.hp.value", Math.min(max, next + value));
}
