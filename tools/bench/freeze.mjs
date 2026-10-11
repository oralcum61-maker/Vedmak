// Охота на фризы: настоящие движения мыши и клавиатуры в тестовом мире и замер, во что каждое обходится браузеру.
//
//   node tools/bench/freeze.mjs [--start] [имя действия…]
//
// Действия — то, что игрок делает руками (сдвиг сцены правой кнопкой, колесо, перетаскивание токена и окна, наведение,
// вкладки и прокрутка листа, чат, худ). События — через протокол отладки (Input.dispatch*), как от настоящей мыши:
// именно так нашёлся фриз от `body:active` (PLAN 4.164), который вызовами JS не воспроизводится.
// Для каждого действия:
//   • длинные кадры — Long Animation Frames: худший кадр, сумма блокировки, чей скрипт (файл и функция);
//   • пересчёт стилей и раскладка — метрики движка (Performance.getMetrics): мс и число пересчётов;
//   • если действие подтормаживает — то же со стилями системы, отключёнными (А/Б): видно, наши ли это CSS или ядро;
//   • для самого тяжёлого по стилям — трасса SelectorStats: какие селекторы дольше всего сопоставлялись.
// Итог — tools/bench/results/freeze.md (таблица) и freeze.json; код выхода 1, если есть фриз (кадр > FREEZE_MS).
// Безголовый Edge рисует холст программно — абсолютные цифры холста завышены; сравнивать между собой и А/Б.
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const env = (k, d) => process.env[k] || d;
const CFG = {
  foundry: env("VD_FOUNDRY", "D:/FoundryVTT-WindowsPortable-14.365/App/resources/app"),
  data: env("VD_DATA", "D:/Witcher/_foundry_test"),
  node: env("VD_NODE", "D:/New Folder/node.exe"),
  edge: env("VD_EDGE", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"),
  port: Number(env("VD_PORT", 30014)),
  world: env("VD_WORLD", "test-vedmak"),
  user: env("VD_USER", "iRVlIbuaU0okU3Ky")
};
const URL = `http://localhost:${CFG.port}`;
const RESULTS = join(HERE, "results");
const FREEZE_MS = 100;   // кадр дольше — фриз
const JANK_MS = 50;      // дольше — подтормаживание
const STYLE_PER_EVENT = 6; // мс пересчёта стилей на одно событие мыши — подозрительно
const args = process.argv.slice(2);
const only = args.filter(a => !a.startsWith("--"));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const serverUp = async () => { try { return (await fetch(`${URL}/join`)).ok; } catch { return false; } };
function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill();
}

