// Употребление алхимии (корник стр. 87–89, 246–255).
//
//  • Эликсиры и отвары имеют токсичность; пока сумма ≤ порога (100%, «Крепкий желудок» — до 150%) — без последствий,
//    сверх — отравление, пока токсичность не спадёт или не пройдена Стойкость СЛ 18 (отменяет последний эликсир).
//  • Не-ведьмак, выпив эликсир или отвар, проходит Стойкость СЛ 18, иначе отравлен и эффекта нет.
//    Обычные эликсиры «Фургончика Родольфа» и эликсиры магов «Тома Хаоса» пьёт кто угодно (anyoneCanDrink).
//  • Масло для меча — +5 урона по классу чудовищ на 30 минут.
//  • Мутаген — час подготовки и проверка Алхимии; эффект навсегда, не больше двух; не-мутанты отравляются.
//  • Бомбы — метательное оружие (Атлетика, Тел×4 м), урон по всем частям тела всем в зоне.

import { SKILLS } from "../config/skills.mjs";
import { STATS } from "../config/stats.mjs";
import { CRAFTING, ALCHEMY_KINDS } from "../config/crafting.mjs";
import { MONSTER_CLASSES } from "../data/actor/monster.mjs";
import { performCheck } from "../dice/check.mjs";
import { postCard, resolveActor, tokenDistance } from "../combat/common.mjs";
import { parseArea, parseZoneDuration, zonesAvailable, placeZone, createZone, zoneTokens, ZONE_COLORS } from "../combat/zones.mjs";
import { registerChatAction } from "../combat/chat.mjs";
import { manualDamage } from "../combat/manual.mjs";
import { applyStatus } from "../combat/damage.mjs";
import { alchemyAuto, anyoneCanDrink } from "../config/alchemy-auto.mjs";
import { applyVision, healCritDialog } from "./alchemy-triggers.mjs";
import { inCombat, roundsAsTime } from "../util.mjs";
import { timeIsUp } from "../magic/timed.mjs";
import { deleteEffectsClamped } from "../magic/buffs.mjs";

const { DialogV2 } = foundry.applications.api;

/** Карточка алхимии в чат. */
function card(actor, title, lines, { subtitle = "", buttons = [], rolls = [], flags = {} } = {}) {
  return postCard({
    template: "systems/vedmak/templates/chat/alchemy.hbs",
    data: { title, subtitle, lines, buttons, actorUuid: actor.uuid },
    actor, rolls, flags: { alchemy: { actorUuid: actor.uuid, ...flags } }
  });
}

/**
 * Срок состава из текста «Длительности»: {rounds, minutes, rolled}. Кости бросаются («2d6 раундов»);
 * «мгновенно» — один раунд; непонятный текст («до следующей атаки») — без срока, как раньше.
 */
