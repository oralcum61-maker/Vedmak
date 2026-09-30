// Баффы заклинаний на заклинателе и целях (справочник — config/spell-auto.mjs): эффект с изменениями,
// невосприимчивостью, модификаторами бросков, статусами и зрением. Срок — из поля «Длительность»:
// раунды считаются в начале хода носителя, минуты и часы — по мировому времени, «активное» —
// пока заклинатель поддерживает заклинание.

import { applyVision } from "../crafting/alchemy-triggers.mjs";
import { describeChanges } from "../config/effects.mjs";
import { inCombat, roundsAsTime } from "../util.mjs";

/**
 * Срок баффа по тексту длительности.
 * @returns {Promise<{rounds?: number, minutes?: number, maintain?: true}>}
 */
export async function buffDuration(text) {
  const t = String(text ?? "").toLowerCase();
  if (/активн/.test(t)) return { maintain: true };
  const m = t.match(/(\d+d\d+|\d+)\s*(раунд|минут|час|дн|ден|недел)/);
  if (!m) return {};
  const n = /d/.test(m[1]) ? (await new Roll(m[1]).evaluate()).total : Number(m[1]);
  if (m[2] === "раунд") return { rounds: n };
  const perUnit = { минут: 1, час: 60, дн: 1440, ден: 1440, недел: 10080 }[m[2]];
  return { minutes: n * perUnit };
}

/** Собрать данные баффа для флагов карточки и для наложения. */
export function buffData(item, caster, cfg, duration) {
  return {
    name: item.name, img: item.img,
    changes: foundry.utils.deepClone(cfg.changes ?? []),
    immune: cfg.immune ?? [], rollMods: cfg.rollMods ?? null, statuses: cfg.statuses ?? [],
    vision: cfg.vision ?? null,
    casterUuid: caster.uuid, itemId: item.id,
    ...duration
  };
}

/** Наложить бафф; такой же от того же заклинания заменяется. */
export async function applyBuff(actor, buff) {
  const same = actor.effects.filter(e => e.flags?.vedmak?.spellBuff?.name === buff.name).map(e => e.id);
  if (same.length) await actor.deleteEmbeddedDocuments("ActiveEffect", same);
  const vedmak = { spellBuff: { name: buff.name, casterUuid: buff.casterUuid, itemId: buff.itemId, maintain: !!buff.maintain } };
  if (buff.immune?.length) vedmak.immune = buff.immune;
  if (buff.rollMods) vedmak.rollMods = buff.rollMods;
  // Вне боя раунды не отсчитываются — такой срок ставится временем мира
  const combat = inCombat(actor);
  if (buff.rounds && combat) vedmak.timed = { rounds: buff.rounds, key: `buff:${buff.name}` };
  const effect = {
    name: buff.name, img: buff.img, transfer: false,
    system: { changes: buff.changes ?? [] },
    statuses: buff.statuses ?? [],
    flags: { vedmak }
  };
  if (buff.minutes) effect.duration = { value: buff.minutes, units: "minutes" };
  else if (buff.rounds && !combat) effect.duration = roundsAsTime(buff.rounds);
  const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [effect]);
  if (created && buff.vision) await applyVision(actor, created, buff.vision);
  return created;
}

/** Строка в карточку: что даёт бафф и сколько держится. */
export function buffLine(buff) {
  const bits = [describeChanges(buff.changes)];
  if (buff.immune?.length) bits.push(`невосприимчивость: ${buff.immune.map(id => CONFIG.statusEffects.find(e => e.id === id)?.name ?? id).join(", ").toLowerCase()}`);
  const r = buff.rollMods;
  if (r?.all) bits.push(`+${r.all} ко всем броскам`);
  else if (r) bits.push(...[["attack", "атаке"], ["defense", "защите"], ["skill", "проверкам"]].filter(([k]) => r[k]).map(([k, l]) => `+${r[k]} к ${l}`));
  if (buff.vision) bits.push(`зрение в темноте ${buff.vision.range} м`);
  if (buff.statuses?.includes("invisible")) bits.push("невидимость");
  const time = buff.rounds ? `${buff.rounds} раундов` : buff.minutes ? `${buff.minutes >= 60 && buff.minutes % 60 === 0 ? `${buff.minutes / 60} ч` : `${buff.minutes} мин`}`
    : buff.maintain ? "пока поддерживается" : "";
  return `${buff.name}: ${bits.filter(Boolean).join(" · ")}${time ? ` (${time})` : ""}.`;
}

/** Конец поддержания: снять баффы этого заклинания со всех, на ком они висят (у активного ведущего). */
export function registerBuffHooks() {
  Hooks.on("deleteActiveEffect", effect => {
    const maintain = effect.flags?.vedmak?.maintain;
    const caster = effect.parent;
    if (!maintain || caster?.documentName !== "Actor" || !game.users.activeGM?.isSelf) return;
    const actors = new Set([caster, ...game.actors, ...(canvas?.tokens?.placeables ?? []).map(t => t.actor).filter(Boolean)]);
    for (const actor of actors) {
      const ids = actor.effects.filter(e => {
        const b = e.flags?.vedmak?.spellBuff;
        return b?.maintain && b.casterUuid === caster.uuid && b.itemId === maintain.itemId;
      }).map(e => e.id);
      if (ids.length) actor.deleteEmbeddedDocuments("ActiveEffect", ids).catch(err => console.error("vedmak | баффы", err));
    }
  });
}
