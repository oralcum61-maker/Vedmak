// Проверка d10 по правилам «Ведьмака».
//
//  Итог = основа (параметр + навык) + модификаторы + Удача + бросок d10.
//  • 10 — критический успех: бросаем ещё и прибавляем, каждая новая 10 взрывается дальше (стр. 58, 156).
//  • 1 — критический провал: единица в итог не идёт; бросаем ещё d10 (тоже взрывается на 10)
//    и вычитаем из основы. Вычитание провала не опускает основу ниже 0 (стр. 157);
//    сама основа от штрафов может быть и отрицательной.
//  • Проверка сложности успешна, только если итог БОЛЬШЕ СЛ (равно — провал, стр. 57).

import { renderTemplate } from "../util.mjs";

/**
 * Бросок d10 с правилами взрыва и провала.
 * @returns {Promise<{rolls: Roll[], natural: number, dice: number[], fumbleDice: number[], crit: boolean,
 *   fumble: boolean, rollValue: number, fumbleValue: number}>}
 */
export async function rollD10() {
  const main = await new Roll("1d10x10").evaluate();
  const dice = main.dice[0].results.map(r => r.result);
  const natural = dice[0];
  const out = {
    rolls: [main], natural, dice, fumbleDice: [],
    crit: natural === 10, fumble: natural === 1,
    rollValue: natural === 1 ? 0 : main.total, fumbleValue: 0
  };
  if (out.fumble) {
    const extra = await new Roll("1d10x10").evaluate();
    out.rolls.push(extra);
    out.fumbleDice = extra.dice[0].results.map(r => r.result);
    out.fumbleValue = extra.total;
  }
  return out;
}

/**
 * Выполнить проверку и (по умолчанию) вывести карточку в чат.
 * @param {object} cfg
 * @param {Actor}  [cfg.actor]
 * @param {string} cfg.title            — заголовок карточки («Владение мечом»)
 * @param {{label: string, value: number}[]} cfg.parts — слагаемые основы (параметр, навык, модификаторы)
 * @param {number|null} [cfg.dc]        — СЛ, если это проверка сложности
 * @param {number} [cfg.luck=0]         — потраченные очки Удачи
 * @param {string} [cfg.subtitle]
 * @param {string} [cfg.messageMode]
 * @param {boolean} [cfg.toChat=true]
 * @param {object} [cfg.flags]          — доп. данные в flags.vedmak (для боевых карточек)
 */
export async function performCheck(cfg) {
  const { actor = null, title, subtitle = "", parts = [], dc = null, luck = 0,
          toChat = true, flags = {} } = cfg;
  // Без окна (Shift) — режим чата пользователя: v14 применяет режим, только если его передали явно
  // «В роли» (ic) делает карточку речевым пузырём персонажа — для карточек системы это «всем»
  const chosen = cfg.messageMode ?? game.settings.get("core", "messageMode");
  const messageMode = !chosen || chosen === "ic" ? "public" : chosen;

  const d10 = await rollD10();
  // Основа может быть отрицательной (штрафы больше параметра с навыком). Предел «не ниже 0» в книге — только
  // для вычитания критического провала (стр. 157): провал не опускает основу ниже 0, но и не поднимает её до 0
  const base = parts.reduce((s, p) => s + (Number(p.value) || 0), 0) + luck;
  const total = d10.fumble ? Math.max(Math.min(base, 0), base - d10.fumbleValue) : base + d10.rollValue;

  const result = {
    title, subtitle, parts: parts.filter(p => p.value || p.always), luck, base, total,
    natural: d10.natural, dice: d10.dice, fumbleDice: d10.fumbleDice,
    crit: d10.crit, fumble: d10.fumble, critValue: d10.crit ? d10.rollValue - 10 : 0,
    fumbleValue: d10.fumbleValue,
    dc, success: dc === null ? null : total > dc,
    margin: dc === null ? null : total - dc
  };

  // Броски — неперечисляемым свойством, чтобы не попадать во флаги сообщений
  Object.defineProperty(result, "rolls", { value: d10.rolls, enumerable: false });

  if (luck && actor?.system?.luck) {
    await actor.update({ "system.luck.value": Math.max(0, actor.system.luck.value - luck) });
  }

  if (toChat) {
    const content = await renderTemplate("systems/vedmak/templates/chat/check.hbs", result);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      rolls: d10.rolls,
      flags: { vedmak: { check: result, ...flags } }
    }, { messageMode });
  }
  return result;
}
