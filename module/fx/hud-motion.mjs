// Движение худа «Медальон на цепи» (PLAN 4.163). Играет только то, что изменилось с прошлой отрисовки того же
// актора: удар и лечение, Выносливость, Энергия, начало своего хода, новые камешки, потраченная Удача, открытие списка.
// Всё — Web Animations (element.animate, без принудительного пересчёта раскладки) и только transform и opacity
// HTML-слоёв поверх медальона; дуги — длиной штриха в своём слое SVG (hm-arcs), неподвижный рисунок не перерисовывается.
// Выключено, если на body стоит vd-no-anim («Оживший интерфейс» выключен или системное «меньше движения»).

const motionOn = () => !document.body.classList.contains("vd-no-anim");
const EASE = "cubic-bezier(.2, .8, .2, 1)";
const BACK = "cubic-bezier(.2, .8, .2, 1.35)";

/** Число докатывается до нового значения. */
function roll(node, from, to, ms = 450) {
  if (!node || from === to) return;
  const t0 = performance.now();
  const step = t => {
    const p = Math.min(1, (t - t0) / ms), e = 1 - (1 - p) ** 3;
    node.textContent = String(Math.round(from + (to - from) * e));
    if (p < 1 && node.isConnected) requestAnimationFrame(step);
  };
  node.textContent = String(from);
  requestAnimationFrame(step);
}

/** Длина дуги едет от прежней к новой. */
function sweep(medal, selector, from, to, opts = {}) {
  if (from === to) return;
  for (const path of medal.querySelectorAll(selector)) {
    path.animate([{ strokeDasharray: `${from} 100` }, { strokeDasharray: `${to} 100` }],
      { duration: 450, easing: EASE, fill: "backwards", ...opts });
  }
}

/** Всплывающая надпись над медальоном: «−8», «+5 вын». */
function float(medal, text, cls) {
  const el = document.createElement("span");
  el.className = `hm-float ${cls}`;
  el.textContent = text;
  medal.append(el);
  el.animate([
    { opacity: 0, transform: "translate(-50%, 6px) scale(.8)" },
    { opacity: 1, transform: "translate(-50%, -6px) scale(1.1)", offset: .15 },
    { opacity: 0, transform: "translate(-50%, -48px) scale(1)" }
  ], { duration: 1150, easing: EASE }).finished.then(() => el.remove(), () => el.remove());
}

const flash = (el, peak = .5, duration = 500) => el?.animate([{ opacity: 0 }, { opacity: peak, offset: .18 }, { opacity: 0 }], { duration, easing: "ease-out" });

/**
 * @param {object} app — худ; прежнее состояние хранится на нём
 * @param {HTMLElement} root — элемент худа
 * @param {{id: string, hp: number, hpPct: number, sta: number, staPct: number, en: number|null, enPct: number|null,
 *   luck: number|null, turn: boolean, stones: string[], popIn: string|null}} now
 */
