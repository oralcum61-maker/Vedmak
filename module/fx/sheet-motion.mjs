// Движение в листах (PLAN 4.67): смена вкладки, шкалы ПЗ/Вын/Токсичности, вспышка числа. Включается только на
// само изменение, а не на каждую перерисовку — иначе лист мигал бы от любой правки. Выключено, если на body
// стоит vd-no-anim (настройка «Оживший интерфейс» или системное «меньше движения»).

const motionOn = () => !document.body.classList.contains("vd-no-anim");

/** Новая вкладка проявляется со сдвигом. */
export function animateTab(root, group, tab) {
  if (!motionOn() || !root) return;
  const el = root.querySelector(`.tab[data-group="${group}"][data-tab="${tab}"]`);
  if (!el) return;
  el.classList.remove("vd-tab-in");
  void el.offsetWidth;
  el.classList.add("vd-tab-in");
  el.addEventListener("animationend", () => el.classList.remove("vd-tab-in"), { once: true });
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
  for (const row of root.querySelectorAll(ROWS)) {
    const key = KEYS.find(k => row.classList.contains(k));
    const fill = row.querySelector(".fill:not(.extra), .vh-tube .f, .vm-tube .f");
    const num = row.querySelector("input[type='number'], .vh-num b");
    if (!key || !fill) continue;
    const pct = parseFloat(fill.style.width) || 0;
    const value = Number(num?.value ?? num?.textContent);
    values[key] = { pct, value };
    const was = prev?.[key];
    if (!was || !motionOn()) continue;
    if (was.pct !== pct) {
      fill.style.transition = "none";
      fill.style.width = `${was.pct}%`;
      void fill.offsetWidth;
      fill.style.transition = "width 520ms cubic-bezier(.2, .8, .2, 1)";
      fill.style.width = `${pct}%`;
      fill.addEventListener("transitionend", () => { fill.style.transition = ""; }, { once: true });
      if (pct < was.pct && key !== "tox") {
        const lag = document.createElement("span");
        lag.className = "vd-lag";
        lag.style.left = `${pct}%`;
        lag.style.width = `${was.pct - pct}%`;
        fill.parentElement.append(lag);
        lag.addEventListener("animationend", () => lag.remove(), { once: true });
      }
    }
    if (num && Number.isFinite(was.value) && Number.isFinite(value) && was.value !== value) {
      // У токсичности рост — плохо; у ПЗ и Вын — хорошо
      const good = key === "tox" ? value < was.value : value > was.value;
      num.classList.remove("vd-bump-good", "vd-bump-bad");
      void num.offsetWidth;
      num.classList.add(good ? "vd-bump-good" : "vd-bump-bad");
      num.addEventListener("animationend", () => num.classList.remove("vd-bump-good", "vd-bump-bad"), { once: true });
    }
  }
  app._vdVitals = { actorId, values: Object.keys(values).length ? values : prev ?? {} };
}
