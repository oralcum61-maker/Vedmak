// Школа Улитки (первоапрельская школа R. Talsorian 2022, «Школа Улитки»; PLAN 4.144, 4.148). «Выделения»: в бою ведьмак
// покрыт скользкой слизью — тот, кто пытается его схватить или удержать (захват, обездвиживание), получает −3
// (combat/attack.mjs). За 1 Вын и действие можно закрепить слизь Игни на руках: +3 к защите от разоружения
// (combat/defense.mjs), но минуту нельзя бросить оружие.

import { postCard } from "../util.mjs";

const SYS = "vedmak";

/** Ведьмак школы Улитки. */
export const isSnail = actor => actor?.type === "character" && actor.system.details?.school === "snail";

/** Действующая «Слизь Игни». */
export const igniSlime = actor => actor?.effects?.find(e => e.active && e.flags?.[SYS]?.snailSlime) ?? null;

/** Виды атаки, которыми хватают и удерживают: против Улитки −3. */
export const GRAB_ATTACKS = ["grapple", "pin"];

/** Закрепить слизь Игни на руках: 1 Вын, на минуту. */
export async function applyIgniSlime(actor) {
  if (!isSnail(actor)) return ui.notifications.warn(`${actor.name}: слизь Игни — особенность школы Улитки.`);
  if (igniSlime(actor)) return ui.notifications.info("Слизь Игни уже на руках.");
  if ((actor.system.sta?.value ?? 0) < 1) return ui.notifications.warn(`${actor.name}: нужна 1 Вын.`);
  await actor.update({ "system.sta.value": actor.system.sta.value - 1 });
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: "Слизь Игни", img: "icons/magic/fire/flame-burning-hand-orange.webp", transfer: false,
    duration: { value: 1, units: "minutes", expiry: null },
    description: "<p>+3 к защите от разоружения; минуту нельзя бросить оружие.</p>",
    flags: { [SYS]: { snailSlime: true } }
  }]);
  return postCard(actor, "Слизь Игни", "<p>Слизь закреплена Игни на руках (−1 Вын, действие): минуту +3 к защите от разоружения, бросить оружие нельзя.</p>",
    { icon: "fa-solid fa-hand-sparkles" });
}
