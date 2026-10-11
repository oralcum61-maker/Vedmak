// «Упрямство» (черта расы людей, корник стр. 24): можно перебросить неудачную проверку Сопротивления убеждению или
// Храбрости, не больше N раз за партию (N — из текста черты, у людей 3); из двух результатов берётся больший; если и он
// провальный, снова на этой проверке нельзя. Партия — игровой день: счётчик помнит дату и в новый день обнуляется сам
// (PLAN 4.179). Кнопка — на карточке проверки: у проверки без Сложности провал видит сам игрок (против чужого броска).

import { rollD10 } from "../dice/check.mjs";
import { renderTemplate } from "../util.mjs";

export const STUBBORN_SKILLS = ["resistCoercion", "courage"];

/** Сегодняшний день — «партия» для счётчика. */
const today = () => new Date().toLocaleDateString("sv");

/** Сколько раз за партию даёт черта расы (0 — черты нет). */
export function stubbornLimit(actor) {
  const trait = actor?.system?.race?.system?.traits?.find(t => t.name === "Упрямство");
  if (!trait) return 0;
  const m = /не более (\d+)/.exec(trait.effect ?? "");
  return m ? Number(m[1]) : 3;
}

/** Сколько раз осталось в эту партию. */
export function stubbornLeft(actor) {
  const limit = stubbornLimit(actor);
  if (!limit) return 0;
  const flag = actor.getFlag("vedmak", "stubborn");
  return Math.max(0, limit - (flag?.day === today() ? flag.used ?? 0 : 0));
}

/** Данные для карточки проверки навыка: показывать ли кнопку «Упрямство». */
export function stubbornOffer(actor, skill) {
  if (!STUBBORN_SKILLS.includes(skill)) return null;
  const left = stubbornLeft(actor);
  return left ? { left, limit: stubbornLimit(actor) } : null;
}

/** Кнопка «Упрямство» на карточке: второй бросок той же основы, берётся больший. */
export async function stubbornReroll(message) {
  const check = message.flags.vedmak?.check;
  if (!check?.stubborn || check.stubbornUsed) return;
  const actor = ChatMessage.getSpeakerActor(message.speaker);
  if (!actor?.isOwner) return ui.notifications.warn("Перебросить может только тот, кто играет этим персонажем.");
  if (check.success === true) return ui.notifications.info("Проверка удалась — «Упрямство» не нужно.");
  if (!stubbornLeft(actor)) return ui.notifications.warn(`${actor.name}: «Упрямство» в эту партию исчерпано.`);

  const d10 = await rollD10();
  const second = d10.fumble ? Math.max(Math.min(check.base, 0), check.base - d10.fumbleValue) : check.base + d10.rollValue;
  const next = { ...check, stubborn: null, stubbornUsed: { first: check.total, second, kept: Math.max(check.total, second) } };
  if (second > check.total) {
    Object.assign(next, {
      total: second, natural: d10.natural, dice: d10.dice, fumbleDice: d10.fumbleDice, crit: d10.crit, fumble: d10.fumble,
      critValue: d10.crit ? d10.rollValue - 10 : 0, fumbleValue: d10.fumbleValue
    });
  }
  if (check.dc !== null && check.dc !== undefined) {
    next.success = next.total > check.dc;
    next.margin = next.total - check.dc;
  }
  const flag = actor.getFlag("vedmak", "stubborn");
  const used = (flag?.day === today() ? flag.used ?? 0 : 0) + 1;
  await actor.setFlag("vedmak", "stubborn", { day: today(), used });
  const content = await renderTemplate("systems/vedmak/templates/chat/check.hbs", next);
  await message.update({ content, "flags.vedmak.check": next });
}
