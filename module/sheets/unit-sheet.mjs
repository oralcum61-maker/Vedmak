// Лист отряда (PLAN 4.187, 4.198): род войск, откуда набран, родное поселение; пластины — бойцы, выучка (тренировка),
// опыт и звание, боевой дух, сила. Вкладки: «Отряд» — командир (перетащить персонажа), содержание, оружие и броня (две
// шкалы, снарядить со склада поселения); «Обучение» — ветки ступеней (как «Обустройство» построек: освоена, на плацу,
// доступна, закрыта; ведущий правит дерево); «Летопись». Облик — общий с листом поселения (styles/settlement.css),
// своё — styles/army.css.

import { UNIT_KINDS, TRAINING, GEAR, ORIGINS, MAX_GEAR, MAX_TRAINING, MORALE_MAX, TERRAIN } from "../config/army.mjs";
import { RANKS, UNIT_EFFECTS } from "../config/unit-upgrades.mjs";
import { resourceIcon } from "../config/settlement.mjs";
import { equipCost, routAt } from "../army/rules.mjs";
import * as ARMY from "../army/army.mjs";
import { patchFormArrays, treeAdd, treeDel } from "./upgrade-tree.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

const TABS = { unit: "Отряд", training: "Обучение", notes: "Летопись" };

/** Эффект ступени обучения подписью: «+1 к силе», «+2 против конницы», «−15% потерь». */
export function unitEffectLabel(e) {
  const v = Number(e.value) || 0;
  switch (e.type) {
    case "power": return `+${v} к силе`;
    case "vs": return `+${v} против: ${(UNIT_KINDS[e.kind]?.label ?? "?").toLowerCase()}`;
    case "terrain": return `+${v} на местности: ${(TERRAIN[e.terrain]?.label ?? "?").toLowerCase()}`;
    case "firstRound": return `+${v} в первом раунде`;
    case "defend": return `+${v} в обороне`;
    case "morale": return `боевой дух +${v}`;
    case "rout": return `бегут на ${v} позже`;
    case "losses": return `−${v}% потерь`;
    case "food": return `−${v}% еды`;
    case "pay": return `−${v}% платы`;
    case "drill": return `тренировка +${v}`;
    default: return `${UNIT_EFFECTS[e.type]?.label ?? e.type} ${v}`;
  }
}

