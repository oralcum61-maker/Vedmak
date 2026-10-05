// Статические проверки системы без запуска Foundry.
// Запуск: node tools/check.mjs                 — всё
//         node tools/check.mjs packs templates — только выбранные разделы: code, templates, packs
//
//  code      — синтаксис модулей (node --check), именованные импорты, настройки, кнопки data-action;
//  templates — шаблоны компилируются (handlebars берётся из Foundry по FOUNDRY_APP или из node_modules),
//              пути к шаблонам существуют, подшаблоны зарегистрированы в TEMPLATE_PATHS (module/helpers.mjs);
//  packs     — packs-src против схем TypeDataModel, ссылки Compendium.vedmak.…, картинки системы,
//              значки Foundry (если найдена папка Foundry), повторы значков.
// Ошибки дают код выхода 1, предупреждения — нет.

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FOUNDRY_APP = process.env.FOUNDRY_APP ?? "D:/FoundryVTT-WindowsPortable-14.365/App/resources/app";
const HAS_FOUNDRY = fs.existsSync(path.join(FOUNDRY_APP, "package.json"));

const SECTIONS = { code: "код", templates: "шаблоны", packs: "компендиумы" };
const selected = process.argv.slice(2).filter(a => a in SECTIONS);
const run = key => !selected.length || selected.includes(key);

const errors = new Map();   // сообщение → число повторов
const warnings = new Map();
const add = (map, section, msg) => map.set(`[${section}] ${msg}`, (map.get(`[${section}] ${msg}`) ?? 0) + 1);
const err = (section, msg) => add(errors, section, msg);
const warn = (section, msg) => add(warnings, section, msg);

const read = f => fs.readFileSync(f, "utf8");
const rel = f => path.relative(ROOT, f).split(path.sep).join("/");

/** Файлы с расширением, без служебных папок, макетов и собранных пакетов. */
function listFiles(dir, ext) {
  const skip = new Set([".git", "node_modules", "dist", "design", "packs", "packs-src", "assets", "fonts"]);
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!skip.has(entry.name)) out.push(...listFiles(path.join(dir, entry.name), ext)); }
    else if (entry.name.endsWith(ext)) out.push(path.join(dir, entry.name));
  }
  return out.sort();
}

/* -------------------------------------------------------------------------- */
/*  Код                                                                       */
/* -------------------------------------------------------------------------- */

/** Действия, которые Foundry обрабатывает сам (ApplicationV2, DocumentSheetV2, ActiveEffectConfig). */
const BUILTIN_ACTIONS = new Set(["tab", "editImage", "addChange", "deleteChange", "close", "toggleControls"]);

