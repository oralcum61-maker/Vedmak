// Клиент тестового мира в безголовом Edge через протокол отладки: вход нужным пользователем, ev(js) в странице, снимок.
// Для проверок несколькими клиентами (tools/bench/players.mjs): ведущий и игрок — два браузера с разными профилями.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * @param {object} o
 * @param {string} o.edge — путь к msedge.exe
 * @param {string} o.url — адрес тестового Foundry (http://localhost:30014)
 * @param {string} o.user — id пользователя мира (пароль пустой)
 * @param {number} [o.port] — порт отладки этого браузера
 */
export async function openClient({ edge, url, user, port = 9640, width = 1400, height = 900 }) {
  const profile = join(tmpdir(), `vedmak-bench-client-${port}`);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  spawn(edge, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--headless=new", `--window-size=${width},${height}`,
    "--no-first-run", "--disable-extensions", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  let page = null;
  for (let i = 0; i < 40 && !page; i++) {
    await sleep(250);
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === "page"); } catch { /* ещё стартует */ }
  }
  if (!page) throw new Error(`Edge на порту ${port} не поднялся`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let id = 0;
  const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expression => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
    return r.result?.result?.value;
  };
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${url}/join` });
  await sleep(2000);
  await ev(`(async () => { for (let i = 0; i < 120 && !document.querySelector("select[name=userid]"); i++) await new Promise(r => setTimeout(r, 250));
    document.querySelector("select[name=userid]").value = ${JSON.stringify(user)}; document.querySelector("button[name=join]").click(); return 1; })()`);
  await sleep(2500);
  await ev(`(async () => { for (let i = 0; i < 480 && !(window.game?.ready && window.canvas?.ready); i++) await new Promise(r => setTimeout(r, 250));
    window.__errs = []; window.addEventListener("error", e => window.__errs.push(String(e.message)));
    window.addEventListener("unhandledrejection", e => window.__errs.push(String(e.reason?.message ?? e.reason))); return 1; })()`);
  await sleep(1500);
  const shot = async file => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(file, Buffer.from(r.result.data, "base64"));
  };
  const close = () => {
    try { ws.close(); } catch { /* уже закрыт */ }
    // Edge перезапускает себя: добиваем процессы с этим профилем
    if (process.platform === "win32") spawnSync("powershell", ["-NoProfile", "-Command",
      `Get-CimInstance Win32_Process -Filter "name='msedge.exe'" | Where-Object { $_.CommandLine -like '*vedmak-bench-client-${port}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* профиль ещё держится */ }
  };
  return { send, ev, shot, close };
}
