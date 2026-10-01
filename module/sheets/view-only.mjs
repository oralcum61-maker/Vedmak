// Лист без права правки (наблюдатель, закрытый компендиум). Foundry отключает только поля формы
// (DocumentSheetV2._toggleDisabled), а кнопки-ссылки `<a data-action>` — создать, удалить, переключить —
// оставались видны и нажимались: щелчок уходил в обновление, на которое прав нет.

/**
 * Пометить действия листа. Без права правки: действия из `view` не трогаются, из `inert` — строки, которые
 * сами что-то показывают (основа проверки, надето ли, включён ли эффект), — остаются, но не нажимаются
 * (`vd-inert`), остальные прячутся (`vd-locked`). С правом правки пометки снимаются.
 * @param {foundry.applications.api.DocumentSheetV2} app
 * @param {{view: Set<string>, inert: Set<string>}} actions
 */
export function markLockedActions(app, { view, inert }) {
  const content = app.element.querySelector(".window-content") ?? app.element;
  if (app.isEditable) {
    for (const el of content.querySelectorAll(".vd-locked, .vd-inert")) el.classList.remove("vd-locked", "vd-inert");
    return;
  }
  for (const el of content.querySelectorAll("[data-action]")) {
    const action = el.dataset.action;
    if (view.has(action)) continue;
    el.classList.add(inert.has(action) ? "vd-inert" : "vd-locked");
  }
}

/**
 * Гасить щелчок по действию без права правки раньше обработчика Foundry (он висит на корне окна,
 * поэтому перехват — в фазе погружения на том же корне). Пометка выше — для глаз, это — на случай
 * кнопки, которую пометить не успели. Вызывать из `_attachFrameListeners`: один раз на окно.
 * @param {foundry.applications.api.DocumentSheetV2} app
 * @param {Set<string>} view — действия, доступные без права правки
 */
export function guardLockedActions(app, view) {
  const guard = event => {
    if (app.isEditable) return;
    const el = event.target.closest?.("[data-action]");
    if (!el || view.has(el.dataset.action) || !el.closest(".window-content")) return;
    event.preventDefault();
    event.stopPropagation();
  };
  app.element.addEventListener("click", guard, { capture: true });
  app.element.addEventListener("auxclick", guard, { capture: true });
}
