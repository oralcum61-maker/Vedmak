// Лист отряда (PLAN 4.187, 4.198): род войск, откуда набран, родное поселение; пластины — бойцы, выучка (тренировка),
// опыт и звание, боевой дух, сила. Вкладки: «Отряд» — командир (перетащить персонажа), содержание, оружие и броня (две
// шкалы, снарядить со склада поселения); «Обучение» — ветки ступеней (как «Обустройство» построек: освоена, на плацу,
// доступна, закрыта; ведущий правит дерево); «Летопись». Облик — общий с листом поселения (styles/settlement.css),
// своё — styles/army.css.

import { UNIT_KINDS, TRAINING, GEAR, ORIGINS, MAX_GEAR, MAX_TRAINING, MORALE_MAX, TERRAIN, armorDice } from "../config/army.mjs";
import { RANKS, UNIT_EFFECTS, unitEffectDice } from "../config/unit-upgrades.mjs";
import { resourceIcon } from "../config/settlement.mjs";
import { equipCost, routAt } from "../army/rules.mjs";
import * as ARMY from "../army/army.mjs";
import { patchFormArrays, treeAdd, treeDel } from "./upgrade-tree.mjs";
import { animateRealm } from "../fx/realm-fx.mjs";
import { once, refuse } from "../util.mjs";
import { realmPrompt } from "../apps/realm-dialog.mjs";

/** Значки ступеней снаряжения (24×24, контур): вилы → копьё → два копья → пика; рубаха → стёганка → кольчуга → латы. */
const SHIRT = "M8.5 4L4 7l2 3.2 2-1V20h8V9.2l2 1L20 7l-4.5-3c-.9 1.4-2 2-3.5 2s-2.6-.6-3.5-2z";
const TIER_ICONS = {
  weapons: ["M12 21V10M7 3v3.5a5 5 0 0 0 10 0V3M12 3v7", "M12 22V9M12 2l2.4 5.5h-4.8zM9.5 11h5",
    "M8.5 22V9M8.5 2l2 5.5h-4zM15.5 22V9M15.5 2l2 5.5h-4zM6.5 11h4M13.5 11h4", "M12 23V7M12 1l2 6h-4zM8 9.5h8M9.5 12.5h5"],
  armor: [SHIRT, SHIRT + "M9.5 11h5M9.5 14h5M9.5 17h5", SHIRT + "M9 10.5l6 6M15 10.5l-6 6M12 8.5v10",
    "M6 5h12v6c0 5-3 8-6 9-3-1-6-4-6-9zM12 5v15M6 9.5h12"]
};

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

const TABS = { unit: "Отряд", training: "Обучение", notes: "Летопись" };

/** Эффект ступени обучения подписью: «+1 к силе», «+2 против конницы», «1d3 бойцов выживает в раунд». */
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
    case "losses": return `${unitEffectDice(e)} бойцов выживает в раунд (по званию)`;
    case "food": return `${unitEffectDice(e)} бойцов едят даром (по званию)`;
    case "pay": return `${unitEffectDice(e)} наёмников служат даром (по званию)`;
    case "drill": return `тренировка +${v}`;
    default: return `${UNIT_EFFECTS[e.type]?.label ?? e.type} ${v}`;
  }
}

