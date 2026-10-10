// Усиления брони, руны и глифы (корник стр. 90, 256).
//
//  • Усиление брони — набор накладок на все надетые части: полный ход, инструменты ремесленника, Изготовление СЛ 14.
//    Даёт +ПБ и сопротивления; снять — Изготовление СЛ 15. Уничтожение брони уничтожает и усиление.
//  • Руна — на оружие, глиф — на броню, в свободную ячейку усиления; снять нельзя, камень одноразовый.

import { SKILLS } from "../config/skills.mjs";
import { STATS } from "../config/stats.mjs";
import { CRAFTING, CROSSBOW_MODS, crossbowModLimit, ENCHANT_SLOTS, MAX_ENHANCEMENT_SLOTS } from "../config/crafting.mjs";
import { ARMOR_LOCATIONS } from "../config/items.mjs";
import { dialogCheck } from "../dice/check.mjs";
import { postCard, spendOne } from "../util.mjs";
import { hasTool, findItemData, giveItem } from "./craft.mjs";

const { DialogV2 } = foundry.applications.api;

async function craftingCheck(actor, dc, title) {
  const skill = actor.system.skills.crafting;
  const parts = [
    { label: STATS.cra.label, value: actor.system.stats.cra.effective, always: true },
    { label: SKILLS.crafting.label, value: skill.total, always: true }
  ];
  if (!hasTool(actor, "craftsman")) parts.push({ label: "Без инструментов ремесленника", value: -4 });
  return dialogCheck({ actor, title, parts, dc });
}

