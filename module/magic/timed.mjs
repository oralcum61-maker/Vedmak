// Сроки магических эффектов вне боя (как у зелий, PLAN 4.37): щит, регенерация заклинаний, статусы на раунды.
// В бою их раунды отсчитывает начало хода носителя (magicStartOfTurn), а вне боя считать некому — поэтому
// там срок ставится временем мира, после боя остаток раундов становится временем, а истёкшие эффекты снимаются.

import { inCombat, roundsAsTime } from "../util.mjs";

/** Начало срока «сейчас», вне боя: как у зелий в alchemy-triggers.mjs. */
const startNow = () => ({ time: game.time.worldTime, combat: null, combatant: null, initiative: null, round: null, turn: null });

/** Эффекты магии со сроком, которые обслуживает этот модуль: щит, регенерация заклинаний, статусы на раунды. */
export function isMagicTimed(effect) {
  const f = effect.flags?.vedmak ?? {};
  const key = String(f.timed?.key ?? "");
  return key === "shield" || key.startsWith("regen:") || f.statusRounds !== undefined;
}

/** Эффект-метка щита (Квен, «Активный щит») или поддержание щита. */
export const isShieldEffect = effect => effect.flags?.vedmak?.timed?.key === "shield" || !!effect.flags?.vedmak?.maintain?.shield;

/**
 * Срок во времени вышел. v14 ставит `duration.expired` только после начала хода (и после хуков системы),
 * поэтому остаток пересчитывается здесь же — иначе регенерация успевает лишний раз.
 */
export function timeIsUp(effect) {
  if (effect.duration?.expired) return true;
  if (!effect.isTemporary) return false;
  return effect.updateDuration().remaining <= 0;
}

/** Обнулить магический щит актора (кончилось заклинание или его прекратили). */
export async function zeroShield(actor) {
  const shield = actor?.system.shield;
  if (shield?.value || shield?.max) await actor.update({ "system.shield.value": 0, "system.shield.max": 0 });
}

/** Бой кончился: остаток раундов щитов, регенерации и статусов становится временем, иначе они вечны. */
async function roundsToTime(combat) {
  for (const actor of new Set(combat.combatants.map(c => c.actor).filter(Boolean))) {
    const updates = [];
    for (const e of actor.effects) {
      if (!isMagicTimed(e)) continue;
      const f = e.flags.vedmak;
      const rounds = f.statusRounds > 0 ? f.statusRounds : f.timed?.rounds > 0 ? f.timed.rounds : 0;
      if (!rounds) continue;
      const update = { _id: e.id, start: startNow(), duration: { ...roundsAsTime(rounds), expired: false } };
      update[f.statusRounds > 0 ? "flags.vedmak.statusRounds" : "flags.vedmak.timed.rounds"] = 0;
      updates.push(update);
    }
    if (updates.length) await actor.updateEmbeddedDocuments("ActiveEffect", updates);
  }
}

/**
 * Статусу дали срок в раундах (`applyStatus` в damage.mjs). Вне боя — срок временем мира вместо счётчика;
 * в бою счётчик главный, поэтому прежний срок временем (с прошлой правки вне боя) снимается.
 */
async function statusRoundsChanged(effect, rounds) {
  const actor = effect.parent;
  if (!inCombat(actor)) {
    return effect.update({ "flags.vedmak.statusRounds": 0, start: startNow(), duration: { ...roundsAsTime(rounds), expired: false } });
  }
  // Без `expiry: null` эффект с бесконечным сроком v14 считает истёкшим в начале хода
  if (effect.isTemporary) return effect.update({ duration: { value: null, expiry: null, expired: false } });
}

export function registerTimedHooks() {
  Hooks.on("deleteCombat", combat => {
    if (!game.users.activeGM?.isSelf) return;
    roundsToTime(combat).catch(err => console.error("vedmak | срок магии после боя", err));
  });
  Hooks.on("updateActiveEffect", (effect, changes) => {
    if (!game.users.activeGM?.isSelf || effect.parent?.documentName !== "Actor") return;
    // Срок вышел: v14 только помечает `duration.expired`. Вне боя снимаем сразу (щит при этом обнуляется),
    // в бою — начало хода носителя с записью в чат (magicStartOfTurn)
    if (changes.duration?.expired === true) {
      if (isMagicTimed(effect) && !inCombat(effect.parent)) {
        effect.delete().catch(err => console.warn("vedmak | снятие истёкшего эффекта магии", err));
      }
      return;
    }
    const rounds = foundry.utils.getProperty(changes, "flags.vedmak.statusRounds");
    if (rounds > 0) statusRoundsChanged(effect, rounds).catch(err => console.warn("vedmak | срок статуса", err));
  });
  // Щит снят (срок, «прекратить», конец поддержания) — он больше не поглощает урон. Обнуляет тот, кто снял;
  // `vedmakKeepShield` — замена эффекта при новом сотворении, новый щит уже поставлен
  Hooks.on("deleteActiveEffect", (effect, options, userId) => {
    if (userId !== game.user.id || options?.vedmakKeepShield || !isShieldEffect(effect)) return;
    const actor = effect.parent;
    if (actor?.documentName !== "Actor" || actor.effects.some(isShieldEffect)) return;
    zeroShield(actor).catch(err => console.warn("vedmak | щит", err));
  });
}
