// Окно битвы (PLAN 4.187): две стороны из отрядов, местность, кто обороняется; «Раунд» — бросок сил сторон
// (army/rules.mjs battleRound), потери и боевой дух — в отряды, итог — карточкой в чат. Окно — у ведущего; владельцы
// отрядов видят его у себя и жмут кнопки сами («Показать всем» — смотрят и остальные; apps/shared-view.mjs, PLAN 4.199).

import { TERRAIN, TRAINING, WEAPONS, ARMOR, UNIT_KINDS } from "../config/army.mjs";
import { unitState, battleRound } from "../army/rules.mjs";
import { postCard, broadcast, registerBroadcast } from "../combat/common.mjs";
import { shareView, closeView, viewerContext, wireViewer, viewerClosed } from "./shared-view.mjs";
import { animateRealm, animateNew, playSound } from "../fx/realm-fx.mjs";
import { bindUnitMenu } from "../army/unit-menu.mjs";
import { realmConfirm } from "./realm-dialog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const rand = () => (CONFIG.Dice.randomUniform ?? Math.random)();

/* ------------------------------ Битва на карте (PLAN 4.207) ------------------------------ */

/** Поле битвы — клеток от середины: отряды дальше в бою не участвуют. */
export const FIELD_CELLS = 4;
/** Местность по названию региона сцены (или флаг региона vedmak.terrain). */
const TERRAIN_WORDS = [
  ["walls", /стен|частокол|крепост|вал\b|wall|palisade/i], ["river", /брод|рек|ручей|переправ|river|ford/i],
  ["forest", /лес|роща|чащ|бор\b|forest|wood/i], ["hill", /холм|гор[аы]?\b|возвыш|курган|hill/i], ["field", /поле|луг|равнин|field|plain/i]
];

/** Середина жетона: где он будет по концу пути (идущий жетон в документе ещё на старом месте); at — своя позиция. */
export function tokenCenter(t, at = t.movement?.destination ?? t) {
  const size = t.parent?.grid?.size ?? 100;
  return { x: at.x + (t.width * size) / 2, y: at.y + (t.height * size) / 2, elevation: at.elevation ?? t.elevation ?? 0 };
}

/** Базовый актёр жетона (у несвязанного жетона — актёр мира, а не его копия). */
export const baseActor = t => game.actors.get(t.actorId) ?? t.actor;

/** Местность в точке сцены: первый регион с флагом vedmak.terrain или узнаваемым названием. */
export function terrainAt(scene, point) {
  for (const r of scene?.regions ?? []) {
    let inside = false;
    try { inside = r.testPoint({ x: point.x, y: point.y, elevation: point.elevation ?? 0 }); } catch { inside = false; }
    if (!inside) continue;
    const key = r.getFlag("vedmak", "terrain") || TERRAIN_WORDS.find(([, re]) => re.test(r.name ?? ""))?.[0];
    if (key && TERRAIN[key]) return { key, region: r.name };
  }
  return null;
}

/** Жетоны отрядов (с бойцами) в радиусе от точки. */
export function unitTokensNear(scene, point, radius) {
  return (scene?.tokens ?? []).filter(t => t.actor?.type === "unit" && t.actor.system.soldiers > 0
    && Math.hypot(tokenCenter(t).x - point.x, tokenCenter(t).y - point.y) <= radius);
}

/** Сошлись ли два жетона: вплотную (с запасом в полклетки); ca — середина первого (куда он идёт). */
const inContact = (a, b, ca = tokenCenter(a)) => {
  const size = a.parent?.grid?.size ?? 100;
  const cb = tokenCenter(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y) <= ((a.width + b.width) * size) / 2 + size * 0.6;
};
/** Противники: разные стороны (дружественные против враждебных; скрытые не в счёт). */
const SECRET = () => CONST.TOKEN_DISPOSITIONS.SECRET;
const foes = (a, b) => a.disposition !== b.disposition && a.disposition !== SECRET() && b.disposition !== SECRET();

/** Всплывающий текст над жетоном — у всех клиентов. */
function floatText(scene, token, text, danger = true) {
  broadcast("battleText", { scene: scene.id, token: token.id, text, danger });
  showText({ scene: scene.id, token: token.id, text, danger });
}
function showText({ scene, token, text, danger }) {
  if (canvas?.scene?.id !== scene) return;
  const t = canvas.tokens?.get(token);
  if (!t) return;
  canvas.interface?.createScrollingText(t.center, text, { anchor: CONST.TEXT_ANCHOR_POINTS.TOP, fontSize: 30,
    fill: danger ? 0xe0856f : 0xd9d2c3, stroke: 0x101113, strokeThickness: 4, jitter: 0.25 });
}

