// Сотворение магии: Энергия и перегрузка, фокус, места силы и двимерит, провалы, поддержание,
// щиты и карточка, совместимая с боевыми защитами (стр. 99–123, 166–168).

import { SKILLS } from "../config/skills.mjs";
import {
  SPELL_DEFENSES, MAGIC_SKILL, ELEMENTAL_FUMBLE, magicFumble, targetingFor, levelLabel
} from "../config/magic.mjs";
import { performCheck } from "../dice/check.mjs";
import { bindDialog, commonFields, readCommon } from "../dice/dialog-ui.mjs";
import { renderTemplate } from "../util.mjs";
import { statusRollMods } from "../combat/statuses.mjs";
import { currentTargets, actorToken, combatantFor, postCard, targetInfo } from "../combat/common.mjs";
import { parseArea, parseZoneDuration, zonesAvailable, placeZone, createZone, zoneTokens, removeZones } from "../combat/zones.mjs";

/** Сколько Энергии уже израсходовано в текущем раунде боя. */
export function vigorUsed(actor) {
  const combatant = combatantFor(actor);
  if (!combatant) return { combatant: null, used: 0 };
  const flag = combatant.getFlag("vedmak", "vigor") ?? {};
  return { combatant, used: flag.round === game.combat.round ? flag.used ?? 0 : 0 };
}

export async function addVigorUsed(actor, amount) {
  const { combatant, used } = vigorUsed(actor);
  if (combatant && amount) await combatant.setFlag("vedmak", "vigor", { round: game.combat.round, used: used + amount });
}

/** Поддерживаемые заклинания актора (эффекты с флагом maintain). */
export function maintainedSpells(actor) {
  return actor.effects.filter(e => e.flags?.vedmak?.maintain);
}

/** Подставить @sta в формулу; @margin остаётся до броска урона. */
function resolveSta(formula, sta) {
  return String(formula ?? "").replaceAll("@sta", String(sta));
}

/** Шанс статуса: число или формула с @sta. */
function resolveChance(chance, sta) {
  try {
    const expr = Roll.replaceFormulaData(String(chance ?? "100"), { sta });
    return Math.max(0, Math.min(100, Math.round(Roll.safeEval(expr))));
  } catch {
    return 100;
  }
}

/**
 * Сотворить заклинание, инвокацию, знак, ритуал или порчу.
 * @param {Actor} actor
 * @param {Item} item — предмет типа spell
 * @param {object} [opts] — {skipDialog, cost, targets, ...}
 */
export async function castSpell(actor, item, opts = {}) {
  const s = item.system;
  const d = actor.system.derived;
  let targets = opts.targets ?? currentTargets();
  const skillKey = MAGIC_SKILL[s.kind] ?? "spellCasting";

  if (!d.vigor && actor.type === "character") {
    ui.notifications.warn(`${actor.name}: Энергия 0 — магия недоступна (стр. 123).`);
    return null;
  }

  let cfg = {
    cost: opts.cost ?? (s.variableCost ? Math.min(s.maxCost || 7, Math.max(1, d.vigor)) : s.staCost),
    useFocus: d.focus > 0,
    placeOfPower: false,
    dimeritium: 0,
    dc: opts.dc ?? (s.dc || ""),
    helpers: 0,
    mod: opts.mod ?? 0,
    damageMod: opts.damageMod ?? 0,
    luck: 0,
    messageMode: opts.messageMode
  };
  if (!opts.skipDialog) {
    cfg = await castDialog(actor, item, cfg, targets);
    if (!cfg) return null;
  }

  // Зона на сцене: конус или круг ставится мышью, цели — все, кто в неё попал; отмена — отмена сотворения
  const area = opts.targets ? null : parseArea(s.range);
  let region = null;
  const placed = area && zonesAvailable() ? await placeZone(area, { name: item.name }) : null;
  if (placed?.cancelled) return null;
  if (placed?.shape) {
    const duration = await parseZoneDuration(s.duration, { cost: cfg.cost });
    region = await createZone(placed.shape, { name: item.name, actor, itemName: item.name, duration, maintainItemId: item.id });
    targets = zoneTokens(placed.shape, { region, exclude: actorToken(actor) }).map(targetInfo);
  }

  const message = await performCast(actor, item, cfg, targets);
  // Заклинание не сработало — зона не нужна
  if (region && !message?.flags?.vedmak?.cast?.works) await removeZones([region]);
  return message;
}

