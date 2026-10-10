// Медвежья форма берсерка («Новые профессии»; «Том магии Альзура», стр. 35): съел мардрём — медведь.
// ПЗ вдвое, природная броня 10 (+ «Большой медведь») вместо надетой — снаряжение превращается вместе с ним,
// сопротивление дробящему (с «Большим медведем» — колющему и режущему), восприимчивость к серебру и маслу против
// проклятых, когти и укус медведя. Срок — часы по уровню «Больше зверь, чем человек»; в бою каждый раунд проверка
// самоконтроля, СЛ = 28 − (Воля + Инт) / 2. Без сознания или по своей воле — снова человек, ПЗ вдвое меньше.
// Форма — эффект актора с флагом `bearForm` (data/actor/character.mjs: броня и ПЗ; combat/damage.mjs: серебро,
// масло и сопротивления; combat/common.mjs: в бой — только оружие формы).

import { postCard, inCombat } from "../util.mjs";
import { itemsForLabel } from "./wizard.mjs";
import { abilityLevel, countNamed, itemsNamed } from "../crafting/craft.mjs";

const SYS = "vedmak";
const FLAG = "bearForm";
/** Определяющий навык берсерка: по нему узнаём, что форма персонажу доступна. */
export const BEAR_SKILL = "Больше зверь, чем человек";
export const MARDREM = "Мардрём";
export const BEAR_FORM_WEAPONS = ["Удар когтями (Медвежья форма)", "Укус (Медвежья форма)"];
const IMG = "icons/creatures/abilities/bear-roar-bite-brown.webp";

export function bearFormEffect(actor) {
  return actor?.effects?.find(e => e.flags?.[SYS]?.[FLAG]) ?? null;
}
export const inBearForm = actor => !!bearFormEffect(actor)?.active;

/** Берсерк ли персонаж: у профессии определяющий навык «Больше зверь, чем человек». */
export function isBerserk(actor) {
  return actor?.system?.profession?.system?.definingSkill?.name === BEAR_SKILL;
}

/** Уровень определяющего навыка берсерка. */
const bearLevel = actor => Number(actor.system.profession?.system.definingSkill?.value) || 0;

/** СЛ самоконтроля: 28 − (Воля + Инт) / 2, «Медитация» в этот день снижает её на половину своего уровня. */
export function controlDc(actor) {
  const s = actor.system.stats;
  const raw = k => (s[k]?.base ?? 0) + (s[k]?.mod ?? 0);
  const meditated = actor.getFlag(SYS, "bearMeditation") === Math.floor(game.time.worldTime / 86400);
  const med = meditated ? Math.floor(abilityLevel(actor, "Медитация") / 2) : 0;
  return Math.max(1, 28 - Math.floor((raw("will") + raw("int")) / 2) - med);
}

/** Что даёт форма: броня, сопротивления, урон когтей (по способностям древа берсерка). */
function formStats(actor) {
  const big = abilityLevel(actor, "Большой медведь");
  const claws = abilityLevel(actor, "Острые когти");
  const resist = ["bludgeoning"];
  if (big >= 5) resist.push("piercing");
  if (big >= 10) resist.push("slashing");
  return {
    armor: 10 + big, resist, big,
    clawBonus: Math.floor(claws / 2),
    clawBleed: claws >= 10 ? "50%" : claws >= 5 ? "25%" : ""
  };
}

/** Состояние для листа и худа. */
export function bearFormState(actor) {
  const eff = bearFormEffect(actor);
  const rem = eff?.updateDuration?.().remaining;
  return {
    active: !!eff, available: isBerserk(actor), mardrem: countNamed(actor, MARDREM),
    hours: Number.isFinite(rem) ? Math.max(0, Math.ceil(rem / 3600)) : null, dc: controlDc(actor)
  };
}