/**
 * Отряды сошлись на сцене (PLAN 4.207): клиент ведущего после движения жетона-отряда ищет вплотную отряд другой стороны;
 * битва уже идёт на этой сцене — отряды вступают в неё сами, иначе ведущему — предложение начать битву.
 */
export function registerMapBattle() {
  registerBroadcast("battleText", showText);
  const declined = new Set();
  const asking = new Set();
  Hooks.on("moveToken", async (tokenDoc, movement, operation, user) => {
    if (tokenDoc.actor?.type !== "unit" || !(tokenDoc.actor.system.soldiers > 0)) return;
    const gm = game.users.activeGM === game.user;
    const mover = (user?.id ?? user) === game.user.id;
    if (!gm && !mover) return;
    const scene = tokenDoc.parent;
    // В хуке документ ещё на старом месте — считается по концу пути
    const here = tokenCenter(tokenDoc, movement?.destination ?? tokenDoc);
    const enemies = scene.tokens.filter(t => t.id !== tokenDoc.id && t.actor?.type === "unit" && t.actor.system.soldiers > 0
      && foes(tokenDoc, t) && inContact(tokenDoc, t, here));
    for (const key of [...declined]) if (key.includes(tokenDoc.id) && !enemies.some(e => key.includes(e.id))) declined.delete(key);
    if (!enemies.length) return;
    // Игрок двинул отряд вплотную к чужому — подсказка: битву начинает ведущий (PLAN 4.210)
    if (!gm) {
      if (!game.users.activeGM) return ui.notifications.warn("Отряды сошлись, но ведущего нет в игре — битву начать некому.");
      return ui.notifications.info(`«${tokenDoc.name}» сошёлся с «${enemies.map(e => e.name).join("», «")}» — ведущему предложено начать битву.`);
    }
    const app = foundry.applications.instances.get("vedmak-battle");
    if (app?.field?.scene === scene.id && app.rendered) { setTimeout(() => { app.syncField(); app.render(); }, 600); return; }
    const key = [tokenDoc.id, ...enemies.map(e => e.id)].sort().join("|");
    // Пока вопрос открыт, новые шаги тех же отрядов не открывают второе окно поверх первого
    if (declined.has(key) || asking.has(key)) return;
    asking.add(key);
    const ok = await realmConfirm("clash", { title: "Отряды сошлись",
      text: `«${tokenDoc.name}» сошёлся с «${enemies.map(e => e.name).join("», «")}». Начать битву на этом месте?`,
      hint: `В бою — все отряды в ${FIELD_CELLS} клетках; местность — из региона сцены.` }).finally(() => asking.delete(key));
    if (!ok) { declined.add(key); return; }
    const b = tokenCenter(enemies[0]);
    BattleApp.fromScene(scene, { x: (here.x + b.x) / 2, y: (here.y + b.y) / 2, elevation: here.elevation }, { attacker: tokenDoc });
  });
}

