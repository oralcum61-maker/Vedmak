// Атака: выбор оружия и вида атаки, бросок, карточка с кнопками защиты целей (стр. 151–164).

import { SKILLS } from "../config/skills.mjs";
import { punchSteps } from "../config/stats.mjs";
import { witcherSchools } from "../config/character.mjs";
import {
  ATTACK_TYPES, UNARMED_ATTACKS, ATTACK_SITUATIONS, RANGE_BANDS, LOCATIONS_HUMANOID, LOCATIONS_MONSTER, MOUNTS, WEIGHT_MODS,
  fumbleText, fumbleEffect, locationGlyph
} from "../config/combat.mjs";
import { performCheck } from "../dice/check.mjs";
import { bindDialog, commonFields, foldState, readCommon } from "../dice/dialog-ui.mjs";
import { renderTemplate } from "../util.mjs";
import { statusRollMods } from "./statuses.mjs";
import { inTrueForm } from "../character/true-form.mjs";
import { prostheticStrike, equippedProstheses, weaponMount } from "./prosthetics.mjs";
import { ammoProps } from "../config/items.mjs";
import { aimBonus, clearAim } from "./manual.mjs";
import { invisibleOpponentPart, monsterInvisibility, dropInvisibility } from "./monster-traits.mjs";
import { isSnail, GRAB_ATTACKS } from "../character/snail-school.mjs";

/** Уровень «Удара сверху» берсерка; 0 — не в медвежьей форме или способности нет. */
function bearSlamLevel(actor) {
  if (actor?.type !== "character" || !actor.system.derived?.bearForm) return 0;
  for (const b of actor.system.profession?.system.branches ?? []) for (const a of b.abilities) if (a.name === "Удар сверху") return a.value ?? 0;
  return 0;
}

/**
 * Высасывание крови («Высший вампир. Вторая редакция», стр. 9): укус вампира с запасом Очков Крови.
 * @returns {{trueForm: boolean}|null}
 */
function drainOption(actor, src) {
  if (!actor?.system.blood?.enabled || !/укус/i.test(src.item?.name ?? "")) return null;
  return { trueForm: inTrueForm(actor) };
}
import {
  currentTargets, actorToken, tokenDistance, resolveActor, postCard, defaultMessageMode, armWoundParts, isReadyWeapon
} from "./common.mjs";

const SHIELD_STEPS = { light: 0, medium: 2, heavy: 4 };

/**
 * Описание источника атаки.
 * @param {Actor} actor
 * @param {{kind: "weapon"|"unarmed"|"shield", itemId?: string, key?: string}} source
 */
