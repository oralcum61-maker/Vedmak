// Бой: начало хода участника — эффекты урона за ход, конец ошеломления, испытания (стр. 161–162).

import { LOCATIONS_HUMANOID, LOCATIONS_MONSTER } from "../config/combat.mjs";
import { postCard, defaultMessageMode, proxyMessageMode } from "./common.mjs";
import { renderTemplate } from "../util.mjs";
import { wearArmor } from "./damage.mjs";
import { magicStartOfTurn } from "../magic/effects.mjs";
import { trueFormStartOfTurn } from "../character/true-form.mjs";
import { bearFormStartOfTurn } from "../character/bear-form.mjs";
import { expireAlchemy } from "../crafting/alchemy.mjs";
import { expireZonesForTurn } from "./zones.mjs";
import { repeatZonesForTurn } from "../magic/cast.mjs";
import { dimeritiumTurn } from "../magic/dimeritium.mjs";

export class VedmakCombat extends Combat {

  /**
   * Бросок инициативы — карточкой системы (медальон с итогом, кость и основа), а не сообщением броска ядра;
   * в остальном как у ядра: формула участника, скрытый участник — только ведущему, один звук на весь бросок.
   * Групповая инициатива (настройка мира): НИП одного вида без игрока-владельца бросают один раз на группу —
   * остальные берут тот же итог, а если кто-то из группы уже бросал, новые берут его число. Вид — источник
   * в компендиуме, иначе имя актора: чудовище из бестиария, перетащенное дважды, — это два актора, но одна группа.
   */
  async rollInitiative(ids, { formula = null, updateTurn = true, messageMode, messageOptions = {} } = {}) {
    ids = typeof ids === "string" ? [ids] : Array.from(ids ?? []);
    const grouped = game.settings.get("vedmak", "groupInitiative");
    const groupOf = c => {
      if (!grouped) return null;
      if (!c?.actor || c.hasPlayerOwner) return null;
      const base = game.actors.get(c.actorId) ?? c.actor;
      return base._stats?.compendiumSource || `name:${base.name}`;
    };
    const leaders = new Map();
    const followers = [];
    const rollIds = [];
    for (const id of ids) {
      const c = this.combatants.get(id);
      const key = groupOf(c);
      if (!key) { rollIds.push(id); continue; }
      const rolled = this.combatants.find(o => !ids.includes(o.id) && groupOf(o) === key && o.initiative !== null);
      if (rolled) followers.push([id, rolled.id]);
      else if (leaders.has(key)) followers.push([id, leaders.get(key)]);
      else { leaders.set(key, id); rollIds.push(id); }
    }
    const updates = [];
    const messages = [];
    for (const id of rollIds) {
      const combatant = this.combatants.get(id);
      if (!combatant?.isOwner) continue;
      const roll = combatant.getInitiativeRoll(formula);
      await roll.evaluate();
      updates.push({ _id: id, initiative: roll.total });
      const group = followers.filter(([, src]) => src === id).length;
      messages.push(await initiativeMessage(combatant, roll, { group, messageOptions, sound: !messages.length }));
      // Скрытый участник — только ведущему, как у ядра
      messages.at(-1).mode = messageMode ?? (combatant.hidden ? "gm" : defaultMessageMode());
    }
    for (const [id, src] of followers) {
      const value = updates.find(u => u._id === src)?.initiative ?? this.combatants.get(src)?.initiative ?? null;
      if (value !== null && this.combatants.get(id)?.isOwner) updates.push({ _id: id, initiative: value });
    }
    if (!updates.length) return this;
    const updateOptions = { turnEvents: false };
    if (!updateTurn) updateOptions.combatTurn = this.turn;
    await this.updateEmbeddedDocuments("Combatant", updates, updateOptions);
    for (const { data, mode } of messages) await ChatMessage.implementation.create(data, { messageMode: mode });
    return this;
  }

  /** Кто не бросил инициативу к началу боя, бросает её сейчас: иначе он стоит в конце очереди без числа. */
  async startCombat() {
    const missing = this.combatants.filter(c => c.initiative === null && !c.isDefeated).map(c => c.id);
    if (missing.length) await this.rollInitiative(missing, { updateTurn: false });
    return super.startCombat();
  }

  /** Выполняется только у одного ведущего. */
  async _onStartTurn(combatant, context) {
    await super._onStartTurn(combatant, context);
    const actor = combatant.actor;
    if (!actor || combatant.defeated || actor.statuses.has("dead")) return;
    // Один старт хода на раунд: v14 зовёт его снова при смене порядка инициативы и при проходе вперёд после
    // отката хода — кровотечение и горение иначе списались бы дважды. Пропущенные ходы (context.skipped) идут как обычные
    if (combatant.getFlag("vedmak", "turnStarted") === context.round) return;
    await combatant.setFlag("vedmak", "turnStarted", context.round);

    try {
      await startOfTurn(actor, this, { ...context, combatant });
    } catch (err) {
      console.error("vedmak | ошибка начала хода", err);
    }
  }
}