export class BattleApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "vedmak-battle",
    classes: ["vedmak", "vedmak-dialog", "battle-app"],
    window: { title: "Битва", icon: "fa-solid fa-flag", resizable: true },
    position: { width: 940, height: 680 },
    actions: {
      addSelected: BattleApp.#onAddSelected,
      remove: BattleApp.#onRemove,
      round: BattleApp.#onRound,
      defender: BattleApp.#onDefender,
      reset: BattleApp.#onReset,
      open: BattleApp.#onOpen,
      showAll: BattleApp.#onShowAll,
      fieldSync: BattleApp.#onFieldSync,
      fieldOff: BattleApp.#onFieldOff
    }
  };

  static PARTS = { body: { template: "systems/vedmak/templates/apps/battle.hbs", scrollable: [".bt-sides", ".bt-log"] } };

  /** Открыть окно (одно на клиента) и добавить отряды на первую сторону. */
  static open(units = []) {
    if (!game.user.isGM) return ui.notifications.warn("Битву ведёт ведущий.");
    const app = foundry.applications.instances.get("vedmak-battle") ?? new BattleApp();
    for (const u of units) app.add(0, u);
    app.render({ force: true });
    return app;
  }

  /** Окно зрителя (общий просмотр): снимок окна ведущего, без управления. */
  get viewer() { return !!this.options.viewer; }
  /** Сессия общего просмотра: новая битва — новая. */
  session = foundry.utils.randomID();
  showAll = false;

  sides = [{ ids: [], defender: false }, { ids: [], defender: true }];
  /** Поселение, у стен которого бой (uuid): его укрепления — обороняющимся. */
  town = "";
  /** Павшие за битву по отрядам: после битвы лекари возвращают часть. */
  lost = {};
  terrain = "field";
  roundNo = 1;
  log = [];

  /**
   * Битва на сцене (PLAN 4.207): {scene, x, y, radius, region, sideOf: {расположение жетона: сторона}}. В бою — отряды,
   * чьи жетоны в радиусе от середины поля; перед раундом состав сверяется со сценой.
   */
  field = null;

  /** Открыть битву на месте сцены: отряды в поле по сторонам (сторона атакующего — первая), местность из региона. */
  static fromScene(scene, point, { attacker = null } = {}) {
    if (!game.user.isGM) return ui.notifications.warn("Битву ведёт ведущий.");
    const app = foundry.applications.instances.get("vedmak-battle") ?? new BattleApp();
    const radius = (scene.grid?.size ?? 100) * FIELD_CELLS;
    const near = unitTokensNear(scene, point, radius);
    const first = attacker?.disposition ?? near[0]?.disposition ?? CONST.TOKEN_DISPOSITIONS.FRIENDLY;
    app.sides = [{ ids: [], defender: false }, { ids: [], defender: true }];
    app.roundNo = 1; app.log = []; app.lost = {}; app.session = foundry.utils.randomID();
    app.field = { scene: scene.id, x: point.x, y: point.y, elevation: point.elevation ?? 0, radius, region: "", sideOf: { [first]: 0 } };
    // Поселение рядом — бой у его стен: укрепления обороняющимся, обороняется сторона его отрядов
    const townToken = scene.tokens.find(t => baseActor(t)?.type === "settlement"
      && Math.hypot(tokenCenter(t).x - point.x, tokenCenter(t).y - point.y) <= radius * 1.5);
    const town = townToken ? baseActor(townToken) : null;
    app.town = town?.uuid ?? "";
    const terrain = terrainAt(scene, point);
    app.terrain = app.town ? "walls" : terrain?.key ?? "field";
    app.field.region = town ? town.name : terrain?.region ?? "";
    app.syncField();
    if (app.town) {
      const homeSide = app.sides.findIndex(sd => sd.ids.some(id => game.actors.get(id)?.system.settlement === app.town));
      if (homeSide >= 0) app.sides.forEach((sd, i) => { sd.defender = i === homeSide; });
    }
    app.render({ force: true });
    return app;
  }

  /** Сверить состав со сценой: ушедшие из поля — из битвы, пришедшие — на сторону своего расположения. Строки заметок. */
  syncField() {
    const f = this.field;
    const scene = f ? game.scenes.get(f.scene) : null;
    if (!scene) return [];
    const near = unitTokensNear(scene, f, f.radius);
    const here = new Map(near.map(t => [t.actor.id, t]));
    const notes = [];
    for (const sd of this.sides) for (const id of [...sd.ids]) {
      if (here.has(id)) continue;
      sd.ids = sd.ids.filter(x => x !== id);
      notes.push(`${game.actors.get(id)?.name ?? "?"} покинул поле`);
    }
    for (const t of near) {
      if (this.sides.some(sd => sd.ids.includes(t.actor.id))) continue;
      f.sideOf[t.disposition] ??= Object.values(f.sideOf).includes(0) ? 1 : 0;
      this.sides[f.sideOf[t.disposition]].ids.push(t.actor.id);
      if (this.roundNo > 1) notes.push(`${t.actor.name} вступил в бой`);
    }
    return notes;
  }

  add(side, actor) {
    if (actor?.type !== "unit") return;
    for (const s of this.sides) s.ids = s.ids.filter(id => id !== actor.id);
    this.sides[side].ids.push(actor.id);
  }

  async _prepareContext() {
    if (this.viewer) return viewerContext(this);
    const sides = this.sides.map((s, i) => {
      const units = s.ids.map(id => game.actors.get(id)).filter(Boolean).map(a => ({
        id: a.id, name: a.name, img: a.img, soldiers: a.system.soldiers, morale: a.system.morale, routed: a.system.routed,
        kind: UNIT_KINDS[a.system.kind]?.label, training: TRAINING[a.system.training].label, equipment: `${WEAPONS[a.system.weapons].label} · ${ARMOR[a.system.armor].label.toLowerCase()}`,
        power: a.system.power.total
      }));
      return { index: i, label: i ? "Вторая сторона" : "Первая сторона", defender: s.defender, units,
        soldiers: units.filter(u => !u.routed).reduce((n, u) => n + u.soldiers, 0), power: units.filter(u => !u.routed).reduce((n, u) => n + u.power, 0) };
    });
    const town = this.town ? fromUuidSync(this.town) : null;
    return {
      sides, round: this.roundNo, log: [...this.log].reverse(),
      towns: game.actors.filter(a => a.type === "settlement").map(a => ({ uuid: a.uuid, name: a.name, selected: a.uuid === this.town })),
      fort: town ? town.system.summary.defense : 0,
      terrains: Object.entries(TERRAIN).map(([k, t]) => ({ key: k, label: t.label, selected: k === this.terrain })),
      ready: sides.every(s => s.units.some(u => !u.routed && u.soldiers)), showAll: this.showAll,
      field: this.field ? { scene: game.scenes.get(this.field.scene)?.name ?? "?", cells: FIELD_CELLS, region: this.field.region } : null,
      canField: game.user.isGM && !!canvas?.scene
    };
  }

  /** Участники битвы — отряды обеих сторон. */
  get #units() { return this.sides.flatMap(s => s.ids).map(id => game.actors.get(id)).filter(Boolean); }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    bindUnitMenu(this.element, ".bt-side li[data-id]");
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    animateRealm(this, this.element, "battle");
    animateNew(this, this.element, ".bt-log > li", el => el.querySelector("b")?.textContent ?? "");
    if (this.viewer) return wireViewer(this);
    shareView("battle", this, { context, actors: this.#units, showAll: this.showAll });
    this.element.querySelector("select[name=terrain]")?.addEventListener("change", ev => { this.terrain = ev.target.value; });
    this.element.querySelector("select[name=battleTown]")?.addEventListener("change", ev => { this.town = ev.target.value; this.render(); });
    // Отряд из списка актёров — на сторону, куда бросили
    for (const col of this.element.querySelectorAll("[data-side]")) {
      col.addEventListener("dragover", ev => ev.preventDefault());
      col.addEventListener("drop", async ev => {
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev);
        if (data?.type !== "Actor") return;
        const actor = await fromUuid(data.uuid);
        if (actor?.type !== "unit") return ui.notifications.warn("В битву ставятся отряды (актёры «Отряд»).");
        this.add(Number(col.dataset.side), actor);
        this.render();
      });
    }
  }

  _onClose(options) {
    super._onClose?.(options);
    if (this.viewer) viewerClosed(this, options);
    else closeView("battle", this);
  }

  /**
   * Битва кончилась — лекари родного поселения возвращают в строй часть павших: 20 % и по 10 % за хату травника,
   * алхимическую лавку и храм (не больше 50 %).
   */
  async #heal() {
    const out = [];
    const updates = [];
    for (const [id, lost] of Object.entries(this.lost)) {
      const unit = game.actors.get(id);
      const home = unit?.system.settlementActor;
      if (!unit || !home) continue;
      const healers = home.system.buildings.filter(b => b.level >= 1 && ["herbalist", "alchemist", "temple"].includes(b.key)).length;
      const back = Math.floor(lost * Math.min(0.5, 0.2 + 0.1 * healers));
      if (!back) continue;
      updates.push({ _id: id, "system.soldiers": unit.system.soldiers + back });
      out.push(`${unit.name}: +${back} из ${lost}`);
    }
    if (updates.length) await Actor.updateDocuments(updates);
    this.lost = {};
    return out;
  }

  /** Ведущий: поле битвы по выделенным жетонам-отрядам (или по середине экрана) — состав и местность со сцены. */
  static #onFieldSync() {
    const scene = canvas?.scene;
    if (!scene) return;
    const sel = (canvas.tokens?.controlled ?? []).filter(t => t.actor?.type === "unit");
    const pts = sel.length ? sel.map(t => tokenCenter(t.document)) : [{ x: canvas.stage.pivot.x, y: canvas.stage.pivot.y }];
    const point = { x: pts.reduce((n, p) => n + p.x, 0) / pts.length, y: pts.reduce((n, p) => n + p.y, 0) / pts.length };
    BattleApp.fromScene(scene, point, { attacker: sel[0]?.document });
  }
  static #onFieldOff() { this.field = null; this.render(); }

  static #onShowAll() { this.showAll = !this.showAll; this.render(); }

  static #onAddSelected(event, target) {
    const side = Number(target.dataset.side);
    const units = (canvas.tokens?.controlled ?? []).map(t => t.actor).filter(a => a?.type === "unit");
    if (!units.length) return ui.notifications.warn("Выделите жетоны отрядов на сцене.");
    for (const a of units) this.add(side, a);
    this.render();
  }

  static #onRemove(event, target) {
    const id = target.closest("[data-id]").dataset.id;
    for (const s of this.sides) s.ids = s.ids.filter(x => x !== id);
    this.render();
  }

  static #onDefender(event, target) {
    const side = Number(target.dataset.side);
    this.sides.forEach((s, i) => { s.defender = i === side; });
    this.render();
  }

  static #onOpen(event, target) { game.actors.get(target.closest("[data-id]").dataset.id)?.sheet.render(true); }

  /** Новая битва: раунды с первого, бегство снято. */
  static async #onReset() {
    const ids = this.sides.flatMap(s => s.ids);
    await Actor.updateDocuments(ids.filter(id => game.actors.get(id)?.system.routed).map(id => ({ _id: id, "system.routed": false })));
    this.roundNo = 1; this.log = []; this.lost = {};
    this.session = foundry.utils.randomID();
    this.render();
  }

  static async #onRound() {
    const fieldNotes = this.syncField();
    const actors = this.sides.map(s => s.ids.map(id => game.actors.get(id)).filter(Boolean));
    const town = this.town ? fromUuidSync(this.town) : null;
    const fort = town?.system.summary.defense ?? 0;
    const sides = actors.map((list, i) => ({ defender: this.sides[i].defender, fort, units: list.map(unitState) }));
    if (!sides.every(s => s.units.some(u => u.soldiers && !u.routed))) return ui.notifications.warn("На обеих сторонах нужны стоящие отряды.");
    const res = battleRound(sides, { round: this.roundNo, terrain: this.terrain, rand });
    playSound("swing-heavy"); playSound("hit", { delay: 220 });
    if (res.over) playSound("ui-success", { delay: 650 });
    // На сцене (PLAN 4.207): потери и бегство — всплывающим текстом над жетонами
    const scene = this.field ? game.scenes.get(this.field.scene) : null;
    if (scene) for (const u of res.units) {
      const tok = scene.tokens.find(t => t.actor?.id === u.id);
      if (tok && (u.lost || u.routed)) floatText(scene, tok, u.routed ? `−${u.lost} · бегут!` : `−${u.lost}`);
    }
    // Опыт (PLAN 4.198): каждому сражавшемуся — за раунд, победителям битвы — за победу
    await Actor.updateDocuments(res.units.map(u => ({ _id: u.id, "system.soldiers": u.soldiers, "system.morale": u.morale, "system.routed": u.routed,
      "system.xp": (game.actors.get(u.id)?.system.xp ?? 0) + (u.xp ?? 0) })));
    for (const u of res.units) if (u.lost) this.lost[u.id] = (this.lost[u.id] ?? 0) + u.lost;
    const healed = res.over ? await this.#heal() : [];
    const name = i => actors[i].map(a => a.name).join(", ");
    const entry = {
      round: this.roundNo, terrain: TERRAIN[this.terrain].label,
      sides: res.rolls.map((r, i) => ({ name: name(i), d10: r.d10, power: r.power, ground: r.ground, fort: r.fort, total: r.total, win: res.winner === i })),
      healed, notes: fieldNotes,
      units: res.units.filter(u => u.lost || u.routed).map(u => ({ name: u.name, lost: u.lost, soldiers: u.soldiers, morale: u.morale, routed: u.routed })),
      tie: res.winner === null, over: res.over, victor: res.over && res.victor !== null ? name(res.victor) : ""
    };
    this.log.push(entry);
    await postCard({ template: "systems/vedmak/templates/chat/battle-round.hbs", data: entry, speaker: ChatMessage.getSpeaker({ alias: "Битва" }) });
    this.roundNo += 1;
    this.render();
  }
}
