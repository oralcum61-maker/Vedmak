// Кнопки боевых карточек в чате.

import { defend } from "./defense.mjs";
import { repeatAttack } from "./attack.mjs";
import { damageFromDefense, requestApplyDamage } from "./damage.mjs";
import { rollStunSave, deathSaveDialog } from "./saves.mjs";
import { resolveActor, asGM, doneKey, sourceOfResult } from "./common.mjs";
import { requestSpellEffects, ritualFocus } from "../magic/effects.mjs";

const ACTIONS = {
  async defend(message, button, event) {
    const row = button.closest(".target-row");
    const target = { tokenUuid: row?.dataset.targetToken || null, actorUuid: row?.dataset.targetActor || null };
    return defend(message, target, button.dataset.defense, { skipDialog: event.shiftKey });
  },

  repeatAttack: message => repeatAttack(message),

  damage: (message, button, event) => damageFromDefense(message, { skipDialog: event.shiftKey }),

  applyDamage: message => requestApplyDamage(message),

  applySpellEffects: message => requestSpellEffects(message),

  ritualFocus: message => ritualFocus(message),

  async applyHitStatus(message) {
    const def = message.flags.vedmak?.defense;
    if (!def?.hit || !def.attack.hitStatus) return;
    const attacker = resolveActor(def.attack.attacker.tokenUuid) ?? resolveActor(def.attack.attacker.actorUuid);
    if (!game.user.isGM && !attacker?.isOwner) return ui.notifications.warn("Применить эффект может атакующий или ведущий.");
    // messageId — карточка защиты: по ней ведущий проверяет, что просит атакующий, а цель — из этой карточки
    return asGM("setStatus", { uuid: def.defender.tokenUuid ?? def.defender.actorUuid, status: def.attack.hitStatus, active: true, messageId: message.id });
  },

  async stunSave(message, button) {
    const actor = actorFrom(button);
    if (!actor) return;
    return rollStunSave(actor, { mod: Number(button.dataset.mod) || 0, reason: button.dataset.reason ?? "" });
  },

  async deathSave(message, button) {
    const actor = actorFrom(button);
    if (!actor) return;
    return deathSaveDialog(actor);
  }
};

/** Зарегистрировать действие кнопки в карточке чата (ремесло, алхимия…). */
export function registerChatAction(name, fn) {
  ACTIONS[name] = fn;
}

function actorFrom(button) {
  const actor = resolveActor(button.dataset.actor) ?? resolveActor(button.dataset.fallback);
  if (!actor) { ui.notifications.warn("Персонаж не найден."); return null; }
  if (!actor.isOwner) { ui.notifications.warn(`Бросок за «${actor.name}» делает его владелец или ведущий.`); return null; }
  return actor;
}

/**
 * Погасить кнопки уже сделанного броска: защиты цели, по которой защита брошена, и урона после броска урона.
 * Ведущему кнопка остаётся (повтор с подтверждением), но приглушена.
 */
function markDoneButtons(message, html) {
  const flags = message.flags.vedmak;
  const done = (button, tooltip) => {
    button.dataset.tooltip = tooltip;
    if (game.user.isGM) button.style.opacity = "0.5";
    else button.disabled = true;
  };
  if (flags?.fumbleApplied) {
    for (const button of html.querySelectorAll("[data-vedmak='applyFumble']")) done(button, "Последствия уже применены");
  }
  if (flags?.defended) {
    for (const row of html.querySelectorAll(".target-row[data-target-token], .target-row[data-target-actor]")) {
      const id = flags.defended[doneKey(row.dataset.targetToken || row.dataset.targetActor)];
      if (!id || !game.messages.has(id)) continue;
      for (const b of row.querySelectorAll('[data-vedmak="defend"], [data-vedmak="verbalDefend"]')) done(b, "Защита уже брошена");
    }
  }
  if (flags?.damaged && game.messages.has(flags.damaged)) {
    for (const b of html.querySelectorAll('[data-vedmak="damage"]')) done(b, "Урон уже брошен");
  }
}

export function registerChatListeners() {
  // Ведущий удалил карточку результата (защиту, урон, исход дуэли) — кнопка на карточке-источнике должна вернуться.
  // Погасла она при отрисовке источника, а при удалении результата источник сам не перерисовывается
  Hooks.on("deleteChatMessage", message => {
    const source = sourceOfResult(message);
    if (source) ui.chat?.updateMessage(source)?.catch?.(err => console.error("vedmak | перерисовка карточки", err));
  });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    // Сообщение с карточкой системы — отдельный класс: раньше CSS искал её селектором :has(),
    // и браузер перепроверял его на каждое изменение в чате
    if (html.querySelector(".vedmak-card")) html.classList.add("vedmak-message");
    markDoneButtons(message, html);
    for (const button of html.querySelectorAll("[data-vedmak]")) {
      button.addEventListener("click", async event => {
        event.preventDefault();
        const action = ACTIONS[button.dataset.vedmak];
        if (!action) return;
        button.disabled = true;
        try {
          await action(message, button, event);
        } catch (err) {
          console.error("vedmak |", err);
          ui.notifications.error(err.message);
        } finally {
          button.disabled = false;
        }
      });
    }
  });
}
