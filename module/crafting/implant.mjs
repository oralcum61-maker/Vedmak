// Вживление рун и глифов в тело («Офир и Зеррикания», стр. 84–86). Маг тратит целый день и всю свою Вын.
// СЛ считается от подопытного: глиф — 28 − (Тел + Воля/2)/2; руна — 28 − (Тел + Воля)/2, обычный камень +1,
// большой +2. Книга не называет навык мага — берём Сотворение заклинаний. Успех: руна или глиф приживаются и
// дают малую мутацию (ведьмакам — нет). Провал: приживаются всё равно, но со второй малой мутацией. Вживлённого не
// больше двух, и гнёзд мутагенов оно не занимает (автор, 07.10): это мутаген с флагом `implant` только ради
// поправок (считаются как у мутагенов, character.mjs), из счёта гнёзд он исключён. Сварог даёт Точность — эффектом
// с `rollMods.attack`; глиф даёт заклинание «Вживлённый глиф: …» из компендиума магии.

import { IMPLANT_RUNES, IMPLANT_GLYPHS, IMPLANT_TIERS, IMPLANT_LIMIT } from "../config/crafting.mjs";
import { findItemData } from "./craft.mjs";
import { RACES } from "../config/character.mjs";
import { postCard, renderTemplate } from "../util.mjs";

const SYS = "vedmak";
const BOOK = "Офир и Зеррикания";
const IMPLANT_SKILL = "spellCasting";
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

export const implantsOf = actor => actor.items.filter(i => i.flags?.[SYS]?.implant && !i.flags[SYS].implant.extra);

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
  const text = r.text ? `${r.text[tier]} к шансу этого эффекта у ваших атак оружием.` : `+${value} ${r.bonus}.`;
  return { label: `руна ${r.label}`, text, mods, accuracy };
}

