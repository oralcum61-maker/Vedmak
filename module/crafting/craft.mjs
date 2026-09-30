// Ремесло и алхимия: изготовление, доплата, переработка, собирательство, починка, разборка (корник стр. 127–147, 140).
//
//  • Чертёж или формула перед глазами — +2 к проверке; запомнить можно столько, сколько Инт.
//  • Компоненты чертежа заменять нельзя; формула требует субстанции (любые ингредиенты нужной субстанции).
//  • Инструменты ремесленника/алхимика обязательны, для металла нужна кузница.
//  • Провал — материалы потрачены; переработка той же СЛ возвращает ½ материалов (формула — одну субстанцию).
//  • Доплата в поселении — заплатить и сразу получить все материалы.

import { SKILLS } from "../config/skills.mjs";
import { STATS } from "../config/stats.mjs";
import { SUBSTANCES, CRAFTING, RECIPE_CATEGORIES } from "../config/crafting.mjs";
import { performCheck } from "../dice/check.mjs";
import { bindDialog, commonFields, readCommon } from "../dice/dialog-ui.mjs";
import { renderTemplate, compareRu } from "../util.mjs";
import { resolveActor, postCard } from "../combat/common.mjs";
import { registerChatAction } from "../combat/chat.mjs";

const { DialogV2 } = foundry.applications.api;

export const PHYSICAL_TYPES = ["weapon", "armor", "gear", "component", "alchemical", "enhancement"];
const STACKABLE = ["gear", "component", "alchemical", "enhancement"];

