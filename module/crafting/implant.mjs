// Вживление рун и глифов в тело («Офир и Зеррикания», стр. 84–86). Маг тратит целый день и всю свою Вын.
// СЛ считается от подопытного: глиф — 28 − (Тел + Воля/2)/2; руна — 28 − (Тел + Воля)/2, обычный камень +1,
// большой +2. Книга не называет навык мага — берём Сотворение заклинаний. Успех: руна или глиф приживаются и
// дают малую мутацию (ведьмакам — нет). Провал: приживаются всё равно, но с второй малой мутацией, и она занимает
// место второго мутагена. Вживлённого не больше двух; вживление занимает гнездо мутагена (сделано мутагеном с
// флагом `implant`, поэтому поправки считаются как у мутагенов, character.mjs). Сварог даёт Точность — эффектом
// с `rollMods.attack`; глиф даёт заклинание «Вживлённый глиф: …» из компендиума магии.

import { CRAFTING, IMPLANT_RUNES, IMPLANT_GLYPHS, IMPLANT_TIERS, IMPLANT_LIMIT } from "../config/crafting.mjs";
import { findItemData } from "./craft.mjs";
import { postCard } from "../util.mjs";

const SYS = "vedmak";
const BOOK = "Офир и Зеррикания";
const IMPLANT_SKILL = "spellCasting";
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

export const implantsOf = actor => actor.items.filter(i => i.flags?.[SYS]?.implant && !i.flags[SYS].implant.extra);
const usedSockets = actor => actor.items.filter(i => i.type === "alchemical" && i.system.isMutagen && i.system.applied).length;

/** СЛ вживления по параметрам подопытного (округление вниз). */
export function implantDc(actor, kind, tier = "small") {
  const body = actor.system.stats.body?.total ?? 0;
  const will = actor.system.stats.will?.total ?? 0;
  if (kind === "glyph") return 28 - Math.floor((body + Math.floor(will / 2)) / 2);
  return 28 - Math.floor((body + will) / 2) + (IMPLANT_TIERS[tier]?.dc ?? 0);
}

/** Что даёт вживлённое: строка эффекта, поправки, Точность. */
function implantEffect(kind, key, tier) {
  if (kind === "glyph") {
    const g = IMPLANT_GLYPHS[key];
    return { label: `глиф ${g.label}`, text: `Носитель творит «${g.spell}» без фокусирующих предметов; сила — по уровню Энергии.`,
      mods: [], accuracy: 0 };
  }
  const r = IMPLANT_RUNES[key];
  const mods = r.mods?.[tier] ?? [];
  const accuracy = r.accuracy?.[tier] ?? 0;
  const value = mods[0]?.value ?? accuracy;
  const text = r.text ? `${r.text[tier]} к шансу состояния ваших атак (учитывает ведущий).` : `+${value} ${r.bonus}.`;
  return { label: `руна ${r.label}`, text, mods, accuracy };
}