async function durationFromText(text = "") {
  const t = String(text).toLowerCase().replace(/[кk]/g, "d");
  if (/мгновенн/.test(t)) return { rounds: 1, minutes: 0, rolled: false };
  const m = t.match(/(\d*d\d+(?:\s*[+-]\s*\d+)?|\d+)\s*(раунд|минут|час|сут|дн|ден)/);
  if (!m) return { rounds: 0, minutes: 0, rolled: false };
  const rolled = /d/.test(m[1]);
  const n = rolled ? (await new Roll(m[1].replace(/\s/g, "")).evaluate()).total : Number(m[1]);
  const unit = m[2];
  if (unit === "раунд") return { rounds: n, minutes: 0, rolled };
  const minutes = unit === "минут" ? n : unit === "час" ? n * 60 : n * 1440;
  return { rounds: 0, minutes, rolled };
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
  const witcherBrew = ["elixir", "decoction"].includes(s.kind) && !anyoneCanDrink(item);

  // Не-мутант и ведьмачий эликсир (стр. 246)
  if (witcherBrew && actor.type === "character" && !isMutant(actor)) {
    const check = await enduranceCheck(actor, CRAFTING.toxicitySaveDc, `${item.name}: не-мутант`);
    if (!check?.success) {
      await spendOne(item);
      await applyStatus(actor, "poisoned");
      return card(actor, item.name, ["Организм не выдержал ведьмачьего эликсира: персонаж отравлен, эффект не действует."],
        { subtitle: ALCHEMY_KINDS[s.kind], flags: { fx: { kind: "drink", color: "green" } } });
    }
  }

  // «Белый мёд»: токсичность в ноль, все эликсиры отменены
  if (u.clearToxicity) {
    const ids = alchemyEffects(actor).map(e => e.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { vedmakToxicityChecked: true });
    await actor.update({ "system.toxicity.value": 0 }, { vedmakToxicityChecked: true });
    if (actor.statuses.has("poisoned")) await actor.toggleStatusEffect("poisoned", { active: false });
    lines.push(`Отменено эликсиров и отваров: ${ids.length}.`);
  }

  // Справочник автоматики по названию (config/alchemy-auto.mjs)
  const auto = alchemyAuto(item.name) ?? {};

  for (const st of new Set([...(u.removeStatuses ?? []), ...(auto.immune ?? [])])) {
    if (actor.statuses.has(st)) {
      await actor.toggleStatusEffect(st, { active: false });
      lines.push(`Снято: ${CONFIG.statusEffects.find(e => e.id === st)?.name ?? st}.`);
    }
  }

  // Мгновенное: Выносливость, лечение крита
  if (auto.restore?.sta) {
    const r = await new Roll(auto.restore.sta).evaluate();
    rolls.push(r);
    const sta = Math.min(actor.system.sta.max, actor.system.sta.value + r.total);
    await actor.update({ "system.sta.value": sta });
    lines.push(`+${r.total} Вын (${sta} из ${actor.system.sta.max}).`);
  }
  if (auto.healCrit) lines.push(...await healCritDialog(actor));

  // Изменения эффекта: из предмета и из справочника; ПБ и вес считаются в момент приёма
  const changes = [...foundry.utils.deepClone(s.changes), ...(auto.changes ?? [])];
  const fx = (key, value) => changes.push({ key, type: "add", value, phase: "initial" });
  if (auto.spPerFreeEnc) {
    const d = actor.system.derived;
    const free = Math.max(0, (d.enc ?? 0) - (d.carried ?? 0));
    const sp = Math.floor(free / 10) * auto.spPerFreeEnc;
    if (sp) fx("system.fx.sp", sp);
    lines.push(`Свободно ${free} ед. веса: +${sp} ПБ всех частей тела.`);
  }
  if (auto.doubleEnc) {
    fx("system.fx.enc", actor.system.derived.enc ?? 0);
    lines.push(`Переносимый вес: ${(actor.system.derived.enc ?? 0) * 2}.`);
  }
  let rounds = s.durationRounds;
  if (!rounds && !s.durationMinutes && auto.rounds) {
    rounds = Number.isFinite(Number(auto.rounds)) ? Number(auto.rounds) : (await new Roll(String(auto.rounds)).evaluate()).total;
    lines.push(`Действует ${rounds} раундов.`);
  }
  // Срок только текстом («2d6 раундов», «30 минут», «24 часа», «мгновенно»): без него эффект и токсичность
  // висели бы вечно. Мгновенный состав держит токсичность один раунд — ради проверки порога (стр. 247)
  let textMinutes = 0;
  if (!rounds && !s.durationMinutes && !auto.rounds && !auto.minutes) {
    const parsed = await durationFromText(s.duration);
    if (parsed.rounds) { rounds = parsed.rounds; if (parsed.rolled) lines.push(`Действует ${rounds} раундов.`); }
    textMinutes = parsed.minutes;
  }
  const minutes = s.durationMinutes || auto.minutes || textMinutes || 0;
  const regen = u.regen || auto.regen || 0;
  const triggers = Object.fromEntries(["immune", "onKill", "onHit", "onDamaged", "untilHit", "doubleAdrenaline"]
    .filter(k => auto[k]).map(k => [k, foundry.utils.deepClone(auto[k])]));

  // Эффект с длительностью
  const hasEffect = rounds || minutes || s.toxicity || changes.length || regen || u.heal
    || auto.regen !== undefined || auto.vision || Object.keys(triggers).length;
  if (hasEffect) {
    // Одинаковые эликсиры не суммируются — старый заменяется
    const same = alchemyEffects(actor).filter(e => e.flags.vedmak.alchemy.itemName === item.name).map(e => e.id);
    // Порог проверяется ниже, когда новый эффект уже на месте
    if (same.length) await actor.deleteEmbeddedDocuments("ActiveEffect", same, { vedmakToxicityChecked: true });
    const effect = {
      name: item.name, img: item.img,
      system: { changes },
      flags: { vedmak: { alchemy: { toxicity: s.toxicity, kind: s.kind, itemName: item.name, at: Date.now() }, ...triggers } }
    };
    // `expiry: null`: схема v14 для числового срока ставит «turnStart», и эффект участника боя по времени не снимается
    if (minutes) effect.duration = { value: minutes, units: "minutes", expiry: null };
    if (rounds || regen || auto.regen !== undefined) {
      // Вне боя раунды не отсчитываются — срок ставится временем мира; регенерация идёт, если начнётся бой
      const combat = inCombat(actor);
      if (rounds && !combat && !minutes) effect.duration = roundsAsTime(rounds);
      effect.flags.vedmak.timed = { rounds: combat ? rounds || 0 : 0, key: "alchemy" };
      effect.flags.vedmak.regen = regen;
    }
    const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [effect]);
    if (s.duration) lines.push(`Длительность: ${s.duration}.`);
    if (auto.vision && created) {
      const n = await applyVision(actor, created, auto.vision);
      if (n) lines.push(`Зрение токена: ${auto.vision.visionMode === "darkvision" ? "в темноте" : auto.vision.visionMode}, ${auto.vision.range} м.`);
    }
  }
  // Сверх максимума ПЗ эликсир даёт и сами ПЗ («Анаболические стероиды»): максимум уже поднят эффектом
  if (auto.hpNow) {
    const hp = actor.system.hp;
    const value = Math.min(hp.max, hp.value + auto.hpNow);
    if (value > hp.value) {
      await actor.update({ "system.hp.value": value });
      lines.push(`+${value - hp.value} ПЗ (${value} из ${hp.max}).`);
    }
  }
  if (auto.note) lines.push(auto.note);
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
      await applyToxicPoison(actor);
      lines.push("Порог превышен — персонаж отравлен, пока токсичность не спадёт или он не пройдёт Стойкость СЛ 18 (это отменит последний эликсир).");
      buttons.push({ action: "toxicitySave", label: "Стойкость СЛ 18" });
    } else if (await clearToxicPoison(actor)) {
      lines.push("Токсичность в пределах порога — отравление от неё прошло.");
    }
  }
  return card(actor, item.name, lines, { subtitle: ALCHEMY_KINDS[s.kind], buttons, rolls,
    flags: { fx: { kind: "drink", color: s.kind === "elixir" ? "violet" : s.kind === "decoction" ? "red" : "green" } } });
}

