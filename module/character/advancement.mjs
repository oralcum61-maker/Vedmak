// Развитие персонажа за Очки Улучшения (корник стр. 59–61, 124).
//  • Навык: новый — 1 О.У, дальше — текущий уровень; сложный — вдвое дороже; максимум 10.
//  • Параметр: текущее значение × 10; максимум 10.
//  • Способности древа — как навыки; следующая открывается после 5 очков в предыдущей.
//  • Магия: 10/20/30/40 О.У по уровню, плюс время и проверки обучения.

import { SKILLS } from "../config/skills.mjs";
import { STATS } from "../config/stats.mjs";
import { CREATION, MAGIC_ACCESS, MAGIC_LEARNING, HEX_DANGER_LEVEL, skillStepCost, statStepCost, witcherSchools } from "../config/character.mjs";
import { levelLabel } from "../config/magic.mjs";
import { postCard } from "../util.mjs";

const { DialogV2 } = foundry.applications.api;

/** Что можно улучшить и за сколько. Возвращает {label, from, to, cost, error?}. */
export function skillOffer(actor, key) {
  const def = SKILLS[key];
  const from = actor.system.skills[key]?.value ?? 0;
  const out = { label: def.label, from, to: from + 1, cost: skillStepCost(from, def.difficult) };
  if (from >= CREATION.skillCap) out.error = `Навык уже на максимуме (${CREATION.skillCap}).`;
  return out;
}

/**
 * Постоянные поправки параметра для развития: расы, школы ведьмака и эффекта «Жизненный путь», пределы — расы и школы
 * (так же, как в `prepareDerivedData` модели персонажа: цикл по `race.mods` и `school.mods`). Зелья, раны и перегруз
 * не в счёт: от них цена не должна прыгать. Ни одно поле модели так не считается (`raw` включает и временные эффекты).
 * @returns {{bonus:number, cap:(number|undefined), floor:(number|undefined), at:(base:number)=>number}}
 *   `at(основа)` — нынешнее значение при такой основе (с поправками и пределами).
 */
function statParts(actor, key) {
  const sys = actor.system;
  let bonus = 0, cap, floor;
  const school = witcherSchools()[sys.details?.school] ?? {};
  for (const { target, value: v } of [...(sys.race?.system.mods ?? []), ...(school.mods ?? [])]) {
    const [group, k] = String(target).split(".");
    if (k !== key) continue;
    if (group === "stats") bonus += Number(v) || 0;
    else if (group === "cap") cap = Math.min(cap ?? Infinity, v);
    else if (group === "floor") floor = Math.max(floor ?? -Infinity, v);
  }
  for (const effect of actor.effects) {
    if (effect.disabled || !effect.getFlag("vedmak", "lifepath")) continue;
    for (const c of effect.system?.changes ?? []) {
      if (c.key === `system.stats.${key}.mod`) bonus += Number(c.value) || 0;
    }
  }
  const at = base => {
    let value = base + bonus;
    if (cap !== undefined) value = Math.min(value, cap);
    if (floor !== undefined) value = Math.max(value, floor);
    return Math.max(0, value);
  };
  return { bonus, cap, floor, at };
}

/**
 * Повышение параметра всегда поднимает НЫНЕШНЕЕ значение ровно на 1, а стоит оно «нынешнее × 10» (стр. 59).
 * Основа поднимается ровно настолько, чтобы это вышло: у ведьмака Эмп 3 − 4 упирается в нижний предел 1, и
 * прибавка к основе на 1 ничего бы не дала — поэтому основа прыгает до первого значения, где Эмп стал 2.
 * Предел книги (10) относится к купленной основе, а не к итогу: расовая прибавка Реа и Лвк ведьмака идёт сверху
 * (стр. 22 — «можно выше 10»), потому у ведьмака Реа и Лвк покупаются до 10 основы, то есть до 11 итога.
 */
export function statOffer(actor, key) {
  const { cap, at } = statParts(actor, key);
  const base = actor.system.stats[key]?.base ?? 0;
  const from = at(base);
  const out = { label: STATS[key].label, from, to: from + 1, cost: statStepCost(from) };
  // Первая основа, при которой нынешнее значение вырастет ровно до from + 1 (пределы расы могут «съедать» шаги)
  let next = base + 1;
  while (at(next) <= from && next < base + 20) next++;
  out.base = next;
  if (base >= CREATION.statCap) out.error = `Параметр уже на максимуме (${CREATION.statCap}).`;
  else if (cap !== undefined && from >= cap) out.error = `Раса не даёт поднять параметр выше ${cap}.`;
  else if (at(next) <= from) out.error = "Параметр не удаётся поднять: мешают пределы расы.";
  else if (next > CREATION.statCap) out.error = `Параметр уже на максимуме (${CREATION.statCap}).`;
  else out.to = at(next);
  return out;
}