/** Окно вживления: что, размер камня, какой маг. */
export async function implantDialog(actor) {
  if (actor?.type !== "character") return null;
  const count = implantsOf(actor).length;
  if (count >= IMPLANT_LIMIT) return ui.notifications.warn(`${actor.name}: уже вживлено ${count} — больше нельзя (стр. 84).`);
  if (usedSockets(actor) >= CRAFTING.mutagenLimit) return ui.notifications.warn(`${actor.name}: все места мутагенов заняты — вживлять некуда.`);
  // Маг — сам персонаж или другой, которым владеет пользователь; маги (с Энергией) — первыми
  const mages = [actor, ...game.actors.filter(a => a.type === "character" && a.isOwner && a !== actor)]
    .sort((a, b) => (b.system.derived?.vigor > 0) - (a.system.derived?.vigor > 0));
  const runeDc = implantDc(actor, "rune"), glyphDc = implantDc(actor, "glyph");
  const content = `<div class="vedmak-roll-dialog">
    <div class="form-group"><label>Что вживить</label><select name="what">
      <optgroup label="Руны">${Object.entries(IMPLANT_RUNES).map(([k, r]) => `<option value="rune.${k}">Руна «${esc(r.label)}»</option>`).join("")}</optgroup>
      <optgroup label="Глифы знаков">${Object.entries(IMPLANT_GLYPHS).map(([k, g]) => `<option value="glyph.${k}">Глиф ${esc(g.label)}</option>`).join("")}</optgroup>
    </select></div>
    <div class="form-group"><label>Рунный камень</label><select name="tier">${Object.entries(IMPLANT_TIERS).map(([k, t]) =>
      `<option value="${k}">${esc(t.label)}${t.dc ? ` (СЛ +${t.dc})` : ""}</option>`).join("")}</select></div>
    <div class="form-group"><label>Маг</label><select name="mage">${mages.map(a =>
      `<option value="${a.id}">${esc(a.name)}${a.system.derived?.vigor > 0 ? ` · Энергия ${a.system.derived.vigor}` : ""}</option>`).join("")}</select></div>
    <div class="form-group"><label><input type="checkbox" name="spend" checked> Израсходовать рунный камень из сумки, если он есть</label></div>
    <p class="hint">Сотворение заклинаний мага против СЛ: руна ${runeDc} (обычный камень ${runeDc + 1}, большой ${runeDc + 2}),
      глиф ${glyphDc}. Целый день работы, маг тратит всю Вын. Провал — руна или глиф всё равно приживаются, но с второй
      малой мутацией, которая занимает место второго мутагена. Вживлено: ${count} из ${IMPLANT_LIMIT}.</p>
  </div>`;
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: `Вживление: ${actor.name}` }, classes: ["vedmak", "vedmak-dialog"], content,
    buttons: [{ action: "ok", label: "Вживить", default: true,
      callback: (e, b) => {
        const f = b.form.elements;
        return { what: f.what.value, tier: f.tier.value, mage: f.mage.value, spend: f.spend.checked };
      } },
    { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  if (!choice || choice === "cancel") return null;
  const [kind, key] = choice.what.split(".");
  return implant(actor, { kind, key, tier: kind === "rune" ? choice.tier : "", mage: game.actors.get(choice.mage) ?? actor, spend: choice.spend });
}

/** Рунный камень в сумке подопытного или мага (корник называет их «Руна «…»»). */
function findStone(actors, label) {
  const name = `Руна «${label}»`;
  for (const a of actors) {
    const item = a.items.find(i => i.type === "enhancement" && i.name === name);
    if (item) return item;
  }
  return null;
}

async function spendOne(item) {
  const q = item.system.quantity ?? 1;
  if (q > 1) return item.update({ "system.quantity": q - 1 });
  return item.delete();
}

/** Вживить: проверка мага, мутация в гнезде, заклинание глифа или эффект Точности. */
export async function implant(actor, { kind, key, tier = "small", mage = actor, spend = true } = {}) {
  const def = kind === "glyph" ? IMPLANT_GLYPHS[key] : IMPLANT_RUNES[key];
  if (!def) return null;
  const dc = implantDc(actor, kind, tier);
  const name = kind === "glyph" ? `Вживлённый глиф ${def.label}` : `Вживлённая руна «${def.label}» (${IMPLANT_TIERS[tier].label.toLowerCase()} камень)`;
  const result = await mage.rollSkill(IMPLANT_SKILL, { subtitle: `Вживление: ${name} → ${actor.name}`, dc });
  if (!result) return null;
  if (mage.isOwner) await mage.update({ "system.sta.value": 0 });
  const stone = kind === "rune" && spend ? findStone([actor, mage], def.label) : null;
  if (stone) await spendOne(stone);

  const eff = implantEffect(kind, key, tier);
  const witcher = actor.system.raceKey === "witcher";
  const minor = witcher ? "" : def.minor;
  const items = [{
    name, type: "alchemical", img: def.img,
    system: {
      kind: "mutagen", applied: true, quantity: 1, effect: eff.text,
      description: `<p>${esc(eff.text)}</p>${minor ? `<p>Малая мутация: ${esc(minor)}.</p>` : ""}<p>Вживил: ${esc(mage.name)}.</p>`,
      mods: [...eff.mods, ...(kind === "glyph" && !witcher ? def.mods ?? [] : [])],
      mutagen: { color: kind === "glyph" ? "green" : "blue", dc, minor },
      source: { book: BOOK, page: kind === "glyph" ? "84" : "86" }
    },
    flags: { [SYS]: { implant: { kind, key, tier } } }
  }];
  const freeAfter = CRAFTING.mutagenLimit - usedSockets(actor) - 1;
  if (!result.success && freeAfter > 0) items.push({
    name: `Вторая мутация: ${def.label}`, type: "alchemical", img: "icons/magic/unholy/strike-body-life-soul-purple.webp",
    system: {
      kind: "mutagen", applied: true, quantity: 1, effect: "Провал вживления: вторая малая мутация занимает место второго мутагена.",
      description: "<p>Провал вживления: вторая малая мутация (какая — решает ведущий). Место второго мутагена занято.</p>",
      mutagen: { color: "red", dc, minor: "вторая малая мутация (по решению ведущего)" }, source: { book: BOOK, page: "84" }
    },
    flags: { [SYS]: { implant: { kind, key, tier, extra: true } } }
  });
  const [created, extra] = await actor.createEmbeddedDocuments("Item", items);

  const lines = [`<p>${esc(eff.text)}</p>`];
  if (eff.accuracy) {
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name, img: def.img, description: `+${eff.accuracy} к Точности: броски атаки.`,
      flags: { [SYS]: { rollMods: { attack: eff.accuracy }, implantOf: created.id } }
    }]);
  }
  if (kind === "glyph") {
    const data = await findItemData(def.spell, "spell");
    data.flags = foundry.utils.mergeObject(data.flags ?? {}, { [SYS]: { implantOf: created.id } });
    await actor.createEmbeddedDocuments("Item", [data]);
    lines.push(`<p>Заклинание «${esc(def.spell)}» — на вкладке «Магия». Энергию даёт только руна Велес.</p>`);
  }
  if (minor) lines.push(`<p>Малая мутация: ${esc(minor)}.</p>`);
  if (!result.success) lines.push(extra
    ? "<p><b>Провал:</b> вторая малая мутация (какая — решает ведущий) заняла место второго мутагена.</p>"
    : "<p><b>Провал:</b> вторая малая мутация (какая — решает ведущий); места мутагенов уже заняты.</p>");
  if (stone) lines.push(`<p>Израсходован камень «${esc(stone.name)}» (${esc(stone.parent?.name)}).</p>`);
  lines.push(`<p>Вживил ${esc(mage.name)}: целый день работы, вся Вын потрачена.</p>`);
  return postCard(actor, result.success ? "Вживление удалось" : "Вживление с осложнением", lines.join(""),
    { subtitle: name, icon: "fa-solid fa-gem" });
}

/** Удалили вживлённое — убрать и его эффект Точности, заклинание глифа и вторую мутацию. */
export function registerImplantHooks() {
  Hooks.on("deleteItem", (item, options, userId) => {
    const imp = item.flags?.[SYS]?.implant;
    const actor = item.parent;
    if (!imp || imp.extra || userId !== game.user.id || !actor) return;
    const linked = i => i.flags?.[SYS]?.implantOf === item.id;
    const items = actor.items.filter(i => linked(i) || (i.flags?.[SYS]?.implant?.extra && i.flags[SYS].implant.key === imp.key)).map(i => i.id);
    const effects = actor.effects.filter(linked).map(e => e.id);
    if (items.length) actor.deleteEmbeddedDocuments("Item", items);
    if (effects.length) actor.deleteEmbeddedDocuments("ActiveEffect", effects);
  });
}
