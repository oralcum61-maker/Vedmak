// Общий стол (PLAN 4.199): окно битвы отрядов и игр в таверне видят и ведут сразу несколько участников. Окно того, кто
// ведёт игру (таверна — кто открыл, битва — ведущий), после каждой перерисовки рассылает снимок своего контекста; у
// остальных — такое же окно из снимка. Участники (владельцы участвующих актёров и ведущий) жмут кнопки и правят поля в
// своём окне: щелчок и правка уходят хозяину окна, у него выполняются как его собственные, и снимок расходится снова.
// Зрители по «Показать всем» только смотрят. Зритель закрыл окно — до новой игры (новой «сессии») оно не всплывает.

import { broadcast, registerBroadcast } from "../combat/common.mjs";

const KINDS = {};
const viewers = new Map();
const hosts = new Map();
const dismissed = new Set();
/** Атрибуты, по которым ищется элемент у хозяина окна. */
const KEYS = ["action", "id", "uuid", "side", "i", "node", "track", "game", "seat", "index", "level", "list", "kind", "path", "mode",
  "delta", "die", "bet", "mod", "spectatorBet", "gwentSkill", "player", "spectator", "tab"];

/**
 * Зарегистрировать окно для общего стола.
 * @param {string} kind — «battle», «tavern»
 * @param {Function} AppClass — класс окна; зритель создаётся как new AppClass({ viewer: true, id })
 */
export function registerSharedView(kind, AppClass) {
  KINDS[kind] = AppClass;
}

/** Снимок только из данных (без документов и функций) — его можно переслать. */
const plain = context => JSON.parse(JSON.stringify(context, (k, v) => (typeof v === "function" ? undefined : v)));

/**
 * Хозяин окна: разослать снимок.
 * @param {string} kind
 * @param {Application} app — окно хозяина
 * @param {{context: object, actors: Actor[], showAll: boolean, title?: string}} snap
 */
export function shareView(kind, app, { context, actors, showAll = false, title = "" }) {
  if (!game.ready) return;
  hosts.set(kind, app);
  const participants = game.users.filter(u => u.active && !u.isSelf
    && (u.isGM || actors.some(a => a?.testUserPermission?.(u, "OWNER")))).map(u => u.id);
  app.participants = participants;
  const audience = showAll ? game.users.filter(u => u.active && !u.isSelf).map(u => u.id) : participants;
  broadcast("sharedView", { kind, session: app.session, title, host: game.user.name, audience, participants, context: plain(context) });
}

/** Хозяин окна закрыл его — у остальных окно тоже закрывается. */
export function closeView(kind, app) {
  if (hosts.get(kind) === app) hosts.delete(kind);
  if (game.ready) broadcast("sharedViewClose", { kind, session: app.session });
}

/** Контекст окна из снимка хозяина. */
export function viewerContext(app) {
  return { ...(app.snapshot ?? {}), viewer: true, viewHost: app.viewHost ?? "", viewCanAct: !!app.canAct };
}

/** Как найти элемент у хозяина: его data-атрибуты и data-атрибуты предков (кто в каком месте стола). */
function locate(el, root) {
  const attrs = node => Object.fromEntries(Object.entries(node.dataset ?? {}).filter(([k]) => KEYS.includes(k)));
  const chain = [];
  for (let n = el.parentElement; n && n !== root; n = n.parentElement) {
    const a = attrs(n);
    if (Object.keys(a).length) chain.unshift(a);
  }
  return { self: { ...attrs(el), tag: el.tagName.toLowerCase(), name: el.getAttribute("name") ?? "" }, chain };
}

/** Найти у хозяина элемент по описанию locate. */
function find(root, { self, chain }) {
  const sel = a => Object.entries(a).filter(([k]) => k !== "tag" && k !== "name")
    .map(([k, v]) => `[data-${k.replace(/[A-Z]/g, c => "-" + c.toLowerCase())}="${CSS.escape(String(v))}"]`).join("");
  let own = (self.tag ?? "") + sel(self) + (self.name ? `[name="${CSS.escape(self.name)}"]` : "");
  const path = [...chain.map(sel).filter(Boolean), own].join(" ");
  return root.querySelector(path);
}

/**
 * Окно зрителя после отрисовки. Участник — щелчки по кнопкам и правки полей уходят хозяину; зритель — только смотрит
 * (открыть лист актёра можно).
 */
export function wireViewer(app) {
  const el = app.element;
  if (!el) return;
  el.classList.add("vd-viewer");
  if (!app.canAct) {
    el.classList.add("vd-viewer-only");
    for (const x of el.querySelectorAll("input, select, textarea, button")) x.disabled = true;
    return;
  }
  if (el._vdWired) return;
  el._vdWired = true;
  el.addEventListener("click", ev => {
    const t = ev.target.closest("[data-action]");
    if (!t || !el.contains(t) || ["open", "openActor", "openUnit"].includes(t.dataset.action)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    broadcast("sharedViewAction", { kind: app.viewKind, session: app.session, click: locate(t, el) });
  }, true);
  el.addEventListener("change", ev => {
    const t = ev.target;
    if (!t.matches?.("input, select, textarea")) return;
    ev.stopImmediatePropagation();
    broadcast("sharedViewAction", { kind: app.viewKind, session: app.session, change: { ...locate(t, el),
      value: t.type === "checkbox" ? t.checked : t.value } });
  }, true);
}

export function registerSharedViews() {
  registerBroadcast("sharedView", async ({ kind, session, title, host, audience, participants, context }) => {
    if (!audience?.includes(game.user.id) || dismissed.has(session)) return;
    const AppClass = KINDS[kind];
    if (!AppClass) return;
    let app = viewers.get(kind);
    if (!app) {
      app = new AppClass({ viewer: true, id: `vedmak-${kind}-view` });
      viewers.set(kind, app);
    }
    Object.assign(app, { viewKind: kind, session, snapshot: context, viewHost: host, viewTitle: title,
      canAct: participants?.includes(game.user.id) });
    await app.render({ force: true });
  });
  registerBroadcast("sharedViewClose", ({ kind, session }) => {
    const app = viewers.get(kind);
    if (app?.session === session) app.close({ fromHost: true });
  });
  // У хозяина: щелчок или правка участника — как свои
  registerBroadcast("sharedViewAction", async ({ kind, session, click, change }, userId) => {
    const app = hosts.get(kind);
    if (!app?.rendered || app.session !== session || !app.participants?.includes(userId)) return;
    const root = app.element;
    if (click) find(root, click)?.click();
    if (change) {
      const input = find(root, change);
      if (!input) return;
      if (input.type === "checkbox") input.checked = !!change.value;
      else input.value = change.value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      // Правка без перерисовки (ставка, «±», местность) — снимок всё равно разойтись должен
      setTimeout(() => app.rendered && app.render(), 50);
    }
  });
}

/** Зритель закрыл окно сам — эта игра больше не открывается у него сама. */
export function viewerClosed(app, options = {}) {
  if (!options.fromHost && app.session) dismissed.add(app.session);
}
