// Урон: часть тела → урон оружия (×сильная атака, +серебро) → укрытие → ПБ → сопротивление ×½ →
// восприимчивость ×2 → множитель части тела → + урон крита мимо брони (стр. 154–162).

import {
  LOCATIONS_HUMANOID, LOCATIONS_MONSTER, CRIT_LEVELS, CRIT_WOUNDS, COVER, EFFECT_STATUS, STATUS_RESIST_KEY,
  critWoundFor, aimedCritWound, locationGlyph
} from "../config/combat.mjs";
import { bindDialog, commonFields } from "../dice/dialog-ui.mjs";
import { renderTemplate } from "../util.mjs";
import {
  resolveActor, asGM, registerGMHandler, userOwnsAny, rollFormula, postCard, defaultMessageMode, markDone, allowRepeat
} from "./common.mjs";
import { alchemyAfterDamage, adrenalinePerCrit, immuneStatuses } from "../crafting/alchemy-triggers.mjs";
import { markDead } from "./saves.mjs";
import { implantStatusBonus, implantBurnVulnerability } from "../config/crafting.mjs";
import { wallCover } from "./cover.mjs";

const LEGS = ["rightLeg", "leftLeg"];

/** Какой ключ невосприимчивости/сопротивления отвечает эффекту оружия. */
const EFFECT_RESIST_KEY = { bleeding: "bleeding", poison: "poison", burning: "fire", freeze: "frost", staggering: null };

/** Урон из карточки защиты. */
export async function damageFromDefense(message, { skipDialog = false, messageMode } = {}) {
  const def = message.flags.vedmak?.defense;
  if (!def?.canDamage) return null;
  const attacker = resolveActor(def.attack.attacker.tokenUuid) ?? resolveActor(def.attack.attacker.actorUuid);
  if (!attacker?.isOwner) return ui.notifications.warn("Бросить урон может атакующий или ведущий.");
  const target = resolveActor(def.defender.tokenUuid) ?? resolveActor(def.defender.actorUuid);
  if (!target) return ui.notifications.warn("Цель атаки не найдена.");
  // Один бросок урона на карточку защиты: повторный — только ведущим и с подтверждением
  const prior = game.messages.some(m => m.flags.vedmak?.damage?.defenseMessageId === message.id);
  if (prior && !(await allowRepeat(`Урон по «${def.defender.name}» от этой атаки уже брошен.`))) return null;

  const attack = def.attack;
  let cfg = {
    damageType: attack.weapon?.damageTypes?.[0] ?? "bludgeoning",
    location: def.fixedLocation || attack.aim || "",
    cover: "none", mod: 0, adrenaline: 0, messageMode: messageMode ?? defaultMessageMode()
  };
  // Стена сцены между атакующим и целью — укрытие цели (в окне урона его можно поменять). И в ближнем бою:
  // удар через ограду, окно или пролом пробивает укрытие так же, как выстрел (стр. 155)
  {
    const wc = wallCover(attack.attacker.tokenUuid, def.defender.tokenUuid);
    if (wc) { cfg.cover = wc.key; cfg.coverAuto = true; }
  }
  if (!skipDialog) {
    cfg = await damageDialog(attack, target, cfg, attacker);
    if (!cfg) return null;
  }
  // Адреналин (опционально, стр. 175): +1d6 урона за кость, −10 Вын за кость
  const adrenaline = Math.max(0, Math.min(cfg.adrenaline ?? 0, attacker.system.adrenaline?.value ?? 0));
  if (adrenaline) {
    await attacker.update({
      "system.adrenaline.value": attacker.system.adrenaline.value - adrenaline,
      "system.sta.value": Math.max(0, attacker.system.sta.value - 10 * adrenaline)
    });
  }
  const result = await computeDamage({ attack, target, critLevel: def.critLevel, aimed: !!attack.aim && !def.fixedLocation, ...cfg, adrenaline, margin: Math.max(0, def.margin ?? 0) });
  if (result.coatSpent) {
    const weapon = attacker.items.get(attack.weapon?.id);
    if (weapon?.flags?.vedmak?.coat) await weapon.unsetFlag("vedmak", "coat");
    result.notes.push("Яд с клинка израсходован.");
  }
  // Удар двимеритовым протезом: цели — касание двимерита (кнопка в карточке после применения)
  if (attack.weapon?.dimeritium) result.dimeritium = true;
  const data = {
    kind: "damage",
    defenseMessageId: message.id,
    attacker: attack.attacker,
    target: def.defender,
    attackLabel: attack.label, img: attack.img,
    ...result,
    applied: false
  };
  const card = await postCard({
    template: "systems/vedmak/templates/chat/damage.hbs", data, actor: attacker,
    flags: { damage: data }, rolls: result.rolls, messageMode: cfg.messageMode
  });
  await markDone(message, card);
  return card;
}

/**
 * Формула урона для окна и подписи: правка из окна атаки и разбег идут после множителя сильной атаки —
 * «двойной урон» удваивает урон оружия (стр. 153), а разбег прибавляется к урону (стр. 171).
 */
