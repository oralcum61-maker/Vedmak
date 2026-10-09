// Баффы заклинаний на заклинателе и целях (справочник — config/spell-auto.mjs): эффект с изменениями,
// невосприимчивостью, модификаторами бросков, статусами и зрением. Срок — из поля «Длительность»:
// раунды считаются в начале хода носителя, минуты и часы — по мировому времени, «активное» —
// пока заклинатель поддерживает заклинание. Бонус к максимуму ПЗ (`system.fx.hp`) прибавляется и к текущим,
// а по окончании текущие не остаются выше максимума.

import { applyVision } from "../crafting/alchemy-triggers.mjs";
import { describeChanges } from "../config/effects.mjs";
import { inCombat, roundsAsTime } from "../util.mjs";
import { registerTimedHooks } from "./timed.mjs";

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

/* ------------------------------ Бонус к ПЗ ------------------------------ */

/** Сколько ПЗ изменения прибавляют к максимуму (`system.fx.hp`, «прибавить»). */
export function hpBonusOf(changes) {
  return (changes ?? []).filter(c => c.key === "system.fx.hp" && (c.type ?? "add") === "add")
    .reduce((sum, c) => sum + (Number(c.value) || 0), 0);
}

/**
 * Текущие ПЗ после конца бонуса к максимуму: не выше нового максимума, но запас сверх максимума,
 * который был и без бонуса (временные ПЗ зелий), не сгорает. max — максимум уже без бонуса.
 */
export function hpAfterBonus(hp, max, bonus) {
  return Math.min(hp, Math.max(max, hp - bonus));
}

/**
 * Урезать текущие ПЗ после конца бонуса к максимуму — сразу и с ожиданием записи. Нужна там, где за снятием
 * баффа идёт чтение ПЗ (начало хода: кровотечение пишет «ПЗ минус урон» от прочитанного значения), — отложенная
 * правка `clampHpLater` успевала бы после него и перезаписывала бы результат.
 */
export async function clampHpNow(actor, bonus) {
  const { value, max } = actor.system.hp;
  const hp = hpAfterBonus(value, max, bonus);
  if (hp !== value) await actor.update({ "system.hp.value": hp });
}

/**
 * Снять эффекты и, если среди них были баффы с бонусом к ПЗ, урезать ПЗ до возврата. Хук удаления такое снятие
 * пропускает (`vedmakHpHandled`), поэтому ПЗ правятся ровно один раз.
 */
export async function deleteEffectsClamped(actor, ids, options = {}) {
  const list = ids.filter(id => actor.effects.has(id));
  if (!list.length) return;
  const bonus = list.reduce((sum, id) => sum + (actor.effects.get(id).flags?.vedmak?.hpBonus ?? 0), 0);
  await actor.deleteEmbeddedDocuments("ActiveEffect", list, { ...options, vedmakHpHandled: true });
  if (bonus > 0) await clampHpNow(actor, bonus);
}

/** Снятые эффекты с бонусом к ПЗ, по акторам: несколько в одном удалении — одна правка. */
const endedHpBonus = new Map();

/** Урезание ПЗ для ручного удаления (хук): после всех хуков этого удаления, без ожидания. */
function clampHpLater(actor, bonus) {
  const queued = endedHpBonus.has(actor);
  endedHpBonus.set(actor, (endedHpBonus.get(actor) ?? 0) + bonus);
  if (queued) return;
  // Хуки удаления идут подряд для всех снятых эффектов — правка после них, одна на всех
  queueMicrotask(() => {
    const total = endedHpBonus.get(actor);
    endedHpBonus.delete(actor);
    const { value, max } = actor.system.hp;
    const hp = hpAfterBonus(value, max, total);
    if (hp !== value) actor.update({ "system.hp.value": hp }).catch(err => console.error("vedmak | ПЗ после баффа", err));
  });
}

/* --------------------------------- Баффы --------------------------------- */

/**
 * Наложить бафф; такой же от того же заклинания заменяется. Бонус к максимуму ПЗ прибавляется и к текущим
 * («дополнительно получает 25 ПЗ»); при замене прежний бонус сначала снимается.
 */
