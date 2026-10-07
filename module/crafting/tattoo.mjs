// Татуировки «Офира и Зеррикании» (стр. 78–81): трофей за подвиг. Нанести — проверка против СЛ татуировки;
// провал — чернила потрачены, следующая попытка со СЛ +1. Нанесённая татуировка действует постоянно (поправки —
// как у реликвий, character.mjs) и даёт +1 к Репутации. Мест на теле ограниченно: голова 2, корпус и спина по 4,
// каждая рука и нога по 3. Книга не называет навык нанесения — берём Искусство.

import { TATTOO_LOCATIONS, TATTOO_TIERS } from "../config/items.mjs";
import { postCard, renderTemplate } from "../util.mjs";
import { checkChance } from "./implant.mjs";

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const TATTOO_SKILL = "fineArts";
// Фигура для окна (PLAN 4.121): силуэт одним контуром (посчитан полем расстояний, как рука в «Филе»), зоны мест
// вырезаны из него многоугольниками. Спереди правая сторона тела — слева от зрителя, сзади — наоборот.
const BODY = "M60.0 4.5 L58.0 4.7 L56.4 5.1 L54.8 5.9 L53.2 7.0 L51.8 8.4 L50.8 9.9 L50.1 11.6 L49.7 13.2 L49.5 15.6 L50.1 20.4 L50.3 25.6 L50.6 28.4 L51.5 31.2 L53.5 34.8 L54.5 37.2 L54.9 39.2 L54.4 40.6 L53.6 41.6 L52.6 42.4 L46.4 45.2 L43.2 46.2 L39.2 46.8 L37.6 47.4 L36.3 48.4 L35.1 49.6 L34.1 51.2 L33.5 52.8 L29.2 90.8 L28.1 95.6 L28.3 100.4 L26.0 130.8 L25.0 135.2 L24.9 150.0 L25.1 151.2 L25.6 152.0 L26.4 152.7 L27.2 153.0 L28.4 153.1 L29.2 152.9 L30.0 152.4 L30.7 151.6 L31.0 150.8 L33.0 136.0 L33.0 134.8 L32.6 132.4 L32.6 131.2 L36.7 101.2 L37.9 96.4 L38.1 92.4 L42.4 68.6 L42.8 67.4 L43.2 67.0 L43.6 67.5 L44.0 69.1 L45.9 87.6 L45.9 90.4 L45.5 95.6 L45.7 103.2 L44.1 113.6 L43.5 115.2 L41.0 120.4 L40.5 122.4 L40.4 124.0 L42.2 179.2 L41.9 184.0 L42.5 189.2 L43.6 233.6 L43.4 237.6 L41.3 246.4 L41.2 247.2 L41.4 248.0 L42.0 249.0 L42.8 249.5 L44.0 249.8 L45.2 249.5 L46.0 249.0 L46.4 248.4 L50.2 239.6 L50.6 238.4 L50.4 233.6 L53.3 189.6 L54.1 184.4 L54.1 179.6 L57.9 141.6 L58.5 140.0 L59.2 139.5 L60.0 139.3 L60.8 139.5 L61.4 140.0 L62.1 141.6 L65.9 179.6 L65.9 184.4 L66.7 189.6 L69.6 233.6 L69.5 238.8 L73.4 248.0 L74.0 249.0 L75.2 249.7 L76.8 249.7 L78.0 249.0 L78.7 247.6 L78.7 246.4 L76.6 237.6 L76.4 233.6 L77.5 189.2 L78.1 184.0 L77.8 179.2 L79.6 123.6 L79.4 122.0 L79.0 120.4 L76.3 114.8 L75.7 112.4 L74.3 103.2 L74.5 95.6 L74.0 89.2 L74.1 86.8 L75.6 72.4 L76.0 69.1 L76.4 67.5 L76.8 67.0 L77.2 67.4 L78.0 70.3 L81.9 92.4 L82.2 96.8 L83.3 101.2 L87.4 131.6 L87.0 136.0 L89.0 150.8 L89.6 152.0 L90.4 152.7 L91.2 153.0 L92.4 153.1 L93.6 152.7 L94.4 152.0 L94.9 151.2 L95.1 150.4 L95.0 135.2 L94.0 130.8 L91.7 100.4 L91.9 95.6 L90.8 90.8 L86.5 52.8 L85.9 51.2 L84.9 49.6 L83.7 48.4 L82.4 47.4 L80.8 46.8 L76.8 46.2 L73.6 45.2 L67.4 42.4 L66.4 41.6 L65.6 40.6 L65.1 39.2 L65.5 37.2 L66.5 34.8 L68.5 31.2 L69.4 28.4 L69.7 25.6 L69.9 20.4 L70.5 15.6 L70.3 13.2 L69.9 11.6 L69.2 9.9 L68.2 8.4 L66.8 7.0 L65.2 5.9 L63.6 5.1 L62.0 4.7 Z";
const ZONE_CLIPS = {
  head: "M0 0H120V43H0Z", torso: "M41 43H79L76.6 67L80 130H40L43.4 67Z",
  armL: "M0 43H41L43.4 67L40 130L36 160H0Z", armR: "M120 43H79L76.6 67L80 130L84 160H120Z",
  legL: "M40 130H60V258H0V160H36Z", legR: "M80 130H60V258H120V160H84Z"
};
const FRONT = { head: "head", torso: "torso", armL: "rightArm", armR: "leftArm", legL: "rightLeg", legR: "leftLeg" };
const BACK = { head: "head", torso: "back", armL: "leftArm", armR: "rightArm", legL: "leftLeg", legR: "rightLeg" };
// Где рисовать уже набитые татуировки (ромбиками): спереди всё, кроме спины; спина — на фигуре сзади
const INK_SPOTS = {
  head: [[56, 18], [64, 26]], torso: [[52, 80], [68, 80], [52, 100], [68, 100]], back: [[52, 70], [68, 70], [52, 95], [68, 95]],
  rightArm: [[36.5, 72], [33.2, 95], [30.8, 118]], leftArm: [[83.5, 72], [86.8, 95], [89.2, 118]],
  rightLeg: [[49, 165], [48, 195], [47, 220]], leftLeg: [[71, 165], [72, 195], [73, 220]]
};
let figureSeq = 0;

