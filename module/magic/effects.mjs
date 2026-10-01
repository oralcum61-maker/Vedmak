// Эффекты магии на целях и их обслуживание в начале хода: статусы с длительностью,
// регенерация, щиты, поддержание активных заклинаний, порча.

import { STATUS_RESIST_KEY } from "../config/combat.mjs";
import { resolveActor, registerGMHandler, asGM, postCard, userOwnsAny } from "../combat/common.mjs";
import { applyStatus, removeShieldEffects, applyingMessages } from "../combat/damage.mjs";
import { applyRegen, applyHex, addVigorUsed } from "./cast.mjs";
import { applyBuff, buffLine } from "./buffs.mjs";
import { isMagicTimed, timeIsUp, zeroShield } from "./timed.mjs";
import { performCheck } from "../dice/check.mjs";
import { RITUAL_INTERRUPTIONS as INTERRUPTIONS } from "../config/magic.mjs";
import { SKILLS } from "../config/skills.mjs";

/** Кнопка «Применить эффекты» в карточке защиты от магии без урона. */
export async function requestSpellEffects(message) {
  const def = message.flags.vedmak?.defense;
  if (!def?.canApplyEffects) return;
  if (def.effectsApplied) return ui.notifications.info("Эффекты уже применены.");
  const attacker = resolveActor(def.attack.attacker.tokenUuid) ?? resolveActor(def.attack.attacker.actorUuid);
  if (!game.user.isGM && !attacker?.isOwner) return ui.notifications.warn("Применить эффекты может заклинатель или ведущий.");
  return asGM("applySpellEffects", { messageId: message.id });
}

registerGMHandler("applySpellEffects", async ({ messageId }, userId) => {
  // Флаг effectsApplied ставится только в конце — не даём второму запросу наложить эффекты повторно
  if (applyingMessages.has(messageId)) return;
  applyingMessages.add(messageId);
  try {
    await applySpellEffectsNow(messageId, userId);
  } finally {
    applyingMessages.delete(messageId);
  }
});

async function applySpellEffectsNow(messageId, userId) {
  const message = game.messages.get(messageId);
  const def = message?.flags.vedmak?.defense;
  if (!def || def.effectsApplied) return;
  const spell = def.attack.spell;
  const actor = resolveActor(def.defender.tokenUuid) ?? resolveActor(def.defender.actorUuid);
  if (!actor || !spell) return;
  // Запрос игрока: он заклинатель (как у кнопки), а карточку защиты создал кто-то из участников —
  // иначе эффекты можно наложить на любую цель подделанной карточкой
  const caster = resolveActor(def.attack.attacker.tokenUuid) ?? resolveActor(def.attack.attacker.actorUuid);
  if (!game.users.get(userId)?.isGM
    && (!userOwnsAny(userId, caster) || !userOwnsAny(message.author?.id, caster, actor))) {
    return console.warn(`vedmak | отклонён запрос эффектов заклинания от ${game.users.get(userId)?.name ?? userId}`);
  }
  const lines = [];
  const rolls = [];

  for (const st of spell.statuses ?? []) {
    const resistKey = STATUS_RESIST_KEY[st.status];
    const label = CONFIG.statusEffects[st.status]?.name ?? st.status;
    if (resistKey && actor.system.immunities?.includes?.(resistKey)) { lines.push(`${label}: невосприимчив.`); continue; }
    let ok = true, rollText = "";
    // «Буря» у заклинателя: +10% поджечь, заморозить, сбить с ног
    const chance = ["burning", "frozen", "prone"].includes(st.status)
      ? Math.min(100, st.chance + (caster?.system.fx?.statusChance ?? 0)) : st.chance;
    if (chance < 100) {
      const r = await new Roll("1d100").evaluate();
      rolls.push(r);
      ok = r.total <= chance;
      rollText = ` (${chance}%: ${r.total})`;
    }
    if (ok) await applyStatus(actor, st.status, spell.statusRounds);
    lines.push(`${label}${rollText}: ${ok ? "да" : "нет"}.`);
  }
  if (spell.regen) {
    const { term } = await applyRegen(actor, { ...spell.regen, name: def.attack.label, img: def.attack.img });
    lines.push(`Регенерация: +${spell.regen.hp} ПЗ за ход${term}.`);
  }
  if (spell.hex) {
    const item = caster?.items.get(spell.itemId);
    if (item) { await applyHex(actor, item); lines.push(`Наложена порча «${item.name}».`); }
  }
  if (spell.buff) {
    await applyBuff(actor, spell.buff);
    lines.push(buffLine(spell.buff));
  }

  await message.setFlag("vedmak", "defense.effectsApplied", true);
  await postCard({
    template: "systems/vedmak/templates/chat/turn.hbs",
    data: { title: `${def.attack.label} → ${actor.name}`, img: def.attack.img, round: null, lines, buttons: [] },
    actor, rolls, flags: { spellEffects: { messageId } }
  });
}

/* -------------------------------------------------------------------------- */
/*  Начало хода                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Обслужить магические эффекты актора в начале его хода.
 * @returns {Promise<string[]>} строки отчёта
 */
