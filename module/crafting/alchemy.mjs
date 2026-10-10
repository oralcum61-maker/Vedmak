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
import { postCard, resolveActor, tokenDistance, asGM, registerGMHandler, userOwnsAny, actorToken } from "../combat/common.mjs";
import { parseArea, parseZoneDuration, zonesAvailable, placeZone, createZone, zoneTokens, ZONE_COLORS, pointInZone, removeZones } from "../combat/zones.mjs";
import { zoneAuraFor } from "../config/magic.mjs";
import { registerChatAction } from "../combat/chat.mjs";
import { manualDamage } from "../combat/manual.mjs";
import { applyStatus } from "../combat/damage.mjs";
import { alchemyAuto, anyoneCanDrink, rollCount } from "../config/alchemy-auto.mjs";
import { rollStunSave } from "../combat/saves.mjs";
import { applyVision, healCritDialog } from "./alchemy-triggers.mjs";
import { inCombat, roundsAsTime, spendOne } from "../util.mjs";
import { timeIsUp } from "../magic/timed.mjs";
import { deleteEffectsClamped } from "../magic/buffs.mjs";
import { equippedProstheses, prostheticStats, wearProsthesis, wearLine } from "../combat/prosthetics.mjs";

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
const statusLabel = id => CONFIG.statusEffects[id]?.name ?? id;
/** «3 раунда», «5 раундов». */
const roundsText = n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "раунд" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "раунда" : "раундов"}`;
/** Срок словами: раунды, часы или минуты. */
const spanText = (rounds, minutes) => rounds ? roundsText(rounds)
  : minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} ч` : `${minutes} мин`;

/** Флаги-срабатывания эффекта алхимии, которые читают бой и испытания (alchemy-triggers.mjs, saves.mjs, damage.mjs). */
const TRIGGER_KEYS = ["immune", "onKill", "onHit", "onDamaged", "untilHit", "doubleAdrenaline", "berserk", "noStunSave",
  "autoDeathSave", "burnVuln", "blackBlood", "wakeSave"];

/**
 * Эффект состава на актора: одинаковые не суммируются (старый заменяется). Раунды — отсчётом в бою, вне боя —
 * временем мира; минуты — временем мира.
 * @returns {Promise<ActiveEffect|null>}
 */
