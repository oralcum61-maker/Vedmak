// Как действуют эликсиры и отвары после приёма (справочник — config/alchemy-auto.mjs):
// невосприимчивость к состояниям, зрение токена, срабатывания от убийства, попадания и полученного урона.

import { inCombat, roundsAsTime } from "../util.mjs";

const { DialogV2 } = foundry.applications.api;

const M = (key, value) => ({ key, type: "add", value, phase: "initial" });

/**
 * Действующие эффекты актора с флагом vedmak.<key>. `active`, а не `!disabled`: истёкший по времени эффект v14
 * не удаляет, а только помечает `duration.expired` — его флаги тоже должны перестать действовать.
 */
const flagged = (actor, key) => (actor?.effects ?? []).filter(e => e.active && e.flags?.vedmak?.[key]);

/** Заменить одно изменение эффекта: остальные изменения остаются. */
function withChange(effect, key, value) {
  const rest = (effect.system?.changes ?? []).filter(c => c.key !== key);
  return value ? [...rest, M(key, value)] : rest;
}

const statusName = id => CONFIG.statusEffects[id]?.name ?? id;

/* ---------------------------- Невосприимчивость ---------------------------- */

/** Состояния, к которым актор сейчас невосприимчив. */
export function immuneStatuses(actor) {
  const out = new Set();
  for (const e of flagged(actor, "immune")) for (const s of e.flags.vedmak.immune) out.add(s);
  return out;
}

/* ---------------------------------- Зрение ---------------------------------- */

/** Зрение токенов актора на время эффекта; прежнее запоминается в эффекте. */
export async function applyVision(actor, effect, vision) {
  // Список, а не объект по UUID: ключи с точками («Scene.x.Token.y») флаг разворачивает во вложенные объекты
  const prev = [];
  const updates = [];
  for (const token of actor.getActiveTokens(false, true)) {
    const sight = token.sight ?? {};
    prev.push({ uuid: token.uuid, enabled: sight.enabled, visionMode: sight.visionMode, range: sight.range });
    updates.push(token.update({
      "sight.enabled": true, "sight.visionMode": vision.visionMode,
      "sight.range": Math.max(Number(sight.range) || 0, vision.range)
    }).catch(err => console.warn("vedmak | зрение токена", err)));
  }
  await Promise.all(updates);
  if (prev.length) await effect.setFlag("vedmak", "visionPrev", prev);
  return prev.length;
}

/** Сохранённое зрение: список или (у эффектов до исправления) вложенный объект Scene → id → Token → id. */
function savedVision(saved) {
  if (Array.isArray(saved)) return saved;
  const out = [];
  for (const [sceneId, scene] of Object.entries(saved?.Scene ?? {})) {
    for (const [tokenId, sight] of Object.entries(scene?.Token ?? {})) out.push({ uuid: `Scene.${sceneId}.Token.${tokenId}`, ...sight });
  }
  return out;
}

async function restoreVision(effect) {
  await Promise.all(savedVision(effect.flags.vedmak.visionPrev).map(({ uuid, ...sight }) =>
    fromUuidSync(uuid)?.update({ "sight.enabled": sight.enabled, "sight.visionMode": sight.visionMode, "sight.range": sight.range })));
}

/* ------------------------------- Лечение крита ------------------------------- */

/** «Последняя надежда»: одно критическое ранение на выбор становится вылеченным. */
export async function healCritDialog(actor) {
  const wounds = (actor.itemTypes.critWound ?? []).filter(w => w.system.state !== "treated");
  if (!wounds.length) return ["Критических ранений нет — эффекта нет."];
  const options = wounds.map(w => `<option value="${w.id}">${w.name}</option>`).join("");
  const id = await DialogV2.wait({
    window: { title: "Какое ранение вылечить" },
    classes: ["vedmak", "vedmak-dialog"],
    content: `<div class="vedmak-roll-dialog"><select name="wound">${options}</select></div>`,
    buttons: [{ action: "ok", label: "Вылечить", default: true, callback: (e, b) => b.form.elements.wound.value }],
    rejectClose: false
  });
  const wound = actor.items.get(id);
  if (!wound) return [];
  await wound.update({ "system.state": "treated" });
  return [`${wound.name}: вылечено. Заново оно заживёт только после Лечащего прикосновения СЛ 24.`];
}

/* ------------------------------ Срабатывания ------------------------------ */

