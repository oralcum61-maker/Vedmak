// Готовит «пакет» для design-sync: стили системы одним файлом, картинки встроены data:, шрифты рядом.
// Запуск из корня репозитория: node .design-sync/prepare.mjs → .ds-src/ (в git не входит).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".ds-src");
fs.mkdirSync(path.join(OUT, "dist"), { recursive: true }); fs.mkdirSync(path.join(OUT, "fonts"), { recursive: true });
const MIME = { ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".cur": "image/x-icon" };
let css = "";
let inlined = 0;
for (const f of ["styles/vedmak.css", "styles/sheet.css"]) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  css += `\n/* ═══ ${f} ═══ */\n` + src.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (all, q, u) => {
    if (/^(data:|#|https?:)/.test(u)) return all;
    const file = path.join(ROOT, "styles", u.split(/[?#]/)[0]);
    if (/\.woff2?$/.test(u)) { fs.copyFileSync(file, path.join(OUT, "fonts", path.basename(file))); return `url("./fonts/${path.basename(file)}")`; }
    const mime = MIME[path.extname(file).toLowerCase()]; if (!mime) throw new Error("тип? " + u);
    inlined++;
    return `url("data:${mime};base64,${fs.readFileSync(file).toString("base64")}")`;
  });
}
fs.writeFileSync(path.join(OUT, "gravure.css"), css);
fs.writeFileSync(path.join(OUT, "dist", "index.js"), "export {};\n");
fs.writeFileSync(path.join(OUT, "dist", "index.d.ts"), "export {};\n");
fs.writeFileSync(path.join(OUT, "package.json"), JSON.stringify({ name: "vedmak-gravure", version: JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"))).version, private: true, main: "dist/index.js", types: "dist/index.d.ts" }, null, 2));
console.log(`gravure.css ${(css.length / 1024).toFixed(0)} KB, встроено картинок: ${inlined}`);