export function damageText(attack) {
  const mult = attack.damageMult ?? 1;
  let text = `${attack.damageFormula || "—"}${mult === 0.5 ? " ×½" : mult !== 1 ? ` ×${mult}` : ""}`;
  if (attack.chargeFormula) text += ` + разбег ${attack.chargeFormula}`;
  if (attack.damageMod) text += ` ${attack.damageMod > 0 ? "+" : "−"} ${Math.abs(attack.damageMod)}`;
  return text;
}

async function damageDialog(attack, target, cfg, attacker) {
  const table = target.system.derived.bodyType === "monster" ? LOCATIONS_MONSTER : LOCATIONS_HUMANOID;
  const types = (attack.weapon?.damageTypes ?? ["bludgeoning"])
    .map(k => ({ key: k, label: CONFIG.VEDMAK.DAMAGE_TYPES[k]?.label ?? k, selected: k === cfg.damageType }));
  const formula = damageText(attack);
  const content = await renderTemplate("systems/vedmak/templates/dialog/damage.hbs", {
    attack, target, cfg,
    head: {
      title: target.name, img: attack.img, noBase: true,
      subtitle: `${attack.label} · ${attack.typeLabel} · урон ${formula}${attack.nonLethal ? " (несмертельный)" : ""}`
    },
    damageTypes: types, manyTypes: types.length > 1, singleType: types[0]?.key ?? "bludgeoning",
    locations: [{ key: "", label: "Броском", note: "d10", selected: !cfg.location, glyph: locationGlyph("") }].concat(
      Object.entries(table).map(([key, l]) => ({ key, label: l.label, note: l.mult === 0.5 ? "×½" : `×${l.mult}`, selected: key === cfg.location,
        glyph: locationGlyph(key, l) }))
    ),
    covers: Object.entries(COVER).map(([key, c]) => ({ key, label: c.label, sp: c.sp, selected: key === cfg.cover })),
    coverNote: cfg.coverAuto ? `${COVER[cfg.cover]?.label ?? ""} · стена между атакующим и целью` : COVER[cfg.cover]?.label ?? "",
    adrenalineMax: game.settings.get("vedmak", "adrenaline") ? (attacker.system.adrenaline?.value ?? 0) : 0,
    total: { noRoll: true, damage: formula, hint: "Броня и укрытие вычитаются после броска" },
    ...commonFields()
  });
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `Урон: ${target.name}` },
    classes: ["vedmak", "vedmak-dialog", "check-dialog", "damage-dialog"],
    position: { width: 520 },
    content,
    render: (event, dialog) => bindDialog(dialog, {
      extra: form => {
        const note = dialog.element.querySelector("[data-cover-note]");
        const cover = form.elements.cover?.value;
        if (note) note.textContent = `· ${COVER[cover]?.label ?? ""}${cfg.coverAuto && cover === cfg.cover ? " · стена между атакующим и целью" : ""}`;
        const out = dialog.element.querySelector("[data-total-damage]");
        if (!out) return;
        const add = Number(form.elements.mod?.value) || 0;
        const dice = Number(form.elements.adrenaline?.value) || 0;
        out.textContent = `${formula}${dice ? ` + ${dice}d6` : ""}${add ? ` ${add > 0 ? "+" : "−"} ${Math.abs(add)}` : ""}`;
      }
    }),
    buttons: [{
      action: "roll", label: "Бросить урон", default: true,
      callback: (event, button) => {
        const f = button.form.elements;
        return {
          damageType: f.damageType.value, location: f.location.value, cover: f.cover.value,
          mod: Number(f.mod.value) || 0, adrenaline: Number(f.adrenaline?.value) || 0,
          messageMode: f.messageMode?.value || "public"
        };
      }
    }, { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  return result === "cancel" ? null : result;
}

/** Бросить часть тела по таблице цели (духи без ног перебрасывают попадания в ноги). */
async function rollLocation(target) {
  const table = target.system.derived.bodyType === "monster" ? LOCATIONS_MONSTER : LOCATIONS_HUMANOID;
  const noLegs = target.system.lacksLegs;
  for (let i = 0; i < 20; i++) {
    const roll = await new Roll("1d10").evaluate();
    const key = Object.entries(table).find(([, l]) => roll.total >= l.roll[0] && roll.total <= l.roll[1])?.[0];
    if (noLegs && LEGS.includes(key)) continue;
    return { key, roll };
  }
  return { key: "torso", roll: null };
}

/**
 * Посчитать урон по цели. Ничего не меняет в документах.
 * @returns {Promise<object>} данные для карточки и применения
 */
export async function computeDamage({ attack, target, critLevel = null, aimed = false, damageType, location, cover = "none", mod = 0, adrenaline = 0, margin = 0 }) {
  const spell = attack.spell ?? null;
  const tsys = target.system;
  const d = tsys.derived;
  const table = d.bodyType === "monster" ? LOCATIONS_MONSTER : LOCATIONS_HUMANOID;
  const w = attack.weapon ?? { effects: [] };
  const has = key => (w.effects ?? []).some(e => e.key === key);
  const effChance = key => {
    const e = (w.effects ?? []).find(x => x.key === key);
    if (!e) return 0;
    const n = parseInt(String(e.value).replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) ? n : 100;
  };
  const rolls = [];
  const parts = [];
  const notes = [];
  // Бонусы атакующего от алхимии: место крита (отвар катакана), шанс стихийных эффектов («Буря»)
  const attackerActor = resolveActor(attack.attacker?.tokenUuid) ?? resolveActor(attack.attacker?.actorUuid);
  const critLocBonus = attackerActor?.system.fx?.critLocation ?? 0;
  const elementalBonus = attackerActor?.system.fx?.statusChance ?? 0;
  const ELEMENTAL = ["burning", "frozen", "prone"];
  // Вживлённые руны «Офира и Зеррикании» (стр. 86): +5/10/15 % к шансу эффекта атак оружием, даже если у оружия его нет
  const runeBonus = !spell && attackerActor ? implantStatusBonus(attackerActor.items) : {};
  // Цель с мутацией глифа Игни горит легче
  const burnVuln = implantBurnVulnerability(target);

  // Часть тела
  let locRoll = null;
  if (!location || !table[location]) {
    const r = await rollLocation(target);
    location = r.key;
    locRoll = r.roll?.total ?? null;
    if (r.roll) rolls.push(r.roll);
  }
  const locCfg = table[location];

  // Урон оружия
  const main = await rollFormula(attack.damageFormula, { margin, sta: spell?.cost ?? 0 });
  if (main.roll) rolls.push(main.roll);
  let dmg = main.total;
  parts.push({ label: `Урон ${attack.damageFormula}`, value: main.total });
  if (attack.damageMult && attack.damageMult !== 1) {
    const before = dmg;
    dmg = Math.floor(dmg * attack.damageMult);
    parts.push({ label: attack.damageMult > 1 ? `×${attack.damageMult} (${attack.typeLabel})` : `×½ (${attack.typeLabel})`, value: dmg - before });
  }
  // После множителя: разбег прибавляется к урону (стр. 171), правка из окна атаки — как написано в окне
  if (attack.chargeFormula) {
    const c = await rollFormula(attack.chargeFormula);
    if (c.roll) rolls.push(c.roll);
    dmg += c.total;
    parts.push({ label: `Разбег ${attack.chargeFormula}`, value: c.total });
  }
  if (attack.damageMod) { dmg += attack.damageMod; parts.push({ label: "Правка урона (окно атаки)", value: attack.damageMod }); }

  // Серебро и метеоритная сталь (стр. 162, 175)
  // Магия — не оружие: несеребряное сопротивление чудовищ к ней не относится (стр. 162)
  const weakness = target.type === "monster" && !spell ? tsys.weakness : null;
  const silver = !!w.silverDamage?.trim?.();
  const meteorite = has("meteorite");
  if (weakness === "silver" && silver) {
    const s = await rollFormula(w.silverDamage);
    if (s.roll) rolls.push(s.roll);
    dmg += s.total;
    parts.push({ label: `Серебро ${w.silverDamage}`, value: s.total });
  }
  if (adrenaline) {
    const a = await rollFormula(`${adrenaline}d6`);
    if (a.roll) rolls.push(a.roll);
    dmg += a.total;
    parts.push({ label: `Адреналин ${adrenaline}d6`, value: a.total });
  }
  if (mod) { dmg += mod; parts.push({ label: "Модификатор", value: mod }); }
  // Масло для меча: +5 урона по своему классу чудовищ; «гуманоиды» — персонажи и чудовища-гуманоиды (стр. 248)
  if (w.oil && !spell) {
    const cls = target.type === "monster" ? tsys.monsterClass : "humanoid";
    if (w.oil.target === cls) {
      dmg += 5;
      parts.push({ label: w.oil.name || "Масло", value: 5 });
    }
  }
  const rawDamage = dmg;

  // Укрытие
  const coverSp = COVER[cover]?.sp ?? 0;
  if (coverSp) {
    dmg = Math.max(0, dmg - coverSp);
    notes.push(`Укрытие «${COVER[cover].label}» поглотило ${Math.min(rawDamage, coverSp)}.`);
  }

  // Броня
  const armor = d.armor?.[location] ?? { sp: 0, resist: [] };
  let sp = spell?.ignoreArmor ? 0 : armor.sp;
  const improvedAP = has("improvedAP");
  const ap = improvedAP || has("armorPiercing");
  if (improvedAP && sp) sp = Math.floor(sp / 2);
  const afterArmor = Math.max(0, dmg - sp);
  const penetrated = afterArmor > 0 && armor.sp > 0 && !spell?.ignoreArmor;

  // Сопротивление ×½ (не суммируется), восприимчивость ×2, невосприимчивость
  const reasons = [];
  if (!ap && armor.resist?.includes(damageType)) reasons.push("броня");
  if (tsys.resistances?.includes?.(damageType)) reasons.push("сопротивление");
  if (weakness && damageType !== "elemental") {
    if (weakness === "silver" && !silver) reasons.push("не серебро");
    if (weakness === "meteorite" && !meteorite) reasons.push("не метеоритная сталь");
  }
  const susceptible = !!tsys.susceptibilities?.includes?.(damageType);
  const immune = !!tsys.immunities?.includes?.(damageType);
  let typeMult = reasons.length ? 0.5 : 1;
  if (susceptible) typeMult *= 2;
  if (immune) typeMult = 0;

  const locMult = location === "head" ? Math.max(locCfg.mult, d.headMult ?? 3) : locCfg.mult;
  let final = Math.floor(afterArmor * typeMult * locMult);

  // Заклинание по всему телу («Дыхание дракона», «Облако жуков»): урон по каждой части — со своей бронёй и
  // множителем, как ручной урон «по всем частям» (manual.mjs); износ брони — у каждой пробитой части
  let wear;
  if (spell?.allLocations) {
    wear = [];
    const rows = [];
    final = 0;
    for (const [key, cfg] of Object.entries(table)) {
      const a = d.armor?.[key] ?? { sp: 0, resist: [] };
      const after = Math.max(0, dmg - (spell.ignoreArmor ? 0 : a.sp));
      const halved = reasons.some(r => r !== "броня") || (!spell.ignoreArmor && a.resist?.includes(damageType));
      const m = immune ? 0 : (halved ? 0.5 : 1) * (susceptible ? 2 : 1);
      const lm = key === "head" ? Math.max(cfg.mult, d.headMult ?? 3) : cfg.mult;
      const value = Math.floor(after * m * lm);
      final += value;
      if (after > 0 && a.sp > 0 && !spell.ignoreArmor) wear.push({ location: key, amount: 1 });
      rows.push(`${cfg.label.toLowerCase()} ${value}`);
    }
    notes.push(`По всему телу: ${rows.join(", ")}.`);
  }

  // Критическое ранение
  let crit = null;
  if (critLevel) {
    const lvl = CRIT_LEVELS[critLevel];
    const balanced = has("balanced");
    let wound, critRoll;
    if (aimed) {
      const r = await new Roll(balanced ? "1d6+1" : "1d6").evaluate();
      rolls.push(r); critRoll = r.total;
      wound = aimedCritWound(critLevel, locCfg.crit, r.total);
    } else {
      // «Сбалансированное (+5)» у реликвий — свой бонус вместо +2
      const bonusLoc = parseInt((w.effects ?? []).find(x => x.key === "balanced")?.value, 10) || 2;
      const extra = (balanced ? bonusLoc : 0) + critLocBonus;
      const r = await new Roll(extra ? `2d6+${extra}` : "2d6").evaluate();
      rolls.push(r); critRoll = r.total;
      wound = critWoundFor(critLevel, r.total);
    }
    const woundCfg = CRIT_WOUNDS[wound];
    const organless = woundCfg?.organ && target.system.lacksAnatomy;
    const bonus = organless ? lvl.spiritBonus : lvl.bonus;
    final += bonus;
    crit = {
      level: critLevel, levelLabel: lvl.label, roll: critRoll, bonus,
      wound: organless ? null : wound,
      woundLabel: woundCfg?.label ?? "",
      woundText: organless ? "Нет органов — вместо ранения бонусный урон." : woundCfg?.states.fresh.text ?? "",
      woundLocation: woundLocationFor(woundCfg?.zone, location, table)
    };
  }

  // Высасывание крови: при уроне укусом цель теряет ещё 2d6 (броня не снижает), вампир получает столько же
  let drain = 0;
  if (attack.drain?.ok && final > 0 && !attack.nonLethal) {
    const r = await new Roll("2d6").evaluate();
    rolls.push(r);
    drain = r.total;
    final += drain;
    notes.push(`Высасывание крови: +${drain} урона; вампиру +${drain} ${attack.drain.mode === "hp" ? "ПЗ" : "ОК"}.`);
  }

  // Эффекты оружия: шанс в % (стр. 72, 161)
  const effects = [];
  for (const [key, status] of Object.entries(EFFECT_STATUS)) {
    let chance = Math.min(100, effChance(key) + (runeBonus[key] ?? 0));
    if (!chance) continue;
    if (ELEMENTAL.includes(status)) chance = Math.min(100, chance + elementalBonus);
    if (status === "burning") chance = Math.min(100, chance + burnVuln);
    const needsWound = key === "bleeding" || key === "poison";
    const resistKey = EFFECT_RESIST_KEY[key];
    const immuneTo = resistKey && tsys.immunities?.includes?.(resistKey);
    const r = await new Roll("1d100").evaluate();
    rolls.push(r);
    const success = !immuneTo && r.total <= chance && (!needsWound || final > 0);
    effects.push({ key, status, label: CONFIG.statusEffects[status]?.name ?? key, chance, roll: r.total, success, immune: !!immuneTo });
  }

  // Яд на клинке (чёрный, трупный): при уроне оружием подходящего типа — его состояния (alchemy.mjs, coatWeapon)
  let coatSpent = false;
  const coat = !spell && w.coat && (!w.coat.until || w.coat.until > (game.time.worldTime ?? 0)) ? w.coat : null;
  if (coat && final > 0 && (!coat.types?.length || coat.types.includes(damageType))) {
    for (const status of coat.statuses ?? []) {
      const resistKey = STATUS_RESIST_KEY[status];
      const immuneTo = resistKey && tsys.immunities?.includes?.(resistKey);
      effects.push({ key: "coat", status, label: `${CONFIG.statusEffects[status]?.name ?? status} (${coat.name})`,
        chance: 100, roll: "яд", success: !immuneTo, immune: !!immuneTo });
    }
    coatSpent = !!coat.once;
  }

  // Шанс дезориентировать сразу (хвост дракона, руна Триглава) — в отличие от «Дезориентирующего» без испытания
  const disorient = Math.min(100, effChance("disorient") + (runeBonus.disorient ?? 0));
  if (disorient) {
    const immuneTo = tsys.immunities?.includes?.(STATUS_RESIST_KEY.disoriented);
    const r = await new Roll("1d100").evaluate();
    rolls.push(r);
    effects.push({ key: "disorient", status: "disoriented", label: CONFIG.statusEffects.disoriented?.name ?? "Дезориентация",
      chance: disorient, roll: r.total, success: !immuneTo && r.total <= disorient, immune: !!immuneTo });
  }

  // Статусы магии: шанс уже посчитан при сотворении (с учётом вложенной Вын)
  for (const st of spell?.statuses ?? []) {
    const resistKey = STATUS_RESIST_KEY[st.status];
    const immuneTo = resistKey && tsys.immunities?.includes?.(resistKey);
    const r = await new Roll("1d100").evaluate();
    rolls.push(r);
    const chance = Math.min(100, (ELEMENTAL.includes(st.status) ? st.chance + elementalBonus : st.chance)
      + (st.status === "burning" ? burnVuln : 0));
    const success = !immuneTo && r.total <= chance;
    effects.push({ key: st.status, status: st.status, label: CONFIG.statusEffects[st.status]?.name ?? st.status,
      chance, roll: r.total, success, immune: !!immuneTo, rounds: spell.statusRounds });
  }

  // Урон Выносливости (Аньяльх)
  let staLoss = 0;
  if (spell?.staDamage) {
    const r = await rollFormula(spell.staDamage);
    if (r.roll) rolls.push(r.roll);
    staLoss = r.total;
  }

  // Испытание Уст: крит, «Дезориентирующее» по голове/туловищу, бросок
  let stunSave = null;
  const stunWeapon = (w.effects ?? []).find(e => e.key === "stun");
  if (stunWeapon && ["head", "torso"].includes(location)) {
    const n = parseInt(String(stunWeapon.value).replace(/[−–]/g, "-").replace(/[^\d-]/g, ""), 10);
    stunSave = { mod: Number.isFinite(n) ? -Math.abs(n) : 0, reason: "Дезориентирующее оружие" };
  }
  if (attack.stunSaveMod !== null && attack.stunSaveMod !== undefined) stunSave = { mod: attack.stunSaveMod, reason: attack.typeLabel };
  if (crit && !stunSave) stunSave = { mod: 0, reason: "Критическое ранение" };

  // Разрушающее: 1d6/2 урона ПБ
  let ablate = 0;
  if (has("ablating")) {
    const r = await new Roll("floor(1d6/2)").evaluate();
    rolls.push(r); ablate = r.total;
  }

  return {
    location, locationLabel: spell?.allLocations ? "всё тело" : locCfg.label, locRoll, locMult, wear,
    damageType, damageTypeLabel: CONFIG.VEDMAK.DAMAGE_TYPES[damageType]?.label ?? damageType,
    parts, rawDamage, coverSp,
    sp: armor.sp, effectiveSp: sp, ap, improvedAP, afterArmor, penetrated,
    resistReasons: reasons, susceptible, immune, typeMult,
    final, nonLethal: !!attack.nonLethal, crit, effects, stunSave, ablate, notes, staLoss, spell: !!spell,
    drain, drainMode: attack.drain?.mode ?? "",
    blockable: spell ? spell.defense === "dodgeBlock" : true,
    coatSpent,
    rolls
  };
}

/** Где находится рана: при совпадении зоны — в поражённой части тела, иначе в случайной стороне зоны. */
function woundLocationFor(zone, hitLocation, table) {
  if (!zone) return hitLocation;
  if (table[hitLocation]?.crit === zone) return hitLocation;
  const candidates = { head: ["head"], torso: ["torso"], arm: ["rightArm", "leftArm"], leg: ["rightLeg", "leftLeg"] }[zone] ?? [hitLocation];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/* -------------------------------------------------------------------------- */
/*  Применение (на стороне ведущего)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Применить рассчитанный урон к актору.
 * @returns {Promise<{lines: string[], stunSave: object|null, deathSave: boolean}>}
 */
export async function applyDamageToActor(actor, dmg) {
  dmg = { ...dmg };
  const sys = actor.system;
  const lines = [];
  const updates = {};
  const wasDying = sys.hp.value < 0;
  let deathSave = false;

  // Магический щит (Квен) поглощает урон, прошедший через броню, — только от блокируемых атак (стр. 114)
  let final = dmg.final;
  if (dmg.blockable !== false && sys.shield?.value > 0 && final > 0) {
    const absorbed = Math.min(final, sys.shield.value);
    final -= absorbed;
    const left = sys.shield.value - absorbed;
    await actor.update({ "system.shield.value": left });
    lines.push(`Щит поглотил ${absorbed} (осталось ${left}).`);
    if (!left) await removeShieldEffects(actor);
    dmg = { ...dmg, final };
  }

  if (dmg.nonLethal) {
    const sta = sys.sta.value - dmg.final;
    updates["system.sta.value"] = Math.max(0, sta);
    lines.push(`Несмертельный урон ${dmg.final}: Вын ${sys.sta.value} → ${Math.max(0, sta)}.`);
    if (sta <= 0) {
      await actor.toggleStatusEffect("unconscious", { active: true });
      await actor.toggleStatusEffect("disoriented", { active: true });
      lines.push("Без сознания.");
    }
  } else {
    const hp = sys.hp.value - dmg.final;
    updates["system.hp.value"] = hp;
    lines.push(`Урон ${dmg.final}: ПЗ ${sys.hp.value} → ${hp}.`);
    if (hp < 0) {
      deathSave = true;
      // Новое ранение при смерти: порог испытания падает ещё на 1 (стр. 162 — «за раунд и за каждое новое ранение»)
      if (wasDying) updates["system.deathSaves.penalty"] = (sys.deathSaves?.penalty ?? 0) + 1;
      lines.push(wasDying ? "Ранен при смерти: порог испытания −1, новое испытание против смерти." : "При смерти! Испытание против смерти.");
    } else if (hp < sys.derived.woundThreshold && sys.hp.value >= sys.derived.woundThreshold) {
      lines.push("Ниже порога ранения: Реа, Лвк, Инт и Воля ×½.");
    }
  }

  // Износ брони: пробивание −1 ПБ, разрушающее — ещё 1d6/2 (стр. 155, 72)
  const wear = dmg.wear ?? [{ location: dmg.location, amount: (dmg.penetrated ? 1 : 0) + (dmg.ablate ?? 0) }];
  if (dmg.staLoss) {
    const current = updates["system.sta.value"] ?? sys.sta.value;
    updates["system.sta.value"] = Math.max(0, current - dmg.staLoss);
    lines.push(`Выносливость −${dmg.staLoss}.`);
  }
  await actor.update(updates);
  lines.push(...await wearArmor(actor, wear));

  // Попадание выводит из дезориентации (стр. 161)
  if (actor.statuses.has("disoriented") && !actor.statuses.has("unconscious") && !dmg.nonLethal) {
    await actor.toggleStatusEffect("disoriented", { active: false });
    lines.push("Приходит в себя после попадания.");
  }

  // Критическое ранение
  if (dmg.crit?.wound) {
    const cfg = CRIT_WOUNDS[dmg.crit.wound];
    const system = { wound: dmg.crit.wound, location: dmg.crit.woundLocation, state: "fresh" };
    if (dmg.crit.wound === "lostTeeth") system.teeth = (await new Roll("1d10").evaluate()).total;
    if (cfg.states.fresh.mods.stunEvery === "1d6" && game.combat?.started) {
      system.nextStunRound = game.combat.round + (await new Roll("1d6").evaluate()).total;
    }
    await actor.createEmbeddedDocuments("Item", [{
      name: cfg.label, type: "critWound", img: cfg.img ?? "icons/skills/wounds/injury-body-pain-gray.webp", system
    }]);
    lines.push(`Критическое ранение: ${cfg.label} (${CRIT_LEVELS[cfg.level].label.toLowerCase()}).${system.teeth ? ` Выбито зубов: ${system.teeth}.` : ""}`);
    const m = cfg.states.fresh.mods;
    if (m.bleeding) await actor.toggleStatusEffect("bleeding", { active: true });
    if (m.poisoned) await actor.toggleStatusEffect("poisoned", { active: true });
    if (m.suffocating) await actor.toggleStatusEffect("suffocating", { active: true });
    if (m.deathSave) { deathSave = true; lines.push("Травма сердца: немедленное испытание против смерти."); }
    if (m.death) { await markDead(actor); lines.push("Смертельное ранение — мгновенная смерть."); deathSave = false; }
  }

  // Эффекты оружия
  const immune = immuneStatuses(actor);
  for (const e of dmg.effects ?? []) {
    if (!e.success) continue;
    if (immune.has(e.status)) { lines.push(`${e.label}: невосприимчив.`); continue; }
    await applyStatus(actor, e.status, e.rounds);
    lines.push(`Эффект: ${e.label}${e.rounds ? ` (${e.rounds} раундов)` : ""}.`);
  }

  return { lines, stunSave: dmg.stunSave ?? null, deathSave };
}

/**
 * Снизить ПБ самого тяжёлого слоя брони на частях тела.
 * @param {Actor} actor
 * @param {{location: string, amount: number}[]} wear
 * @returns {Promise<string[]>} строки отчёта
 */
export async function wearArmor(actor, wear) {
  const lines = [];
  const armor = actor.system.derived.armor ?? {};
  const byItem = new Map();
  let natural = 0;
  for (const { location, amount } of wear) {
    if (!amount) continue;
    const loc = armor[location];
    const outer = loc?.outer;
    if (!outer) continue;
    if (outer.item) {
      const slots = byItem.get(outer.item) ?? {};
      const current = slots[loc.slot] ?? outer.item.system.sp[loc.slot].value;
      slots[loc.slot] = Math.max(0, current - amount);
      byItem.set(outer.item, slots);
    } else {
      natural = Math.max(natural, amount);
    }
  }
  for (const [item, slots] of byItem) {
    await item.update(Object.fromEntries(Object.entries(slots).map(([slot, v]) => [`system.sp.${slot}.value`, v])));
    const labels = Object.entries(slots).map(([slot, v]) => `${CONFIG.VEDMAK.ARMOR_LOCATIONS[slot] ?? slot} ${v}`);
    lines.push(`${item.name}: ПБ ${labels.join(", ")}.`);
  }
  if (natural && actor.type === "monster") {
    const value = Math.max(0, actor.system.armor - natural);
    await actor.update({ "system.armor": value });
    lines.push(`Броня чудовища: ${value}.`);
  }
  return lines;
}

/**
 * Наложить статус; с длительностью в раундах (число или формула) — отсчёт в начале хода цели.
 */
export async function applyStatus(actor, status, rounds = "") {
  // Отравление от токсичности — свой эффект со статусом «отравлен» (alchemy.mjs). Ядро сочло бы статус уже
  // наложенным и не создало бы второго: яд оружия слился бы с ним и снялся бы вместе с токсичностью
  const own = e => e.statuses.has(status) && e.statuses.size === 1 && !e.flags?.vedmak?.toxicPoison;
  if (actor.effects.some(e => e.statuses.has(status)) && !actor.effects.some(own)) {
    const data = await ActiveEffect.implementation.fromStatusEffect(status);
    await actor.createEmbeddedDocuments("ActiveEffect", [data.toObject()]);
  } else await actor.toggleStatusEffect(status, { active: true });
  if (!rounds) return;
  const n = Number.isFinite(Number(rounds)) ? Number(rounds) : (await new Roll(String(rounds)).evaluate()).total;
  const effect = actor.effects.find(own);
  if (effect && n > 0) await effect.update({ "flags.vedmak.statusRounds": n });
}

/** Снять эффекты-метки щита, когда щит исчерпан. */
export async function removeShieldEffects(actor) {
  const ids = actor.effects.filter(e => e.flags?.vedmak?.timed?.key === "shield" || e.flags?.vedmak?.maintain?.shield).map(e => e.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

/**
 * Карточки, которые ведущий применяет прямо сейчас. Флаг `applied` ставится только в конце,
 * а игрок получает управление сразу после отправки запроса, поэтому второй клик (или клик
 * атакующего и владельца цели разом) иначе нанёс бы урон дважды.
 */
export const applyingMessages = new Set();

registerGMHandler("applyDamage", async ({ messageId }, userId) => {
  if (applyingMessages.has(messageId)) return;
  const message = game.messages.get(messageId);
  const dmg = message?.flags.vedmak?.damage;
  if (!dmg || dmg.applied) return;
  const actor = resolveActor(dmg.target.tokenUuid) ?? resolveActor(dmg.target.actorUuid);
  if (!actor) return ui.notifications.warn("Цель урона не найдена.");
  const attacker = resolveActor(dmg.attacker.tokenUuid) ?? resolveActor(dmg.attacker.actorUuid);
  // Запрос игрока: он атакующий или владелец цели (как у кнопки), а карточку урона создал владелец
  // атакующего — иначе карточку с любым уроном по любой цели можно подделать из консоли
  if (!game.users.get(userId)?.isGM
    && (!userOwnsAny(userId, attacker, actor) || !userOwnsAny(message.author?.id, attacker) || !damageChainValid(message, dmg, attacker, actor))) {
    return console.warn(`vedmak | отклонён запрос урона от ${game.users.get(userId)?.name ?? userId}`);
  }
  applyingMessages.add(messageId);
  try {
    const hpBefore = actor.system.hp.value;
    const report = await serialByActor(actor, () => applyDamageToActor(actor, dmg));
    // Алхимия: отвары грифона и виверны, «Молния», убийства
    const dealt = dmg.nonLethal ? 0 : Math.max(0, hpBefore - actor.system.hp.value);
    // Укус или высасывание крови — для «Чёрной крови» ведьмака
    const bite = dmg.drain > 0 || /укус|клык/i.test(dmg.attackLabel ?? "");
    report.lines.push(...await alchemyAfterDamage(attacker, actor, { dealt, hpBefore, physical: !dmg.spell, bite }));
    if (dmg.dimeritium && !actor.effects.some(e => e.flags?.vedmak?.dimeritium)) {
      report.dimeritium = true;
      report.lines.push("Удар двимеритом: касание двимерита (кнопка ниже).");
    }
    // Высасывание крови: вампир восполняет ОК (до максимума ПЗ) или ПЗ
    if (dmg.drain > 0 && attacker?.system.blood?.enabled) {
      if (dmg.drainMode === "hp") {
        const hp = Math.min(attacker.system.hp.max, attacker.system.hp.value + dmg.drain);
        await attacker.update({ "system.hp.value": hp });
        report.lines.push(`${attacker.name}: высасывание крови +${dmg.drain} ПЗ (${hp}/${attacker.system.hp.max}).`);
      } else {
        const blood = Math.min(attacker.system.blood.max, attacker.system.blood.value + dmg.drain);
        await attacker.update({ "system.blood.value": blood });
        report.lines.push(`${attacker.name}: высасывание крови +${dmg.drain} ОК (${blood}/${attacker.system.blood.max}).`);
      }
    }
    // Адреналин: каждый нанесённый крит — кость d6 («Лес Марибора» — две), не больше Тел атакующего
    if (dmg.crit && game.settings.get("vedmak", "adrenaline")) {
      if (attacker?.type === "character") {
        const max = attacker.system.stats.body.total;
        const value = Math.min(max, (attacker.system.adrenaline?.value ?? 0) + adrenalinePerCrit(attacker));
        await attacker.update({ "system.adrenaline.value": value });
        report.lines.push(`${attacker.name}: кость адреналина (${value}/${max}).`);
      }
    }
    const data = { ...dmg, applied: true, report };
    const content = await renderTemplate("systems/vedmak/templates/chat/damage.hbs", data);
    await message.update({ content, "flags.vedmak.damage.applied": true, "flags.vedmak.damage.report": report });
  } finally {
    applyingMessages.delete(messageId);
  }
});

const actorOfRef = ref => resolveActor(ref?.tokenUuid) ?? resolveActor(ref?.actorUuid);

/**
 * Карточку урона игрок создаёт сам, поэтому ведущий сверяет её цепочку: защита — настоящая карточка, её создал владелец
 * защитника (или ведущий), в ней те же атакующий и цель и разрешён урон, а по этой защите ещё не применяли другой урон.
 * Так нельзя ударить того, кто не защищался от этой атаки, и нельзя применить урон дважды разными карточками.
 */
function damageChainValid(message, dmg, attacker, target) {
  const defMsg = game.messages.get(dmg.defenseMessageId);
  const def = defMsg?.flags.vedmak?.defense;
  if (!def?.canDamage) return false;
  if (actorOfRef(def.defender) !== target || actorOfRef(def.attack?.attacker) !== attacker) return false;
  if (!(defMsg.author?.isGM || userOwnsAny(defMsg.author?.id, target))) return false;
  return !game.messages.some(m => m.id !== message.id && m.flags.vedmak?.damage?.defenseMessageId === defMsg.id
    && m.flags.vedmak.damage.applied);
}

/**
 * Применения урона к одному актору — по очереди: каждое читает ПЗ в начале, а пишет после ответа сервера, и два
 * одновременных (автоприменение, быстрая атака по одной цели) иначе теряли одно обновление.
 */
const actorQueues = new Map();
export function serialByActor(actor, fn) {
  const key = actor.uuid;
  const run = (actorQueues.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => {});
  actorQueues.set(key, tail);
  tail.then(() => { if (actorQueues.get(key) === tail) actorQueues.delete(key); });
  return run;
}

/**
 * Может ли отправитель менять статус цели. Ведущий и владелец цели — всегда. Остальным — только по карточке защиты
 * (messageId), которую можно проверить на стороне ведущего:
 *  • попадание: статус от приёма атаки (сбить с ног и т.п.) просит владелец атакующего, цель — защитник карточки;
 *  • успешное парирование: «ошеломлён» на атакующем просит владелец защитника, а атакующий — из настоящей карточки атаки.
 * Карточку защиты создаёт владелец защитника (или ведущий), поэтому подделать её на чужого защитника нельзя.
 */
function canSetStatus(userId, actor, status, active, messageId) {
  if (userOwnsAny(userId, actor)) return true;
  const card = game.messages.get(messageId);
  const def = card?.flags.vedmak?.defense;
  if (def?.kind !== "defense" || !active) return false;
  const defender = actorOfRef(def.defender);
  if (!defender || !userOwnsAny(card.author?.id, defender)) return false;
  if (def.hit) {
    return status === def.attack?.hitStatus && defender === actor && userOwnsAny(userId, actorOfRef(def.attack.attacker));
  }
  if (def.defense !== "parry" || status !== "staggered" || !userOwnsAny(userId, defender)) return false;
  const attack = game.messages.get(def.attackMessageId)?.flags.vedmak?.attack;
  return attack?.kind === "attack" && actorOfRef(attack.attacker) === actor;
}

registerGMHandler("setStatus", async ({ uuid, status, active, messageId }, userId) => {
  const actor = resolveActor(uuid);
  if (!actor || !CONFIG.statusEffects.some(s => s.id === status)) return;
  if (!canSetStatus(userId, actor, status, !!active, messageId)) {
    return console.warn(`vedmak | отклонена смена статуса от ${game.users.get(userId)?.name ?? userId}`);
  }
  await actor.toggleStatusEffect(status, { active: !!active });
});

/** Кнопка «Применить». */
export async function requestApplyDamage(message) {
  const dmg = message.flags.vedmak?.damage;
  if (!dmg) return;
  if (dmg.applied) return ui.notifications.info("Урон уже применён.");
  const target = resolveActor(dmg.target.tokenUuid) ?? resolveActor(dmg.target.actorUuid);
  const attacker = resolveActor(dmg.attacker.tokenUuid) ?? resolveActor(dmg.attacker.actorUuid);
  if (!game.user.isGM && !target?.isOwner && !attacker?.isOwner) {
    return ui.notifications.warn("Применить урон может ведущий, атакующий или владелец цели.");
  }
  return asGM("applyDamage", { messageId: message.id });
}