registerChatAction("toxicitySave", async message => {
  const actor = resolveActor(message.flags.vedmak?.alchemy?.actorUuid);
  if (!actor?.isOwner) return ui.notifications.warn("Бросок делает владелец персонажа или ведущий.");
  const check = await enduranceCheck(actor, CRAFTING.toxicitySaveDc, "Токсичность");
  if (!check?.success) return;
  const last = alchemyEffects(actor).at(-1);
  if (last) await last.delete({ vedmakToxicityChecked: true });
  // Снимается отравление от токсичности; яд оружия и прочее — само по себе
  await dropToxicPoison(actor);
  return card(actor, "Токсичность", [`Отравление прошло${last ? `; эффект «${last.name}» отменён` : ""}.`]);
});

/* ------------------------- Отравление токсичностью ------------------------- */

/** Эффект «Отравлен», наложенный токсичностью (флаг `toxicPoison`). */
const toxicPoisonEffect = actor => actor.effects.find(e => e.flags?.vedmak?.toxicPoison);

/**
 * Очередь на актора: проверки токсичности идут из хуков и из начала хода одновременно, и без неё две из них
 * удаляли один и тот же эффект («does not exist»), а снятие по порогу обгоняло снятие истёкших зелий.
 * Внутри очереди нельзя вызывать другие функции с очередью — они ждали бы сами себя.
 */