function checkCode() {
  const S = SECTIONS.code;
  const files = listFiles(ROOT, ".mjs");
  for (const f of files) {
    const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
    if (r.status !== 0) err(S, `${rel(f)}: ${r.stderr.split("\n").find(l => /Error/.test(l)) ?? r.stderr.trim()}`);
  }

  // Именованные импорты между модулями системы
  const exportsOf = new Map();
  for (const f of files) {
    const s = read(f);
    const names = new Set();
    for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([\w$]+)/g)) names.add(m[1]);
    for (const m of s.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(",")) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
    }
    exportsOf.set(path.normalize(f), names);
  }
  for (const f of files) {
    const s = read(f);
    for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
      if (!m[2].startsWith(".")) continue;
      const names = exportsOf.get(path.normalize(path.join(path.dirname(f), m[2])));
      if (!names) { err(S, `${rel(f)}: нет модуля ${m[2]}`); continue; }
      for (const part of m[1].split(",")) {
        const n = part.trim().split(/\s+as\s+/)[0];
        if (n && !names.has(n)) err(S, `${rel(f)}: ${m[2]} не экспортирует ${n}`);
      }
    }
    for (const m of s.matchAll(/import\s+(?:\*\s+as\s+[\w$]+\s+from\s+|[\w$]+\s+from\s+)?["'](\.[^"']+)["']/g)) {
      if (!exportsOf.has(path.normalize(path.join(path.dirname(f), m[1])))) err(S, `${rel(f)}: нет модуля ${m[1]}`);
    }
  }

  // Манифест: всё, на что ссылается system.json, существует (модули, стили, языки, пакеты, картинки)
  try {
    const manifest = JSON.parse(read(path.join(ROOT, "system.json")));
    const needed = [
      ...(manifest.esmodules ?? []), ...(manifest.styles ?? []),
      ...(manifest.languages ?? []).map(l => l.path), ...(manifest.packs ?? []).map(p => p.path)
    ];
    for (const s of strings(manifest)) if (s.startsWith("systems/vedmak/")) needed.push(s.slice("systems/vedmak/".length));
    for (const p of new Set(needed)) if (p && !fs.existsSync(path.join(ROOT, p))) err(S, `system.json: нет файла ${p}`);
  } catch (e) {
    err(S, `system.json: не JSON — ${e.message}`);
  }

  // Настройки: всё, что читается, зарегистрировано
  const all = files.map(read).join("\n");
  const settingRe = verb => new RegExp(`settings\\.${verb}\\(\\s*(?:SYSTEM_ID|["']vedmak["'])\\s*,\\s*["'](\\w+)`, "g");
  const registered = new Set([...all.matchAll(settingRe("register"))].map(m => m[1]));
  for (const m of all.matchAll(settingRe("(?:get|set)"))) {
    if (!registered.has(m[1])) err(S, `настройка «${m[1]}» читается, но не зарегистрирована`);
  }

  // Кнопки data-action: у каждой есть обработчик в actions: {…} (эвристика — поэтому предупреждение)
  const templates = listFiles(path.join(ROOT, "templates"), ".hbs");
  const handled = new Set(BUILTIN_ACTIONS);
  for (const f of files) {
    const s = read(f);
    for (const m of s.matchAll(/actions\s*:\s*\{/g)) {
      let depth = 1, j = m.index + m[0].length;
      const start = j;
      while (depth && j < s.length) { if (s[j] === "{") depth++; else if (s[j] === "}") depth--; j++; }
      for (const k of s.slice(start, j - 1).matchAll(/(?:^|[,{\n])\s*([A-Za-z_]\w*)\s*(?=[:,(\n}])/g)) handled.add(k[1]);
    }
  }
  for (const f of [...templates, ...files]) {
    for (const m of read(f).matchAll(/data-action=\\?["']([\w-]+)/g)) {
      if (!handled.has(m[1])) warn(S, `${rel(f)}: у кнопки data-action="${m[1]}" не найден обработчик`);
    }
  }
  return `${files.length} модулей`;
}

/* -------------------------------------------------------------------------- */
/*  Шаблоны                                                                   */
/* -------------------------------------------------------------------------- */

function loadHandlebars() {
  const requires = [];
  if (HAS_FOUNDRY) requires.push(createRequire(path.join(FOUNDRY_APP, "package.json")));
  requires.push(createRequire(import.meta.url));
  for (const req of requires) {
    try { return req("handlebars"); } catch { /* следующий источник */ }
  }
  return null;
}

function checkTemplates() {
  const S = SECTIONS.templates;
  const templates = listFiles(path.join(ROOT, "templates"), ".hbs");
  const Handlebars = loadHandlebars();
  if (!Handlebars) {
    warn(S, "handlebars не найден — компиляция пропущена (укажите FOUNDRY_APP или выполните npm i --no-save handlebars)");
  } else {
    for (const f of templates) {
      try { Handlebars.precompile(read(f)); }
      catch (e) { err(S, `${rel(f)}: ${e.message.split("\n")[0]}`); }
    }
  }
  // Пути к шаблонам и регистрация подшаблонов: {{> …}} работает, только если путь есть в TEMPLATE_PATHS
  const preloaded = new Set([...read(path.join(ROOT, "module/helpers.mjs"))
    .matchAll(/["']systems\/vedmak\/(templates\/[^"']+\.hbs)["']/g)].map(m => m[1]));
  for (const f of [...listFiles(ROOT, ".mjs"), ...templates]) {
    const s = read(f);
    for (const m of s.matchAll(/systems\/vedmak\/(templates\/[\w\-/]+\.hbs)/g)) {
      if (!fs.existsSync(path.join(ROOT, m[1]))) err(S, `${rel(f)}: нет файла ${m[1]}`);
    }
    if (!f.endsWith(".hbs")) continue;
    for (const m of s.matchAll(/\{\{>\s*["']systems\/vedmak\/(templates\/[^"']+\.hbs)["']/g)) {
      if (!preloaded.has(m[1])) err(S, `${rel(f)}: подшаблон ${m[1]} не зарегистрирован в TEMPLATE_PATHS (module/helpers.mjs)`);
    }
  }
  return `${templates.length} шаблонов${Handlebars ? "" : " (без компиляции)"}`;
}

/* -------------------------------------------------------------------------- */
/*  Компендиумы                                                               */
/* -------------------------------------------------------------------------- */

/** Тот же id, что даёт tools/build-packs.mjs записи без _id. */
function stableId(key) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let n = BigInt("0x" + crypto.createHash("sha1").update(key).digest("hex"));
  let out = "";
  while (out.length < 16) { out += alphabet[Number(n % 62n)]; n /= 62n; }
  return out;
}

/** Заглушки foundry.data.fields: схемы моделей собираются как дерево полей, без Foundry. */
function stubFoundry() {
  class Field {
    constructor(a, b) {
      this.kind = this.constructor.name;
      if (this.kind === "SchemaField") { this.fields = a ?? {}; this.opts = b ?? {}; }
      else if (["ArrayField", "SetField", "TypedObjectField"].includes(this.kind)) { this.element = a; this.opts = b ?? {}; }
      else this.opts = a ?? {};
    }
  }
  const kinds = {};
  const fields = new Proxy({}, {
    get: (_, name) => typeof name === "string" ? (kinds[name] ??= ({ [name]: class extends Field {} })[name]) : undefined
  });
  globalThis.foundry ??= {
    data: { fields },
    abstract: { TypeDataModel: class { static defineSchema() { return {}; } } },
    utils: { deepClone: x => structuredClone(x), mergeObject: (a, b) => Object.assign(a, b), getProperty: () => undefined }
  };
  globalThis.CONFIG ??= { VEDMAK: {} };
  globalThis.game ??= { i18n: { localize: s => s }, settings: { get: () => undefined, settings: new Map() } };
  globalThis.Hooks ??= { on() {}, once() {} };
  return fields;
}

/** Проверить значение по полю схемы; проблемы копятся в note(вид, путь+суть). */
function checkField(field, value, p, note) {
  if (value === undefined) return;
  if (value === null) {
    if (field.opts?.nullable === false) note(`${p}: null в поле без null`);
    return;
  }
  const choice = v => {
    let ch = field.opts?.choices;
    if (typeof ch === "function") { try { ch = ch(); } catch { return; } }
    const keys = Array.isArray(ch) ? ch : Object.keys(ch ?? {});
    if (keys.length && !keys.map(String).includes(String(v))) note(`${p}: «${v}» вне списка choices`);
  };
  switch (field.kind) {
    case "SchemaField":
      if (typeof value !== "object" || Array.isArray(value)) return note(`${p}: ожидался объект`);
      for (const [k, v] of Object.entries(value)) {
        const sub = field.fields[k];
        const q = p ? `${p}.${k}` : k;
        if (!sub) note(`${q}: поля нет в схеме — Foundry его выбросит`);
        else checkField(sub, v, q, note);
      }
      return;
    case "NumberField": {
      const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      if (typeof n !== "number" || Number.isNaN(n)) return note(`${p}: не число`);
      if (field.opts.integer && !Number.isInteger(n)) note(`${p}: дробное в целом поле`);
      if (field.opts.min !== undefined && n < field.opts.min) note(`${p}: меньше min ${field.opts.min}`);
      if (field.opts.max !== undefined && n > field.opts.max) note(`${p}: больше max ${field.opts.max}`);
      if (field.opts.choices) choice(n);
      return;
    }
    case "StringField": case "HTMLField": case "FilePathField": case "DocumentUUIDField": case "ColorField":
      if (typeof value !== "string") return note(`${p}: не строка`);
      if (field.opts.choices) choice(value);
      return;
    case "BooleanField":
      if (typeof value !== "boolean") note(`${p}: не булево`);
      return;
    case "ArrayField": case "SetField":
      if (!Array.isArray(value)) return note(`${p}: не массив`);
      for (const v of value) checkField(field.element, v, `${p}[]`, note);
      return;
    case "TypedObjectField":
      if (typeof value !== "object") return note(`${p}: не объект`);
      for (const v of Object.values(value)) checkField(field.element, v, `${p}.*`, note);
      return;
    default:
  }
}

/** Все строки внутри документа. */
function* strings(obj) {
  if (typeof obj === "string") yield obj;
  else if (Array.isArray(obj)) for (const v of obj) yield* strings(v);
  else if (obj && typeof obj === "object") for (const v of Object.values(obj)) yield* strings(v);
}

async function checkPacks() {
  const S = SECTIONS.packs;
  const dir = path.join(ROOT, "packs-src");
  const packs = {};
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
    try { packs[file.slice(0, -5)] = JSON.parse(read(path.join(dir, file))); }
    catch (e) { err(S, `packs-src/${file}: не JSON — ${e.message}`); }
  }
  // Правки поверх генераторов: проверяется то, что попадёт в компендиумы
  const { applyOverrides } = await import(pathToFileURL(path.join(ROOT, "tools/pack-overrides.mjs")));
  const overrides = applyOverrides(packs);
  for (const s of overrides.skipped) warn(S, `tools/pack-overrides.mjs: ${s}`);

  // Схемы моделей
  const fields = stubFoundry();
  const { ACTOR_MODELS, ITEM_MODELS } = await import(pathToFileURL(path.join(ROOT, "module/data/_module.mjs")));
  const schemas = new Map();
  const schemaFor = (models, type) => {
    if (!schemas.has(type)) schemas.set(type, new fields.SchemaField(models[type].defineSchema()));
    return schemas.get(type);
  };
  const schemaIssues = new Map(); // суть → { count, examples }
  let docs = 0;
  // Внутри компендиума Foundry показывает не больше трёх уровней папок (maxFolderDepth = FOLDER_MAX_DEPTH − 1):
  // запись в папке глубже просто не видна
  const deep = new Map();
  for (const [pack, list] of Object.entries(packs)) {
    for (const d of list) if (Array.isArray(d.folder) && d.folder.length > 3) {
      const key = `${pack}: ${d.folder.slice(0, 2).join(" / ")}`;
      deep.set(key, (deep.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of deep) err(S, `${key}: записи глубже трёх уровней папок (${n}) — Foundry их не покажет`);
  for (const [pack, list] of Object.entries(packs)) {
    for (const d of list) {
      for (const [doc, where] of [[d, `${pack}: ${d.name}`], ...(d.items ?? []).map(i => [i, `${pack}: ${d.name} → ${i.name}`])]) {
        if (!doc.type || !doc.system) continue;
        const models = ITEM_MODELS[doc.type] ? ITEM_MODELS : ACTOR_MODELS[doc.type] ? ACTOR_MODELS : null;
        if (!models) { err(S, `${where}: нет модели для типа «${doc.type}»`); continue; }
        docs++;
        checkField(schemaFor(models, doc.type), doc.system, "", issue => {
          const key = `${doc.type}.${issue}`;
          const rec = schemaIssues.get(key) ?? { count: 0, examples: [] };
          rec.count++;
          if (rec.examples.length < 2) rec.examples.push(where);
          schemaIssues.set(key, rec);
        });
      }
    }
  }
  for (const [key, { count, examples }] of schemaIssues) {
    err(S, `схема ${key} — ${count}× (напр. ${examples.join("; ")})`);
  }

  // Ссылки Compendium.vedmak.<пак>.<Тип>.<id>[.<Вложенный>.<id>]
  const ids = {};
  const nested = new Map();
  for (const [pack, list] of Object.entries(packs)) {
    ids[pack] = new Set();
    for (const d of list) {
      const id = d._id ?? stableId(`${pack}:${d.type}:${d.name}`);
      ids[pack].add(id);
      for (const key of ["items", "pages", "results"]) {
        for (const [j, child] of (d[key] ?? []).entries()) {
          nested.set(`${pack}.${id}.${child._id ?? stableId(`${pack}:${id}:${key}:${j}`)}`, true);
        }
      }
    }
  }
  const uuidRe = /Compendium\.vedmak\.(\w+)\.(?:Item|Actor|RollTable|JournalEntry)\.([A-Za-z0-9]{16})(?:\.(?:Item|JournalEntryPage|TableResult)\.([A-Za-z0-9]{16}))?/g;
  const imgRe = /systems\/vedmak\/[^\s"'<>)\]]+?\.(?:webp|png|jpe?g|svg|gif)/gi;
  const coreRe = /(?<![\w/.-])icons\/[\w\-/]+\.(?:webp|png|jpe?g|svg|gif)/gi;
  let links = 0;
  const coreUnchecked = new Set();
  for (const [pack, list] of Object.entries(packs)) {
    for (const d of list) {
      const where = `${pack}: ${d.name}`;
      for (const s of strings(d)) {
        for (const m of s.matchAll(uuidRe)) {
          links++;
          const ok = ids[m[1]]?.has(m[2]) && (!m[3] || nested.has(`${m[1]}.${m[2]}.${m[3]}`));
          if (!ok) err(S, `${where}: битая ссылка ${m[0]}`);
        }
        for (const m of s.matchAll(imgRe)) {
          if (!fs.existsSync(path.join(ROOT, m[0].slice("systems/vedmak/".length)))) err(S, `${where}: нет картинки ${m[0]}`);
        }
        for (const m of s.matchAll(coreRe)) {
          if (!HAS_FOUNDRY) coreUnchecked.add(m[0]);
          else if (!fs.existsSync(path.join(FOUNDRY_APP, "public", m[0]))) err(S, `${where}: нет значка Foundry ${m[0]}`);
        }
      }
    }
  }
  if (coreUnchecked.size) {
    warn(S, `${coreUnchecked.size} значков Foundry (icons/…) не проверено: папка Foundry не найдена (FOUNDRY_APP=${FOUNDRY_APP})`);
  }

  // Повторы значков: одна картинка на разные предметы (чертежи и формулы — намеренно по роду бумаги)
  const byImg = new Map();
  for (const [pack, list] of Object.entries(packs)) {
    if (["bestiary", "tables", "generators", "chargen", "rules", "recipes"].includes(pack)) continue;
    for (const d of list) {
      if (!d.img) continue;
      if (!byImg.has(d.img)) byImg.set(d.img, new Set());
      byImg.get(d.img).add(d.name);
    }
  }
  const dups = [...byImg].filter(([, names]) => names.size > 1).sort((a, b) => b[1].size - a[1].size);
  for (const [img, names] of dups) warn(S, `повтор значка ${names.size}× ${img}: ${[...names].slice(0, 6).join(", ")}${names.size > 6 ? "…" : ""}`);

  return `${docs} документов, ${links} ссылок, повторов значков — ${dups.length}`;
}

/* -------------------------------------------------------------------------- */

const summary = [];
if (run("code")) summary.push(`${SECTIONS.code}: ${checkCode()}`);
if (run("templates")) summary.push(`${SECTIONS.templates}: ${checkTemplates()}`);
if (run("packs")) summary.push(`${SECTIONS.packs}: ${await checkPacks()}`);

const print = (title, map, limit) => {
  if (!map.size) return;
  console.log(`\n${title} (${map.size}):`);
  const lines = [...map].map(([msg, n]) => (n > 1 ? `${msg} — ${n}×` : msg));
  for (const line of lines.slice(0, limit)) console.log(`  ${line}`);
  if (lines.length > limit) console.log(`  … и ещё ${lines.length - limit}`);
};
console.log(`Проверено — ${summary.join("; ")}.`);
print("Ошибки", errors, 100);
print("Предупреждения", warnings, 25);
console.log(errors.size ? `\nИтог: ошибок ${errors.size}.` : "\nИтог: ошибок нет.");
process.exitCode = errors.size ? 1 : 0;
