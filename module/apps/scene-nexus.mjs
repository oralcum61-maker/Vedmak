// «Нексус» — замена навигации сцен Foundry (PLAN 4.181). Слева сверху бирка «где вы и где игроки»; по ней раскрывается
// доска мест: сцены по папкам с миниатюрами, вложенные папки — бусинами. Ведущий переводит отряд (жетоны игроков с
// активной сцены — на выбранную, сцена становится активной), делает сцену активной, смотрит сам и открывает сцену
// игрокам. Игрок видит только открытые ему сцены и переходит сам — посмотреть или вместе со своим жетоном (жетон
// переносит клиент ведущего). Новые, переименованные и удалённые сцены и папки доска подхватывает сама: она собирается
// из game.scenes при каждой перерисовке, а перерисовку зовут хуки документов.

import { SYSTEM_ID, compareRu, setting } from "../util.mjs";
import { asGM, registerGMHandler } from "../combat/common.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const LIMITED = CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED;
const NONE = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
/** Область прибытия на сцене: жетоны встают в неё (иначе — в середину сцены). */
const ENTRY_RE = /^(вход|прибытие|нексус)/i;
/** Разделители «Папка - место» в названии сцены. */
const SEPARATORS = ["-", "—", "–", ":"];

/** Открыта ли сцена игрокам: «по умолчанию» или кому-то из игроков — не ниже «ограниченного». */
export function openToPlayers(scene) {
  if ((scene.ownership.default ?? NONE) >= LIMITED) return true;
  return game.users.some(u => !u.isGM && (scene.ownership[u.id] ?? NONE) >= LIMITED);
}

/** Жетоны игроков на сцене (видимые; у игрока — только свои). */
function partyTokens(scene, user = null) {
  if (!scene) return [];
  return scene.tokens.filter(t => t.actor && !t.hidden
    && (user ? !user.isGM && t.testUserPermission(user, "OWNER") : t.actor.hasPlayerOwner));
}

/** Область прибытия: своя «Вход…» на сцене или временная — квадрат 3×3 клетки в середине сцены. */
function entryRegion(scene) {
  const own = scene.regions.find(r => ENTRY_RE.test(r.name));
  if (own) return own;
  const d = scene.dimensions;
  const size = d.size * 3;
  const x = d.sceneRect.x + (d.sceneRect.width - size) / 2;
  const y = d.sceneRect.y + (d.sceneRect.height - size) / 2;
  const level = scene.initialLevel?.id;
  return new CONFIG.Region.documentClass({ name: "Нексус", levels: level ? [level] : [],
    shapes: [{ type: "rectangle", x, y, width: size, height: size }] }, { parent: scene });
}

/**
 * Перенести жетоны на сцену (только клиент ведущего): телепортом Foundry — со всеми данными жетона.
 * @returns {Promise<number>} сколько перенесено
 */
async function carryTokens(scene, tokens) {
  const moving = tokens.filter(t => t.parent !== scene);
  if (!moving.length) return 0;
  await entryRegion(scene).teleportTokens(moving, { placement: "random", snap: true, pan: false });
  return moving.length;
}

/** Обработчик ведущего: игрок переходит со своими жетонами на открытую ему сцену. */
async function travelForUser({ sceneId, tokenUuids }, userId) {
  const user = game.users.get(userId);
  const scene = game.scenes.get(sceneId);
  if (!user || !scene) return;
  if (!user.isGM && scene.getUserLevel(user) < LIMITED) {
    return console.warn(`vedmak | нексус: у ${user.name} нет доступа к сцене ${scene.name}`);
  }
  const tokens = (tokenUuids ?? []).map(u => fromUuidSync(u))
    .filter(t => t?.documentName === "Token" && t.testUserPermission(user, "OWNER"));
  await carryTokens(scene, tokens);
  if (!user.isSelf) scene.pullUsers([user]);
}

