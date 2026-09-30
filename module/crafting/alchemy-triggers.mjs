// Как действуют эликсиры и отвары после приёма (справочник — config/alchemy-auto.mjs):
// невосприимчивость к состояниям, зрение токена, срабатывания от убийства, попадания и полученного урона.

const { DialogV2 } = foundry.applications.api;

const M = (key, value) => ({ key, type: "add", value, phase: "initial" });

/** Эффекты актора с флагом vedmak.<key>. */
const flagged = (actor, key) => (actor?.effects ?? []).filter(e => !e.disabled && e.flags?.vedmak?.[key]);

/** Заменить одно изменение эффекта: остальные изменения остаются. */
function withChange(effect, key, value) {
  const rest = (effect.system?.changes ?? []).filter(c => c.key !== key);
  return value ? [...rest, M(key, value)] : rest;
}

const statusName = id => CONFIG.statusEffects.find(e => e.id === id)?.name ?? id;

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
  const prev = {};
  for (const token of actor.getActiveTokens(false, true)) {
    const sight = token.sight ?? {};
    prev[token.uuid] = { enabled: sight.enabled, visionMode: sight.visionMode, range: sight.range };
    try {
      await token.update({
        "sight.enabled": true, "sight.visionMode": vision.visionMode,
        "sight.range": Math.max(Number(sight.range) || 0, vision.range)
      });
    } catch (err) {
      console.warn("vedmak | зрение токена", err);
    }
  }
  if (Object.keys(prev).length) await effect.setFlag("vedmak", "visionPrev", prev);
  return Object.keys(prev).length;
}

async function restoreVision(effect) {
  for (const [uuid, sight] of Object.entries(effect.flags.vedmak.visionPrev)) {
    const token = fromUuidSync(uuid);
    if (!token) continue;
    await token.update({ "sight.enabled": sight.enabled, "sight.visionMode": sight.visionMode, "sight.range": sight.range });
  }
}

/* ------------------------------- Лечение крита ------------------------------- */

/** «Последняя надежда»: одно критическое ранение на выбор становится вылеченным. */
export async function healCritDialog(actor) {
  const wounds = (actor.itemTypes.critWound ?? []).filter(w => w.system.state !== "treated");
  if (!wounds.length) return ["Критических ранений нет — эффекта нет."];
  const options = wounds.map(w => `<option value="${w.id}">${w.name}</option>`).join("");
  const id = await DialogV2.wait({
    window: { title: "Какое ранение вылечить", icon: "fa-solid fa-kit-medical" },
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
 * @param {object} info — dealt: сколько ПЗ снято, hpBefore: ПЗ до удара, physical: не магия
 * @returns {Promise<string[]>}
 */
export async function alchemyAfterDamage(attacker, target, { dealt, hpBefore, physical }) {
  const lines = [];
  if (dealt > 0) {
    // Отвар из грифона: больше 5 урона — +2 ПБ, складывается
    for (const e of flagged(target, "onDamaged")) {
      const cfg = e.flags.vedmak.onDamaged;
      if (dealt <= cfg.over) continue;
      const stacks = (e.flags.vedmak.stacks ?? 0) + 1;
      await e.update({ "system.changes": withChange(e, "system.fx.sp", stacks * cfg.sp), "flags.vedmak.stacks": stacks });
      lines.push(`${e.name}: ПБ +${stacks * cfg.sp}.`);
    }
    // Отвар из виверны: ранили — накопленное пропадает
    for (const e of flagged(target, "onHit")) {
      if (!e.flags.vedmak.stacks) continue;
      await e.update({ "system.changes": withChange(e, "system.fx.damage", 0), "flags.vedmak.stacks": 0 });
      lines.push(`${e.name}: накопленный урон пропал.`);
    }
  }
  if (!attacker || attacker === target || dealt <= 0) return lines;

  // Отвар из виверны: каждое попадание +1 к урону следующего удара
  for (const e of flagged(attacker, "onHit")) {
    const stacks = (e.flags.vedmak.stacks ?? 0) + 1;
    await e.update({ "system.changes": withChange(e, "system.fx.damage", stacks * e.flags.vedmak.onHit.damage), "flags.vedmak.stacks": stacks });
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
      await e.update(update);
      lines.push(cfg.regen ? `${attacker.name}, ${e.name}: регенерация ${(e.flags.vedmak.regen ?? 0) + cfg.regen} ПЗ за ход.`
        : `${attacker.name}, ${e.name}: бонус за убийство.`);
    }
  }
  return lines;
}

/** Сколько костей адреналина за крит: «Лес Марибора» — две. */
export const adrenalinePerCrit = actor => flagged(actor, "doubleAdrenaline").length ? 2 : 1;

/** Конец боя: отвары «до конца боя» теряют накопленное. */
async function resetCombatStacks(combat) {
  for (const c of combat.combatants) {
    for (const e of [...flagged(c.actor, "onHit"), ...flagged(c.actor, "onKill")]) {
      if (!e.flags.vedmak.stacks) continue;
      const update = { "flags.vedmak.stacks": 0 };
      if (e.flags.vedmak.onHit) update["system.changes"] = withChange(e, "system.fx.damage", 0);
      if (e.flags.vedmak.onKill?.regen) update["flags.vedmak.regen"] = 0;
      if (e.flags.vedmak.onKill?.changes) continue; // «Пурга» держится, пока действует эликсир
      await e.update(update);
    }
  }
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
  });
}