/** Съесть мардрём и обратиться медведем. */
export async function bearTransform(actor) {
  if (!isBerserk(actor)) return ui.notifications.warn(`${actor.name}: медвежья форма — определяющий навык берсерка «${BEAR_SKILL}».`);
  if (bearFormEffect(actor)) return ui.notifications.info(`${actor.name} уже в медвежьей форме.`);
  const level = bearLevel(actor);
  if (level < 1) return ui.notifications.warn(`«${BEAR_SKILL}» на нуле: медвежья форма недоступна.`);
  const mushroom = itemsNamed(actor, MARDREM).find(i => (i.system.quantity ?? 1) > 0);
  if (!mushroom) return ui.notifications.warn(`Нет грибов «${MARDREM}»: без них берсерк не обратится.`);
  const q = mushroom.system.quantity ?? 1;
  if (q > 1) await mushroom.update({ "system.quantity": q - 1 });
  else await mushroom.delete();

  const f = formStats(actor);
  const hours = level;
  const hp = actor.system.hp.value;
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: "Медвежья форма", img: IMG, transfer: false,
    description: `<p>Медведь: ПЗ вдвое, природная броня ${f.armor}, сопротивление ${f.resist.length > 1 ? "дробящему, колющему" + (f.resist.length > 2 ? " и режущему" : "") : "дробящему"} урону; уязвим к серебру и маслу против проклятых.</p>`,
    duration: { seconds: hours * 3600 }, start: { time: game.time.worldTime },
    flags: { [SYS]: { [FLAG]: { armor: f.armor, resist: f.resist, hpBefore: hp } } }
  }]);
  // ПЗ вдвое — и текущие, и максимум (максимум удваивает подготовка данных)
  await actor.update({ "system.hp.value": Math.min(actor.system.hp.max, hp * 2) });

  const weapons = [];
  for (const name of BEAR_FORM_WEAPONS) {
    if (actor.items.some(i => i.name === name)) continue;
    for (const w of await itemsForLabel(name)) {
      if (w.type !== "weapon") continue;
      w.system.equipped = true;
      // «Острые когти»: половина уровня к урону когтей, на 5-м и 10-м — кровопускание
      if (/когт/i.test(name)) {
        if (f.clawBonus) w.system.damage = `${w.system.damage}+${f.clawBonus}`;
        if (f.clawBleed) w.system.effects = [...(w.system.effects ?? []), { key: "bleeding", value: f.clawBleed, source: "Острые когти" }];
      }
      foundry.utils.setProperty(w, `flags.${SYS}.bearFormWeapon`, true);
      weapons.push(w);
    }
  }
  if (weapons.length) await actor.createEmbeddedDocuments("Item", weapons);

  const dc = controlDc(actor);
  await postCard(actor, "Медвежья форма", [
    `<p>${foundry.utils.escapeHTML(actor.name)} съедает ${MARDREM} и обращается медведем на <b>${hours} ч</b> (уровень «${BEAR_SKILL}»).</p>`,
    `<ul><li>ПЗ вдвое: ${actor.system.hp.value} / ${actor.system.hp.max}</li><li>природная броня ${f.armor}${f.big ? ` («Большой медведь» +${f.big})` : ""} — надетая и оружие превратились вместе с ним</li>`,
    `<li>сопротивление: ${f.resist.map(r => ({ bludgeoning: "дробящему", piercing: "колющему", slashing: "режущему" })[r]).join(", ")} урону</li>`,
    "<li>восприимчив к серебру и маслу против проклятых; шкура — тёплая одежда</li>",
    `<li>Удар когтями 4d6+5${f.clawBonus ? `+${f.clawBonus}` : ""} (2 атаки)${f.clawBleed ? `, кровопускание ${f.clawBleed}` : ""}; Укус 8d6, кровопускание 75%</li></ul>`,
    `<p>В бою в начале каждого хода — самоконтроль: «${BEAR_SKILL}» против СЛ <b>${dc}</b>; провал — в этом раунде берсерк не владеет собой. Вне боя проверок нет.</p>`
  ].join(""), { icon: "fa-solid fa-paw" });
  return true;
}