export function describeSource(actor, source) {
  const d = actor.system.derived;
  const isMonster = actor.type === "monster";

  // «Удар сверху» берсерка в медвежьей форме («Новые профессии»): полный ход, Реа + уровень способности; при
  // попадании 6d6 в туловище, цель сбита с ног и обездвижена. Блок отменяет урон, но не падение (defense.mjs)
  if (source.kind === "bearSlam") {
    const level = bearSlamLevel(actor);
    if (!level) return null;
    return {
      kind: "bearSlam", key: "bearSlam", label: "Удар сверху", img: "icons/creatures/abilities/bear-roar-bite-brown.webp",
      skill: "brawling", ability: { stat: "ref", label: "Удар сверху", value: level }, accuracy: 0, isRanged: false,
      types: { slam: { label: "Удар сверху (полный ход)", mod: 0, damage: 1, location: "torso", status: "prone", status2: "immobilized",
        hint: "Встав на задние лапы — всеми когтями по цели рядом. Полный ход.",
        hit: "Цель сбита с ног и обездвижена." } },
      defaultType: "slam",
      weapon: { name: "Удар сверху", damage: "6d6", damageTypes: ["slashing"], effects: [], silverDamage: "", bearSlam: true }
    };
  }

  if (source.kind === "unarmed") {
    return {
      kind: "unarmed", key: "unarmed", label: "Без оружия", img: "icons/skills/melee/unarmed-punch-fist.webp",
      skill: "brawling", accuracy: 0, isRanged: false,
      types: UNARMED_ATTACKS, defaultType: "punch",
      weapon: { name: "Без оружия", damageTypes: ["bludgeoning"], effects: [], nonLethal: true, unarmed: true,
        punch: d.punch, kick: d.kick }
    };
  }

  // Удар протезом: Борьба, удары рукой и ногой со свойствами протеза и модификаций (prosthetics.mjs)
  if (source.kind === "prosthetic") {
    const p = prostheticStrike(actor, source.itemId);
    if (!p) return null;
    const extra = p.damage ? ` + ${p.damage}` : "";
    const types = Object.fromEntries(Object.entries(pick(UNARMED_ATTACKS, PROSTHETIC_ATTACKS)).map(([k, t]) => {
      const out = p.lethal && t.nonLethal ? { ...t, nonLethal: false } : { ...t };
      if (p.dimeritium && k === "grapple") out.hit = `${t.hit} Двимеритовый протез: касание двимерита.`;
      return [k, out];
    }));
    return {
      kind: "prosthetic", key: p.item.id, label: `${p.item.name}: удар`, img: p.item.img, item: p.item,
      skill: "brawling", accuracy: p.accuracy, isRanged: false, types, defaultType: "punch",
      reliability: p.reliability, fallsOff: p.fallsOff,
      weapon: { id: p.item.id, name: p.item.name, img: p.item.img, damageTypes: ["bludgeoning"], effects: p.effects,
        silverDamage: p.silver, nonLethal: !p.lethal, unarmed: true, prosthetic: true, dimeritium: p.dimeritium,
        punch: `${d.punch}${extra}`, kick: `${d.kick}${extra}`, mods: p.mods }
    };
  }

  if (source.kind === "ram") {
    const m = MOUNTS[source.key] ?? MOUNTS.horse;
    return {
      kind: "ram", key: source.key, label: `Таран: ${m.label}`, img: "icons/environment/people/cavalry.webp",
      skill: m.skill, accuracy: 0, isRanged: false, mounted: true,
      types: pick(ATTACK_TYPES, ["single"]), defaultType: "single",
      weapon: { name: m.label, damage: m.ram, damageTypes: ["bludgeoning"], effects: [], silverDamage: "", ram: true }
    };
  }

  const item = actor.items.get(source.itemId);
  if (!item) return null;

  if (source.kind === "shield") {
    const steps = SHIELD_STEPS[item.system.weightClass] ?? 0;
    return {
      kind: "shield", key: item.id, label: `${item.name}: атака щитом`, img: item.img, item,
      skill: "melee", accuracy: 0, isRanged: false,
      types: pick(ATTACK_TYPES, ["fast", "strong"]), defaultType: "fast",
      weapon: { id: item.id, name: item.name, img: item.img, damage: punchSteps(actor.system.derived?.meleeBody ?? actor.system.stats.body.raw, steps),
        damageTypes: ["bludgeoning"], effects: [], silverDamage: "", shield: true }
    };
  }

  const w = item.system;
  let types;
  if (isMonster) {
    // Чудовище выбирает вид атаки, как персонаж; первой стоит обычная — со скоростью атаки (СА), как в книге.
    // Быстрая и сильная — по просьбе автора (PLAN 4.40); приёмы оружием — только у изготовленного оружия ближнего боя
    if (w.isCrossbow) types = pick(ATTACK_TYPES, ["single"]);
    else if (w.isRanged) types = pick(ATTACK_TYPES, w.isThrown ? ["single", "fast", "strong"] : ["single", "strong"]);
    else types = pick(ATTACK_TYPES, w.category === "natural" ? ["single", "fast", "strong"]
      : ["single", "fast", "strong", "pommel", "disarm", "trip"]);
  } else if (w.isCrossbow) types = pick(ATTACK_TYPES, ["single"]);
  else if (w.isBow) types = pick(ATTACK_TYPES, ["single", "strong"]);
  else if (w.isThrown) types = pick(ATTACK_TYPES, ["fast", "strong"]);
  else types = pick(ATTACK_TYPES, ["fast", "strong", "charge", "pommel", "disarm", "trip", "feint", "dual"]);

  // Урон: рукопашное оружие добавляет удар рукой; ближнее и метательное — бонус урона по Тел (стр. 48, 72)
  let damage = w.damage || "0";
  if (w.effect("hands")) damage = `${damage} + ${d.punch}`;
  else if ((!w.isRanged || w.isThrown) && d.meleeBonus) damage = `${damage} ${d.meleeBonus > 0 ? "+" : "-"} ${Math.abs(d.meleeBonus)}`;

  return {
    kind: "weapon", key: item.id, label: item.name, img: item.img, item,
    skill: w.skill, accuracy: w.accuracy, isRanged: w.isRanged,
    types, defaultType: Object.keys(types)[0],
    weapon: {
      id: item.id, name: item.name, img: item.img, damage, rawDamage: w.damage,
      oil: w.activeOil ? { name: w.oil.name, target: w.oil.target } : null,
      // Яд на клинке (alchemy.mjs, coatWeapon): срок проверяет урон
      coat: item.flags?.vedmak?.coat ?? null,
      damageTypes: w.damageTypes.length ? [...w.damageTypes] : ["bludgeoning"],
      silverDamage: w.silverDamage, effects: w.effects.map(e => ({ ...e })),
      isRanged: w.isRanged, isThrown: w.isThrown, isBow: w.isBow, isCrossbow: w.isCrossbow,
      range: w.rangeMeters(actor.system.stats.body.raw), attackSpeed: w.attackSpeed,
      nonLethal: !!w.effect("nonLethal"), category: w.category, hands: w.hands
    }
  };
}

