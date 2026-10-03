// Защита от атаки из карточки: уклонение, изменение позиции, блок, парирование, против СЛ (стр. 164).

import { SKILLS } from "../config/skills.mjs";
import { DEFENSE_TYPES, DEFENSE_SITUATIONS, SIZE_MODS, RANGE_BANDS, CRIT_LEVELS, critLevelFor, fumbleText } from "../config/combat.mjs";
import { performCheck } from "../dice/check.mjs";
import { bindDialog, commonFields, foldState, readCommon } from "../dice/dialog-ui.mjs";
import { renderTemplate } from "../util.mjs";
import { statusRollMods } from "./statuses.mjs";
import {
  resolveActor, fallbackDefender, combatantFor, asGM, postCard, defaultMessageMode, armWoundParts, markDone, allowRepeat,
  isReadyWeapon
} from "./common.mjs";

/** Чем можно блокировать или парировать. */
function defenseItems(actor, attack, defense) {
  const out = [];
  if (defense === "block" || defense === "parry") {
    for (const s of actor.itemTypes.armor.filter(i => i.system.isShield && i.system.equipped)) {
      out.push({ id: s.id, label: `${s.name} (щит, Ближний бой)`, skill: "melee", shield: true, item: s });
    }
    if (!(defense === "block" && attack.isRanged)) {
      // Блокируют и парируют тем, что в руках
      const weapons = actor.itemTypes.weapon.filter(w => !w.system.isRanged && isReadyWeapon(actor, w));
      for (const w of weapons) out.push({ id: w.id, label: `${w.name} (${SKILLS[w.system.skill]?.label ?? ""})`, skill: w.system.skill, item: w });
    }
  }
  return out;
}

/** Защиты, которые делаются рукой с оружием или щитом: к ним идёт штраф ран руки. */
const ARM_DEFENSES = ["block", "parry", "brawlBlock"];

/**
 * Ограничения защиты (стр. 164) — одни и те же для кнопки, окна и итога окна.
 * Стрелы и болты не парируют; дистанционную атаку блокируют только щитом (ни оружием, ни рукой);
 * «Блокирование» без оружия и щита — блок рукой (Борьба).
 * @returns {{error: string}|{defense: string, items: object[]}}
 */
function resolveDefense(actor, attack, defense) {
  if (defense === "parry" && (attack.weapon?.isBow || attack.weapon?.isCrossbow)) return { error: "Стрелы и болты нельзя парировать." };
  if (defense === "brawlBlock" && attack.isRanged) return { error: "Дистанционную атаку можно блокировать только щитом." };
  const items = defenseItems(actor, attack, defense);
  if (defense === "block" && !items.length) {
    if (attack.isRanged) return { error: "Дистанционную атаку можно блокировать только щитом." };
    return { defense: "brawlBlock", items: [] };
  }
  return { defense, items };
}

/** Есть ли уже карточка защиты этой цели от этой атаки. Поиск по чату, а не отметка: её может не быть без ведущего. */
function priorDefense(message, defender) {
  const same = d => (defender.tokenUuid && d?.tokenUuid ? d.tokenUuid === defender.tokenUuid : d?.actorUuid === defender.actorUuid);
  return game.messages.some(m => {
    const def = m.flags.vedmak?.defense;
    return def?.attackMessageId === message.id && same(def.defender);
  });
}

/**
 * Защититься от атаки из сообщения.
 * @param {ChatMessage} message — карточка атаки
 * @param {object} target — {tokenUuid, actorUuid, name} или пусто (выделенный токен)
 * @param {string} defense — ключ DEFENSE_TYPES или "none"
 * @param {object} [opts] — {skipDialog, messageMode}; messageMode — когда карточку создаёт клиент ведущего за НИП:
 *   режим чата ведущего для неё не годится
 */