/* ----------------------- Способности древа берсерка ----------------------- */

/**
 * Способности облика человека: проверка против СЛ самоконтроля, успех — эффект (PLAN 4.148).
 * «Медвежьи чувства» (Инт) — ночное зрение и выслеживание по запаху; «Спячка» (Тел) — день сна: ПЗ вдвое и −2 дня
 * лечения крита; «Медвежья шкура» (Тел) — ПБ по уровню, на 10-м — сопротивление дробящему, с «Большим медведем» по
 * желанию СЛ +5 — сопротивления медвежьей формы. Чувства и шкура держатся столько часов, сколько очков в навыке.
 */
export const BEAR_HUMAN_ABILITIES = ["Медвежьи чувства", "Спячка", "Медвежья шкура"];

/** Пытаться ли получить сопротивления медведя (СЛ +5): только с «Большим медведем». */
export async function askBigBear(actor) {
  if (!(abilityLevel(actor, "Большой медведь") > 0)) return false;
  return foundry.applications.api.DialogV2.confirm({
    window: { title: "Медвежья шкура" },
    content: "<p>С «Большим медведем» можно бросить против СЛ самоконтроля +5, чтобы получить и сопротивления медвежьей формы. Пытаться?</p>",
    yes: { label: "Да, СЛ +5" }, no: { label: "Нет, только ПБ" }
  }).catch(() => false);
}

/** Успех проверки способности облика человека: эффект и карточка. */
export async function bearAbilitySuccess(actor, name, level, { bigBear = false } = {}) {
  const hours = Math.max(1, level);
  const duration = { value: hours, units: "hours", expiry: null };
  if (name === "Медвежьи чувства") {
    const [eff] = await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Медвежьи чувства", img: "icons/magic/perception/eye-ringed-glow-angry-small-red.webp",
      transfer: false, duration, description: "<p>Ночное зрение и выслеживание по запаху.</p>", flags: { [SYS]: { bearSenses: true } } }]);
    const { applyVision } = await import("../crafting/alchemy-triggers.mjs");
    await applyVision(actor, eff, { visionMode: "darkvision", range: 30 });
    return postCard(actor, "Медвежьи чувства", `<p>На <b>${hours} ч</b>: ночное зрение (30 м) и выслеживание по запаху.</p>`, { icon: "fa-solid fa-paw" });
  }
  if (name === "Спячка") {
    await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Спячка", img: "icons/magic/time/day-night-sunset-sunrise.webp", transfer: false,
      duration: { value: 1, units: "days", expiry: null }, description: "<p>Следующий день отдыха: ПЗ вдвое, лечение критических ранений на 2 дня короче.</p>",
      flags: { [SYS]: { bearHibernate: true } } }]);
    return postCard(actor, "Спячка", "<p>Берсерк засыпает на весь день: при отдыхе (лист → «Отдых: дни») ПЗ восстанавливаются вдвое, лечение критических ранений — на 2 дня короче.</p>",
      { icon: "fa-solid fa-moon" });
  }
  if (name === "Медвежья шкура") {
    const resist = [];
    if (level >= 10) resist.push("bludgeoning");
    if (bigBear) for (const r of formStats(actor).resist) if (!resist.includes(r)) resist.push(r);
    await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Медвежья шкура", img: IMG, transfer: false, duration,
      system: { changes: [{ key: "system.fx.sp", type: "add", value: level, phase: "initial" }] },
      flags: { [SYS]: { bearHide: { resist } } } }]);
    const names = { bludgeoning: "дробящему", piercing: "колющему", slashing: "режущему" };
    return postCard(actor, "Медвежья шкура", `<p>На <b>${hours} ч</b>: +${level} ПБ${resist.length ? `, сопротивление ${resist.map(r => names[r]).join(", ")} урону` : ""}.</p>`,
      { icon: "fa-solid fa-shield" });
  }
  return null;
}