// ───────────── Браузер ─────────────
async function openBrowser(debugPort) {
  const profile = join(tmpdir(), `vedmak-freeze-${debugPort}`);
  mkdirSync(profile, { recursive: true });
  const edge = spawn(CFG.edge, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "--headless=new",
    "--window-size=1600,950", "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-extensions", "about:blank"], { stdio: "ignore" });
  await sleep(2500);
  const page = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let id = 0; const pending = new Map(); const listeners = [];
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method) for (const l of listeners) l(m);
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };
  const close = () => {
    try { ws.close(); } catch {}
    killTree(edge);
    spawnSync("powershell", ["-NoProfile", "-Command",
      `Get-CimInstance Win32_Process -Filter "name='msedge.exe'" | Where-Object { $_.CommandLine -like '*vedmak-freeze-${debugPort}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: "ignore" });
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }); } catch {}
  };
  return { send, ev, on: fn => listeners.push(fn), off: fn => listeners.splice(listeners.indexOf(fn), 1), close };
}

// Мышь и клавиатура — как от человека
const mouse = b => ({
  move: (x, y, buttons = 0) => b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons, button: buttons === 2 ? "right" : buttons === 1 ? "left" : "none" }),
  down: (x, y, button = "left") => b.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, buttons: button === "right" ? 2 : 1, clickCount: 1 }),
  up: (x, y, button = "left") => b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, buttons: 0, clickCount: 1 }),
  wheel: (x, y, dy) => b.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy }),
  async drag(x0, y0, x1, y1, { button = "left", steps = 30, pause = 16 } = {}) {
    await this.move(x0, y0); await this.down(x0, y0, button);
    for (let i = 1; i <= steps; i++) { await this.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, button === "right" ? 2 : 1); await sleep(pause); }
    await this.up(x1, y1, button);
    return steps + 2;
  },
  async sweep(points, pause = 16) { for (const [x, y] of points) { await this.move(x, y); await sleep(pause); } return points.length; },
  async click(x, y) { await this.move(x, y); await this.down(x, y); await this.up(x, y); return 3; }
});

// ───────────── Действия ─────────────
// prep — JS в странице, возвращает координаты; act — события мыши/клавиатуры, возвращает число событий
const ACTIONS = [
  { name: "Сцена: сдвиг правой кнопкой", prep: `canvasCenter()`,
    act: async (m, p) => m.drag(p.x - 250, p.y, p.x + 250, p.y + 120, { button: "right", steps: 40 }) },
  { name: "Сцена: масштаб колесом", prep: `canvasCenter()`,
    act: async (m, p) => { for (let i = 0; i < 12; i++) { await m.wheel(p.x, p.y, i < 6 ? -120 : 120); await sleep(30); } return 12; } },
  { name: "Сцена: наведение по токенам", prep: `tokenPoints()`,
    act: async (m, p) => m.sweep(p.points) },
  { name: "Токен: перетаскивание", prep: `tokenPoint()`,
    act: async (m, p) => m.drag(p.x, p.y, p.x + 160, p.y + 60, { steps: 30 }), after: `restoreToken()` },
  { name: "Лист: открыть", prep: `openSheet()`, act: async () => 0, measurePrep: true, freezeMs: 250 },
  { name: "Лист: первое открытие каждой вкладки", needs: "openSheet", prep: `sheetTabs()`, perTab: true,
    act: async (m, p, b) => { const out = []; for (const t of p.tabs) { await b.ev("window.__loaf.length = 0");
        await m.click(t.x, t.y); await sleep(700); const l = await b.ev("window.__loaf.slice()"); out.push(`${t.name} ${Math.round(Math.max(0, ...l.map(e => e.d)))}`); }
      await b.ev("window.__vfTabs = " + JSON.stringify(out)); return p.tabs.length * 3; } },
  { name: "Лист: вкладки по очереди", needs: "openSheet", prep: `sheetTabs()`,
    act: async (m, p) => { let n = 0; for (const t of p.tabs) { n += await m.click(t.x, t.y); await sleep(250); } return n; } },
  { name: "Лист: наведение по листу", needs: "openSheet", prep: `sheetRect()`,
    act: async (m, p) => m.sweep(Array.from({ length: 60 }, (_, i) => [p.x + (i % 12) * p.w / 12, p.y + Math.floor(i / 12) * p.h / 5])) },
  { name: "Лист: прокрутка колесом", needs: "openSheet", prep: `sheetRect()`,
    act: async (m, p) => { for (let i = 0; i < 10; i++) { await m.wheel(p.x + p.w * .6, p.y + p.h * .6, i < 5 ? 200 : -200); await sleep(40); } return 10; } },
  { name: "Окно: перетаскивание листа", needs: "openSheet", prep: `sheetHeader()`,
    act: async (m, p) => m.drag(p.x, p.y, p.x - 220, p.y + 90, { steps: 40 }) },
  { name: "Чат: прокрутка", prep: `chatRect()`,
    act: async (m, p) => { for (let i = 0; i < 12; i++) { await m.wheel(p.x, p.y, i < 6 ? -240 : 240); await sleep(40); } return 12; } },
  { name: "Чат: набор текста", prep: `chatInput()`,
    act: async (m, p, b) => { await m.click(p.x, p.y); for (const ch of "проверка набора текста в чате") { await b.send("Input.dispatchKeyEvent", { type: "char", text: ch }); await sleep(20); } return 30; },
    after: `clearChatInput()` },
  { name: "Худ: наведение и списки", prep: `hudPoints()`,
    act: async (m, p) => { let n = await m.sweep(p.hover); for (const c of p.chips) { n += await m.click(c.x, c.y); await sleep(350); n += await m.click(c.x, c.y); await sleep(200); } return n; } },
  { name: "Мышь: зажатая левая кнопка на пустом месте", prep: `canvasCenter()`,
    act: async (m, p) => { let n = 0; for (let i = 0; i < 6; i++) { await m.down(p.x + 300, p.y - 200); await sleep(60); await m.up(p.x + 300, p.y - 200); await sleep(60); n += 2; } return n; } }
];

// Помощники в странице: координаты и подготовка
const PAGE_HELPERS = `
window.__vf = {
  canvasCenter() { const r = canvas.app.view.getBoundingClientRect(); return { x: Math.round(r.left + r.width * .45), y: Math.round(r.top + r.height * .5) }; },
  toClient(pt) { const g = canvas.stage.worldTransform.apply(pt); const r = canvas.app.view.getBoundingClientRect(); return { x: Math.round(r.left + g.x), y: Math.round(r.top + g.y) }; },
  tokenPoints() { const pts = canvas.tokens.placeables.map(t => this.toClient(t.center)); const out = [];
    for (let k = 0; k < 3; k++) for (const p of pts) for (let s = 0; s < 6; s++) out.push([p.x + (s - 3) * 8, p.y + (k - 1) * 10]); return { points: out.length ? out : [[400, 400]] }; },
  tokenPoint() { const t = canvas.tokens.placeables.find(t => t.actor?.type === "character") ?? canvas.tokens.placeables[0]; window.__vfTok = { id: t.id, x: t.document.x, y: t.document.y }; return this.toClient(t.center); },
  async restoreToken() { const s = window.__vfTok; if (s) await canvas.scene.tokens.get(s.id)?.update({ x: s.x, y: s.y }, { animate: false }); },
  actor() { return canvas.tokens.placeables.find(t => t.actor?.type === "character")?.actor ?? game.actors.find(a => a.type === "character"); },
  async openSheet() { const a = this.actor(); if (a.sheet.rendered) await a.sheet.close(); await new Promise(r => setTimeout(r, 300)); await a.sheet.render({ force: true }); await new Promise(r => setTimeout(r, 1200)); a.sheet.setPosition({ left: 300, top: 60 }); return {}; },
  sheet() { return this.actor().sheet; },
  sheetTabs() { return { tabs: [...this.sheet().element.querySelectorAll("nav.sheet-tabs a[data-tab], nav.tabs a[data-tab]")].slice(0, 8).map(a => { const r = a.getBoundingClientRect(); return { name: a.textContent.trim().split(/\\s/)[0], x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }) }; },
  sheetRect() { const r = this.sheet().element.getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + 60), w: Math.round(r.width - 40), h: Math.round(r.height - 80) }; },
  sheetHeader() { const r = this.sheet().element.querySelector(".window-header").getBoundingClientRect(); return { x: Math.round(r.left + r.width * .4), y: Math.round(r.top + r.height / 2) }; },
  async chatRect() { await this.sheet().close(); ui.sidebar.expand?.(); ui.sidebar.changeTab("chat", "primary"); await new Promise(r => setTimeout(r, 600));
    const r = document.querySelector("#sidebar .chat-log, #chat-log")?.getBoundingClientRect() ?? { left: 1300, top: 200, width: 280, height: 500 }; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; },
  chatInput() { const el = document.querySelector("#chat-message, textarea[name=content], .chat-form textarea, #chat-message-input"); const r = el?.getBoundingClientRect() ?? { left: 1400, top: 880, width: 100, height: 20 }; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; },
  clearChatInput() { const el = document.querySelector("#chat-message, textarea[name=content], .chat-form textarea"); if (el) { el.value = ""; if ("innerHTML" in el && el.isContentEditable) el.innerHTML = ""; } el?.blur(); },
  async hudPoints() { ui.sidebar.collapse?.(); const t = canvas.tokens.placeables.find(t => t.actor?.type === "character"); t?.control({ releaseOthers: true }); await new Promise(r => setTimeout(r, 1200));
    const hud = document.getElementById("vedmak-combat-hud"); if (!hud) return { hover: [], chips: [] };
    const box = hud.getBoundingClientRect(); const hover = Array.from({ length: 40 }, (_, i) => [box.left + (i / 40) * box.width, box.top + box.height * .6]);
    const chips = [...hud.querySelectorAll("[data-action=togglePop]")].map(c => { const r = c.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
    return { hover, chips }; }
};
// Long Animation Frames: худший кадр и чей скрипт
window.__loaf = [];
try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__loaf.push({ t: e.startTime, d: e.duration, b: e.blockingDuration,
  st: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0,
  s: e.scripts.map(s => ({ u: (s.sourceURL || "").replace(location.origin, ""), f: s.sourceFunctionName, d: Math.round(s.duration), i: s.invoker })) }); })
  .observe({ type: "long-animation-frame", buffered: false }); } catch (e) { window.__loafError = String(e); }
true`;

const METRICS = ["RecalcStyleDuration", "RecalcStyleCount", "LayoutDuration", "LayoutCount", "ScriptDuration", "TaskDuration"];
async function metrics(b) {
  const r = await b.send("Performance.getMetrics");
  return Object.fromEntries(r.result.metrics.filter(m => METRICS.includes(m.name)).map(m => [m.name, m.value]));
}

// Профиль процессора: собственное время по файлам — чей код (система, ядро, PIXI) занимал холодный кадр
function profileByFile(profile) {
  const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n]));
  const dt = profile.timeDeltas ?? [];
  profile.samples?.forEach((id, i) => { const n = byId.get(id); const u = n?.callFrame?.url || `(${n?.callFrame?.functionName || "программа"})`;
    const key = /systems\/vedmak\//.test(u) ? "система: " + u.split("systems/vedmak/")[1].split("?")[0]
      : /scripts\/foundry/.test(u) ? "ядро Foundry" : /pixi/.test(u) ? "PIXI" : /modules\//.test(u) ? "модуль: " + u.split("modules/")[1].split("/")[0] : u.startsWith("(") ? u : "прочее";
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000); });
  const total = [...self.values()].reduce((a, v) => a + v, 0) || 1;
  const sys = [...self].filter(([k]) => k.startsWith("система")).reduce((a, [, v]) => a + v, 0);
  return { systemShare: Math.round(100 * sys / total), top: [...self].sort((a, c) => c[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${Math.round(v)} мс`) };
}

