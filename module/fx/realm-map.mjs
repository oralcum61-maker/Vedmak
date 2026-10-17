// Поселения на карте (PLAN 4.249): над жетоном поселения — плашка сводки (семьи, одобрение, казна, тревоги), между
// жетонами — стрелки караванов с грузом. Рисуется PIXI в интерфейсной группе сцены, перерисовка — по изменениям актёров
// и жетонов (не каждый кадр). Сводку и караваны видит тот, кто может смотреть лист поселения (наблюдатель и выше).
// Жетон может быть не связан с актёром — поселение берётся из актёра мира (караваны ссылаются на него).

import { townAlerts } from "../apps/ruler-council.mjs";

const SYS = "vedmak";
const SILVER = 0xd8d1c2, INK = 0x0d0e10, RED = 0xf0a08c, ROUTE = 0xe6c48a;
const fmt = n => (Math.round((Number(n) || 0) * 10) / 10).toLocaleString("ru-RU");

let layer = null;
let pending = false;

const enabled = () => { try { return game.settings.get(SYS, "realmMap"); } catch { return true; } };

/** Слой под эффектами системы (scene.mjs — zIndex 900), над жетонами. */
function mapLayer() {
  if (!canvas?.ready || !canvas.interface) return null;
  if (layer && !layer.destroyed && layer.parent) return layer;
  layer = new PIXI.Container();
  layer.eventMode = "none";
  layer.zIndex = 850;
  layer.name = "vedmak-realm-map";
  canvas.interface.addChild(layer);
  canvas.interface.sortableChildren = true;
  return layer;
}

/** Поселение жетона — актёр мира (у несвязанного жетона — его основа). */
const townOf = token => {
  const a = game.actors.get(token.document.actorId);
  return a?.type === "settlement" ? a : null;
};
const canSee = a => game.user.isGM || a.testUserPermission(game.user, "OBSERVER");

/** Жетоны поселений на сцене: uuid поселения → первый видимый жетон. */
function townTokens() {
  const map = new Map();
  for (const t of canvas.tokens?.placeables ?? []) {
    const a = townOf(t);
    if (!a || !t.visible || map.has(a.uuid)) continue;
    map.set(a.uuid, { token: t, actor: a });
  }
  return map;
}

const fontSize = () => Math.max(12, Math.min(30, Math.round((canvas.grid?.size ?? 100) * 0.19)));
const text = (str, { fill = SILVER, size = fontSize(), head = false } = {}) => {
  const t = new PIXI.Text(str, {
    fontFamily: head ? "Vedmak Display, Forum, serif" : "Signika, sans-serif", fontSize: size, fill,
    stroke: INK, strokeThickness: Math.max(2, Math.round(size / 7)), align: "center"
  });
  t.resolution = 2;
  t.anchor.set(0.5, 0);
  return t;
};

/** Плашка сводки над жетоном. */
function plate(token, actor) {
  const sys = actor.system;
  const box = new PIXI.Container();
  box.name = `realm-plate:${actor.id}`;
  const lines = [text(`Семьи ${sys.families} · Одобрение ${sys.approval} · Казна ${fmt(sys.wealth)}`)];
  const alerts = townAlerts(actor);
  if (alerts.length) lines.push(text(alerts.join(" · "), { fill: RED, size: Math.round(fontSize() * 0.85) }));
  const pad = Math.round(fontSize() * 0.45);
  let y = pad;
  const w = Math.max(...lines.map(l => l.width)) + pad * 2;
  for (const l of lines) { l.position.set(0, y); y += l.height; }
  const h = y + pad;
  const bg = new PIXI.Graphics();
  bg.lineStyle({ width: 1.5, color: alerts.length ? 0xb8432c : 0x8f897d, alpha: 0.9 });
  bg.beginFill(INK, 0.82).drawRoundedRect(-w / 2, 0, w, h, pad).endFill();
  box.addChild(bg, ...lines);
  const c = token.center;
  box.position.set(c.x, token.document.y - h - Math.round(fontSize() * 0.4));
  return box;
}

