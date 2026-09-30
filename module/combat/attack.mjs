// Атака: выбор оружия и вида атаки, бросок, карточка с кнопками защиты целей (стр. 151–164).

import { SKILLS } from "../config/skills.mjs";
import { punchSteps } from "../config/stats.mjs";
import {
  ATTACK_TYPES, UNARMED_ATTACKS, ATTACK_SITUATIONS, RANGE_BANDS, LOCATIONS_HUMANOID, LOCATIONS_MONSTER, MOUNTS, WEIGHT_MODS,
  fumbleText
} from "../config/combat.mjs";
import { performCheck } from "../dice/check.mjs";
import { bindDialog, commonFields, foldState, readCommon } from "../dice/dialog-ui.mjs";
import { renderTemplate } from "../util.mjs";
import { statusRollMods } from "./statuses.mjs";
import {
  currentTargets, actorToken, tokenDistance, resolveActor, postCard
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

  if (source.kind === "unarmed") {
    return {
      kind: "unarmed", key: "unarmed", label: "Без оружия", img: "icons/skills/melee/unarmed-punch-fist.webp",
      skill: "brawling", accuracy: 0, isRanged: false,
      types: UNARMED_ATTACKS, defaultType: "punch",
      weapon: { name: "Без оружия", damageTypes: ["bludgeoning"], effects: [], nonLethal: true, unarmed: true,
        punch: d.punch, kick: d.kick }
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
  if (isMonster) types = pick(ATTACK_TYPES, w.isRanged || w.category === "natural" ? ["single"] : ["single", "pommel", "disarm", "trip"]);
  else if (w.isCrossbow) types = pick(ATTACK_TYPES, ["single"]);
  else if (w.isBow) types = pick(ATTACK_TYPES, ["single", "strong"]);
  else if (w.isThrown) types = pick(ATTACK_TYPES, ["fast", "strong"]);
  else types = pick(ATTACK_TYPES, ["fast", "strong", "charge", "pommel", "disarm", "trip", "feint", "dual"]);

  // Урон: рукопашное оружие добавляет удар рукой; оружие ближнего боя — бонус урона по Тел (стр. 48, 72)
  let damage = w.damage || "0";
  if (w.effect("hands")) damage = `${damage} + ${d.punch}`;
  else if (!w.isRanged && d.meleeBonus) damage = `${damage} ${d.meleeBonus > 0 ? "+" : "-"} ${Math.abs(d.meleeBonus)}`;

  return {
    kind: "weapon", key: item.id, label: item.name, img: item.img, item,
    skill: w.skill, accuracy: w.accuracy, isRanged: w.isRanged,
    types, defaultType: Object.keys(types)[0],
    weapon: {
      id: item.id, name: item.name, img: item.img, damage, rawDamage: w.damage,
      oil: w.activeOil ? { name: w.oil.name, target: w.oil.target } : null,
      damageTypes: w.damageTypes.length ? [...w.damageTypes] : ["bludgeoning"],
      silverDamage: w.silverDamage, effects: w.effects.map(e => ({ ...e })),
      isRanged: w.isRanged, isThrown: w.isThrown, isBow: w.isBow, isCrossbow: w.isCrossbow,
      range: w.rangeMeters(actor.system.stats.body.raw), attackSpeed: w.attackSpeed,
      nonLethal: !!w.effect("nonLethal"), category: w.category
    }
  };
}

function pick(map, keys) {
  return Object.fromEntries(keys.filter(k => map[k]).map(k => [k, map[k]]));
}

/** Все доступные источники атак актора (для листа). */
export function attackSources(actor) {
  const out = [];
  const weapons = actor.itemTypes.weapon.slice().sort((a, b) => (b.system.equipped - a.system.equipped) || (a.sort - b.sort));
  for (const w of weapons) out.push(describeSource(actor, { kind: "weapon", itemId: w.id }));
  for (const s of actor.itemTypes.armor.filter(i => i.system.isShield && i.system.equipped)) {
    out.push(describeSource(actor, { kind: "shield", itemId: s.id }));
  }
  out.push(describeSource(actor, { kind: "unarmed" }));
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
  const targets = opts.targets ?? currentTargets();
  let cfg = {
    attackType: opts.attackType ?? src.defaultType, aim: opts.aim ?? "", band: opts.band,
    chargeMeters: opts.chargeMeters ?? 0, gallop: !!opts.gallop, weight: opts.weight ?? "light",
    situations: opts.situations ?? [], extraAction: !!opts.extraAction, mod: opts.mod ?? 0,
    damageMod: opts.damageMod ?? 0, luck: opts.luck ?? 0,
    messageMode: opts.messageMode
  };

  const suggested = suggestBand(actor, src, targets);
  cfg.band ??= suggested.band === "beyond" ? "extreme" : suggested.band;

  if (!opts.skipDialog) {
    cfg = await attackDialog(actor, src, targets, cfg, suggested);
    if (!cfg) return null;
  }
  return rollAttack(actor, src, targets, cfg);
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
  for (const m of statusRollMods(actor, "attack")) base += Number(m.value) || 0;
  return Math.max(0, base);
}

/** Формула урона вида атаки для показа в окне: то же, что уйдёт в карточку. */
function previewDamage(actor, src, typeKey) {
  const typeCfg = src.types[typeKey] ?? Object.values(src.types)[0];
  const unarmed = src.kind === "unarmed";
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

  const school = actor.type === "character" ? actor.system.details?.school : "";
  const types = Object.entries(src.types).map(([key, t]) => {
    const waived = (school === "wolf" && key === "strong") || (school === "viper" && key === "dual");
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
  const locations = [{ key: "", label: "Случайно", note: "d10", mod: 0, selected: !cfg.aim }].concat(
    Object.entries(locList).map(([key, l]) => ({ key, label: l.label, note: String(l.penalty), mod: l.penalty, selected: key === cfg.aim }))
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
    statusMods: statusRollMods(actor, "attack"),
    weights: Object.entries(WEIGHT_MODS).map(([key, w]) => ({ key, label: w.label, selected: key === cfg.weight })),
    staCost: actor.type === "character",
    isMonster: actor.type === "monster",
    total: { base: current.base, damage: current.damage },
    ...commonFields({ luckMax: actor.system.luck?.value ?? 0, mod: cfg.mod, damage: current.damage, damageMod: cfg.damageMod })
  });

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `Атака: ${src.label}`, icon: "fa-solid fa-khanda" },
    classes: ["vedmak", "vedmak-dialog", "check-dialog", "attack-dialog"],
    position: { width: 560 },
    content,
    render: (event, dialog) => bindDialog(dialog),
    buttons: [{
      action: "attack", label: "Атаковать", icon: "fa-solid fa-khanda", default: true,
      callback: (event, button) => {
        const f = button.form.elements;
        return {
          ...readCommon(f, actor.system.luck?.value ?? 0),
          attackType: f.attackType.value,
          aim: f.aim.value,
          band: f.band?.value ?? "",
          situations: Object.keys(ATTACK_SITUATIONS).filter(k => f[`sit.${k}`]?.checked),
          extraAction: !!f.extraAction?.checked,
          chargeMeters: Number(f.chargeMeters?.value) || 0,
          gallop: !!f.gallop?.checked,
          weight: f.weight?.value ?? "light"
        };
      }
    }, { action: "cancel", label: "Отмена", icon: "fa-solid fa-xmark" }],
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
 * @returns {Promise<string|null|false>} строка для карточки; false — стрелять нечем
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
  return `Боеприпас: ${ammo.name} (осталось ${left}).${left ? "" : " Последний!"}`;
}

export async function rollAttack(actor, src, targets, cfg) {
  const ammoNote = await spendAmmo(actor, src);
  if (ammoNote === false) return null;
  const typeCfg = src.types[cfg.attackType] ?? Object.values(src.types)[0];
  const skillKey = typeCfg.skill ?? src.skill;
  const skill = actor.system.skills[skillKey];
  const stat = actor.system.stats[SKILLS[skillKey].stat];

  const parts = [
    { label: stat.label, value: stat.effective, always: true },
    { label: skill.label, value: skill.total, always: true }
  ];
  const sum = stat.effective + skill.total + skill.penalty;
  if (skill.penalty) parts.push({ label: "Ранения и СД", value: skill.penalty });
  if (skill.base !== Math.max(0, sum)) parts.push({ label: "Ранения (множитель)", value: skill.base - sum });
  if (src.accuracy && !typeCfg.skill) parts.push({ label: "Точность", value: src.accuracy });
  const school = actor.type === "character" ? actor.system.details?.school : "";
  const waived = (school === "wolf" && cfg.attackType === "strong") || (school === "viper" && cfg.attackType === "dual");
  if (typeCfg.mod && waived) parts.push({ label: `${typeCfg.label}: школа ${school === "wolf" ? "Волка" : "Змеи"} без штрафа`, value: 0, always: true });
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

  // Дополнительное действие атаки: 3 Вын, −3 (стр. 151)
  const notes = ammoNote ? [ammoNote] : [];
  if (cfg.extraAction) {
    parts.push({ label: "Доп. действие", value: -3 });
    const sta = actor.system.sta.value;
    if (sta < 3) notes.push("Не хватает Вын на дополнительное действие.");
    await actor.update({ "system.sta.value": Math.max(0, sta - 3) });
    notes.push("Потрачено 3 Вын на дополнительное действие.");
  }
  if (cfg.mod) parts.push({ label: "Модификатор", value: cfg.mod });

  const roll = await performCheck({ actor, title: src.label, parts, luck: cfg.luck, toChat: false });

  // Урон и эффекты вида атаки
  const unarmed = src.kind === "unarmed";
  let damageFormula = src.weapon.damage;
  let damageMult = typeCfg.damage ?? 1;
  let nonLethal = !!(typeCfg.nonLethal || src.weapon.nonLethal);
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
  // Ручная правка урона из окна атаки
  if (!noDamage && damageFormula && cfg.damageMod) {
    damageFormula = `${damageFormula} ${cfg.damageMod > 0 ? "+" : "-"} ${Math.abs(cfg.damageMod)}`;
    notes.push(`Правка урона: ${cfg.damageMod > 0 ? "+" : "−"}${Math.abs(cfg.damageMod)}.`);
  }

  // Разбег верхом или таран: (метры/2, максимум 5; галоп — 5)d6 × модификатор веса цели (стр. 171)
  const chargeDice = cfg.gallop ? 5 : Math.min(5, Math.floor((cfg.chargeMeters ?? 0) / 2));
  const weightMult = WEIGHT_MODS[cfg.weight]?.mult ?? 1;
  if (chargeDice && !noDamage && damageFormula) {
    damageFormula = weightMult === 1 ? `${damageFormula} + ${chargeDice}d6` : `${damageFormula} + floor(${chargeDice}d6 * ${weightMult})`;
  }

  const fumbleKind = unarmed ? "unarmed" : src.isRanged ? "ranged" : "melee";
  const data = {
    kind: "attack",
    attacker: { actorUuid: actor.uuid, tokenUuid: actor.token?.uuid ?? actorToken(actor)?.document.uuid ?? null, name: actor.name },
    source: { kind: src.kind, itemId: src.item?.id ?? null },
    label: src.label, img: src.img,
    weapon: src.weapon,
    skill: skillKey,
    attackType: cfg.attackType, typeLabel: typeCfg.label, typeHint: typeCfg.hint ?? "",
    aim: cfg.aim, aimLabel,
    band: cfg.band ?? "", bandLabel: src.isRanged ? RANGE_BANDS[cfg.band]?.label ?? "" : "",
    isRanged: src.isRanged,
    damageFormula, damageMult, nonLethal, noDamage,
    fixedLocation: typeCfg.location ?? "",
    chargeDice, weightMult, mounted: !!src.mounted || chargeDice > 0,
    hitText: typeCfg.hit ?? "", hitStatus: typeCfg.status ?? "", stunSaveMod: typeCfg.stunSave ?? null,
    attackSpeed: actor.type === "monster" ? src.weapon.attackSpeed : null,
    roll,
    fumbleText: roll.fumble ? fumbleText(fumbleKind, roll.fumbleValue) : "",
    fumbleLabel: roll.fumble ? CONFIG.VEDMAK.FUMBLES[fumbleKind].label : "",
    targets,
    notes,
    config: cfg
  };

  return postCard({
    template: "systems/vedmak/templates/chat/attack.hbs",
    data: { ...data, hasTargets: targets.length > 0 },
    actor, flags: { attack: data }, rolls: roll.rolls ?? [], messageMode: cfg.messageMode
  });
}

/** Повторить атаку с теми же настройками (вторая быстрая атака, СА чудовища). */
export async function repeatAttack(message) {
  const data = message.flags.vedmak?.attack;
  const actor = resolveActor(data?.attacker.tokenUuid) ?? resolveActor(data?.attacker.actorUuid);
  if (!actor?.isOwner) return ui.notifications.warn("Повторить атаку может только её владелец.");
  const src = describeSource(actor, data.source);
  if (!src) return null;
  return rollAttack(actor, src, data.targets, { ...data.config, extraAction: false, luck: 0 });
}
