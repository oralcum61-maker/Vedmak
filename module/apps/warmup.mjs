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

/**
 * Лист персонажа — один раз невидимо (PLAN 4.176). Замер (трасса открытия листа): собственный код листа — 3–4 мс,
 * а первое открытие за сессию стоило 60–75 мс до кадра и ~480 мс работы видеокарты — компиляция шейдеров под эффекты
 * листа, шаблоны, первая раскладка; повторное — ~20 мс. После невидимого открытия первое настоящее — как повторное.
 * Греется отдельный экземпляр листа со своим id: настоящий лист игрока он не трогает, даже если тот открыт в это время.
 */
async function prewarmSheet() {
  if (document.hidden) return null;
  const owned = a => a?.type === "character" && a.testUserPermission(game.user, "OBSERVER");
  const actor = [game.user.character, ...(canvas?.scene?.tokens.map(t => t.actor) ?? []), ...game.actors].find(owned);
  if (!actor) return null;
  await idle();
  const sheet = new actor.sheet.constructor({ document: actor, id: "vd-prewarm-{id}", classes: ["vd-prewarm"] });
  try {
    await sheet.render({ force: true });
    // Два кадра — лист нарисован и растеризован; ещё немного — видеокарта доделывает своё
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise(resolve => setTimeout(resolve, 400));
  } catch { /* прогрев не обязателен */ } finally {
    if (sheet.rendered) await sheet.close({ animate: false }).catch(() => {});
  }
  return actor.name;
}

/** Запустить прогрев после входа в мир; сцене и интерфейсу — время собраться. */
export function startWarmup() {
  setTimeout(async () => {
    const t0 = performance.now();
    const n = await decode([...cssImages(), ...gameImages()]);
    const sheet = await prewarmSheet();
    console.debug(`${SYSTEM_ID} | прогрев: ${n} картинок${sheet ? `, лист «${sheet}»` : ""} за ${Math.round(performance.now() - t0)} мс`);
  }, 3000);
}