/**
 * После применения урона (у ведущего): отвары грифона и виверны, «Молния», убийства для «Пурги»
 * и кладбищенской бабы.
 * @param {Actor|null} attacker
 * @param {Actor} target
 * @param {object} info — dealt: сколько ПЗ снято, hpBefore: ПЗ до удара, physical: не магия, bite: укус или кровь
 * @returns {Promise<string[]>}
 */
export async function alchemyAfterDamage(attacker, target, { dealt, hpBefore, physical, bite = false }) {
  const lines = [];
  // «Чёрная кровь»: укусивший ведьмака отравлен (3 урона за раунд до Стойкости) и отскакивает на 2 м (стр. 247)
  if (bite && attacker && attacker !== target) {
    const blood = flagged(target, "blackBlood")[0];
    if (blood && !attacker.statuses.has("poisoned") && !immuneStatuses(attacker).has("poisoned")
      && !attacker.system.immunities?.includes?.("poison")) {
      await attacker.toggleStatusEffect("poisoned", { active: true });
      lines.push(`${attacker.name}: ${blood.name} — отравлен, пока не пройдёт Стойкость СЛ ${blood.flags.vedmak.blackBlood.dc ?? 20}; отскакивает на 2 м.`);
    }
  }
  if (dealt > 0) {
    // Изменения эффектов цели — одним запросом
    const updates = [];
    // Отвар из грифона: больше 5 урона — +2 ПБ, складывается
    for (const e of flagged(target, "onDamaged")) {
      const cfg = e.flags.vedmak.onDamaged;
      if (dealt <= cfg.over) continue;
      const stacks = (e.flags.vedmak.stacks ?? 0) + 1;
      updates.push({ _id: e.id, "system.changes": withChange(e, "system.fx.sp", stacks * cfg.sp), "flags.vedmak.stacks": stacks });
      lines.push(`${e.name}: ПБ +${stacks * cfg.sp}.`);
    }
    // Отвар из виверны: ранили — накопленное пропадает
    for (const e of flagged(target, "onHit")) {
      if (!e.flags.vedmak.stacks) continue;
      updates.push({ _id: e.id, "system.changes": withChange(e, "system.fx.damage", 0), "flags.vedmak.stacks": 0 });
      lines.push(`${e.name}: накопленный урон пропал.`);
    }
    if (updates.length) await target.updateEmbeddedDocuments("ActiveEffect", updates);
  }
  if (!attacker || attacker === target || dealt <= 0) return lines;

  // Изменения эффектов нападающего — тоже одним запросом
  const updates = [];
  // Отвар из виверны: каждое попадание +1 к урону следующего удара
  for (const e of flagged(attacker, "onHit")) {
    const stacks = (e.flags.vedmak.stacks ?? 0) + 1;
    updates.push({ _id: e.id, "system.changes": withChange(e, "system.fx.damage", stacks * e.flags.vedmak.onHit.damage), "flags.vedmak.stacks": stacks });
    lines.push(`${attacker.name}, ${e.name}: +${stacks * e.flags.vedmak.onHit.damage} к урону следующего удара.`);
  }
  // «Молния»: бонус к одной физической атаке
  if (physical) {
    const spent = flagged(attacker, "untilHit");
    if (spent.length) {
      await attacker.deleteEmbeddedDocuments("ActiveEffect", spent.map(e => e.id));
      lines.push(`${attacker.name}: ${spent.map(e => e.name).join(", ")} — потрачено.`);
    }
  }
  // Убийство — цель впервые ушла ниже 0 ПЗ
  if (hpBefore >= 0 && target.system.hp.value < 0) {
    for (const e of flagged(attacker, "onKill")) {
      const cfg = e.flags.vedmak.onKill;
      const stacks = e.flags.vedmak.stacks ?? 0;
      if (cfg.once && stacks) continue;
      const update = { "flags.vedmak.stacks": stacks + 1 };
      if (cfg.changes) update["system.changes"] = [...(e.system?.changes ?? []), ...cfg.changes];
      if (cfg.regen) update["flags.vedmak.regen"] = (e.flags.vedmak.regen ?? 0) + cfg.regen;
      // Виверна и «Пурга» — флаг onHit и onKill разом в одном эффекте не встречаются, но на всякий случай сливаем
      const same = updates.find(u => u._id === e.id);
      if (same) Object.assign(same, update);
      else updates.push({ _id: e.id, ...update });
      lines.push(cfg.regen ? `${attacker.name}, ${e.name}: регенерация ${(e.flags.vedmak.regen ?? 0) + cfg.regen} ПЗ за ход.`
        : `${attacker.name}, ${e.name}: бонус за убийство.`);
    }
  }
  if (updates.length) await attacker.updateEmbeddedDocuments("ActiveEffect", updates);
  return lines;
}

