// Правки компендиумов системы (PLAN 4.255). Обновление системы — через Foundry или выгрузкой — заменяет её компендиумы
// целиком, и правки ведущего в них пропадали. Теперь каждая правка, новая запись или удаление в компендиуме системы
// сохраняется копией в компендиум мира «Правки компендиумов: …» (мир обновление не трогает). При загрузке ведущий
// сверяет: запись в компендиуме системы пришла заново (её время правки не то, что запомнено при сохранении) — правка
// возвращается. Правки, сделанные до этой версии, можно забрать из копии компендиума («Дублировать компендиум» в мир
// до обновления) — окно «Правки компендиумов» в настройках системы.

import { refuse, renderTemplate } from "../util.mjs";

const SYS = "vedmak";
/** Компендиум мира для копий — по виду записей. */
const STORES = {
  Item: { name: "vedmak-edits-items", label: "Правки компендиумов: предметы" },
  Actor: { name: "vedmak-edits-actors", label: "Правки компендиумов: актёры" },
  JournalEntry: { name: "vedmak-edits-journal", label: "Правки компендиумов: журналы" },
  RollTable: { name: "vedmak-edits-tables", label: "Правки компендиумов: таблицы" }
};
/** Поля, правка только которых — не правка содержания (перетаскивание по папкам и порядку). */
const MOVE_ONLY = new Set(["_id", "sort", "folder", "_stats"]);

const docClass = type => CONFIG[type].documentClass;
const Compendiums = () => foundry.documents.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
const isSystemPack = pack => pack?.metadata.packageType === "system" && pack.metadata.packageName === SYS;
const topOf = doc => { let d = doc; while (d?.parent) d = d.parent; return d; };
const flagOf = doc => doc.getFlag?.(SYS, "packEdit") ?? doc.flags?.[SYS]?.packEdit ?? null;

/** Компендиум мира для копий вида type; нет — создать (только ведущий). */
async function storeFor(type, create = true) {
  const s = STORES[type];
  if (!s) return null;
  const found = game.packs.find(p => p.metadata.packageType === "world" && p.metadata.name === s.name);
  if (found || !create || !game.user.isGM) return found ?? null;
  return Compendiums().createCompendium({ type, label: s.label, name: s.name, packageType: "world" });
}

/** Данные записи для копии: как есть, с отметкой — из какого компендиума и с каким временем правки там. */
function snapshot(doc, extra = {}) {
  const data = doc.toObject();
  foundry.utils.setProperty(data, `flags.${SYS}.packEdit`, { pack: doc.pack, sysModified: doc._stats?.modifiedTime ?? null,
    at: Date.now(), by: game.user.name, ...extra });
  return data;
}

/** Записать копию (заменяя прежнюю). */
async function writeCopy(type, data) {
  const store = await storeFor(type);
  if (!store) return null;
  const old = await store.getDocument(data._id);
  if (old) await old.delete({ vedmakPackEdit: true });
  return docClass(type).create(data, { pack: store.collection, keepId: true, vedmakPackEdit: true });
}

/* ------------------------------ Слежение за правками ------------------------------ */

const pending = new Map();

/** Запись компендиума системы изменилась (или её вложенная) — сохранить копию верхней записи, не чаще раза в полсекунды. */
function touched(doc, { deleted = false, options = {}, userId, change = null } = {}) {
  if (options.vedmakPackEdit || userId !== game.user.id) return;
  const top = topOf(doc);
  if (!top?.pack || !isSystemPack(game.packs.get(top.pack)) || !STORES[top.documentName]) return;
  if (change && doc === top && Object.keys(change).every(k => MOVE_ONLY.has(k))) return;
  const key = top.uuid;
  clearTimeout(pending.get(key)?.timer);
  const type = top.documentName;
  const data = deleted && doc === top ? { _id: top.id, name: `${top.name} (удалена)`, type: top.type ?? undefined, img: top.img ?? undefined,
    flags: { [SYS]: { packEdit: { pack: top.pack, deleted: true, at: Date.now(), by: game.user.name } } } } : null;
  pending.set(key, { timer: setTimeout(() => {
    pending.delete(key);
    writeCopy(type, data ?? snapshot(top)).catch(err => console.error("vedmak | копия правки компендиума", err));
  }, 500) });
}

/* ------------------------------ Возврат правок ------------------------------ */

/** Все копии правок: [{ copy, flag, type }]. */
async function copies() {
  const out = [];
  for (const type of Object.keys(STORES)) {
    const store = await storeFor(type, false);
    if (!store) continue;
    for (const copy of await store.getDocuments()) {
      const flag = flagOf(copy);
      if (flag?.pack) out.push({ copy, flag, type });
    }
  }
  return out;
}

/** Данные копии для компендиума системы — без отметки копии. */
function restoreData(copy) {
  const data = copy.toObject();
  delete data.flags?.[SYS]?.packEdit;
  return data;
}

/**
 * Вернуть правки, которых нет в компендиумах системы (после обновления там записи из сборки). Компендиум на время
 * открывается и снова запирается. @returns {Promise<string[]>} имена возвращённых
 */
