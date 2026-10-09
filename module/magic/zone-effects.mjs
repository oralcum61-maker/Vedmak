// Зоны и движение токенов (у активного ведущего):
// - аура зоны (Ирден, config/magic.mjs ZONE_AURAS): вошёл — эффект со штрафом, вышел или зона снята — эффект снят;
// - долгая зона с уроном или статусами бьёт того, кто вошёл в неё посреди раунда, — раз за раунд на токен
//   (в начале хода заклинателя она бьёт всех внутри, cast.mjs repeatZonesForTurn).
// Вход — центр токена был вне зоны в начале движения и внутри в конце (`moveToken` приходит до смены x/y документа).

import { zonesOf, pointInZone } from "../combat/zones.mjs";
import { resolveActor } from "../combat/common.mjs";
import { postZoneRepeat } from "./cast.mjs";

const SYS = "vedmak";
const isActiveGM = () => game.users.activeGM?.isSelf;
const auraEffects = (actor, regionId) => actor?.effects?.filter(e => e.flags?.[SYS]?.zoneAura === regionId) ?? [];

/** Снять эффекты ауры, которые ещё есть: их мог уже снять другой токен того же актора или ведущий руками. */
async function dropAura(actor, regionId) {
  const ids = auraEffects(actor, regionId).map(e => e.id).filter(id => actor.effects.has(id));
  if (!ids.length) return;
  try {
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  } catch (err) {
    // Сняли одновременно с нами (истёк, убран руками) — это не ошибка
    if (ids.some(id => actor.effects.has(id))) throw err;
  }
}

/** Поставить или снять эффект ауры зоны на акторе токена. Заклинателя аура не трогает. */
async function setAura(tokenDoc, region, inside) {
  const actor = tokenDoc.actor;
  const z = region.flags[SYS].zone;
  if (!actor || !z.aura) return;
  const existing = auraEffects(actor, region.id);
  // Штраф ауры (Ирден) заклинателя не трогает; облако лунной пыли проявляет и бросившего
  if (!inside || (actor.uuid === z.actorUuid && z.aura.stats?.length)) {
    if (existing.length) await dropAura(actor, region.id);
    return;
  }
  if (existing.length) return;
  const value = Math.max(0, Number(z.aura.value) || 0);
  const changes = value ? (z.aura.stats ?? []).map(k => ({ key: `system.stats.${k}.mod`, type: "add", value: String(-value), phase: "initial" })) : [];
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: z.aura.label, img: z.aura.img || "icons/magic/symbols/runes-triangle-magenta.webp",
    system: { changes }, description: value ? `${z.aura.text} Штраф −${value}.` : z.aura.text,
    // reveals — проявлен: «Покров» слабее (statusRollMods)
    flags: { [SYS]: { zoneAura: region.id, reveals: !!z.aura.reveals } }
  }]);
}

/** Вошёл в долгую зону посреди раунда: удар зоны по нему одному, не чаще раза за раунд. */
async function enterRepeatZone(region, tokenDoc) {
  const z = region.flags[SYS].zone;
  const combat = game.combat;
  if (!combat?.started || (z.combatId && z.combatId !== combat.id)) return;
  const caster = resolveActor(z.actorUuid);
  if (!caster || tokenDoc.actor?.uuid === z.actorUuid) return;
  if (tokenDoc.actor?.statuses?.has(CONFIG.specialStatusEffects.DEFEATED)) return;
  if (z.entered?.[tokenDoc.id] === combat.round) return;
  await region.update({ [`flags.${SYS}.zone.entered.${tokenDoc.id}`]: combat.round });
  await postZoneRepeat(caster, region, [tokenDoc], { round: combat.round, note: `${tokenDoc.name} входит в зону посреди раунда.` });
}

async function onMove(tokenDoc, movement) {
  const scene = tokenDoc.parent;
  const zones = zonesOf(scene).filter(r => r.flags[SYS].zone.aura || r.flags[SYS].zone.repeat);
  if (!zones.length) return;
  // В момент хука документ ещё в прежней точке: где токен теперь — последняя пройденная точка движения
  const at = movement?.passed?.waypoints?.at(-1) ?? movement?.destination;
  const now = tokenDoc.getCenterPoint(at ?? {});
  const before = movement?.origin ? tokenDoc.getCenterPoint(movement.origin) : null;
  for (const region of zones) {
    const z = region.flags[SYS].zone;
    const inside = pointInZone(region, now);
    const wasInside = before ? pointInZone(region, before) : false;
    if (z.aura) await setAura(tokenDoc, region, inside);
    if (z.repeat && inside && !wasInside) await enterRepeatZone(region, tokenDoc);
  }
}

export function registerZoneEffectHooks() {
  Hooks.on("moveToken", (tokenDoc, movement) => {
    if (!isActiveGM()) return;
    onMove(tokenDoc, movement).catch(err => console.error("vedmak | зоны и движение", err));
  });
  // Новая зона с аурой: эффект всем, кто уже внутри
  Hooks.on("createRegion", region => {
    if (!isActiveGM() || !region.flags?.[SYS]?.zone?.aura) return;
    const run = async () => {
      for (const t of region.parent?.tokens ?? []) await setAura(t, region, pointInZone(region, t.getCenterPoint()));
    };
    run().catch(err => console.error("vedmak | аура зоны", err));
  });
  // Зона снята: её эффекты уходят со всех токенов сцены
  Hooks.on("deleteRegion", region => {
    if (!isActiveGM() || !region.flags?.[SYS]?.zone?.aura) return;
    const run = async () => {
      // Связанный актор с несколькими токенами на сцене — один раз, иначе второй раз удалялся бы тот же эффект
      const actors = new Set((region.parent?.tokens ?? []).map(t => t.actor).filter(Boolean));
      for (const actor of actors) await dropAura(actor, region.id);
    };
    run().catch(err => console.error("vedmak | аура зоны", err));
  });
}
