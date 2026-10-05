// Истинная форма высшего вампира («Высший вампир. Вторая редакция», стр. 31–35): превращение за Очки Крови
// с откатом, бонусы по уровню Превращения, органическая броня вместо надетой, регенерация в начале хода, укус
// и когти формы, страх, проверки Сопротивления Зверю и звериный срыв при полной Шкале Зверя.
// Форма — эффект актора с флагом `trueForm` и сроком `timed` (раунды в бою отсчитывает magicStartOfTurn,
// вне боя срок — время мира, timed.mjs); снятие эффекта убирает оружие формы и даёт усталость выхода.

import { performCheck } from "../dice/check.mjs";
import { postCard, inCombat, roundsAsTime } from "../util.mjs";
import { itemsForLabel } from "./wizard.mjs";
import { asGM, registerGMHandler, userOwnsAny, resolveActor } from "../combat/common.mjs";
import { applyStatus } from "../combat/damage.mjs";

const FLAG = "trueForm";
const SYS = "vedmak";
export const TRUE_FORM_KEY = "trueForm";
/** Оружие Истинной формы (компендиум оружия, «Естественное»): выдаётся на время формы. */
export const TRUE_FORM_WEAPONS = ["Укус (Истинная форма)", "Когти (Истинная форма)"];
const COST = 30, FAIL_COST = 15, EXTEND_COST = 10;
const DAY = 86400;
const IMG = "icons/creatures/abilities/wing-batlike-red-pink.webp";

/** Эффект Истинной формы на акторе. */
export function trueFormEffect(actor) {
  return actor?.effects?.find(e => e.flags?.[SYS]?.[FLAG]) ?? null;
}
export const inTrueForm = actor => !!trueFormEffect(actor)?.active;

/** Что даёт уровень Превращения (стр. 31–33). */
export function formTier(level) {
  const perks = [];
  if (level >= 3) perks.push("+2 к Атлетике и Уклонению (учтено), +2 к физической защите; вертикальный рывок до 6 м без проверки; Укус по кровоточащей цели — +1d6 ОК");
  if (level >= 5) perks.push("+2 м к Бегу (учтено); первая атака после вертикального перемещения +2 к попаданию; регенерация 2d6, если в этом раунде ранено существо с кровью");
  if (level >= 7) perks.push("Укус +2 по напуганной, раненой или кровоточащей цели; когти бьют двух целей одним действием; раз в сцену — проигнорировать критический эффект (не серебро, огонь, сильная магия) и стабилизировать лёгкий; после убийства существа с кровью — +2d6 ОК");
  if (level >= 9) perks.push("раз за превращение — ужасающий рывок до 10 м и сразу атака когтями или Укусом; раз за превращение — переброс проваленного Сопротивления Зверю");
  return {
    armor: level >= 9 ? 60 : level >= 7 ? 50 : 30,
    regen: level >= 9 ? "2d6" : level >= 3 ? "1d6+2" : "1d6",
    beastBonus: level >= 9 ? 3 : level >= 7 ? 2 : level >= 5 ? 1 : 0,
    controlDc: level >= 5 ? 13 : 15,
    fearBonus: level >= 5 ? 2 : 0,
    fearArea: level >= 9,
    exitTired: level <= 4,
    cooldownDays: level >= 9 ? 0.5 : level >= 7 ? 1 : level >= 5 ? 3 : level >= 3 ? 5 : 7,
    cooldownText: level >= 9 ? "до следующего рассвета или конца большой сцены" : level >= 7 ? "1 день" : level >= 5 ? "3 дня"
      : level >= 3 ? "5 дней" : "7 дней",
    perks
  };
}

/** Срок в словах: «2 дн. 4 ч», «35 мин». */
function timeLeft(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / DAY), h = Math.floor((s % DAY) / 3600), m = Math.ceil((s % 3600) / 60);
  if (d) return `${d} дн.${h ? ` ${h} ч` : ""}`;
  if (h) return `${h} ч${m ? ` ${m} мин` : ""}`;
  return `${m} мин`;
}

/** Состояние формы для листа: в форме ли, сколько раундов, откат, срыв. */
export function trueFormState(actor) {
  const eff = trueFormEffect(actor);
  const now = game.time.worldTime;
  const ready = actor.getFlag(SYS, "trueFormReady") ?? 0;
  const f = eff?.flags[SYS][FLAG];
  let rounds = null;
  if (eff) {
    const t = eff.flags[SYS].timed?.rounds;
    if (t > 0) rounds = t;
    else if (eff.duration?.seconds || eff.duration?.value) {
      const rem = eff.updateDuration?.().remaining;
      if (Number.isFinite(rem)) rounds = Math.max(0, Math.ceil(rem / (CONFIG.time.roundTime || 3)));
    }
  }
  return {
    active: !!eff, rounds, forced: !!f?.forced, frenzy: !!f?.frenzy, streak: f?.streak ?? 0,
    cooldown: now < ready ? timeLeft(ready - now) : "",
    blocked: isBlocked(actor)
  };
}

