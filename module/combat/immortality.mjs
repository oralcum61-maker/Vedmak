// Бессмертие и регенерация критических ранений (PLAN 4.219).
//
// Высший вампир-персонаж (раса «Высший вампир», черта «Бессмертие»): уходит в минус по ПЗ до своего максимума и
// восстанавливается — испытаний против смерти нет, мгновенная смерть от ранения не убивает; урон за −максимум ПЗ —
// «окончательная смерть» (вампир вернётся, но за пределами кампании). «Вампирская регенерация» (открыта за 30 ОК):
// одно ранение за раз, начиная с лёгких, сразу стабилизировано и исцеляется за 1–4 раунда по тяжести; вне боя время
// не важно — ранение исцеляется сразу.
//
// Чудовище со способностью «Бессмертие» (высший вампир, рыцарь смерти): в начале хода, кроме ПЗ (monster-traits),
// лечит одно ранение за раз с лёгких — 1 / 2 / 4 / 6 раундов, после первого раунда стабилизировано. Убит — вернётся
// через столько недель, сколько отрицательных ПЗ было в момент смерти (если убил не высший вампир — ведущий отменяет
// кнопкой); срок — по времени мира, ведущему приходит карточка с кнопкой «Вернуть к жизни».

import { VAMPIRE_RACE } from "../character/lifepath.mjs";
import { monsterTraits } from "./monster-traits.mjs";
import { registerChatAction } from "./chat.mjs";
import { markDead } from "./saves.mjs";

const SYS = "vedmak";
const WEEK = 7 * 86400;
const ORDER = ["simple", "complex", "difficult", "deadly"];
/** Раундов на ранение: персонаж (1–4 по тяжести) и чудовище («Бессмертие»: 1 / 2 / 4 / 6). */
const ROUNDS = { pc: { simple: 1, complex: 2, difficult: 3, deadly: 4 }, monster: { simple: 1, complex: 2, difficult: 4, deadly: 6 } };

/** Высший вампир-персонаж: раса с ключом highVampire. */
export const isImmortalPC = actor => actor?.type === "character"
  && actor.items.some(i => i.type === "race" && i.system.key === VAMPIRE_RACE);

/** Чудовище с «Бессмертием», которое лечит ранения (высший вампир, рыцарь смерти). */
export const isImmortalMonster = actor => actor?.type === "monster" && !!monsterTraits(actor).regen?.crits;

/** Кто лечит ранения регенерацией: "pc" (открыта «Вампирская регенерация»), "monster" или null. */
export function critRegenKind(actor) {
  if (isImmortalMonster(actor)) return "monster";
  if (!isImmortalPC(actor)) return null;
  const race = actor.items.find(i => i.type === "race" && i.system.key === VAMPIRE_RACE);
  return (race?.system.powers ?? []).some(p => p.key === "critHealing" && p.value > 0) ? "pc" : null;
}

/** Граница бессмертия персонажа: ПЗ не ниже −максимума. */
export const immortalFloor = actor => -(actor.system.hp?.max ?? 0);

/* ---------------------------------------------------------------- Регенерация ранений */

/** Ранение, которое лечится сейчас: начатое — дальше, иначе самое лёгкое из невылеченных. */
function currentWound(actor) {
  const wounds = actor.items.filter(i => i.type === "critWound" && i.system.state !== "treated");
  if (!wounds.length) return null;
  const started = wounds.find(i => i.getFlag(SYS, "regen"));
  if (started) return started;
  return wounds.sort((a, b) => ORDER.indexOf(a.system.level) - ORDER.indexOf(b.system.level))[0];
}

/**
 * Раунд регенерации ранений (начало хода): одно ранение продвигается на раунд; персонажу оно стабилизировано сразу,
 * чудовищу — после первого раунда; готовое — исцелено (удаляется). Строки для карточки хода.
 */