const norm = s => String(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/* ------------------------------- Инвентарь ------------------------------- */

export function itemsNamed(actor, name) {
  const n = norm(name);
  return actor.items.filter(i => PHYSICAL_TYPES.includes(i.type) && norm(i.name) === n);
}

export function countNamed(actor, name) {
  return itemsNamed(actor, name).reduce((s, i) => s + (i.system.quantity ?? 1), 0);
}

/** Ингредиенты с нужной субстанцией, дешёвые — первыми. */
export function substanceItems(actor, key) {
  return actor.items.filter(i => i.type === "component" && i.system.substance === key && i.system.quantity > 0)
    .sort((a, b) => (a.system.cost - b.system.cost) || compareRu(a.name, b.name));
}

export function substanceCount(actor, key) {
  return substanceItems(actor, key).reduce((s, i) => s + i.system.quantity, 0);
}

export function hasTool(actor, kind) {
  return actor.items.some(i => i.type === "gear" && i.system.tool === kind && (i.system.quantity ?? 1) > 0);
}

/** Уменьшить количество предмета (удалить на нуле). Возвращает снимок израсходованного. */
async function spendItem(item, n) {
  const have = item.system.quantity ?? 1;
  const take = Math.min(have, n);
  const data = item.toObject();
  delete data._id;
  if (take >= have) await item.delete();
  else await item.update({ "system.quantity": have - take });
  return { data, quantity: take };
}

/** Добавить предмет: складываемое — к одноимённому в инвентаре. */
export async function giveItem(actor, data, quantity = 1) {
  data = foundry.utils.deepClone(data);
  delete data._id;
  if (STACKABLE.includes(data.type)) {
    const same = actor.items.find(i => i.type === data.type && norm(i.name) === norm(data.name));
    if (same) return same.update({ "system.quantity": (same.system.quantity ?? 1) + quantity });
  }
  if (data.system) data.system.quantity = STACKABLE.includes(data.type) || data.type === "weapon" ? quantity : 1;
  const docs = [];
  const copies = STACKABLE.includes(data.type) || data.type === "weapon" ? 1 : quantity;
  for (let i = 0; i < copies; i++) docs.push(foundry.utils.deepClone(data));
  return actor.createEmbeddedDocuments("Item", docs);
}

/** Данные предмета по названию: компендиумы, затем мир, иначе простой предмет. */
export async function findItemData(name, type = null) {
  const n = norm(name);
  const match = e => norm(e.name) === n && (!type || e.type === type);
  for (const pack of game.packs.filter(p => p.documentName === "Item")) {
    const index = await pack.getIndex({ fields: ["type"] });
    const entry = index.find(match);
    if (entry) return (await pack.getDocument(entry._id)).toObject();
  }
  const world = game.items.find(match);
  if (world) return world.toObject();
  const fallbackType = type && type !== "recipe" ? type : "gear";
  return { name, type: fallbackType, system: {} };
}

/** Чертёж для предмета: сначала у персонажа, потом в компендиумах. */
export async function findRecipeFor(actor, itemName) {
  const n = norm(itemName);
  const own = actor.items.find(i => i.type === "recipe" && norm(i.system.result.name) === n);
  if (own) return own;
  for (const pack of game.packs.filter(p => p.documentName === "Item")) {
    const index = await pack.getIndex({ fields: ["type", "system.result.name"] });
    const entry = index.find(e => e.type === "recipe" && norm(e.system?.result?.name) === n);
    if (entry) return pack.getDocument(entry._id);
  }
  return game.items.find(i => i.type === "recipe" && norm(i.system.result.name) === n) ?? null;
}

/* ------------------------------ Требования ------------------------------ */

/**
 * Что есть и чего не хватает для рецепта.
 * @param {number} [mult=1] — множитель количества (починка берёт по 1 единице)
 */
export function requirements(actor, recipe, { perComponent = null } = {}) {
  const r = recipe.system;
  const components = r.components.map(c => {
    const need = perComponent ?? c.quantity;
    const have = countNamed(actor, c.name);
    return { name: c.name, need, have, ok: have >= need };
  });
  const substances = perComponent ? [] : r.substanceList.map(([key, need]) => {
    const have = substanceCount(actor, key);
    return { key, label: SUBSTANCES[key].label, color: SUBSTANCES[key].color, symbol: SUBSTANCES[key].symbol, need, have, ok: have >= need };
  });
  const toolKind = r.isFormula ? "alchemist" : "craftsman";
  const tools = [{ label: r.isFormula ? "Инструменты алхимика" : "Инструменты ремесленника", ok: hasTool(actor, toolKind) }];
  if (r.needsForge) tools.push({ label: "Кузница (походная или в поселении)", ok: hasTool(actor, "forge"), forge: true });
  const materialsOk = components.every(c => c.ok) && substances.every(s => s.ok);
  return { components, substances, tools, materialsOk, toolsOk: tools.every(t => t.ok) };
}

/** Готов ли рецепт к изготовлению прямо сейчас (для значка в списке). */
export function readiness(actor, recipe) {
  const req = requirements(actor, recipe);
  return { ok: req.materialsOk && req.toolsOk, materials: req.materialsOk, tools: req.toolsOk };
}

/* ----------------------------- Изготовление ----------------------------- */

/**
 * Окно изготовления и проверка.
 * @param {Actor} actor
 * @param {Item} recipe — чертёж или формула (у персонажа)
 */
export async function craft(actor, recipe, { skipDialog = false } = {}) {
  const r = recipe.system;
  const skillKey = r.skill === "alchemy" || r.isFormula ? "alchemy" : "crafting";
  const req = requirements(actor, recipe);
  const crowns = actor.system.money?.crowns ?? 0;

  let cfg = { blueprint: true, surcharge: false, toolsOverride: false, mod: 0, luck: 0, messageMode: game.settings.get("core", "messageMode") };
  if (!skipDialog) {
    const stat = actor.system.stats.cra;
    const skill = actor.system.skills[skillKey];
    // Чертёж перед глазами в основу не входит: он висит на плашке как правка (+2)
    const base = Math.max(0, stat.effective + skill.total + (skill.penalty || 0));
    const content = await renderTemplate("systems/vedmak/templates/dialog/craft.hbs", {
      recipe, r, req, skill: SKILLS[skillKey].label, crowns, canSurcharge: r.surcharge > 0 && crowns >= r.surcharge,
      bonus: CRAFTING.blueprintBonus,
      categoryLabel: RECIPE_CATEGORIES[r.category] ?? "", memorizedNote: r.memorized,
      head: {
        title: `${r.result.name}${r.result.quantity > 1 ? ` ×${r.result.quantity}` : ""}`, img: recipe.img, base,
        baseHint: `Рем + ${SKILLS[skillKey].label}`,
        subtitle: [RECIPE_CATEGORIES[r.category] ?? "", r.time ? `время: ${r.time}` : "", recipe.name].filter(Boolean).join(" · ")
      },
      total: { base, hint: `Нужно больше ${r.dc}` },
      ...commonFields({ luckMax: actor.system.luck?.value ?? 0 })
    });
    cfg = await DialogV2.wait({
      window: { title: `Изготовление: ${r.result.name}`, icon: r.isFormula ? "fa-solid fa-flask" : "fa-solid fa-hammer" },
      classes: ["vedmak", "vedmak-dialog", "check-dialog", "craft-window"], position: { width: 520 }, content,
      render: (event, dialog) => bindDialog(dialog),
      buttons: [{
        action: "craft", label: "Изготовить", icon: "fa-solid fa-hammer", default: true,
        callback: (event, button) => {
          const f = button.form.elements;
          return {
            ...readCommon(f, actor.system.luck?.value ?? 0),
            blueprint: f.blueprint.checked, surcharge: !!f.surcharge?.checked, toolsOverride: !!f.toolsOverride?.checked,
            messageMode: game.settings.get("core", "messageMode")
          };
        }
      }, { action: "cancel", label: "Отмена", icon: "fa-solid fa-xmark" }],
      rejectClose: false
    });
    if (!cfg || cfg === "cancel") return null;
  }

  if (!req.toolsOk && !cfg.toolsOverride) {
    return ui.notifications.warn(`Нет инструментов: ${req.tools.filter(t => !t.ok).map(t => t.label).join(", ")}.`);
  }
  if (!req.materialsOk && !cfg.surcharge) {
    return ui.notifications.warn("Не хватает материалов. Можно доплатить в поселении, если есть кроны.");
  }

  // Материалы: доплата или расход из инвентаря (расходуются и при провале)
  const consumed = [];
  if (cfg.surcharge) {
    await actor.update({ "system.money.crowns": crowns - r.surcharge });
  } else {
    for (const c of r.components) {
      let left = c.quantity;
      for (const item of itemsNamed(actor, c.name)) {
        if (left <= 0) break;
        const spent = await spendItem(item, left);
        consumed.push(spent);
        left -= spent.quantity;
      }
    }
    for (const [key, need] of r.substanceList) {
      let left = need;
      for (const item of substanceItems(actor, key)) {
        if (left <= 0) break;
        const spent = await spendItem(item, left);
        consumed.push({ ...spent, substance: key });
        left -= spent.quantity;
      }
    }
  }

  const stat = actor.system.stats.cra;
  const skill = actor.system.skills[skillKey];
  const parts = [
    { label: STATS.cra.label, value: stat.effective, always: true },
    { label: SKILLS[skillKey].label, value: skill.total, always: true }
  ];
  if (skill.penalty) parts.push({ label: "Ранения и СД", value: skill.penalty });
  if (cfg.blueprint) parts.push({ label: r.isFormula ? "Формула перед глазами" : "Чертёж перед глазами", value: CRAFTING.blueprintBonus });
  if (cfg.mod) parts.push({ label: "Модификатор", value: cfg.mod });
  const roll = await performCheck({ actor, title: `Изготовление: ${r.result.name}`, parts, dc: r.dc, luck: cfg.luck, toChat: false });

  let created = null;
  if (roll.success) {
    const data = await findItemData(r.result.name, r.result.type);
    await giveItem(actor, data, r.result.quantity);
    created = `${r.result.name}${r.result.quantity > 1 ? ` ×${r.result.quantity}` : ""}`;
  }

  const flags = {
    craft: {
      actorUuid: actor.uuid, recipeName: recipe.name, resultName: r.result.name, dc: r.dc, skill: skillKey,
      formula: r.isFormula, blueprint: cfg.blueprint, consumed: roll.success ? [] : consumed, recycled: false
    }
  };
  return postCard({
    template: "systems/vedmak/templates/chat/craft.hbs",
    data: {
      ...roll, recipeName: recipe.name, resultName: r.result.name, time: r.time, created, surcharge: cfg.surcharge ? r.surcharge : 0,
      consumedList: consumed.map(c => `${c.data.name} ×${c.quantity}`).join(", "),
      canRecycle: !roll.success && consumed.length > 0, actorUuid: actor.uuid
    },
    actor, flags, rolls: roll.rolls, messageMode: cfg.messageMode
  });
}

/* ------------------------------ Переработка ------------------------------ */

registerChatAction("recycle", async message => {
  const c = message.flags.vedmak?.craft;
  if (!c || c.recycled) return ui.notifications.info("Переработка уже была.");
  const actor = resolveActor(c.actorUuid);
  if (!actor?.isOwner) return ui.notifications.warn("Переработать может владелец персонажа или ведущий.");
  const parts = [
    { label: STATS.cra.label, value: actor.system.stats.cra.effective, always: true },
    { label: SKILLS[c.skill].label, value: actor.system.skills[c.skill].total, always: true }
  ];
  if (c.blueprint) parts.push({ label: c.formula ? "Формула перед глазами" : "Чертёж перед глазами", value: CRAFTING.blueprintBonus });
  const roll = await performCheck({ actor, title: `Переработка: ${c.resultName}`, parts, dc: c.dc, toChat: false });
  await message.setFlag("vedmak", "craft.recycled", true);
  const returned = [];
  if (roll.success) {
    if (c.formula) {
      // Возвращается одна из потраченных субстанций в чистом виде
      const sub = c.consumed.find(x => x.substance) ?? c.consumed[0];
      if (sub) { await giveItem(actor, sub.data, 1); returned.push(`${sub.data.name} ×1`); }
    } else {
      for (const x of c.consumed) {
        const n = Math.ceil(x.quantity / 2);
        await giveItem(actor, x.data, n);
        returned.push(`${x.data.name} ×${n}`);
      }
    }
  }
  return postCard({
    template: "systems/vedmak/templates/chat/craft.hbs",
    data: { ...roll, recycle: true, recipeName: c.recipeName, resultName: c.resultName, returned: returned.join(", ") },
    actor, rolls: roll.rolls
  });
});

/* ----------------------------- Собирательство ---------------------------- */

/** Собрать компонент в подходящей местности: Выживание в дикой природе против СЛ собирания (стр. 128). */
export async function forage(actor, item) {
  const f = item.system.forage;
  if (!f.dc && !f.quantity) return ui.notifications.info(`«${item.name}» нельзя собрать — только купить, изготовить или добыть с чудовища.`);
  const result = await actor.rollSkill("wilderness", { dc: f.dc || null, subtitle: `Собирательство: ${item.name} (${f.where})` });
  if (!result?.success && f.dc) return result;
  let amount = 0;
  const q = String(f.quantity || "1").replace(/\s/g, "");
  if (/^\d+$/.test(q)) amount = Number(q);
  else if (/^\d*d\d+(\/\d+)?$/.test(q)) {
    const [dice, div] = q.split("/");
    const r = await new Roll(dice).evaluate();
    amount = Math.max(1, Math.floor(r.total / (Number(div) || 1)));
    await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `${item.name}: найдено ${amount}` });
  } else {
    amount = 1;
  }
  await item.update({ "system.quantity": item.system.quantity + amount });
  ui.notifications.info(`${actor.name}: +${amount} «${item.name}».`);
  return result;
}