export function hudMotion(app, root, now) {
  const prev = app._hmPrev?.id === now.id ? app._hmPrev : null;
  app._hmPrev = now;
  if (!motionOn() || !root) return;
  const medal = root.querySelector(".hm-medal");

  // Список только что открыт: всплывает от цепи, строки — лесенкой (только первые, дальше — сразу)
  if (now.popIn) {
    const pop = root.querySelector(".hm-pop");
    pop?.animate([{ opacity: 0, transform: "translateY(12px) scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: EASE });
    const items = pop ? [...pop.querySelectorAll(".hm-cap, .hm-btn, .hm-save, .hm-flask, .hm-fav, .hm-sp, .hm-orow, .hm-stc, .hm-tox, .hm-find, .hm-kinds")].slice(0, 16) : [];
    items.forEach((el, i) => el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
      { duration: 260, delay: 60 + i * 18, easing: EASE, fill: "backwards" }));
  }
  if (!prev || !medal) return;

  // ПЗ: дуга падает, светлый след догорает с задержкой; медальон вздрагивает, портрет вспыхивает
  if (now.hp !== prev.hp) {
    sweep(medal, ".hm-arc.hp", prev.hpPct, now.hpPct);
    roll(medal.querySelector(".hm-num.hp b"), prev.hp, now.hp);
    if (now.hp < prev.hp) {
      sweep(medal, ".hm-trail", prev.hpPct, now.hpPct, { duration: 700, delay: 550, easing: "cubic-bezier(.4, 0, .2, 1)" });
      medal.animate([
        { transform: "none" }, { transform: "translate(-3px, 1px) rotate(-1deg)", offset: .2 }, { transform: "translate(3px, -1px) rotate(1deg)", offset: .4 },
        { transform: "translate(-2px, 0)", offset: .6 }, { transform: "translate(1px, 0)", offset: .8 }, { transform: "none" }
      ], { duration: 340, easing: "cubic-bezier(.36, .07, .19, .97)" });
      flash(medal.querySelector(".hm-flash"));
      float(medal, `−${prev.hp - now.hp}`, "dmg l");
    } else {
      flash(medal.querySelector(".hm-heal"), .45, 600);
      float(medal, `+${now.hp - prev.hp}`, "heal l");
    }
  }
  // Выносливость и Энергия
  if (now.sta !== prev.sta) {
    sweep(medal, ".hm-arc.sta", prev.staPct, now.staPct);
    roll(medal.querySelector(".hm-num.sta b"), prev.sta, now.sta);
    float(medal, `${now.sta > prev.sta ? "+" : "−"}${Math.abs(now.sta - prev.sta)} вын`, "sta r");
  }
  if (now.en !== null && prev.en !== null && now.en !== prev.en) {
    sweep(medal, ".hm-arc.en", prev.enPct, now.enPct);
    // Потрачена Энергия — по ободу проходит волна
    if (now.en < prev.en) medal.querySelector(".hm-burst")?.animate(
      [{ opacity: .9, transform: "scale(.82)" }, { opacity: 0, transform: "scale(1.22)" }], { duration: 700, easing: EASE });
  }
  // Начался свой ход: латунное кольцо разгорается, табличка опускается с бликом
  if (now.turn && !prev.turn) {
    medal.querySelector(".hm-ring")?.animate([{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "none" }], { duration: 450, easing: BACK });
    const plate = medal.querySelector(".hm-endturn");
    plate?.animate([{ opacity: 0, transform: "translate(-50%, -10px)" }, { opacity: 1, transform: "translate(-50%, 0)" }],
      { duration: 400, delay: 120, easing: BACK, fill: "backwards" });
    plate?.querySelector(".hm-sheen")?.animate([{ opacity: 1, transform: "translateX(0) skewX(-18deg)" }, { opacity: 1, transform: "translateX(560%) skewX(-18deg)" }],
      { duration: 1100, delay: 450, easing: "ease-out" });
  }
  // Новый камешок выскакивает
  const old = new Set(prev.stones);
  for (const key of now.stones) {
    if (old.has(key)) continue;
    root.querySelector(`.hm-stone[data-key="${CSS.escape(key)}"]`)?.animate([
      { opacity: 0, transform: "translate(-50%, -50%) scale(0)" },
      { opacity: 1, transform: "translate(-50%, -50%) scale(1.2)", offset: .6 },
      { transform: "translate(-50%, -50%) scale(1)" }
    ], { duration: 500, easing: BACK });
  }
  // Потрачена Удача: погасшие монеты переворачиваются
  if (prev.luck !== null && now.luck !== null && now.luck < prev.luck) {
    const coins = [...medal.querySelectorAll(".hm-coin")];
    coins.slice(now.luck, prev.luck).forEach((coin, i) => coin.animate([
      { transform: "scaleX(1)" }, { transform: "scaleX(0)", offset: .5 }, { transform: "scaleX(1)" }
    ], { duration: 380, delay: i * 90, easing: "ease-in-out" }));
    float(medal, `Удача −${prev.luck - now.luck}`, "luck");
  }
}
