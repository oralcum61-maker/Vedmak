// Сотворение магии: Энергия и перегрузка, фокус, места силы и двимерит, провалы, поддержание,
// щиты и карточка, совместимая с боевыми защитами (стр. 99–123, 166–168).

import { SKILLS } from "../config/skills.mjs";
import {
  SPELL_DEFENSES, MAGIC_SKILL, ELEMENTAL_FUMBLE, magicFumble, targetingFor, levelLabel, zoneAuraFor
} from "../config/magic.mjs";
import { performCheck } from "../dice/check.mjs";
import { bindDialog, commonFields, readCommon } from "../dice/dialog-ui.mjs";
import { renderTemplate, inCombat, roundsAsTime } from "../util.mjs";
import { statusRollMods } from "../combat/statuses.mjs";
import { currentTargets, actorToken, combatantFor, postCard, targetInfo, resolveActor, asGM, registerGMHandler, userOwnsAny } from "../combat/common.mjs";
import { parseArea, parseZoneDuration, zonesAvailable, placeZone, createZone, zoneTokens, removeZones, zonesOf, pointInZone, ZONE_COLORS } from "../combat/zones.mjs";
import { spellAuto, spellAutomation } from "../config/spell-auto.mjs";
import { buffDuration, buffData, applyBuff, buffLine } from "./buffs.mjs";

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

/**
 * Потолок переменной стоимости: свой у заклинания, иначе 7 — но не ниже базовой Вын: у ступенчатых заклинаний
 * («потратив 14 Вын, вы можете…») базовая стоимость — старшая ступень, и до неё должно хватать выбора.
 */
function variableMax(s) {
  return s.maxCost || Math.max(7, s.staCost || 0);
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

  // Драконья магия «Офира и Зеррикании» (стр. 120): творится только в Драконьей форме
  if (item.flags?.vedmak?.dragonMagic && !actor.effects.some(e => e.active && e.flags?.vedmak?.dragonForm)) {
    ui.notifications.warn(`«${item.name}» — драконья магия: она творится только в Драконьей форме.`);
    return null;
  }

  // Облако двимеритовой бомбы: в нём магию творить нельзя (корник, бомбы)
  const caster = actorToken(actor);
  const cloud = caster && zonesOf(canvas.scene).find(r => r.flags.vedmak.zone.noMagic && pointInZone(r, caster.center));
  if (cloud) {
    ui.notifications.warn(`${actor.name} в облаке «${cloud.name}» — магию творить нельзя.`);
    return null;
  }

  // Квен и другие знаки со щитом: «нельзя сотворить снова, пока действует предыдущий» (стр. 114–115)
  if (s.kind === "sign" && spellAutomation(item).shieldPerSta && actor.effects.some(e => e.flags?.vedmak?.timed?.key === "shield" && e.name === `Щит: ${item.name}`)) {
    ui.notifications.warn(`${item.name} ещё действует — снова сотворить нельзя, пока не кончится прежний.`);
    return null;
  }

  // Вампирская магия — только своих ролей: основной и второй (после полной прокачки основной)
  if (s.isVampire && actor.type === "character") {
    const roles = actor.system.race?.system.activeRoles ?? [];
    if (!roles.length) { ui.notifications.warn(`${actor.name}: сначала выберите роль высшего вампира (вкладка «Навыки»).`); return null; }
    if (!roles.includes(s.branch)) {
      ui.notifications.warn(`«${item.name}» — магия роли «${CONFIG.VEDMAK.MAGIC_BRANCHES[s.branch]}», а у ${actor.name} — `
        + roles.map(r => `«${CONFIG.VEDMAK.MAGIC_BRANCHES[r]}»`).join(" и ") + ".");
      return null;
    }
  }
  if (!s.isVampire && !d.vigor && actor.type === "character") {
    ui.notifications.warn(`${actor.name}: Энергия 0 — магия недоступна (стр. 123).`);
    return null;
  }

  let cfg = {
    payWith: opts.payWith ?? vampirePay(actor, s),
    cost: opts.cost ?? (s.variableCost ? Math.min(variableMax(s), Math.max(1, d.vigor)) : s.staCost),
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
    // Союзники, выбранные в окне, — цели вместо выделенных токенов
    if (cfg.allies?.length) targets = cfg.allies.map(allyTarget).filter(Boolean);
  }

  // Зоны этого же поддерживаемого заклинания от прошлого сотворения: запоминаем до постановки новой
  const previousZones = maintainedZonesOf(actor, item);

  // Зона на сцене: конус или круг ставится мышью, цели — все, кто в неё попал; отмена — отмена сотворения
  const area = opts.targets ? null : parseArea(s.range);
  let region = null;
  const zoneColor = ZONE_COLORS[s.element] ?? ZONE_COLORS.mixed;
  const placed = area && zonesAvailable() ? await placeZone(area, { name: item.name, color: zoneColor }) : null;
  if (placed?.cancelled) return null;
  if (placed?.shape) {
    const duration = await parseZoneDuration(s.duration, { cost: cfg.cost });
    // Долгая зона с уроном или статусами бьёт всех внутри в начале каждого хода заклинателя
    const auto = spellAutomation(item);
    const lasting = !!(duration?.rounds || duration?.maintain);
    const repeat = lasting && !!(auto.damage || auto.staDamage || auto.statuses?.some(x => x.status));
    // Аура (Ирден): штраф всем внутри, кроме заклинателя, — ставит и снимает ведущий (magic/zone-effects.mjs)
    const auraDef = zoneAuraFor(item.name);
    const aura = auraDef ? { ...auraDef, value: auraDef.valueFrom === "vigor" ? (d.vigor ?? 0) : cfg.cost, img: item.img } : null;
    region = await createZone(placed.shape, { name: item.name, color: zoneColor, actor, itemName: item.name, duration, maintainItemId: item.id,
      extra: { itemId: item.id, repeat, aura } });
    targets = zoneTokens(placed.shape, { region, exclude: actorToken(actor) }).map(targetInfo);
  }

  // Зона уходит в карточку (config.zone): по ней эффект знает, куда бить конусом или где вспыхнуть кругу
  if (placed?.shape) {
    const z = placed.shape;
    cfg = { ...cfg, zone: { type: z.type, x: z.x, y: z.y, radius: z.radius, rotation: z.rotation ?? 0, angle: z.angle ?? null } };
  }
  const message = await performCast(actor, item, cfg, targets);
  // Заклинание не сработало — зона не нужна
  const works = !!message?.flags?.vedmak?.cast?.works;
  if (region && !works) await removeZones([region]);
  // Повторное сотворение поддерживаемого заклинания заменяет поддержание (см. performCast), а вместе с ним —
  // и прежние зоны: иначе повтор зоны бил бы с обеих
  if (works && previousZones.length) await removeZones(previousZones);
  return message;
}