/* ------------------------------- Починка ------------------------------- */

/** Сколько рун, глифов и усилений на предмете. */
function enhancementCount(item) {
  if (item.type === "weapon") return item.system.runes.length;
  if (item.type === "armor") return item.system.enhancements.length;
  return 0;
}

/**
 * Починка сломанного оружия или брони (стр. 140): СЛ чертежа − 5, +2 за каждую руну/глиф/усиление;
 * по 1 единице каждого компонента чертежа; при провале компоненты пропадают, возможна переработка.
 */
export async function repair(actor, item) {
  const recipe = await findRecipeFor(actor, item.name);
  if (!recipe) return ui.notifications.warn(`Нет чертежа для «${item.name}» — без него не понять, как чинить.`);
  const dc = Math.max(0, recipe.system.dc - CRAFTING.repairDcMinus + CRAFTING.repairPerEnhancement * enhancementCount(item));
  const req = requirements(actor, recipe, { perComponent: 1 });
  const lines = req.components.map(c => `<li class="${c.ok ? "ok" : "no"}">${c.name}: ${c.have}/${c.need}</li>`).join("");
  const tools = req.tools.map(t => `<li class="${t.ok ? "ok" : "no"}">${t.label}</li>`).join("");
  const ok = await DialogV2.confirm({
    window: { title: `Починка: ${item.name}`, icon: "fa-solid fa-screwdriver-wrench" },
    classes: ["vedmak", "vedmak-dialog"],
    content: `<div class="vedmak-roll-dialog craft-dialog"><p>Изготовление, СЛ <b>${dc}</b> (чертёж ${recipe.system.dc} − 5${enhancementCount(item) ? ` + 2 × ${enhancementCount(item)}` : ""}).</p>
      <p>Нужно по 1 единице компонентов:</p><ul class="req">${lines}</ul><ul class="req">${tools}</ul>
      ${req.materialsOk && req.toolsOk ? "" : `<p class="warn">Чего-то не хватает — ведущий может разрешить починку.</p>`}</div>`
  });
  if (!ok) return null;
  const consumed = [];
  for (const c of recipe.system.components) {
    const it = itemsNamed(actor, c.name)[0];
    if (it) consumed.push(await spendItem(it, 1));
  }
  const skill = actor.system.skills.crafting;
  const parts = [
    { label: STATS.cra.label, value: actor.system.stats.cra.effective, always: true },
    { label: SKILLS.crafting.label, value: skill.total, always: true }
  ];
  const roll = await performCheck({ actor, title: `Починка: ${item.name}`, parts, dc, toChat: false });
  if (roll.success) {
    if (item.type === "weapon" || item.system.isShield) {
      await item.update({ "system.reliability.value": item.system.reliability.max });
    } else {
      const sp = foundry.utils.deepClone(item.system.toObject().sp);
      for (const loc of Object.values(sp)) loc.value = loc.max;
      await item.update({ "system.sp": sp });
    }
  }
  return postCard({
    template: "systems/vedmak/templates/chat/craft.hbs",
    data: { ...roll, repair: true, resultName: item.name, created: roll.success ? item.name : null,
      consumedList: consumed.map(c => `${c.data.name} ×${c.quantity}`).join(", "), canRecycle: !roll.success && consumed.length > 0 },
    actor, rolls: roll.rolls,
    flags: { craft: { actorUuid: actor.uuid, recipeName: recipe.name, resultName: item.name, dc, skill: "crafting", formula: false,
      blueprint: false, consumed: roll.success ? [] : consumed, recycled: false } }
  });
}

