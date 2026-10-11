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
  if (!user.isGM && !scene.active && scene.getUserLevel(user) < LIMITED) {
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
      carry: SceneNexus.#onCarry,
      access: SceneNexus.#onAccess,
      configure: SceneNexus.#onConfigure
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
    // Видимость жетона меняет, кого можно перевести
    Hooks.on("updateToken", (doc, changes) => { if ("hidden" in changes) again(); });
    Hooks.on("updateUser", (user, changes) => { if ("viewedScene" in changes || "role" in changes) again(); });
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

  /** Сцена во всплывающем окне и снятые отметки жетонов для перевода. */
  pop = null;
  carryOff = new Set();
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
    const shown = game.scenes.filter(s => gm || s.active || s.visible);
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
    return {
      gm, open: this.open, query: this.query,
      here: here ? { id: here.id, name: label(here), thumb: here.thumb, initial: label(here)[0] } : null,
      live: live && live !== here ? { id: live.id, name: label(live) } : null,
      users: here ? pips[here.id] ?? [] : [],
      groups, total: shown.length,
      pop: this.open && this.pop ? this.#popContext(game.scenes.get(this.pop), gm) : null
    };
  }

  /** Окно сцены: что можно сделать и кого перевести. */
  #popContext(scene, gm) {
    if (!scene) return null;
    const source = gm ? (game.scenes.active ?? canvas.scene) : canvas.scene;
    const tokens = scene === source ? [] : partyTokens(source, gm ? null : game.user).map(t => ({
      uuid: t.uuid, name: t.name, img: t.texture.src, on: !this.carryOff.has(t.uuid)
    }));
    return {
      id: scene.id, name: gm ? scene.name : (scene.navName || scene.name), thumb: scene.thumb,
      folder: scene.folder?.name ?? "", active: scene.active, view: scene.isView, open: openToPlayers(scene),
      source: source?.name ?? "", tokens, carrying: tokens.filter(t => t.on).length,
      entry: scene.regions.find(r => ENTRY_RE.test(r.name))?.name ?? ""
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
    this.carryOff.clear();
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

  /** Перевести отряд: ведущий — отмеченные жетоны и всех игроков; игрок — себя со своими жетонами. */
  static async #onTravel() {
    const scene = game.scenes.get(this.pop);
    if (!scene) return;
    const ctx = this.#popContext(scene, game.user.isGM);
    const uuids = ctx.tokens.filter(t => t.on).map(t => t.uuid);
    this.pop = null;
    if (game.user.isGM) {
      const tokens = uuids.map(u => fromUuidSync(u)).filter(Boolean);
      const moved = await carryTokens(scene, tokens);
      if (!scene.active) await scene.activate();
      else { scene.pullUsers(game.users); await scene.view(); }
      ui.notifications.info(`Отряд на сцене «${scene.name}»${moved ? `: перенесено жетонов — ${moved}` : ""}.`);
      return;
    }
    if (uuids.length) {
      if (!game.users.activeGM) return ui.notifications.warn("Перенести жетон может только ведущий — его сейчас нет в игре. Можно перейти посмотреть.");
      await asGM("nexusTravel", { sceneId: scene.id, tokenUuids: uuids });
    }
    await scene.view();
  }

  static #onCarry(event, target) {
    const uuid = target.dataset.uuid;
    if (this.carryOff.has(uuid)) this.carryOff.delete(uuid); else this.carryOff.add(uuid);
    this.render();
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