/** Ведьмачья школа персонажа (корника или своя) — с видами атаки без штрафа. */
function schoolOf(actor) {
  if (actor.type !== "character") return null;
  return witcherSchools()[actor.system.details?.school] ?? null;
}

/** Удары протезом: рукой и ногой, разбег, захват (двимеритовый протез — касание двимерита). */
const PROSTHETIC_ATTACKS = ["punch", "punchStrong", "kick", "kickStrong", "pushKick", "charge", "grapple"];

function pick(map, keys) {
  return Object.fromEntries(keys.filter(k => map[k]).map(k => [k, map[k]]));
}

/** Все доступные источники атак актора (для листа). */
export function attackSources(actor) {
  const out = [];
  // В бой идёт только то, что в руках (isReadyWeapon): ненадетое оружие персонажа не предлагается
  const weapons = actor.itemTypes.weapon.filter(w => isReadyWeapon(actor, w)).sort((a, b) => a.sort - b.sort);
  for (const w of weapons) out.push(describeSource(actor, { kind: "weapon", itemId: w.id }));
  for (const s of actor.itemTypes.armor.filter(i => i.system.isShield && i.system.equipped)) {
    out.push(describeSource(actor, { kind: "shield", itemId: s.id }));
  }
  out.push(describeSource(actor, { kind: "unarmed" }));
  for (const p of equippedProstheses(actor)) out.push(describeSource(actor, { kind: "prosthetic", itemId: p.id }));
  if (bearSlamLevel(actor)) out.push(describeSource(actor, { kind: "bearSlam" }));
  return out.filter(Boolean);
}

/** Предложить дистанцию стрельбы по расстоянию до первой цели. */
function suggestBand(actor, src, targets) {
  if (!src.isRanged) return { band: "", distance: null };
  const target = targets[0] ? fromUuidSync(targets[0].tokenUuid)?.object : null;
  const distance = tokenDistance(actorToken(actor), target);
  const range = src.weapon.range || 0;
  if (distance === null || !range) return { band: "close", distance };
  let band = "beyond";
  if (distance <= (canvas.grid?.distance ?? 2)) band = "pointBlank";
  else if (distance <= range * 0.25) band = "close";
  else if (distance <= range * 0.5) band = "medium";
  else if (distance <= range) band = "long";
  else if (distance <= range * 2) band = "extreme";
  return { band, distance };
}

/**
 * Атаковать. Без `skipDialog` откроет окно выбора.
 * @param {Actor} actor
 * @param {object} source — см. describeSource
 * @param {object} [opts] — {attackType, aim, band, situations[], extraAction, mod, luck, messageMode, skipDialog, targets}
 */
export async function attack(actor, source, opts = {}) {
  const src = describeSource(actor, source);
  if (!src) return null;
  if ((src.kind === "weapon" || src.kind === "shield") && !(src.kind === "shield" ? src.item?.system.equipped : isReadyWeapon(actor, src.item))) {
    ui.notifications.warn(`«${src.item?.name ?? src.label}» не в руках — наденьте на вкладке «Снаряжение», тогда можно атаковать.`);
    return null;
  }
  const targets = opts.targets ?? currentTargets();
  // Набранное прицеливание по этой цели — отмеченным пунктом «Прицеливание N раунд(а)»
  const aimed = aimBonus(actor, targets[0]?.tokenUuid ?? null);
  const situations = [...(opts.situations ?? [])];
  if (aimed && !situations.some(k => /^aim\d$/.test(k))) situations.push(`aim${aimed}`);
  let cfg = {
    attackType: opts.attackType ?? src.defaultType, aim: opts.aim ?? "", band: opts.band,
    chargeMeters: opts.chargeMeters ?? 0, gallop: !!opts.gallop, weight: opts.weight ?? "light",
    situations, extraAction: !!opts.extraAction, mod: opts.mod ?? 0,
    damageMod: opts.damageMod ?? 0, luck: opts.luck ?? 0,
    messageMode: opts.messageMode ?? defaultMessageMode()
  };

  const suggested = suggestBand(actor, src, targets);
  cfg.band ??= suggested.band === "beyond" ? "extreme" : suggested.band;

  if (!opts.skipDialog) {
    cfg = await attackDialog(actor, src, targets, cfg, suggested);
    if (!cfg) return null;
  }
  return rollAttack(actor, src, targets, cfg);
}

