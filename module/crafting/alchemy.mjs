// Употребление алхимии (корник стр. 87–89, 246–255).
//
//  • Эликсиры и отвары имеют токсичность; пока сумма ≤ порога (100%, «Крепкий желудок» — до 150%) — без последствий,
//    сверх — отравление, пока токсичность не спадёт или не пройдена Стойкость СЛ 18 (отменяет последний эликсир).
//  • Не-ведьмак, выпив эликсир или отвар, проходит Стойкость СЛ 18, иначе отравлен и эффекта нет.
//  • Масло для меча — +5 урона по классу чудовищ на 30 минут.
//  • Мутаген — час подготовки и проверка Алхимии; эффект навсегда, не больше двух; не-мутанты отравляются.
//  • Бомбы — метательное оружие (Атлетика, Тел×4 м), урон по всем частям тела всем в зоне.

import { SKILLS } from "../config/skills.mjs";
import { STATS } from "../config/stats.mjs";
import { CRAFTING, ALCHEMY_KINDS } from "../config/crafting.mjs";
import { MONSTER_CLASSES } from "../data/actor/monster.mjs";
import { performCheck } from "../dice/check.mjs";
import { postCard, resolveActor, tokenDistance } from "../combat/common.mjs";
import { registerChatAction } from "../combat/chat.mjs";
import { manualDamage } from "../combat/manual.mjs";
import { applyStatus } from "../combat/damage.mjs";

const { DialogV2 } = foundry.applications.api;

/** Карточка алхимии в чат. */
function card(actor, title, lines, { subtitle = "", buttons = [], rolls = [], flags = {} } = {}) {
  return postCard({
    template: "systems/vedmak/templates/chat/alchemy.hbs",
    data: { title, subtitle, lines, buttons, actorUuid: actor.uuid },
    actor, rolls, flags: { alchemy: { actorUuid: actor.uuid, ...flags } }
  });
}

async function spendOne(item) {
  const q = item.system.quantity ?? 1;
  if (q <= 1) await item.delete();
  else await item.update({ "system.quantity": q - 1 });
}

/** Стойкость со СЛ (Тел + Стойкость). */
async function enduranceCheck(actor, dc, title) {
  const skill = actor.system.skills.endurance;
  const parts = [
    { label: STATS.body.label, value: actor.system.stats.body.effective, always: true },
    { label: SKILLS.endurance.label, value: skill.total, always: true }
  ];
  if (skill.penalty) parts.push({ label: "Ранения", value: skill.penalty });
  return performCheck({ actor, title, subtitle: `Стойкость, СЛ ${dc}`, parts, dc });
}

const isMutant = actor => actor.type === "character" && actor.system.raceKey === "witcher";

/** Все активные эффекты эликсиров и отваров, новые — последними. */
export function alchemyEffects(actor) {
  return actor.effects.filter(e => e.flags?.vedmak?.alchemy)
    .sort((a, b) => (a.flags.vedmak.alchemy.at ?? 0) - (b.flags.vedmak.alchemy.at ?? 0));
}

/* --------------------------------- Выпить --------------------------------- */