export function definingOffer(actor) {
  const prof = actor.system.profession;
  if (!prof) return { error: "У персонажа нет профессии." };
  const from = prof.system.definingSkill.value;
  const out = { label: prof.system.definingSkill.name || "Определяющий навык", from, to: from + 1, cost: skillStepCost(from) };
  if (from >= CREATION.skillCap) out.error = `Навык уже на максимуме (${CREATION.skillCap}).`;
  return out;
}

export function abilityOffer(actor, branch, index) {
  const prof = actor.system.profession;
  const ab = prof?.system.ability(branch, index);
  if (!ab) return { error: "Способность не найдена." };
  const from = ab.value;
  const out = { label: ab.name, from, to: from + 1, cost: skillStepCost(from) };
  if (from >= CREATION.skillCap) out.error = `Способность уже на максимуме (${CREATION.skillCap}).`;
  else if (!prof.system.isUnlocked(branch, index)) {
    const prev = index === 0 ? prof.system.definingSkill.name : prof.system.ability(branch, index - 1).name;
    out.error = `Сначала вложите 5 очков в «${prev}».`;
  }
  return out;
}

/** Подтвердить трату, списать О.У, применить изменение и написать в чат. */
async function spend(actor, offer, apply, { skipConfirm = false, kind = "" } = {}) {
  if (offer.error) return ui.notifications.warn(offer.error);
  const ip = actor.system.improvementPoints.value;
  if (ip < offer.cost) {
    return ui.notifications.warn(`Не хватает О.У: нужно ${offer.cost}, есть ${ip}.`);
  }
  if (!skipConfirm) {
    const ok = await DialogV2.confirm({
      window: { title: "Развитие", icon: "fa-solid fa-arrow-up-right-dots" },
      content: `<p><b>${offer.label}</b>: ${offer.from} → ${offer.to}</p><p>Стоимость: <b>${offer.cost} О.У</b> (осталось ${ip - offer.cost}).</p>`
    });
    if (!ok) return null;
  }
  await apply();
  await actor.update({ "system.improvementPoints.value": ip - offer.cost });
  await postCard(actor, "Развитие", `<p>${kind ? `${kind}: ` : ""}<b>${offer.label}</b> ${offer.from} → ${offer.to}</p>
    <p class="hint">Потрачено ${offer.cost} О.У, осталось ${ip - offer.cost}.</p>`, { icon: "fa-solid fa-arrow-up-right-dots", cls: "advancement" });
  return true;
}

export function improveSkill(actor, key, opts) {
  return spend(actor, skillOffer(actor, key),
    () => actor.update({ [`system.skills.${key}.value`]: actor.system.skills[key].value + 1 }), { ...opts, kind: "Навык" });
}

export function improveStat(actor, key, opts) {
  const offer = statOffer(actor, key);
  return spend(actor, offer,
    () => actor.update({ [`system.stats.${key}.base`]: offer.base }), { ...opts, kind: "Параметр" });
}

export function improveDefining(actor, opts) {
  const prof = actor.system.profession;
  return spend(actor, definingOffer(actor),
    () => prof.update({ "system.definingSkill.value": prof.system.definingSkill.value + 1 }), { ...opts, kind: "Определяющий навык" });
}

export function improveAbility(actor, branch, index, opts) {
  const prof = actor.system.profession;
  return spend(actor, abilityOffer(actor, branch, index), () => setAbilityValue(prof, branch, index, prof.system.ability(branch, index).value + 1),
    { ...opts, kind: "Способность древа" });
}

/** Записать значение способности (массивы в данных обновляются целиком). */
export function setAbilityValue(profession, branch, index, value) {
  const branches = profession.system.toObject().branches;
  if (!branches[branch]?.abilities[index]) return null;
  branches[branch].abilities[index].value = Math.max(0, Number(value) || 0);
  return profession.update({ "system.branches": branches });
}