/**
 * Действует ли рукой: оружие, щит, удар рукой и приёмы Борьбы — да; пинки, подсечка, таран и приём
 * другим навыком (финт — Обман) — нет. К таким атакам идёт штраф ран руки (стр. 158–160).
 */
function usesArm(src, typeKey) {
  const typeCfg = src.types[typeKey] ?? Object.values(src.types)[0];
  if (typeCfg.skill) return false;
  if (src.kind === "unarmed") return typeCfg.damage !== "kick" && typeKey !== "trip";
  return src.kind === "weapon" || src.kind === "shield";
}

/** Основа броска для вида атаки — та же арифметика, что в rollAttack. */
function attackBase(actor, src, typeKey) {
  const typeCfg = src.types[typeKey] ?? Object.values(src.types)[0];
  const skillKey = typeCfg.skill ?? src.skill;
  const skill = actor.system.skills[skillKey];
  const stat = actor.system.stats[SKILLS[skillKey].stat];
  const sum = stat.effective + skill.total + skill.penalty;
  let base = sum;
  if (skill.base !== Math.max(0, sum)) base += skill.base - sum;
  if (src.accuracy && !typeCfg.skill) base += src.accuracy;
  if (src.kind === "weapon") base += weaponMount(actor, src.item)?.mod ?? 0;
  for (const m of statusRollMods(actor, "attack")) base += Number(m.value) || 0;
  if (usesArm(src, typeKey)) for (const m of armWoundParts(actor)) base += m.value;
  return base;
}

/** Формула урона вида атаки для показа в окне: то же, что уйдёт в карточку. */
function previewDamage(actor, src, typeKey) {
  const typeCfg = src.types[typeKey] ?? Object.values(src.types)[0];
  const unarmed = src.kind === "unarmed" || src.kind === "prosthetic";
  let formula = src.weapon.damage;
  let mult = typeCfg.damage ?? 1;
  if (unarmed) {
    formula = typeCfg.damage === "kick" ? src.weapon.kick : typeCfg.damage === "punch" ? src.weapon.punch : "";
    mult = typeCfg.mult ?? 1;
  }
  if (!formula || !mult) return { formula: "", mult: 1 };
  const bonus = actor.system.derived?.damageBonus ?? 0;
  if (bonus && !src.weapon.ram) formula = `${formula} ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}`;
  return { formula, mult };
}

/** Мелкая подпись на кнопке вида атаки: штраф и что с уроном. */
function typeNote(typeCfg, mod, damage) {
  const bits = [];
  if (mod) bits.push(mod > 0 ? `+${mod}` : `−${Math.abs(mod)}`);
  if (!damage.formula) bits.push("без урона");
  else if (damage.mult === 0.5) bits.push("урон ½");
  else if (damage.mult !== 1) bits.push(`урон ×${damage.mult}`);
  if (typeCfg.nonLethal) bits.push("несмертельно");
  return bits.join(" · ");
}