export async function defend(message, target, defense, { skipDialog = false, messageMode } = {}) {
  const attack = message.flags.vedmak?.attack;
  if (!attack) return null;
  const info = target?.tokenUuid || target?.actorUuid ? target : fallbackDefender();
  const actor = resolveActor(info?.tokenUuid) ?? resolveActor(info?.actorUuid);
  if (!actor) return ui.notifications.warn("Выделите токен защищающегося.");
  if (!actor.isOwner) return ui.notifications.warn(`Защищаться за «${actor.name}» может только его владелец или ведущий.`);

  const defender = { actorUuid: actor.uuid, tokenUuid: info.tokenUuid ?? actor.token?.uuid ?? null, name: actor.name, img: info.img ?? actor.img };
  if (attack.spell && !attack.spell.works) return ui.notifications.warn("Магия не сработала — защищаться не от чего.");
  // Одна защита цели от одной атаки: повторная — только ведущим и с подтверждением
  if (priorDefense(message, defender) && !(await allowRepeat(`${actor.name} уже защищался от этой атаки.`))) return null;
  const mode = messageMode ?? defaultMessageMode();
  if (defense === "none") return defendAgainstDC(message, attack, actor, defender, { skipDialog, messageMode: mode });
  if (defense === "auto") return defendAuto(message, attack, actor, defender, { messageMode: mode });
  if (defense === "willx3") {
    const dc = actor.system.stats.will.effective * 3;
    return defendAgainstDC(message, attack, actor, defender, { skipDialog: true, dc, label: `Воля ×3 (${dc})`, messageMode: mode });
  }

  // Ограничения защиты (стр. 164)
  let check = resolveDefense(actor, attack, defense);
  if (check.error) return ui.notifications.warn(check.error);
  defense = check.defense;
  let items = check.items;

  let cfg = { defense, itemId: items[0]?.id ?? "", situations: [], outnumbered: 1, mod: 0, luck: 0, messageMode: mode };
  if (!skipDialog) {
    cfg = await defenseDialog(actor, attack, cfg, items);
    if (!cfg) return null;
    // Итог окна — через те же ограничения: предмет в окне общий для блока и парирования
    check = resolveDefense(actor, attack, cfg.defense);
    if (check.error) return ui.notifications.warn(check.error);
    cfg.defense = check.defense;
    items = check.items;
    if (!items.some(i => i.id === cfg.itemId)) {
      if (cfg.itemId && items.length) ui.notifications.info(`${DEFENSE_TYPES[cfg.defense].label}: ${items[0].item.name}.`);
      cfg.itemId = items[0]?.id ?? "";
    }
  }
  return rollDefense(message, attack, actor, defender, cfg, items);
}

/** Какой навык уходит в защиту выбранного вида (с учётом предмета для блока и парирования). */
function defenseSkillKey(type, item) {
  return type.skill === "weapon" ? (item?.skill ?? "brawling") : type.skill;
}

/** Основа защиты — та же арифметика, что в rollDefense. */
function defenseBase(actor, typeKey, item) {
  const type = DEFENSE_TYPES[typeKey] ?? DEFENSE_TYPES.dodge;
  const skill = actor.system.skills[defenseSkillKey(type, item)];
  const stat = actor.system.stats[SKILLS[defenseSkillKey(type, item)].stat];
  const sum = stat.effective + skill.total + skill.penalty;
  let base = sum;
  if (skill.base !== Math.max(0, sum)) base += skill.base - sum;
  for (const m of statusRollMods(actor, "defense")) base += Number(m.value) || 0;
  if (ARM_DEFENSES.includes(typeKey)) for (const m of armWoundParts(actor)) base += m.value;
  return base;
}

/**
 * Лучшая защита для автоматического броска (НИП ведущего): самая высокая основа среди доступных.
 * Магия — только защиты заклинания; «Воля ×3» и «без защиты» не бросаются, их и берём, если других нет.
 * @returns {string} ключ защиты для defend()
 */