export async function drink(actor, item) {
  const s = item.system;
  const u = s.use;
  const lines = [s.effect];
  const rolls = [];
  const witcherBrew = ["elixir", "decoction"].includes(s.kind);

  // Не-мутант и ведьмачий эликсир (стр. 246)
  if (witcherBrew && actor.type === "character" && !isMutant(actor)) {
    const check = await enduranceCheck(actor, CRAFTING.toxicitySaveDc, `${item.name}: не-мутант`);
    if (!check?.success) {
      await spendOne(item);
      await applyStatus(actor, "poisoned");
      return card(actor, item.name, ["Организм не выдержал ведьмачьего эликсира: персонаж отравлен, эффект не действует."], { subtitle: ALCHEMY_KINDS[s.kind] });
    }
  }

  // «Белый мёд»: токсичность в ноль, все эликсиры отменены
  if (u.clearToxicity) {
    const ids = alchemyEffects(actor).map(e => e.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    await actor.update({ "system.toxicity.value": 0 });
    if (actor.statuses.has("poisoned")) await actor.toggleStatusEffect("poisoned", { active: false });
    lines.push(`Отменено эликсиров и отваров: ${ids.length}.`);
  }

  for (const st of u.removeStatuses ?? []) {
    if (actor.statuses.has(st)) {
      await actor.toggleStatusEffect(st, { active: false });
      lines.push(`Снято: ${CONFIG.statusEffects[st]?.name ?? st}.`);
    }
  }

  // Эффект с длительностью
  const hasEffect = s.durationRounds || s.durationMinutes || s.toxicity || s.changes.length || u.regen || u.heal;
  if (hasEffect) {
    // Одинаковые эликсиры не суммируются — старый заменяется
    const same = alchemyEffects(actor).filter(e => e.flags.vedmak.alchemy.itemName === item.name).map(e => e.id);
    if (same.length) await actor.deleteEmbeddedDocuments("ActiveEffect", same);
    const effect = {
      name: item.name, img: item.img,
      system: { changes: foundry.utils.deepClone(s.changes) },
      flags: { vedmak: { alchemy: { toxicity: s.toxicity, kind: s.kind, itemName: item.name, at: Date.now() } } }
    };
    if (s.durationMinutes) effect.duration = { value: s.durationMinutes, units: "minutes" };
    if (s.durationRounds || u.regen) {
      effect.flags.vedmak.timed = { rounds: s.durationRounds || 0, key: "alchemy" };
      if (u.regen) effect.flags.vedmak.regen = u.regen;
    }
    await actor.createEmbeddedDocuments("ActiveEffect", [effect]);
    if (s.duration) lines.push(`Длительность: ${s.duration}.`);
  }
  if (u.heal) {
    await actor.update({ "system.hp.value": actor.system.hp.value + u.heal });
    lines.push(`+${u.heal} временных ПЗ.`);
  }
  await spendOne(item);

  // Токсичность (стр. 247)
  const buttons = [];
  if (s.toxicity && actor.type === "character") {
    const t = actor.system.toxicity;
    lines.push(`Токсичность: ${t.total}% из ${t.max}%.`);
    if (t.total > t.max) {
      await applyStatus(actor, "poisoned");
      lines.push("Порог превышен — персонаж отравлен, пока токсичность не спадёт или он не пройдёт Стойкость СЛ 18 (это отменит последний эликсир).");
      buttons.push({ action: "toxicitySave", label: "Стойкость СЛ 18", icon: "fa-solid fa-shield-virus" });
    }
  }
  return card(actor, item.name, lines, { subtitle: ALCHEMY_KINDS[s.kind], buttons, rolls });
}

registerChatAction("toxicitySave", async message => {
  const actor = resolveActor(message.flags.vedmak?.alchemy?.actorUuid);
  if (!actor?.isOwner) return ui.notifications.warn("Бросок делает владелец персонажа или ведущий.");
  const check = await enduranceCheck(actor, CRAFTING.toxicitySaveDc, "Токсичность");
  if (!check?.success) return;
  const last = alchemyEffects(actor).at(-1);
  if (last) await last.delete();
  if (actor.statuses.has("poisoned")) await actor.toggleStatusEffect("poisoned", { active: false });
  return card(actor, "Токсичность", [`Отравление прошло${last ? `; эффект «${last.name}» отменён` : ""}.`]);
});

/* ------------------------------- Применить ------------------------------- */

/** Составы, которые наносят на рану, на цель или дают понюхать: цель — выбранный токен или сам персонаж. */
export async function applyPreparation(actor, item) {
  const s = item.system;
  const target = [...game.user.targets][0]?.actor ?? actor;
  const lines = [`${target === actor ? actor.name : `${actor.name} → ${target.name}`}: ${s.effect}`];
  for (const st of s.use.removeStatuses ?? []) {
    if (target.statuses.has(st)) {
      await target.toggleStatusEffect(st, { active: false });
      lines.push(`Снято: ${CONFIG.statusEffects[st]?.name ?? st}.`);
    }
  }
  if (s.use.status && target.isOwner) {
    await applyStatus(target, s.use.status, s.use.statusRounds);
    lines.push(`Эффект: ${CONFIG.statusEffects[s.use.status]?.name ?? s.use.status}.`);
  }
  await spendOne(item);
  return card(actor, item.name, lines, { subtitle: ALCHEMY_KINDS[s.kind] });
}

/* ------------------------------ Бросок склянки ------------------------------ */

/** Цели в зоне: выбранные токены; если выбрана одна цель и есть радиус — все токены в радиусе от неё. */
function areaTargets(radius) {
  const targets = [...game.user.targets];
  if (targets.length !== 1 || !radius || !canvas?.ready) return targets.map(t => t.actor).filter(Boolean);
  const center = targets[0];
  return canvas.tokens.placeables.filter(t => t.actor && tokenDistance(center, t) <= radius).map(t => t.actor);
}

export async function throwItem(actor, item) {
  const s = item.system;
  const u = s.use;
  const body = actor.system.stats.body.total;
  const rangeText = u.range || (s.kind === "bomb" ? "Тел×4 м" : "Тел×2 м");
  const mult = Number(rangeText.match(/Тел\s*[×x]\s*(\d+)/)?.[1] ?? 0);
  const meters = mult ? body * mult : Number(rangeText.match(/\d+/)?.[0] ?? 0);
  const attack = await actor.rollSkill("athletics", { subtitle: `Бросок: ${item.name} (дистанция ${meters} м)` });
  if (!attack) return null;
  await spendOne(item);
  const radius = Number(String(u.area).match(/\d+/)?.[0] ?? 0);
  const victims = areaTargets(radius);
  const lines = [s.effect, `Зона: ${u.area || "—"}. Промах — склянка падает в случайном направлении (таблица разброса, стр. 152).`];
  const buttons = [];
  if ((u.damage || u.status) && victims.length) {
    await manualDamage(victims, {
      formula: u.damage, reason: item.name, damageType: u.damageType, where: "all",
      status: u.status, statusChance: u.statusChance, statusRounds: u.statusRounds
    });
  } else if (u.damage || u.status) {
    lines.push("Цели не выбраны: выберите пострадавших (или одну цель — центр зоны) и нажмите кнопку ниже.");
    buttons.push({ action: "trapTrigger", label: "Урон по выбранным целям", icon: "fa-solid fa-burst" });
  }
  return card(actor, item.name, lines, { subtitle: ALCHEMY_KINDS[s.kind], buttons,
    flags: { trap: { name: item.name, use: foundry.utils.deepClone(u), effect: s.effect } } });
}

/* -------------------------------- Ловушка -------------------------------- */

export async function setTrap(actor, item) {
  const s = item.system;
  await spendOne(item);
  return card(actor, `Ловушка ${item.name}`, [s.effect, `Зона: ${s.use.area}. Заметить растяжку — Внимание против результата Знания ловушек установившего.`],
    { subtitle: "Установлена", buttons: [{ action: "trapTrigger", label: "Сработала (выбранные цели)", icon: "fa-solid fa-burst" }],
      flags: { trap: { name: item.name, use: s.use.toObject?.() ?? foundry.utils.deepClone(s.use), effect: s.effect } } });
}

registerChatAction("trapTrigger", async message => {
  const trap = message.flags.vedmak?.alchemy?.trap;
  if (!trap) return;
  const radius = Number(String(trap.use.area).match(/\d+/)?.[0] ?? 0);
  const victims = areaTargets(radius);
  if (!victims.length) return ui.notifications.warn("Выберите цели в зоне ловушки (или одну — центр взрыва).");
  return manualDamage(victims, {
    formula: trap.use.damage, reason: trap.name, damageType: trap.use.damageType, where: "all",
    status: trap.use.status, statusChance: trap.use.statusChance, statusRounds: trap.use.statusRounds
  });
});

/* ---------------------------------- Масло ---------------------------------- */

export async function applyOil(actor, item) {
  const weapons = actor.itemTypes.weapon.filter(w => !w.system.isRanged || w.system.isThrown);
  if (!weapons.length) return ui.notifications.warn("Нет оружия, на которое можно нанести масло.");
  const options = weapons.map(w => `<option value="${w.id}" ${w.system.equipped ? "selected" : ""}>${w.name}${w.system.activeOil ? ` (сейчас: ${w.system.oil.name})` : ""}</option>`).join("");
  const id = await DialogV2.wait({
    window: { title: item.name, icon: "fa-solid fa-droplet" },
    classes: ["vedmak", "vedmak-dialog"],
    content: `<div class="vedmak-roll-dialog"><p>${item.system.effect}</p><div class="form-group"><label>Оружие</label><select name="weapon">${options}</select></div>
      <p class="hint">Нанесение занимает действие. Новое масло заменяет старое.</p></div>`,
    buttons: [{ action: "ok", label: "Нанести", icon: "fa-solid fa-droplet", default: true, callback: (e, b) => b.form.elements.weapon.value },
      { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  if (!id || id === "cancel") return null;
  const weapon = actor.items.get(id);
  const until = (game.time.worldTime ?? 0) + CRAFTING.oilMinutes * 60;
  await weapon.update({ "system.oil": { name: item.name, target: item.system.oilTarget, until } });
  await spendOne(item);
  return card(actor, item.name, [`Нанесено на «${weapon.name}»: +${CRAFTING.oilBonus} урона против: ${(MONSTER_CLASSES[item.system.oilTarget] ?? item.system.oilTarget).toLowerCase()} на ${CRAFTING.oilMinutes} минут.`],
    { subtitle: ALCHEMY_KINDS.oil });
}

/* --------------------------------- Мутаген --------------------------------- */

export async function applyMutagen(actor, item) {
  const s = item.system;
  if (s.applied) return ui.notifications.info(`«${item.name}» уже принят.`);
  const applied = actor.items.filter(i => i.type === "alchemical" && i.system.isMutagen && i.system.applied).length;
  if (applied >= CRAFTING.mutagenLimit) return ui.notifications.warn(`Уже принято ${applied} мутагена — больше нельзя (стр. 251).`);
  const ok = await DialogV2.confirm({
    window: { title: item.name, icon: "fa-solid fa-dna" },
    content: `<p>${s.effect}</p><p>Час подготовки и проверка Алхимии со СЛ <b>${s.mutagen.dc}</b>. Эффект постоянный, удалить мутаген нельзя.</p>
      ${isMutant(actor) ? "" : "<p class=\"warn\">Персонаж не мутант: мутаген отравит его (Стойкость или Первая помощь СЛ 18). Маг со способностью «Мутация» может мутировать подопытного.</p>"}`
  });
  if (!ok) return null;
  const skill = actor.system.skills.alchemy;
  const parts = [
    { label: STATS.cra.label, value: actor.system.stats.cra.effective, always: true },
    { label: SKILLS.alchemy.label, value: skill.total, always: true }
  ];
  const check = await performCheck({ actor, title: `Мутаген: ${item.name}`, parts, dc: s.mutagen.dc });
  if (!check.success) {
    await spendOne(item);
    return card(actor, item.name, ["Подготовка не удалась — мутаген испорчен."], { subtitle: ALCHEMY_KINDS.mutagen });
  }
  if (!isMutant(actor)) {
    await applyStatus(actor, "poisoned");
    await spendOne(item);
    return card(actor, item.name, ["Простые люди и нелюди не могут использовать мутагены: персонаж отравлен (Стойкость или Первая помощь СЛ 18)."],
      { subtitle: ALCHEMY_KINDS.mutagen, buttons: [{ action: "mutagenSave", label: "Стойкость СЛ 18", icon: "fa-solid fa-shield-virus" }] });
  }
  if ((s.quantity ?? 1) > 1) {
    await item.update({ "system.quantity": s.quantity - 1 });
    const data = item.toObject();
    delete data._id;
    data.system.quantity = 1;
    data.system.applied = true;
    await actor.createEmbeddedDocuments("Item", [data]);
  } else {
    await item.update({ "system.applied": true });
  }
  return card(actor, item.name, [s.effect, `Малая мутация: ${s.mutagen.minor}.`], { subtitle: "Мутаген принят" });
}

registerChatAction("mutagenSave", async message => {
  const actor = resolveActor(message.flags.vedmak?.alchemy?.actorUuid);
  if (!actor?.isOwner) return ui.notifications.warn("Бросок делает владелец персонажа или ведущий.");
  const check = await enduranceCheck(actor, CRAFTING.mutagenSaveDc, "Отравление мутагеном");
  if (check?.success && actor.statuses.has("poisoned")) await actor.toggleStatusEffect("poisoned", { active: false });
});

/* -------------------------------- Диспетчер -------------------------------- */

export function useAlchemical(actor, item) {
  switch (item.system.use.action) {
    case "drink": return drink(actor, item);
    case "apply": return applyPreparation(actor, item);
    case "throw": return throwItem(actor, item);
    case "oil": return applyOil(actor, item);
    case "mutagen": return applyMutagen(actor, item);
    case "trap": return setTrap(actor, item);
    default: return item.toChat?.();
  }
}

/** Снять истёкшие по времени эффекты алхимии и масла (вызывается в начале хода). */
export async function expireAlchemy(actor) {
  const lines = [];
  const expired = actor.effects.filter(e => e.flags?.vedmak?.alchemy && e.duration?.expired).map(e => e.id);
  if (expired.length) {
    lines.push(...expired.map(id => `${actor.effects.get(id).name}: действие закончилось.`));
    await actor.deleteEmbeddedDocuments("ActiveEffect", expired);
  }
  const now = game.time.worldTime ?? 0;
  for (const w of actor.itemTypes?.weapon ?? []) {
    if (w.system.oil.target && w.system.oil.until <= now) {
      lines.push(`${w.name}: масло «${w.system.oil.name}» выдохлось.`);
      await w.update({ "system.oil": { name: "", target: "", until: 0 } });
    }
  }
  return lines;
}
