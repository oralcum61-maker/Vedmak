// Окно битвы (PLAN 4.187): две стороны из отрядов, местность, кто обороняется; «Раунд» — бросок сил сторон
// (army/rules.mjs battleRound), потери и боевой дух — в отряды, итог — карточкой в чат. Окно — у ведущего; владельцы
// отрядов видят его у себя и жмут кнопки сами («Показать всем» — смотрят и остальные; apps/shared-view.mjs, PLAN 4.199).

import { TERRAIN, TRAINING, WEAPONS, ARMOR, UNIT_KINDS } from "../config/army.mjs";
import { unitState, battleRound } from "../army/rules.mjs";
import { postCard } from "../combat/common.mjs";
import { shareView, closeView, viewerContext, wireViewer, viewerClosed } from "./shared-view.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const rand = () => (CONFIG.Dice.randomUniform ?? Math.random)();

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
      showAll: BattleApp.#onShowAll
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
  terrain = "field";
  roundNo = 1;
  log = [];

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
    return {
      sides, round: this.roundNo, log: [...this.log].reverse(),
      terrains: Object.entries(TERRAIN).map(([k, t]) => ({ key: k, label: t.label, selected: k === this.terrain })),
      ready: sides.every(s => s.units.some(u => !u.routed && u.soldiers)), showAll: this.showAll
    };
  }

  /** Участники битвы — отряды обеих сторон. */
  get #units() { return this.sides.flatMap(s => s.ids).map(id => game.actors.get(id)).filter(Boolean); }

  _onRender(context, options) {
    super._onRender?.(context, options);
    if (this.viewer) return wireViewer(this);
    shareView("battle", this, { context, actors: this.#units, showAll: this.showAll });
    this.element.querySelector("select[name=terrain]")?.addEventListener("change", ev => { this.terrain = ev.target.value; });
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
    this.roundNo = 1; this.log = [];
    this.session = foundry.utils.randomID();
    this.render();
  }

  static async #onRound() {
    const actors = this.sides.map(s => s.ids.map(id => game.actors.get(id)).filter(Boolean));
    const sides = actors.map((list, i) => ({ defender: this.sides[i].defender, units: list.map(unitState) }));
    if (!sides.every(s => s.units.some(u => u.soldiers && !u.routed))) return ui.notifications.warn("На обеих сторонах нужны стоящие отряды.");
    const res = battleRound(sides, { round: this.roundNo, terrain: this.terrain, rand });
    // Опыт (PLAN 4.198): каждому сражавшемуся — за раунд, победителям битвы — за победу
    await Actor.updateDocuments(res.units.map(u => ({ _id: u.id, "system.soldiers": u.soldiers, "system.morale": u.morale, "system.routed": u.routed,
      "system.xp": (game.actors.get(u.id)?.system.xp ?? 0) + (u.xp ?? 0) })));
    const name = i => actors[i].map(a => a.name).join(", ");
    const entry = {
      round: this.roundNo, terrain: TERRAIN[this.terrain].label,
      sides: res.rolls.map((r, i) => ({ name: name(i), d10: r.d10, power: r.power, ground: r.ground, total: r.total, win: res.winner === i })),
      units: res.units.filter(u => u.lost || u.routed).map(u => ({ name: u.name, lost: u.lost, soldiers: u.soldiers, morale: u.morale, routed: u.routed })),
      tie: res.winner === null, over: res.over, victor: res.over && res.victor !== null ? name(res.victor) : ""
    };
    this.log.push(entry);
    await postCard({ template: "systems/vedmak/templates/chat/battle-round.hbs", data: entry, speaker: ChatMessage.getSpeaker({ alias: "Битва" }) });
    this.roundNo += 1;
    this.render();
  }
}