async function attackDialog(actor, src, targets, cfg, suggested) {
  const target = resolveActor(targets[0]?.tokenUuid ?? targets[0]?.actorUuid);
  const autoSituations = new Set(cfg.situations);
  if (target?.statuses.has("immobilized")) autoSituations.add("immobilized");
  if (!src.isRanged && target?.statuses.has("activeDodge")) autoSituations.add("activeDodge");
  // Напуганный атакует источник страха с −3; источник неизвестен (наложен вручную) — тоже отмечаем, снять можно
  const fear = actor.effects.find(e => e.active && e.statuses?.has("frightened"));
  if (fear && target) {
    const source = fear.getFlag("vedmak", "fearSource");
    if (!source || source === target.uuid) autoSituations.add("frightened");
  }

  const school = schoolOf(actor);
  const types = Object.entries(src.types).map(([key, t]) => {
    const waived = !!school?.waive?.includes(key);
    const mod = waived ? 0 : t.mod ?? 0;
    const damage = previewDamage(actor, src, key);
    return {
      key, label: t.label, hint: t.hint ?? t.hit ?? "", mod,
      base: attackBase(actor, src, key), dmult: damage.mult, damage: damage.formula,
      note: typeNote(t, mod, damage), selected: key === cfg.attackType
    };
  });
  const current = types.find(t => t.selected) ?? types[0];

  const locList = (target?.system.derived?.bodyType ?? "humanoid") === "monster" ? LOCATIONS_MONSTER : LOCATIONS_HUMANOID;
  const locations = [{ key: "", label: "Случайно", note: "d10", mod: 0, selected: !cfg.aim, glyph: locationGlyph("") }].concat(
    Object.entries(locList).map(([key, l]) => ({ key, label: l.label, note: String(l.penalty), mod: l.penalty, selected: key === cfg.aim,
      glyph: locationGlyph(key, l) }))
  );

  const skillLabel = SKILLS[src.types[current.key]?.skill ?? src.skill].label;
  const targetNames = targets.map(t => t.name).join(", ");
  const content = await renderTemplate("systems/vedmak/templates/dialog/attack.hbs", {
    src, targets, cfg, types, locations,
    head: {
      title: targetNames || src.label, img: src.img, base: current.base,
      subtitle: [targetNames ? src.label : "", `${skillLabel} ${current.base}`,
        current.damage ? `урон ${current.damage}` : "без урона"].filter(Boolean).join(" · "),
      note: targets.length ? "" : "Цель не выбрана — защиту бросят из карточки выделенным токеном.",
      noteWarn: !targets.length
    },
    bands: Object.entries(RANGE_BANDS).map(([key, b]) => ({ key, ...b, selected: key === cfg.band })),
    suggested, beyond: suggested.band === "beyond",
    situations: Object.entries(ATTACK_SITUATIONS).map(([key, s]) => ({ key, ...s, checked: autoSituations.has(key) })),
    foldSituations: foldState("attackSituations", false),
    // Штраф ран руки — в строке «уже в основе»; основа каждого вида атаки считает его сама (пинку — нет)
    statusMods: [...statusRollMods(actor, "attack"),
      ...armWoundParts(actor).map(p => ({ ...p, label: `${p.label}: атаки рукой` }))],
    weights: Object.entries(WEIGHT_MODS).map(([key, w]) => ({ key, label: w.label, selected: key === cfg.weight })),
    staCost: actor.type === "character",
    isMonster: actor.type === "monster",
    drain: drainOption(actor, src),
    total: { base: current.base, damage: current.damage },
    ...commonFields({ luckMax: actor.system.luck?.value ?? 0, mod: cfg.mod, damage: current.damage, damageMod: cfg.damageMod })
  });

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `Атака: ${src.label}` },
    classes: ["vedmak", "vedmak-dialog", "check-dialog", "attack-dialog"],
    position: { width: 560 },
    content,
    render: (event, dialog) => bindDialog(dialog, {
      // Разбег — после множителя сильной атаки, как и в броске урона (стр. 171)
      damageExtra: form => {
        const dice = form.elements.gallop?.checked ? 5 : Math.min(5, Math.floor((Number(form.elements.chargeMeters?.value) || 0) / 2));
        const w = WEIGHT_MODS[form.elements.weight?.value]?.mult ?? 1;
        return dice ? ` + ${dice}d6${w === 0.5 ? " ×½" : w !== 1 ? ` ×${w}` : ""}` : "";
      }
    }),
    buttons: [{
      action: "attack", label: "Атаковать", default: true,
      callback: (event, button) => {
        const f = button.form.elements;
        return {
          ...readCommon(f, actor.system.luck?.value ?? 0),
          attackType: f.attackType.value,
          aim: f.aim.value,
          band: f.band?.value ?? "",
          situations: Object.keys(ATTACK_SITUATIONS).filter(k => f[`sit.${k}`]?.checked),
          extraAction: !!f.extraAction?.checked,
          drain: f.drain?.checked ? (f.drainMode?.value || "blood") : "",
          chargeMeters: Number(f.chargeMeters?.value) || 0,
          gallop: !!f.gallop?.checked,
          weight: f.weight?.value ?? "light"
        };
      }
    }, { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  return result === "cancel" ? null : result;
}

/** Бросок атаки и карточка. */
/** Боеприпас для лука или арбалета: надетый, иначе стандартный, иначе любой с остатком (кроме болтов скорпио). */
function pickAmmo(actor) {
  const ammo = actor.itemTypes.gear.filter(g => g.system.category === "ammo" && (g.system.quantity ?? 0) > 0
    && !/скорпио/i.test(g.name));
  return ammo.find(g => g.system.equipped) ?? ammo.find(g => /стандартн/i.test(g.name)) ?? ammo[0] ?? null;
}

/**
 * Выстрел тратит боеприпас (персонажи, настройка «Бой: расход боеприпасов»).
 * @returns {Promise<{note: string, item: Item}|null|false>} строка для карточки и боеприпас; false — стрелять нечем
 */
async function spendAmmo(actor, src) {
  const w = src.item?.system;
  if (!w || !(w.isBow || w.isCrossbow) || actor.type !== "character" || !game.settings.get("vedmak", "ammo")) return null;
  const ammo = pickAmmo(actor);
  if (!ammo) {
    ui.notifications.warn(`${actor.name}: нет боеприпасов для «${src.item.name}». Добавьте их в снаряжение или выключите расход в настройках.`);
    return false;
  }
  const left = ammo.system.quantity - 1;
  await ammo.update({ "system.quantity": left });
  return { note: `Боеприпас: ${ammo.name} (осталось ${left}).${left ? "" : " Последний!"}`, item: ammo };
}

/** Оружие выстрела со свойствами боеприпаса (AMMO_PROPS): тип урона, эффекты, серебро, взрыв, разделение. */
function withAmmo(weapon, ammo) {
  const p = ammo && ammoProps(ammo.name);
  if (!p) return weapon;
  const w = { ...weapon, effects: [...(weapon.effects ?? [])] };
  if (p.damageTypes) w.damageTypes = [...p.damageTypes];
  for (const e of p.effects ?? []) if (!w.effects.some(x => x.key === e.key)) w.effects.push({ ...e });
  if (p.nonLethal) w.nonLethal = true;
  if (p.silver && !w.silverDamage?.trim?.()) w.silverDamage = p.silver;
  w.ammo = { name: ammo.name, explode: p.explode ?? null, split: p.split ?? 0, afterHit: p.afterHit ?? 0, note: p.note ?? "" };
  return w;
}

export async function rollAttack(actor, src, targets, cfg) {
  const spent = await spendAmmo(actor, src);
  if (spent === false) return null;
  const ammoNote = spent?.note ?? null;
  // Особый боеприпас меняет оружие этого выстрела (урон, эффекты), не сам предмет
  const weapon = withAmmo(src.weapon, spent?.item);
  const typeCfg = src.types[cfg.attackType] ?? Object.values(src.types)[0];
  const skillKey = typeCfg.skill ?? src.skill;
  const skill = actor.system.skills[skillKey];
  const stat = actor.system.stats[src.ability?.stat ?? SKILLS[skillKey].stat];

  const parts = [{ label: stat.label, value: stat.effective, always: true }];
  if (src.ability) {
    // Способность древа профессии вместо навыка («Удар сверху»): параметр + уровень, ранения — ко всем действиям
    parts.push({ label: src.ability.label, value: src.ability.value, always: true });
    if (actor.system.derived?.actionMod) parts.push({ label: "Ранения: ко всем действиям", value: actor.system.derived.actionMod });
  } else {
    parts.push({ label: skill.label, value: skill.total, always: true });
    const sum = stat.effective + skill.total + skill.penalty;
    if (skill.penalty) parts.push({ label: "Ранения и СД", value: skill.penalty });
    if (skill.base !== Math.max(0, sum)) parts.push({ label: "Ранения (множитель)", value: skill.base - sum });
  }
  if (src.accuracy && !typeCfg.skill) parts.push({ label: "Точность", value: src.accuracy });
  // Оружие в протезе: ручной арбалет −3, скрытый клинок +4
  const mount = src.kind === "weapon" ? weaponMount(actor, src.item) : null;
  if (mount) parts.push({ label: mount.label, value: mount.mod });
  const school = schoolOf(actor);
  const waived = !!school?.waive?.includes(cfg.attackType);
  if (typeCfg.mod && waived) parts.push({ label: `${typeCfg.label}: ${school.label} — без штрафа`, value: 0, always: true });
  else if (typeCfg.mod) parts.push({ label: typeCfg.label, value: typeCfg.mod });

  // Прицельная атака
  let aimLabel = "";
  if (cfg.aim) {
    const loc = LOCATIONS_HUMANOID[cfg.aim] ?? LOCATIONS_MONSTER[cfg.aim];
    if (loc) { parts.push({ label: `Прицельно: ${loc.label}`, value: loc.penalty }); aimLabel = loc.label; }
  }
  // Дистанция
  if (src.isRanged && cfg.band && RANGE_BANDS[cfg.band]) {
    parts.push({ label: `Дистанция: ${RANGE_BANDS[cfg.band].label}`, value: RANGE_BANDS[cfg.band].mod });
  }
  for (const key of cfg.situations ?? []) {
    const s = ATTACK_SITUATIONS[key];
    if (s) parts.push({ label: s.label, value: s.mod });
  }
  parts.push(...statusRollMods(actor, "attack"));
  // Цель — невидимое чудовище (обычная невидимость): −3 даже заметившему
  const target0 = resolveActor(targets[0]?.tokenUuid ?? targets[0]?.actorUuid);
  if (target0) parts.push(...invisibleOpponentPart(target0));
  // Школа Улитки: схватить или удержать покрытого слизью ведьмака — −3
  if (target0 && isSnail(target0) && GRAB_ATTACKS.includes(cfg.attackType)) parts.push({ label: "Слизь Улитки: выскальзывает", value: -3 });
  if (usesArm(src, cfg.attackType)) parts.push(...armWoundParts(actor));

  // Дополнительное действие атаки: 3 Вын, −3 (стр. 151)
  const notes = ammoNote ? [ammoNote] : [];
  if (weapon.ammo?.note) notes.push(weapon.ammo.note);
  if (cfg.extraAction) {
    parts.push({ label: "Доп. действие", value: -3 });
    const sta = actor.system.sta.value;
    if (sta < 3) notes.push("Не хватает Вын на дополнительное действие.");
    await actor.update({ "system.sta.value": Math.max(0, sta - 3) });
    notes.push("Потрачено 3 Вын на дополнительное действие.");
  }
  if (cfg.mod) parts.push({ label: "Модификатор", value: cfg.mod });

  // Высасывание крови: заявка до укуса, d10 — срывается только на критическом провале (1); в Истинной форме — без проверки
  let drain = null;
  if (cfg.drain && drainOption(actor, src)) {
    const free = inTrueForm(actor);
    const r = free ? null : await new Roll("1d10").evaluate();
    drain = { mode: cfg.drain, ok: free || r.total > 1, roll: r?.total ?? null };
    notes.push(free ? "Высасывание крови (Истинная форма, без проверки): при уроне +2d6."
      : drain.ok ? `Высасывание крови: d10 = ${r.total} — при уроне укусом +2d6.` : "Высасывание крови: d10 = 1 — сорвалось.");
  }

  const roll = await performCheck({ actor, title: src.label, parts, luck: cfg.luck, toChat: false });
  // Атака тратит прицеливание, даже если его не отметили
  await clearAim(actor);

  // Урон и эффекты вида атаки
  const unarmed = src.kind === "unarmed" || src.kind === "prosthetic";
  // Модификации протеза — строкой; «Лёгкое покрытие» без Надёжности: протез отпадает после удара
  if (src.kind === "prosthetic") {
    if (src.weapon.mods?.length) notes.push(`Модификации: ${src.weapon.mods.join(", ")}.`);
    if (src.fallsOff && typeCfg.damage) {
      await src.item.update({ "system.equipped": false });
      notes.push(`${src.item.name}: без Надёжности протез отпадает после удара — снят.`);
    }
  }
  let damageFormula = src.weapon.damage;
  let damageMult = typeCfg.damage ?? 1;
  let nonLethal = !!(typeCfg.nonLethal || weapon.nonLethal);
  if (unarmed) {
    damageFormula = typeCfg.damage === "kick" ? src.weapon.kick : typeCfg.damage === "punch" ? src.weapon.punch : "";
    damageMult = typeCfg.mult ?? 1;
    nonLethal = typeCfg.nonLethal ?? true;
  }
  const noDamage = unarmed ? !typeCfg.damage : !damageMult;
  // Эликсиры, мутагены и реликвии: +N к урону физическими атаками (стр. 247)
  const damageBonus = actor.system.derived?.damageBonus ?? 0;
  if (!noDamage && damageFormula && damageBonus && !src.weapon.ram) {
    damageFormula = `${damageFormula} ${damageBonus > 0 ? "+" : "-"} ${Math.abs(damageBonus)}`;
  }
  // Ручная правка урона из окна атаки — отдельно от формулы: прибавляется после множителя сильной атаки,
  // как и написано в окне («2d6+2 ×2 + 2»)
  const damageMod = !noDamage && damageFormula ? cfg.damageMod ?? 0 : 0;
  if (damageMod) notes.push(`Правка урона: ${damageMod > 0 ? "+" : "−"}${Math.abs(damageMod)}.`);

  // Разбег верхом или таран: (метры/2, максимум 5; галоп — 5)d6 × модификатор веса цели (стр. 171).
  // Это дополнительный урон к урону оружия: сильная атака его не удваивает
  const chargeDice = cfg.gallop ? 5 : Math.min(5, Math.floor((cfg.chargeMeters ?? 0) / 2));
  const weightMult = WEIGHT_MODS[cfg.weight]?.mult ?? 1;
  const chargeFormula = chargeDice && !noDamage && damageFormula
    ? (weightMult === 1 ? `${chargeDice}d6` : `floor(${chargeDice}d6 * ${weightMult})`) : "";

  const fumbleKind = unarmed ? "unarmed" : src.isRanged ? "ranged" : "melee";
  // Обычная невидимость чудовища спадает, когда оно атакует, — но эта атака сделана из невидимости: защита от неё
  // ещё с −3 (защиту бросают после карточки, когда статус уже снят, поэтому признак едет в данных атаки)
  const inv = monsterInvisibility(actor);
  const unveil = inv?.kind === "basic";
  const data = {
    kind: "attack",
    attacker: { actorUuid: actor.uuid, tokenUuid: actor.token?.uuid ?? actorToken(actor)?.document.uuid ?? null, name: actor.name },
    source: { kind: src.kind, itemId: src.item?.id ?? null, key: src.kind === "ram" ? src.key : undefined },
    label: src.label, img: src.img,
    weapon,
    skill: skillKey,
    attackType: cfg.attackType, typeLabel: typeCfg.label, typeHint: typeCfg.hint ?? "",
    aim: cfg.aim, aimLabel,
    band: cfg.band ?? "", bandLabel: src.isRanged ? RANGE_BANDS[cfg.band]?.label ?? "" : "",
    isRanged: src.isRanged,
    damageFormula, damageMult, damageMod, chargeFormula, nonLethal, noDamage, drain,
    fixedLocation: typeCfg.location ?? "",
    chargeDice, weightMult, mounted: !!src.mounted || chargeDice > 0,
    hitText: typeCfg.hit ?? "", hitStatus: typeCfg.status ?? "", hitStatus2: typeCfg.status2 ?? "", stunSaveMod: typeCfg.stunSave ?? null,
    // СА — сколько обычных атак за действие; у быстрой и сильной её нет
    attackSpeed: actor.type === "monster" && cfg.attackType === "single" ? src.weapon.attackSpeed : null,
    roll,
    fumbleText: roll.fumble ? fumbleText(fumbleKind, roll.fumbleValue) : "",
    fumbleLabel: roll.fumble ? CONFIG.VEDMAK.FUMBLES[fumbleKind].label : "",
    fumble: roll.fumble ? { kind: fumbleKind, value: roll.fumbleValue, itemId: src.item?.id ?? null } : null,
    fumbleAuto: !!(roll.fumble && fumbleEffect(fumbleKind, roll.fumbleValue)),
    targets,
    notes,
    attackerUnseen: unveil && !inv.revealed,
    config: cfg
  };

  if (unveil) notes.push(`${actor.name} атакует и становится видимым.`);
  const card = await postCard({
    template: "systems/vedmak/templates/chat/attack.hbs",
    data: { ...data, hasTargets: targets.length > 0 },
    actor, flags: { attack: data }, rolls: roll.rolls ?? [], messageMode: cfg.messageMode
  });
  if (unveil) await dropInvisibility(actor, "attack");
  return card;
}

/** Повторить атаку с теми же настройками (вторая быстрая атака, СА чудовища). */
export async function repeatAttack(message) {
  const data = message.flags.vedmak?.attack;
  const actor = resolveActor(data?.attacker.tokenUuid) ?? resolveActor(data?.attacker.actorUuid);
  if (!actor?.isOwner) return ui.notifications.warn("Повторить атаку может только её владелец.");
  const src = describeSource(actor, data.source);
  if (!src) return null;
  // Как и первая атака — только тем, что в руках (оружие могли убрать между атаками)
  if ((src.kind === "weapon" || src.kind === "shield") && !(src.kind === "shield" ? src.item?.system.equipped : isReadyWeapon(actor, src.item))) {
    return ui.notifications.warn(`«${src.item?.name ?? src.label}» не в руках — наденьте на вкладке «Снаряжение», тогда можно атаковать.`);
  }
  return rollAttack(actor, src, data.targets, { ...data.config, extraAction: false, luck: 0 });
}
