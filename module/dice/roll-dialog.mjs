// Окно перед проверкой: обстоятельства, модификатор, Удача, кому видно.
// Сложность окно не спрашивает: СЛ задают правила вызова, окно лишь показывает её справкой.

import { renderTemplate } from "../util.mjs";
import { bindDialog, commonFields, readCommon } from "./dialog-ui.mjs";

/** Слагаемое для подзаголовка: основа — числом, правка — со знаком. */
function partText(part) {
  const value = Number(part.value) || 0;
  return `${part.label} ${part.always && value >= 0 ? value : value > 0 ? `+${value}` : `−${Math.abs(value)}`}`;
}

/**
 * @param {object} cfg
 * @param {string} cfg.title
 * @param {{label: string, value: number}[]} cfg.parts
 * @param {number} [cfg.luckMax=0]
 * @param {number|null} [cfg.dc]
 * @param {{label: string, value: number, checked?: boolean, hint?: string}[]} [cfg.optional] — слагаемые с галочкой
 * @param {string} [cfg.damage] — формула урона: окно покажет её в подвале и поле правки урона
 * @returns {Promise<{mod: number, dc: number|null, luck: number, messageMode: string, optional: object[]}|null>}
 */
export async function rollDialog({ title, parts, luckMax = 0, dc = null, optional = [], damage = "" }) {
  const base = parts.reduce((s, p) => s + (Number(p.value) || 0), 0);
  const content = await renderTemplate("systems/vedmak/templates/dialog/roll.hbs", {
    head: {
      title, base,
      subtitle: parts.filter(p => p.value || p.always).map(partText).join(" · "),
      note: dc === null ? "" : `Нужно больше ${dc}`
    },
    optional: optional.map((o, i) => ({ ...o, index: i })),
    total: { base, damage, hint: "Shift — бросить сразу, без окна" },
    ...commonFields({ luckMax, damage })
  });

  return foundry.applications.api.DialogV2.wait({
    window: { title: `Проверка: ${title}` },
    classes: ["vedmak", "vedmak-dialog", "check-dialog"],
    position: { width: 440 },
    content,
    render: (event, dialog) => bindDialog(dialog),
    buttons: [{
      action: "roll", label: "Бросить", default: true,
      callback: (event, button) => ({
        ...readCommon(button.form.elements, luckMax),
        dc,
        optional: optional.filter((o, i) => button.form.querySelector(`[name="optional.${i}"]`)?.checked)
      })
    }, { action: "cancel", label: "Отмена" }],
    rejectClose: false
  }).then(r => (r === "cancel" ? null : r));
}