export function bestDefense(actor, attack) {
  const spellDefenses = attack.spell?.defenses;
  if (spellDefenses) {
    const rolled = spellDefenses.filter(k => DEFENSE_TYPES[k]);
    if (!rolled.length) return spellDefenses.includes("willx3") ? "willx3" : spellDefenses[0] ?? "auto";
  }
  let best = { key: "dodge", value: -Infinity };
  for (const [key, type] of Object.entries(DEFENSE_TYPES)) {
    if (spellDefenses ? !spellDefenses.includes(key) : type.magicOnly) continue;
    if (key === "brawlBlock") continue;
    const check = resolveDefense(actor, attack, key);
    if (check.error) continue;
    let item = null;
    if (key === "block" || key === "parry") {
      item = check.items[0] ?? null;
      if (!item) continue;
    }
    const value = defenseBase(actor, key, item) + (type.mod ?? 0) - (key === "parry" && attack.weapon?.isThrown ? 5 : 0);
    if (value > best.value) best = { key, value };
  }
  return best.key;
}

async function defenseDialog(actor, attack, cfg, items) {
  const spellDefenses = attack.spell?.defenses;
  // В списке — только допустимые защиты (стр. 164); «Блокирование» без оружия и щита — это «Блок рукой»
  const allowed = Object.entries(DEFENSE_TYPES).filter(([k, t]) => {
    if (spellDefenses ? !spellDefenses.includes(k) : t.magicOnly) return false;
    const check = resolveDefense(actor, attack, k);
    return !check.error && check.defense === k;
  });
  // Чем блокировать и парировать — единый список: вид защиты в окне меняется без перерисовки
  const byId = new Map();
  for (const key of ["block", "parry"]) {
    if (!allowed.some(([k]) => k === key)) continue;
    for (const it of defenseItems(actor, attack, key)) if (!byId.has(it.id)) byId.set(it.id, it);
  }
  const gear = [...byId.values()].map(it => ({
    id: it.id, name: it.item.name, skillLabel: SKILLS[it.skill]?.label ?? "", skill: it.skill,
    selected: it.id === cfg.itemId
  }));
  if (gear.length && !gear.some(g => g.selected)) gear[0].selected = true;
  const pickedItem = () => byId.get(gear.find(g => g.selected)?.id) ?? null;

  const types = allowed.map(([key, t]) => ({
    key, ...t, mod: t.mod ?? 0, selected: key === cfg.defense,
    note: [t.mod ? `${t.mod}` : "", SKILLS[defenseSkillKey(t, pickedItem())]?.label ?? ""].filter(Boolean).join(" · ")
  }));
  const base = defenseBase(actor, cfg.defense, pickedItem());

  const content = await renderTemplate("systems/vedmak/templates/dialog/defense.hbs", {
    attack, cfg, items: gear, types,
    head: {
      title: `${attack.attacker.name}: ${attack.label}`, img: attack.img, base,
      subtitle: `${attack.typeLabel} · результат атаки ${attack.roll.total}${attack.aimLabel ? ` · ${attack.aimLabel}` : ""}`,
      note: attack.isRanged ? "Дистанционная атака" : ""
    },
    situations: Object.entries(DEFENSE_SITUATIONS).map(([key, s]) => ({ key, ...s })),
    foldSituations: foldState("defenseSituations", false),
    // Штраф ран руки — в той же строке «уже в основе»: основа окна пересчитывается по выбранной защите
    statusMods: [...statusRollMods(actor, "defense"),
      ...armWoundParts(actor).map(p => ({ ...p, label: `${p.label}: блок и парирование` }))],
    extraCost: defenseCostInfo(actor).cost,
    total: { base, hint: `Нужно больше ${attack.roll.total}` },
    ...commonFields({ luckMax: actor.system.luck?.value ?? 0 })
  });
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `Защита: ${actor.name}` },
    classes: ["vedmak", "vedmak-dialog", "check-dialog", "defense-dialog"],
    position: { width: 520 },
    content,
    render: (event, dialog) => bindDialog(dialog, {
      base: form => defenseBase(actor, form.elements.defense.value, byId.get(form.elements.itemId?.value) ?? null),
      mods: form => -(Math.max(1, Number(form.elements.outnumbered?.value) || 1) - 1)
    }),
    buttons: [{
      action: "defend", label: "Защищаться", default: true,
      callback: (event, button) => {
        const f = button.form.elements;
        const defense = f.defense.value;
        return {
          ...readCommon(f, actor.system.luck?.value ?? 0),
          defense,
          itemId: defense === "block" || defense === "parry" ? f.itemId?.value ?? "" : "",
          situations: Object.keys(DEFENSE_SITUATIONS).filter(k => f[`sit.${k}`]?.checked),
          outnumbered: Math.max(1, Number(f.outnumbered.value) || 1)
        };
      }
    }, { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  return result === "cancel" ? null : result;
}

/** Стоимость защиты: каждое действие защиты сверх первого в раунде — 1 Вын (стр. 151). */
function defenseCostInfo(actor) {
  const combatant = combatantFor(actor);
  if (!combatant) return { combatant: null, count: 0, cost: 0 };
  const flag = combatant.getFlag("vedmak", "defenses") ?? {};
  const count = flag.round === game.combat.round ? flag.count : 0;
  const cost = count >= 1 && !actor.statuses.has("activeDodge") ? 1 : 0;
  return { combatant, count, cost };
}

async function rollDefense(message, attack, actor, defender, cfg, items) {
  const type = DEFENSE_TYPES[cfg.defense] ?? DEFENSE_TYPES.dodge;
  const item = items.find(i => i.id === cfg.itemId) ?? null;
  const skillKey = type.skill === "weapon" ? (item?.skill ?? "brawling") : type.skill;
  const skill = actor.system.skills[skillKey];
  const stat = actor.system.stats[SKILLS[skillKey].stat];

  const parts = [
    { label: stat.label, value: stat.effective, always: true },
    { label: skill.label, value: skill.total, always: true }
  ];
  const sum = stat.effective + skill.total + skill.penalty;
  if (skill.penalty) parts.push({ label: "Ранения и СД", value: skill.penalty });
  if (skill.base !== Math.max(0, sum)) parts.push({ label: "Ранения (множитель)", value: skill.base - sum });
  if (type.mod) parts.push({ label: type.label, value: type.mod });
  if (cfg.defense === "parry" && attack.weapon?.isThrown) parts.push({ label: "Парирование метательного", value: -5 });
  if (cfg.outnumbered > 1) parts.push({ label: `Противников в ближнем бою: ${cfg.outnumbered}`, value: -(cfg.outnumbered - 1) });
  for (const key of cfg.situations) parts.push({ label: DEFENSE_SITUATIONS[key].label, value: DEFENSE_SITUATIONS[key].mod });
  parts.push(...statusRollMods(actor, "defense"));
  if (ARM_DEFENSES.includes(cfg.defense)) parts.push(...armWoundParts(actor));
  if (cfg.mod) parts.push({ label: "Модификатор", value: cfg.mod });

  const label = item ? `${type.label}: ${item.item.name}` : type.label;
  const roll = await performCheck({ actor, title: label, parts, luck: cfg.luck, toChat: false });
  const attackTotal = attack.roll.total;
  const margin = attackTotal - roll.total;
  const hit = margin > 0;
  const notes = [];

  // Вын за дополнительную защиту
  const cost = defenseCostInfo(actor);
  if (cost.combatant) {
    await cost.combatant.setFlag("vedmak", "defenses", { round: game.combat.round, count: cost.count + 1 });
    if (cost.cost) {
      await actor.update({ "system.sta.value": Math.max(0, actor.system.sta.value - cost.cost) });
      notes.push(`Дополнительная защита в раунде: −${cost.cost} Вын.`);
    }
  }

  // Последствия успешной защиты
  let damageOnBlock = false, fixedLocation = "";
  if (!hit) {
    if (cfg.defense === "block" && item) {
      // Пишем в исходное значение: в system уже прибавлены модификации арбалета («Стремя» +5),
      // и запись посчитанного числа поднимала бы надёжность с каждым блоком
      const src = item.item._source.system.reliability;
      await item.item.update({ "system.reliability.value": Math.max(0, src.value - 1) });
      const rel = item.item.system.reliability;
      notes.push(rel.value > 0 ? `${item.item.name}: надёжность ${rel.value}/${rel.max}.` : `${item.item.name} сломан — больше не защищает.`);
    }
    if (cfg.defense === "brawlBlock") {
      damageOnBlock = !attack.noDamage;
      fixedLocation = Math.random() < 0.5 ? "rightArm" : "leftArm";
      notes.push("Удар принят на руку: урон по подставленной конечности, броня работает.");
    }
    if (cfg.defense === "parry") notes.push("Парирование: атака отменена, атакующий ошеломлён.");
    if (cfg.defense === "reposition") notes.push(`Можно сместиться на ${Math.floor(actor.system.stats.spd.effective / 2)} м.`);
    if (attack.attackType === "charge" && cfg.defense === "block") notes.push("Атака с разбега заблокирована: встречная Сила против Силы, чтобы сбить с ног.");
  }

  const fumbleKind = cfg.defense === "brawlBlock" || cfg.defense === "dodge" || cfg.defense === "reposition"
    ? "unarmed" : "weaponDefense";
  const data = buildOutcome(message, attack, defender, {
    defense: cfg.defense, label, roll, total: roll.total, dc: null, hit, margin, notes,
    damageOnBlock, fixedLocation,
    fumbleText: roll.fumble ? fumbleText(fumbleKind, roll.fumbleValue) : "",
    fumbleLabel: roll.fumble ? CONFIG.VEDMAK.FUMBLES[fumbleKind].label : ""
  });
  const card = await postDefense(message, data, actor, { rolls: roll.rolls ?? [], messageMode: cfg.messageMode });
  // Ошеломление атакующего — после карточки: ведущий проверяет по ней, что парирование было и кто парировал
  if (!hit && cfg.defense === "parry" && card) {
    await asGM("setStatus", { uuid: attack.attacker.tokenUuid ?? attack.attacker.actorUuid, status: "staggered", active: true, messageId: card.id });
  }
  return card;
}

/** Карточка защиты в чат и отметка на карточке атаки (погасить кнопки этой цели). */
async function postDefense(message, data, actor, { rolls = [], messageMode }) {
  const card = await postCard({
    template: "systems/vedmak/templates/chat/defense.hbs", data, actor, flags: { defense: data }, rolls, messageMode
  });
  await markDone(message, card);
  return card;
}

/** Беззащитная, дезориентированная или ничего не подозревающая цель: атака против СЛ. */
async function defendAgainstDC(message, attack, actor, defender, { skipDialog, dc: fixedDc = null, label = "Без защиты", messageMode }) {
  let dc = fixedDc ?? (actor.statuses.has("disoriented") || actor.statuses.has("unconscious") ? 10
    : attack.isRanged && !attack.spell ? (RANGE_BANDS[attack.band]?.dc ?? 15) : 10);
  let size = "medium";
  if (!skipDialog) {
    const sizes = Object.entries(SIZE_MODS).map(([k, s]) =>
      `<label class="chip"><input type="radio" name="size" value="${k}" data-mod="${s.mod}" ${k === "medium" ? "checked" : ""}>
        <span>${s.label} <b>${s.mod >= 0 ? "+" : "−"}${Math.abs(s.mod)}</b></span></label>`).join("");
    const content = `<div class="vedmak-roll-dialog against-dc">
      <header class="dlg-head">
        <div class="dlg-ident">
          <span class="dlg-title">${actor.name}: без защиты</span>
          <span class="dlg-sub">${attack.attacker.name}: ${attack.label} · результат атаки ${attack.roll.total}</span>
        </div>
        <div class="dlg-base"><span class="cap">ПОПАДАЕТ ОТ</span><b data-against-dc>${dc}</b></div>
      </header>
      <div class="dlg-body">
        <div class="dlg-row">
          <label class="num"><span class="cap">СЛ попадания</span><input type="number" name="dc" value="${dc}"></label>
          <span class="hint grow">Дезориентированная цель — 10. Неподвижная или ничего не подозревающая — СЛ дистанции.</span>
        </div>
        <div class="dlg-group">
          <span class="dlg-label">РАЗМЕР ЦЕЛИ</span>
          <div class="opt-row">${sizes}</div>
        </div>
      </div>
      <footer class="dlg-total">
        <div class="tot"><span class="cap">АТАКА</span><b>${attack.roll.total}</b></div>
        <span class="tot-hint">Попадание, если атака больше итоговой СЛ</span>
      </footer></div>`;
    const res = await foundry.applications.api.DialogV2.wait({
      window: { title: `Без защиты: ${actor.name}` },
      classes: ["vedmak", "vedmak-dialog", "check-dialog"], position: { width: 460 }, content,
      render: (event, dialog) => bindDialog(dialog, {
        extra: form => {
          const out = dialog.element.querySelector("[data-against-dc]");
          const size = form.querySelector('[name="size"]:checked');
          if (out) out.textContent = String((Number(form.elements.dc.value) || 0) + (Number(size?.dataset.mod) || 0));
        }
      }),
      buttons: [{ action: "ok", label: "Сравнить", default: true,
        callback: (e, b) => ({ dc: Number(b.form.elements.dc.value) || 0, size: b.form.elements.size.value }) },
        { action: "cancel", label: "Отмена" }],
      rejectClose: false
    });
    if (!res || res === "cancel") return null;
    ({ dc, size } = res);
  }
  const total = dc + (SIZE_MODS[size]?.mod ?? 0);
  const margin = attack.roll.total - total;
  const data = buildOutcome(message, attack, defender, {
    defense: "none", label, roll: null, total, dc: total, hit: margin > 0, margin, notes: []
  });
  return postDefense(message, data, actor, { messageMode });
}

/** Магия без защиты: срабатывает, если сотворение не провалено (стр. 168). */
async function defendAuto(message, attack, actor, defender, { messageMode } = {}) {
  const data = buildOutcome(message, attack, defender, {
    defense: "auto", label: "Без защиты", roll: null, total: null, dc: null, hit: true, margin: 0, notes: [], auto: true
  });
  return postDefense(message, data, actor, { messageMode });
}

function buildOutcome(message, attack, defender, r) {
  const critAllowed = !attack.spell || attack.spell.canCrit;
  const critLevel = r.hit && critAllowed && !r.auto ? critLevelFor(r.margin) : null;
  const canDamage = (r.hit || r.damageOnBlock) && !attack.noDamage;
  const spell = attack.spell ?? null;
  const canApplyEffects = r.hit && !!spell && attack.noDamage && !!(spell.statuses?.length || spell.regen || spell.hex || spell.buff);
  return {
    kind: "defense",
    attackMessageId: message.id,
    attack: {
      attacker: attack.attacker, label: attack.label, img: attack.img, typeLabel: attack.typeLabel,
      weapon: attack.weapon, attackType: attack.attackType, aim: attack.aim, isRanged: attack.isRanged,
      damageFormula: attack.damageFormula, damageMult: attack.damageMult, nonLethal: attack.nonLethal,
      damageMod: attack.damageMod ?? 0, chargeFormula: attack.chargeFormula ?? "",
      noDamage: attack.noDamage, fixedLocation: attack.fixedLocation, hitText: attack.hitText,
      hitStatus: attack.hitStatus, stunSaveMod: attack.stunSaveMod, total: attack.roll.total,
      spell
    },
    defender,
    ...r,
    fixedLocation: r.fixedLocation || attack.fixedLocation || "",
    critLevel: r.damageOnBlock ? null : critLevel,
    critLabel: critLevel && !r.damageOnBlock ? CRIT_LEVELS[critLevel].label : "",
    canDamage, canApplyEffects,
    hitStatusLabel: r.hit && attack.hitStatus ? CONFIG.statusEffects[attack.hitStatus]?.name ?? attack.hitStatus : "",
    showHitText: r.hit && attack.hitText,
    stunSave: r.hit && attack.stunSaveMod !== null && attack.stunSaveMod !== undefined && attack.noDamage
  };
}