/** Метка «до конца сцены» после проваленного превращения: бой или 10 минут мира. */
function isBlocked(actor) {
  const b = actor.getFlag(SYS, "trueFormBlocked");
  if (!b) return false;
  if (b.combat) return game.combat?.id === b.combat;
  return game.time.worldTime < (b.until ?? 0);
}

/** Проверка Сопротивления Зверю: Воля + Сопротивление Жажде крови + d10 (+ бонус формы). */
export async function beastCheck(actor, { dc, bonus = 0, title = "Сопротивление Зверю", subtitle = "" } = {}) {
  const race = actor.system.race;
  const p = race?.system.power("thirstResist");
  const will = actor.system.stats.will;
  const parts = [
    { label: will.label, value: will.effective, always: true },
    { label: p?.name ?? "Сопротивление Жажде крови", value: p?.value ?? 0, always: true }
  ];
  if (bonus) parts.push({ label: "Истинная форма", value: bonus });
  if (actor.system.derived?.actionMod) parts.push({ label: "Ранения: ко всем действиям", value: actor.system.derived.actionMod });
  return performCheck({ actor, title, subtitle, parts, dc });
}

/**
 * Принять Истинную форму.
 * @param {Actor} actor
 * @param {object} [opts] — forced: звериный срыв (без ОК, отката и проверки); skipDialog: бросок без окна
 */