/**
 * Сообщение броска инициативы: карточка системы с броском (Dice So Nice покажет кость).
 * group — сколько ещё участников группы взяли этот итог (групповая инициатива).
 * @returns {Promise<{data: object, mode?: string}>}
 */
async function initiativeMessage(combatant, roll, { group = 0, messageOptions = {}, sound = true } = {}) {
  const dice = roll.dice.flatMap(d => d.results.filter(r => r.active !== false).map(r => r.result));
  const die = dice.reduce((s, v) => s + v, 0);
  const content = await renderTemplate("systems/vedmak/templates/chat/initiative.hbs", {
    name: combatant.name, total: roll.total, dice, die, base: roll.total - die, group: group ? group + 1 : 0
  });
  const data = foundry.utils.mergeObject({
    speaker: ChatMessage.implementation.getSpeaker({ actor: combatant.actor, token: combatant.token, alias: combatant.name }),
    content, rolls: [roll],
    flags: { core: { initiativeRoll: true }, vedmak: { initiative: { combatant: combatant.id, total: roll.total } } }
  }, messageOptions);
  if (!sound) data.sound = null;
  return { data };
}

/** Множитель урона эффекта с учётом сопротивления брони/чудовища, невосприимчивости и восприимчивости. */
function effectMult(actor, key, { armorResist = false } = {}) {
  const sys = actor.system;
  if (sys.immunities?.includes?.(key)) return 0;
  let mult = 1;
  if (sys.resistances?.includes?.(key) || armorResist) mult *= 0.5;
  if (sys.susceptibilities?.includes?.(key)) mult *= 2;
  return mult;
}

/** Есть ли у надетой брони сопротивление (кровотечению, отравлению). Разбитая броня (ПБ 0 везде) не защищает. */
function armorResists(actor, key) {
  return (actor.itemTypes.armor ?? []).some(i => i.system.equipped && !i.system.isShield
    && i.system.allResistances.includes(key) && Object.values(i.system.sp).some(s => s.value > 0));
}