export async function applyBuff(actor, buff) {
  const same = actor.effects.filter(e => e.flags?.vedmak?.spellBuff?.name === buff.name);
  let hp = actor.system.hp.value;
  if (same.length) {
    const oldBonus = same.reduce((sum, e) => sum + (e.flags.vedmak.hpBonus ?? 0), 0);
    // ПЗ пересчитываются здесь, а не хуком удаления: иначе прибавка ниже прочла бы ещё не урезанные ПЗ
    await actor.deleteEmbeddedDocuments("ActiveEffect", same.map(e => e.id), { vedmakHpHandled: true });
    if (oldBonus) hp = hpAfterBonus(hp, actor.system.hp.max, oldBonus);
  }
  const hpBonus = hpBonusOf(buff.changes);
  const vedmak = { spellBuff: { name: buff.name, casterUuid: buff.casterUuid, itemId: buff.itemId, maintain: !!buff.maintain } };
  if (hpBonus > 0) vedmak.hpBonus = hpBonus;
  if (buff.immune?.length) vedmak.immune = buff.immune;
  if (buff.rollMods) vedmak.rollMods = buff.rollMods;
  // Бросок заклинателя и цена в Вын: по ним Рассеивание решает, снимается ли эффект (стр. 102)
  if (buff.cast) vedmak.cast = buff.cast;
  // Вне боя раунды не отсчитываются — такой срок ставится временем мира
  const combat = inCombat(actor);
  if (buff.rounds && combat) vedmak.timed = { rounds: buff.rounds, key: `buff:${buff.name}` };
  const effect = {
    name: buff.name, img: buff.img, transfer: false,
    system: { changes: buff.changes ?? [] },
    statuses: buff.statuses ?? [],
    flags: { vedmak }
  };
  // `expiry: null`: схема v14 для числового срока ставит «turnStart», и эффект участника боя по времени не снимается
  if (buff.minutes) effect.duration = { value: buff.minutes, units: "minutes", expiry: null };
  else if (buff.rounds && !combat) effect.duration = roundsAsTime(buff.rounds);
  const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [effect]);
  if (created && buff.vision) await applyVision(actor, created, buff.vision);
  if (created && hpBonus > 0) hp += hpBonus;
  if (hp !== actor.system.hp.value) await actor.update({ "system.hp.value": hp });
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

/** Эффекты, которые уже удаляются концом поддержания: второй снятый эффект того же заклинания их не трогает. */
const endingLinked = new Set();

/**
 * Конец поддержания: снять баффы и регенерацию этого заклинания со всех, на ком они висят (у активного ведущего).
 * Конец эффекта с бонусом к ПЗ: текущие ПЗ не выше нового максимума. Сроки щита, регенерации и статусов — timed.mjs.
 */
export function registerBuffHooks() {
  registerTimedHooks();
  // Правит тот, кто снял эффект: у него есть права на актора. К хуку данные актора уже без эффекта
  Hooks.on("deleteActiveEffect", (effect, options, userId) => {
    const bonus = effect.flags?.vedmak?.hpBonus;
    if (!(bonus > 0) || userId !== game.user.id || options?.vedmakHpHandled) return;
    if (effect.parent?.documentName === "Actor") clampHpLater(effect.parent, bonus);
  });
  Hooks.on("deleteActiveEffect", (effect, options) => {
    const maintain = effect.flags?.vedmak?.maintain;
    const caster = effect.parent;
    if (!maintain || caster?.documentName !== "Actor" || !game.users.activeGM?.isSelf) return;
    // Эффекты того же пакета удаления (сняли поддержание вместе с баффом) уже удаляются — второй раз их не трогаем
    const sameBatch = new Set(options?.ids ?? []);
    const actors = new Set([caster, ...game.actors, ...(canvas?.tokens?.placeables ?? []).map(t => t.actor).filter(Boolean)]);
    for (const actor of actors) {
      if (actor === caster && options?.deleteAll) continue;
      const ids = actor.effects.filter(e => {
        if (actor === caster && sameBatch.has(e.id)) return false;
        if (endingLinked.has(e.uuid)) return false;
        const b = e.flags?.vedmak?.spellBuff ?? e.flags?.vedmak?.spellLink;
        return b?.maintain && b.casterUuid === caster.uuid && b.itemId === maintain.itemId;
      }).map(e => e.id);
      if (!ids.length) continue;
      const uuids = ids.map(id => actor.effects.get(id).uuid);
      for (const u of uuids) endingLinked.add(u);
      actor.deleteEmbeddedDocuments("ActiveEffect", ids)
        .catch(err => { if (ids.some(id => actor.effects.has(id))) console.error("vedmak | баффы", err); })
        .finally(() => { for (const u of uuids) endingLinked.delete(u); });
    }
  });
}