/** Сколько костей адреналина за крит: «Лес Марибора» — две. */
export const adrenalinePerCrit = actor => flagged(actor, "doubleAdrenaline").length ? 2 : 1;

/** Конец боя: отвары «до конца боя» теряют накопленное. */
async function resetCombatStacks(combat) {
  const actors = new Set(combat.combatants.map(c => c.actor).filter(Boolean));
  await Promise.all([...actors].map(actor => {
    const updates = [];
    for (const e of new Set([...flagged(actor, "onHit"), ...flagged(actor, "onKill")])) {
      if (!e.flags.vedmak.stacks) continue;
      if (e.flags.vedmak.onKill?.changes) continue; // «Пурга» держится, пока действует эликсир
      const update = { _id: e.id, "flags.vedmak.stacks": 0 };
      if (e.flags.vedmak.onHit) update["system.changes"] = withChange(e, "system.fx.damage", 0);
      if (e.flags.vedmak.onKill?.regen) update["flags.vedmak.regen"] = 0;
      updates.push(update);
    }
    return updates.length ? actor.updateEmbeddedDocuments("ActiveEffect", updates) : null;
  }));
}

export function registerAlchemyHooks() {
  // Невосприимчивость: статус просто не накладывается
  Hooks.on("preCreateActiveEffect", effect => {
    const actor = effect.parent;
    if (actor?.documentName !== "Actor" || !effect.statuses?.size) return;
    const immune = immuneStatuses(actor);
    const blocked = [...effect.statuses].filter(s => immune.has(s));
    if (!blocked.length) return;
    ui.notifications.info(`${actor.name}: невосприимчив — ${blocked.map(statusName).join(", ")}.`);
    return false;
  });
  // Зрение возвращает тот, кто снял эффект
  Hooks.on("deleteActiveEffect", (effect, options, userId) => {
    if (!effect.flags?.vedmak?.visionPrev || userId !== game.user.id) return;
    restoreVision(effect).catch(err => console.warn("vedmak | зрение токена", err));
  });
  Hooks.on("deleteCombat", combat => {
    if (!game.users.activeGM?.isSelf) return;
    resetCombatStacks(combat).catch(err => console.error("vedmak | отвары", err));
    roundsToTime(combat).catch(err => console.error("vedmak | срок эффектов после боя", err));
  });
  // Срок вышел: v14 только помечает `duration.expired`. Вне боя зелья и заклинания снимаем сразу — вместе
  // с ними уходят флаги и возвращается зрение; в бою их снимает начало хода с записью в чат (expireAlchemy)
  Hooks.on("updateActiveEffect", (effect, changes) => {
    if (changes.duration?.expired !== true || !game.users.activeGM?.isSelf) return;
    const f = effect.flags?.vedmak ?? {};
    const actor = effect.parent;
    if (!(f.alchemy || f.spellBuff) || actor?.documentName !== "Actor" || inCombat(actor)) return;
    effect.delete().catch(err => console.warn("vedmak | снятие истёкшего эффекта", err));
  });
}

/** Бой кончился: несошедший остаток раундов у зелий и заклинаний становится временем, иначе они вечны. */
async function roundsToTime(combat) {
  const now = game.time.worldTime;
  for (const actor of new Set(combat.combatants.map(c => c.actor).filter(Boolean))) {
    const updates = actor.effects.filter(e => {
      const f = e.flags?.vedmak ?? {};
      return (f.alchemy || f.spellBuff) && f.timed?.rounds > 0;
    }).map(e => ({
      _id: e.id, "flags.vedmak.timed.rounds": 0,
      start: { time: now, combat: null, combatant: null, initiative: null, round: null, turn: null },
      duration: { ...roundsAsTime(e.flags.vedmak.timed.rounds), expired: false }
    }));
    if (updates.length) await actor.updateEmbeddedDocuments("ActiveEffect", updates);
    // Истёкшие в последнем раунде: начало хода, которое их сняло бы, уже не наступит, а реестр Foundry
    // неактивные эффекты не отслеживает — без этого они висели бы вечно вместе со зрением
    const expired = actor.effects.filter(e => (e.flags?.vedmak?.alchemy || e.flags?.vedmak?.spellBuff) && e.duration?.expired)
      .map(e => e.id);
    if (expired.length) await actor.deleteEmbeddedDocuments("ActiveEffect", expired);
  }
}
