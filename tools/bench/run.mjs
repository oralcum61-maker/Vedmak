// Автотесты системы в настоящем Foundry: безголовый Edge входит в тестовый мир и выполняет сценарии.
//
//   node tools/bench/run.mjs                 — быстрый набор (tools/bench/scenarios, точечные проверки, ~5 мин)
//   node tools/bench/run.mjs полный          — обходы tools/bench/sweeps (каждое оружие, заклинание, рецепт,
//                                              кнопка листа и мастер создания; долго, десятки минут)
//   node tools/bench/run.mjs vampire rules   — выбранные сценарии по имени файла (без .js)
//   node tools/bench/run.mjs путь/к/файлу.js — сценарий вне набора (сборщик заготовок _tools/pregens)
//   --start — поднять тестовый Foundry самому (иначе он должен уже работать на VD_PORT)
//
// Пути — переменные среды, по умолчанию — машина автора: VD_FOUNDRY (папка app Foundry), VD_DATA (данные тестового
// Foundry; система подключена туда ссылкой на репозиторий), VD_NODE, VD_EDGE, VD_PORT (30014), VD_WORLD (test-vedmak),
// VD_USER (id ведущего тестового мира, пароль пустой). Живой мир пользователя никогда не используется.
//
// Сценарий — тело async-функции в странице мира: доступны помощники tools/bench/lib/common.js (log, ok, wait,
// placeToken, folder, A/D/G/C — модули боя). ok(условие, текст) — проверка: провал хоть одной — сценарий упал.
// Исключение и ошибка в консоли (кроме шума из IGNORE) — тоже провал. Итог: таблица и код выхода 1 при провале.
//
// Не держите тестовый мир открытым этим же ведущим в другом окне: обработчики «своих» удалений сработают в обоих
// клиентах (конец Истинной и медвежьей формы дважды убирает оружие формы — «Item … does not exist»).
// Тестовый Foundry работает с пакетами репозитория и трогает их файлы: после прогона — git checkout -- packs.

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
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

/** Шум, не связанный с системой: картинки модулей, которых нет в тестовом Foundry; ошибка ядра при удалении
 * документов во время уборки сценария (была и до 2.7.0, на игру не влияет). */
const IGNORE = [/Invalid Asset/, /postNotification/, /reading 'filters'/, /requires (usable window dimensions|a screen resolution)/,
  /Failed to load resource/];

const args = process.argv.slice(2);
const start = args.includes("--start");
const names = args.filter(a => !a.startsWith("--"));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function pickScenarios() {
  // Путь к файлу сценария вне набора (например, сборщик заготовок в _tools)
  const files = names.filter(n => n.endsWith(".js") && existsSync(n));
  if (files.length) return files.map(f => ({ name: basename(f, ".js"), file: f, sweep: false }));
  const dir = names[0] === "полный" || names[0] === "full" ? "sweeps" : "scenarios";
  const all = readdirSync(join(HERE, dir)).filter(f => f.endsWith(".js")).sort();
  const wanted = dir === "sweeps" || !names.length ? all : all.filter(f => names.includes(f.replace(/\.js$/, "")));
  if (!wanted.length) throw new Error(`Сценарии не найдены: ${names.join(", ")}. Есть: ${all.map(f => f.replace(/\.js$/, "")).join(", ")}`);
  return wanted.map(f => ({ name: f.replace(/\.js$/, ""), file: join(HERE, dir, f), sweep: dir === "sweeps" }));
}

async function serverUp() {
  try { return (await fetch(`${URL}/join`)).ok; } catch { return false; }
}

/**
 * Завершить процесс со всеми потомками. На Windows `kill()` снимает только запускающий процесс: дочерние процессы
 * Edge оставались жить, держали временный профиль (его нельзя было удалить) и копились от прогона к прогону.
 */
function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill();
}

/**
 * Закрыть безголовый Edge сценария. Edge перезапускает себя, и запущенный нами процесс — уже не родитель остальных:
 * сначала просим браузер закрыться через протокол отладки, затем на Windows добиваем процессы с этим профилем.
 */