export async function magicStartOfTurn(actor) {
  const lines = [];
  const toDelete = [];
  const sys = actor.system;

  // Поддержание активных заклинаний
  let sta = sys.sta.value;
  const ended = new Set(); // заклинания, чьё поддержание прекратилось сейчас
  for (const effect of actor.effects.filter(e => e.flags?.vedmak?.maintain)) {
    const cost = effect.flags.vedmak.maintain.cost ?? 0;
    if (sta >= cost) {
      sta -= cost;
      lines.push(`${effect.name}: −${cost} Вын.`);
      await addVigorUsed(actor, cost);
    } else {
      toDelete.push(effect.id);
      ended.add(effect.flags.vedmak.maintain.itemId);
      lines.push(`${effect.name}: не хватает Вын — заклинание прекращено.`);
      if (effect.flags.vedmak.maintain.shield) await zeroShield(actor);
    }
  }
  if (sta !== sys.sta.value) await actor.update({ "system.sta.value": sta });

  // Срок во времени (вне боя раунды не считаются) вышел, а v14 пометит это только после начала хода —
  // снимаем сейчас, без лишнего тика регенерации
  for (const effect of actor.effects.filter(e => isMagicTimed(e) && timeIsUp(e))) {
    toDelete.push(effect.id);
    lines.push(`${effect.name}: ${effect.flags.vedmak.statusRounds !== undefined ? "прошло" : "действие закончилось"}.`);
    if (effect.flags.vedmak.timed?.key === "shield") await zeroShield(actor);
  }

  // Регенерация и щиты с отсчётом раундов
  let hp = actor.system.hp.value;
  for (const effect of actor.effects.filter(e => e.flags?.vedmak?.timed)) {
    const timed = effect.flags.vedmak.timed;
    // Снятое выше, выключенное и истёкшее (в том числе зелья — их снимает expireAlchemy) не лечит
    if (toDelete.includes(effect.id) || !effect.active || timeIsUp(effect)) continue;
    // Регенерация поддерживаемого заклинания живёт, пока его поддерживают
    const link = effect.flags.vedmak.spellLink;
    if (link?.maintain && !isMaintained(link, actor, ended)) {
      toDelete.push(effect.id);
      lines.push(`${effect.name}: заклинание больше не поддерживается.`);
      continue;
    }
    if (effect.flags.vedmak.regen) {
      const heal = Math.min(effect.flags.vedmak.regen, Math.max(0, actor.system.hp.max - hp));
      if (heal) { hp += heal; lines.push(`${effect.name}: +${heal} ПЗ.`); }
    }
    if (timed.key === "shield" && !actor.system.shield.value) {
      toDelete.push(effect.id);
      continue;
    }
    if (timed.rounds > 0) {
      const left = timed.rounds - 1;
      if (left <= 0) {
        toDelete.push(effect.id);
        lines.push(`${effect.name}: действие закончилось.`);
        if (timed.key === "shield") await zeroShield(actor);
      } else {
        await effect.update({ "flags.vedmak.timed.rounds": left });
      }
    }
  }
  if (hp !== actor.system.hp.value) await actor.update({ "system.hp.value": hp });

  // Статусы с длительностью в раундах
  for (const effect of actor.effects.filter(e => e.flags?.vedmak?.statusRounds > 0 && !toDelete.includes(e.id))) {
    const left = effect.flags.vedmak.statusRounds - 1;
    if (left <= 0) {
      toDelete.push(effect.id);
      lines.push(`${effect.name}: прошло.`);
    } else {
      await effect.update({ "flags.vedmak.statusRounds": left });
    }
  }

  const unique = [...new Set(toDelete)].filter(id => actor.effects.has(id));
  if (unique.length) await actor.deleteEmbeddedDocuments("ActiveEffect", unique);
  return lines;
}

/** Поддерживает ли заклинатель заклинание из связи эффекта (ended — прекращённые в этот ход носителя). */
function isMaintained(link, actor, ended) {
  if (link.casterUuid === actor.uuid && ended.has(link.itemId)) return false;
  const caster = fromUuidSync(link.casterUuid);
  return !!caster?.effects?.some(e => e.flags?.vedmak?.maintain?.itemId === link.itemId);
}

/** Прекратить поддерживаемое заклинание (и щит, если это он). */
export async function endMaintained(actor, effectId) {
  const effect = actor.effects.get(effectId);
  if (!effect) return;
  if (effect.flags?.vedmak?.maintain?.shield) {
    // Без обнуления щит продолжал бы поглощать урон (damage.mjs смотрит на system.shield)
    await removeShieldEffects(actor);
    await zeroShield(actor);
  }
  if (actor.effects.has(effectId)) await effect.delete();
}

/* -------------------------------------------------------------------------- */
/*  Прерывание ритуала                                                        */
/* -------------------------------------------------------------------------- */

export async function ritualFocus(message) {
  const attack = message.flags.vedmak?.attack;
  const actor = resolveActor(attack?.attacker.tokenUuid) ?? resolveActor(attack?.attacker.actorUuid);
  if (!actor?.isOwner) return ui.notifications.warn("Концентрацию проверяет проводящий ритуал.");
  const options = Object.entries(INTERRUPTIONS).map(([k, v]) => `<option value="${k}">${v.label} (СЛ ${v.dc})</option>`).join("");
  const key = await foundry.applications.api.DialogV2.wait({
    window: { title: "Прерывание ритуала", icon: "fa-solid fa-circle-notch" },
    classes: ["vedmak", "vedmak-dialog"],
    content: `<div class="vedmak-roll-dialog"><div class="form-group"><label>Что случилось</label><select name="kind">${options}</select></div></div>`,
    buttons: [{ action: "ok", label: "Проверка", default: true, callback: (e, b) => b.form.elements.kind.value },
      { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  if (!key || key === "cancel") return;
  const skill = actor.system.skills.ritualCrafting;
  const will = actor.system.stats.will;
  return performCheck({
    actor, title: "Концентрация на ритуале", subtitle: INTERRUPTIONS[key].label,
    parts: [
      { label: will.label, value: will.effective, always: true },
      { label: SKILLS.ritualCrafting.label, value: skill.total, always: true },
      ...(skill.penalty ? [{ label: "Ранения и скованность", value: skill.penalty }] : [])
    ],
    dc: INTERRUPTIONS[key].dc
  });
}