/** Шанс проверки «основа + d10 больше СЛ»: единица — провал, десятка взрывается (примерно). */
export function checkChance(base, dc) {
  const need = dc - base + 1;
  let p;
  if (need <= 2) p = 0.9;
  else if (need <= 10) p = (11 - need) / 10;
  else p = 0.1 * Math.max(0, 11 - (need - 10)) / 10;
  return {
    chance: p <= 0 ? "0%" : p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`,
    need: need <= 2 ? "провал только на единице" : need <= 10 ? `нужно ${need}+ на d10` : "только взрыв десятки"
  };
}

/** Короткая сила руны на камне: «+2», «+10 %». */
function tierValue(key, tier) {
  const r = IMPLANT_RUNES[key];
  const n = r.mods?.[tier]?.[0]?.value ?? r.accuracy?.[tier];
  if (n !== undefined) return `+${n}`;
  return r.text?.[tier]?.match(/\+\s*\d+\s*%/)?.[0].replace(/\s+/g, " ") ?? "";
}

/** Окно вживления: что, размер камня, какой маг (облик — PLAN 4.121). */
export async function implantDialog(actor) {
  if (actor?.type !== "character") return null;
  const count = implantsOf(actor).length;
  if (count >= IMPLANT_LIMIT) return ui.notifications.warn(`${actor.name}: уже вживлено ${count} — больше нельзя (стр. 84).`);
  // Маг — свой персонаж с Энергией (сам подопытный тоже), сильнейшие в Сотворении — первыми; магов нет — сам персонаж
  const castBase = a => a.system.skills?.spellCasting?.base ?? 0;
  const owned = [actor, ...game.actors.filter(a => a.type === "character" && a.isOwner && a !== actor)];
  const withVigor = owned.filter(a => (a.system.derived?.vigor ?? 0) > 0).sort((a, b) => castBase(b) - castBase(a));
  const mages = withVigor.length ? withVigor : [actor];
  const runeDc = implantDc(actor, "rune"), glyphDc = implantDc(actor, "glyph");
  const witcher = actor.system.raceKey === "witcher";
  // Рунные камни в сумках подопытного и магов — отметка на камне и строка «в сумке»
  const bagOf = label => [actor, ...mages.filter(m => m !== actor)].reduce((n, a) => n + a.items
    .filter(i => i.type === "enhancement" && i.name === `Руна «${label}»`).reduce((q, i) => q + (i.system.quantity ?? 1), 0), 0);
  const stats = actor.system.stats;
  const race = RACES[actor.system.raceKey]?.label ?? "";
  const content = await renderTemplate("systems/vedmak/templates/dialog/implant.hbs", {
    subject: { name: actor.name, img: actor.img,
      sub: [race.toLowerCase(), `Тел ${stats.body?.total ?? 0}`, `Воля ${stats.will?.total ?? 0}`].filter(Boolean).join(" · ") },
    count, limit: IMPLANT_LIMIT, slots: Array.from({ length: IMPLANT_LIMIT }, (_, n) => ({ full: n < count })),
    runeDc, glyphDc, witcher,
    runes: Object.entries(IMPLANT_RUNES).map(([key, r], n) => ({
      key, label: r.label, img: r.img, minor: r.minor, selected: n === 0, bag: bagOf(r.label),
      bonus: r.bonus ?? `к шансу: ${(r.text?.small ?? "").replace(/\s*\+.*$/, "").toLowerCase()} у атак оружием`,
      v: Object.fromEntries(Object.keys(IMPLANT_TIERS).map(t => [t, tierValue(key, t)]))
    })),
    glyphs: Object.entries(IMPLANT_GLYPHS).map(([key, g]) => ({ key, label: g.label, img: g.img, minor: g.minor, spell: g.spell })),
    tiers: Object.entries(IMPLANT_TIERS).map(([key, t], n) => ({ key, label: t.label, dc: t.dc, selected: n === 0 })),
    mages: mages.map((a, n) => ({ id: a.id, name: a.name, img: a.img, base: castBase(a), sta: a.system.sta?.value ?? 0, selected: n === 0 }))
  });
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: `Вживление: ${actor.name}`, icon: "fa-solid fa-gem" },
    classes: ["vedmak", "vedmak-dialog", "check-dialog", "cast-dialog", "implant-window"], position: { width: 660 }, content,
    render: (event, dialog) => bindImplantDialog(dialog.element),
    buttons: [{ action: "ok", label: "Вживить", default: true, class: "violet",
      callback: (e, b) => {
        const f = b.form;
        const val = name => f.querySelector(`[name="${name}"]:checked`)?.value ?? "";
        return { what: val("what"), tier: val("tier") || "small", mage: val("mage"), spend: !!f.elements.spend?.checked };
      } },
    { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  if (!choice || choice === "cancel") return null;
  const [kind, key] = choice.what.split(".");
  return implant(actor, { kind, key, tier: kind === "rune" ? choice.tier : "", mage: game.actors.get(choice.mage) ?? actor, spend: choice.spend });
}

/** Живое окно вживления: вкладка рун или глифов, СЛ и шанс, карточка выбранного, маг и камень из сумки. */
function bindImplantDialog(el) {
  const root = el.querySelector(".imp2");
  const form = el.querySelector("form");
  if (!root || !form) return;
  const $ = sel => root.querySelector(sel);
  const cap = t => t[0].toUpperCase() + t.slice(1);
  const update = () => {
    const kind = form.querySelector('[name="kind"]:checked')?.value ?? "rune";
    const glyph = kind === "glyph";
    for (const g of root.querySelectorAll(".imp2-grid")) g.hidden = g.dataset.kind !== kind;
    let what = form.querySelector('[name="what"]:checked');
    if (!what || what.dataset.kind !== kind) {
      what = root.querySelector(`.imp2-grid[data-kind="${kind}"] input`);
      if (what) what.checked = true;
    }
    if (!what) return;
    const d = what.dataset;
    const tier = form.querySelector('[name="tier"]:checked')?.value ?? "small";
    const runeDc = Number(root.dataset.runeDc);
    const dc = glyph ? Number(root.dataset.glyphDc) : runeDc + (IMPLANT_TIERS[tier]?.dc ?? 0);
    const mage = form.querySelector('[name="mage"]:checked');
    const { chance, need } = checkChance(Number(mage?.dataset.base ?? 0), dc);
    $("[data-imp-dc]").textContent = String(dc);
    $("[data-imp-dc-cap]").textContent = `шанс · СЛ ${dc}`;
    $("[data-imp-chance]").textContent = chance;
    $("[data-imp-need]").textContent = need;
    $("[data-imp-img]").src = d.img;
    $("[data-imp-name]").textContent = d.label;
    $("[data-imp-kind]").textContent = glyph ? "глиф знака · заклинание без фокусирующих предметов"
      : `руна · ${d[`v${cap(tier)}`]} ${d.bonus}`;
    for (const t of Object.keys(IMPLANT_TIERS)) {
      const v = root.querySelector(`[data-tier-v="${t}"]`);
      if (v) v.textContent = d[`v${cap(t)}`] ?? "";
      const c = root.querySelector(`[data-tier-dc="${t}"]`);
      if (c) c.textContent = String(runeDc + (IMPLANT_TIERS[t]?.dc ?? 0));
    }
    $("[data-imp-tiers]").hidden = glyph;
    $("[data-imp-spell]").hidden = !glyph;
    $("[data-imp-spell-text]").textContent = glyph ? `«${d.spell}» — творится без фокусирующих предметов, сила по уровню Энергии. Энергию даёт только руна Велес.` : "";
    $("[data-imp-minor]").textContent = root.dataset.witcher ? "Ведьмаку малая мутация не грозит." : `${d.minor}.`;
    const plate = $("[data-imp-spend]");
    plate.hidden = glyph;
    $("[data-imp-noglyph]").hidden = !glyph;
    const bag = Number(d.bag ?? 0);
    const box = form.elements.spend;
    box.disabled = !bag;
    if (!bag) box.checked = false;
    $("[data-imp-spend-text]").textContent = `Израсходовать камень «Руна «${d.label}»» из сумки`;
    const bagEl = $("[data-imp-bag]");
    bagEl.textContent = bag ? `в сумке: ${bag}` : "камня нет — решает ведущий";
    bagEl.classList.toggle("ok", !!bag);
    $("[data-imp-hint]").textContent = `Целый день работы, вся Вын мага уйдёт (${mage?.dataset.sta ?? 0} → 0). ${mage?.dataset.name ?? ""} — Сотворение заклинаний против СЛ ${dc}; провал — вживлено, но со второй малой мутацией.`;
  };
  form.addEventListener("change", update);
  update();
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
  if (!result.success) items.push({
    name: `Вторая мутация: ${def.label}`, type: "alchemical", img: "icons/magic/unholy/strike-body-life-soul-purple.webp",
    system: {
      kind: "mutagen", applied: true, quantity: 1, effect: "Провал вживления: вторая малая мутация (какая — решает ведущий).",
      description: "<p>Провал вживления: вторая малая мутация (какая — решает ведущий).</p>",
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
  if (!result.success && extra) lines.push("<p><b>Провал:</b> вживлено, но со второй малой мутацией (какая — решает ведущий).</p>");
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
