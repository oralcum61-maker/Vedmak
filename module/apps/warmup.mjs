// Прогрев «первого раза» (PLAN 4.174). Охота на фризы (tools/bench/freeze.mjs) показала: повторно ничего не тормозит,
// а в первый раз кадр тянут загрузки — первое открытие вкладок листа и худа тянуло ~70 картинок (значки состояний,
// предметов, курсоры, текстуры), первое нажатие на сцену — разом все звуки системы. Пока игрок после входа ничего не
// делает, система подгружает и раскодирует картинки понемногу в простое браузера, звуки — по одному после первого
// щелчка. Картинки держатся ссылками до конца сессии, чтобы браузер не выбросил раскодированное.

import { SYSTEM_ID } from "../util.mjs";

const keep = [];
const seen = new Set();

/** Дождаться простоя браузера (или 2 с, если простоя нет). */
export const idle = () => new Promise(resolve =>
  (window.requestIdleCallback ?? (fn => setTimeout(fn, 50)))(() => resolve(), { timeout: 2000 }));

/** Картинки из стилей системы: курсоры, текстуры, глифы. Шрифты и data: — мимо. */
function cssImages() {
  const out = [];
  const walk = (rules, base) => {
    for (const rule of rules) {
      if (rule.cssRules) walk(rule.cssRules, base);
      if (!rule.style) continue;
      for (const m of rule.style.cssText.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        if (/^data:|\.(woff2?|ttf|otf)$/i.test(m[1])) continue;
        try { out.push(new URL(m[1], base).href); } catch { /* битый адрес — мимо */ }
      }
    }
  };
  for (const sheet of document.styleSheets) {
    if (!sheet.href?.includes(`systems/${SYSTEM_ID}/`)) continue;
    try { walk(sheet.cssRules, sheet.href); } catch { /* чужой источник — правила закрыты */ }
  }
  return out;
}

/** Значки состояний и картинки персонажей игрока: их предметы и эффекты (вкладки листа, списки худа). */
function gameImages() {
  const out = (CONFIG.statusEffects ?? []).map(s => s.img ?? s.icon);
  // Ведущему принадлежат все — берутся его персонаж и персонажи на текущей сцене
  const mine = game.user.isGM
    ? [game.user.character, ...(canvas.scene?.tokens.map(t => t.actor) ?? [])].filter(a => a?.type === "character").slice(0, 10)
    : game.actors.filter(a => a.isOwner && a.type === "character");
  for (const a of mine) {
    out.push(a.img);
    for (const i of a.items) out.push(i.img);
    for (const e of a.effects) out.push(e.img);
  }
  return out.filter(Boolean).map(src => { try { return new URL(src, document.baseURI).href; } catch { return null; } }).filter(Boolean);
}

async function decode(urls, perIdle = 4) {
  const list = urls.filter(u => !seen.has(u) && seen.add(u));
  for (let i = 0; i < list.length; i += perIdle) {
    await idle();
    await Promise.all(list.slice(i, i + perIdle).map(src => {
      const img = new Image();
      img.decoding = "async";
      img.src = src;
      keep.push(img);
      return img.decode().catch(() => {});
    }));
  }
  return list.length;
}

/** Запустить прогрев после входа в мир; сцене и интерфейсу — время собраться. */
export function startWarmup() {
  setTimeout(async () => {
    const t0 = performance.now();
    const n = await decode([...cssImages(), ...gameImages()]);
    console.debug(`${SYSTEM_ID} | прогрев: ${n} картинок за ${Math.round(performance.now() - t0)} мс`);
  }, 3000);
}