export async function transform(actor, { forced = false, skipDialog = false } = {}) {
  const race = actor.system.race;
  const power = race?.system.power?.("trueForm");
  if (!power) return ui.notifications.warn(`${actor.name}: у расы нет Истинной формы.`);
  if (trueFormEffect(actor)) return ui.notifications.info(`${actor.name} уже в Истинной форме.`);
  const level = power.value;
  const blood = actor.system.blood?.value ?? 0;
  const now = game.time.worldTime;

  if (!forced) {
    if (level < 1) return ui.notifications.warn("Превращение не изучено: уровень 0.");
    const ready = actor.getFlag(SYS, "trueFormReady") ?? 0;
    if (now < ready) return ui.notifications.warn(`Превращение ещё не восстановилось: осталось ${timeLeft(ready - now)}.`);
    if (isBlocked(actor)) return ui.notifications.warn("После проваленного превращения повторить можно только в следующей сцене.");
    if (blood < COST) return ui.notifications.warn(`Нужно ${COST} Очков Крови, есть ${blood}.`);

    const check = await actor.rollRacePower("trueForm", { skipDialog });
    if (!check) return null;
    if (!check.success) {
      const dmg = await new Roll("1d6").evaluate();
      await actor.update({ "system.blood.value": Math.max(0, blood - FAIL_COST), "system.hp.value": actor.system.hp.value - dmg.total });
      await actor.setFlag(SYS, "trueFormBlocked", game.combat?.started ? { combat: game.combat.id } : { until: now + 600 });
      await postCard(actor, "Истинная форма: не удалось", `<p>Превращение сорвалось: −${FAIL_COST} ОК, −${dmg.total} ПЗ (1d6, броня не снижает).</p>
        <p class="hint">Повторить попытку можно только в следующей сцене.</p>`, { icon: "fa-solid fa-droplet", rolls: [dmg] });
      return null;
    }
  }

  const tier = formTier(level);
  const update = {};
  const lines = [];
  if (!forced) update["system.blood.value"] = blood - COST;

  // Вход в форму с непустой Шкалой Зверя — проверка контроля (на 5+ уровне СЛ 13)
  let beast = actor.system.beast?.value ?? 0;
  if (!forced && beast >= 1) {
    const res = await beastCheck(actor, { dc: tier.controlDc, bonus: tier.beastBonus, subtitle: "Вход в Истинную форму" });
    if (!res.success) { beast = Math.min(10, beast + 1); update["system.beast.value"] = beast; lines.push(`Сопротивление Зверю провалено: Шкала Зверя ${beast}/10.`); }
    else lines.push("Сопротивление Зверю: контроль сохранён.");
  }
  // Шкала заполнилась на входе — срыв ставится ниже на саму форму, хук полной шкалы не нужен
  if (Object.keys(update).length) await actor.update(update, { vedmakBeastHandled: true });

  // Срок: 1d6 + уровень раундов
  const dur = await new Roll(`1d6 + ${level}`).evaluate();
  const rounds = dur.total;
  const combat = inCombat(actor);
  const changes = ["ref", "dex", "spd", "body"].map(k => ({ key: `system.stats.${k}.mod`, type: "add", value: 5, phase: "initial" }));
  if (level >= 3) changes.push(...["athletics", "dodge"].map(k => ({ key: `system.skills.${k}.mod`, type: "add", value: 2, phase: "initial" })));
  if (level >= 5) changes.push({ key: "system.fx.run", type: "add", value: 2, phase: "initial" });
  const data = {
    name: "Истинная форма", img: IMG, transfer: false,
    description: `<p>Уровень Превращения ${level}. Органическая броня ${tier.armor} вместо надетой, регенерация ${tier.regen} ПЗ в начале хода, Укус и Когти формы.</p>`,
    system: { changes },
    flags: { [SYS]: {
      [FLAG]: { level, armor: tier.armor, regen: tier.regen, forced, frenzy: forced || beast >= 10, streak: 0 },
      timed: { key: TRUE_FORM_KEY, rounds: combat ? rounds : 0 }
    } }
  };
  if (!combat) data.duration = roundsAsTime(rounds);
  await actor.createEmbeddedDocuments("ActiveEffect", [data]);

  // Оружие формы
  const weapons = [];
  for (const name of TRUE_FORM_WEAPONS) {
    if (actor.items.some(i => i.name === name)) continue;
    for (const w of await itemsForLabel(name)) {
      if (w.type !== "weapon") continue;
      w.system.equipped = true;
      foundry.utils.setProperty(w, `flags.${SYS}.trueFormWeapon`, true);
      weapons.push(w);
    }
  }
  if (weapons.length) await actor.createEmbeddedDocuments("Item", weapons);

  if (!forced) await actor.setFlag(SYS, "trueFormReady", now + Math.round(tier.cooldownDays * DAY));

  const fearSkill = actor.system.skills.intimidation;
  const fearDc = (fearSkill?.base ?? 0) + 3 + tier.fearBonus;
  const body = [
    forced ? "<p><b>Звериный срыв:</b> форма принята насильно — без ОК и отката. Разум уступает место Зверю; поведение определяет ведущий. Вернуть разум — 3 успешные проверки Сопротивления Зверю подряд со СЛ 20.</p>"
      : `<p>Потрачено ${COST} ОК. Следующее превращение — через ${tier.cooldownText}.</p>`,
    `<p>Длительность: <b>${rounds}</b> раундов (1d6 + ${level}). Продлить на 1d6 раундов — ${EXTEND_COST} ОК.</p>`,
    `<ul><li>+5 к Реа, Лвк, Скор и Тел</li><li>органическая броня ${tier.armor} на всё тело — надетая броня не учитывается</li>`
      + `<li>регенерация ${tier.regen} ПЗ в начале каждого хода</li><li>перемещение по горизонтали и вертикали</li>`
      + `<li>Укус 8d6 (кровопускание 100%, улучшенное пробитие, высасывание крови без проверки) и Когти 6d6+3</li>`
      + tier.perks.map(x => `<li>${x}</li>`).join("") + "</ul>",
    `<p><b>Ужас:</b> враги, ${tier.fearArea ? "в радиусе 6 м" : "видящие превращение"}, — проверка Воли со СЛ <b>${fearDc}</b>`
      + ` (Запугивание ${fearSkill?.base ?? 0} + 3${tier.fearBonus ? " + 2" : ""}), 1d6 раундов. Провал: −3 к первой атаке по вампиру,`
      + " нельзя добровольно приблизиться в следующий ход, атаковать в ближнем бою — только после проверки Воли;"
      + ` низшие вампиры и животные отступают или замирают${tier.fearArea ? "; провалившие −3 к атаке и не приближаются до конца следующего раунда" : ""}.</p>`,
    ...lines.map(l => `<p>${l}</p>`),
    !forced && beast >= 10 ? "<p><b>Шкала Зверя заполнена — звериный срыв:</b> вернуть разум — 3 успешные проверки Сопротивления Зверю подряд со СЛ 20.</p>" : ""
  ].join("");
  // Ужас: выбранные цели (враги, видящие превращение) проверяют Храбрость
  const fear = await fearChecks(actor, fearDc);
  await postCard(actor, forced ? "Звериный срыв: Истинная форма" : "Истинная форма", body + fear.html,
    { icon: "fa-solid fa-skull", rolls: [dur, ...fear.rolls] });
  return true;
}

