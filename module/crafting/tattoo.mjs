// Татуировки «Офира и Зеррикании» (стр. 78–81): трофей за подвиг. Нанести — проверка против СЛ татуировки;
// провал — чернила потрачены, следующая попытка со СЛ +1. Нанесённая татуировка действует постоянно (поправки —
// как у реликвий, character.mjs) и даёт +1 к Репутации. Мест на теле ограниченно: голова 2, корпус и спина по 4,
// каждая рука и нога по 3. Книга не называет навык нанесения — берём Искусство.

import { TATTOO_LOCATIONS, TATTOO_TIERS } from "../config/items.mjs";
import { postCard } from "../util.mjs";

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const TATTOO_SKILL = "fineArts";

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
  const artists = [actor, ...game.actors.filter(a => a.type === "character" && a.isOwner && a !== actor)];
  const dc = (t.dc || 12) + (t.tries || 0);
  const content = `<div class="vedmak-roll-dialog">
    <p><b>${esc(item.name)}</b> — ${esc(TATTOO_TIERS[t.tier] ?? "")}. Подвиг: ${esc(t.achievement)}.</p>
    <div class="form-group"><label>Место</label><select name="location">${free.map(([k, l]) =>
      `<option value="${k}">${esc(l.label)} (${used[k]} / ${l.max})</option>`).join("")}</select></div>
    <div class="form-group"><label>Кто наносит</label><select name="artist">${artists.map(a =>
      `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div>
    <p class="hint">Искусство против СЛ ${dc}${t.tries ? ` (книжная ${t.dc} + ${t.tries} за прежние неудачи)` : ""}. Нужны набор для татуировки и чернила;
      при провале чернила потрачены, следующая попытка — СЛ +1.</p>
  </div>`;
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: `Татуировка: ${item.name}` }, classes: ["vedmak", "vedmak-dialog"], content,
    buttons: [{ action: "ok", label: "Нанести", default: true,
      callback: (e, b) => ({ location: b.form.elements.location.value, artist: b.form.elements.artist.value }) },
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