async function closeEdge(edge, debugPort, profile) {
  try {
    const v = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
    const bws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise(done => {
      bws.onopen = () => { bws.send(JSON.stringify({ id: 1, method: "Browser.close" })); setTimeout(done, 1500); };
      bws.onerror = done;
      setTimeout(done, 3000);
    });
  } catch {}
  killTree(edge);
  if (process.platform === "win32") {
    const filter = profile.replace(/'/g, "''");
    spawnSync("powershell", ["-NoProfile", "-Command",
      `Get-CimInstance Win32_Process -Filter "name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${filter}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
      { stdio: "ignore" });
  }
}

async function startFoundry() {
  rmSync(join(CFG.data, "Config/options.json.lock"), { recursive: true, force: true });
  const p = spawn(CFG.node, ["main.mjs", `--dataPath=${CFG.data}`, `--port=${CFG.port}`, "--noupnp", "--noupdate", `--world=${CFG.world}`],
    { cwd: CFG.foundry, stdio: "ignore", detached: false });
  for (let i = 0; i < 120 && !(await serverUp()); i++) await sleep(1000);
  if (!(await serverUp())) throw new Error("Тестовый Foundry не поднялся");
  return p;
}

/** Один сценарий в отдельном безголовом Edge. */
async function runScenario(sc, debugPort) {
  const profile = join(tmpdir(), `vedmak-bench-${debugPort}`);
  mkdirSync(profile, { recursive: true });
  const edge = spawn(CFG.edge, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "--headless=new",
    "--window-size=1600,950", "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-extensions",
    "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: "ignore" });
  const errors = [];
  let step = "загрузка";
  let ws;
  try {
    await sleep(2500);
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    const page = targets.find(t => t.type === "page");
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener("open", r, { once: true }));
    let id = 0; const pending = new Map();
    ws.addEventListener("message", e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        errors.push(`[${step}] ${(d.exception?.description ?? d.text ?? "").slice(0, 600)}`);
      }
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        errors.push(`[${step}] ${m.params.args.map(a => a.value ?? a.description ?? "").join(" ").slice(0, 600)}`);
      }
    });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evalJs = async (expr, ms = 30 * 60000) => {
      const r = await Promise.race([send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }),
        sleep(ms).then(() => ({ result: { exceptionDetails: { text: "TIMEOUT" } } }))]);
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 1200));
      return r.result?.result?.value;
    };
    await send("Page.enable"); await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `${URL}/join` });
    await sleep(3000);
    await evalJs(`(async () => { for (let i = 0; i < 120 && !document.querySelector('select[name=userid]'); i++) await new Promise(r => setTimeout(r, 250));
      document.querySelector('select[name=userid]').value = ${JSON.stringify(CFG.user)}; document.querySelector('button[name=join]').click(); return 1; })()`, 60000);
    await sleep(3000);
    await evalJs(`(async () => { for (let i = 0; i < 480 && !(window.game?.ready && window.canvas?.ready); i++) await new Promise(r => setTimeout(r, 250)); return game.ready; })()`, 150000);
    await sleep(1500);
    errors.length = 0;
    const poll = setInterval(async () => {
      try { const s = await send("Runtime.evaluate", { expression: "window.__step ?? ''", returnByValue: true }); if (s.result?.result?.value) step = s.result.result.value; } catch {}
    }, 400);
    const body = readFileSync(sc.file, "utf8");
    // Обходы прежнего стенда объявляют log сами — им общий файл не подмешивается, только метка
    const standalone = /^const log\s*=/m.test(body.split("\n").slice(0, 3).join("\n"));
    const common = standalone ? "" : readFileSync(join(HERE, "lib/common.js"), "utf8");
    let result;
    try {
      result = await evalJs(`(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        window.__log = []; window.__fails = []; window.__tag = ${JSON.stringify(sc.name)};
        ${common}
        ;${body}
        ;return { log: window.__log, fails: window.__fails };
      })()`);
    } catch (e) {
      let partial = {};
      try { partial = (await send("Runtime.evaluate", { expression: "({ log: window.__log, fails: window.__fails, step: window.__step })", returnByValue: true })).result?.result?.value ?? {}; } catch {}
      result = { log: [...(partial.log ?? []), `ШАГ: ${partial.step ?? "?"}`], fails: [...(partial.fails ?? []), `исключение: ${String(e.message).slice(0, 800)}`] };
    }
    clearInterval(poll);
    await sleep(800);
    const realErrors = errors.filter(e => !IGNORE.some(re => re.test(e)));
    return { ...result, errors: realErrors };
  } finally {
    try { ws?.close(); } catch {}
    await closeEdge(edge, debugPort, profile);
    await sleep(800);
    // Edge может ещё держать файлы профиля: недоудалённая временная папка не повод терять итог сценария
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); }
    catch (e) { console.warn(`\n  (профиль Edge не удалён: ${e.code}; ${profile})`); }
  }
}

const scenarios = pickScenarios();
let foundry = null;
if (!(await serverUp())) {
  if (!start) { console.error(`Тестовый Foundry не отвечает на ${URL}. Запустите его или добавьте --start.`); process.exit(2); }
  console.log("Поднимаю тестовый Foundry…");
  foundry = await startFoundry();
}
mkdirSync(RESULTS, { recursive: true });
const summary = [];
let port = 9400;
for (const sc of scenarios) {
  const t0 = Date.now();
  process.stdout.write(`▶ ${sc.name}… `);
  const r = await runScenario(sc, port++);
  const failed = r.fails.length + r.errors.length;
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(failed ? `УПАЛ (${r.fails.length} проверок, ${r.errors.length} ошибок) за ${secs} с` : `прошёл (${r.log.filter(l => l.startsWith("✓")).length} проверок) за ${secs} с`);
  for (const f of r.fails) console.log(`    ✗ ${f}`);
  for (const e of r.errors.slice(0, 5)) console.log(`    ошибка: ${e.split("\n")[0]}`);
  writeFileSync(join(RESULTS, `${sc.name}.json`), JSON.stringify(r, null, 1));
  summary.push({ name: sc.name, failed, secs });
}
if (foundry) killTree(foundry);
const bad = summary.filter(s => s.failed);
console.log(`\nИтог: ${summary.length - bad.length} из ${summary.length} прошли.${bad.length ? ` Упали: ${bad.map(b => b.name).join(", ")}.` : ""} Подробности — ${RESULTS}`);
process.exit(bad.length ? 1 : 0);