/** Выбрать предметы галочками. */
async function pickTargets(title, candidates, { multiple = false, hint = "" } = {}) {
  if (!candidates.length) return null;
  const rows = candidates.map((c, i) => multiple
    ? `<label class="check"><input type="checkbox" name="t${i}" ${c.checked ? "checked" : ""}> ${c.label}</label>`
    : `<option value="${i}">${c.label}</option>`).join("");
  const content = `<div class="vedmak-roll-dialog">${multiple ? rows : `<div class="form-group"><label>Куда</label><select name="target">${rows}</select></div>`}
    ${hint ? `<p class="hint">${hint}</p>` : ""}</div>`;
  const result = await DialogV2.wait({
    window: { title }, classes: ["vedmak", "vedmak-dialog"], content,
    buttons: [{ action: "ok", label: "Далее", default: true,
      callback: (e, b) => multiple ? candidates.filter((c, i) => b.form.elements[`t${i}`].checked) : [candidates[Number(b.form.elements.target.value)]] },
      { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  return result && result !== "cancel" && result.length ? result : null;
}

/**
 * Что усиление делает с оружием — по его данным: эффект оружия (зазубривание — кровотечение), «Серебряное (2d6)»,
 * «+N к надёжности», «+N к точности». Прежде такие наборы шли веткой брони и тратились впустую.
 */
function weaponEnhancementPlan(s) {
  const text = `${s.effect ?? ""} ${s.description ?? ""}`;
  return {
    effect: s.weaponEffect?.key ? { key: s.weaponEffect.key, value: s.weaponEffect.value ?? "" } : null,
    silver: text.match(/Серебрян\S*\s*\(([^)]+)\)/i)?.[1]?.trim() ?? "",
    reliability: Number(text.match(/\+\s*(\d+)\s*к\s*надёжности/i)?.[1] ?? 0),
    accuracy: Number(text.match(/\+\s*(\d+)\s*к\s*точности/i)?.[1] ?? 0)
  };
}

/** Усиление оружия: проверка Изготовления, правка оружия, набор расходуется. */
async function attachWeaponEnhancement(actor, item) {
  const plan = weaponEnhancementPlan(item.system);
  if (!plan.effect && !plan.silver && !plan.reliability && !plan.accuracy) {
    return ui.notifications.warn(`«${item.name}»: непонятно, что усиление делает с оружием — правьте оружие вручную.`);
  }
  const weapons = actor.itemTypes.weapon.filter(w => w.system.category !== "natural");
  const chosen = await pickTargets(`${item.name}: на какое оружие`, weapons.map(w => ({
    item: w, label: `${w.name}${w.system.equipped ? "" : " (не в руках)"}`
  })), { hint: `Изготовление СЛ ${CRAFTING.attachDc}, полный ход, нужны инструменты ремесленника. Изменение постоянное.` });
  if (!chosen) return null;
  const weapon = chosen[0].item;
  const check = await craftingCheck(actor, CRAFTING.attachDc, `Усиление оружия: ${item.name}`);
  if (!check?.success) return null;

  const src = weapon.system.toObject();
  const update = {};
  const lines = [];
  if (plan.effect) {
    const effects = foundry.utils.deepClone(src.effects ?? []);
    const same = effects.find(e => e.key === plan.effect.key);
    const pct = v => parseInt(String(v).replace(/[^\d]/g, ""), 10) || 0;
    if (same) same.value = `${pct(same.value) + pct(plan.effect.value)}%`;
    else effects.push({ ...plan.effect });
    update["system.effects"] = effects;
    lines.push(`Эффект «${CONFIG.VEDMAK.WEAPON_EFFECTS?.[plan.effect.key]?.label ?? plan.effect.key}»: ${same ? same.value : plan.effect.value}.`);
  }
  if (plan.silver) { update["system.silverDamage"] = plan.silver; lines.push(`Серебро: ${plan.silver}.`); }
  if (plan.reliability) {
    update["system.reliability.max"] = (src.reliability?.max ?? 0) + plan.reliability;
    update["system.reliability.value"] = (src.reliability?.value ?? 0) + plan.reliability;
    lines.push(`Надёжность +${plan.reliability}.`);
  }
  if (plan.accuracy) { update["system.accuracy"] = (src.accuracy ?? 0) + plan.accuracy; lines.push(`Точность +${plan.accuracy}.`); }
  await weapon.update(update);
  await spendOne(item);
  return postCard(actor, `${item.name} → ${weapon.name}`, lines.map(l => `<p>${l}</p>`).join(""), { icon: "fa-solid fa-hammer" });
}

/** Прикрепить усиление, руну или глиф из инвентаря. */
export async function attachEnhancement(actor, item) {
  const s = item.system;
  if (s.kind === "rune") return attachRune(actor, item);
  if (s.kind === "glyph") return attachGlyph(actor, item);
  if (s.kind === "crossbow") return attachCrossbowMod(actor, item);
  if (s.kind === "runeword" || s.kind === "glyphword") return attachEnchantment(actor, item);
  if (s.kind === "weapon") return attachWeaponEnhancement(actor, item);
  if (s.kind === "slot") return attachSlot(actor, item);

  const armors = actor.itemTypes.armor.filter(a => !a.system.isShield && a.system.covers.length);
  const candidates = armors.map(a => ({
    item: a, checked: a.system.equipped && a.system.freeSlots > 0,
    label: `${a.name}${a.system.equipped ? "" : " (не надета)"} — ячеек свободно: ${a.system.freeSlots}`
  }));
  const chosen = await pickTargets(`${item.name}: на какую броню`, candidates, {
    multiple: true, hint: `Один набор ставится на все выбранные части и снимается с них разом. Изготовление СЛ ${CRAFTING.attachDc}, полный ход, нужны инструменты ремесленника.`
  });
  if (!chosen) return null;
  const noSlot = chosen.filter(c => c.item.system.freeSlots <= 0);
  if (noSlot.length) return ui.notifications.warn(`Нет свободных ячеек: ${noSlot.map(c => c.item.name).join(", ")}.`);
  const check = await craftingCheck(actor, CRAFTING.attachDc, `Усиление брони: ${item.name}`);
  if (!check?.success) return null;

  // Один набор — одно наложение (стр. 90): все выбранные части помнят общий номер набора
  // во флаге `armorKits`, чтобы снять набор целиком и вернуть ровно один. Вес набора — на первой части.
  const kit = foundry.utils.randomID();
  for (const [i, c] of chosen.entries()) {
    const armor = c.item;
    const sp = foundry.utils.deepClone(armor.system.toObject().sp);
    for (const loc of Object.keys(ARMOR_LOCATIONS)) {
      if (sp[loc].max > 0) { sp[loc].max += s.sp; sp[loc].value += s.sp; }
    }
    const enhancements = [...armor.system.toObject().enhancements,
      { name: item.name, kind: "armor", sp: s.sp, resist: [...s.resistances], effect: s.effect, element: "" }];
    const weight = i === 0 ? s.weight : 0;
    const update = {
      "system.sp": sp, "system.enhancements": enhancements,
      "flags.vedmak.armorKits": [...armorKits(armor), { id: kit, name: item.name, weight }]
    };
    if (weight) update["system.weight"] = Math.round((armor.system.weight + weight) * 10) / 10;
    await armor.update(update);
  }
  await spendOne(item);
  return postCard(actor, "Усиление брони", `<p><b>${item.name}</b> → ${chosen.map(c => c.item.name).join(", ")}: +${s.sp} ПБ${s.resistances.length ? `, сопротивления: ${s.resistances.map(r => resistLabel(r)).join(", ")}` : ""}.</p>`,
    { icon: "fa-solid fa-shield-halved" });
}

function resistLabel(key) {
  return { slashing: "режущему", piercing: "колющему", bludgeoning: "дробящему", elemental: "огню/стихиям", bleeding: "кровотечению", poison: "яду" }[key] ?? key;
}

/** Наборы усиления на части брони: [{id, name, weight}] — общий номер у всех частей одного набора. */
function armorKits(armor) {
  return foundry.utils.deepClone(armor.flags?.vedmak?.armorKits ?? []);
}

/**
 * Снять усиление брони (Изготовление СЛ 15), вернуть набор в инвентарь.
 * Набор, наложенный на несколько частей, снимается со всех разом и возвращается один (стр. 90);
 * его вес уходит с той части, на которую был записан.
 */
export async function detachEnhancement(actor, armor, index) {
  const e = armor.system.enhancements[index];
  if (!e) return null;
  if (e.kind !== "armor") return ui.notifications.warn("Руны и глифы снять нельзя (стр. 256).");
  const kitId = armorKits(armor).find(k => k.name === e.name)?.id;
  // Части с тем же набором; у наложенных до этой правки номера нет — снимается только эта часть
  const pieces = kitId
    ? actor.itemTypes.armor.filter(a => armorKits(a).some(k => k.id === kitId))
    : [armor];
  const check = await craftingCheck(actor, CRAFTING.detachDc, `Снять усиление: ${e.name}`);
  if (!check?.success) return null;
  for (const piece of pieces) {
    const enhancements = piece.system.toObject().enhancements;
    const at = piece === armor ? index : enhancements.findIndex(x => x.kind === "armor" && x.name === e.name);
    if (at < 0) continue;
    const [removed] = enhancements.splice(at, 1);
    const sp = foundry.utils.deepClone(piece.system.toObject().sp);
    for (const loc of Object.keys(ARMOR_LOCATIONS)) {
      if (sp[loc].max > 0) { sp[loc].max = Math.max(0, sp[loc].max - removed.sp); sp[loc].value = Math.min(sp[loc].value, sp[loc].max); }
    }
    const update = { "system.sp": sp, "system.enhancements": enhancements };
    if (kitId) {
      const kits = armorKits(piece);
      const own = kits.find(k => k.id === kitId);
      if (own?.weight) update["system.weight"] = Math.max(0, Math.round((piece.system.weight - own.weight) * 10) / 10);
      update["flags.vedmak.armorKits"] = kits.filter(k => k.id !== kitId);
    }
    await piece.update(update);
  }
  await giveItem(actor, await findItemData(e.name, "enhancement"), 1);
  const from = pieces.map(p => `«${p.name}»`).join(", ");
  return postCard(actor, "Усиление снято", `<p><b>${e.name}</b> снято с ${from} и возвращено в снаряжение.</p>`, { icon: "fa-solid fa-shield-halved" });
}

/** Стоит ли на предмете рунное или глифово слово: зачарование других рун и глифов не пускает (PLAN 4.11). */
export function isEnchanted(item) {
  if (item.type === "weapon") return item.system.runes.some(e => (e.slots || 1) > 1);
  if (item.type === "armor") return item.system.enhancements.some(e => e.kind === "glyph" && (e.slots || 1) > 1);
  return false;
}

async function attachRune(actor, item) {
  // Поверх рунного слова руну не нанести, даже если ячейка свободна
  const weapons = actor.itemTypes.weapon.filter(w => w.system.freeSlots > 0 && !isEnchanted(w));
  if (!weapons.length) return ui.notifications.warn("Нет оружия со свободной ячейкой усиления (на зачарованное руну не нанести).");
  const chosen = await pickTargets(`${item.name}: на какое оружие`, weapons.map(w => ({ item: w, label: `${w.name} — ячеек: ${w.system.freeSlots}` })),
    { hint: "Руну нельзя снять; камень расходуется." });
  if (!chosen) return null;
  const weapon = chosen[0].item;
  const we = item.system.weaponEffect;
  const effects = weapon.system.toObject().effects;
  effects.push({ key: we.key || "rune", value: we.key ? we.value : item.system.effect, source: item.name });
  await weapon.update({ "system.effects": effects });
  await spendOne(item);
  return postCard(actor, "Руна нанесена", `<p><b>${item.name}</b> → «${weapon.name}»: ${item.system.effect}</p>`, { icon: "fa-solid fa-gem" });
}

async function attachGlyph(actor, item) {
  // Поверх глифова слова глиф не нанести, даже если ячейка свободна
  const armors = actor.itemTypes.armor.filter(a => a.system.freeSlots > 0 && !isEnchanted(a));
  if (!armors.length) return ui.notifications.warn("Нет брони со свободной ячейкой усиления (на зачарованную глиф не нанести).");
  const chosen = await pickTargets(`${item.name}: на какую броню`, armors.map(a => ({ item: a, label: `${a.name} — ячеек: ${a.system.freeSlots}` })),
    { hint: "Глиф нельзя снять; камень расходуется." });
  if (!chosen) return null;
  const armor = chosen[0].item;
  const enhancements = [...armor.system.toObject().enhancements,
    { name: item.name, kind: "glyph", sp: 0, resist: [], effect: item.system.effect, element: item.system.element }];
  await armor.update({ "system.enhancements": enhancements });
  await spendOne(item);
  return postCard(actor, "Глиф нанесён", `<p><b>${item.name}</b> → «${armor.name}»: ${item.system.effect}</p>`, { icon: "fa-solid fa-gem" });
}

/** Целы ли оружие или броня: полная надёжность, у брони — полная ПБ во всех частях. */
function isIntact(item) {
  const s = item.system;
  if (item.type === "armor") {
    const parts = Object.values(s.sp ?? {}).filter(p => (p?.max ?? 0) > 0);
    if (parts.some(p => p.value < p.max)) return false;
  }
  return !(s.reliability?.max > 0) || s.reliability.value >= s.reliability.max;
}

/**
 * Слот зачарования («Том Хаоса», стр. 115): пустая ячейка усиления оружию или броне. Работа и проверка Ремесла —
 * при изготовлении по чертежу; здесь ячейка ставится на выбранный предмет. Предмет цел, ячеек меньше трёх.
 */
async function attachSlot(actor, item) {
  const candidates = [...actor.itemTypes.weapon, ...actor.itemTypes.armor]
    .filter(i => i.system.category !== "natural" && (i.system.enhancementSlots ?? 0) < MAX_ENHANCEMENT_SLOTS && isIntact(i));
  if (!candidates.length) {
    return ui.notifications.warn(`Нет оружия или брони, куда встанет ячейка: нужна полная надёжность (у брони — ПБ), и ячеек меньше ${MAX_ENHANCEMENT_SLOTS}.`);
  }
  const chosen = await pickTargets(`${item.name}: какому предмету`, candidates.map(i => ({
    item: i, label: `${i.name} — ячеек: ${i.system.enhancementSlots ?? 0} из ${MAX_ENHANCEMENT_SLOTS}`
  })), { hint: "В ячейку войдут только руны и глифы. Убрать ячейку нельзя." });
  if (!chosen) return null;
  const target = chosen[0].item;
  const slots = (target.system.enhancementSlots ?? 0) + 1;
  await target.update({ "system.enhancementSlots": slots });
  await spendOne(item);
  return postCard(actor, "Слот зачарования", `<p>«${target.name}»: новая ячейка усиления — теперь их ${slots}.</p>`, { icon: "fa-solid fa-gem" });
}

/** Поставить модификацию на арбалет: полный ход, без проверки (DLC «Фургончик Родольфа»). */
async function attachCrossbowMod(actor, item) {
  const key = modKey(item.name);
  const bows = actor.itemTypes.weapon.filter(w => w.system.isCrossbow);
  if (!bows.length) return ui.notifications.warn("Нет арбалета, на который это ставится.");
  const candidates = bows.map(w => ({
    item: w,
    label: `${w.name} — модификаций: ${w.system.crossbowMods.length} из ${crossbowModLimit(w)}`
  }));
  const chosen = await pickTargets(`${item.name}: на какой арбалет`, candidates,
    { hint: "Полный ход, без проверки. Снять — тоже полный ход." });
  if (!chosen) return null;
  const bow = chosen[0].item;
  const mods = bow.system.toObject().crossbowMods;
  if (mods.length >= crossbowModLimit(bow)) {
    return ui.notifications.warn(`На «${bow.name}» больше модификаций не влезает.`);
  }
  if (mods.some(m => m.key === key)) {
    return ui.notifications.warn("Модификация такого вида на этом арбалете уже стоит.");
  }
  mods.push({ name: item.name, key });
  await bow.update({ "system.crossbowMods": mods });
  await spendOne(item);
  return postCard(actor, "Модификация поставлена",
    `<p><b>${item.name}</b> → «${bow.name}»: ${item.system.effect}</p>`,
    { icon: "fa-solid fa-screwdriver-wrench" });
}

/** Снять модификацию с арбалета и вернуть её в снаряжение. */
export async function detachCrossbowMod(actor, weapon, index) {
  const mods = weapon.system.toObject().crossbowMods;
  const mod = mods[index];
  if (!mod) return null;
  mods.splice(index, 1);
  await weapon.update({ "system.crossbowMods": mods });
  await giveItem(actor, await findItemData(mod.name, "enhancement"), 1);
  return postCard(actor, "Модификация снята",
    `<p><b>${mod.name}</b> снята с «${weapon.name}» и возвращена в снаряжение.</p>`,
    { icon: "fa-solid fa-screwdriver-wrench" });
}

/** Вид модификации по названию — ключ из CROSSBOW_MODS. */
function modKey(name) {
  const n = name.toLowerCase();
  if (n.includes("прицел")) return "sight";
  if (n.includes("ворот")) return "windlass";
  if (n.includes("тетива")) return "string";
  if (n.includes("балансировочное")) return "balance";
  if (n.includes("стремя")) return "stirrup";
  return Object.keys(CROSSBOW_MODS)[0];
}

/** Рунное или глифово слово: зачарование занимает две-три ячейки и не терпит других рун и глифов. */
async function attachEnchantment(actor, item) {
  const s = item.system;
  const weapon = s.kind === "runeword";
  const slots = ENCHANT_SLOTS[s.size] ?? ENCHANT_SLOTS.small;
  const targets = weapon
    ? actor.itemTypes.weapon
    : actor.itemTypes.armor.filter(a => !a.system.isShield || s.effect.includes("щит"));
  // Предмет несёт только одно зачарование: второе слово поверх первого не ляжет
  const free = targets.filter(t => t.system.freeSlots >= slots && !isEnchanted(t));
  if (!free.length) {
    return ui.notifications.warn(`Нужен незачарованный предмет со свободными ячейками усиления: ${slots}.`);
  }
  const chosen = await pickTargets(`${item.name}: на что наложить`,
    free.map(t => ({ item: t, label: `${t.name} — ячеек свободно: ${t.system.freeSlots}` })),
    { hint: `Зачарование занимает ${slots} ячейки. Другие руны и глифы на предмете при этом сгорают, `
          + "и новых наложить уже нельзя." });
  if (!chosen) return null;
  const target = chosen[0].item;
  const check = await craftingCheck(actor, s.size === "large" ? 21 : 15, `Зачарование: ${item.name}`);
  if (!check?.success) return null;

  if (weapon) {
    const effects = target.system.toObject().effects.filter(e => !e.source);
    effects.push({ key: "rune", value: s.effect, source: item.name, slots });
    await target.update({ "system.effects": effects });
  } else {
    const kept = target.system.toObject().enhancements.filter(e => e.kind === "armor");
    kept.push({ name: item.name, kind: "glyph", sp: 0, resist: [], effect: s.effect,
                element: s.element, slots });
    await target.update({ "system.enhancements": kept });
  }
  await spendOne(item);
  return postCard(actor, "Зачарование наложено",
    `<p><b>${item.name}</b> → «${target.name}»: ${s.effect}</p>`, { icon: "fa-solid fa-wand-sparkles" });
}