/* ------------------------------- Разборка ------------------------------- */

/** Разобрать оружие или броню: половина компонентов чертежа, минимум по 1 (стр. 140). */
export async function disassemble(actor, item) {
  const recipe = await findRecipeFor(actor, item.name);
  if (!recipe) return ui.notifications.warn(`Нет чертежа для «${item.name}» — неизвестно, из чего он сделан.`);
  const parts = recipe.system.components.map(c => ({ name: c.name, n: Math.max(1, Math.floor(c.quantity / 2)) }));
  const ok = await DialogV2.confirm({
    window: { title: `Разборка: ${item.name}`, icon: "fa-solid fa-hammer" },
    content: `<p>Разобрать «${item.name}»? Получите: ${parts.map(p => `${p.name} ×${p.n}`).join(", ")}.</p>`
  });
  if (!ok) return null;
  for (const p of parts) await giveItem(actor, await findItemData(p.name, "component"), p.n);
  if ((item.system.quantity ?? 1) > 1) await item.update({ "system.quantity": item.system.quantity - 1 });
  else await item.delete();
  return postCard({
    template: "systems/vedmak/templates/chat/craft.hbs",
    data: { disassembled: true, resultName: item.name, returned: parts.map(p => `${p.name} ×${p.n}`).join(", ") },
    actor
  });
}

/* ----------------------------- Запоминание ----------------------------- */

/** Запомнить или забыть рецепт; запомнить можно столько, сколько Инт (стр. 127). */
export async function toggleMemorized(actor, recipe) {
  const next = !recipe.system.memorized;
  await recipe.update({ "system.memorized": next });
  if (next) {
    const count = actor.items.filter(i => i.type === "recipe" && i.system.memorized).length;
    const limit = actor.system.stats.int.total;
    if (count > limit) ui.notifications.warn(`Запомнено ${count} рецептов при Инт ${limit}: сверх лимита помогают «Большой каталог» и «Список лекарств» ремесленника.`);
  }
}
