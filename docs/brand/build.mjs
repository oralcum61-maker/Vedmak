// Обложка системы (PLAN 4.213): из арта docs/brand/art.jpg — все размеры с названием шрифтом системы.
// node docs/brand/build.mjs → assets/cover/{cover,setup,thumb}.webp (Foundry) и docs/brand/{banner,social}.jpg (GitHub).
// Название — не на картинке генератора, а наложено: чёткое в любом размере и в оформлении листов (серебро, нить, ромб).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8")).version;
const url = p => pathToFileURL(path.join(ROOT, p)).href;

/**
 * Кадры: размер, где взять кусок арта (доля по вертикали — focusY), есть ли название и его масштаб.
 * Арт 2560×1429: всадник слева, доска с воронами справа, над долиной — небо под название.
 */
const SHOTS = [
  { out: "assets/cover/cover.webp", w: 2000, h: 1116, title: false },
  { out: "assets/cover/setup.webp", w: 1440, h: 720, title: true, scale: 1, focusY: 0.5 },
  { out: "assets/cover/thumb.webp", w: 550, h: 275, title: true, scale: 0.46, focusY: 0.5, compact: true },
  { out: "docs/brand/banner.jpg", w: 1600, h: 560, title: true, scale: 0.92, focusY: 0.1 },
  { out: "docs/brand/social.jpg", w: 1280, h: 640, title: true, scale: 0.95, focusY: 0.35 }
];

const page = s => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Vedmak Display"; src: url("${url("fonts/VedmakDisplay.woff2")}") format("woff2"); }
@font-face { font-family: "Vedmak Sans"; src: url("${url("fonts/VedmakSans.woff2")}") format("woff2"); font-weight: 100 700; }
html, body { margin: 0; background: #131417; }
.f { position: relative; width: ${s.w}px; height: ${s.h}px; overflow: hidden;
  background: url("${url("docs/brand/art.jpg")}") 50% ${Math.round((s.focusY ?? 0.5) * 100)}% / cover no-repeat; }
/* Тень под названием: небо над долиной светлое — серебру нужна тёмная подложка */
.f::before { content: ""; position: absolute; inset: 0;
  background: radial-gradient(ellipse 34% 30% at 52% 27%, rgba(10,11,13,.62), rgba(10,11,13,0) 100%),
    linear-gradient(180deg, rgba(10,11,13,.35), transparent 30%, transparent 70%, rgba(10,11,13,.45)); }
.t { position: absolute; left: 52%; top: ${s.compact ? 24 : 27}%; transform: translate(-50%, -50%) scale(${s.scale ?? 1});
  text-align: center; color: #f3eee2; white-space: nowrap; }
.t h1 { margin: 0; font: 400 112px/0.9 "Vedmak Display", serif; letter-spacing: .1em; padding-left: .1em;
  text-shadow: 0 2px 0 rgba(0,0,0,.6), 0 0 24px rgba(0,0,0,.85), 0 0 60px rgba(0,0,0,.6); }
.t .nri { display: block; margin-top: 10px; font: 400 40px/1 "Vedmak Display", serif; letter-spacing: .5em; padding-left: .5em; color: #ddd6c6;
  text-shadow: 0 0 18px rgba(0,0,0,.9); }
.thread { position: relative; width: 360px; height: 1px; margin: 22px auto 14px;
  background: linear-gradient(90deg, transparent, #f3eee2 30%, #f3eee2 70%, transparent); }
.thread i { position: absolute; left: 50%; top: -5px; width: 10px; height: 10px; margin-left: -5px; background: #b8432c; transform: rotate(45deg);
  box-shadow: 0 0 10px rgba(184,67,44,.8); }
.sub { font: 500 17px "Vedmak Sans", sans-serif; letter-spacing: .32em; text-transform: uppercase; color: #cfc8b8;
  text-shadow: 0 0 12px rgba(0,0,0,.95); }
</style></head><body><div class="f">${s.title ? `<div class="t"><h1>Ведьмак</h1><span class="nri">НРИ</span>
  ${s.compact ? "" : `<div class="thread"><i></i></div><div class="sub">${s.sub ? `система для Foundry VTT · ${VERSION}` : "система для Foundry VTT"}</div>`}</div>` : ""}</div></body></html>`;

process.env.PLAYWRIGHT_BROWSERS_PATH ??= "D:\\ms-playwright";
const pwPath = path.join(ROOT, ".ds-sync/node_modules/playwright/index.mjs");
if (!fs.existsSync(pwPath)) throw new Error(`Нет Playwright: ${pwPath} (поставьте npm i playwright в .ds-sync)`);
const pw = await import(pathToFileURL(pwPath).href);
const browser = await pw.chromium.launch();
const tmp = path.join(HERE, "_frame.html");
for (const s of SHOTS) {
  const p = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  fs.writeFileSync(tmp, page(s));
  await p.goto(pathToFileURL(tmp).href, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  const png = path.join(HERE, "_frame.png");
  await p.screenshot({ path: png, clip: { x: 0, y: 0, width: s.w, height: s.h } });
  await p.close();
  const out = path.join(ROOT, s.out);
  // webp и jpg — через ffmpeg (Chromium снимает только png и jpeg)
  const { spawnSync } = await import("node:child_process");
  const args = out.endsWith(".webp") ? ["-c:v", "libwebp", "-quality", "86"] : ["-q:v", "3"];
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", png, ...args, out]);
  if (r.status) throw new Error(`ffmpeg: ${r.stderr}`);
  console.log(`${s.out}: ${s.w}×${s.h}, ${Math.round(fs.statSync(out).size / 1024)} КБ`);
}
fs.rmSync(tmp); fs.rmSync(path.join(HERE, "_frame.png"));
await browser.close();