const queues = new Map();
function exclusive(actor, task) {
  const key = actor.uuid;
  const run = (queues.get(key) ?? Promise.resolve()).then(task);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}

/**
 * Отравить токсичностью — отдельным эффектом «Отравление (токсичность)», независимым от яда оружия и прочих
 * отравлений: статус `poisoned` у актора один, а их эффектов может быть несколько. Такой эффект без срока,
 * снимает его только порог (clearToxicPoison) или проверка Стойкости; `toggleStatusEffect` вернул бы чужой
 * эффект того же статуса, и флаг токсичности смешался бы со сроком яда.
 */
function applyToxicPoison(actor) {
  return exclusive(actor, async () => {
    if (toxicPoisonEffect(actor)) return;
    const base = (await CONFIG.ActiveEffect.documentClass.fromStatusEffect("poisoned", { parent: actor })).toObject();
    delete base._id;
    base.name = "Отравление (токсичность)";
    base.statuses = ["poisoned"];
    foundry.utils.setProperty(base, "flags.vedmak.toxicPoison", true);
    await actor.createEmbeddedDocuments("ActiveEffect", [base]);
  });
}

/** Снять отравление от токсичности без проверки порога (Стойкость пройдена). */
async function dropToxicPoisonNow(actor) {
  const effect = toxicPoisonEffect(actor);
  if (!effect || !actor.effects.has(effect.id)) return false;
  await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
  return true;
}
const dropToxicPoison = actor => exclusive(actor, () => dropToxicPoisonNow(actor));

/** Токсичность сейчас: по самим эффектам, а не по подготовленным данным — они могут ещё не пересчитаться. */
function toxicityNow(actor) {
  let total = actor.system.toxicity.value ?? 0;
  for (const e of actor.effects) {
    const tox = e.flags?.vedmak?.alchemy?.toxicity;
    if (tox && e.active) total += tox;
  }
  return { total, max: actor.system.toxicity.max };
}

/**
 * Отравление от токсичности длится, пока она выше порога (стр. 247): как только спала — снимаем.
 * @returns {Promise<boolean>} снято ли
 */
async function clearToxicPoisonNow(actor) {
  if (actor?.type !== "character" || !toxicPoisonEffect(actor)) return false;
  const t = toxicityNow(actor);
  if (t.total > t.max) return false;
  return dropToxicPoisonNow(actor);
}
export const clearToxicPoison = actor => actor?.type === "character"
  ? exclusive(actor, () => clearToxicPoisonNow(actor)) : Promise.resolve(false);

