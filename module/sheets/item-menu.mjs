// Меню предмета по правой кнопке (PLAN 4.258): на строке оружия, брони и снаряжения остаются «Атака» / «В руки» и
// «снять / надеть»; остальные кнопки строки (не при себе, починить, разобрать, править, в чат, удалить и редкие) —
// в меню. Меню собирается из тех же кнопок строки (они спрятаны стилем), щелчок по пункту нажимает кнопку — действия
// листа те же, права наблюдателя (vd-locked) соблюдаются.

/** Кнопки, которые остаются на строке. */
const KEEP = new Set(["itemToggleEquip"]);
let menu = null;

function close() {
  if (!menu) return;
  menu.remove();
  menu = null;
  document.removeEventListener("pointerdown", onOutside, true);
  document.removeEventListener("keydown", onKey, true);
  window.removeEventListener("wheel", close, true);
  window.removeEventListener("blur", close);
}
const onOutside = event => { if (!menu?.contains(event.target)) close(); };
const onKey = event => { if (event.key === "Escape") { event.stopPropagation(); close(); } };

/** Кнопки строки для меню: всё, кроме оставленных на строке и закрытых правами. */
export const menuButtons = row => [...row.querySelectorAll(":scope .item-tools > a[data-action], :scope .tile-tools > a[data-action]")]
  .filter(a => !KEEP.has(a.dataset.action) && !a.classList.contains("vd-locked"));

function open(row, x, y) {
  close();
  const buttons = menuButtons(row);
  if (!buttons.length) return false;
  menu = document.createElement("nav");
  menu.className = "vd-item-menu";
  const title = row.querySelector(".item-name, .tile-name")?.textContent.trim() ?? "";
  if (title) {
    const head = document.createElement("b");
    head.textContent = title;
    menu.append(head);
  }
  for (const btn of buttons) {
    const entry = document.createElement("a");
    entry.className = btn.classList.contains("active") ? "on" : "";
    const icon = btn.querySelector("i")?.cloneNode(true);
    if (icon) entry.append(icon);
    const label = document.createElement("span");
    label.textContent = btn.dataset.tooltip ?? btn.getAttribute("aria-label") ?? btn.dataset.action;
    entry.append(label);
    entry.addEventListener("click", event => { event.preventDefault(); close(); btn.click(); });
    menu.append(entry);
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  document.addEventListener("pointerdown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("wheel", close, true);
  window.addEventListener("blur", close);
  return true;
}

/** Повесить меню на окно листа (один раз: элемент окна живёт между перерисовками). */
export function bindItemMenu(app) {
  const root = app.element;
  if (!root || root.dataset.vdItemMenu) return;
  root.dataset.vdItemMenu = "1";
  root.addEventListener("contextmenu", event => {
    const row = event.target.closest(".gear-item, .gear-tile");
    if (!row || event.target.closest("input, textarea, select")) return;
    if (open(row, event.clientX, event.clientY)) event.preventDefault();
  });
}

export { close as closeItemMenu };