async function alchemyEffect(actor, item, { changes = [], rounds = 0, minutes = 0, regen = 0, keepRegen = false,
  triggers = {}, statuses = [], toxicity = 0 } = {}) {
  const same = alchemyEffects(actor).filter(e => e.flags.vedmak.alchemy.itemName === item.name).map(e => e.id);
  // Порог токсичности проверяет вызывающий, когда новый эффект уже на месте
  if (same.length) await actor.deleteEmbeddedDocuments("ActiveEffect", same, { vedmakToxicityChecked: true });
  const effect = {
    name: item.name, img: item.img,
    system: { changes },
    flags: { vedmak: { alchemy: { toxicity, kind: item.system.kind, itemName: item.name, at: Date.now() }, ...triggers } }
  };
  if (statuses.length) effect.statuses = statuses;
  // `expiry: null`: схема v14 для числового срока ставит «turnStart», и эффект участника боя по времени не снимается
  if (minutes) effect.duration = { value: minutes, units: "minutes", expiry: null };
  if (rounds || regen || keepRegen) {
    // Вне боя раунды не отсчитываются — срок ставится временем мира; регенерация идёт, если начнётся бой
    const combat = inCombat(actor);
    if (rounds && !combat && !minutes) effect.duration = roundsAsTime(rounds);
    effect.flags.vedmak.timed = { rounds: combat ? rounds || 0 : 0, key: "alchemy" };
    effect.flags.vedmak.regen = regen;
  }
  const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [effect]);
  return created ?? null;
}

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
    const check = await enduranceCheck(actor, s.poisonDc || CRAFTING.toxicitySaveDc, `${item.name}: не-мутант`);
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
      lines.push(`Снято: ${statusLabel(st)}.`);
    }
  }

  // Проверка Стойкости при приёме (ароматное зелье, фисштех): провал — состояния эффекта
  let failStatuses = [];
  let failMinutes = 0;
  if (auto.save) {
    const check = await enduranceCheck(actor, auto.save.dc, `${item.name}: Стойкость`);
    if (check && !check.success) {
      failStatuses = auto.save.statuses ?? [];
      failMinutes = auto.save.minutes ?? 0;
      lines.push(`Стойкость не пройдена: ${failStatuses.map(statusLabel).join(", ")}${failMinutes ? ` на ${failMinutes} минут` : ""}.`);
    } else if (check) lines.push("Стойкость пройдена — состав не подействовал.");
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
    rounds = await rollCount(auto.rounds);
    if (!Number.isFinite(Number(auto.rounds))) lines.push(`Действует ${roundsText(rounds)}.`);
  }
  // Минуты и часы справочника — числом или формулой («1d6*30», «1d10» часов)
  let autoMinutes = 0;
  if (!rounds && !s.durationMinutes && (auto.minutes || auto.hours)) {
    autoMinutes = await rollCount(auto.minutes) + 60 * await rollCount(auto.hours);
    if (!Number.isFinite(Number(auto.minutes ?? 0)) || (auto.hours && !Number.isFinite(Number(auto.hours)))) {
      lines.push(`Действует ${spanText(0, autoMinutes)}.`);
    }
  }
  // Срок только текстом («2d6 раундов», «30 минут», «24 часа», «мгновенно»): без него эффект и токсичность
  // висели бы вечно. Мгновенный состав держит токсичность один раунд — ради проверки порога (стр. 247)
  let textMinutes = 0;
  if (!rounds && !s.durationMinutes && !auto.rounds && !autoMinutes) {
    const parsed = await durationFromText(s.duration);
    if (parsed.rounds) { rounds = parsed.rounds; if (parsed.rolled) lines.push(`Действует ${roundsText(rounds)}.`); }
    textMinutes = parsed.minutes;
  }
  // Провал проверки с собственным сроком (фисштех — дезориентация на полчаса) задаёт срок эффекта
  const minutes = failMinutes || s.durationMinutes || autoMinutes || textMinutes || 0;
  if (failMinutes) rounds = 0;
  const regen = u.regen || auto.regen || 0;
  const triggers = Object.fromEntries(TRIGGER_KEYS.filter(k => auto[k]).map(k => [k, foundry.utils.deepClone(auto[k])]));
  // Адреналиновый эликсир: при смерти — испытания против смерти удаются сами, иначе нет штрафов порога ранения
  if (auto.adrenaline) {
    if (actor.system.hp.value < 0) {
      triggers.autoDeathSave = true;
      lines.push(`${roundsText(rounds)}: испытания против смерти удаются сами (штраф всё равно растёт); СЛ стабилизации −5.`);
    } else {
      fx("system.fx.ignoreWound", 1);
      lines.push(`${roundsText(rounds)}: нет штрафов порога ранения.`);
    }
  }
  const statuses = [...new Set([...(auto.statuses ?? []), ...failStatuses])];
  // Проверка пройдена и больше ничего нет — эффекта нет (фисштех без последствий)
  const onlySave = auto.save && !failStatuses.length && !changes.length && !s.toxicity;
  // Зелье берсерка: Стойкость сразу после приёма; дальше — в начале каждого хода (combat.mjs)
  if (auto.berserk) {
    const check = await enduranceCheck(actor, auto.berserk.dc, `${item.name}: исступление`);
    lines.push(check?.success ? "Стойкость пройдена: исступление пока сдержано."
      : `Исступление: в свой ход атакует ближайшего. В начале каждого хода — Стойкость СЛ ${auto.berserk.dc}.`);
  }

  // Эффект с длительностью
  const hasEffect = !onlySave && (rounds || minutes || s.toxicity || changes.length || regen || u.heal
    || auto.regen !== undefined || auto.vision || Object.keys(triggers).length || statuses.length);
  if (hasEffect) {
    const created = await alchemyEffect(actor, item, { changes, rounds, minutes, regen, keepRegen: auto.regen !== undefined,
      triggers, statuses, toxicity: s.toxicity });
    const overridden = auto.rounds || auto.minutes || auto.hours || failMinutes;
    if (s.duration && !overridden) lines.push(`Длительность: ${s.duration}.`);
    if (statuses.length && created) lines.push(`Состояние: ${statuses.map(statusLabel).join(", ")}.`);
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
  if (auto.staNow) {
    const sta = actor.system.sta;
    const value = Math.min(sta.max, sta.value + auto.staNow);
    if (value > sta.value) {
      await actor.update({ "system.sta.value": value });
      lines.push(`+${value - sta.value} Вын (${value} из ${sta.max}).`);
    }
  }
  // Зависимость (фисштех — стр. 32)
  if (auto.addiction) {
    const check = await enduranceCheck(actor, auto.addiction, `${item.name}: зависимость`);
    if (check) lines.push(check.success ? `Стойкость СЛ ${auto.addiction} против зависимости пройдена.`
      : `Стойкость СЛ ${auto.addiction} не пройдена — зависимость (стр. 32).`);
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
  const auto = alchemyAuto(item.name) ?? {};
  // Яд на клинок (чёрный, трупный): окно выбора оружия; «в питьё или еду» — как раньше, на цель
  if (auto.coat) {
    const chosen = await coatWeapon(actor, item, auto.coat);
    if (chosen !== "target") return chosen;
  }
  const chosenTarget = [...game.user.targets][0]?.actor ?? null;
  if (auto.needTarget && (!chosenTarget || chosenTarget === actor)) {
    return ui.notifications.warn(`«${item.name}»: выберите цель — на себя не применяется.`);
  }
  const target = chosenTarget ?? actor;
  const lines = [`${target === actor ? actor.name : `${actor.name} → ${target.name}`}: ${s.effect}`];
  if (target.isOwner) lines.push(...await preparationOnTarget(target, s.use, item));
  else {
    // Чужая цель (порошок на раненого товарища): состояние меняет ведущий — по предмету отправителя, а не по запросу
    if (!game.users.activeGM) return ui.notifications.warn("Нужен ведущий в игре: состав на чужую цель накладывает он.");
    // Заряд тратит тоже ведущий — после применения: иначе последний заряд исчез бы раньше, чем он прочтёт предмет
    await asGM("alchemyPreparation", { actorUuid: actor.uuid, itemId: item.id, targetUuid: target.token?.uuid ?? target.uuid });
    lines.push("Действие на цель применяет ведущий.");
  }
  if (target.isOwner) await spendOne(item);
  return card(actor, item.name, lines, { subtitle: ALCHEMY_KINDS[s.kind], flags: { fx: { kind: "apply" } } });
}

/** Снять и наложить состояния состава на цель, эффекты справочника. @returns {string[]} строки карточки */
async function preparationOnTarget(target, use, item) {
  const lines = [];
  const auto = alchemyAuto(item?.name) ?? {};
  for (const st of use.removeStatuses ?? []) {
    if (target.statuses.has(st)) {
      await target.toggleStatusEffect(st, { active: false });
      lines.push(`Снято: ${CONFIG.statusEffects[st]?.name ?? st}.`);
    }
  }
  if (use.status) {
    await applyStatus(target, use.status, use.statusRounds);
    lines.push(`Эффект: ${CONFIG.statusEffects[use.status]?.name ?? use.status}.`);
  }
  for (const st of [auto.targetStatus ?? []].flat()) {
    await applyStatus(target, st);
    lines.push(`Эффект: ${statusLabel(st)}.`);
  }
  // Щелочной порошок: кислота «Раны в живот» больше не жжёт
  if (auto.neutralizeAcid) {
    const burning = (target.itemTypes.critWound ?? []).filter(w => w.system.mods?.acid && !w.flags?.vedmak?.acidNeutralized);
    if (burning.length) await target.updateEmbeddedDocuments("Item", burning.map(w => ({ _id: w.id, "flags.vedmak.acidNeutralized": true })));
    lines.push(burning.length ? `Кислота нейтрализована: ${burning.map(w => w.name).join(", ")} больше не жжёт.` : "Кислотной раны нет — порошок только на одну порцию кислоты.");
  }
  // Обеззараживающая жидкость: метка на персонаже до заживления ран — её читает «Дни отдыха» (combat/manual.mjs)
  if (auto.disinfect && item) {
    const had = target.effects.some(e => e.flags?.vedmak?.disinfected);
    if (!had) {
      await target.createEmbeddedDocuments("ActiveEffect", [{ name: item.name, img: item.img,
        description: "Раны обработаны: +2 ПЗ в день отдыха с уходом, заживление каждого критического ранения на 2 дня короче.",
        flags: { vedmak: { disinfected: true } } }]);
    }
    lines.push(had ? "Раны уже обработаны — повторное применение не суммируется."
      : "Раны обработаны: +2 ПЗ в день отдыха с уходом, заживление критических ранений на 2 дня короче.");
  }
  // Хлороформ: испытание Уст с поправкой; провал — без сознания, пока не пройдёт испытание (кнопка в начале хода)
  if (auto.stunSave) {
    const msg = await rollStunSave(target, { mod: auto.stunSave.mod ?? 0, reason: item.name, applyStatus: false,
      outcomes: { ok: "Не подействовало", fail: statusLabel(auto.stunSave.status) } });
    const ok = msg?.flags?.vedmak?.save?.success;
    if (ok === false) {
      await alchemyEffect(target, item, { statuses: [auto.stunSave.status], triggers: { wakeSave: { mod: 0 } } });
      lines.push(`Испытание Уст провалено: ${statusLabel(auto.stunSave.status)}, пока не пройдёт испытание.`);
    } else if (ok) lines.push("Испытание Уст пройдено — не подействовало.");
  }
  // Эффект на время (пепельная мазь, быстрый огонь, обезболивающие травы)
  const triggers = Object.fromEntries(TRIGGER_KEYS.filter(k => auto[k]).map(k => [k, foundry.utils.deepClone(auto[k])]));
  delete triggers.wakeSave;
  if (item && (auto.changes?.length || Object.keys(triggers).length) && !auto.stunSave) {
    const rounds = await rollCount(auto.rounds);
    const minutes = rounds ? 0 : await rollCount(auto.minutes) + 60 * await rollCount(auto.hours);
    for (const st of auto.immune ?? []) {
      if (target.statuses.has(st)) { await target.toggleStatusEffect(st, { active: false }); lines.push(`Снято: ${statusLabel(st)}.`); }
    }
    const created = await alchemyEffect(target, item, { changes: foundry.utils.deepClone(auto.changes ?? []), rounds, minutes, triggers });
    if (created && (rounds || minutes)) lines.push(`Действует ${spanText(rounds, minutes)}.`);
  }
  if (auto.note) lines.push(auto.note);
  return lines;
}

/* ------------------------------ Яд на клинок ------------------------------ */

/**
 * Нанести яд на клинок (чёрный яд — 1d10 раундов, трупный — до первого урона). Яд живёт во флаге оружия
 * vedmak.coat; урон оружием с подходящим типом накладывает его состояния (combat/damage.mjs).
 * @returns {Promise<"target"|ChatMessage|null>} "target" — состав пошёл не на клинок, а на цель (в питьё)
 */
async function coatWeapon(actor, item, coat) {
  const weapons = actor.itemTypes.weapon.filter(w => (!w.system.isRanged || w.system.isThrown)
    && (!coat.types?.length || w.system.damageTypes.some(t => coat.types.includes(t))));
  const canTarget = !!item.system.use.status;
  if (!weapons.length && !canTarget) {
    return ui.notifications.warn(`Нет оружия, на которое можно нанести «${item.name}»${coat.types?.length ? " (нужно режущее или колющее)" : ""}.`);
  }
  const options = weapons.map(w => `<option value="${w.id}" ${w.system.equipped ? "selected" : ""}>${w.name}${w.flags?.vedmak?.coat ? ` (сейчас: ${w.flags.vedmak.coat.name})` : ""}</option>`);
  if (canTarget) options.push(`<option value="target">На цель: в питьё или еду</option>`);
  const id = await DialogV2.wait({
    window: { title: item.name },
    classes: ["vedmak", "vedmak-dialog"],
    content: `<div class="vedmak-roll-dialog"><p>${item.system.effect}</p><div class="form-group"><label>Куда</label><select name="weapon">${options.join("")}</select></div>
      <p class="hint">Смазать клинок — полный раунд. ${coat.once ? "Яд держится до первого нанесённого урона." : `Яд держится ${coat.rounds} раундов.`}</p></div>`,
    buttons: [{ action: "ok", label: "Нанести", default: true, callback: (e, b) => b.form.elements.weapon.value },
      { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  if (!id || id === "cancel") return null;
  if (id === "target") return "target";
  const weapon = actor.items.get(id);
  const rounds = coat.rounds ? await rollCount(coat.rounds) : 0;
  const until = rounds ? (game.time.worldTime ?? 0) + rounds * (CONFIG.time.roundTime || 3) : 0;
  await weapon.setFlag("vedmak", "coat", { name: item.name, statuses: coat.statuses, types: coat.types ?? [], once: !!coat.once, until });
  await spendOne(item);
  return card(actor, item.name, [`Нанесено на «${weapon.name}»: ${coat.statuses.map(statusLabel).join(" и ")} при уроне${coat.types?.length ? " режущим или колющим" : ""}${rounds ? ` — ${roundsText(rounds)}` : " — до первого урона"}.`],
    { subtitle: ALCHEMY_KINDS[item.system.kind], flags: { fx: { kind: "oil" } } });
}

// Ведущий: состав игрока на чужую цель. Отправитель должен владеть персонажем с этим составом; что снять и что
// наложить — из самого предмета
registerGMHandler("alchemyPreparation", async ({ actorUuid, itemId, targetUuid }, userId) => {
  const actor = resolveActor(actorUuid);
  const item = actor?.items.get(itemId);
  const target = resolveActor(targetUuid);
  if (!item || !target || item.system.use?.action !== "apply" || !userOwnsAny(userId, actor)) {
    return console.warn(`vedmak | отклонён состав на цель от ${game.users.get(userId)?.name ?? userId}`);
  }
  await preparationOnTarget(target, item.system.use, item);
  await spendOne(item);
});

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
async function zoneVictims(actor, name, u, effect, color = ZONE_COLORS.bomb, { excludeSelf = false } = {}) {
  const area = parseArea(u.area, { plainIsRadius: true });
  if (!area || !zonesAvailable()) return null;
  const placed = await placeZone(area, { name, color });
  if (placed?.cancelled) return false;
  if (!placed) return null;
  const shape = placed.shape;
  // Облака без урона (двимерит, «Лунная пыль», «Сон дракона») висят столько раундов, сколько сказано в описании
  const lingering = !(u.damage || u.status);
  const duration = lingering ? (await parseZoneDuration(effect.match(/\d+\s*(?:раунд|ход)\S*/)?.[0] ?? "")) : { instant: true };
  // Облако с аурой («Лунная пыль» проявляет невидимое) — ставит и снимает ведущий (magic/zone-effects.mjs)
  const auraDef = zoneAuraFor(name);
  const extra = { ...(auraDef ? { aura: { ...auraDef, value: 0, img: "" } } : {}), ...(alchemyAuto(name)?.zone ?? {}) };
  const region = await createZone(shape, { name, color, actor, itemName: name, duration, extra });
  // Конус из своей руки (ручная пушка) стрелка не задевает
  const exclude = excludeSelf ? actorToken(actor) : null;
  return { victims: zoneTokens(shape, { region, exclude }).map(t => t.actor), shape, region };
}

/**
 * Ручная пушка («Лавка Клауса и Нострадамуса»): бомба, собранная в протезе (час работы), подрывается полным ходом
 * конусом длиной в радиус бомбы; попадание — Атлетика. Взрыв отнимает у протеза 10 Надёжности, а без Надёжности
 * протез отлетает на 1d6 м (снимается).
 */
export async function handCannon(actor, mod) {
  const bombs = actor.itemTypes.alchemical.filter(i => i.system.kind === "bomb" && (i.system.quantity ?? 0) > 0);
  if (!bombs.length) return ui.notifications.warn("Нет бомбы: ручная пушка заряжается бомбой из снаряжения (собрать её в руке — час).");
  let bomb = bombs[0];
  if (bombs.length > 1) {
    const id = await DialogV2.wait({
      window: { title: mod.name }, classes: ["vedmak", "vedmak-dialog"],
      content: `<div class="vedmak-roll-dialog"><p>${mod.system.effect ?? ""}</p><div class="form-group"><label>Бомба</label>
        <select name="bomb">${bombs.map(b => `<option value="${b.id}">${b.name} (${b.system.use.area || "—"})</option>`).join("")}</select></div></div>`,
      buttons: [{ action: "ok", label: "Подорвать", default: true, callback: (e, b) => b.form.elements.bomb.value },
        { action: "cancel", label: "Отмена" }],
      rejectClose: false
    });
    if (!id || id === "cancel") return null;
    bomb = actor.items.get(id);
  }
  const u = bomb.system.use;
  const radius = Number(String(u.area).match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(",", ".") ?? 0) || 2;
  const name = `${mod.name}: ${bomb.name}`;
  const zone = await zoneVictims(actor, name, { ...u, area: `конус ${radius} м` }, bomb.system.effect ?? "", ZONE_COLORS.bomb, { excludeSelf: true });
  if (zone === false) return null;
  const attack = await actor.rollSkill("athletics", { subtitle: `${name} (конус ${radius} м)` });
  // Передумали бросать — поставленный конус не нужен
  if (!attack) { if (zone?.region) await removeZones([zone.region]); return null; }
  await spendOne(bomb);
  const victims = zone?.victims ?? [...game.user.targets].map(t => t.actor).filter(Boolean);
  const lines = [bomb.system.effect, `Конус ${radius} м (радиус бомбы). Попадание — Атлетика.`];
  const buttons = [];
  if ((u.damage || u.status) && victims.length) {
    await manualDamage(victims, { formula: u.damage, reason: name, damageType: u.damageType, where: "all",
      status: u.status, statusChance: u.statusChance, statusRounds: u.statusRounds });
  } else if (u.damage || u.status) lines.push("Цели не выбраны: урон — «Урон без атаки» по тем, кто в конусе.");
  // Протез: тот, на котором стоит пушка, иначе первый надетый
  const pros = actor.items.get(mod.flags?.vedmak?.prosthesis) ?? equippedProstheses(actor)[0] ?? null;
  if (pros) {
    if (prostheticStats(actor, pros).reliability) lines.push(wearLine(pros, await wearProsthesis(actor, pros, 10)));
    else {
      const meters = (await new Roll("1d6").evaluate()).total;
      if (pros.system.equipped) await pros.update({ "system.equipped": false });
      lines.push(`${pros.name}: Надёжности нет — протез отлетает на ${meters} м в случайную сторону (снят).`);
    }
  }
  return card(actor, mod.name, lines, { subtitle: "Ручная пушка", buttons, flags: { fx: { kind: "throw" } } });
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
  // Передумали бросать — поставленная зона не нужна
  if (!attack) { if (zone?.region) await removeZones([zone.region]); return null; }
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
  const auto = alchemyAuto(item.name) ?? {};
  if (auto.ignite) {
    lines.push(`Огонь в облаке — взрыв: ${auto.ignite.formula} по всем в нём, горение ${auto.ignite.chance}%.`);
    buttons.push({ action: "gasIgnite", label: "Газ вспыхнул" });
  }
  if (auto.zone?.noMagic && zone?.region) lines.push("В облаке нельзя творить магию.");
  return card(actor, item.name, lines, { subtitle: ALCHEMY_KINDS[s.kind], buttons,
    flags: { zoneId: zone?.region?.id ?? null, sceneId: zone?.region?.parent?.id ?? null, ignite: auto.ignite ?? null,
      trap: { name: item.name, use: foundry.utils.deepClone(u), effect: s.effect },
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
  const auto = alchemyAuto(trap.name) ?? {};
  if (auto.trapSave || auto.mark) return trapOnVictims(owner, trap, victims, auto, message);
  return manualDamage(victims, {
    formula: trap.use.damage, reason: trap.name, damageType: trap.use.damageType, where: "all",
    status: trap.use.status, statusChance: trap.use.statusChance, statusRounds: trap.use.statusRounds
  });
});

/** Ловушки без урона: «Бешенство» — Стойкость, провал — исступление; «Метка» — эффект на сутки. */
async function trapOnVictims(owner, trap, victims, auto, message = null) {
  const lines = [];
  const rolls = [];
  const pseudo = { name: trap.name, img: "icons/magic/control/fear-fright-monster-grin-red-orange.webp", system: { kind: "trap" } };
  // Чужие цели (чудовища ведущего) проверяет ведущий — по карточке этой ловушки
  const foreign = victims.filter(v => !v.isOwner);
  if (foreign.length && message) {
    await asGM("trapVictims", { messageId: message.id, uuids: foreign.map(v => v.token?.uuid ?? v.uuid) });
    lines.push(`Остальных (${foreign.map(v => v.name).join(", ")}) проверяет ведущий.`);
  }
  for (const v of victims) {
    if (!v.isOwner) continue;
    if (auto.trapSave) {
      const check = await enduranceCheck(v, auto.trapSave.dc, `${trap.name}: Стойкость`);
      if (!check) continue;
      if (check.success) { lines.push(`${v.name}: Стойкость ${check.total} — держится.`); continue; }
      await alchemyEffect(v, pseudo, { triggers: { berserk: { dc: auto.trapSave.dc, endOnSave: true } } });
      lines.push(`${v.name}: Стойкость ${check.total} — бросается на ближайшего, пока не пройдёт Стойкость СЛ ${auto.trapSave.dc} (кнопка в начале хода).`);
    }
    if (auto.mark) {
      await alchemyEffect(v, { ...pseudo, img: "icons/magic/symbols/runes-star-orange.webp" }, { minutes: auto.mark.minutes });
      lines.push(`${v.name}: помечен на сутки.`);
    }
  }
  if (auto.note) lines.push(auto.note);
  return card(owner ?? victims[0], `Ловушка ${trap.name}`, [trap.effect, ...lines], { subtitle: "Сработала", rolls });
}

// Ведущий: ловушка игрока сработала на чужих целях. Один раз на карточку, только по карточке ловушки этого игрока
registerGMHandler("trapVictims", async ({ messageId, uuids }, userId) => {
  const message = game.messages.get(messageId);
  const f = message?.flags?.vedmak?.alchemy;
  const auto = alchemyAuto(f?.trap?.name);
  if (!f?.trap || !(auto?.trapSave || auto?.mark) || message.author?.id !== userId || f.trapDone || !Array.isArray(uuids)) {
    return console.warn(`vedmak | отклонена ловушка от ${game.users.get(userId)?.name ?? userId}`);
  }
  await message.update({ "flags.vedmak.alchemy.trapDone": true });
  const victims = uuids.slice(0, 50).map(u => resolveActor(u)).filter(Boolean);
  if (victims.length) await trapOnVictims(null, f.trap, victims, auto);
});

/** «Сон дракона»: газ вспыхнул — урон и горение всем в облаке, облако исчезает. */
registerChatAction("gasIgnite", async message => {
  const f = message.flags.vedmak?.alchemy ?? {};
  const scene = game.scenes.get(f.sceneId) ?? canvas.scene;
  const region = scene?.regions?.get(f.zoneId);
  const victims = region && scene === canvas.scene
    ? canvas.tokens.placeables.filter(t => t.actor && pointInZone(region, t.center)).map(t => t.actor)
    : [...game.user.targets].map(t => t.actor).filter(Boolean);
  if (!victims.length) return ui.notifications.warn("В облаке никого нет: выберите пострадавших целями.");
  const ignite = f.ignite ?? { formula: "5d6", status: "burning", chance: 75 };
  await manualDamage(victims, { formula: ignite.formula, reason: `${f.trap?.name ?? "Газ"}: взрыв`, damageType: "elemental",
    where: "all", status: ignite.status, statusChance: ignite.chance });
  if (region) await removeZones([region]);
});

/** Хлороформ: испытание Уст в начале хода; успех — приходит в себя. */
registerChatAction("wakeSave", async (message, button) => {
  const actor = resolveActor(button?.dataset.actor) ?? resolveActor(button?.dataset.fallback);
  if (!actor?.isOwner) return ui.notifications.warn("Бросок делает владелец персонажа или ведущий.");
  const effect = actor.effects.find(e => e.active && e.flags?.vedmak?.wakeSave);
  const msg = await rollStunSave(actor, { mod: effect?.flags.vedmak.wakeSave.mod ?? 0, reason: effect?.name ?? "Очнуться", applyStatus: false,
    outcomes: { ok: "Очнулся", fail: "Без сознания" } });
  if (msg?.flags?.vedmak?.save?.success && effect) {
    await effect.delete();
    ui.notifications.info(`${actor.name} приходит в себя.`);
  }
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
  // Вживлённые руны и глифы гнёзд мутагенов не занимают
  const applied = actor.items.filter(i => i.type === "alchemical" && i.system.isMutagen && i.system.applied && !i.flags?.vedmak?.implant).length;
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

/** Кнопка «Стойкость» в карточке хода под зельем берсерка. */
registerChatAction("berserkSave", async (message, button) => {
  const actor = resolveActor(button?.dataset.actor) ?? resolveActor(button?.dataset.fallback);
  if (!actor?.isOwner) return ui.notifications.warn("Бросок делает владелец персонажа или ведущий.");
  const effect = actor.effects.find(e => e.active && e.flags?.vedmak?.berserk);
  const dc = effect?.flags.vedmak.berserk.dc ?? 16;
  const check = await enduranceCheck(actor, dc, `${effect?.name ?? "Зелье берсерка"}: исступление`);
  if (check && !check.success) ui.notifications.info(`${actor.name} в исступлении: в этот ход атакует ближайшего.`);
  // «Бешенство» ловушки длится, пока не пройдена проверка
  else if (check?.success && effect?.flags.vedmak.berserk.endOnSave) {
    await effect.delete();
    ui.notifications.info(`${actor.name} приходит в себя.`);
  }
});

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
    const dry = (actor.itemTypes?.weapon ?? []).filter(w => w.system.oil.target && w.system.oil.until <= now);
    for (const w of dry) lines.push(`${w.name}: масло «${w.system.oil.name}» выдохлось.`);
    if (dry.length) await actor.updateEmbeddedDocuments("Item", dry.map(w => ({ _id: w.id, "system.oil": { name: "", target: "", until: 0 } })));
    return lines;
  });
}
