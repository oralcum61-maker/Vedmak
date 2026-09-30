// Мелкие помощники, общие для всей системы.

export const SYSTEM_ID = "vedmak";

export const renderTemplate = (path, data) =>
  foundry.applications.handlebars.renderTemplate(path, data);

/**
 * Сравнение строк по-русски для сортировки. Один Intl.Collator на всю систему: `localeCompare(…, "ru")`
 * готовит правила языка заново на каждое сравнение и сортирует раз в восемь медленнее.
 */
const RU_COLLATOR = new Intl.Collator("ru");
export const compareRu = (a, b) => RU_COLLATOR.compare(a ?? "", b ?? "");

/** Число со знаком: +3 / −2 / 0. */
export function signed(n) {
  n = Number(n) || 0;
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}

/** Словарь {key: label|{label}} → массив опций для selectOptions. */
export function toOptions(map) {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, typeof v === "string" ? v : v.label]));
}

/**
 * Простая карточка в чат в общем стиле системы.
 * @param {Actor|null} actor
 * @param {string} title
 * @param {string} body — HTML
 * @param {object} [opts] — {subtitle, icon, cls, rolls, flags}
 */
export function postCard(actor, title, body, { subtitle = "", icon = "", cls = "", rolls, flags } = {}) {
  const content = `<div class="vedmak-card ${cls}"><header class="card-head">`
    + `${icon ? `<span class="card-glyph"><i class="${icon}"></i></span>` : ""}`
    + `<div class="card-ident"><span class="card-name">${title}</span>`
    + `${subtitle ? `<span class="card-sub">${subtitle}</span>` : ""}</div></header>`
    + `<div class="card-body">${body}</div></div>`;
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content, rolls, flags });
}