async function measure(b, action, { profile = false } = {}) {
  const m = mouse(b);
  const runPrep = () => b.ev(`(async () => await window.__vf.${action.prep.replace(/\(\)$/, "")}())()`);
  // Подготовка — вне замера; у «измеряемой подготовки» (открытие листа) она и есть действие
  const prepVal = action.measurePrep ? null : await runPrep();
  // Профилировщик включается до замера и выключается после: его запуск и остановка сами дают кадр ~200 мс
  if (profile) { await b.send("Profiler.enable"); await b.send("Profiler.setSamplingInterval", { interval: 200 }); await b.send("Profiler.start"); }
  await sleep(400);
  await b.ev("window.__loaf.length = 0; performance.now()");
  const m0 = await metrics(b); const t0 = Date.now();
  const events = action.measurePrep ? (await runPrep(), 1) : await action.act(m, prepVal, b);
  await sleep(500); // докатиться кадрам и анимациям
  const m1 = await metrics(b); const wall = Date.now() - t0 - 500;
  const loaf = await b.ev("window.__loaf.slice()");
  const prof = profile ? profileByFile((await b.send("Profiler.stop")).result.profile) : null;
  const perTab = action.perTab ? await b.ev("window.__vfTabs") : null;
  if (action.after) await b.ev(`(async () => await window.__vf.${action.after.replace(/\(\)$/, "")}())()`);
  const d = k => (m1[k] ?? 0) - (m0[k] ?? 0);
  const worst = loaf.reduce((a, e) => e.d > (a?.d ?? 0) ? e : a, null);
  const scripts = new Map();
  for (const e of loaf) for (const s of e.s) { const key = `${s.u.split("/").slice(-2).join("/") || "?"} ${s.f || s.i || ""}`.trim(); scripts.set(key, (scripts.get(key) ?? 0) + s.d); }
  return {
    name: action.name, events: Math.max(1, events), wall,
    styleMs: Math.round(d("RecalcStyleDuration") * 1000), styleCount: d("RecalcStyleCount"),
    layoutMs: Math.round(d("LayoutDuration") * 1000), layoutCount: d("LayoutCount"), scriptMs: Math.round(d("ScriptDuration") * 1000),
    worstFrame: Math.round(worst?.d ?? 0), blocking: Math.round(loaf.reduce((a, e) => a + (e.b ?? 0), 0)), longFrames: loaf.length,
    worstStyle: Math.round(worst?.st ?? 0),
    topScripts: [...scripts].sort((a, c) => c[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v} мс`),
    profile: prof, perTab
  };
}

// Стили системы выключить/включить (А/Б): наши таблицы — link на systems/vedmak/
const TOGGLE_CSS = on => `document.querySelectorAll('link[rel=stylesheet][href*="systems/vedmak/"]').forEach(l => l.disabled = ${!on}); true`;

async function selectorStats(b, action) {
  const events = [];
  const on = m => { if (m.method === "Tracing.dataCollected") events.push(...m.params.value); };
  b.on(on);
  const done = new Promise(r => { const f = m => { if (m.method === "Tracing.tracingComplete") { b.off(f); r(); } }; b.on(f); });
  await b.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-blink.debug", transferMode: "ReportEvents" });
  if (action.needs) await b.ev(`(async () => await window.__vf.${action.needs}())()`);
  await measure(b, action);
  await b.send("Tracing.end"); await done; b.off(on);
  const agg = new Map();
  for (const e of events) {
    const list = e.name === "SelectorStats" ? e.args?.selector_stats?.selector_timings : null;
    if (!list) continue;
    for (const s of list) {
      const a = agg.get(s.selector) ?? { selector: s.selector, us: 0, attempts: 0, matches: 0 };
      a.us += s.elapsed ?? s["elapsed (us)"] ?? 0; a.attempts += s.match_attempts ?? 0; a.matches += s.match_count ?? 0;
      agg.set(s.selector, a);
    }
  }
  return { events: events.length, top: [...agg.values()].sort((x, y) => y.us - x.us).slice(0, 15) };
}

// ───────────── Прогон ─────────────
let foundry = null;
if (!(await serverUp())) {
  if (!args.includes("--start")) { console.error(`Тестовый Foundry не отвечает на ${URL}. Запустите его или добавьте --start.`); process.exit(2); }
  console.log("Поднимаю тестовый Foundry…");
  rmSync(join(CFG.data, "Config/options.json.lock"), { recursive: true, force: true });
  foundry = spawn(CFG.node, ["main.mjs", `--dataPath=${CFG.data}`, `--port=${CFG.port}`, "--noupnp", "--noupdate", `--world=${CFG.world}`], { cwd: CFG.foundry, stdio: "ignore" });
  for (let i = 0; i < 120 && !(await serverUp()); i++) await sleep(1000);
}
mkdirSync(RESULTS, { recursive: true });
const b = await openBrowser(9480);
const rows = [];
let sel = null;
try {
  await b.send("Page.enable"); await b.send("Runtime.enable"); await b.send("Performance.enable");
  await b.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
  await b.send("Page.navigate", { url: `${URL}/join` }); await sleep(3000);
  await b.ev(`(async()=>{for(let i=0;i<120&&!document.querySelector('select[name=userid]');i++)await new Promise(r=>setTimeout(r,250));document.querySelector('select[name=userid]').value=${JSON.stringify(CFG.user)};document.querySelector('button[name=join]').click();return 1})()`);
  await sleep(3000);
  await b.ev(`(async()=>{for(let i=0;i<480&&!(window.game?.ready&&window.canvas?.ready);i++)await new Promise(r=>setTimeout(r,250));return 1})()`);
  // Сцена с токенами: «Съёмка», иначе активная; пауза снята
  await b.ev(`(async () => { const s = game.scenes.getName("Съёмка") ?? game.scenes.active; if (s && !s.active) { await s.activate(); await new Promise(r => setTimeout(r, 2500)); }
    if (game.paused) game.togglePause(false, { broadcast: true }); return canvas.scene?.name; })()`);
  await sleep(2000);
  await b.ev(PAGE_HELPERS);
  const list = ACTIONS.filter(a => !only.length || only.some(o => a.name.toLowerCase().includes(o.toLowerCase())));
  for (const a of list) {
    process.stdout.write(`▶ ${a.name}… `);
    let r, cold;
    // Дважды: первый раз — холодный (построение вкладок, загрузка шаблонов: игрок видит однажды), второй — прогретый
    // (то, что повторяется при каждом действии). Вердикт — по прогретому; холодный фриз — отдельной пометкой.
    try {
      if (a.needs) await b.ev(`(async () => await window.__vf.${a.needs}())()`);
      cold = await measure(b, a, { profile: true });
      // Прогретое — трижды, берётся медиана по худшему кадру: одиночный кадр (сборка мусора, программная отрисовка
      // холста) иначе даёт ложный «фриз» то в одном прогоне, то в другом
      const warm = []; for (let k = 0; k < 3; k++) warm.push(await measure(b, a));
      r = warm.sort((x, y) => x.worstFrame - y.worstFrame)[1];
      r.warmFrames = warm.map(w => w.worstFrame);
    } catch (e) { console.log(`ошибка: ${e.message.slice(0, 160)}`); continue; }
    r.cold = { worstFrame: cold.worstFrame, styleMs: cold.styleMs, topScripts: cold.topScripts, profile: cold.profile, perTab: cold.perTab };
    const lim = a.freezeMs ?? FREEZE_MS; // разовое (открыть окно) — свой порог
    r.verdict = r.worstFrame > lim ? "ФРИЗ" : r.worstFrame > Math.max(JANK_MS, lim / 2) || r.styleMs / r.events > STYLE_PER_EVENT ? "подтормаживает" : "ок";
    if (r.verdict === "ок" && cold.worstFrame > lim) r.verdict = "фриз в первый раз";
    // А/Б (прогретое): то же без стилей системы — наши ли CSS виноваты
    if (r.verdict !== "ок" && r.verdict !== "фриз в первый раз") {
      await b.ev(TOGGLE_CSS(false));
      try { const offs = []; for (let k = 0; k < 3; k++) offs.push(await measure(b, a)); const off = offs.sort((x, y) => x.worstFrame - y.worstFrame)[1]; r.ab = { styleMs: off.styleMs, worstFrame: off.worstFrame }; } finally { await b.ev(TOGGLE_CSS(true)); }
    }
    rows.push(r);
    console.log(`${r.verdict}: кадр ${r.worstFrame} мс [${r.warmFrames.join("/")}] (в первый раз ${cold.worstFrame}), стили ${r.styleMs} мс (${(r.styleMs / r.events).toFixed(1)}/событие)${r.ab ? `, без стилей системы — кадр ${r.ab.worstFrame}, стили ${r.ab.styleMs}` : ""}`);
  }
  // Селекторы — для действия с самым дорогим пересчётом стилей
  const heavy = [...rows].sort((x, y) => y.styleMs - x.styleMs)[0];
  if (heavy) { sel = { action: heavy.name, ...(await selectorStats(b, ACTIONS.find(a => a.name === heavy.name))) }; }
} finally {
  b.close();
  if (foundry) killTree(foundry);
}

// ───────────── Отчёт ─────────────
const md = [
  "# Охота на фризы", "",
  `Порог фриза — кадр дольше ${FREEZE_MS} мс; подтормаживание — кадр дольше ${JANK_MS} мс или пересчёт стилей больше ${STYLE_PER_EVENT} мс на событие.`,
  "А/Б — то же действие со стилями системы, отключёнными. Безголовый Edge рисует холст программно: цифры холста завышены.", "",
  "Каждое действие: «в первый раз» (холодное) и трижды повторно (прогретое, медиана по худшему кадру); итог — по повторному.", "",
  "| Действие | Итог | Худший кадр, мс | В первый раз, мс | Блокировка, мс | Стили, мс (на событие) | Раскладка, мс | Скрипты, мс | Без стилей системы | Кто в худшем кадре |",
  "|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map(r => `| ${r.name} | ${r.verdict} | ${r.worstFrame} | ${r.cold.worstFrame} | ${r.blocking} | ${r.styleMs} (${(r.styleMs / r.events).toFixed(1)}) | ${r.layoutMs} | ${r.scriptMs} | ${r.ab ? `кадр ${r.ab.worstFrame}, стили ${r.ab.styleMs}` : "—"} | ${(r.worstFrame ? r.topScripts : r.cold.topScripts).join("; ") || "—"} |`),
  "", "## Первый раз — чей код (профиль процессора холодного замера)", "",
  "| Действие | Кадр в первый раз, мс | Доля кода системы | Больше всего времени |", "|---|---|---|---|",
  ...rows.map(r => `| ${r.name} | ${r.cold.worstFrame} | ${r.cold.profile ? r.cold.profile.systemShare + "%" : "—"} | ${r.cold.profile?.top.join("; ") ?? "—"} |`),
  ...rows.filter(r => r.perTab?.length).map(r => `\nПервое открытие вкладок (худший кадр, мс): ${r.perTab.join(", ")}.`),
  "", sel ? `## Дорогие селекторы — «${sel.action}» (событий трассы: ${sel.events})` : "", "",
  ...(sel?.top?.length ? ["| Селектор | Время, мкс | Попыток | Совпадений |", "|---|---|---|---|", ...sel.top.map(s => `| \`${s.selector.replace(/\|/g, "\\|")}\` | ${Math.round(s.us)} | ${s.attempts} | ${s.matches} |`)]
    : ["Трасса SelectorStats пуста (браузер не отдал статистику селекторов)."])
].join("\n");
writeFileSync(join(RESULTS, "freeze.md"), md);
writeFileSync(join(RESULTS, "freeze.json"), JSON.stringify({ rows, selectors: sel }, null, 1));
const frozen = rows.filter(r => r.verdict === "ФРИЗ");
console.log(`\nИтог: ${rows.length} действий, фризов — ${frozen.length}${frozen.length ? ` (${frozen.map(r => r.name).join(", ")})` : ""}. Отчёт — ${join(RESULTS, "freeze.md")}`);
process.exit(frozen.length ? 1 : 0);