/**
 * Ужас Истинной формы: каждая выбранная цель — Воля + Храбрость + d10 против СЛ ужаса; провал — «Страх» на 1d6 раундов.
 * Состояние ставит ведущий (цели обычно чужие).
 */
async function fearChecks(actor, dc) {
  const targets = [...(game.user.targets ?? [])].map(t => t.actor).filter(a => a && a !== actor);
  if (!targets.length) return { html: '<p class="hint">Выберите цели перед превращением — их проверка ужаса бросится сама.</p>', rolls: [] };
  const rows = [], rolls = [], scared = [];
  for (const t of targets) {
    const base = (t.system.stats?.will?.effective ?? 0) + (t.system.skills?.courage?.total ?? 0);
    const r = await new Roll("1d10").evaluate();
    rolls.push(r);
    const total = base + r.total;
    const ok = total > dc;
    if (!ok) {
      const rounds = (await new Roll("1d6").evaluate()).total;
      scared.push({ uuid: t.uuid, rounds });
      rows.push(`<li>${foundry.utils.escapeHTML(t.name)}: ${total} — <b>страх</b> на ${rounds} р.</li>`);
    } else rows.push(`<li>${foundry.utils.escapeHTML(t.name)}: ${total} — устоял</li>`);
  }
  if (scared.length) await asGM("trueFormFear", { vampireUuid: actor.uuid, targets: scared });
  return { html: `<p><b>Проверка ужаса</b> (Воля + Храбрость + d10 против ${dc}):</p><ul>${rows.join("")}</ul>`, rolls };
}

registerGMHandler("trueFormFear", async ({ vampireUuid, targets }, userId) => {
  const vampire = resolveActor(vampireUuid);
  const form = vampire && trueFormEffect(vampire);
  if (!form || !userOwnsAny(userId, vampire)) return;
  // Ужас — один раз на превращение: повторный запрос (из консоли) больше никого не пугает
  if (form.getFlag(SYS, "fearApplied")) return console.warn(`vedmak | повторный ужас Истинной формы от ${game.users.get(userId)?.name ?? userId}`);
  await form.setFlag(SYS, "fearApplied", true);
  for (const { uuid, rounds } of (targets ?? []).slice(0, 30)) {
    const t = resolveActor(uuid);
    if (!t) continue;
    await applyStatus(t, "frightened", Math.max(1, Math.min(6, Number(rounds) || 1)));
    // Источник страха — для −3 к атакам против него (attack.mjs)
    const fear = t.effects.find(e => e.statuses?.has("frightened"));
    if (fear) await fear.setFlag(SYS, "fearSource", vampire.uuid);
  }
});

/** Продлить форму на 1d6 раундов за 10 ОК. */
export async function extendForm(actor) {
  const eff = trueFormEffect(actor);
  if (!eff) return null;
  const blood = actor.system.blood?.value ?? 0;
  if (blood < EXTEND_COST) return ui.notifications.warn(`Нужно ${EXTEND_COST} ОК, есть ${blood}.`);
  const roll = await new Roll("1d6").evaluate();
  await actor.update({ "system.blood.value": blood - EXTEND_COST });
  const timed = eff.flags[SYS].timed;
  if (timed?.rounds > 0) await eff.update({ [`flags.${SYS}.timed.rounds`]: timed.rounds + roll.total });
  else {
    const left = Math.max(0, Math.ceil((eff.updateDuration().remaining ?? 0) / (CONFIG.time.roundTime || 3)));
    await eff.update({ start: { time: game.time.worldTime }, duration: { ...roundsAsTime(left + roll.total), expired: false } });
  }
  await postCard(actor, "Истинная форма продлена", `<p>−${EXTEND_COST} ОК, ещё ${roll.total} раундов (1d6).</p>`, { icon: "fa-solid fa-hourglass-half", rolls: [roll] });
  return true;
}

/** Выйти из формы досрочно (во время срыва — только ведущий). */
export async function endForm(actor) {
  const eff = trueFormEffect(actor);
  if (!eff) return null;
  if (eff.flags[SYS][FLAG].frenzy && !game.user.isGM) return ui.notifications.warn("Во время срыва из формы не выйти: сначала верните разум.");
  await eff.delete();
  return true;
}