/** Стрелка каравана: от края жетона к краю жетона, сдвинута вправо по ходу — встречные не слипаются. */
function arrow(from, to, label) {
  const a = from.center, b = to.center;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const box = new PIXI.Container();
  const ra = Math.max(from.w, from.h) / 2 + 8, rb = Math.max(to.w, to.h) / 2 + 8;
  if (len <= ra + rb + 10) return box;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const off = (canvas.grid?.size ?? 100) * 0.12;
  const s = { x: a.x + ux * ra + nx * off, y: a.y + uy * ra + ny * off };
  const e = { x: b.x - ux * rb + nx * off, y: b.y - uy * rb + ny * off };
  const width = Math.max(3, (canvas.grid?.size ?? 100) * 0.05), head = width * 4;
  const g = new PIXI.Graphics();
  g.lineStyle({ width: width + 3, color: INK, alpha: 0.7, cap: PIXI.LINE_CAP.ROUND });
  g.moveTo(s.x, s.y).lineTo(e.x - ux * head * 0.6, e.y - uy * head * 0.6);
  g.lineStyle({ width, color: ROUTE, alpha: 0.9, cap: PIXI.LINE_CAP.ROUND });
  g.moveTo(s.x, s.y).lineTo(e.x - ux * head * 0.6, e.y - uy * head * 0.6);
  g.lineStyle({ width: 2, color: INK, alpha: 0.8 });
  g.beginFill(ROUTE, 0.95).drawPolygon([e.x, e.y, e.x - ux * head + nx * head * 0.55, e.y - uy * head + ny * head * 0.55,
    e.x - ux * head - nx * head * 0.55, e.y - uy * head - ny * head * 0.55]).endFill();
  // Груз — на тёмной плашке у середины стрелки, с той же стороны, куда сдвинута стрелка
  const t = text(label, { fill: ROUTE, size: Math.round(fontSize() * 0.9) });
  t.anchor.set(0.5, 0.5);
  const pad = Math.round(fontSize() * 0.35);
  const away = t.height / 2 + pad + width;
  const cx = (s.x + e.x) / 2 + nx * away, cy = (s.y + e.y) / 2 + ny * away;
  const pill = new PIXI.Graphics();
  pill.lineStyle({ width: 1.5, color: ROUTE, alpha: 0.6 });
  pill.beginFill(INK, 0.85).drawRoundedRect(cx - t.width / 2 - pad, cy - t.height / 2 - pad / 2, t.width + pad * 2, t.height + pad, pad).endFill();
  t.position.set(cx, cy);
  box.addChild(g, pill, t);
  box.name = "realm-route";
  return box;
}

/** Перерисовать всё (дёшево: поселений на сцене единицы). */
export function drawRealmMap() {
  pending = false;
  const root = mapLayer();
  if (!root) return;
  for (const c of root.removeChildren()) c.destroy({ children: true });
  if (!enabled()) return;
  const towns = townTokens();
  for (const { token, actor } of towns.values()) {
    if (!canSee(actor)) continue;
    const by = new Map();
    for (const r of actor.system.routes) {
      if (!towns.has(r.to) || r.to === actor.uuid || !r.qty) continue;
      by.set(r.to, [...(by.get(r.to) ?? []), `${r.resource} ${fmt(r.qty)}`]);
    }
    for (const [to, goods] of by) root.addChild(arrow(token, towns.get(to).token, goods.join(", ")));
  }
  for (const { token, actor } of towns.values()) if (canSee(actor)) root.addChild(plate(token, actor));
}

/** Перерисовка не чаще кадра. */
export function queueRealmMap() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(drawRealmMap);
}

export function registerRealmMap() {
  game.settings.register(SYS, "realmMap", {
    name: "Королевство: поселения на карте",
    hint: "Над жетоном поселения — семьи, одобрение, казна и тревоги; между жетонами — стрелки караванов с грузом.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => queueRealmMap()
  });
  Hooks.on("canvasReady", () => queueRealmMap());
  Hooks.on("canvasTearDown", () => { layer = null; });
  const realm = doc => ["settlement", "building", "unit"].includes(doc?.type);
  for (const hook of ["createActor", "updateActor", "deleteActor"]) Hooks.on(hook, doc => { if (realm(doc)) queueRealmMap(); });
  Hooks.on("refreshToken", token => { if (townOf(token)) queueRealmMap(); });
  for (const hook of ["createToken", "deleteToken"]) Hooks.on(hook, doc => { if (doc.parent === canvas.scene) queueRealmMap(); });
}