/** Основа проверки сотворения: Воля + навык магии со всеми постоянными правками. */
function castBase(actor, skillKey) {
  const skill = actor.system.skills[skillKey];
  const will = actor.system.stats.will;
  const sum = will.effective + skill.total + skill.penalty;
  let base = sum;
  if (skill.base !== Math.max(0, sum)) base += skill.base - sum;
  for (const m of statusRollMods(actor, "skill", { skill: skillKey })) base += Number(m.value) || 0;
  return Math.max(0, base);
}

/** Что даёт вложенная Выносливость: урон и шансы статусов. */
function costNote(s, cost) {
  const a = s.automation;
  const bits = [];
  const damage = resolveSta(a.damage, cost);
  if (damage) bits.push(`урон ${damage}`);
  const staDamage = resolveSta(a.staDamage, cost);
  if (staDamage) bits.push(`Вын цели ${staDamage}`);
  for (const st of a.statuses.filter(x => x.status)) {
    const chance = resolveChance(st.chance, cost);
    bits.push(`${CONFIG.statusEffects.find(e => e.id === st.status)?.name ?? st.status}${chance < 100 ? ` ${chance}%` : ""}`);
  }
  return bits.join(" · ");
}

async function castDialog(actor, item, cfg, targets) {
  const s = item.system;
  const d = actor.system.derived;
  const { used } = vigorUsed(actor);
  const maintained = maintainedSpells(actor);
  const skillKey = MAGIC_SKILL[s.kind] ?? "spellCasting";
  const base = castBase(actor, skillKey);
  const maxCost = s.maxCost || 7;
  const costDots = s.variableCost && maxCost <= 12
    ? Array.from({ length: maxCost }, (_, i) => ({
        value: i + 1, selected: i + 1 === cfg.cost, on: i + 1 <= cfg.cost,
        damage: resolveSta(s.automation.damage, i + 1), note: costNote(s, i + 1)
      }))
    : [];
  const damage = resolveSta(s.automation.damage, cfg.cost);

  const content = await renderTemplate("systems/vedmak/templates/dialog/cast.hbs", {
    item, s, cfg, targets,
    head: {
      title: item.name, img: item.img, base, baseHint: `Воля + ${SKILLS[skillKey].label}`,
      subtitle: [CONFIG.VEDMAK.MAGIC_KINDS[s.kind], levelLabel(s.kind, s.level),
        s.kind === "spell" || s.kind === "sign" ? CONFIG.VEDMAK.MAGIC_ELEMENTS[s.element] : "",
        s.god, s.range, s.duration].filter(Boolean).join(" · ")
    },
    kindLabel: CONFIG.VEDMAK.MAGIC_KINDS[s.kind], levelLabel: levelLabel(s.kind, s.level),
    isRitual: s.kind === "ritual", isHex: s.kind === "hex",
    maxCost, costDots, costNote: costNote(s, cfg.cost),
    vigor: d.vigor, used, focus: d.focus, focusItem: d.focusItem,
    sta: actor.system.sta.value,
    maintained: maintained.map(e => e.name),
    total: { base, damage },
    ...commonFields({ luckMax: actor.system.luck?.value ?? 0, mod: cfg.mod, damage, damageMod: cfg.damageMod })
  });

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `${CONFIG.VEDMAK.MAGIC_KINDS[s.kind]}: ${item.name}`, icon: "fa-solid fa-hand-sparkles" },
    classes: ["vedmak", "vedmak-dialog", "check-dialog", "cast-dialog"],
    position: { width: 520 },
    content,
    render: (event, dialog) => bindDialog(dialog, { extra: form => {
      const f = form.elements;
      const cost = s.variableCost ? Math.max(1, Number(f.cost?.value) || 1) : s.staCost;
      const focus = f.useFocus?.checked ? d.focus : 0;
      const paid = focus ? Math.max(1, cost - focus) : cost;
      const vigor = Math.max(0, d.vigor + (f.placeOfPower?.checked ? 5 : 0) - (Number(f.dimeritium?.value) || 0));
      const spent = used + paid;
      const over = Math.max(0, spent - vigor);
      const scale = Math.max(vigor, spent) || 1;

      const box = dialog.element.querySelector("[data-energy]");
      if (box) {
        box.querySelector("[data-energy-text]").textContent =
          `${spent} из ${vigor}${over ? ` — перегрузка на ${over}` : ""} · Вын: ${paid} (есть ${actor.system.sta.value})`;
        box.querySelector("[data-energy-fill]").style.width = `${Math.min(spent, vigor) / scale * 100}%`;
        box.querySelector("[data-energy-over]").style.width = `${over / scale * 100}%`;
        const warn = box.querySelector("[data-energy-warn]");
        warn.textContent = over ? `−${over * 5} ПЗ и стихийный откат за перебор`
          : actor.system.sta.value < paid ? `Не хватает Вын: нужно ${paid}` : "";
        box.classList.toggle("is-over", !!over || actor.system.sta.value < paid);
      }
      const value = dialog.element.querySelector("[data-cost-value]");
      if (value) value.textContent = String(cost);
      const note = dialog.element.querySelector("[data-cost-note]");
      const picked = form.querySelector(`[name="cost"]:checked`);
      if (note && picked) note.textContent = picked.dataset.note ?? "";
    } }),
    buttons: [{
      action: "cast", label: s.kind === "ritual" ? "Провести" : s.kind === "hex" ? "Навести" : "Сотворить",
      icon: "fa-solid fa-hand-sparkles", default: true,
      callback: (event, button) => {
        const f = button.form.elements;
        return {
          ...readCommon(f, actor.system.luck?.value ?? 0),
          cost: s.variableCost ? Math.max(1, Math.min(s.maxCost || 99, Number(f.cost.value) || 1)) : s.staCost,
          useFocus: !!f.useFocus?.checked,
          placeOfPower: !!f.placeOfPower?.checked,
          dimeritium: Math.max(0, Number(f.dimeritium?.value) || 0),
          dc: f.dc?.value ?? cfg.dc,
          helpers: Math.max(0, Math.min(4, Number(f.helpers?.value) || 0))
        };
      }
    }, { action: "cancel", label: "Отмена", icon: "fa-solid fa-xmark" }],
    rejectClose: false
  });
  return result === "cancel" ? null : result;
}