/** Начислить О.У (ведущий, стр. 59). */
export async function grantImprovementPoints(actor) {
  const amount = await DialogV2.wait({
    window: { title: "Начислить О.У", icon: "fa-solid fa-star" },
    classes: ["vedmak", "vedmak-dialog"],
    content: `<div class="vedmak-roll-dialog">
      <div class="form-group"><label>Сколько О.У</label><input type="number" name="amount" value="1" autofocus></div>
      <div class="form-group"><label>За что</label><input type="text" name="reason" value=""></div>
      <p class="hint">Книга не советует давать одному игроку больше 6 О.У за партию (стр. 59).</p></div>`,
    buttons: [{ action: "ok", label: "Начислить", icon: "fa-solid fa-check", default: true,
      callback: (e, b) => ({ amount: Number(b.form.elements.amount.value) || 0, reason: b.form.elements.reason.value.trim() }) },
      { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  if (!amount || amount === "cancel" || !amount.amount) return;
  const ip = actor.system.improvementPoints;
  await actor.update({ "system.improvementPoints.value": ip.value + amount.amount, "system.improvementPoints.total": ip.total + Math.max(0, amount.amount) });
  await postCard(actor, "Очки Улучшения",
    `<p><b>${actor.name}</b> получает ${amount.amount} О.У${amount.reason ? ` — ${foundry.utils.escapeHTML(amount.reason)}` : ""}.</p>`,
    { icon: "fa-solid fa-star", cls: "advancement" });
}

/* --------------------------------- Магия --------------------------------- */

/** Уровень изучения заклинания (порча — по опасности). */
export function learningLevel(spell) {
  const s = spell.system;
  if (s.kind === "hex") return HEX_DANGER_LEVEL[String(s.danger).toLowerCase()] ?? s.level ?? "novice";
  return s.level ?? "novice";
}

/**
 * Можно ли изучить: Энергия больше 0; маги — заклинания, ритуалы, порча, знаки;
 * жрецы — инвокации, ритуалы, порча, знаки; ведьмаки — только знаки (стр. 124).
 * Магический дар («Том Хаоса», стр. 74) не учат: его даёт ведущий при создании персонажа.
 */
export function learningCheck(actor, spell) {
  const kind = spell.system.kind;
  const key = actor.system.professionKey;
  if (kind === "gift") return "Магический дар не изучают: его даёт ведущий при создании персонажа.";
  if (!(actor.system.derived?.vigor > 0)) return "Энергия персонажа равна 0 — он не может изучать магию.";
  const access = MAGIC_ACCESS[key];
  if (!access) return "Профессия персонажа не позволяет изучать магию.";
  if (!access.includes(kind)) return `${actor.system.profession.name} не может изучать: ${CONFIG.VEDMAK.MAGIC_KINDS[kind]}.`;
  return "";
}

/**
 * Спросить, изучать ли перетащенное заклинание за О.У или просто добавить.
 * @returns {Promise<"learn"|"add"|null>}
 */
export async function learnSpellDialog(actor, spell) {
  const level = learningLevel(spell);
  const cfg = MAGIC_LEARNING[level] ?? MAGIC_LEARNING.novice;
  const problem = learningCheck(actor, spell);
  const ip = actor.system.improvementPoints.value;
  const kindLabel = CONFIG.VEDMAK.MAGIC_KINDS[spell.system.kind];
  const skill = SKILLS[CONFIG.VEDMAK.MAGIC_SKILL[spell.system.kind] ?? "spellCasting"].label;
  const content = `<div class="vedmak-roll-dialog learn-spell">
    <p><b>${spell.name}</b> — ${kindLabel}, ${levelLabel(spell.system.kind, spell.system.level)}${spell.system.kind === "hex" ? ` (опасность: ${spell.system.danger || "—"})` : ""}</p>
    <ul class="parts">
      <li><span>Стоимость</span><b>${cfg.ip} О.У</b></li>
      <li><span>Время изучения</span><b>${cfg.time}</b></li>
      <li><span>Проверки: ${skill}</span><b>${cfg.checks} × СЛ ${cfg.dc}</b></li>
      <li><span>Есть О.У</span><b>${ip}</b></li>
    </ul>
    <p class="hint">Нужен наставник или книга. За каждый провал проверки обучение затягивается на день (стр. 124).</p>
    ${problem ? `<p class="warning">${problem}</p>` : ""}</div>`;
  const buttons = [];
  if (!problem && ip >= cfg.ip) buttons.push({ action: "learn", label: `Изучить (−${cfg.ip} О.У)`, icon: "fa-solid fa-book-open", default: true });
  buttons.push({ action: "add", label: "Просто добавить", icon: "fa-solid fa-plus", default: !!problem || ip < cfg.ip });
  buttons.push({ action: "cancel", label: "Отмена", icon: "fa-solid fa-xmark" });
  const choice = await DialogV2.wait({
    window: { title: "Изучение магии", icon: "fa-solid fa-hat-wizard" },
    classes: ["vedmak", "vedmak-dialog"], position: { width: 420 }, content, buttons, rejectClose: false
  });
  if (choice !== "learn") return choice === "add" ? "add" : null;
  await actor.update({ "system.improvementPoints.value": ip - cfg.ip });
  await postCard(actor, "Изучение магии", `<p><b>${spell.name}</b> (${kindLabel})</p>
    <p>Потрачено ${cfg.ip} О.У. Время: ${cfg.time}; нужно ${cfg.checks} успешных проверок навыка «${skill}» со СЛ ${cfg.dc}.</p>`,
    { icon: "fa-solid fa-book-open", cls: "advancement" });
  return "learn";
}
