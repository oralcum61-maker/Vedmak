// Собрать компендиумы из packs-src/*.json в LevelDB (packs/<name>).
// Запуск: node tools/build-packs.mjs   (Foundry с этой системой должен быть остановлен — LevelDB блокируется)
//
// Источник — массив документов: Item, Actor (с вложенными `items`), RollTable (`results`)
// или JournalEntry (`pages`). Папки строятся по функции `folders` конфигурации пакета.
// Перед сборкой к источникам применяются правки поверх генераторов — tools/pack-overrides.mjs.

import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyOverrides } from "./pack-overrides.mjs";

const FOUNDRY_APP = process.env.FOUNDRY_APP ?? "D:/FoundryVTT-WindowsPortable-14.365/App/resources/app";
const require = createRequire(path.join(FOUNDRY_APP, "package.json"));
const { ClassicLevel } = require("classic-level");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SYSTEM = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));
const CORE_VERSION = "14.365";


const PACKS = [
  {
    name: "magic",
    source: "packs-src/magic.json",
    // Папки заданы в источнике, внутри папки — по алфавиту
    folders: doc => (doc.folder ?? []).map(name => ({ name })),
    sort: (a, b) => a.name.localeCompare(b.name, "ru")
  },
  ...["weapons", "armor", "gear", "alchemy", "components", "recipes", "enhancements"].map(name => ({
    name,
    source: `packs-src/${name}.json`,
    // Папки заданы в источнике (doc.folder), порядок — по первому появлению
    folders: doc => (doc.folder ?? []).map(name => ({ name })),
    sort: () => 0
  })),
  {
    name: "races",
    source: "packs-src/races.json",
    folders: () => [],
    sort: (a, b) => a.name.localeCompare(b.name, "ru")
  },
  {
    name: "professions",
    source: "packs-src/professions.json",
    folders: () => [],
    sort: (a, b) => a.name.localeCompare(b.name, "ru")
  },
  // Из компендиума BS & Tobi (_tools/bs_*.py)
  {
    name: "bestiary",
    source: "packs-src/bestiary.json",
    documentName: "Actor",
    folders: doc => (doc.folder ?? []).map(name => ({ name })),
    sort: (a, b) => a.name.localeCompare(b.name, "ru")
  },
  ...["tables", "generators", "chargen"].map(name => ({
    name,
    source: `packs-src/${name}.json`,
    documentName: "RollTable",
    folders: doc => (doc.folder ?? []).map(name => ({ name })),
    sort: () => 0
  })),
  {
    name: "rules",
    source: "packs-src/rules.json",
    documentName: "JournalEntry",
    folders: doc => (doc.folder ?? []).map(name => ({ name })),
    sort: () => 0
  }
];

/** Как документ и его вложенные лежат в LevelDB. */
const LAYOUT = {
  Item:         { key: "items" },
  Actor:        { key: "actors", embedded: { field: "items", key: "actors.items" } },
  RollTable:    { key: "tables", embedded: { field: "results", key: "tables.results" } },
  JournalEntry: { key: "journal", embedded: { field: "pages", key: "journal.pages" } }
};