/** Зоны поддерживаемого заклинания этого заклинателя на всех сценах (флаг `zone.maintain` — id предмета). */
function maintainedZonesOf(actor, item) {
  return game.scenes.contents.flatMap(scene => zonesOf(scene).filter(r => {
    const z = r.flags.vedmak.zone;
    return z.maintain === item.id && z.actorUuid === actor.uuid;
  }));
}

/**
 * Вампирская магия («Высший вампир. Вторая редакция»): проверка — базовый навык роли заклинания
 * (уровень + d10, без параметра), у чудовища без расы — 0.
 */
export function vampireBase(actor, s) {
  const power = actor.system.race?.system.roleBase?.(s.branch);
  return { name: power?.name ?? (CONFIG.VEDMAK.MAGIC_BRANCHES[s.branch] ?? "Навык роли"), value: power?.value ?? 0 };
}

/** Чем платить вампирское заклинание по умолчанию: ОК, если хватает, иначе Выносливостью. */
function vampirePay(actor, s) {
  if (!s.isVampire) return "";
  if (s.resource === "sta") return "sta";
  return (actor.system.blood?.value ?? 0) >= s.staCost ? "blood" : "sta";
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
export function costNote(a, cost) {
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

/**
 * Союзники для баффа без выделенных целей (PLAN 4.100): дружественные токены сцены без заклинателя;
 * сцены нет — персонажи игроков. {uuid, name, img}; токен — по токену, иначе по актору.
 */
function allyChoices(actor) {
  const own = actorToken(actor);
  const tokens = (canvas?.scene?.tokens ?? []).filter(t => t.actor && t.object !== own && t.actor !== actor
    && t.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY && !t.hidden);
  if (tokens.length) return tokens.map(t => ({ uuid: t.uuid, name: t.name, img: t.texture?.src ?? t.actor.img }));
  return game.actors.filter(a => a.type === "character" && a.hasPlayerOwner && a !== actor).map(a => ({ uuid: a.uuid, name: a.name, img: a.img }));
}

/** Цель из выбора союзника: токен или актор без токена. */
function allyTarget(uuid) {
  const doc = fromUuidSync(uuid);
  if (!doc) return null;
  if (doc.documentName === "Token") return targetInfo(doc);
  return { tokenUuid: null, actorUuid: doc.uuid, name: doc.name, img: doc.img };
}

async function castDialog(actor, item, cfg, targets) {
  const s = item.system;
  const d = actor.system.derived;
  const { used } = vigorUsed(actor);
  const maintained = maintainedSpells(actor);
  const skillKey = MAGIC_SKILL[s.kind] ?? "spellCasting";
  const vb = s.isVampire ? vampireBase(actor, s) : null;
  const base = vb ? vb.value : castBase(actor, skillKey);
  const maxCost = variableMax(s);
  const auto = spellAutomation(item);
  const costDots = s.variableCost && maxCost <= 12
    ? Array.from({ length: maxCost }, (_, i) => ({
        value: i + 1, selected: i + 1 === cfg.cost, on: i + 1 <= cfg.cost,
        damage: resolveSta(auto.damage, i + 1), note: costNote(auto, i + 1)
      }))
    : [];
  const damage = resolveSta(auto.damage, cfg.cost);

  // Бафф или лечение на другого, а цели не выделены — союзники жетонами прямо в окне
  const helpful = !!(spellAuto(item.name)?.target || auto.regen?.hp);
  const allies = !targets.length && helpful && targetingFor(s.range) === "direct" ? allyChoices(actor) : [];
  const content = await renderTemplate("systems/vedmak/templates/dialog/cast.hbs", {
    item, s, cfg, targets, allies,
    head: {
      title: item.name, img: item.img, base, baseHint: vb ? `${vb.name} (уровень навыка роли)` : `Воля + ${SKILLS[skillKey].label}`,
      subtitle: [CONFIG.VEDMAK.MAGIC_KINDS[s.kind], vb ? CONFIG.VEDMAK.MAGIC_BRANCHES[s.branch] : "", levelLabel(s.kind, s.level),
        s.kind === "spell" || s.kind === "sign" ? CONFIG.VEDMAK.MAGIC_ELEMENTS[s.element] : "",
        s.god, s.range, s.duration].filter(Boolean).join(" · ")
    },
    kindLabel: CONFIG.VEDMAK.MAGIC_KINDS[s.kind], levelLabel: levelLabel(s.kind, s.level),
    isRitual: s.kind === "ritual", isHex: s.kind === "hex", noPlaces: s.kind === "hex" || !!vb,
    vampire: vb ? {
      cost: s.staCost, staOnly: s.resource === "sta", payBlood: cfg.payWith === "blood", paySta: cfg.payWith === "sta",
      blood: actor.system.blood?.value ?? 0, bloodMax: actor.system.blood?.max ?? 0
    } : null,
    maxCost, costDots, costNote: costNote(auto, cfg.cost),
    vigor: d.vigor, used, focus: d.focus, focusItem: d.focusItem,
    sta: actor.system.sta.value,
    maintained: maintained.map(e => e.name),
    total: { base, damage },
    ...commonFields({ luckMax: actor.system.luck?.value ?? 0, mod: cfg.mod, damage, damageMod: cfg.damageMod })
  });

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `${CONFIG.VEDMAK.MAGIC_KINDS[s.kind]}: ${item.name}` },
    classes: ["vedmak", "vedmak-dialog", "check-dialog", "cast-dialog"],
    position: { width: 520 },
    content,
    render: (event, dialog) => bindDialog(dialog, { extra: form => {
      const f = form.elements;
      const cost = s.variableCost ? Math.max(1, Number(f.cost?.value) || 1) : s.staCost;
      const focus = f.useFocus?.checked ? d.focus : 0;
      const paid = focus && cost ? Math.max(1, cost - focus) : cost;
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
      default: true,
      callback: (event, button) => {
        const f = button.form.elements;
        return {
          ...readCommon(f, actor.system.luck?.value ?? 0),
          payWith: s.isVampire ? (s.resource === "sta" ? "sta" : f.payWith?.value || cfg.payWith) : "",
          cost: s.variableCost ? Math.max(1, Math.min(variableMax(s), Number(f.cost.value) || 1)) : s.staCost,
          useFocus: !!f.useFocus?.checked,
          placeOfPower: !!f.placeOfPower?.checked,
          dimeritium: Math.max(0, Number(f.dimeritium?.value) || 0),
          dc: f.dc?.value ?? cfg.dc,
          helpers: Math.max(0, Math.min(4, Number(f.helpers?.value) || 0)),
          allies: [...button.form.querySelectorAll('[name="ally"]:checked')].map(i => i.value)
        };
      }
    }, { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  return result === "cancel" ? null : result;
}

/** Бросок, оплата, провал, эффекты на себя и карточка. */
export async function performCast(actor, item, cfg, targets) {
  const s = item.system;
  const a = spellAutomation(item);
  const reg = spellAuto(item.name);
  const buffTime = reg?.self || reg?.target ? await buffDuration(s.duration) : {};
  const d = actor.system.derived;
  const skillKey = MAGIC_SKILL[s.kind] ?? "spellCasting";
  const skill = actor.system.skills[skillKey];
  const will = actor.system.stats.will;
  const notes = [];
  const selfLines = [];

  // Затраты и перегрузка. Вампирская магия — Очками Крови или Выносливостью, без Энергии и фокуса
  const vamp = s.isVampire;
  const cost = cfg.cost;
  const focus = cfg.useFocus && !vamp ? d.focus : 0;
  const paid = focus && cost ? Math.max(1, cost - focus) : cost;
  const vigor = Math.max(0, d.vigor + (cfg.placeOfPower ? 5 : 0) - (cfg.dimeritium || 0));
  const { used } = vigorUsed(actor);
  const overload = vamp ? 0 : Math.max(0, used + paid - vigor);
  const payBlood = vamp && cfg.payWith === "blood" && s.resource !== "sta";
  if (payBlood && (actor.system.blood?.value ?? 0) < paid) {
    ui.notifications.warn(`${actor.name}: не хватает Очков Крови (${actor.system.blood?.value ?? 0} из ${paid}).`);
    return null;
  }
  if (!payBlood && actor.system.sta.value < paid) {
    ui.notifications.warn(`${actor.name}: не хватает Вын (${actor.system.sta.value} из ${paid}).`);
    return null;
  }
  const staAfter = payBlood ? actor.system.sta.value : actor.system.sta.value - paid;
  const update = payBlood ? { "system.blood.value": actor.system.blood.value - paid } : { "system.sta.value": staAfter };
  if (overload) update["system.hp.value"] = actor.system.hp.value - overload * 5;
  await actor.update(update);
  if (!vamp) await addVigorUsed(actor, paid);
  if (vamp) notes.push(payBlood ? `Оплачено: ${paid} ОК.` : `Оплачено: ${paid} Вын.`);
  if (focus) notes.push(`Фокус «${d.focusItem}»: −${focus} к затратам.`);
  if (overload) selfLines.push(`Перегрузка на ${overload}: −${overload * 5} ПЗ.`);

  // Проверка: Воля + навык магии; вампирская — уровень базового навыка роли
  const parts = [];
  if (vamp) {
    const vb = vampireBase(actor, s);
    parts.push({ label: vb.name, value: vb.value, always: true });
    if (d?.actionMod) parts.push({ label: "Ранения: ко всем действиям", value: d.actionMod });
  } else {
    parts.push(
      { label: will.label, value: will.effective, always: true },
      { label: SKILLS[skillKey].label, value: skill.total, always: true }
    );
    const sum = will.effective + skill.total + skill.penalty;
    if (skill.penalty) parts.push({ label: "Ранения и скованность", value: skill.penalty });
    if (skill.base !== Math.max(0, sum)) parts.push({ label: "Ранения (множитель)", value: skill.base - sum });
  }
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
    if (vamp) {
      works = false;
      fumble = { text: "Критический провал: заклинание не срабатывает.", damage: 0 };
    } else if (s.kind === "ritual") {
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
  if ((fumble?.elemental || overload) && s.kind !== "ritual" && s.kind !== "hex" && !vamp) {
    const eff = ELEMENTAL_FUMBLE[element] ?? ELEMENTAL_FUMBLE.mixed;
    selfLines.push(`Стихийный эффект (${eff.label.toLowerCase()}): ${eff.text}`);
    if (eff.status) await actor.toggleStatusEffect(eff.status, { active: true });
  }
  if (fumble?.focusExplodes && focus) selfLines.push(`«${d.focusItem}» взрывается: 1d10 урона всем в радиусе 2 м.`);
  if (fumble?.backfire) {
    await applyHex(actor, item);
    selfLines.push(`На заклинателя наложена порча «${item.name}».`);
  }
  // Дезориентация — только если Вын потрачена сейчас (оплата Очками Крови её не трогает)
  if (!payBlood && paid > 0 && staAfter <= 0) {
    await actor.toggleStatusEffect("disoriented", { active: true });
    selfLines.push("Вын исчерпана: дезориентация, испытание Уст и отдых до 20 Вын.");
  }

  // Регенерация: срок — свой у автоматизации, иначе из «Длительности»; у поддерживаемого заклинания —
  // пока его поддерживают (снимается вместе с поддержанием)
  const regen = a.regen.hp ? await regenData(actor, item, a.regen, cost) : null;

  // Эффекты на себя при успехе
  if (works) {
    if (a.shieldPerSta) {
      const value = a.shieldPerSta * cost;
      // Сначала метка (старая снимается без обнуления щита), потом новый щит
      await setTimedEffect(actor, { name: `Щит: ${item.name}`, img: item.img, key: "shield", rounds: a.shieldRounds || 0 });
      await actor.update({ "system.shield.value": value, "system.shield.max": value });
      selfLines.push(`${item.name}: щит ${value} ПЗ${a.shieldRounds ? ` на ${a.shieldRounds} раундов` : ""}.`);
    }
    const maintain = s.maintainFor(cost);
    if (maintain > 0) {
      const data = {
        name: `Поддержание: ${item.name}`, img: item.img,
        description: `Каждый раунд ${maintain} Вын. Пока поддерживается, нельзя творить другие заклинания.`,
        flags: { vedmak: { maintain: { cost: maintain, itemId: item.id, shield: !!a.shieldPerSta } } }
      };
      // То же заклинание сотворено снова — поддержание заменяется, а не добавляется второе (иначе Вын
      // списывается дважды). Обновлением, а не удалением: удаление поддержания снимает баффы, регенерацию
      // и зону этого заклинания — в том числе только что поставленные
      const existing = maintainedSpells(actor).find(e => e.flags.vedmak.maintain.itemId === item.id);
      if (existing) await existing.update(data);
      else await actor.createEmbeddedDocuments("ActiveEffect", [{ ...data, transfer: false }]);
      selfLines.push(`Поддержание: ${maintain} Вын за раунд.`);
    } else if (s.maintainOptional) {
      selfLines.push(`Действует ${s.duration}; продлить можно за ${s.maintainCost} Вын в раунд — списывается вручную.`);
    }
    // Бафф на себя из справочника (config/spell-auto.mjs)
    if (reg?.self) {
      const buff = { ...buffData(item, actor, reg.self, buffTime), cast: { total: roll.total, cost } };
      await applyBuff(actor, buff);
      selfLines.push(buffLine(buff));
    }
    if (reg?.note) notes.push(reg.note);
    // Рассеивание: снять действующую магию с целей, если бросок выше броска её заклинателя
    if (reg?.dispel) {
      if (!targets.length) notes.push("Рассеивание: выделите цель — с неё снимается магия слабее этого броска.");
      for (const t of targets) notes.push(...await dispelOn(actor, t, roll.total, paid));
    }
    if (s.kind === "ritual" && regen && !targets.length) {
      const { term } = await applyRegen(actor, { ...regen, name: item.name, img: item.img, cast: { total: roll.total, cost } });
      selfLines.push(`${item.name}: +${regen.hp} ПЗ за ход${term}.`);
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
    regen,
    hex: s.kind === "hex",
    buff: reg?.target ? { ...buffData(item, actor, reg.target, buffTime), cast: { total: roll.total, cost } } : null,
    allLocations: a.location === "all",
    works, targeting
  };
  const hasTargetEffect = !!(a.damage || spellData.staDamage || spellData.statuses.length || spellData.regen || spellData.hex || spellData.buff);
  // «На себя» с уроном или состояниями (ауры: «Шокирующий удар», «Огни смерти») — по выбранным целям, если они есть
  const showTargets = works && (targeting !== "self" || (hasTargetEffect && targets.length > 0))
    && (hasTargetEffect || s.defense !== "none");
  // «На себя» без урона и без целей («Невидимость», «Природный камуфляж»): состояния ложатся на заклинателя
  if (works && targeting === "self" && !showTargets && !a.damage && !spellData.staDamage && spellData.statuses.length) {
    const { applyStatus } = await import("../combat/damage.mjs");
    for (const st of spellData.statuses) {
      if (st.chance < 100 && Math.ceil(CONFIG.Dice.randomUniform() * 100) > st.chance) continue;
      await applyStatus(actor, st.status, a.statusRounds || "");
      selfLines.push(`${item.name}: ${game.i18n.localize(CONFIG.statusEffects.find(e => e.id === st.status)?.name ?? st.status)} на заклинателе.`);
    }
  }

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
    // Своя часть тела у заклинания («в голову», «в туловище»); «all» — по всему телу (computeDamage)
    fixedLocation: a.location && a.location !== "all" ? a.location : "",
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
    cost, paid, overload, fumble, selfLines, works, dc, payLabel: payBlood ? "ОК" : "Вын",
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
  dodge:       { label: "Уклонение", short: "Уклон" },
  reposition:  { label: "Изменение позиции", short: "Позиция" },
  block:       { label: "Блокирование щитом", short: "Щит" },
  resistMagic: { label: "Сопротивление магии", short: "Магия" },
  willx3:      { label: "Против Воли ×3", short: "Воля ×3" },
  auto:        { label: "Эффект без защиты", short: "Сразу" },
  none:        { label: "Без защиты: против СЛ", short: "СЛ" },
  dispel:      { label: "Рассеивание: Сотворение заклинаний против броска заклинателя, половина Вын заклинания (нужно знать заклинание)", short: "Рассеять" }
};

export function spellDefenseButtons(keys) {
  // Рассеиванием можно защититься от любой магической атаки (стр. 102)
  return [...keys, "dispel"].map(key => ({ key, ...DEFENSE_BUTTONS[key] }));
}

/* -------------------------------------------------------------------------- */
/*  Эффекты с длительностью                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Эффект-метка со сроком. В бою — отсчёт раундов в начале хода носителя, вне боя раунды считать некому:
 * срок ставится временем мира (после боя остаток переводит timed.mjs). Ни раундов, ни минут — без срока
 * (щит до исчерпания, поддерживаемое заклинание).
 */
export async function setTimedEffect(actor, { name, img, key, rounds = 0, minutes = 0, extra = {} }) {
  const existing = actor.effects.find(e => e.flags?.vedmak?.timed?.key === key);
  // Замена: новый щит ставится следом — снятие старой метки его не обнуляет (timed.mjs)
  if (existing) await existing.delete({ vedmakKeepShield: true });
  const combat = inCombat(actor);
  const data = {
    name, img, transfer: false,
    flags: { vedmak: { timed: { key, rounds: combat && !minutes ? rounds : 0 }, ...extra } }
  };
  // `expiry: null`: схема v14 для числового срока ставит «turnStart», и эффект участника боя по времени не снимается
  if (minutes) data.duration = { value: minutes, units: "minutes", expiry: null };
  else if (rounds && !combat) data.duration = roundsAsTime(rounds);
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  return effect;
}

/**
 * Данные регенерации заклинания для карточки: {hp, rounds, minutes, maintain, casterUuid, itemId}.
 * rounds — число или формула из автоматизации; пусто — срок из «Длительности» или поддержание.
 */
async function regenData(actor, item, auto, cost) {
  const regen = { hp: auto.hp, rounds: auto.rounds || "", casterUuid: actor.uuid, itemId: item.id };
  if (regen.rounds) return regen;
  if (item.system.maintainFor(cost) > 0) return { ...regen, maintain: true };
  const time = await buffDuration(item.system.duration);
  if (time.rounds) regen.rounds = String(time.rounds);
  else if (time.minutes) regen.minutes = time.minutes;
  return regen;
}

/**
 * Регенерация: +N ПЗ в начале каждого хода. rounds — число или формула, minutes — срок временем,
 * maintain — пока заклинатель поддерживает заклинание (снимает buffs.mjs вместе с поддержанием).
 * @returns {Promise<{effect: ActiveEffect, term: string}>} term — срок для карточки: « (5 раундов)»
 */
export async function applyRegen(actor, { hp, rounds, minutes = 0, maintain = false, casterUuid, itemId, name, img, cast = null }) {
  let n = 0;
  if (rounds) n = Number.isFinite(Number(rounds)) ? Number(rounds) : (await new Roll(String(rounds)).evaluate()).total;
  const extra = { regen: hp };
  if (cast) extra.cast = cast;
  if (casterUuid) extra.spellLink = { casterUuid, itemId, maintain: !!maintain };
  const effect = await setTimedEffect(actor, { name: `Регенерация: ${name}`, img, key: `regen:${name}`, rounds: n, minutes, extra });
  const term = n ? ` (${n} раундов)` : minutes ? ` (${minutes} мин)` : maintain ? ", пока поддерживается" : "";
  return { effect, term };
}

/** Порча как эффект на жертве: описание и условия снятия. */
export async function applyHex(actor, item, cast = null) {
  return actor.createEmbeddedDocuments("ActiveEffect", [{
    name: `Порча: ${item.name}`, img: item.img, transfer: false,
    description: item.system.description,
    flags: { vedmak: { hex: item.name, ...(cast ? { cast } : {}) } }
  }]);
}

/* -------------------------------------------------------------------------- */
/*  Рассеивание действующей магии (стр. 102)                                   */
/* -------------------------------------------------------------------------- */

/** Магические эффекты актора: баффы, регенерация, порча и всё, где записан бросок заклинателя. */
const magicEffectsOf = actor => (actor?.effects ?? []).filter(e => {
  const v = e.flags?.vedmak;
  return v?.cast || v?.spellBuff || v?.hex || v?.spellLink;
});

/**
 * Рассеивание на цель: снимается эффект, чей бросок заклинателя меньше броска Рассеивания (ничья — в пользу
 * магии); цена — половина Вын снятого. Эффект без записанного броска (поставлен до 4.100) сравнивает ведущий.
 * @returns {Promise<string[]>} строки карточки
 */
async function dispelOn(caster, t, total, paid) {
  const target = resolveActor(t.tokenUuid) ?? resolveActor(t.actorUuid);
  if (!target) return [];
  const magic = magicEffectsOf(target);
  if (!magic.length) return [`${target.name}: действующей магии нет.`];
  const beaten = [], held = [], unknown = [];
  for (const e of magic) {
    const c = e.flags.vedmak.cast;
    if (!c) unknown.push(e);
    else if (total > c.total) beaten.push(e);
    else held.push(e);
  }
  const lines = [];
  if (beaten.length) {
    await asGM("dispelEffects", { uuid: t.tokenUuid ?? t.actorUuid, ids: beaten.map(e => e.id), casterUuid: caster.uuid });
    const need = beaten.reduce((sum, e) => sum + Math.floor((e.flags.vedmak.cast.cost ?? 0) / 2), 0);
    lines.push(`${target.name}: рассеяно — ${beaten.map(e => `«${e.name}» (${e.flags.vedmak.cast.total})`).join(", ")}.`
      + ` Цена — половина Вын: ${need}${paid < need ? ` (потрачено ${paid} — доплатите вручную)` : ""}.`);
  }
  if (held.length) lines.push(`${target.name}: устояло — ${held.map(e => `«${e.name}» (${e.flags.vedmak.cast.total})`).join(", ")}.`);
  if (unknown.length) lines.push(`${target.name}: бросок не записан, сравнивает ведущий — ${unknown.map(e => `«${e.name}»`).join(", ")}.`);
  return lines;
}

registerGMHandler("dispelEffects", async ({ uuid, ids, casterUuid }, userId) => {
  const caster = resolveActor(casterUuid);
  const knows = caster?.items?.some(i => i.type === "spell" && spellAuto(i.name)?.dispel);
  if (!game.users.get(userId)?.isGM && (!userOwnsAny(userId, caster) || !knows)) {
    return console.warn(`vedmak | отклонено Рассеивание от ${game.users.get(userId)?.name ?? userId}`);
  }
  const target = resolveActor(uuid);
  if (!target) return;
  const allowed = new Set(magicEffectsOf(target).map(e => e.id));
  const del = (ids ?? []).filter(id => allowed.has(id));
  if (del.length) await target.deleteEmbeddedDocuments("ActiveEffect", del);
});

/* -------------------------------------------------------------------------- */
/*  Долгие зоны: удар каждый раунд                                            */
/* -------------------------------------------------------------------------- */

/** Последняя карточка сотворения этого заклинания этим заклинателем. */
function lastCastMessage(actor, itemId) {
  return game.messages.contents.findLast(m => {
    const a = m.flags?.vedmak?.attack;
    return a?.spell?.itemId === itemId && !m.flags.vedmak.cast?.repeat
      && (a.attacker.actorUuid === actor.uuid || resolveActor(a.attacker.tokenUuid) === actor);
  }) ?? null;
}

/**
 * Начало хода заклинателя: каждая его долгая зона с уроном или статусами снова бьёт всех, кто в ней.
 * Карточка — та же, что при сотворении, с новыми целями; защита — против исходного результата.
 */
export async function repeatZonesForTurn(actor, combat) {
  const scene = combat?.scene ?? canvas?.scene;
  const lines = [];
  for (const region of zonesOf(scene)) {
    const z = region.flags.vedmak.zone;
    if (!z.repeat || z.actorUuid !== actor.uuid) continue;
    // Поддержание уже прекращено — зону снимет обработчик конца поддержания
    if (z.maintain && !actor.effects.some(e => e.flags?.vedmak?.maintain?.itemId === z.maintain)) continue;
    const shape = region.shapes?.[0];
    const onScene = canvas?.scene?.id === scene?.id;
    const tokens = shape && onScene ? zoneTokens(shape, { region, exclude: actorToken(actor), showHidden: !actor.hasPlayerOwner }) : [];
    if (await postZoneRepeat(actor, region, tokens, { round: combat?.round ?? 1 })) {
      lines.push(`${actor.items.get(z.itemId)?.name ?? region.name}: зона бьёт снова — целей ${tokens.length}.`);
    }
  }
  return lines;
}

/**
 * Карточка повторного удара долгой зоны по токенам: в начале хода заклинателя или когда кто-то вошёл в зону
 * посреди раунда (magic/zone-effects.mjs). Защита — против исходного результата сотворения.
 * @param {Array<Token|TokenDocument>} tokens
 * @returns {Promise<boolean>} была ли карточка
 */
export async function postZoneRepeat(actor, region, tokens, { round = 1, note = "" } = {}) {
  const z = region.flags.vedmak.zone;
  const message = lastCastMessage(actor, z.itemId);
  const atk = message?.flags.vedmak.attack;
  const item = actor.items.get(z.itemId);
  if (!atk || !item) return false;
  const targets = tokens.map(targetInfo);
  // Скрытый токен в зоне: имя и портрет в общей карточке выдали бы его — карточка уходит только ведущим
  const hiddenIn = tokens.some(t => (t.document ?? t).hidden);
  const s = item.system;
  const data = { ...atk, targets, notes: [note, "Защита — против того же результата сотворения."].filter(Boolean) };
  await postCard({
    template: "systems/vedmak/templates/chat/cast.hbs", actor,
    data: {
      ...data, repeat: round, hasTargets: targets.length > 0, showDefense: true,
      defenseButtons: spellDefenseButtons(atk.spell.defenses),
      kindLabel: CONFIG.VEDMAK.MAGIC_KINDS[s.kind], levelLabel: levelLabel(s.kind, s.level),
      elementLabel: s.kind === "spell" || s.kind === "sign" ? CONFIG.VEDMAK.MAGIC_ELEMENTS[s.element] : "",
      range: s.range, duration: s.duration,
      defenseLabel: s.defenseText || SPELL_DEFENSES[s.defense]?.label,
      cost: atk.spell.cost, paid: atk.spell.paid, works: true, selfLines: []
    },
    flags: { attack: data, cast: { itemId: item.id, works: true, repeat: true } },
    messageMode: hiddenIn ? "gm" : undefined
  });
  return true;
}
