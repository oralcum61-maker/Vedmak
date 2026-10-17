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
export async function realmPrompt(name, { title, data = {}, okLabel, read, head = null }) {
  const content = await withHead(head, await renderTemplate(path(name), { ...data, dlg: name }));
  return DialogV2.prompt({
    window: { title }, classes: classes(name), content,
    ok: { label: okLabel, callback: (event, button) => read(button.form) },
    rejectClose: false
  });
}

/**
 * Подтверждение: вопрос text и пояснение hint (строки; экранирует шаблон).
 * @returns {Promise<boolean>} true — «Да»
 */
export async function realmConfirm(name, { title, text, hint = "", head = null }) {
  const content = await withHead(head, await renderTemplate(path("confirm"), { text, hint, dlg: name }));
  return !!(await DialogV2.confirm({ window: { title }, classes: classes(name), content, rejectClose: false }));
}
