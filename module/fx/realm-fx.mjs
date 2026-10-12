// Звуки и движение листов поселения, постройки, отряда и окна битвы (PLAN 4.212) — те же, что у листа персонажа:
// новая вкладка проявляется со сдвигом, шкалы перетекают от прежней длины к новой, изменившееся число вспыхивает
// (рост — зелёным, убыль — красным); звон монет — когда платят, колокол — «прошла неделя», звуки итога — достроено,
// решение с проверкой; в битве — взмах и удар. Выключено вместе с «Ожившим интерфейсом» (vd-no-anim, fxUi).

import { playSound } from "./sounds.mjs";

const motionOn = () => !document.body.classList.contains("vd-no-anim");
const EASE = "cubic-bezier(.2, .8, .2, 1)";
const NUMS = ".sv-plaque input[type='number'].big, .sv-plaque b.big, .sv-ring b, .sv-res-main input[type='number'], .sv-res-main > b, .sv-workers b, .bt-num";
const BARS = ".sv-bar i";

/** Ключ элемента внутри листа: ближайшие data-id/node/name, имя ресурса, номер пластины — и порядок среди таких же. */
function keyOf(el, root, kind) {
  const parts = [];
  for (let n = el.parentElement; n && n !== root; n = n.parentElement) {
    const d = n.dataset ?? {};
    const own = d.id || d.node || d.name || d.decision || d.order;
    if (own) { parts.push(own); break; }
    if (n.matches?.(".sv-res li")) { parts.push(n.querySelector(".nm")?.textContent.trim() ?? ""); break; }
    if (n.classList?.contains("sv-plaque")) { parts.push("pl" + [...n.parentElement.children].indexOf(n)); break; }
  }
  return `${kind}:${parts.join("/")}`;
}

/** Снимок чисел и шкал листа: ключ → значение. */
function snapshot(root) {
  const nums = new Map(), bars = new Map();
  const seen = new Map();
  const uniq = key => { const i = seen.get(key) ?? 0; seen.set(key, i + 1); return i ? `${key}#${i}` : key; };
  for (const el of root.querySelectorAll(NUMS)) {
    const v = Number(el.value ?? String(el.textContent).replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(v)) nums.set(uniq(keyOf(el, root, "n")), { el, v });
  }
  for (const el of root.querySelectorAll(BARS)) {
    const p = parseFloat(el.style.width);
    if (Number.isFinite(p)) bars.set(uniq(keyOf(el, root, "b")), { el, p });
  }
  return { nums, bars };
}

/**
 * Оживить лист после отрисовки: вкладка сменилась — проявить; числа и шкалы изменились с прошлой отрисовки — показать.
 * Прежний снимок хранится на приложении по ключу документа (другой документ в том же окне — без анимации).
 * @param {object} app — лист или окно
 * @param {HTMLElement} root
 * @param {string} key — uuid документа (или id окна)
 * @param {string} [tab] — открытая вкладка
 */
export function animateRealm(app, root, key, tab = "") {
  if (!root) return;
  const prev = app._vdRealm?.key === key ? app._vdRealm : null;
  const now = snapshot(root);
  app._vdRealm = { key, tab, nums: new Map([...now.nums].map(([k, x]) => [k, x.v])), bars: new Map([...now.bars].map(([k, x]) => [k, x.p])) };
  if (!prev || !motionOn()) return;
  // Новая вкладка — проявляется, как у листа персонажа
  if (tab && prev.tab !== tab) {
    root.querySelector(".sv-scroll")?.animate([{ opacity: 0, translate: "0 8px" }, { opacity: 1, translate: "0 0" }], { duration: 240, easing: EASE });
    return;
  }
  for (const [k, { el, p }] of now.bars) {
    const was = prev.bars.get(k);
    if (was === undefined || was === p) continue;
    el.animate([{ width: `${was}%` }, { width: `${p}%` }], { duration: 520, easing: EASE });
  }
  for (const [k, { el, v }] of now.nums) {
    const was = prev.nums.get(k);
    if (was === undefined || was === v) continue;
    const good = v > was;
    const glow = good ? "0 0 10px rgba(180, 199, 156, .9)" : "0 0 10px rgba(224, 96, 74, .9)";
    el.animate([{ scale: 1.3, color: good ? "#cfe8b0" : "#ffb09a", textShadow: glow }, {}], { duration: 650, easing: EASE });
  }
}

/** Новые строки (постройка, отряд, решение, раунд летописи) — въезжают, как карточки чата. */
export function animateNew(app, root, selector, idOf = el => el.dataset.id ?? el.dataset.decision ?? el.textContent.slice(0, 40)) {
  if (!root) return;
  const ids = new Set([...root.querySelectorAll(selector)].map(idOf));
  const prev = app._vdRealmRows?.[selector];
  app._vdRealmRows = { ...(app._vdRealmRows ?? {}), [selector]: ids };
  if (!prev || !motionOn()) return;
  for (const el of root.querySelectorAll(selector)) {
    if (prev.has(idOf(el))) continue;
    el.animate([{ opacity: 0, translate: "0 10px", filter: "brightness(1.6)" }, { opacity: 1, translate: "0 0", filter: "none" }], { duration: 420, easing: EASE });
  }
}

/* ---------------------------------------------------------------- Звуки по событиям документов */

/** Достроено и освоено после хода недели — звук успеха владельцам; колокол «прошла неделя». */
export function registerRealmFx() {
  Hooks.on("preUpdateActor", (actor, changes, options) => {
    if (actor.type === "building") {
      options.vedmakRealm = { level: actor.system.level, ups: actor.system.upgrades.length, constructing: actor.system.constructing };
    } else if (actor.type === "settlement" && foundry.utils.hasProperty(changes, "system.week")) {
      options.vedmakRealm = { week: actor.system.week, month: actor.system.month };
    } else if (actor.type === "unit") {
      options.vedmakRealm = { training: actor.system.training, ups: actor.system.upgrades.length, rank: actor.system.rank };
    }
  });
  Hooks.on("updateActor", (actor, changes, options) => {
    if (!actor.isOwner) return;
    const was = options.vedmakRealm;
    if (actor.type === "settlement" && foundry.utils.hasProperty(changes, "system.week")) {
      // Колокол, как «твой ход»: неделя прошла (ведущий двигал время)
      playSound("ui-turn");
    } else if (actor.type === "building" && was) {
      if (actor.system.level > was.level || actor.system.upgrades.length > was.ups) playSound("ui-success", { delay: 350 });
    } else if (actor.type === "unit" && was) {
      if (actor.system.training > was.training || actor.system.upgrades.length > was.ups || actor.system.rank > was.rank) playSound("ui-success", { delay: 350 });
    }
  });
}

export { playSound };