export class SceneNexus extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "vedmak-nexus",
    tag: "nav",
    classes: ["vedmak", "vd-nexus"],
    window: { frame: false, positioned: false },
    actions: {
      toggle: SceneNexus.#onToggle,
      pick: SceneNexus.#onPick,
      closePop: SceneNexus.#onClosePop,
      fold: SceneNexus.#onFold,
      view: SceneNexus.#onView,
      activate: SceneNexus.#onActivate,
      travel: SceneNexus.#onTravel,
      access: SceneNexus.#onAccess,
      configure: SceneNexus.#onConfigure,
      viewLevel: SceneNexus.#onViewLevel,
      closeLevelMenu: SceneNexus.#onCloseLevelMenu,
      levelUp: SceneNexus.#onLevelUp,
      levelDown: SceneNexus.#onLevelDown,
      levelConfig: SceneNexus.#onLevelConfig
    }
  };

  static PARTS = {
    body: { template: "systems/vedmak/templates/apps/scene-nexus.hbs", scrollable: [".nx-groups"] }
  };

  static #instance = null;
  static get instance() { return SceneNexus.#instance ??= new SceneNexus(); }

  /** Включить нексус вместо навигации Foundry (или вернуть её). */
  static refresh() {
    if (!game.ready) return;
    const on = setting("sceneNexus", true);
    document.body.classList.toggle("vd-nexus-on", on);
    document.body.classList.toggle("vd-nexus-open", on && setting("sceneNexusOpen", false));
    if (on) SceneNexus.schedule();
    else if (SceneNexus.#instance?.rendered) SceneNexus.#instance.close({ animate: false });
  }

  static #timer = null;
  /** Перерисовка с задержкой: пачка правок сцен, жетонов и пользователей — одна перерисовка. */
  static schedule() {
    if (!game.ready || !setting("sceneNexus", true)) return;
    clearTimeout(SceneNexus.#timer);
    SceneNexus.#timer = setTimeout(() => SceneNexus.instance.render({ force: true }), 60);
  }

  static registerHooks() {
    const again = () => SceneNexus.schedule();
    for (const hook of ["createScene", "updateScene", "deleteScene", "canvasReady", "renderSceneNavigation",
      "createToken", "deleteToken", "userConnected"]) Hooks.on(hook, again);
    for (const hook of ["createFolder", "updateFolder", "deleteFolder"]) Hooks.on(hook, f => { if (f.type === "Scene") again(); });
    // Этажи сцены (Scene Levels ядра v14; модуль Levels переносит в них старые этажи): список под биркой
    for (const hook of ["createLevel", "updateLevel", "deleteLevel"]) Hooks.on(hook, again);
    // Видимость жетона меняет, кого можно перевести
    Hooks.on("updateToken", (doc, changes) => { if ("hidden" in changes) again(); });
    // Выделение жетонов — кого переносить; перерисовка только при открытом окне места
    Hooks.on("controlToken", () => { if (SceneNexus.#instance?.pop) again(); });
    Hooks.on("updateUser", (user, changes) => { if ("viewedScene" in changes || "viewedLevel" in changes || "role" in changes) again(); });
    // Панель этажа закрывается щелчком мимо неё и клавишей Esc
    document.addEventListener("pointerdown", ev => {
      const nx = SceneNexus.#instance;
      if (nx?.levelMenu && !ev.target.closest?.(".nx-lvlmenu, .nx-level")) nx.#closeLevelMenu();
    }, true);
    document.addEventListener("keydown", ev => {
      if (ev.key === "Escape" && SceneNexus.#instance?.levelMenu) SceneNexus.#instance.#closeLevelMenu();
    });
    Hooks.once("ready", () => SceneNexus.refresh());
    registerGMHandler("nexusTravel", travelForUser);
  }

  /**
   * Название в папке: «Майена - площадь» в папке «Майена» — «Площадь» (полное — в подсказке и поиске).
   * @param {string} name
   * @param {string[]} prefixes — названия папок, от ближней к верхней
   */
  static short(name, prefixes) {
    const low = name.toLowerCase();
    for (const p of prefixes) {
      if (!low.startsWith(p.toLowerCase())) continue;
      const rest = name.slice(p.length).trimStart();
      if (!SEPARATORS.includes(rest[0])) continue;
      const tail = rest.slice(1).trim();
      if (tail) return tail[0].toUpperCase() + tail.slice(1);
    }
    return name;
  }

  /** Раскрыта ли доска — помнится у клиента. */
  get open() { return setting("sceneNexusOpen", false); }
  set open(v) { game.settings.set(SYSTEM_ID, "sceneNexusOpen", !!v); }

  /** Свёрнутые папки — у клиента. */
  get folded() { return new Set(setting("sceneNexusFolded", [])); }

  /** Сцена во всплывающем окне. */
  pop = null;
  /** Этаж в панели правой кнопки (только у ведущего). */
  levelMenu = null;
  query = "";

  _insertElement(element) {
    const column = document.getElementById("ui-left-column-2");
    if (column) column.prepend(element);
    else document.body.append(element);
    return element;
  }

  /* ------------------------------ Данные ------------------------------ */

  /** Пользователи по сценам: кто где смотрит. */
  #pips() {
    const out = {};
    for (const u of game.users) {
      if (!u.active || !u.viewedScene) continue;
      (out[u.viewedScene] ??= []).push({ name: u.name, letter: u.name[0], color: u.color.css });
    }
    return out;
  }

  /**
   * Этажи сцены сверху вниз — как в навигации Foundry, которую заменяет нексус: доступные пользователю (ведущему — все),
   * текущий отмечен, у каждого — кто из игроков на нём. Один этаж — списка нет.
   */
  #levels(scene) {
    const available = Array.from(scene.availableLevels ?? []);
    if (available.length < 2) return null;
    const current = canvas.scene === scene ? canvas.level?.id : null;
    return available.toReversed().map(level => ({
      id: level.id, name: level.name || "Этаж", view: level.id === current, menu: level.id === this.levelMenu,
      users: game.users.filter(u => u.active && u.viewedScene === scene.id && u.viewedLevel === level.id)
        .map(u => ({ name: u.name, letter: u.name[0], color: u.color.css }))
    }));
  }

  #item(scene, pips, gm, prefixes = []) {
    const open = openToPlayers(scene);
    const party = partyTokens(scene).length;
    const full = gm ? scene.name : (scene.navName || scene.name);
    const name = SceneNexus.short(full, prefixes);
    return {
      id: scene.id, name, full: name === full ? "" : full, search: full.toLowerCase(), thumb: scene.thumb,
      initial: name.trim()[0] ?? "?", active: scene.active, view: scene.isView, open, party, users: pips[scene.id] ?? [],
      css: [scene.active && "active", scene.isView && "view", gm && !open && "closed", this.pop === scene.id && "picked"].filter(Boolean).join(" ")
    };
  }

  async _prepareContext() {
    const gm = game.user.isGM;
    const pips = this.#pips();
    const folded = this.folded;
    // Закрытая сцена игроку не видна вовсе — даже активная, на которой стоит отряд
    const shown = game.scenes.filter(s => gm || s.visible);
    const bySort = (a, b) => (a.sort - b.sort) || compareRu(a.name, b.name);
    const scenesIn = (id, prefixes = []) => shown.filter(s => (s.folder?.id ?? null) === id).sort(bySort)
      .map(s => this.#item(s, pips, gm, prefixes));
    const folders = game.folders.filter(f => f.type === "Scene");
    const childrenOf = id => folders.filter(f => (f.folder?.id ?? null) === id).sort(bySort);
    // Вложенные папки любого уровня — бусинами внутри своей верхней папки
    const subsOf = (folder, prefixes) => childrenOf(folder.id).flatMap(f => {
      const inner = [f.name, ...prefixes];
      const scenes = scenesIn(f.id, inner);
      return [...(scenes.length ? [{ id: f.id, name: f.name, scenes }] : []), ...subsOf(f, inner)];
    });
    const groups = [];
    for (const f of childrenOf(null)) {
      const scenes = scenesIn(f.id, [f.name]);
      const subs = subsOf(f, [f.name]);
      const count = scenes.length + subs.reduce((n, s) => n + s.scenes.length, 0);
      if (!count) continue;
      groups.push({ id: f.id, name: f.name, color: f.color?.css ?? "", scenes, subs, count, folded: folded.has(f.id) });
    }
    const loose = scenesIn(null);
    if (loose.length) groups.push({ id: "", name: "Без папки", scenes: loose, subs: [], count: loose.length, folded: folded.has("") });

    const here = canvas.scene;
    const live = game.scenes.active;
    const label = s => gm ? s.name : (s.navName || s.name);
    const known = s => gm || s.visible;
    return {
      gm, open: this.open, query: this.query,
      here: here ? (known(here) ? { id: here.id, name: label(here), thumb: here.thumb, initial: label(here)[0] }
        : { id: here.id, name: "Неизвестное место", thumb: "", initial: "?" }) : null,
      live: live && live !== here && known(live) ? { id: live.id, name: label(live) } : null,
      users: here ? pips[here.id] ?? [] : [],
      levels: here && known(here) ? this.#levels(here) : null,
      levelMenu: gm && here ? this.#levelMenuContext(here) : null,
      groups, total: shown.length,
      pop: this.open && this.pop ? this.#popContext(game.scenes.get(this.pop), gm) : null
    };
  }

  /**
   * Окно сцены: что можно сделать и кого перенести. Переносятся только выделенные жетоны текущей сцены — у игрока
   * только свои (автор: «только выделенные токены»; перевода всех разом нет).
   */
  #popContext(scene, gm) {
    if (!scene) return null;
    const source = canvas.scene;
    const tokens = scene === source ? [] : (canvas.tokens?.controlled ?? []).map(t => t.document)
      .filter(t => t.parent === source && (gm || t.isOwner))
      .map(t => ({ uuid: t.uuid, name: t.name, img: t.texture.src }));
    return {
      id: scene.id, name: gm ? scene.name : (scene.navName || scene.name), thumb: scene.thumb,
      folder: scene.folder?.name ?? "", active: scene.active, view: scene.isView, open: openToPlayers(scene),
      source: source?.name ?? "", here: scene === source, tokens,
      entry: scene.regions.find(r => ENTRY_RE.test(r.name))?.name ?? ""
    };
  }

  /**
   * Панель этажа: высота (низ и верх; пусто — без границы), место среди этажей и окно настроек ядра.
   * «Выше» и «Ниже» — соседи по списку под биркой (он идёт сверху вниз).
   */
  #levelMenuContext(scene) {
    const level = this.levelMenu && scene.levels.get(this.levelMenu);
    if (!level) return null;
    const sorted = scene.levels.sorted;
    const i = sorted.indexOf(level);
    const { bottom, top } = level._source.elevation;
    return {
      id: level.id, name: level.name || "Этаж", bottom: bottom ?? "", top: top ?? "",
      units: scene.grid.units || "", up: i < sorted.length - 1, down: i > 0,
      step: scene.grid.distance || 1
    };
  }

  /* ------------------------------ Отрисовка ------------------------------ */

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    const input = el.querySelector(".nx-search");
    if (input) {
      input.addEventListener("input", () => { this.query = input.value; this.#filter(); });
      this.#filter();
    }
    // Двойной щелчок по месту — сразу посмотреть
    el.querySelectorAll(".nx-place[data-scene-id]").forEach(p => p.addEventListener("dblclick", ev => {
      ev.preventDefault();
      game.scenes.get(p.dataset.sceneId)?.view();
    }));
    this.#placePop();
    // Правая кнопка по этажу — панель этажа (ведущему)
    el.querySelectorAll(".nx-level[data-level-id]").forEach(li => li.addEventListener("contextmenu", ev => {
      ev.preventDefault();
      if (!game.user.isGM) return;
      this.levelMenu = this.levelMenu === li.dataset.levelId ? null : li.dataset.levelId;
      this.render();
    }));
    const menu = el.querySelector(".nx-lvlmenu");
    if (menu) {
      const row = el.querySelector(`.nx-level[data-level-id="${menu.dataset.levelId}"]`);
      if (row) menu.style.top = `${row.offsetTop}px`;
      menu.querySelectorAll("input[name]").forEach(input => input.addEventListener("change", () => this.#setElevation(menu)));
    }
  }

  #closeLevelMenu() {
    this.levelMenu = null;
    this.render();
  }

  /** Высота этажа из полей панели: пустое поле — без границы; низ выше верха Foundry не примет. */
  async #setElevation(menu) {
    const level = canvas.scene?.levels.get(menu.dataset.levelId);
    if (!level || !game.user.isGM) return;
    const read = name => {
      const v = menu.querySelector(`input[name="${name}"]`).value.trim();
      return v === "" ? null : Number(v);
    };
    const bottom = read("bottom"), top = read("top");
    if ([bottom, top].some(v => v !== null && !Number.isFinite(v))) return this.render();
    if ((bottom ?? -Infinity) > (top ?? Infinity)) {
      ui.notifications.warn("Низ этажа выше верха — высота не изменена.");
      return this.render();
    }
    await level.update({ elevation: { bottom, top } });
  }

  /**
   * Поменять этаж местами с соседним: обмениваются местом в порядке и высотой, жетоны этажа переезжают по высоте
   * вместе с ним (иначе стояли бы вне своего этажа). Порядок переписывается заново — у этажей бывает одинаковый sort.
   * @param {Scene} scene
   * @param {string} levelId
   * @param {1|-1} dir — 1 выше, −1 ниже
   */
  static async swapLevels(scene, levelId, dir) {
    const sorted = [...scene.levels.sorted];
    const i = sorted.findIndex(l => l.id === levelId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return false;
    const a = sorted[i], b = sorted[j];
    const elev = l => ({ bottom: l._source.elevation.bottom, top: l._source.elevation.top });
    const base = e => Number.isFinite(e.bottom) ? e.bottom : Math.min(e.top ?? 0, 0);
    const ea = elev(a), eb = elev(b);
    [sorted[i], sorted[j]] = [b, a];
    const updates = sorted.map((l, k) => ({ _id: l.id, sort: (k + 1) * CONST.SORT_INTEGER_DENSITY }));
    updates.find(u => u._id === a.id).elevation = eb;
    updates.find(u => u._id === b.id).elevation = ea;
    await scene.updateEmbeddedDocuments("Level", updates);
    const shift = { [a.id]: base(eb) - base(ea), [b.id]: base(ea) - base(eb) };
    const tokens = scene.tokens.filter(t => shift[t.level]).map(t => ({ _id: t.id, elevation: t.elevation + shift[t.level] }));
    if (tokens.length) await scene.updateEmbeddedDocuments("Token", tokens, { animate: false });
    return true;
  }

  /** Поиск по названию: прячет места и пустые папки без перерисовки. */
  #filter() {
    const q = this.query.trim().toLowerCase();
    for (const group of this.element.querySelectorAll(".nx-group")) {
      let any = false;
      for (const p of group.querySelectorAll(".nx-place")) {
        const hit = !q || p.dataset.search.includes(q);
        p.hidden = !hit;
        any ||= hit;
      }
      for (const sub of group.querySelectorAll(".nx-sub")) sub.hidden = !!q && !sub.querySelector(".nx-place:not([hidden])");
      group.hidden = !!q && !any;
      group.classList.toggle("searching", !!q);
    }
  }

  /** Окно сцены — вровень с выбранным местом, справа от доски. */
  #placePop() {
    const pop = this.element.querySelector(".nx-pop");
    const board = this.element.querySelector(".nx-board");
    const place = this.element.querySelector(`.nx-place[data-scene-id="${this.pop}"]`);
    if (!pop || !board) return;
    const top = place ? place.getBoundingClientRect().top - board.getBoundingClientRect().top - 12 : 0;
    const max = board.offsetHeight - pop.offsetHeight;
    pop.style.top = `${Math.max(0, Math.min(top, max))}px`;
  }

  /* ------------------------------ Действия ------------------------------ */

  static async #onToggle() {
    this.open = !this.open;
    document.body.classList.toggle("vd-nexus-open", this.open);
    if (!this.open) this.pop = null;
    this.render();
  }

  static #onPick(event, target) {
    const id = target.closest("[data-scene-id]").dataset.sceneId;
    this.pop = this.pop === id ? null : id;
    this.render();
  }

  static #onClosePop() {
    this.pop = null;
    this.render();
  }

  static async #onFold(event, target) {
    const id = target.closest("[data-folder-id]").dataset.folderId;
    const folded = this.folded;
    if (folded.has(id)) folded.delete(id); else folded.add(id);
    await game.settings.set(SYSTEM_ID, "sceneNexusFolded", [...folded]);
    this.render();
  }

  /** Показать этаж текущей сцены (как в навигации Foundry: только себе). */
  static #onViewLevel(event, target) {
    const levelId = target.closest("[data-level-id]")?.dataset.levelId;
    if (levelId && levelId !== canvas.level?.id) canvas.scene?.view({ level: levelId });
  }

  static #onCloseLevelMenu() { this.#closeLevelMenu(); }

  static async #onLevelUp() {
    if (game.user.isGM && canvas.scene) await SceneNexus.swapLevels(canvas.scene, this.levelMenu, 1);
  }

  static async #onLevelDown() {
    if (game.user.isGM && canvas.scene) await SceneNexus.swapLevels(canvas.scene, this.levelMenu, -1);
  }

  /** Полное окно этажа Foundry: фон, передний план, туман, видимость. */
  static #onLevelConfig() {
    const level = canvas.scene?.levels.get(this.levelMenu);
    this.levelMenu = null;
    this.render();
    level?.sheet.render(true);
  }

  static async #onView(event, target) {
    await game.scenes.get(target.dataset.sceneId ?? this.pop)?.view();
  }

  static async #onActivate() {
    const scene = game.scenes.get(this.pop);
    if (!scene || !game.user.isGM) return;
    if (scene.active) scene.pullUsers(game.users);
    else await scene.activate();
    ui.notifications.info(`Игроки на сцене «${scene.name}».`);
  }

  /**
   * Перенести выделенные жетоны. Ведущий: жетоны уходят на сцену, за ними — их владельцы-игроки и сам ведущий; остальные
   * игроки остаются где были. Игрок: свои выделенные жетоны и сам.
   */
  static async #onTravel() {
    const scene = game.scenes.get(this.pop);
    if (!scene) return;
    const uuids = this.#popContext(scene, game.user.isGM).tokens.map(t => t.uuid);
    this.pop = null;
    if (game.user.isGM) {
      const tokens = uuids.map(u => fromUuidSync(u)).filter(Boolean);
      const owners = game.users.filter(u => u.active && !u.isGM && tokens.some(t => t.testUserPermission(u, "OWNER")));
      const moved = await carryTokens(scene, tokens);
      if (owners.length) scene.pullUsers(owners);
      await scene.view();
      if (moved) ui.notifications.info(`На сцену «${scene.name}» перенесено жетонов: ${moved}.`);
      return;
    }
    // Игрок переходит сам, без вопроса ведущему. Создавать жетоны на другой сцене Foundry разрешает только ведущему
    // и помощнику, поэтому сам перенос молча делает открытый клиент ведущего; игрок попадает на сцену сразу
    if (uuids.length) {
      if (game.users.activeGM) await asGM("nexusTravel", { sceneId: scene.id, tokenUuids: uuids });
      else ui.notifications.warn("Ведущего нет в игре — Foundry не даёт игрокам переносить жетоны между сценами. Вы перешли без жетона.");
    }
    await scene.view();
  }

  /** Открыть или закрыть сцену игрокам: уровень «по умолчанию» — «ограниченный» или «нет». */
  static async #onAccess() {
    const scene = game.scenes.get(this.pop);
    if (!scene || !game.user.isGM) return;
    const open = openToPlayers(scene);
    const ownership = { default: open ? NONE : LIMITED };
    // Закрывая — снимаем и выдачи отдельным игрокам, иначе сцена осталась бы открытой им
    if (open) for (const u of game.users) if (!u.isGM && u.id in scene.ownership) ownership[`-=${u.id}`] = null;
    await scene.update({ ownership });
  }

  static #onConfigure() {
    game.scenes.get(this.pop)?.sheet.render(true);
  }
}