export class UnitSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["vedmak", "sheet", "actor", "settlement", "unit"],
    position: { width: 860, height: 820 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      unitTab: UnitSheet.#onTab,
      equip: UnitSheet.#onEquip,
      drill: UnitSheet.#onDrill,
      disband: UnitSheet.#onDisband,
      clearCommander: UnitSheet.#onClearCommander,
      openActor: UnitSheet.#onOpenActor,
      battle: UnitSheet.#onBattle,
      train: UnitSheet.#onTrain,
      stopTraining: UnitSheet.#onStopTraining,
      grant: UnitSheet.#onGrant,
      treeEdit: UnitSheet.#onTreeEdit,
      treeAdd: UnitSheet.#onTreeAdd,
      treeDel: UnitSheet.#onTreeDel
    }
  };

  static PARTS = {
    body: { template: "systems/vedmak/templates/actor/unit-sheet.hbs", scrollable: [".sv-scroll"] }
  };

  tab = "unit";
  treeEdit = false;

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    const gm = game.user.isGM;
    const kind = UNIT_KINDS[sys.kind] ?? UNIT_KINDS.infantry;
    const home = sys.settlementActor;
    const cmd = sys.commanderActor;
    const tr = TRAINING[sys.training];
    const stock = home?.system.stockMap ?? {};
    const have = c => (stock[c.resource] ?? 0) >= c.qty;
    const rank = sys.rank ?? 0;
    const next = RANKS[rank + 1];

    // Оружие и броня — две шкалы
    const gear = Object.entries(GEAR).map(([track, g]) => {
      const level = sys[track];
      const up = level < MAX_GEAR ? level + 1 : null;
      const cost = up ? equipCost(sys.kind, track, level, up, sys.soldiers) : [];
      return {
        track, label: g.label, level, current: g.tiers[level].label,
        tiers: g.tiers.map((t, i) => ({ label: t.label, power: t.power, losses: t.losses ?? 0, on: i <= level, current: i === level,
          gear: i ? (kind.gear?.[track]?.[i - 1] ?? []).map(x => `${x.resource} ${x.qty}`).join(", ") + " на бойца" : "ничего" })),
        next: up ? g.tiers[up].label : "",
        cost: cost.map(c => ({ img: resourceIcon(c.resource), name: c.resource, qty: c.qty, short: !have(c) })),
        ok: !!home && cost.every(have)
      };
    });

    Object.assign(context, {
      actor, sys, systemFields: sys.schema.fields, gm, editable: this.isEditable, tab: this.tab,
      tabs: Object.entries(TABS).map(([id, label]) => ({ id, label, active: id === this.tab })),
      kind: { ...kind, key: sys.kind }, kinds: Object.entries(UNIT_KINDS).map(([k, v]) => ({ key: k, label: v.label, selected: k === sys.kind })),
      origin: ORIGINS[sys.origin], home: home ? { uuid: home.uuid, name: home.name } : null,
      training: { label: tr.label, pips: TRAINING.map((t, i) => ({ on: i <= sys.training, label: t.label })),
        progress: sys.training < MAX_TRAINING ? `${sys.progress} из ${tr.weeks} нед.` : "выше некуда",
        canDrill: (home?.system.summary.drill ?? 0) > 0, drill: home?.system.summary.drill ?? 0 },
      rank: { label: RANKS[rank].label, xp: sys.xp, next: next ? `${next.label} — с ${next.xp}` : "высшее звание",
        pct: next ? Math.round(((sys.xp - RANKS[rank].xp) / (next.xp - RANKS[rank].xp)) * 100) : 100,
        pips: RANKS.map((r, i) => ({ on: i <= rank, label: `${r.label} (${r.xp})` })) },
      gear,
      morale: { value: sys.morale, max: MORALE_MAX, arc: Math.round((sys.morale / MORALE_MAX) * 360),
        tone: sys.morale >= 7 ? "high" : sys.morale > routAt(sys) + 2 ? "ok" : sys.morale > routAt(sys) ? "low" : "bad",
        note: sys.routed ? "бежали с поля" : sys.morale <= routAt(sys) ? "побегут при первой неудаче" : sys.morale >= 7 ? "рвутся в бой" : "держатся" },
      power: { total: sys.power.total, parts: sys.power.parts.map(p => `${p.label} ${p.value > 0 ? "+" : ""}${p.value}`).join(" · ") },
      commander: cmd ? { uuid: cmd.uuid, name: cmd.name, img: cmd.img, bonus: sys.commanderBonus } : null,
      upkeep: { food: sys.food, pay: sys.pay },
      tree: this.#tree(home, have), treeEdit: gm && this.treeEdit,
      effectTypes: Object.fromEntries(Object.entries(UNIT_EFFECTS).map(([k, v]) => [k, v.label])),
      rankOptions: Object.fromEntries(RANKS.map((r, i) => [i, r.label])),
      weaponOptions: Object.fromEntries(GEAR.weapons.tiers.map((t, i) => [i, i ? t.label : "любое"])),
      armorOptions: Object.fromEntries(GEAR.armor.tiers.map((t, i) => [i, i ? t.label : "любая"])),
      kindOptions: Object.fromEntries(Object.entries(UNIT_KINDS).map(([k, v]) => [k, v.label])),
      terrainOptions: Object.fromEntries(Object.entries(TERRAIN).map(([k, v]) => [k, v.label])),
      resourceNames: [...new Set(Object.values(UNIT_KINDS).flatMap(k => Object.values(k.gear ?? {}).flat(2).map(x => x.resource))), "Еда", "Пиво", "Доски", "Железо", "Снадобья"],
      enrichedDescription: await TextEditor.enrichHTML(sys.description, { relativeTo: actor, secrets: actor.isOwner })
    });
    return context;
  }

  /** Ветки обучения: ступени с состоянием, требованиями, ценой значками, эффектами подписью; для правки — пути полей. */
  #tree(home, have) {
    const actor = this.actor;
    const sys = actor.system;
    const all = sys.branches.flatMap(br => br.nodes);
    return sys.branches.map((br, bi) => {
      const path = `system.branches.${bi}`;
      const nodes = br.nodes.map((nd, ni) => {
        const done = sys.upgrades.includes(nd.id);
        const working = sys.research.node === nd.id;
        const check = done || working ? null : ARMY.canTrain(actor, nd.id);
        const npath = `${path}.nodes.${ni}`;
        const needs = [nd.rank ? RANKS[nd.rank].label.toLowerCase() : "", nd.weapons ? `оружие: ${GEAR.weapons.tiers[nd.weapons].label.toLowerCase()}` : "",
          nd.armor ? `броня: ${GEAR.armor.tiers[nd.armor].label.toLowerCase()}` : ""].filter(Boolean).join(" · ");
        return {
          index: ni, id: nd.id, name: nd.name, description: nd.description, weeks: nd.weeks, path: npath, needs,
          rank: nd.rank, weapons: nd.weapons, armor: nd.armor,
          state: done ? "bought" : working ? "working" : check?.ok ? "open" : "locked", why: check?.ok ? "" : check?.why ?? "",
          progress: working ? { done: sys.research.progress, weeks: nd.weeks, pct: nd.weeks ? Math.round((sys.research.progress / nd.weeks) * 100) : 0,
            stalled: !sys.drilling || !(home?.system.summary.drill > 0) } : null,
          requires: nd.requires ? all.find(x => x.id === nd.requires)?.name ?? "" : "",
          cost: nd.cost.map((c, ci) => ({ index: ci, path: `${npath}.cost.${ci}`, resource: c.resource, qty: c.qty, img: resourceIcon(c.resource),
            short: !done && !working && !have(c) })),
          effects: nd.effects.map((e, ei) => ({ index: ei, path: `${npath}.effects.${ei}`, ...e, label: unitEffectLabel(e),
            vs: e.type === "vs", ter: e.type === "terrain", pct: UNIT_EFFECTS[e.type]?.kind === "pct" }))
        };
      });
      return { index: bi, id: br.id, name: br.name, icon: br.icon, path, nodes,
        done: nodes.filter(x => x.state === "bought").length, total: nodes.length };
    });
  }

  _processFormData(event, form, formData) {
    return patchFormArrays(super._processFormData(event, form, formData), this.actor._source.system, ["branches"]);
  }

  /** Перетащенный персонаж — командир; отряд — ничего. */
  async _onDropActor(event, actor) {
    if (!this.isEditable) return null;
    if (actor.type !== "character") { ui.notifications.warn("Командиром может быть только персонаж."); return null; }
    await this.actor.update({ "system.commander": actor.uuid });
    return actor;
  }

  static #onTab(event, target) { this.tab = target.dataset.tab; this.render(); }
  static async #onEquip(event, target) {
    const track = target.dataset.track;
    await ARMY.equip(this.actor, track, this.actor.system[track] + 1);
  }
  static async #onDrill() { await this.actor.update({ "system.drilling": !this.actor.system.drilling }); }
  static async #onDisband() { await ARMY.disband(this.actor); }
  static async #onClearCommander() { await this.actor.update({ "system.commander": "" }); }
  static async #onOpenActor(event, target) { (await fromUuid(target.dataset.uuid))?.sheet.render(true); }
  static async #onBattle() { game.vedmak.army.battle([this.actor]); }

  /* ------------------------------ Обучение ------------------------------ */

  static async #onTrain(event, target) { await ARMY.train(this.actor, target.closest("[data-node]").dataset.node); }
  static async #onStopTraining() { await ARMY.stopTraining(this.actor); }
  /** Ведущий: дать ступень даром или забрать. */
  static async #onGrant(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-node]").dataset.node;
    const ups = new Set(this.actor.system.upgrades);
    if (ups.has(id)) ups.delete(id); else ups.add(id);
    const update = { "system.upgrades": [...ups] };
    if (this.actor.system.research.node === id) update["system.research"] = { node: "", progress: 0 };
    await this.actor.update(update);
  }
  static #onTreeEdit() { this.treeEdit = !this.treeEdit; this.render(); }

  static async #onTreeAdd(event, target) {
    const sys = foundry.utils.deepClone(this.actor._source.system);
    treeAdd(sys, target.dataset.kind, target.dataset.path, {
      node: () => ({ name: "Новая ступень", description: "", rank: 0, weapons: 0, armor: 0, weeks: 1, cost: [], effects: [] }),
      effect: () => ({ type: "power", value: 1, kind: "", terrain: "" })
    });
    await this.actor.update({ "system.branches": sys.branches });
  }

  static async #onTreeDel(event, target) {
    const sys = foundry.utils.deepClone(this.actor._source.system);
    treeDel(sys, target.dataset.path, target.dataset.index);
    await this.actor.update({ "system.branches": sys.branches, "system.upgrades": sys.upgrades, "system.research": sys.research });
  }
}