// Эликсир или отвар снят (истёк, отменён, удалён руками) или ручная токсичность уменьшена — проверить порог.
// Проверяет тот, кто внёс изменение; начало хода (expireAlchemy) проверяет само и пишет об этом в чат.
Hooks.on("deleteActiveEffect", (effect, options, userId) => {
  if (!effect.flags?.vedmak?.alchemy || options.vedmakToxicityChecked || userId !== game.user.id) return;
  if (effect.parent?.documentName !== "Actor") return;
  clearToxicPoison(effect.parent).catch(err => console.warn("vedmak | отравление токсичностью", err));
});
Hooks.on("updateActor", (actor, changes, options, userId) => {
  if (changes.system?.toxicity?.value === undefined || options.vedmakToxicityChecked || userId !== game.user.id) return;
  clearToxicPoison(actor).catch(err => console.warn("vedmak | отравление токсичностью", err));
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
  return card(actor, item.name, lines, { subtitle: ALCHEMY_KINDS[s.kind], flags: { fx: { kind: "apply" } } });
}

/* ------------------------------ Бросок склянки ------------------------------ */

/** Цели в зоне: выбранные токены; если выбрана одна цель и есть радиус — все токены в радиусе от неё. */
function areaTargets(radius) {
  const targets = [...game.user.targets];
  if (targets.length !== 1 || !radius || !canvas?.ready) return targets.map(t => t.actor).filter(Boolean);
  const center = targets[0];
  return canvas.tokens.placeables.filter(t => t.actor && tokenDistance(center, t) <= radius).map(t => t.actor);
}

/**
 * Зона склянки или ловушки на сцене: круг или конус ставится мышью.
 * @returns {Promise<{victims: Actor[]}|null|false>} false — отменили, null — зоны недоступны
 */
async function zoneVictims(actor, name, u, effect, color = ZONE_COLORS.bomb) {
  const area = parseArea(u.area, { plainIsRadius: true });
  if (!area || !zonesAvailable()) return null;
  const placed = await placeZone(area, { name, color });
  if (placed?.cancelled) return false;
  if (!placed) return null;
  const shape = placed.shape;
  // Облака без урона (двимерит, «Лунная пыль», «Сон дракона») висят столько раундов, сколько сказано в описании
  const lingering = !(u.damage || u.status);
  const duration = lingering ? (await parseZoneDuration(effect.match(/\d+\s*(?:раунд|ход)\S*/)?.[0] ?? "")) : { instant: true };
  const region = await createZone(shape, { name, color, actor, itemName: name, duration });
  return { victims: zoneTokens(shape, { region }).map(t => t.actor), shape };
}

export async function throwItem(actor, item) {
  const s = item.system;
  const u = s.use;
  const body = actor.system.stats.body.total;
  const rangeText = u.range || (s.kind === "bomb" ? "Тел×4 м" : "Тел×2 м");
  const mult = Number(rangeText.match(/Тел\s*[×x]\s*(\d+)/)?.[1] ?? 0);
  const meters = mult ? body * mult : Number(rangeText.match(/\d+/)?.[0] ?? 0);
  // Сначала — куда бросаем (зона на сцене), потом бросок: отмена зоны ничего не тратит
  const zone = await zoneVictims(actor, item.name, u, s.effect ?? "");
  if (zone === false) return null;
  const attack = await actor.rollSkill("athletics", { subtitle: `Бросок: ${item.name} (дистанция ${meters} м)` });
  if (!attack) return null;
  await spendOne(item);
  const radius = Number(String(u.area).match(/\d+/)?.[0] ?? 0);
  const victims = zone?.victims ?? areaTargets(radius);
  const lines = [s.effect, `Зона: ${u.area || "—"}. Промах — склянка падает в случайном направлении (таблица разброса, стр. 152).`];
  const buttons = [];
  if ((u.damage || u.status) && victims.length) {
    await manualDamage(victims, {
      formula: u.damage, reason: item.name, damageType: u.damageType, where: "all",
      status: u.status, statusChance: u.statusChance, statusRounds: u.statusRounds
    });
  } else if (u.damage || u.status) {
    lines.push("Цели не выбраны: выберите пострадавших (или одну цель — центр зоны) и нажмите кнопку ниже.");
    buttons.push({ action: "trapTrigger", label: "Урон по выбранным целям" });
  }
  return card(actor, item.name, lines, { subtitle: ALCHEMY_KINDS[s.kind], buttons,
    flags: { trap: { name: item.name, use: foundry.utils.deepClone(u), effect: s.effect },
      fx: { kind: "bomb", zone: zone?.shape ? { x: zone.shape.x, y: zone.shape.y, radius: zone.shape.radius } : null,
        element: u.damageType === "elemental" ? "fire" : "" } } });
}

/* -------------------------------- Ловушка -------------------------------- */

export async function setTrap(actor, item) {
  const s = item.system;
  await spendOne(item);
  return card(actor, `Ловушка ${item.name}`, [s.effect, `Зона: ${s.use.area}. Заметить растяжку — Внимание против результата Знания ловушек установившего.`],
    { subtitle: "Установлена", buttons: [{ action: "trapTrigger", label: "Сработала (выбранные цели)" }],
      flags: { trap: { name: item.name, use: s.use.toObject?.() ?? foundry.utils.deepClone(s.use), effect: s.effect } } });
}

registerChatAction("trapTrigger", async message => {
  const trap = message.flags.vedmak?.alchemy?.trap;
  if (!trap) return;
  const radius = Number(String(trap.use.area).match(/\d+/)?.[0] ?? 0);
  const owner = resolveActor(message.flags.vedmak?.alchemy?.actorUuid) ?? game.user.character;
  const zone = await zoneVictims(owner, trap.name, trap.use, trap.effect ?? "", ZONE_COLORS.trap);
  if (zone === false) return;
  const victims = zone?.victims ?? areaTargets(radius);
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
    window: { title: item.name },
    classes: ["vedmak", "vedmak-dialog"],
    content: `<div class="vedmak-roll-dialog"><p>${item.system.effect}</p><div class="form-group"><label>Оружие</label><select name="weapon">${options}</select></div>
      <p class="hint">Нанесение занимает действие. Новое масло заменяет старое.</p></div>`,
    buttons: [{ action: "ok", label: "Нанести", default: true, callback: (e, b) => b.form.elements.weapon.value },
      { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  if (!id || id === "cancel") return null;
  const weapon = actor.items.get(id);
  const until = (game.time.worldTime ?? 0) + CRAFTING.oilMinutes * 60;
  await weapon.update({ "system.oil": { name: item.name, target: item.system.oilTarget, until } });
  await spendOne(item);
  return card(actor, item.name, [`Нанесено на «${weapon.name}»: +${CRAFTING.oilBonus} урона против: ${(MONSTER_CLASSES[item.system.oilTarget] ?? item.system.oilTarget).toLowerCase()} на ${CRAFTING.oilMinutes} минут.`],
    { subtitle: ALCHEMY_KINDS.oil, flags: { fx: { kind: "oil" } } });
}

/* --------------------------------- Мутаген --------------------------------- */

export async function applyMutagen(actor, item) {
  const s = item.system;
  if (s.applied) return ui.notifications.info(`«${item.name}» уже принят.`);
  const applied = actor.items.filter(i => i.type === "alchemical" && i.system.isMutagen && i.system.applied).length;
  if (applied >= CRAFTING.mutagenLimit) return ui.notifications.warn(`Уже принято ${applied} мутагена — больше нельзя (стр. 251).`);
  const ok = await DialogV2.confirm({
    window: { title: item.name },
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
      { subtitle: ALCHEMY_KINDS.mutagen, buttons: [{ action: "mutagenSave", label: "Стойкость СЛ 18" }] });
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
  return card(actor, item.name, [s.effect, `Малая мутация: ${s.mutagen.minor}.`],
    { subtitle: "Мутаген принят", flags: { fx: { kind: "drink", color: s.mutagen.color || "red" } } });
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
export function expireAlchemy(actor) {
  return exclusive(actor, async () => {
    const lines = [];
    // v14 помечает `duration.expired` уже после хуков системы (Combat#_onStartTurn идёт раньше обновления реестра),
    // поэтому срок проверяем так же, как у магии, — по остатку на сейчас, иначе зелье жило бы лишний ход
    const expired = actor.effects.filter(e => (e.flags?.vedmak?.alchemy || e.flags?.vedmak?.spellBuff) && timeIsUp(e));
    if (expired.length) {
      lines.push(...expired.map(e => `${e.name}: действие закончилось.`));
      // ПЗ после баффа с бонусом урезаются здесь же и с ожиданием (иначе гонка с уроном за ход)
      await deleteEffectsClamped(actor, expired.map(e => e.id), { vedmakToxicityChecked: true });
    }
    // Токсичность спала до порога — отравление от неё проходит само (стр. 247). Ещё раз — в конце
    // magicStartOfTurn, после снятия зелий на раунды
    if (await clearToxicPoisonNow(actor)) lines.push("Токсичность ниже порога — отравление прошло.");
    const now = game.time.worldTime ?? 0;
    for (const w of actor.itemTypes?.weapon ?? []) {
      if (w.system.oil.target && w.system.oil.until <= now) {
        lines.push(`${w.name}: масло «${w.system.oil.name}» выдохлось.`);
        await w.update({ "system.oil": { name: "", target: "", until: 0 } });
      }
    }
    return lines;
  });
}
