// Горячие клавиши листов королевства (PLAN 4.245): поселение, постройка, отряд.
//   ← / → на вкладке — соседняя вкладка (фокус остаётся на вкладках);
//   Alt+1…9 в любом месте листа (кроме полей ввода) — вкладка по номеру.
// Простые цифры не заняты: в Foundry они запускают макросы панели.

/** Повесить клавиши на окно листа (один раз — в _onFirstRender: element живёт между перерисовками). */
export function bindRealmKeys(app) {
  const root = app.element;
  if (!root || root.dataset.vdRealmKeys) return;
  root.dataset.vdRealmKeys = "1";
  root.addEventListener("keydown", event => {
    const tabs = [...root.querySelectorAll(".rs-tabs [data-tab]")];
    if (!tabs.length) return;
    const at = tabs.findIndex(t => t.classList.contains("on"));
    let to = -1;
    if (event.target.closest?.(".rs-tabs") && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      to = (at + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    } else if (event.altKey && !event.ctrlKey && /^Digit[1-9]$/.test(event.code)) {
      if (event.target.closest?.("input, textarea, select, [contenteditable], prose-mirror")) return;
      to = Number(event.code.slice(5)) - 1;
      if (to >= tabs.length) return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
    if (to === at) return;
    app._vdFocusTab = tabs[to].dataset.tab;
    tabs[to].click();
  });
}

/** После перерисовки — вернуть фокус на вкладку, выбранную с клавиатуры (в _onRender). */
export function restoreTabFocus(app) {
  if (!app._vdFocusTab) return;
  app.element?.querySelector(`.rs-tabs [data-tab="${app._vdFocusTab}"]`)?.focus();
  app._vdFocusTab = null;
}