/** SVG фигуры: зоны с `data-place`, занятые — штриховкой, набитое — ромбиками. */
function figureSvg(used) {
  const id = `vdtat${++figureSeq}`;
  const clips = Object.entries(ZONE_CLIPS).map(([k, d]) => `<clipPath id="${id}-${k}"><path d="${d}"/></clipPath>`).join("");
  const zones = map => Object.entries(map).map(([zone, place]) => {
    const full = used[place] >= TATTOO_LOCATIONS[place].max;
    return `<use href="#${id}-body" clip-path="url(#${id}-${zone})" class="tat2-z${full ? " full" : ""}" data-place="${place}"><title>${TATTOO_LOCATIONS[place].label}: ${used[place]} из ${TATTOO_LOCATIONS[place].max}</title></use>`;
  }).join("");
  const ink = places => places.flatMap(place => (INK_SPOTS[place] ?? []).slice(0, used[place])
    .map(([x, y]) => `<rect x="${x - 2}" y="${y - 2}" width="4" height="4" transform="rotate(45 ${x} ${y})"/>`)).join("");
  const seams = `<g clip-path="url(#${id}-sil)" class="tat2-seam"><path d="M50 43H70M41 43L43.4 67L40 130M79 43L76.6 67L80 130M40 130H80M60 130V142"/></g>`;
  const outline = `<use href="#${id}-body" class="tat2-outline"/>`;
  return `<svg viewBox="0 0 260 258" aria-hidden="true"><defs><path id="${id}-body" d="${BODY}"/><clipPath id="${id}-sil"><path d="${BODY}"/></clipPath>${clips}`
    + `<radialGradient id="${id}-skin" gradientUnits="userSpaceOnUse" cx="60" cy="92" r="125"><stop offset="0" stop-color="#ead5b2" stop-opacity=".36"/><stop offset=".55" stop-color="#c9a983" stop-opacity=".22"/><stop offset="1" stop-color="#8a6a4a" stop-opacity=".14"/></radialGradient>`
    + `<pattern id="${id}-hatch" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)"><rect width="4" height="4" fill="rgba(18,12,8,.62)"/><path d="M0 0V4" stroke="rgba(234,213,178,.28)" stroke-width="1"/></pattern></defs>`
    + `<g style="--hatch:url(#${id}-hatch)"><use href="#${id}-body" fill="url(#${id}-skin)"/>${zones(FRONT)}`
    + `<path class="tat2-hint" d="M47.5 50Q53 48.4 57.5 51M72.5 50Q67 48.4 62.5 51M48 72Q54 76 59 73M72 72Q66 76 61 73M44.3 184Q48 186.5 51.7 184M75.7 184Q72 186.5 68.3 184"/>`
    + `<circle cx="60" cy="106" r=".9" class="tat2-dot"/>${seams}<g class="tat2-ink">${ink(["head", "torso", "rightArm", "leftArm", "rightLeg", "leftLeg"])}</g>${outline}</g>`
    + `<g transform="translate(140 0)" style="--hatch:url(#${id}-hatch)"><use href="#${id}-body" fill="url(#${id}-skin)"/>${zones(BACK)}`
    + `<path class="tat2-hint" d="M60 47V126M48 60Q51 74 56.5 71M72 60Q69 74 63.5 71M47 128Q53 133 59.4 131M73 128Q67 133 60.6 131M44.5 186Q48 184 51.5 186M75.5 186Q72 184 68.5 186"/>`
    + `${seams}<g class="tat2-ink">${ink(["back"])}</g>${outline}</g></svg>`;
}

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
  const baseDc = t.dc || 12;
  const dc = baseDc + (t.tries || 0);
  // Окно (PLAN 4.121): карточка с СЛ и шансом, фигура и места, мастер жетоном
  const firstFree = free[0]?.[0];
  const effect = String(item.system.effect ?? "").replace(/\s*Каждая татуировка — трофей.*$/s, "").trim();
  const content = await renderTemplate("systems/vedmak/templates/dialog/tattoo.hbs", {
    img: item.img, title: item.name.replace(/^Татуировка\s+/, ""), tier: (TATTOO_TIERS[t.tier] ?? "").toLowerCase(),
    size: t.size ? String(t.size).replace(".", ",") : "", achievement: t.achievement, baseDc, dc, tries: t.tries || 0,
    gives: [effect.replace(/\.$/, ""), "Репутация +1"].filter(Boolean).join(" · "),
    places: Object.entries(TATTOO_LOCATIONS).map(([key, l]) => ({
      key, label: l.label, used: used[key], max: l.max, full: used[key] >= l.max, selected: key === firstFree,
      pips: Array.from({ length: l.max }, (_, n) => n < used[key])
    })),
    artists: artists.map((a, n) => ({ id: a.id, name: a.name, img: a.img, base: artBase(a), selected: n === 0 }))
  });
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: `Татуировка: ${actor.name}`, icon: "fa-solid fa-pen-nib" },
    classes: ["vedmak", "vedmak-dialog", "check-dialog", "tattoo-window"], position: { width: 660 }, content,
    render: (event, dialog) => bindTattooDialog(dialog.element, used),
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