/** Бросок, оплата, провал, эффекты на себя и карточка. */
export async function performCast(actor, item, cfg, targets) {
  const s = item.system;
  const a = s.automation;
  const d = actor.system.derived;
  const skillKey = MAGIC_SKILL[s.kind] ?? "spellCasting";
  const skill = actor.system.skills[skillKey];
  const will = actor.system.stats.will;
  const notes = [];
  const selfLines = [];

  // Затраты и перегрузка
  const cost = cfg.cost;
  const focus = cfg.useFocus ? d.focus : 0;
  const paid = focus ? Math.max(1, cost - focus) : cost;
  const vigor = Math.max(0, d.vigor + (cfg.placeOfPower ? 5 : 0) - (cfg.dimeritium || 0));
  const { used } = vigorUsed(actor);
  const overload = Math.max(0, used + paid - vigor);
  if (actor.system.sta.value < paid) {
    ui.notifications.warn(`${actor.name}: не хватает Вын (${actor.system.sta.value} из ${paid}).`);
    return null;
  }
  const staAfter = actor.system.sta.value - paid;
  const update = { "system.sta.value": staAfter };
  if (overload) update["system.hp.value"] = actor.system.hp.value - overload * 5;
  await actor.update(update);
  await addVigorUsed(actor, paid);
  if (focus) notes.push(`Фокус «${d.focusItem}»: −${focus} к затратам.`);
  if (overload) selfLines.push(`Перегрузка на ${overload}: −${overload * 5} ПЗ.`);

  // Проверка: Воля + навык магии
  const parts = [
    { label: will.label, value: will.effective, always: true },
    { label: SKILLS[skillKey].label, value: skill.total, always: true }
  ];
  const sum = will.effective + skill.total + skill.penalty;
  if (skill.penalty) parts.push({ label: "Ранения и скованность", value: skill.penalty });
  if (skill.base !== Math.max(0, sum)) parts.push({ label: "Ранения (множитель)", value: skill.base - sum });
  if (cfg.placeOfPower) parts.push({ label: "Место силы", value: 2 });
  parts.push(...statusRollMods(actor, "skill", { skill: skillKey }));
  if (cfg.mod) parts.push({ label: "Модификатор", value: cfg.mod });

  let dc = cfg.dc === "" || cfg.dc === null || cfg.dc === undefined ? null : Number(cfg.dc);
  if (dc !== null && cfg.helpers) {
    dc = Math.max(0, dc - cfg.helpers);
    notes.push(`Помощники ритуала: СЛ −${cfg.helpers}.`);
  }
  const roll = await performCheck({ actor, title: item.name, parts, dc, luck: cfg.luck, toChat: false });

  // Провал
  let works = dc === null ? true : roll.success;
  let fumble = null;
  const element = s.kind === "invocation" ? "mixed" : (s.element || "mixed");
  if (roll.fumble) {
    if (s.kind === "ritual") {
      works = false;
      fumble = { text: `Критический провал ритуала: ${paid} урона (1 за каждое очко Вын).`, damage: paid };
    } else if (s.kind === "hex") {
      works = false;
      const r = await new Roll("1d100").evaluate();
      fumble = { text: r.total <= 50 ? `Порча обращается на заклинателя (d100 = ${r.total}).` : `Порча не срабатывает (d100 = ${r.total}).`, backfire: r.total <= 50, damage: 0 };
    } else {
      const f = magicFumble(roll.fumbleValue);
      works = works && f.works;
      fumble = { text: f.text, damage: roll.fumbleValue, elemental: f.elemental, focusExplodes: f.focusExplodes };
    }
  }

  // Последствия для заклинателя: урон провала, стихийный эффект провала или перегрузки
  const hpLoss = fumble?.damage ?? 0;
  if (hpLoss) {
    await actor.update({ "system.hp.value": actor.system.hp.value - hpLoss });
    selfLines.push(`Провал: −${hpLoss} ПЗ.`);
  }
  if ((fumble?.elemental || overload) && s.kind !== "ritual" && s.kind !== "hex") {
    const eff = ELEMENTAL_FUMBLE[element] ?? ELEMENTAL_FUMBLE.mixed;
    selfLines.push(`Стихийный эффект (${eff.label.toLowerCase()}): ${eff.text}`);
    if (eff.status) await actor.toggleStatusEffect(eff.status, { active: true });
  }
  if (fumble?.focusExplodes && focus) selfLines.push(`«${d.focusItem}» взрывается: 1d10 урона всем в радиусе 2 м.`);
  if (fumble?.backfire) {
    await applyHex(actor, item);
    selfLines.push(`На заклинателя наложена порча «${item.name}».`);
  }
  if (staAfter <= 0) {
    await actor.toggleStatusEffect("disoriented", { active: true });
    selfLines.push("Вын исчерпана: дезориентация, испытание Уст и отдых до 20 Вын.");
  }

  // Эффекты на себя при успехе
  if (works) {
    if (a.shieldPerSta) {
      const value = a.shieldPerSta * cost;
      await actor.update({ "system.shield.value": value, "system.shield.max": value });
      await setTimedEffect(actor, { name: `Щит: ${item.name}`, img: item.img, key: "shield", rounds: a.shieldRounds || 0 });
      selfLines.push(`${item.name}: щит ${value} ПЗ${a.shieldRounds ? ` на ${a.shieldRounds} раундов` : ""}.`);
    }
    const maintain = s.maintainFor(cost);
    if (maintain > 0) {
      await actor.createEmbeddedDocuments("ActiveEffect", [{
        name: `Поддержание: ${item.name}`, img: item.img, transfer: false,
        description: `Каждый раунд ${maintain} Вын. Пока поддерживается, нельзя творить другие заклинания.`,
        flags: { vedmak: { maintain: { cost: maintain, itemId: item.id, shield: !!a.shieldPerSta } } }
      }]);
      selfLines.push(`Поддержание: ${maintain} Вын за раунд.`);
    }
    if (s.kind === "ritual" && a.regen.hp && !targets.length) {
      await applyRegen(actor, { hp: a.regen.hp, rounds: a.regen.rounds, name: item.name, img: item.img });
      selfLines.push(`${item.name}: +${a.regen.hp} ПЗ за ход.`);
    }
  }

  // Урон по целям с учётом ручной правки из окна
  let damageFormula = resolveSta(a.damage, cost);
  if (damageFormula && cfg.damageMod) {
    damageFormula = `${damageFormula} ${cfg.damageMod > 0 ? "+" : "-"} ${Math.abs(cfg.damageMod)}`;
    notes.push(`Правка урона: ${cfg.damageMod > 0 ? "+" : "−"}${Math.abs(cfg.damageMod)}.`);
  }

  // Эффект по целям
  const targeting = targetingFor(s.range);
  const statusesByCost = Object.entries(a.statusesByCost ?? {})
    .map(([c, st]) => [Number(c), st]).sort((x, y) => y[0] - x[0]).find(([c]) => cost >= c)?.[1];
  const spellData = {
    itemId: item.id, kind: s.kind, element, cost, paid, defense: s.defense,
    defenses: SPELL_DEFENSES[s.defense]?.defenses ?? ["auto"],
    canCrit: a.canCrit, ignoreArmor: a.ignoreArmor, staDamage: resolveSta(a.staDamage, cost),
    statuses: [
      ...a.statuses.filter(x => x.status).map(x => ({ status: x.status, chance: resolveChance(x.chance, cost) })),
      ...(statusesByCost ? [{ status: statusesByCost, chance: 100 }] : [])
    ],
    statusRounds: a.statusRounds,
    regen: a.regen.hp ? { hp: a.regen.hp, rounds: a.regen.rounds } : null,
    hex: s.kind === "hex",
    allLocations: a.location === "all",
    works, targeting
  };
  const hasTargetEffect = !!(a.damage || spellData.staDamage || spellData.statuses.length || spellData.regen || spellData.hex);
  const showTargets = works && targeting !== "self" && (hasTargetEffect || s.defense !== "none");

  const data = {
    kind: "attack",
    attacker: { actorUuid: actor.uuid, tokenUuid: actor.token?.uuid ?? actorToken(actor)?.document.uuid ?? null, name: actor.name },
    source: { kind: "spell", itemId: item.id },
    label: item.name, img: item.img,
    weapon: { name: item.name, damageTypes: [a.damageType || "elemental"], effects: [], silverDamage: "", isRanged: true, spell: true },
    skill: skillKey,
    attackType: "spell", typeLabel: CONFIG.VEDMAK.MAGIC_KINDS[s.kind], typeHint: "",
    aim: "", aimLabel: "", band: "", bandLabel: "",
    isRanged: true,
    damageFormula, damageMult: 1, nonLethal: false,
    noDamage: !a.damage && !spellData.staDamage,
    fixedLocation: a.location === "torso" ? "torso" : "",
    hitText: "", hitStatus: "", stunSaveMod: null,
    roll, targets: showTargets ? targets : [],
    spell: spellData,
    notes,
    config: cfg
  };

  const card = {
    ...data,
    hasTargets: data.targets.length > 0,
    showDefense: showTargets,
    defenseButtons: spellDefenseButtons(spellData.defenses),
    kindLabel: CONFIG.VEDMAK.MAGIC_KINDS[s.kind], levelLabel: levelLabel(s.kind, s.level),
    elementLabel: s.kind === "spell" || s.kind === "sign" ? CONFIG.VEDMAK.MAGIC_ELEMENTS[s.element] : "",
    range: s.range, duration: s.duration,
    defenseLabel: s.kind === "ritual" ? "" : s.defenseText || SPELL_DEFENSES[s.defense]?.label,
    cost, paid, overload, fumble, selfLines, works, dc,
    isRitual: s.kind === "ritual", description: s.description,
    ingredients: s.kind === "ritual" ? s.ingredients : ""
  };
  return postCard({
    template: "systems/vedmak/templates/chat/cast.hbs", data: card, actor,
    flags: { attack: data, cast: { itemId: item.id, works } },
    rolls: roll.rolls ?? [], messageMode: cfg.messageMode
  });
}

