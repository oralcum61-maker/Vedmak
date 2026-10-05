// Вживление рун и глифов в тело («Офир и Зеррикания», стр. 84–86). Маг тратит целый день и всю свою Вын.
// СЛ считается от подопытного: глиф — 28 − (Тел + Воля/2)/2; руна — 28 − (Тел + Воля)/2, обычный камень +1,
// большой +2. Книга не называет навык мага — берём Сотворение заклинаний. Успех: руна или глиф приживаются и
// дают малую мутацию (ведьмакам — нет). Провал: приживаются всё равно, но с второй малой мутацией, и она занимает
// место второго мутагена. Вживлённого не больше двух; вживление занимает гнездо мутагена (сделано мутагеном с
// флагом `implant`, поэтому поправки считаются как у мутагенов, character.mjs). Сварог даёт Точность — эффектом
// с `rollMods.attack`; глиф даёт заклинание «Вживлённый глиф: …» из компендиума магии.

import { CRAFTING, IMPLANT_RUNES, IMPLANT_GLYPHS, IMPLANT_TIERS, IMPLANT_LIMIT } from "../config/crafting.mjs";
import { findItemData } from "./craft.mjs";
import { postCard, renderTemplate } from "../util.mjs";

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
  const text = r.text ? `${r.text[tier]} к шансу этого эффекта у ваших атак оружием.` : `+${value} ${r.bonus}.`;
  return { label: `руна ${r.label}`, text, mods, accuracy };
}

/** Окно вживления: что, размер камня, какой маг. */
export async function implantDialog(actor) {
  if (actor?.type !== "character") return null;
  const count = implantsOf(actor).length;
  if (count >= IMPLANT_LIMIT) return ui.notifications.warn(`${actor.name}: уже вживлено ${count} — больше нельзя (стр. 84).`);
  if (usedSockets(actor) >= CRAFTING.mutagenLimit) return ui.notifications.warn(`${actor.name}: все места мутагенов заняты — вживлять некуда.`);
  // Маг — свой персонаж с Энергией (сам подопытный тоже), сильнейшие в Сотворении — первыми; магов нет — сам персонаж
  const castBase = a => a.system.skills?.spellCasting?.base ?? 0;
  const owned = [actor, ...game.actors.filter(a => a.type === "character" && a.isOwner && a !== actor)];
  const withVigor = owned.filter(a => (a.system.derived?.vigor ?? 0) > 0).sort((a, b) => castBase(b) - castBase(a));
  const mages = withVigor.length ? withVigor : [actor];
  const runeDc = implantDc(actor, "rune"), glyphDc = implantDc(actor, "glyph");
  const witcher = actor.system.raceKey === "witcher";
  // Окно (PLAN 4.98): плитки рун и глифов, размер камня и маг — жетонами; СЛ, эффект и мутация — по выбору
  const content = await renderTemplate("systems/vedmak/templates/dialog/implant.hbs", {
    subject: { name: actor.name, img: actor.img }, count, limit: IMPLANT_LIMIT, runeDc, glyphDc, witcher,
    runes: Object.entries(IMPLANT_RUNES).map(([key, r], n) => ({
      key, label: r.label, img: r.img, minor: r.minor, selected: n === 0,
      fx: Object.fromEntries(Object.keys(IMPLANT_TIERS).map(t => [t, implantEffect("rune", key, t).text]))
    })),
    glyphs: Object.entries(IMPLANT_GLYPHS).map(([key, g]) => ({ key, label: g.label, img: g.img, minor: g.minor, fx: implantEffect("glyph", key).text })),
    tiers: Object.entries(IMPLANT_TIERS).map(([key, t], n) => ({ key, label: t.label, dc: t.dc, selected: n === 0 })),
    mages: mages.map((a, n) => ({ id: a.id, name: a.name, base: a.system.skills?.spellCasting?.base ?? 0, selected: n === 0 }))
  });
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: `Вживление: ${actor.name}`, icon: "fa-solid fa-gem" },
    classes: ["vedmak", "vedmak-dialog", "check-dialog", "cast-dialog", "implant-window"], position: { width: 560 }, content,
    render: (event, dialog) => bindImplantDialog(dialog.element),
    buttons: [{ action: "ok", label: "Вживить", default: true,
      callback: (e, b) => {
        const f = b.form;
        const val = name => f.querySelector(`[name="${name}"]:checked`)?.value ?? "";
        return { what: val("what"), tier: val("tier") || "small", mage: val("mage"), spend: f.elements.spend.checked };
      } },
    { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  if (!choice || choice === "cancel") return null;
  const [kind, key] = choice.what.split(".");
  return implant(actor, { kind, key, tier: kind === "rune" ? choice.tier : "", mage: game.actors.get(choice.mage) ?? actor, spend: choice.spend });
}

/** Живое окно вживления: СЛ в медальоне, эффект и мутация выбранного, камень — только у руны. */
function bindImplantDialog(el) {
  const root = el.querySelector(".implant-dialog");
  const form = el.querySelector("form");
  if (!root || !form) return;
  const update = () => {
    const what = form.querySelector('[name="what"]:checked');
    const tier = form.querySelector('[name="tier"]:checked')?.value ?? "small";
    const glyph = what?.dataset.kind === "glyph";
    const dc = glyph ? Number(root.dataset.glyphDc) : Number(root.dataset.runeDc) + (IMPLANT_TIERS[tier]?.dc ?? 0);
    const medal = root.querySelector("[data-implant-dc] .vd-medal-face b");
    if (medal) medal.textContent = String(dc);
    const cap = root.querySelector("[data-implant-dc-cap]");
    if (cap) cap.textContent = glyph ? "глиф" : `${IMPLANT_TIERS[tier]?.label.toLowerCase() ?? ""} камень`;
    const fx = root.querySelector("[data-implant-fx]");
    if (fx) fx.textContent = what?.dataset[`fx${tier[0].toUpperCase()}${tier.slice(1)}`] ?? "";
    const minor = root.querySelector("[data-implant-minor]");
    if (minor) minor.textContent = root.dataset.witcher ? "Ведьмаку малая мутация не грозит." : `Малая мутация: ${what?.dataset.minor ?? "—"}.`;
    root.querySelector("[data-implant-tiers]")?.classList.toggle("off", glyph);
    root.querySelector("[data-implant-spend]")?.classList.toggle("off", glyph);
    const stone = root.querySelector("[data-implant-spend] .plate-value");
    const label = what?.closest(".imp-opt")?.querySelector(".imp-name")?.textContent ?? "";
    if (stone) stone.textContent = glyph ? "не нужен" : `Руна «${label}»`;
    const hint = root.querySelector("[data-implant-hint]");
    if (hint) hint.textContent = `Сотворение заклинаний мага против СЛ ${dc} · провал — вживлено, но с второй мутацией`;
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