export async function restoreEdits({ force = null } = {}) {
  if (!game.user.isGM) return [];
  const list = await copies();
  const restored = [];
  const relock = new Map();
  for (const { copy, flag, type } of list) {
    if (force && !force.has(copy.uuid)) continue;
    const pack = game.packs.get(flag.pack);
    if (!pack) continue;
    const index = await pack.getIndex({ fields: ["_stats.modifiedTime", "folder"] });
    const cur = index.get(copy.id);
    const fresh = !cur || cur._stats?.modifiedTime !== flag.sysModified;
    if (!force && !(flag.deleted ? !!cur : fresh)) continue;
    if (pack.locked) { relock.set(pack.collection, pack); await pack.configure({ locked: false }); }
    try {
      if (cur) await (await pack.getDocument(copy.id))?.delete({ vedmakPackEdit: true });
      if (!flag.deleted) {
        const data = restoreData(copy);
        // Папка — та, где запись сейчас; новой записи — своя, если такая папка в компендиуме есть
        data.folder = cur ? cur.folder ?? null : pack.folders.has(data.folder) ? data.folder : null;
        const made = await docClass(type).create(data, { pack: pack.collection, keepId: true, vedmakPackEdit: true });
        await copy.update({ [`flags.${SYS}.packEdit.sysModified`]: made?._stats?.modifiedTime ?? null }, { vedmakPackEdit: true });
      }
      restored.push(`${copy.name} — ${pack.title}`);
    } catch (err) {
      console.error(`vedmak | возврат правки «${copy.name}»`, err);
    }
  }
  for (const pack of relock.values()) await pack.configure({ locked: true });
  return restored;
}

/* ------------------------------ Правки из копии компендиума ------------------------------ */

/** Сравниваемое содержание записи: без служебного (время, порядок, папка, права, отметки копий); ключи — по алфавиту. */
function content(data) {
  const strip = o => {
    if (Array.isArray(o)) return o.map(strip);
    if (!o || typeof o !== "object") return o;
    const out = {};
    for (const k of Object.keys(o).sort()) {
      if (["_stats", "sort", "folder", "ownership"].includes(k)) continue;
      out[k] = strip(o[k]);
    }
    return out;
  };
  const d = strip(data);
  delete d.flags?.[SYS]?.packEdit;
  delete d.flags?.core;
  return JSON.stringify(d);
}

/** Правлена ли запись в Foundry (сама или вложенная): у собранных сборщиком «кем изменено» пусто. */
function editedInFoundry(data) {
  if (data?._stats?.lastModifiedBy) return true;
  for (const k of ["items", "effects", "pages", "results"]) if ((data?.[k] ?? []).some(editedInFoundry)) return true;
  return false;
}

/**
 * Записи копии компендиума (мира), отличные от компендиума системы с тем же видом: та же запись (по id) с другим
 * содержанием или новая. edited — запись правили в Foundry (не только обновление её поменяло).
 * @returns {Promise<{source, items: [{id, name, isNew, edited}]}>}
 */
export async function diffCopy(worldPack) {
  const type = worldPack.documentName;
  const systemPacks = game.packs.filter(p => isSystemPack(p) && p.documentName === type);
  const indexes = await Promise.all(systemPacks.map(async p => ({ pack: p, index: await p.getIndex() })));
  const copyDocs = await worldPack.getDocuments();
  // Источник — компендиум системы, где нашлось больше всего тех же id
  const hits = indexes.map(x => ({ ...x, n: copyDocs.filter(d => x.index.has(d.id)).length })).sort((a, b) => b.n - a.n);
  const source = hits[0]?.n ? hits[0] : null;
  if (!source) return { source: null, items: [] };
  const items = [];
  const current = new Map((await source.pack.getDocuments()).map(d => [d.id, d]));
  for (const d of copyDocs) {
    const cur = current.get(d.id);
    const data = d.toObject();
    if (!cur) { items.push({ id: d.id, name: d.name, isNew: true, edited: true }); continue; }
    if (content(data) !== content(cur.toObject())) items.push({ id: d.id, name: d.name, isNew: false, edited: editedInFoundry(data) });
  }
  return { source: source.pack, items, docs: new Map(copyDocs.map(d => [d.id, d])) };
}

/** Перенести выбранные записи копии как правки компендиума системы и сразу вернуть их туда. */
export async function adoptFromCopy(worldPack, ids) {
  const { source, docs } = await diffCopy(worldPack);
  if (!source) return [];
  const type = worldPack.documentName;
  const made = [];
  for (const id of ids) {
    const d = docs.get(id);
    if (!d) continue;
    const data = d.toObject();
    foundry.utils.setProperty(data, `flags.${SYS}.packEdit`, { pack: source.collection, sysModified: null, at: Date.now(),
      by: game.user.name, from: worldPack.title });
    made.push(await writeCopy(type, data));
  }
  return restoreEdits({ force: new Set(made.filter(Boolean).map(c => c.uuid)) });
}

