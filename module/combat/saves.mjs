// Испытания: Устойчивости (стр. 47) и против смерти (стр. 162). Успех — если d10 МЕНЬШЕ порога.

import { bindDialog, luckDots, luckNote } from "../dice/dialog-ui.mjs";
import { renderTemplate } from "../util.mjs";
import { defaultMessageMode } from "./common.mjs";

/** Сообщение-карточка испытания. Видимость — режим чата пользователя: без него v14 отдаёт карточку всем. */
async function saveCard(actor, data) {
  const content = await renderTemplate("systems/vedmak/templates/chat/save.hbs", data);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: data.rolls,
    flags: { vedmak: { save: { kind: data.kind, success: data.success, actorUuid: actor.uuid } } }
  }, { messageMode: defaultMessageMode() });
}

/**
 * Испытание Устойчивости. Провал — дезориентация.
 * @param {Actor} actor
 * @param {object} [opts]
 * @param {number} [opts.mod=0] — штраф/бонус к порогу (оружие «Дезориентирующее (−2)», бросок −1)
 * @param {string} [opts.reason]
 * @param {boolean} [opts.applyStatus=true]
 */
export async function rollStunSave(actor, { mod = 0, reason = "", applyStatus = true } = {}) {
  if (!actor) return null;
  if (actor.system.immunities?.includes?.("stun")) {
    return saveCard(actor, { kind: "stun", title: "Испытание Устойчивости", reason, immune: true, success: true });
  }
  const roll = await new Roll("1d10").evaluate();
  const base = actor.system.derived.stun;
  const resist = actor.system.resistances?.includes?.("stun") ? 2 : 0;
  const threshold = base + mod + resist;
  const success = roll.total < threshold;
  const parts = [{ label: "Устойчивость", value: base }];
  if (mod) parts.push({ label: "Модификатор", value: mod });
  if (resist) parts.push({ label: "Сопротивление дезориентации", value: resist });
  if (!success && applyStatus) await actor.toggleStatusEffect("disoriented", { active: true });
  return saveCard(actor, {
    kind: "stun", title: "Испытание Устойчивости", reason, parts, threshold, die: roll.total, success,
    rolls: [roll], outcome: success ? "Держится на ногах" : "Дезориентирован"
  });
}

/**
 * Испытание против смерти. Порог — Уст до штрафа «при смерти» минус накопленный штраф,
 * Удача прибавляется к порогу. После броска штраф растёт на 1.
 * @param {Actor} actor
 * @param {object} [opts]
 * @param {number} [opts.luck=0]
 * @param {string} [opts.reason]
 */
export async function rollDeathSave(actor, { luck = 0, reason = "" } = {}) {
  if (!actor) return null;
  const sys = actor.system;
  const roll = await new Roll("1d10").evaluate();
  const penalty = sys.deathSaves?.penalty ?? 0;
  luck = Math.max(0, Math.min(luck, sys.luck?.value ?? 0));
  const threshold = sys.derived.stun - penalty + luck;
  const success = roll.total < threshold;
  const parts = [{ label: "Устойчивость", value: sys.derived.stun }];
  if (penalty) parts.push({ label: "Накопленный штраф", value: -penalty });
  if (luck) parts.push({ label: "Удача", value: luck });

  const update = { "system.deathSaves.penalty": penalty + 1 };
  if (luck) update["system.luck.value"] = sys.luck.value - luck;
  await actor.update(update);
  if (!success) await markDead(actor);

  return saveCard(actor, {
    kind: "death", title: "Испытание против смерти", reason, parts, threshold, die: roll.total, success,
    rolls: [roll], outcome: success ? "Жив — пока" : "Смерть"
  });
}

/** Отметить смерть: статус и поверженный участник боя. */
export async function markDead(actor) {
  await actor.toggleStatusEffect("dead", { active: true, overlay: true });
  if (actor.statuses.has("dying")) await actor.toggleStatusEffect("dying", { active: false });
  for (const combat of game.combats) {
    for (const c of combat.combatants) {
      if (c.actor === actor && !c.defeated) await c.update({ defeated: true });
    }
  }
}

/** Окно выбора Удачи перед испытанием против смерти. */
export async function deathSaveDialog(actor) {
  const luckMax = actor.system.luck?.value ?? 0;
  if (!luckMax) return rollDeathSave(actor);
  const sys = actor.system;
  const penalty = sys.deathSaves?.penalty ?? 0;
  const threshold = sys.derived.stun - penalty;
  const content = await renderTemplate("systems/vedmak/templates/dialog/save.hbs", {
    head: {
      title: "Против смерти", base: threshold, baseHint: "порог",
      subtitle: `${actor.name} · Устойчивость ${sys.derived.stun}${penalty ? ` − накопленный штраф ${penalty}` : ""}`,
      note: "Провал — смерть", noteWarn: true
    },
    threshold, luckMax, luckDots: luckDots(luckMax), luckNote: luckNote(0, luckMax),
    hint: "После каждого испытания штраф растёт на 1. Потраченная Удача не возвращается."
  });
  const luck = await foundry.applications.api.DialogV2.wait({
    window: { title: `Испытание против смерти: ${actor.name}` },
    classes: ["vedmak", "vedmak-dialog", "check-dialog", "death-dialog"],
    position: { width: 440 },
    content,
    render: (event, dialog) => bindDialog(dialog, {
      extra: form => {
        const spent = Number(form.elements.luck?.value) || 0;
        const out = dialog.element.querySelector("[data-save-threshold]");
        const box = dialog.element.querySelector("[data-base] b");
        if (out) out.textContent = String(threshold + spent);
        if (box) box.textContent = String(threshold + spent);
      }
    }),
    buttons: [{ action: "roll", label: "Бросить", default: true,
      callback: (event, button) => Number(button.form.elements.luck.value) || 0 },
      { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  if (luck === "cancel" || luck === null) return null;
  return rollDeathSave(actor, { luck });
}