export async function startOfTurn(actor, combat, context) {
  const sys = actor.system;
  const d = sys.derived;
  const lines = [];
  const buttons = [];
  const has = id => actor.statuses.has(id);

  // Эффекты «до начала следующего хода»
  if (has("staggered")) { await actor.toggleStatusEffect("staggered", { active: false }); lines.push("Ошеломление прошло."); }
  if (has("activeDodge")) { await actor.toggleStatusEffect("activeDodge", { active: false }); }

  // Эликсиры и масла, истёкшие по времени; магия: поддержание, регенерация, щиты, статусы с длительностью
  // Каждая подсистема — отдельно: ошибка одной не должна отменять урон за ход и карточку хода
  const step = async (name, fn) => {
    try { lines.push(...(await fn() ?? [])); } catch (err) { console.error(`vedmak | начало хода: ${name}`, err); }
  };
  await step("алхимия", () => expireAlchemy(actor));
  await step("Истинная форма", () => trueFormStartOfTurn(actor));
  await step("медвежья форма", () => bearFormStartOfTurn(actor));
  await step("магия", () => magicStartOfTurn(actor));
  await step("зоны", () => expireZonesForTurn(actor, combat));
  await step("повтор зон", () => repeatZonesForTurn(actor, combat));

  // Урон за ход
  let loss = 0;
  const armorWear = [];
  if (has("burning")) {
    const mult = effectMult(actor, "fire");
    const table = d.bodyType === "monster" ? LOCATIONS_MONSTER : LOCATIONS_HUMANOID;
    let burn = 0;
    for (const [key, cfg] of Object.entries(table)) {
      const loc = d.armor?.[key];
      const through = Math.max(0, 5 - (loc?.sp ?? 0));
      const locMult = key === "head" ? Math.max(cfg.mult, d.headMult ?? 3) : cfg.mult;
      burn += Math.floor(through * mult * locMult);
      if (loc?.outer) armorWear.push(loc);
    }
    loss += burn;
    lines.push(`Горение: ${burn} урона (5 по каждой части тела через броню; броня −1 ПБ).`);
  }
  if (has("bleeding")) {
    const n = Math.floor((2 + (d.crit?.bleedExtra ?? 0)) * effectMult(actor, "bleeding", { armorResist: armorResists(actor, "bleeding") }));
    loss += n;
    lines.push(n ? `Кровотечение: ${n} урона.` : "Кровотечение: невосприимчив — урона нет.");
  }
  if (has("poisoned")) {
    const n = Math.floor(3 * effectMult(actor, "poison", { armorResist: armorResists(actor, "poison") }));
    loss += n;
    lines.push(n ? `Отравление: ${n} урона мимо брони.` : "Отравление: невосприимчив — урона нет.");
  }
  if (has("suffocating")) { loss += 3; lines.push("Удушье: 3 урона."); }
  if (d.crit?.acid) { loss += d.crit.acid; lines.push(`Рана в живот: ${d.crit.acid} урона кислотой.`); }
  // Касание двимерита: последствия строки таблицы (стр. 167)
  try {
    const dim = await dimeritiumTurn(actor, context.round);
    loss += dim.loss;
    lines.push(...dim.lines);
    if (dim.stun) buttons.push({ action: "stunSave", label: "Испытание Уст", reason: "Двимерит" });
  } catch (err) { console.error("vedmak | начало хода: двимерит", err); }

  // Горение портит броню каждой части тела
  if (armorWear.length) lines.push(...await wearArmor(actor, armorWear.map(loc => ({ location: loc.key, amount: 1 }))));

  const hpBefore = actor.system.hp.value;
  const wasDying = hpBefore < 0;
  if (loss) {
    const hp = hpBefore - loss;
    await actor.update({ "system.hp.value": hp });
    lines.push(`ПЗ: ${hpBefore} → ${hp}.`);
  }

  // Периодические испытания Уст от ранений
  for (const wound of actor.itemTypes.critWound ?? []) {
    const every = wound.system.mods.stunEvery;
    if (!every) continue;
    let due = false;
    if (every === "1d6") {
      const next = wound.system.nextStunRound;
      if (!next || context.round >= next) {
        due = !!next;
        const r = await new Roll("1d6").evaluate();
        await wound.update({ "system.nextStunRound": context.round + r.total });
      }
    } else if (context.round > 0 && context.round % every === 0) {
      due = true;
    }
    if (due) {
      lines.push(`${wound.name}: испытание Устойчивости.`);
      buttons.push({ action: "stunSave", label: "Испытание Уст", reason: wound.name });
    }
  }

  // При смерти — испытание каждый раунд
  if (actor.system.hp.value < 0 && !actor.statuses.has("dead")) {
    lines.push(wasDying ? "При смерти: испытание против смерти." : "Персонаж при смерти: испытание против смерти.");
    buttons.push({ action: "deathSave", label: "Испытание против смерти" });
  }

  // Зелье берсерка: каждый ход Стойкость, провал — атакует ближайшего
  const berserk = actor.effects.find(e => e.active && e.flags?.vedmak?.berserk);
  if (berserk) {
    const dc = berserk.flags.vedmak.berserk.dc ?? 16;
    lines.push(`${berserk.name}: Стойкость СЛ ${dc}, при провале в этот ход атакует ближайшего.`);
    buttons.push({ action: "berserkSave", label: `Стойкость СЛ ${dc}`, reason: berserk.name });
  }

  // Хлороформ: без сознания, пока не пройдёт испытание Уст
  const asleep = actor.effects.find(e => e.active && e.flags?.vedmak?.wakeSave);
  if (asleep) {
    lines.push(`${asleep.name}: без сознания — испытание Уст, чтобы очнуться.`);
    buttons.push({ action: "wakeSave", label: "Испытание Уст: очнуться", reason: asleep.name });
  }

  // Напоминания о тяжёлых состояниях
  if (has("disoriented")) lines.push("Дезориентирован: полный ход на испытание Уст, чтобы прийти в себя.");
  if (has("frozen")) lines.push("Заморожен: Сила СЛ 16 действием, чтобы сломать лёд.");
  if (has("nauseated") && context.round % 3 === 0) lines.push(`Тошнота: d10 должен быть меньше Тел (${sys.stats.body.total}).`);

  if (!lines.length) return;
  // Токен того, чей ход начался: v14 зовёт _onStartTurn и для пропущенных ходов, а combat.combatant тогда уже другой
  const tokenUuid = context.combatant?.token?.uuid ?? actor.token?.uuid ?? null;
  await postCard({
    template: "systems/vedmak/templates/chat/turn.hbs",
    data: { name: actor.name, img: actor.img, round: context.round, lines, buttons, tokenUuid, actorUuid: actor.uuid },
    actor, flags: { turn: { actorUuid: actor.uuid, round: context.round } },
    // Карточку создаёт клиент ведущего: у актора игрока она не должна стать «Ведущему» из-за режима его чата
    messageMode: proxyMessageMode(actor, defaultMessageMode())
  });
}