export async function critRegenStartOfTurn(actor) {
  const kind = critRegenKind(actor);
  if (!kind || actor.statuses.has("dead")) return [];
  const wound = currentWound(actor);
  if (!wound) return [];
  const need = ROUNDS[kind][wound.system.level] ?? 1;
  const done = (wound.getFlag(SYS, "regen")?.done ?? 0) + 1;
  const label = `${wound.name} (${wound.system.levelConfig?.label?.toLowerCase() ?? ""})`;
  if (done >= need) {
    await wound.delete();
    return [`Регенерация: ${label} исцелено.`];
  }
  const update = { [`flags.${SYS}.regen`]: { done } };
  if (wound.system.state === "fresh") update["system.state"] = "stabilized";
  await wound.update(update);
  return [`Регенерация: ${label} — ${done} из ${need} раундов${wound.system.state === "fresh" ? ", стабилизировано" : ""}.`];
}

/** Вне боя время не важно: все ранения исцеляются сразу. Строки — в карточку. */
async function regenAllWounds(actor, why) {
  const wounds = actor.items.filter(i => i.type === "critWound" && i.system.state !== "treated");
  if (!wounds.length) return;
  await actor.deleteEmbeddedDocuments("Item", wounds.map(w => w.id));
  await note(actor, "Регенерация", [`${why}: исцелено ранений — ${wounds.length} (${wounds.map(w => w.name).join(", ")}).`]);
}

/** Актёр сейчас в начатом бою. */
const inStartedCombat = actor => game.combats.some(c => c.started && c.combatants.some(cb => cb.actor?.id === actor.id));

/* ---------------------------------------------------------------- Бессмертие персонажа */

/**
 * Урон по бессмертному вампиру-персонажу (зовёт applyDamageToActor): вместо испытания против смерти — строка; за
 * −максимум ПЗ — окончательная смерть (её ставит хук updateActor). Возвращает {finalDeath, lines}.
 */
export function immortalDamageNote(actor, hp) {
  const floor = immortalFloor(actor);
  if (hp < floor) return { finalDeath: true, lines: [`Урон за пределом бессмертия (ниже −${-floor} ПЗ) — окончательная смерть: вампир вернётся, но за пределами кампании.`] };
  if (hp < 0) return { finalDeath: false, lines: [`Бессмертие: при смерти, но не умирает — до −${-floor} ПЗ испытаний против смерти нет.`] };
  return { finalDeath: false, lines: [] };
}

/* ---------------------------------------------------------------- Возвращение чудовища */

/** Чудовище с «Бессмертием» убито: вернётся через столько недель, сколько отрицательных ПЗ. */
async function scheduleRevival(actor) {
  const neg = Math.max(1, -Math.min(0, actor.system.hp?.value ?? 0));
  const at = game.time.worldTime + neg * WEEK;
  await actor.setFlag(SYS, "revival", { at, weeks: neg });
  await note(actor, "Бессмертие", [`${actor.name} мёртв — но вернётся к жизни через ${neg} нед. (отрицательных ПЗ: ${neg}).`,
    "Если его убил другой высший вампир — смерть окончательная: отмените возвращение."],
  [{ action: "immortalCancel", label: "Убил высший вампир — окончательно" }, { action: "immortalRevive", label: "Вернуть сейчас" }]);
}

/** Вернуть к жизни: все ПЗ, без смерти и ранений. */
export async function revive(actor) {
  for (const s of ["dead", "dying", "unconscious"]) if (actor.statuses.has(s)) await actor.toggleStatusEffect(s, { active: false });
  const wounds = actor.items.filter(i => i.type === "critWound").map(i => i.id);
  if (wounds.length) await actor.deleteEmbeddedDocuments("Item", wounds);
  await actor.update({ "system.hp.value": actor.system.hp.max, [`flags.${SYS}.revival`]: _del });
  await note(actor, "Бессмертие", [`${actor.name} возвращается к жизни.`]);
}

/** Время мира дошло до срока — ведущему карточка с кнопкой. */
async function checkRevivals() {
  for (const actor of game.actors) {
    const r = actor.getFlag(SYS, "revival");
    if (!r || r.notified || game.time.worldTime < r.at) continue;
    await actor.setFlag(SYS, "revival", { ...r, notified: true });
    await note(actor, "Бессмертие", [`Прошло ${r.weeks} нед.: ${actor.name} может вернуться к жизни.`],
      [{ action: "immortalRevive", label: "Вернуть к жизни" }]);
  }
}