// Цвет папки по названию: верхние — по роду снаряжения, вложенные — по происхождению.
const FOLDER_COLORS = {
  // оружие и броня
  "Мечи": "#6a7078", "Лёгкие клинки": "#6a7078", "Топоры": "#6a7078", "Дробящее": "#6a7078",
  "Древковое": "#6a7078", "Посохи": "#6a7078", "Метательное": "#6a7078", "Луки": "#6a7078",
  "Арбалеты": "#6a7078", "Головная": "#534a3b", "Корпусная": "#534a3b", "Ножная": "#534a3b",
  "Комплекты": "#534a3b", "Щиты": "#534a3b",
  // снаряжение
  "Стандартное снаряжение": "#6a5d49", "Ёмкости": "#6a5d49", "Еда и питьё": "#6a5d49",
  "Одежда": "#6a5d49", "Инструменты": "#6a5d49", "Скакуны и транспорт": "#6a5d49",
  "Боеприпасы": "#6a5d49", "Ценности и диковины": "#88734c", "Экспериментальные технологии": "#5c4a72",
  "Услуги": "#5c4a37", "Проживание": "#5c4a37", "Естественное": "#6a7078",
  // бестиарий: классы чудовищ
  "Гуманоиды": "#72757c", "Звери": "#596b50", "Проклятые": "#4a3a52", "Трупоеды": "#445d3b",
  "Гибриды": "#675539", "Духи": "#3f5873", "Инсектоиды": "#675e39", "Духи стихий": "#5a7079",
  "Реликты": "#3b5d4a", "Огры": "#79523c", "Дракониды": "#672e29", "Вампиры": "#5a2f2b",
  "Исключительные": "#9d8243", "Домашние правила": "#575757",
  // алхимия
  "Алхимические составы": "#445d3b", "Эликсиры": "#445d3b", "Масла для мечей": "#445d3b",
  "Ведьмачьи отвары": "#445d3b", "Мутагены": "#445d3b", "Бомбы": "#674029", "Ловушки": "#674029",
  "Красные": "#79403c", "Зелёные": "#45683d", "Синие": "#3f5873",
  // компоненты и ремесло
  "Алхимические ингредиенты": "#675e39", "Ремесленные компоненты": "#675e39",
  "Очищенные субстанции": "#88734c", "Чертежи": "#84704d", "Формулы": "#84704d",
  // зачарования и магия
  "Усиления брони": "#5c4a72", "Руны": "#5c4a72", "Глифы": "#5c4a72", "Рунные слова": "#5c4a72",
  "Глифовы слова": "#5c4a72", "Модификации арбалета": "#5c4a72",
  // магия по видам
  "Заклинания мага": "#5c4a72", "Инвокации": "#88734c", "Ведьмачьи знаки": "#835834",
  "Магические дары": "#3b5d4a", "Ритуалы": "#3f5873", "Порчи": "#5a2f2b",
  "Тёмные искусства": "#3a2c3f", "Некромантия": "#4a3a52", "Гоэтия": "#5a2f2b",
  "Друидов": "#45683d", "Проповедников": "#88734c", "Верховных жрецов": "#9d8243",
  "Базовые": "#835834", "Продвинутые": "#6b4526", "Малые": "#45683d", "Большие": "#3b5d4a",
  "Низкой опасности": "#596b50", "Средней опасности": "#79523c", "Высокой опасности": "#672e29",
  "Смешанные элементы": "#5c4a72", "Земля": "#675539", "Воздух": "#5a7079",
  "Огонь": "#8a4a2e", "Вода": "#3f5873",
  // происхождение
  "Реликвии": "#672e29", "Ведьмачьих школ": "#88734c", "Ведьмачье": "#88734c",
  "Старший Народ": "#3b5d4a", "Туссент": "#793c4f", "Фургончик Родольфа": "#5c4a37",
  "Магический рынок": "#5c4a72", "Журнал ведьмака": "#455769", "Людей": "#72757c",
  "Ведьмачье снаряжение": "#88734c", "Ведьмачьи школы": "#88734c",
  "Школа Медведя": "#675539", "Школа Кота": "#604e60", "Школа Грифона": "#3f5873",
  "Школа Мантикоры": "#793c4f", "Школа Змеи": "#45683d", "Школа Волка": "#72757c",
  // уровни мастерства
  "Новичок": "#596b50", "Подмастерье": "#675e39", "Мастер": "#79523c", "Великий мастер": "#672e29",
  // субстанции — цвета из книги
  "Купорос": "#6c4f62", "Ребис": "#a04a39", "Эфир": "#669499", "Квебрит": "#8a8133",
  "Гидраген": "#5a5d79", "Киноварь": "#5e7152", "Солнце": "#9d8243", "Аер": "#858a42",
  "Фульгор": "#673535",
  // прочие вложенные
  "Ведьмачьи": "#88734c", "Обычные (для всех)": "#6a5d49", "Магов": "#5c4a72",
  "Корник": "#6a5d49", "Из Офира": "#793c4f", "Животные и повозки": "#6a5d49",
  "Сёдла": "#6a5d49", "Шоры": "#6a5d49", "Перемётные сумы": "#6a5d49", "Конские доспехи": "#6a5d49",
  "Ремесленные материалы": "#675e39", "Шкуры и части животных": "#675e39",
  "Пропитки и составы": "#675e39", "Слитки и минералы": "#675e39", "Прочее": "#575757",
  // рода чертежей и формул
  "Компоненты": "#675e39", "Оружие": "#6a7078", "Броня": "#534a3b",
  "Оружие Старшего Народа": "#3b5d4a", "Броня Старшего Народа": "#3b5d4a",
  "Усиления и зачарования": "#5c4a72", "Экспериментальные боеприпасы": "#5c4a72",
  "Масла": "#445d3b", "Отвары": "#445d3b"
};