/** «Удар сверху» доступен: медвежья форма и способность в древе. */
export const bearSlamLevel = actor => (inBearForm(actor) ? abilityLevel(actor, "Удар сверху") : 0);

/** Вернуться в человеческий облик (пока владеет собой — в любой момент). */
export async function bearRevert(actor, { reason = "" } = {}) {
  const eff = bearFormEffect(actor);
  if (!eff || reverting.has(eff.uuid)) return null;
  reverting.add(eff.uuid);
  try {
    await eff.delete({ vedmakBearReason: reason });
  } catch (err) {
    // Форму уже сняли одновременно с нами (срок, второе окно того же игрока) — это не ошибка
    if (bearFormEffect(actor)) throw err;
  } finally {
    reverting.delete(eff.uuid);
  }
  return true;
}
/** Формы, которые уже снимаются: повторный запрос (потеря сознания и срок разом) их не трогает. */
const reverting = new Set();

/** Начало хода в бою: проверка самоконтроля. */
export async function bearFormStartOfTurn(actor) {
  if (!inBearForm(actor) || !inCombat(actor)) return [];
  const dc = controlDc(actor);
  const res = await actor.rollDefining({ subtitle: "Медвежья форма: самоконтроль", dc, skipDialog: true });
  if (!res) return [];
  return [res.success
    ? `Медвежья форма: самоконтроль ${res.total} против СЛ ${dc} — берсерк владеет собой.`
    : `Медвежья форма: самоконтроль ${res.total} против СЛ ${dc} — <b>в этом раунде берсерк не владеет собой</b> (действует зверь; «Больше человек, чем зверь» — переброс).`];
}

/** Форма спала: оружие медведя уходит, ПЗ снова вдвое меньше. */
async function formEnded(effect, reason) {
  const actor = effect.parent;
  const ids = actor.items.filter(i => i.getFlag(SYS, "bearFormWeapon")).map(i => i.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids).catch(err => { if (ids.some(id => actor.items.has(id))) throw err; });
  const hp = actor.system.hp.value;
  const halved = hp > 0 ? Math.ceil(hp / 2) : hp;
  await actor.update({ "system.hp.value": Math.min(actor.system.hp.max, halved) });
  await postCard(actor, "Медвежья форма спадает", `<p>${reason ? `${reason} ` : ""}Берсерк снова человек: ПЗ вдвое меньше — ${actor.system.hp.value} / ${actor.system.hp.max}. Критические ранения, полученные медведем, остаются.</p>`,
    { icon: "fa-solid fa-person" });
}

export function registerBearFormHooks() {
  Hooks.on("deleteActiveEffect", (effect, options, userId) => {
    if (userId !== game.user.id || !effect.flags?.[SYS]?.[FLAG] || effect.parent?.documentName !== "Actor") return;
    formEnded(effect, options?.vedmakBearReason ?? "").catch(err => console.error("vedmak | конец медвежьей формы", err));
  });
  // Без сознания — снова человек (у того, кто поставил состояние)
  Hooks.on("createActiveEffect", (effect, options, userId) => {
    if (userId !== game.user.id || !effect.statuses?.has("unconscious")) return;
    const actor = effect.parent;
    if (actor?.documentName !== "Actor" || !bearFormEffect(actor)) return;
    bearRevert(actor, { reason: "Без сознания." }).catch(err => console.error("vedmak | медвежья форма", err));
  });
  // Срок вышел (время мира) — снять у активного ведущего
  Hooks.on("updateWorldTime", () => {
    if (!game.users.activeGM?.isSelf) return;
    for (const actor of game.actors) {
      const eff = bearFormEffect(actor);
      if (eff && eff.updateDuration?.().remaining <= 0) bearRevert(actor, { reason: "Срок вышел." }).catch(() => {});
    }
  });
}
