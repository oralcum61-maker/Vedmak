// Бой: начало хода участника — эффекты урона за ход, конец ошеломления, испытания (стр. 161–162).

import { LOCATIONS_HUMANOID, LOCATIONS_MONSTER } from "../config/combat.mjs";
import { postCard, defaultMessageMode, proxyMessageMode } from "./common.mjs";
import { wearArmor } from "./damage.mjs";
import { magicStartOfTurn } from "../magic/effects.mjs";
import { trueFormStartOfTurn } from "../character/true-form.mjs";
import { expireAlchemy } from "../crafting/alchemy.mjs";
import { expireZonesForTurn } from "./zones.mjs";
import { repeatZonesForTurn } from "../magic/cast.mjs";

export class VedmakCombat extends Combat {

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
  lines.push(...await expireAlchemy(actor));
  lines.push(...await trueFormStartOfTurn(actor));
  lines.push(...await magicStartOfTurn(actor));
  lines.push(...await expireZonesForTurn(actor, combat));
  lines.push(...await repeatZonesForTurn(actor, combat));

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
    lines.push(`Кровотечение: ${n} урона.`);
  }
  if (has("poisoned")) {
    const n = Math.floor(3 * effectMult(actor, "poison", { armorResist: armorResists(actor, "poison") }));
    loss += n;
    lines.push(`Отравление: ${n} урона мимо брони.`);
  }
  if (has("suffocating")) { loss += 3; lines.push("Удушье: 3 урона."); }
  if (d.crit?.acid) { loss += d.crit.acid; lines.push(`Рана в живот: ${d.crit.acid} урона кислотой.`); }

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