/** Живое окно татуировки: фигура (рисуется здесь — DialogV2 вычищает SVG из разметки) связана со списком мест,
 *  шанс и подсказка — по выбранному мастеру. */
function bindTattooDialog(el, used) {
  const root = el.querySelector(".tat2");
  const form = el.querySelector("form");
  if (!root || !form) return;
  const host = root.querySelector("[data-tat-figure]");
  host.innerHTML = figureSvg(used);
  host.addEventListener("click", event => {
    const zone = event.target.closest("[data-place]");
    const input = zone && form.querySelector(`[name="location"][value="${zone.dataset.place}"]`);
    if (!input || input.disabled) return;
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const update = () => {
    const place = form.querySelector('[name="location"]:checked')?.value;
    for (const z of host.querySelectorAll("[data-place]")) z.classList.toggle("sel", z.dataset.place === place);
    const artist = form.querySelector('[name="artist"]:checked');
    const dc = Number(root.dataset.dc);
    const { chance, need } = checkChance(Number(artist?.dataset.base ?? 0), dc);
    root.querySelector("[data-tat-chance]").textContent = chance;
    const needEl = root.querySelector("[data-tat-need]");
    if (needEl) needEl.textContent = need;
    const where = TATTOO_LOCATIONS[place]?.label.toLowerCase() ?? "место не выбрано";
    root.querySelector("[data-tat-hint]").textContent = `${artist?.dataset.name ?? ""} — Искусство против СЛ ${dc} · ${where}. `
      + "Нужны набор для татуировки и чернила; провал — чернила потрачены, СЛ ещё +1; успех — Репутация +1.";
  };
  form.addEventListener("change", update);
  update();
}
