// Замер скорости листа на компьютере игрока: подготовка данных, перерисовка каждой вкладки, показ и прокрутка.
// Из облака Foundry не запустить, поэтому цифры собирает сама система — кнопкой «Замер скорости листа»
// в меню «…» заголовка листа или из консоли: game.vedmak.profileSheet(). Итог — карточкой в чат себе.

import { SYSTEM_ID } from "../util.mjs";

const REPEAT = 3;

/** Следующий кадр отрисован: браузер пересчитал стили, раскладку и нарисовал. */
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

const median = list => {
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

async function timed(fn) {
  const t0 = performance.now();
  await fn();
  await nextFrame();
  return performance.now() - t0;
}

/** Открытый лист актора системы: самый верхний. */
function openSheet() {
  const apps = [...foundry.applications.instances.values()]
    .filter(a => a.rendered && a.document?.documentName === "Actor" && a.element?.classList.contains(SYSTEM_ID));
  return apps.sort((a, b) => (Number(b.element.style.zIndex) || 0) - (Number(a.element.style.zIndex) || 0))[0] ?? null;
}

/** Видеокарта, как её видит WebGL холста (если браузер её не прячет). */
function gpuName() {
  try {
    const gl = canvas?.app?.renderer?.gl;
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "";
  } catch {
    return "";
  }
}

/**
 * Замерить лист.
 * @param {ApplicationV2} [sheet] — по умолчанию самый верхний открытый лист актора
 * @returns {Promise<object|null>} цифры в миллисекундах
 */
export async function profileSheet(sheet = openSheet()) {
  if (!sheet?.rendered) {
    ui.notifications.warn("Откройте лист персонажа или чудовища — замер идёт на нём.");
    return null;
  }
  // Короткий лист (право «Ограниченный») без вкладок: changeTab упал бы на «No matching tab element»
  if (sheet.limitedView || !sheet.element.querySelector('.tabs [data-group="primary"]')) {
    ui.notifications.warn("У этого листа нет вкладок (ограниченный вид): замерять нечего. Откройте полный лист.");
    return null;
  }
  ui.notifications.info("Замер листа: несколько секунд лист будет перерисовываться и листать вкладки.");
  const parts = Object.keys(sheet.constructor.PARTS);
  const tabDefs = sheet.constructor.TABS?.primary?.tabs ?? [];
  const tabs = tabDefs.map(t => t.id);
  const labels = Object.fromEntries(tabDefs.map(t => [t.id, t.label]));
  const startTab = sheet.tabGroups.primary;
  const out = { actor: sheet.document.name, tabs: [] };

  // Подготовка данных для всех вкладок (без отрисовки)
  const prep = [];
  for (let i = 0; i < REPEAT; i++) {
    const t0 = performance.now();
    await sheet._prepareContext({ parts, isFirstRender: false });
    prep.push(performance.now() - t0);
  }
  out.prepare = median(prep);

  // Весь лист целиком — так он перерисовывался на каждое изменение до ленивых вкладок
  const full = [];
  for (let i = 0; i < REPEAT; i++) full.push(await timed(() => sheet.render({ parts })));
  out.full = median(full);

  for (const tab of tabs) {
    // Перерисовка одной вкладки (изменился актор, открыта эта вкладка)
    const render = [];
    for (let i = 0; i < REPEAT; i++) render.push(await timed(() => sheet.render({ parts: ["tabs", tab] })));
    // Показ: вкладка уже нарисована, браузеру остаётся стиль, раскладка и отрисовка
    const show = [];
    for (let i = 0; i < REPEAT; i++) {
      const other = tabs.find(t => t !== tab) ?? tab;
      sheet.changeTab(other, "primary");
      await nextFrame();
      show.push(await timed(() => sheet.changeTab(tab, "primary")));
    }
    // Прокрутка: 30 кадров вниз, худший и средний кадр
    const el = sheet.element.querySelector(`section.tab[data-tab="${tab}"]`);
    const frames = [];
    if (el && el.scrollHeight > el.clientHeight + 20) {
      const step = Math.max(10, Math.round((el.scrollHeight - el.clientHeight) / 30));
      let last = performance.now();
      for (let i = 0; i < 30; i++) {
        el.scrollTop = i * step;
        await new Promise(r => requestAnimationFrame(r));
        const now = performance.now();
        frames.push(now - last);
        last = now;
      }
      el.scrollTop = 0;
    }
    out.tabs.push({
      tab, render: median(render), show: median(show),
      scrollWorst: frames.length ? Math.max(...frames) : null,
      scrollAvg: frames.length ? frames.reduce((a, b) => a + b, 0) / frames.length : null,
      nodes: el?.getElementsByTagName("*").length ?? 0
    });
  }
  sheet.changeTab(startTab, "primary");

  out.env = {
    dpr: window.devicePixelRatio,
    modules: game.modules.filter(m => m.active).length,
    chat: game.messages.size,
    fps: Math.round(canvas?.app?.ticker?.FPS ?? 0),
    gpu: gpuName(),
    foundry: game.release?.version ?? game.version,
    browser: navigator.userAgent.match(/(Electron|Chrome|Firefox|Safari)\/[\d.]+/g)?.join(" ") ?? ""
  };

  const ms = v => (v === null ? "—" : `${Math.round(v)}`);
  console.table(out.tabs.map(t => ({ ...t, render: ms(t.render), show: ms(t.show), scrollWorst: ms(t.scrollWorst), scrollAvg: ms(t.scrollAvg) })));
  console.log("vedmak | замер листа", out);
  await postReport(out, ms, labels);
  return out;
}

async function postReport(out, ms, labels) {
  const rows = out.tabs.map(t => `<tr><td>${labels[t.tab] ?? t.tab}</td><td>${ms(t.render)}</td><td>${ms(t.show)}</td>`
    + `<td>${ms(t.scrollAvg)} / ${ms(t.scrollWorst)}</td><td>${t.nodes}</td></tr>`).join("");
  const e = out.env;
  const content = `<div class="vedmak-card perf-report">
    <header class="card-head"><span class="card-glyph"><i class="fa-solid fa-gauge-high"></i></span>
      <div class="card-ident"><span class="card-name">Замер листа</span><span class="card-sub">${foundry.utils.escapeHTML(out.actor)}</span></div></header>
    <div class="card-body">
      <p class="note">Подготовка данных <b>${ms(out.prepare)}</b> мс · весь лист <b>${ms(out.full)}</b> мс</p>
      <table class="perf-table"><thead><tr><th>Вкладка</th><th>Перерис.</th><th>Показ</th><th>Прокрутка ср./худш.</th><th>Узлов</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="note dim">Миллисекунды, медиана из ${REPEAT}. Кадр прокрутки: 17 — плавно, больше 50 — рывок.</p>
      <p class="note dim">масштаб ${e.dpr} · модулей ${e.modules} · сообщений в чате ${e.chat}
        · холст ${e.fps} к/с · Foundry ${e.foundry} · ${foundry.utils.escapeHTML(e.browser)}${e.gpu ? ` · ${foundry.utils.escapeHTML(e.gpu)}` : ""}</p>
    </div></div>`;
  await ChatMessage.create({ content, whisper: [game.user.id], speaker: { alias: "Ведьмак: замер" } });
}