/** 16-символьный id из строки — стабильный между сборками. */
function stableId(key) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let n = BigInt("0x" + crypto.createHash("sha1").update(key).digest("hex"));
  let out = "";
  while (out.length < 16) { out += alphabet[Number(n % 62n)]; n /= 62n; }
  return out;
}

function stats() {
  const now = Date.now();
  return {
    coreVersion: CORE_VERSION, systemId: SYSTEM.id, systemVersion: SYSTEM.version,
    createdTime: now, modifiedTime: now, lastModifiedBy: null,
    compendiumSource: null, duplicateSource: null, exportSource: null
  };
}

/** Все источники сразу: правки меняют имена во всех пакетах (чертежи, бестиарий, генераторы). */
const SOURCES = {};
for (const cfg of PACKS) {
  const file = path.join(ROOT, cfg.source);
  if (fs.existsSync(file)) SOURCES[cfg.name] = JSON.parse(fs.readFileSync(file, "utf8"));
}
const overrides = applyOverrides(SOURCES);
console.log(`Правки поверх генераторов: ${overrides.applied}${overrides.skipped.length ? `; пропущено: ${overrides.skipped.join("; ")}` : ""}`);

async function buildPack(cfg) {
  const docs = SOURCES[cfg.name];
  if (!docs) return console.log(`${cfg.name}: нет ${cfg.source} — пропущен`);
  const documentName = cfg.documentName ?? "Item";
  const layout = LAYOUT[documentName];
  const dir = path.join(ROOT, "packs", cfg.name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const db = new ClassicLevel(dir, { valueEncoding: "json" });
  await db.open();
  const batch = db.batch();

  // Папки
  const folders = new Map();
  const folderFor = chain => {
    let parent = null;
    let key = cfg.name;
    for (const f of chain) {
      key += "/" + f.name;
      if (!folders.has(key)) {
        const folder = {
          _id: stableId(`folder:${key}`), name: f.name, type: documentName, description: "",
          folder: parent, sorting: "m", sort: (f.sort ?? folders.size) * 100000, color: FOLDER_COLORS[f.name] ?? null,
          flags: {}, _stats: stats()
        };
        folders.set(key, folder);
        batch.put(`!folders!${folder._id}`, folder);
      }
      parent = folders.get(key)._id;
    }
    return parent;
  };

  let embeddedCount = 0;
  const sorted = docs.slice().sort(cfg.sort);
  sorted.forEach((doc, i) => {
    const { folder, _id, ...rest } = doc;
    const id = _id ?? stableId(`${cfg.name}:${doc.type}:${doc.name}`);
    const out = {
      ...rest, _id: id, folder: folderFor(cfg.folders(doc)), sort: i * 100,
      ownership: { default: 0 }, flags: doc.flags ?? {}, _stats: stats()
    };
    if (documentName === "Item" || documentName === "Actor") out.effects = [];
    // Вложенные документы лежат отдельными ключами, в родителе — только их id
    const emb = layout.embedded;
    if (emb) {
      const children = doc[emb.field] ?? [];
      out[emb.field] = children.map((child, j) => {
        const childId = child._id ?? stableId(`${cfg.name}:${id}:${emb.field}:${j}`);
        const entry = { ...child, _id: childId, sort: child.sort ?? j * 100, flags: child.flags ?? {}, _stats: stats() };
        if (emb.field === "items") Object.assign(entry, { effects: [], folder: null, ownership: { default: 0 } });
        batch.put(`!${emb.key}!${id}.${childId}`, entry);
        embeddedCount++;
        return childId;
      });
    }
    batch.put(`!${layout.key}!${id}`, out);
  });

  await batch.write();
  await db.close();
  const extra = embeddedCount ? `, ${embeddedCount} вложенных` : "";
  console.log(`${cfg.name}: ${docs.length} документов${extra}, ${folders.size} папок → ${path.relative(ROOT, dir)}`);
}

const only = process.argv.slice(2);
for (const cfg of PACKS) if (!only.length || only.includes(cfg.name)) await buildPack(cfg);
