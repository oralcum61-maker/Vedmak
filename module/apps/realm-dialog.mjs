// Окна поселения, построек и войска (PLAN 4.226): ввод и подтверждения одним каркасом. Разметка — шаблоны
// templates/dialog/realm/*.hbs (раньше — строки HTML в коде листов), Handlebars сам экранирует имена. Каркас один,
// поэтому облик всего семейства (бриф .design-sync/guidelines/realm-windows.md) меняется в одном месте: класс окна
// vd-realm и vd-realm-<имя>, корень разметки .realm-dlg.

import { renderTemplate } from "../util.mjs";

const { DialogV2 } = foundry.applications.api;
const path = name => `systems/vedmak/templates/dialog/realm/${name}.hbs`;
const classes = name => ["vd-realm", `vd-realm-${name}`];

/**
 * Окно ввода: шаблон name с данными data; кнопка okLabel; read(form) — что вернуть по нажатию.
 * @returns {Promise<*>} значение read или null (закрыли)
 */
export async function realmPrompt(name, { title, data = {}, okLabel, read }) {
  const content = await renderTemplate(path(name), { ...data, dlg: name });
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
export async function realmConfirm(name, { title, text, hint = "" }) {
  const content = await renderTemplate(path("confirm"), { text, hint, dlg: name });
  return !!(await DialogV2.confirm({ window: { title }, classes: classes(name), content, rejectClose: false }));
}
