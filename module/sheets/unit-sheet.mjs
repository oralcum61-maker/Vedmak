// Лист отряда (PLAN 4.187): род войск, откуда набран, родное поселение; пластины — бойцы, выучка (тренировка), снаряжение
// (снарядить со склада поселения), боевой дух, сила; командир (перетащить персонажа), содержание, снаряжение по уровням.
// Облик — общий с листом поселения (styles/settlement.css), своё — styles/army.css.

import { UNIT_KINDS, TRAINING, EQUIPMENT, ORIGINS, MAX_EQUIPMENT, MAX_TRAINING, MORALE_MAX, ROUT_AT } from "../config/army.mjs";
import { equipCost } from "../army/rules.mjs";
import * as ARMY from "../army/army.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

export class UnitSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["vedmak", "sheet", "actor", "settlement", "unit"],
    position: { width: 820, height: 760 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      equip: UnitSheet.#onEquip,
      drill: UnitSheet.#onDrill,
      disband: UnitSheet.#onDisband,
      clearCommander: UnitSheet.#onClearCommander,
      openActor: UnitSheet.#onOpenActor,
      battle: UnitSheet.#onBattle
    }
  };

  static PARTS = {
    body: { template: "systems/vedmak/templates/actor/unit-sheet.hbs", scrollable: [".sv-scroll"] }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    const kind = UNIT_KINDS[sys.kind] ?? UNIT_KINDS.infantry;
    const home = sys.settlementActor;
    const cmd = sys.commanderActor;
    const tr = TRAINING[sys.training];
    const next = sys.equipment < MAX_EQUIPMENT ? sys.equipment + 1 : null;
    const nextCost = next ? equipCost(sys.kind, sys.equipment, next, sys.soldiers) : [];
    const stock = home?.system.stockMap ?? {};
    const tiers = EQUIPMENT.map((e, i) => ({
      label: e.label, power: e.power, on: i <= sys.equipment, current: i === sys.equipment,
      gear: i ? (kind.gear[i - 1] ?? []).map(g => `${g.resource} ${g.qty}`).join(", ") + " на бойца" : "ничего"
    }));
    Object.assign(context, {
      actor, sys, systemFields: sys.schema.fields, gm: game.user.isGM, editable: this.isEditable,
      kind: { ...kind, key: sys.kind }, kinds: Object.entries(UNIT_KINDS).map(([k, v]) => ({ key: k, label: v.label, selected: k === sys.kind })),
      origin: ORIGINS[sys.origin], home: home ? { uuid: home.uuid, name: home.name } : null,
      training: { label: tr.label, pips: TRAINING.map((t, i) => ({ on: i <= sys.training, label: t.label })),
        progress: sys.training < MAX_TRAINING ? `${sys.progress} из ${tr.weeks} нед.` : "выше некуда",
        canDrill: (home?.system.summary.drill ?? 0) > 0, drill: home?.system.summary.drill ?? 0 },
      equipment: { label: EQUIPMENT[sys.equipment].label, next: next ? EQUIPMENT[next].label : "",
        cost: nextCost.map(c => `${c.resource} ${c.qty}`).join(", "),
        ok: nextCost.every(c => (stock[c.resource] ?? 0) >= c.qty), tiers },
      morale: { value: sys.morale, max: MORALE_MAX, arc: Math.round((sys.morale / MORALE_MAX) * 360),
        tone: sys.morale >= 7 ? "high" : sys.morale > ROUT_AT + 2 ? "ok" : sys.morale > ROUT_AT ? "low" : "bad",
        note: sys.routed ? "бежали с поля" : sys.morale <= ROUT_AT ? "побегут при первой неудаче" : sys.morale >= 7 ? "рвутся в бой" : "держатся" },
      power: { total: sys.power.total, parts: sys.power.parts.map(p => `${p.label} ${p.value > 0 ? "+" : ""}${p.value}`).join(" · ") },
      commander: cmd ? { uuid: cmd.uuid, name: cmd.name, img: cmd.img, bonus: sys.commanderBonus } : null,
      upkeep: { food: sys.food, pay: sys.pay },
      enrichedDescription: await TextEditor.enrichHTML(sys.description, { relativeTo: actor, secrets: actor.isOwner })
    });
    return context;
  }

  /** Перетащенный персонаж — командир; отряд — ничего. */
  async _onDropActor(event, actor) {
    if (!this.isEditable) return null;
    if (actor.type !== "character") { ui.notifications.warn("Командиром может быть только персонаж."); return null; }
    await this.actor.update({ "system.commander": actor.uuid });
    return actor;
  }

  static async #onEquip() { await ARMY.equip(this.actor, this.actor.system.equipment + 1); }
  static async #onDrill() { await this.actor.update({ "system.drilling": !this.actor.system.drilling }); }
  static async #onDisband() { await ARMY.disband(this.actor); }
  static async #onClearCommander() { await this.actor.update({ "system.commander": "" }); }
  static async #onOpenActor(event, target) { (await fromUuid(target.dataset.uuid))?.sheet.render(true); }
  static async #onBattle() { game.vedmak.army.battle([this.actor]); }
}