/** Кнопки защиты в карточке магии; `short` — подпись под иконкой, `label` — подсказка. */
const DEFENSE_BUTTONS = {
  dodge:       { icon: "fa-person-running", label: "Уклонение", short: "Уклон" },
  reposition:  { icon: "fa-arrows-up-down-left-right", label: "Изменение позиции", short: "Позиция" },
  block:       { icon: "fa-shield-halved", label: "Блокирование щитом", short: "Щит" },
  resistMagic: { icon: "fa-brain", label: "Сопротивление магии", short: "Магия" },
  willx3:      { icon: "fa-scale-balanced", label: "Против Воли ×3", short: "Воля ×3" },
  auto:        { icon: "fa-wand-sparkles", label: "Эффект без защиты", short: "Сразу" },
  none:        { icon: "fa-bullseye", label: "Без защиты: против СЛ", short: "СЛ" }
};

export function spellDefenseButtons(keys) {
  return keys.map(key => ({ key, ...DEFENSE_BUTTONS[key] }));
}

/* -------------------------------------------------------------------------- */
/*  Эффекты с длительностью                                                    */
/* -------------------------------------------------------------------------- */

/** Эффект-метка с отсчётом раундов в начале хода (0 — без ограничения). */
export async function setTimedEffect(actor, { name, img, key, rounds = 0, extra = {} }) {
  const existing = actor.effects.find(e => e.flags?.vedmak?.timed?.key === key);
  if (existing) await existing.delete();
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name, img, transfer: false,
    flags: { vedmak: { timed: { key, rounds }, ...extra } }
  }]);
  return effect;
}

/** Регенерация: +N ПЗ в начале каждого хода, rounds — число или формула (пусто — пока поддерживается). */
export async function applyRegen(actor, { hp, rounds, name, img }) {
  let n = 0;
  if (rounds) n = Number.isFinite(Number(rounds)) ? Number(rounds) : (await new Roll(rounds).evaluate()).total;
  return setTimedEffect(actor, { name: `Регенерация: ${name}`, img, key: `regen:${name}`, rounds: n, extra: { regen: hp } });
}

/** Порча как эффект на жертве: описание и условия снятия. */
export async function applyHex(actor, item) {
  return actor.createEmbeddedDocuments("ActiveEffect", [{
    name: `Порча: ${item.name}`, img: item.img, transfer: false,
    description: item.system.description,
    flags: { vedmak: { hex: item.name } }
  }]);
}
