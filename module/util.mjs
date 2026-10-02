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

/**
 * Разложить блоки по двум колонкам примерно равной высоты, не меняя порядка: первая колонка — начало
 * списка, вторая — конец. Заменяет CSS-колонки (`columns`): их браузер уравнивает, перекладывая всё
 * содержимое по нескольку раз, и вкладка навыков открывалась с фризом (PLAN 4.36).
 * @param {object[]} blocks
 * @param {(block: object) => number} weight — условная высота блока
 * @returns {object[][]} две колонки; вторая пустая, если блок один
 */
export function balanceColumns(blocks, weight) {
  const w = blocks.map(weight);
  const total = w.reduce((a, b) => a + b, 0);
  let best = blocks.length, bestMax = total, acc = 0;
  for (let k = 1; k < blocks.length; k++) {
    acc += w[k - 1];
    const max = Math.max(acc, total - acc);
    if (max < bestMax) { bestMax = max; best = k; }
  }
  return [blocks.slice(0, best), blocks.slice(best)];
}

/** Число со знаком: +3 / −2 / 0. */
export function signed(n) {
  n = Number(n) || 0;
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}

/** Идёт ли бой, в котором участвует актор. */
export function inCombat(actor) {
  return !!actor && game.combats.some(c => c.started && c.combatants.some(cb => cb.actor === actor));
}

/**
 * Срок в раундах, но временем: вне боя раунды отсчитывать некому (свой счётчик `flags.vedmak.timed` убывает
 * в начале хода), а время мира Foundry переводит в срок эффекта сама. Раунд — `CONFIG.time.roundTime` секунд.
 * `expiry: null` — явно: схема v14 для числового срока подставляет «turnStart», и такой эффект Foundry снимает
 * по времени мира только у актора вне боя (даже нестартовавшего), а у участника боя — лишь в начале его хода.
 * При null (`isExpiryEvent`: «срок определяется одной длительностью») эффект истекает на любом сдвиге времени.
 */
export function roundsAsTime(rounds) {
  return { value: Math.max(1, Math.round(rounds * (CONFIG.time.roundTime || 3))), units: "seconds", expiry: null };
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

/** Разметка кольца медальона карточки чата (см. хелпер vedmakRing). dice — число, массив граней d10 или ничего. */
export function ringHtml(dice) {
  const arr = Array.isArray(dice) ? dice : (typeof dice === "number" || typeof dice === "string") ? [dice] : [];
  const lit = {};
  arr.forEach((raw, i) => {
    const v = Number(raw);
    if (!(v >= 1 && v <= 10) || lit[v]) return;
    lit[v] = v === 10 ? " on hot" : v === 1 && i === 0 ? " on low" : " on";
  });
  const notches = Array.from({ length: 10 }, (_, k) => `<i class="n${k}${lit[k || 10] ?? ""}"></i>`).join("");
  return `<span class="vd-ring" aria-hidden="true">${notches}</span>`;
}
