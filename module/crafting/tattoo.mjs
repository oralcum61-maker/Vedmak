// Татуировки «Офира и Зеррикании» (стр. 78–81): трофей за подвиг. Нанести — проверка против СЛ татуировки;
// провал — чернила потрачены, следующая попытка со СЛ +1. Нанесённая татуировка действует постоянно (поправки —
// как у реликвий, character.mjs) и даёт +1 к Репутации. Мест на теле ограниченно: голова 2, корпус и спина по 4,
// каждая рука и нога по 3. Книга не называет навык нанесения — берём Искусство.

import { TATTOO_LOCATIONS, TATTOO_TIERS } from "../config/items.mjs";
import { postCard, renderTemplate } from "../util.mjs";

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const TATTOO_SKILL = "fineArts";
// Кованые значки частей тела в окне (assets/glyphs/part-*.svg): спина — тем же торсом, левые конечности — зеркально
const PLACE_GLYPHS = {
  head: { glyph: "head" }, torso: { glyph: "torso" }, back: { glyph: "torso", flip: true },
  rightArm: { glyph: "arm" }, leftArm: { glyph: "arm", flip: true }, rightLeg: { glyph: "leg" }, leftLeg: { glyph: "leg", flip: true }
};

/** Сколько татуировок уже на каждом месте тела. */
export function tattooSlots(actor) {
  const used = Object.fromEntries(Object.keys(TATTOO_LOCATIONS).map(k => [k, 0]));
  for (const i of actor.itemTypes.gear ?? []) {
    const t = i.system.tattoo;
    if (t?.applied && t.location in used) used[t.location] += 1;
  }
  return used;
}

/** Нанести татуировку: место, кто наносит, проверка Искусства против СЛ (+1 за каждую неудачную попытку). */
export async function applyTattoo(actor, item) {
  const t = item.system.tattoo;
  if (!t || item.system.category !== "tattoo") return null;
  if (t.applied) return ui.notifications.info(`«${item.name}» уже нанесена: ${TATTOO_LOCATIONS[t.location]?.label ?? t.location}.`);
  const used = tattooSlots(actor);
  const free = Object.entries(TATTOO_LOCATIONS).filter(([k, l]) => used[k] < l.max);
  if (!free.length) return ui.notifications.warn(`${actor.name}: места для татуировок не осталось.`);
  // Наносит сам персонаж или другой, которым владеет пользователь («Вы также можете набить татуировку друзьям»)
  // У ведущего «свои» — все персонажи: сам персонаж и пятеро лучших в Искусстве, чтобы окно не разрасталось
  const artBase = a => a.system.skills?.[TATTOO_SKILL]?.base ?? 0;
  const artists = [actor, ...game.actors.filter(a => a.type === "character" && a.isOwner && a !== actor)
    .sort((a, b) => artBase(b) - artBase(a)).slice(0, 5)];
  const dc = (t.dc || 12) + (t.tries || 0);
  // Окно (PLAN 4.98): место — кованой частью тела с занятыми местами, мастер — жетоном с основой Искусства
  const firstFree = free[0]?.[0];
  const content = await renderTemplate("systems/vedmak/templates/dialog/tattoo.hbs", {
    img: item.img, name: item.name, tier: TATTOO_TIERS[t.tier] ?? "", achievement: t.achievement, dc, tries: t.tries || 0,
    effect: item.system.effect,
    places: Object.entries(TATTOO_LOCATIONS).map(([key, l]) => ({
      key, label: l.label, used: used[key], max: l.max, full: used[key] >= l.max, selected: key === firstFree, ...PLACE_GLYPHS[key]
    })),
    artists: artists.map((a, n) => ({ id: a.id, name: a.name, base: a.system.skills?.[TATTOO_SKILL]?.base ?? 0, selected: n === 0 }))
  });
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: `Татуировка: ${item.name}`, icon: "fa-solid fa-pen-nib" },
    classes: ["vedmak", "vedmak-dialog", "check-dialog", "tattoo-window"], position: { width: 520 }, content,
    buttons: [{ action: "ok", label: "Нанести", default: true,
      callback: (e, b) => ({
        location: b.form.querySelector('[name="location"]:checked')?.value ?? firstFree,
        artist: b.form.querySelector('[name="artist"]:checked')?.value ?? actor.id
      }) },
      { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  if (!choice || choice === "cancel") return null;
  const artist = game.actors.get(choice.artist) ?? actor;
  const result = await artist.rollSkill(TATTOO_SKILL, { subtitle: `Татуировка: ${item.name} → ${actor.name}`, dc });
  if (!result) return null;
  const place = TATTOO_LOCATIONS[choice.location]?.label ?? choice.location;
  if (!result.success) {
    await item.update({ "system.tattoo.tries": (t.tries || 0) + 1 });
    return postCard(actor, `Татуировка не удалась: ${esc(item.name)}`,
      `<p>Чернила потрачены, рисунок не закончен. Следующая попытка — СЛ ${dc + 1}.</p>`, { icon: "fa-solid fa-pen-nib" });
  }
  await item.update({ "system.tattoo.applied": true, "system.tattoo.location": choice.location });
  await actor.update({ "system.reputation.value": (actor.system.reputation?.value ?? 0) + 1 });
  return postCard(actor, `Татуировка: ${esc(item.name)}`,
    `<p>Нанесена: <b>${esc(place)}</b>${artist !== actor ? ` (мастер — ${esc(artist.name)})` : ""}.</p>`
    + `<p>${esc(item.system.effect)}</p><p>Репутация +1: ${actor.system.reputation.value}.</p>`,
    { icon: "fa-solid fa-pen-nib" });
}
