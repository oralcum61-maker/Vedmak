// Движение в листах (PLAN 4.67, 4.73): смена вкладки, шкалы ПЗ/Вын/Токсичности, вспышка числа. Включается только на
// само изменение, а не на каждую перерисовку — иначе лист мигал бы от любой правки. Выключено, если на body
// стоит vd-no-anim (настройка «Оживший интерфейс» или системное «меньше движения»).
//
// Всё — через Web Animations (element.animate): анимация стартует без принудительного пересчёта раскладки.
// Прежний способ (снять класс, прочитать offsetWidth, вернуть класс) заставлял браузер пересчитывать весь лист
// синхронно — 40–50 мс на каждое переключение вкладки и на каждое изменение ПЗ (PLAN 4.73).

const motionOn = () => !document.body.classList.contains("vd-no-anim");
const EASE = "cubic-bezier(.2, .8, .2, 1)";

/** Новая вкладка проявляется со сдвигом. */
export function animateTab(root, group, tab) {
  if (!motionOn() || !root) return;
  const el = root.querySelector(`.tab[data-group="${group}"][data-tab="${tab}"]`);
  el?.animate([{ opacity: 0, translate: "0 8px" }, { opacity: 1, translate: "0 0" }], { duration: 240, easing: EASE });
}

const ROWS = ".rv, .vm-vital, .vh-vit";
const KEYS = ["hp", "sta", "tox"];

/**
 * Шкалы листа и худа: заполнение едет от прежней длины к новой, потерянное на миг подсвечено, число вспыхивает —
 * урон красным, лечение зелёным. Прежние значения хранятся на приложении по id актора.
 * @param {object} app — лист или худ
 * @param {HTMLElement} root
 * @param {string} actorId
 */
export function animateVitals(app, root, actorId) {
  if (!root) return;
  const prev = app._vdVitals?.actorId === actorId ? app._vdVitals.values : null;
  const values = {};
  const on = motionOn();
  for (const row of root.querySelectorAll(ROWS)) {
    const key = KEYS.find(k => row.classList.contains(k));
    // Дуга медальона худа (PLAN 4.123) — не внутри строки, а рядом: ищем по ключу
    const arc = row.classList.contains("vh-clamp") ? root.querySelector(`.vh-arc.${key}`) : null;
    const fill = arc ?? row.querySelector(".fill:not(.extra), .vh-tube .f, .vm-tube .f");
    const num = row.querySelector("input[type='number'], .vh-num b");
    if (!key || !fill) continue;
    // Значения — из разметки (style и value), без чтения раскладки
    const pct = arc ? parseFloat(arc.style.strokeDasharray) || 0 : parseFloat(fill.style.width) || 0;
    const value = Number(num?.value ?? num?.textContent);
    values[key] = { pct, value };
    const was = prev?.[key];
    if (!was || !on) continue;
    if (was.pct !== pct && arc) {
      arc.animate([{ strokeDasharray: `${was.pct} 400` }, { strokeDasharray: `${pct} 400` }], { duration: 520, easing: EASE });
    } else if (was.pct !== pct) {
      fill.animate([{ width: `${was.pct}%` }, { width: `${pct}%` }], { duration: 520, easing: EASE });
      if (pct < was.pct && key !== "tox") {
        const lag = document.createElement("span");
        lag.className = "vd-lag";
        lag.style.left = `${pct}%`;
        lag.style.width = `${was.pct - pct}%`;
        fill.parentElement.append(lag);
        lag.animate([{ opacity: 0.85 }, { opacity: 0.85, offset: 0.25 }, { opacity: 0 }], { duration: 880, easing: "ease-in" })
          .finished.then(() => lag.remove(), () => lag.remove());
      }
    }
    if (num && Number.isFinite(was.value) && Number.isFinite(value) && was.value !== value) {
      // У токсичности рост — плохо; у ПЗ и Вын — хорошо
      const good = key === "tox" ? value < was.value : value > was.value;
      const glow = good ? "0 0 10px rgba(180, 199, 156, .9)" : "0 0 10px rgba(224, 96, 74, .9)";
      num.animate([{ scale: 1.3, color: good ? "#cfe8b0" : "#ffb09a", textShadow: glow }, {}], { duration: 650, easing: EASE });
    }
  }
  app._vdVitals = { actorId, values: Object.keys(values).length ? values : prev ?? {} };
}

/**
 * Моменты худа (PLAN 4.156) — разовые и только на изменение: лента «Ваш ход», новое состояние «выскакивает»,
 * потраченная монета Удачи переворачивается. Только transform и opacity через element.animate — видеокарта двигает
 * слой без пересчёта раскладки; лента — один временный элемент, убирается по окончании.
 * @param {HTMLElement} root — элемент худа
 * @param {{turn: boolean, statuses: Set<string>, effects: Set<string>, luck: number|null}} prev
 * @param {typeof prev} now
 */
export function hudMoments(root, prev, now) {
  if (!motionOn() || !root) return;
  const vh = root.querySelector(".vh");
  if (!vh) return;
  // Начался свой ход — лента пробегает поперёк худа
  if (now.turn && !prev.turn) {
    vh.querySelector(".vh-turnflash")?.remove();
    const band = document.createElement("div");
    band.className = "vh-turnflash";
    band.textContent = "Ваш ход";
    vh.append(band);
    // Плавность — у отрезков, а не у всей анимации: общая кривая сжимала бы время и лента гасла бы раньше середины
    band.animate([
      { opacity: 0, transform: "translateX(-24px) scaleX(.92)", easing: EASE },
      { opacity: 1, transform: "none", offset: .18, easing: "linear" },
      { opacity: 1, transform: "none", offset: .72, easing: "ease-in" },
      { opacity: 0, transform: "translateX(24px)" }
    ], { duration: 1500 }).finished.then(() => band.remove(), () => band.remove());
  }
  // Новое состояние: значок в сетке «Состояния» и в медальоне выскакивает
  const pop = el => el?.animate([
    { transform: "scale(.6)", opacity: .2, easing: EASE }, { transform: "scale(1.18)", opacity: 1, offset: .6, easing: "ease-out" },
    { transform: "none", opacity: 1 }
  ], { duration: 380 });
  for (const id of now.statuses) if (!prev.statuses.has(id)) pop(root.querySelector(`.vh-st[data-status="${id}"]`));
  const badge = root.querySelector(".vh-badge[data-effect]");
  if (badge && !prev.effects.has(badge.dataset.effect)) pop(badge);
  // Потрачена Удача: погасшие монеты переворачиваются
  if (prev.luck !== null && now.luck !== null && now.luck < prev.luck) {
    const coins = [...root.querySelectorAll(".vh-pip-row .vd-coin")];
    coins.slice(now.luck, prev.luck).forEach((coin, i) => coin.animate([
      { transform: "rotateY(0deg) translateY(0)", opacity: 1 },
      { transform: "rotateY(90deg) translateY(-5px)", opacity: 1, offset: .45 },
      { transform: "rotateY(180deg) translateY(0)" }
    ], { duration: 520, delay: i * 90, easing: "ease-in-out" }));
  }
}
