// Касание двимерита (стр. 167): Энергия падает до 0 (common.mjs), Стойкость СЛ 16, итог броска выбирает строку таблицы
// эффектов. Пока длится контакт — эффект «Касание двимерита» с номером строки; проверка повторяется каждые полчаса
// (кнопка на вкладке «Магия»), ход в бою напоминает о последствиях строки (combat.mjs). Двимерит рядом, без касания,
// снимает по 1 Энергии за единицу в 5 м — это поле окна сотворения.

import { DIMERITIUM_DC, DIMERITIUM_TOUCH } from "../config/magic.mjs";
import { STATS } from "../config/stats.mjs";
import { postCard } from "../util.mjs";
import { performCheck } from "../dice/check.mjs";
import { abilityLevel } from "../crafting/craft.mjs";

/** «Устойчивость к двимериту» (Маг, Маг воды и огня, Некромант): Воля + способность против СЛ 16. */
const RESIST = { name: "Устойчивость к двимериту", dc: 16,
  text: "Устойчивость к двимериту: кружится голова, дискомфорт, но половина Энергии и сотворение сохраняются." };

const SYS = "vedmak";
const IMG = "systems/vedmak/assets/fan/components/t3-dimeritium-ingot.webp";

export const dimeritiumEffect = actor => actor?.effects?.find(e => e.flags?.[SYS]?.dimeritium);
/** Строка таблицы для текущего контакта (или null); устоял благодаря способности — {text, resisted}. */
export function dimeritiumRow(actor) {
  const eff = dimeritiumEffect(actor);
  if (!eff) return null;
  if (eff.flags[SYS].dimeritium.resisted) return { text: RESIST.text, resisted: true };
  return DIMERITIUM_TOUCH[eff.flags[SYS].dimeritium.row] ?? null;
}

/** Касание или проверка через полчаса: Стойкость СЛ 16, строка по итогу броска. */
export async function touchDimeritium(actor) {
  if (!actor) return null;
  const existing = dimeritiumEffect(actor);
  // Маг со способностью сначала пробует устоять: успех — половина Энергии, таблица не нужна
  const resistLevel = abilityLevel(actor, RESIST.name);
  if (resistLevel) {
    const parts = [
      { label: STATS.will.label, value: actor.system.stats.will.effective, always: true },
      { label: RESIST.name, value: resistLevel, always: true }
    ];
    const check = await performCheck({ actor, title: RESIST.name, subtitle: "Касание двимерита", parts, dc: RESIST.dc });
    if (check?.success) {
      const prevStatus = existing ? DIMERITIUM_TOUCH[existing.flags[SYS].dimeritium.row]?.status : null;
      const flags = { [SYS]: { dimeritium: { row: -1, resisted: true, nextSpasm: 0 } } };
      if (existing) await existing.update({ description: RESIST.text, flags });
      else await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Касание двимерита", img: IMG, description: RESIST.text, flags }]);
      if (prevStatus && actor.statuses.has(prevStatus)) await actor.toggleStatusEffect(prevStatus, { active: false });
      return postCard(actor, "Двимерит: устоял", `<p>${RESIST.text}</p><p>Проверка — каждые полчаса контакта.</p>`,
        { icon: "fa-solid fa-link-slash" });
    }
  }
  const result = await actor.rollSkill("endurance", { subtitle: existing ? "Двимерит: проверка через полчаса" : "Касание двимерита", dc: DIMERITIUM_DC });
  if (!result) return null;
  const rowIndex = DIMERITIUM_TOUCH.findIndex(r => result.total >= r.min);
  const row = DIMERITIUM_TOUCH[rowIndex];
  const prevStatus = existing && !existing.flags[SYS].dimeritium.resisted ? DIMERITIUM_TOUCH[existing.flags[SYS].dimeritium.row]?.status : null;
  const flags = { [SYS]: { dimeritium: { row: rowIndex, resisted: false, nextSpasm: 0 } } };
  const description = `${row.text} Энергия 0, пока длится касание.`;
  if (existing) await existing.update({ description, flags });
  else await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Касание двимерита", img: IMG, description, flags }]);
  // Состояние строки — на время контакта; прежнее снимаем, если новая строка его не даёт
  if (prevStatus && prevStatus !== row.status && actor.statuses.has(prevStatus)) await actor.toggleStatusEffect(prevStatus, { active: false });
  if (row.status && !actor.statuses.has(row.status)) await actor.toggleStatusEffect(row.status, { active: true });
  return postCard(actor, existing ? "Двимерит: полчаса контакта" : "Касание двимерита",
    `<p>Стойкость ${result.total}: ${row.text}</p><p>Энергия 0, пока длится касание; проверка — каждые полчаса.</p>`,
    { icon: "fa-solid fa-link-slash" });
}

/** Контакт прерван: Энергия возвращается, состояние строки снимается. */
export async function endDimeritium(actor) {
  const eff = dimeritiumEffect(actor);
  if (!eff) return null;
  const status = eff.flags[SYS].dimeritium.resisted ? null : DIMERITIUM_TOUCH[eff.flags[SYS].dimeritium.row]?.status;
  await eff.delete();
  if (status && actor.statuses.has(status)) await actor.toggleStatusEffect(status, { active: false });
  return postCard(actor, "Двимерит убран", `<p>${actor.name} больше не касается двимерита: Энергия возвращается.</p>`,
    { icon: "fa-solid fa-link" });
}

/**
 * Начало хода в бою: урон, испытание Уст и спазмы строки таблицы.
 * @returns {Promise<{loss: number, lines: string[], stun: boolean}>}
 */
export async function dimeritiumTurn(actor, round) {
  const out = { loss: 0, lines: [], stun: false };
  const eff = dimeritiumEffect(actor);
  const row = eff && !eff.flags[SYS].dimeritium.resisted ? DIMERITIUM_TOUCH[eff.flags[SYS].dimeritium.row] : null;
  if (!row) return out;
  if (row.damage) {
    const r = await new Roll(row.damage).evaluate();
    out.loss = r.total;
    out.lines.push(`Двимерит возжигает магию: ${r.total} урона.`);
  }
  if (row.stunEachRound) { out.stun = true; out.lines.push("Двимерит: испытание Устойчивости."); }
  if (row.spasms) {
    // Спазмы каждые 1d6 ходов: следующий раунд храним в эффекте, первый — бросаем при первом ходе
    const next = eff.flags[SYS].dimeritium.nextSpasm;
    if (next && round >= next) out.lines.push(`Двимерит: спазмы — Стойкость СЛ ${row.spasms}, иначе ошеломление.`);
    if (!next || round >= next) {
      const r = await new Roll("1d6").evaluate();
      await eff.update({ [`flags.${SYS}.dimeritium.nextSpasm`]: round + r.total });
    }
  }
  return out;
}