/** Забыть сохранённую правку: больше не возвращать (сама запись в компендиуме системы не меняется). */
export async function forgetEdit(uuid) {
  const copy = await fromUuid(uuid);
  if (!copy || !flagOf(copy)) return false;
  await copy.delete({ vedmakPackEdit: true });
  return true;
}

/* ------------------------------ Окно ------------------------------ */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PackEditsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "vedmak-pack-edits",
    classes: ["vedmak", "vedmak-dialog", "pack-edits"],
    window: { title: "Правки компендиумов", icon: "fa-solid fa-box-archive", resizable: true },
    position: { width: 620, height: 640 },
    actions: { forget: PackEditsApp.#onForget, compare: PackEditsApp.#onCompare, adopt: PackEditsApp.#onAdopt, restore: PackEditsApp.#onRestore }
  };

  static PARTS = { body: { template: "systems/vedmak/templates/apps/pack-edits.hbs", scrollable: [".pe-scroll"] } };

  /** Сравнение с копией: { pack, source, items } */
  compared = null;

  async _prepareContext() {
    const list = await copies();
    const edits = list.map(({ copy, flag }) => ({ uuid: copy.uuid, name: copy.name, img: copy.img,
      pack: game.packs.get(flag.pack)?.title ?? flag.pack, deleted: !!flag.deleted, from: flag.from ?? "",
      when: flag.at ? new Date(flag.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "", by: flag.by ?? "" }))
      .sort((a, b) => a.pack.localeCompare(b.pack, "ru") || a.name.localeCompare(b.name, "ru"));
    const worldPacks = game.packs.filter(p => p.metadata.packageType === "world" && STORES[p.documentName]
      && !Object.values(STORES).some(s => s.name === p.metadata.name)).map(p => ({ id: p.collection, label: `${p.title} (${p.documentName})`,
      selected: p.collection === this.compared?.pack }));
    return { edits, worldPacks, compared: this.compared };
  }

  static async #onForget(event, target) {
    const uuid = target.closest("[data-uuid]").dataset.uuid;
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Забыть правку" },
      content: "<p>Правку больше не возвращать после обновлений? Сама запись в компендиуме сейчас не изменится.</p>", rejectClose: false });
    if (ok && await forgetEdit(uuid)) this.render();
  }

  static async #onCompare() {
    const id = this.element.querySelector("select[name=copy]")?.value;
    const pack = game.packs.get(id);
    if (!pack) return refuse("Выберите копию компендиума.");
    const { source, items } = await diffCopy(pack);
    this.compared = { pack: id, source: source?.title ?? "", items };
    if (!source) ui.notifications.warn("В этой копии нет записей компендиумов системы.");
    this.render();
  }

  static async #onAdopt() {
    const pack = game.packs.get(this.compared?.pack);
    const ids = [...this.element.querySelectorAll("input[name=adopt]:checked")].map(i => i.value);
    if (!pack || !ids.length) return refuse("Отметьте записи для переноса.");
    const done = await adoptFromCopy(pack, ids);
    ui.notifications.info(`Правки перенесены в компендиумы системы: ${done.length}.`);
    this.compared = null;
    this.render();
  }

  static async #onRestore() {
    const done = await restoreEdits();
    ui.notifications.info(done.length ? `Возвращено правок: ${done.length}.` : "Все правки уже на месте.");
    this.render();
  }
}

/* ------------------------------ Подключение ------------------------------ */

export function registerPackEdits() {
  game.settings.registerMenu(SYS, "packEditsMenu", {
    name: "Правки компендиумов",
    label: "Правки компендиумов",
    hint: "Правки, новые и удалённые записи в компендиумах системы сохраняются в мире и возвращаются после обновления системы. Здесь — список, «забыть» и перенос правок из копии компендиума.",
    icon: "fa-solid fa-box-archive", type: PackEditsApp, restricted: true
  });
  for (const type of ["Item", "Actor", "JournalEntry", "RollTable", "ActiveEffect", "JournalEntryPage", "TableResult"]) {
    Hooks.on(`create${type}`, (doc, options, userId) => touched(doc, { options, userId }));
    Hooks.on(`update${type}`, (doc, change, options, userId) => touched(doc, { options, userId, change }));
    Hooks.on(`delete${type}`, (doc, options, userId) => touched(doc, { options, userId, deleted: true }));
  }
  // После загрузки — вернуть правки, которые обновление заменило (ведущий; один раз)
  Hooks.once("ready", () => {
    if (!game.user.isGM || game.users.activeGM !== game.user) return;
    setTimeout(async () => {
      try {
        const done = await restoreEdits();
        if (!done.length) return;
        ui.notifications.info(`Правки компендиумов возвращены после обновления системы: ${done.length}.`);
        const content = await renderTemplate("systems/vedmak/templates/chat/pack-edits.hbs", { done });
        await ChatMessage.create({ content, whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id), speaker: { alias: "Правки компендиумов" } });
      } catch (err) { console.error("vedmak | возврат правок компендиумов", err); }
    }, 2000);
  });
}