/** Срыв: попытка вернуть разум — Сопротивление Зверю СЛ 20, нужно 3 успеха подряд. */
export async function regainControl(actor) {
  const eff = trueFormEffect(actor);
  const f = eff?.flags[SYS][FLAG];
  if (!f?.frenzy) return null;
  const tier = formTier(f.level ?? 0);
  const res = await beastCheck(actor, { dc: 20, bonus: tier.beastBonus, subtitle: `Звериный срыв: ${f.streak ?? 0} из 3 успехов подряд` });
  if (!res) return null;
  const streak = res.success ? (f.streak ?? 0) + 1 : 0;
  if (streak >= 3) {
    await eff.update({ [`flags.${SYS}.${FLAG}.frenzy`]: false, [`flags.${SYS}.${FLAG}.streak`]: 0 });
    await postCard(actor, "Разум вернулся", `<p>Три успеха подряд: вампир снова владеет собой.</p>
      <p class="hint">На выбор ведущего: остаться в Истинной форме до конца срока или сразу выйти — тогда −1d6 Вын и −3 ко всем действиям до конца сцены.</p>`,
      { icon: "fa-solid fa-brain" });
  } else {
    await eff.update({ [`flags.${SYS}.${FLAG}.streak`]: streak });
  }
  return res;
}

/** Начало хода: регенерация формы. */
export async function trueFormStartOfTurn(actor) {
  const eff = trueFormEffect(actor);
  if (!eff?.active) return [];
  const f = eff.flags[SYS][FLAG];
  const roll = await new Roll(f.regen || "1d6").evaluate();
  const hp = actor.system.hp;
  const heal = Math.min(roll.total, Math.max(0, hp.max - hp.value));
  if (heal) await actor.update({ "system.hp.value": hp.value + heal });
  const lines = [`Истинная форма: регенерация ${f.regen} = ${roll.total}${heal < roll.total ? `, восстановлено ${heal}` : ""} ПЗ.`];
  if (f.frenzy) lines.push("Звериный срыв: вампир действует как хищник; в конце раунда — попытка вернуть разум (Сопротивление Зверю СЛ 20).");
  return lines;
}

/** Форма закончилась: оружие формы уходит, на 1–4 уровне — −1d6 Вын. */
async function formEnded(effect) {
  const actor = effect.parent;
  const f = effect.flags[SYS][FLAG];
  const ids = actor.items.filter(i => i.getFlag(SYS, "trueFormWeapon")).map(i => i.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
  let text = "<p>Вампир возвращается к обычному облику: оружие формы убрано, надетая броня снова учитывается.</p>";
  let rolls = [];
  if (formTier(f.level ?? 0).exitTired) {
    const r = await new Roll("1d6").evaluate();
    await actor.update({ "system.sta.value": Math.max(0, actor.system.sta.value - r.total) });
    text += `<p>Усталость выхода из формы: −${r.total} Вын (1d6).</p>`;
    rolls = [r];
  }
  await postCard(actor, "Истинная форма спадает", text, { icon: "fa-solid fa-person", rolls });
}

/** Шкала Зверя заполнилась: на 9–10 уровне — внеочередная проверка, иначе срыв в Истинную форму. */
async function beastFull(actor) {
  const level = actor.system.race?.system.power?.("trueForm")?.value ?? 0;
  if (level >= 9) {
    const res = await beastCheck(actor, { dc: 15, bonus: formTier(level).beastBonus, subtitle: "Полная Шкала Зверя: внеочередная проверка" });
    if (res?.success) {
      await actor.update({ "system.beast.value": 9 });
      return postCard(actor, "Зверь сдержан", "<p>Срыва нет, Шкала Зверя −1.</p>", { icon: "fa-solid fa-shield-heart" });
    }
  }
  const eff = trueFormEffect(actor);
  if (eff) {
    if (eff.flags[SYS][FLAG].frenzy) return;
    await eff.update({ [`flags.${SYS}.${FLAG}.frenzy`]: true, [`flags.${SYS}.${FLAG}.streak`]: 0 });
    return postCard(actor, "Звериный срыв", "<p>Шкала Зверя заполнена: вампир теряет контроль в Истинной форме. Вернуть разум — 3 успешные проверки Сопротивления Зверю подряд со СЛ 20.</p>",
      { icon: "fa-solid fa-skull" });
  }
  return transform(actor, { forced: true });
}

export function registerTrueFormHooks() {
  Hooks.on("deleteActiveEffect", (effect, options, userId) => {
    if (userId !== game.user.id || !effect.flags?.[SYS]?.[FLAG] || effect.parent?.documentName !== "Actor") return;
    formEnded(effect).catch(err => console.error("vedmak | конец Истинной формы", err));
  });
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (userId !== game.user.id || options?.vedmakBeastHandled) return;
    const v = foundry.utils.getProperty(changes, "system.beast.value");
    if (v === undefined || v < 10 || !actor.system.race?.system.power?.("trueForm")) return;
    beastFull(actor).catch(err => console.error("vedmak | Шкала Зверя", err));
  });
}
