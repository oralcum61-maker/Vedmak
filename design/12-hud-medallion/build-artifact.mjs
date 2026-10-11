// Собирает artifact.html для публикации артефактом: без каркаса страницы, картинки и шрифты встроены data:.
import fs from "node:fs";
const MIME = { webp: "image/webp", png: "image/png", woff2: "font/woff2", svg: "image/svg+xml" };
let s = fs.readFileSync("mockup.html", "utf8");
s = s.replace(/<!doctype html>\s*<html[^>]*>\s*<head>\s*/i, "")
  .replace(/<meta[^>]*>\s*/g, "")
  .replace(/<\/head>\s*<body>\s*/i, "")
  .replace(/<\/body>\s*<\/html>\s*$/i, "\n");
// Тёмная тема и поля страницы; сцены уже обёрнуты в .scroll в самом макете
s = s.replace(":root {", ":root { color-scheme: dark;")
  .replace(".page { max-width: 1180px; margin: 0 auto; padding: 32px 20px 56px; }", ".page { max-width: 1180px; margin: 0 auto; padding-block: 32px 56px; padding-inline: 16px; }");
s = s.replace(/img\/([\w./-]+?)\.(webp|png|woff2|svg)/g, (_, n, ext) =>
  `data:${MIME[ext]};base64,${fs.readFileSync(`img/${n}.${ext}`).toString("base64")}`);
// На узком экране сцена открывается медальоном к центру
s = s.replace(/<\/script>\s*$/, `for (const el of document.querySelectorAll(".scroll")) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
</script>
`);
fs.writeFileSync("artifact.html", s);
console.log("artifact.html", (s.length / 1024).toFixed(0), "KB");
