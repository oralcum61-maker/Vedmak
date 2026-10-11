// Сравнить два отпечатка вычисленных стилей (tools/bench/style-snapshot.js): node tools/bench/style-diff.mjs до.json после.json
// Код выхода 1, если хоть у одного элемента изменилось хоть одно свойство.
import { readFileSync } from "node:fs";
const PROPS = ["cursor", "scrollbar-color", "scrollbar-width", "color", "background-color", "background-image", "font-family", "font-size",
  "font-weight", "padding", "margin", "border", "box-shadow", "text-shadow", "display", "opacity"];
const load = f => JSON.parse(JSON.parse(readFileSync(f, "utf8")).log.find(l => l.startsWith("SNAP:")).slice(5));
const [a, b] = process.argv.slice(2).map(load);
const diffs = [];
for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
  if (a[k] === b[k]) continue;
  if (!(k in a) || !(k in b)) { diffs.push(`${k}: ${k in a ? "пропал" : "появился"}`); continue; }
  const x = a[k].split("|"), y = b[k].split("|");
  PROPS.forEach((p, i) => { if (x[i] !== y[i]) diffs.push(`${k} — ${p}: «${x[i]}» → «${y[i]}»`); });
}
console.log(`элементов: ${Object.keys(a).length} и ${Object.keys(b).length}; различий: ${diffs.length}`);
for (const d of diffs.slice(0, 40)) console.log("  " + d);
process.exit(diffs.length ? 1 : 0);