/* ---------------------------------------------------------------- Карточка */

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Короткая карточка ведущему: заголовок, строки, кнопки (data-vedmak). */
async function note(actor, title, lines, buttons = []) {
  const btn = buttons.map(b => `<button type="button" data-vedmak="${b.action}" data-actor="${esc(actor.uuid)}">${esc(b.label)}</button>`).join("");
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }), whisper: game.users.filter(u => u.isGM).map(u => u.id),
    content: `<div class="vedmak-card immortal-card"><header class="card-head"><div class="card-ident"><span class="card-name">${esc(title)}</span>`
      + `<span class="card-sub">${esc(actor.name)}</span></div></header><div class="card-body">${lines.map(l => `<p class="note">${esc(l)}</p>`).join("")}`
      + `${btn ? `<div class="card-buttons">${btn}</div>` : ""}</div></div>`,
    flags: { vedmak: { immortal: true } }
  });
}

/* ---------------------------------------------------------------- Регистрация */

export function registerImmortality() {
  const gmHere = () => !!game.users.activeGM?.isSelf;
  registerChatAction("immortalRevive", async (message, button) => {
    if (!game.user.isGM) return ui.notifications.warn("Вернуть к жизни может ведущий.");
    const actor = await fromUuid(button.dataset.actor);
    if (actor) await revive(actor);
  });
  registerChatAction("immortalCancel", async (message, button) => {
    if (!game.user.isGM) return;
    const actor = await fromUuid(button.dataset.actor);
    if (!actor) return;
    await actor.unsetFlag(SYS, "revival");
    await note(actor, "Бессмертие", [`${actor.name} убит сородичем — смерть окончательная.`]);
  });

  // Смерть: у чудовища с «Бессмертием» — отсчёт до возвращения
  Hooks.on("createActiveEffect", effect => {
    const actor = effect.parent;
    if (!gmHere() || actor?.documentName !== "Actor" || !effect.statuses?.has?.("dead")) return;
    if (isImmortalMonster(actor) && !actor.getFlag(SYS, "revival")) scheduleRevival(actor).catch(err => console.error("vedmak | бессмертие", err));
  });

  // Персонаж-вампир: за −максимум ПЗ — окончательная смерть (урон за ход, ручная правка)
  Hooks.on("updateActor", (actor, changes) => {
    if (!gmHere() || foundry.utils.getProperty(changes, "system.hp.value") === undefined || !isImmortalPC(actor)) return;
    if (actor.system.hp.value < immortalFloor(actor) && !actor.statuses.has("dead")) {
      markDead(actor)
        .then(() => note(actor, "Бессмертие", [`ПЗ ${actor.system.hp.value} — ниже −${actor.system.hp.max}: окончательная смерть, вампир вернётся за пределами кампании.`]))
        .catch(err => console.error("vedmak | бессмертие", err));
    }
  });

  // Вне боя ранение регенерирующего исцеляется сразу; бой закончился — исцеляются оставшиеся
  Hooks.on("createItem", item => {
    const actor = item.parent;
    if (!gmHere() || item.type !== "critWound" || !actor || !critRegenKind(actor) || inStartedCombat(actor)) return;
    setTimeout(() => regenAllWounds(actor, "Регенерация вне боя").catch(err => console.error("vedmak | регенерация", err)), 300);
  });
  Hooks.on("deleteCombat", combat => {
    if (!gmHere()) return;
    for (const cb of combat.combatants) {
      const actor = cb.actor;
      if (actor && critRegenKind(actor) && !actor.statuses.has("dead")) regenAllWounds(actor, "Бой окончен").catch(err => console.error("vedmak | регенерация", err));
    }
  });

  // Возвращение по времени мира
  Hooks.on("updateWorldTime", () => { if (gmHere()) checkRevivals().catch(err => console.error("vedmak | бессмертие", err)); });
}

