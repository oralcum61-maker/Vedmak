// Окна поселения, построек и войска (PLAN 4.226): ввод и подтверждения одним каркасом. Разметка — шаблоны
// templates/dialog/realm/*.hbs (раньше — строки HTML в коде листов), Handlebars сам экранирует имена. Каркас один,
// поэтому облик всего семейства (бриф .design-sync/guidelines/realm-windows.md) меняется в одном месте: класс окна
// vd-realm и vd-realm-<имя>, корень разметки .realm-dlg.

import { renderTemplate } from "../util.mjs";

const { DialogV2 } = foundry.applications.api;
const path = name => `systems/vedmak/templates/dialog/realm/${name}.hbs`;
const classes = name => ["vd-realm", `vd-realm-${name}`];

/**
 * Шапка окна по холсту окон (PLAN 4.232): кожа со строчкой, гнездо с картинкой или значком, название металлом, подпись
 * через ромбы. head = { img?, icon?, name, sub?: string[], danger? }; без head — окно без шапки.
 */
async function withHead(head, content) {
  if (!head) return content;
  const sub = (head.sub ?? []).filter(Boolean).map(String);
  return (await renderTemplate(path("head"), { ...head, sub })) + content;
}

/**
 * Окно ввода: шаблон name с данными data; кнопка okLabel; read(form) — что вернуть по нажатию.
 * @returns {Promise<*>} значение read или null (закрыли)
 */
export async function realmPrompt(name, { title, data = {}, okLabel, read, head = null, live = null }) {
  let content = await withHead(head, await renderTemplate(path(name), { ...data, dlg: name }));
  if (live) content += `<section class="realm-after" data-realm-after></section>`;
  return DialogV2.prompt({
    window: { title }, classes: classes(name), content,
    ok: { label: okLabel, callback: (event, button) => read(button.form) },
    render: live ? (event, dialog) => bindLive(dialog?.element ?? event?.target?.element, live) : undefined,
    rejectClose: false
  });
}

/**
 * «После…» (PLAN 4.236): live(form) → строки { label, before, after, unit?, dir?: "up"|"down", bad? }; пересчёт на каждый
 * ввод в окне, разметка — шаблон realm/after.hbs. Ошибка расчёта не мешает окну — раздел просто пустеет.
 */
function bindLive(root, live) {
  const box = root?.querySelector("[data-realm-after]");
  const form = box?.closest("form") ?? root?.querySelector("form");
  if (!box || !form) return;
  let turn = 0;
  const draw = async () => {
    const mine = ++turn;
    let rows = [];
    try { rows = (live(form) ?? []).filter(Boolean); } catch (err) { console.warn("vedmak | «После…»", err); }
    const html = rows.length ? await renderTemplate(path("after"), { rows }) : "";
    if (mine === turn) { box.innerHTML = html; box.hidden = !rows.length; }
  };
  form.addEventListener("input", draw);
  form.addEventListener("change", draw);
  draw();
}

/** Число для «После…»: десятые без хвоста нулей, тысячи — через пробел. */
export const afterNum = n => (Math.round((Number(n) || 0) * 10) / 10).toLocaleString("ru-RU");

/**
 * Подтверждение: вопрос text и пояснение hint (строки; экранирует шаблон).
 * @returns {Promise<boolean>} true — «Да»
 */
export async function realmConfirm(name, { title, text, hint = "", head = null }) {
  const content = await withHead(head, await renderTemplate(path("confirm"), { text, hint, dlg: name }));
  return !!(await DialogV2.confirm({ window: { title }, classes: classes(name), content, rejectClose: false }));
}
