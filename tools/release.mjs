// Собрать выпуск системы для установки в Foundry по ссылке-манифесту.
// Запуск: node tools/release.mjs 0.1.1
// Результат: dist/vedmak/ (содержимое архива) и dist/system.json (манифест выпуска).
// Архив dist/vedmak.zip делает workflow выпуска (.github/workflows/release.yml).
//
// Рабочие файлы не трогаются: всё собирается в копии. В выпуск не входят служебные папки и жетоны
// assets/tokens — наборы 2-Minute Tabletop нельзя раздавать; в бестиарии вместо них встают портреты.
// Для пересборки бестиария нужен classic-level: FOUNDRY_APP — папка Foundry или любая папка с ним.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "https://github.com/oralcum61-maker/Vedmak";
const DIST = path.join(ROOT, "dist");
const OUT = path.join(DIST, "vedmak");

const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Укажите версию: node tools/release.mjs 0.1.1");
  process.exit(1);
}

/** Не входит в выпуск: разработка, источники компендиумов, жетоны без права раздачи. */
const EXCLUDE = [
  ".github/", ".claude/", "design/", "docs/", "packs-src/", "tools/", "assets/tokens/",
  "CLAUDE.md", ".gitignore", ".gitattributes"
];
/** Нужно только на время сборки: пересборка бестиария. */
const BUILD_ONLY = ["packs-src/", "tools/build-packs.mjs", "tools/pack-overrides.mjs"];

const TOKENS = "systems/vedmak/assets/tokens/";

// 1. Копия файлов из git
fs.rmSync(DIST, { recursive: true, force: true });
const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
let copied = 0;
for (const file of files) {
  const buildOnly = BUILD_ONLY.some(p => file.startsWith(p));
  if (!buildOnly && EXCLUDE.some(p => file === p || file.startsWith(p))) continue;
  const target = path.join(OUT, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(ROOT, file), target);
  copied++;
}

// 2. Жетоны → портреты во всех источниках компендиумов
let replaced = 0;
const srcDir = path.join(OUT, "packs-src");
const touched = [];
for (const file of fs.readdirSync(srcDir).filter(f => f.endsWith(".json"))) {
  const docs = JSON.parse(fs.readFileSync(path.join(srcDir, file), "utf8"));
  let changed = false;
  for (const doc of docs) {
    // Портрет, взятый из жетонов (у «Рабочего»), тоже нельзя раздавать — ставим стандартный силуэт Foundry
    if (doc.img?.startsWith(TOKENS)) { doc.img = "icons/svg/mystery-man.svg"; changed = true; }
    const tex = doc.prototypeToken?.texture;
    if (tex?.src?.startsWith(TOKENS)) {
      tex.src = doc.img || "icons/svg/mystery-man.svg";
      replaced++;
      changed = true;
    }
  }
  const left = JSON.stringify(docs).includes(TOKENS);
  if (left) throw new Error(`${file}: остались ссылки на ${TOKENS} вне жетонов — выпуск без них сломается`);
  if (changed) {
    fs.writeFileSync(path.join(srcDir, file), JSON.stringify(docs, null, 2));
    touched.push(file.slice(0, -5));
  }
}

// 3. Манифест выпуска: версия и ссылки
const manifestPath = path.join(OUT, "system.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.version = version;
manifest.url = REPO;
manifest.manifest = `${REPO}/releases/latest/download/system.json`;
// Ссылка на архив именно этой версии: старый манифест не должен скачивать новый архив
manifest.download = `${REPO}/releases/download/v${version}/vedmak.zip`;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

// 4. Пересборка изменённых пакетов в копии, затем убрать то, что нужно было только для сборки
if (touched.length) {
  execFileSync(process.execPath, [path.join(OUT, "tools/build-packs.mjs"), ...touched], { cwd: OUT, stdio: "inherit" });
}
for (const p of BUILD_ONLY) fs.rmSync(path.join(OUT, p), { recursive: true, force: true });
fs.rmSync(path.join(OUT, "tools"), { recursive: true, force: true });

// 5. Последняя проверка: ни одной ссылки на жетоны в коде, шаблонах и пакетах выпуска
const leftovers = [];
(function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(p);
    else if (/\.(mjs|hbs|css|json|log|ldb)$/.test(entry.name) || /^MANIFEST-/.test(entry.name)) {
      if (fs.readFileSync(p).includes("assets/tokens/")) leftovers.push(path.relative(OUT, p));
    }
  }
})(OUT);
if (leftovers.length) throw new Error(`В выпуске остались ссылки на жетоны: ${leftovers.join(", ")}`);

fs.copyFileSync(manifestPath, path.join(DIST, "system.json"));
console.log(`Выпуск ${version}: ${copied} файлов, жетонов заменено портретами — ${replaced}, пересобрано: ${touched.join(", ") || "—"}.`);
console.log(`Готово: dist/vedmak/ и dist/system.json.`);
