// Переворот токена (PLAN 4.56): круглый жетон ↔ арт в полный рост. Кнопка в меню токена (HUD) и сочетание клавиш
// для выбранных токенов. Полный рост — портрет актёра (actor.img): ставится ногами на клетку, ширина — во всю клетку,
// кольцо токена на это время выключается. Прежний вид жетона хранится во флаге и возвращается как был.
// Модуль Token Flip, если стоит, не мешает: у него свои флаги и своя кнопка.

import { SYSTEM_ID } from "../util.mjs";

const FLAG = "flip";
const DEFAULT_IMG = /icons\/svg\/mystery-man|icons\/svg\/cowled/;
const FLIP_MS = 220;
const FLIPPING = new Set();

/** Пропорция картинки (высота ÷ ширина); не загрузилась — 1.4, как у портретов бестиария. */
async function aspect(src) {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    return img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1.4;
  } catch {
    return 1.4;
  }
}

/** Есть ли у токена второй облик: портрет актёра, отличный от жетона и не заглушка Foundry. */
export function canFlip(tokenDoc) {
  const saved = tokenDoc.getFlag(SYSTEM_ID, FLAG);
  if (saved?.full) return true;
  const art = tokenDoc.actor?.img;
  return !!art && !DEFAULT_IMG.test(art) && art !== tokenDoc._source.texture.src;
}

/** Перевернуть токен: жетон → полный рост или обратно. */
export async function flipToken(tokenDoc) {
  if (!tokenDoc?.isOwner || !canFlip(tokenDoc)) return;
  const saved = tokenDoc.getFlag(SYSTEM_ID, FLAG);
  let data;
  if (saved?.full) {
    // Обратно в жетон — ровно тот вид, что был
    data = {
      texture: saved.texture,
      ring: { enabled: saved.ring ?? false },
      [`flags.${SYSTEM_ID}.${FLAG}`]: { full: false }
    };
  } else {
    // Исходные данные, а не tokenDoc.texture: во время анимации v14 отдаёт промежуточные значения
    const t = tokenDoc._source.texture;
    const k = Math.min(2.5, Math.max(1, await aspect(tokenDoc.actor.img)));
    data = {
      // Картинка вписывается в клетку по высоте и растягивается в k раз: ширина — во всю клетку, ноги — на нижнем крае
      texture: { src: tokenDoc.actor.img, fit: "contain", scaleX: k * Math.sign(t.scaleX || 1), scaleY: k, anchorX: 0.5, anchorY: 1 - 0.5 / k },
      ring: { enabled: false },
      [`flags.${SYSTEM_ID}.${FLAG}`]: {
        full: true, ring: !!tokenDoc._source.ring?.enabled,
        texture: { src: t.src, fit: t.fit, scaleX: t.scaleX, scaleY: t.scaleY, anchorX: t.anchorX, anchorY: t.anchorY, tint: t.tint }
      }
    };
  }
  // Сначала «ребром» — картинка сжимается до нуля по ширине, затем раскрывается новым обликом.
  // Повторное нажатие во время переворота пропускается
  if (FLIPPING.has(tokenDoc.uuid)) return;
  FLIPPING.add(tokenDoc.uuid);
  try {
    await tokenDoc.update({ "texture.scaleX": 0.0001 }, { animation: { duration: FLIP_MS } });
    await new Promise(r => setTimeout(r, FLIP_MS + 40));
    await tokenDoc.update(data, { animation: { duration: FLIP_MS } });
  } finally {
    FLIPPING.delete(tokenDoc.uuid);
  }
}

export function registerTokenFlip() {
  Hooks.on("renderTokenHUD", (hud, html) => {
    const doc = hud.object?.document;
    if (!doc || !doc.isOwner || !canFlip(doc)) return;
    const root = html instanceof HTMLElement ? html : html[0];
    const col = root?.querySelector(".col.right");
    if (!col) return;
    const full = !!doc.getFlag(SYSTEM_ID, FLAG)?.full;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "control-icon vedmak-flip";
    btn.dataset.tooltip = full ? "Вернуть жетон" : "В полный рост";
    btn.setAttribute("aria-label", btn.dataset.tooltip);
    btn.innerHTML = `<i class="fa-solid ${full ? "fa-circle-user" : "fa-person"}"></i>`;
    btn.addEventListener("click", async event => {
      event.preventDefault();
      await flipToken(doc);
      hud.render();
    });
    col.append(btn);
  });

  game.keybindings.register(SYSTEM_ID, "tokenFlip", {
    name: "Перевернуть токен",
    hint: "Выбранные токены: круглый жетон ↔ арт в полный рост (портрет актёра).",
    editable: [{ key: "KeyF", modifiers: ["Shift"] }],
    onDown: () => {
      const tokens = canvas.ready ? canvas.tokens.controlled : [];
      if (!tokens.length) return false;
      tokens.forEach(t => flipToken(t.document));
      return true;
    }
  });
}