export class UnitSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["vedmak", "sheet", "actor", "settlement", "realm-sheet", "unit"],
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
      march: UnitSheet.#onMarch,
      returnHome: UnitSheet.#onReturnHome,
      besiege: UnitSheet.#onBesiege,
      liftSiege: UnitSheet.#onLiftSiege,
      train: UnitSheet.#onTrain,
      stopTraining: UnitSheet.#onStopTraining,
      grant: UnitSheet.#onGrant,
      treeEdit: UnitSheet.#onTreeEdit,
      treeAdd: UnitSheet.#onTreeAdd,
      treeDel: UnitSheet.#onTreeDel
    }
  };

  static PARTS = {
    body: { template: "systems/vedmak/templates/actor/unit-sheet.hbs", scrollable: [".rs-scroll"] }
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

    // Оружие и броня — две шкалы; у ступени значок, у следующей — полоса цены «хватает / не хватает» (макет, PLAN 4.230)
    const gear = Object.entries(GEAR).map(([track, g]) => {
      const level = sys[track];
      const up = level < MAX_GEAR ? level + 1 : null;
      const cost = up ? equipCost(sys.kind, track, level, up, sys.soldiers) : [];
      const short = cost.filter(c => !have(c));
      const costPct = cost.length ? Math.round(Math.min(...cost.map(c => Math.min(1, (stock[c.resource] ?? 0) / (c.qty || 1)))) * 100) : 100;
      const costText = !home ? "нет родного поселения" : !short.length ? "на складе хватает"
        : `не хватает: ${short.map(c => `${c.resource} ${Math.ceil(c.qty - (stock[c.resource] ?? 0))}`).join(", ")}`;
      return {
        track, label: g.label, level, current: g.tiers[level].label, costPct, costText,
        tiers: g.tiers.map((t, i) => ({ label: t.label, power: t.power, saves: track === "armor" ? armorDice(i, sys.soldiers) : 0, on: i <= level, current: i === level,
          isNext: i === up, icon: TIER_ICONS[track]?.[i] ?? "",
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
      training: { label: tr.label, lower: tr.label.toLowerCase(), roman: ["—", "I", "II", "III", "IV", "V"][sys.training] ?? String(sys.training), pips: TRAINING.map((t, i) => ({ on: i <= sys.training, label: t.label })),
        progress: sys.training < MAX_TRAINING ? `${sys.progress} из ${tr.weeks} нед.` : "выше некуда",
        canDrill: (home?.system.summary.drill ?? 0) > 0, drill: home?.system.summary.drill ?? 0 },
      rank: { label: RANKS[rank].label, lower: RANKS[rank].label.toLowerCase(), xp: sys.xp,
        next: next ? `до «${next.label.toLowerCase()}» ${next.xp - sys.xp}` : "высшее звание",
        pct: next ? Math.round(((sys.xp - RANKS[rank].xp) / (next.xp - RANKS[rank].xp)) * 100) : 100,
        arc: next ? Math.round(((sys.xp - RANKS[rank].xp) / (next.xp - RANKS[rank].xp)) * 360) : 360,
        list: RANKS.map((r, i) => ({ label: r.label, xp: r.xp, power: r.power, on: i < rank, now: i === rank })),
        pips: RANKS.map((r, i) => ({ on: i <= rank, label: `${r.label} (${r.xp})` })) },
      gear,
      morale: { value: sys.morale, max: MORALE_MAX, rout: routAt(sys), arc: Math.round((sys.morale / MORALE_MAX) * 360),
        tone: sys.morale >= 7 ? "high" : sys.morale > routAt(sys) + 2 ? "ok" : sys.morale > routAt(sys) ? "low" : "bad",
        note: sys.routed ? "бежали с поля" : sys.morale <= routAt(sys) ? "побегут при первой неудаче" : sys.morale >= 7 ? "рвутся в бой" : "держатся" },
      power: { total: sys.power.total, parts: sys.power.parts.map(p => `${p.label} ${p.value > 0 ? "+" : ""}${p.value}`).join(" · ") },
      commander: cmd ? { uuid: cmd.uuid, name: cmd.name, img: cmd.img, bonus: sys.commanderBonus } : null,
      upkeep: { food: sys.food, pay: sys.pay },
      campaign: { on: sys.campaign, supplies: sys.supplies, weeks: sys.food ? Math.floor(sys.supplies / sys.food) : 0,
        siege: sys.besieging ? fromUuidSync(sys.besieging)?.name ?? "?" : "" },
      ...(() => { const tree = this.#tree(home, have);
        return { tree, treeCols: Math.min(4, Math.max(1, tree.length)), treeDone: tree.reduce((n, b) => n + b.done, 0), treeTotal: tree.reduce((n, b) => n + b.total, 0) }; })(),
      treeEdit: gm && this.treeEdit,
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
            vs: e.type === "vs", ter: e.type === "terrain", dice: UNIT_EFFECTS[e.type]?.kind === "dice", diceFormula: unitEffectDice(e) }))
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

  /** Движение, как у листа персонажа (PLAN 4.212): вкладка проявляется, числа и шкалы — перетекают и вспыхивают. */
  _onRender(context, options) {
    super._onRender(context, options);
    animateRealm(this, this.element, this.actor.uuid, this.tab);
  }
  static async #onEquip(event, target) {
    const track = target.dataset.track;
    await once(this.actor, "equip", () => ARMY.equip(this.actor, track, this.actor.system[track] + 1));
  }
  static async #onDrill() { await this.actor.update({ "system.drilling": !this.actor.system.drilling }); }
  static async #onDisband() { await ARMY.disband(this.actor); }
  static async #onClearCommander() { await this.actor.update({ "system.commander": "" }); }
  static async #onOpenActor(event, target) { (await fromUuid(target.dataset.uuid))?.sheet.render(true); }
  static async #onBattle() { game.vedmak.army.battle([this.actor]); }

  /* ------------------------------ Поход (PLAN 4.203) ------------------------------ */

  static async #onMarch() {
    const weeks = await realmPrompt("march", { title: `В поход: ${this.actor.name}`, okLabel: "В поход",
      data: { food: this.actor.system.food }, read: form => form.elements.weeks.valueAsNumber });
    if (weeks !== null && weeks !== undefined) await ARMY.marchOut(this.actor, weeks);
  }
  static async #onReturnHome() { await ARMY.returnHome(this.actor); }
  static async #onBesiege() {
    const towns = game.actors.filter(a => a.type === "settlement" && a.uuid !== this.actor.system.settlement && a.visible);
    if (!towns.length) return refuse("Осаждать некого.");
    const uuid = await realmPrompt("siege", { title: `Осада: ${this.actor.name}`, okLabel: "Осадить",
      data: { towns: towns.map(t => ({ uuid: t.uuid, name: t.name })) }, read: form => form.elements.town.value });
    if (uuid) await ARMY.besiege(this.actor, fromUuidSync(uuid));
  }
  static async #onLiftSiege() { await ARMY.liftSiege(this.actor); }

  /* ------------------------------ Обучение ------------------------------ */

  static async #onTrain(event, target) { await once(this.actor, "train", () => ARMY.train(this.actor, target.closest("[data-node]").dataset.node)); }
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
      effect: () => ({ type: "power", value: 1, formula: "", kind: "", terrain: "" })
    });
    await this.actor.update({ "system.branches": sys.branches });
  }

  static async #onTreeDel(event, target) {
    const sys = foundry.utils.deepClone(this.actor._source.system);
    treeDel(sys, target.dataset.path, target.dataset.index);
    await this.actor.update({ "system.branches": sys.branches, "system.upgrades": sys.upgrades, "system.research": sys.research });
  }
}
