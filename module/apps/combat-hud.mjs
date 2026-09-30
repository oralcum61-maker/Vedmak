// Боевой худ: полоса внизу экрана с показателями, атаками, защитами и быстрыми действиями.
// Показывается, пока идёт бой; игроку — его персонаж, мастеру — выделенный токен или тот, чей ход.

import { SYSTEM_ID } from "../util.mjs";
import { SKILLS } from "../config/skills.mjs";
import { STATUS_EFFECTS, STATUS_HINTS } from "../combat/statuses.mjs";
import { attackSources } from "../combat/attack.mjs";
import { manualDamage, restTurn } from "../combat/manual.mjs";
import { castSpell } from "../magic/cast.mjs";
import { useAlchemical } from "../crafting/alchemy.mjs";
import { ALCHEMY_ACTIONS } from "../config/crafting.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Сколько кнопок показывать в строке, прежде чем прятать остальное под прокрутку. */
const SPELL_LIMIT = 10;
const ALCHEMY_LIMIT = 8;

export class CombatHud extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "vedmak-combat-hud",
    classes: ["vedmak", "vedmak-hud"],
    window: { frame: false, positioned: false },
    actions: {
      openSheet: CombatHud.#onOpenSheet,
      attack: CombatHud.#onAttack,
      rollSkill: CombatHud.#onRollSkill,
      castSpell: CombatHud.#onCastSpell,
      useAlchemical: CombatHud.#onUseAlchemical,
      restTurn: CombatHud.#onRestTurn,
      manualDamage: CombatHud.#onManualDamage,
      stunSave: CombatHud.#onStunSave,
      deathSave: CombatHud.#onDeathSave,
      toggleStatus: CombatHud.#onToggleStatus,
      nextTurn: CombatHud.#onNextTurn,
      toggleCollapse: CombatHud.#onToggleCollapse
    }
  };

  static PARTS = {
    hud: { template: "systems/vedmak/templates/hud/combat-hud.hbs" }
  };

  static #instance = null;

  static get instance() {
    return CombatHud.#instance ??= new CombatHud();
  }

  /** Актор, чьи кнопки показывать. */
  static actorFor() {
    if (!game.combat?.started) return null;
    const current = game.combat.combatant?.actor ?? null;
    const controlled = canvas?.tokens?.controlled?.[0]?.actor ?? null;
    if (game.user.isGM) return controlled ?? current;
    // Игроку нужен свой лист и на чужом ходу — он защищается
    if (controlled?.isOwner) return controlled;
    if (game.user.character?.isOwner) return game.user.character;
    return current?.isOwner ? current : null;
  }

  /** Показать, спрятать или перерисовать худ по текущему состоянию боя. */
  static refresh() {
    if (!game.ready) return;
    let enabled = true;
    try { enabled = game.settings.get(SYSTEM_ID, "combatHud"); } catch { /* до регистрации настроек */ }
    const hud = CombatHud.instance;
    const actor = enabled ? CombatHud.actorFor() : null;
    if (!actor) {
      // Элемент живёт не в body, а в нижней панели: убираем его сами, чтобы полоса не осталась висеть
      const el = document.getElementById(CombatHud.DEFAULT_OPTIONS.id);
      if (hud.rendered) hud.close().finally(() => el?.remove());
      else el?.remove();
      return;
    }
    hud.render({ force: true });
  }

  /** Перерисовать, если изменился показанный сейчас актор (или его предмет). */
  static refreshFor(doc) {
    const actor = doc?.documentName === "Actor" ? doc : doc?.parent;
    if (!CombatHud.#instance?.rendered) return;
    if (actor && CombatHud.#instance.actor && actor.id !== CombatHud.#instance.actor.id) return;
    CombatHud.schedule();
  }

  static #timer = null;

  /**
   * Перерисовать одним разом после пачки изменений. Один удар — это обновление ПЗ, эффект состояния
   * и смена хода; раньше худ перестраивался на каждое из них. Заодно хуки боя срабатывают до того,
   * как game.combat обновится, — к моменту перерисовки состояние уже новое.
   */
  static schedule(delay = 50) {
    clearTimeout(CombatHud.#timer);
    CombatHud.#timer = setTimeout(() => {
      CombatHud.#timer = null;
      CombatHud.refresh();
    }, delay);
  }

  static registerHooks() {
    const refresh = () => CombatHud.schedule();
    for (const hook of ["ready", "createCombat", "deleteCombat", "updateCombat", "createCombatant",
      "deleteCombatant", "updateCombatant", "controlToken"]) Hooks.on(hook, refresh);
    for (const hook of ["updateActor", "createItem", "updateItem", "deleteItem",
      "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) Hooks.on(hook, doc => CombatHud.refreshFor(doc));
  }

  /** Актор, показанный в последней отрисовке. */
  actor = null;

  get collapsed() {
    try { return !!game.settings.get(SYSTEM_ID, "combatHudCollapsed"); } catch { return false; }
  }

  /** Худ живёт в нижней панели интерфейса, над макросами. */
  _insertElement(element) {
    const bottom = document.getElementById("ui-bottom");
    const hotbar = document.getElementById("hotbar");
    if (hotbar?.parentElement === bottom) bottom.insertBefore(element, hotbar);
    else if (bottom) bottom.prepend(element);
    else document.body.append(element);
    return element;
  }

  async _prepareContext(options) {
    const actor = this.actor = CombatHud.actorFor();
    const context = await super._prepareContext(options);
    if (!actor) return context;
    const system = actor.system;
    const d = system.derived;
    const combat = game.combat;
    const isCurrent = combat?.combatant?.actor?.id === actor.id;
    const pct = (v, m) => (m > 0 ? Math.max(0, Math.min(100, Math.round((v / m) * 100))) : 0);

    const vitals = [
      { key: "hp", label: "ПЗ", value: system.hp.value, max: system.hp.max, pct: pct(system.hp.value, system.hp.max),
        notch: pct(d.woundThreshold, system.hp.max), state: d.dying ? "dying" : d.wounded ? "wounded" : "",
        hint: `Порог ранения ${d.woundThreshold}` },
      { key: "sta", label: "Вын", value: system.sta.value, max: system.sta.max, pct: pct(system.sta.value, system.sta.max),
        hint: `Отдых восстанавливает ${d.rec}` }
    ];
    if (system.toxicity) vitals.push({
      key: "tox", label: "Токс", value: system.toxicity.total, max: system.toxicity.max, suffix: "%",
      pct: pct(system.toxicity.value, system.toxicity.max), extraPct: pct(system.toxicity.active, system.toxicity.max),
      state: system.toxicity.over ? "over" : "", hint: `Токсичность ${system.toxicity.total}% из ${system.toxicity.max}%`
    });

    // Персонаж бьёт тем, что в руках; у чудовища когти и клыки никто «не экипирует»
    const sources = attackSources(actor);
    const equipped = sources.filter(src => src.kind !== "weapon" || src.item?.system.equipped);
    const attacks = (actor.type === "monster" || equipped.length < 2 ? sources : equipped)
      .map(src => ({
        kind: src.kind, itemId: src.item?.id ?? "", label: src.label, img: src.img,
        base: system.skills[src.skill].base + (src.accuracy || 0),
        damage: src.kind === "unarmed" ? `${d.punch} / ${d.kick}` : src.weapon.damage,
        range: src.isRanged ? src.weapon.range : ""
      }));

    const defenses = ["dodge", "athletics", "brawling", "melee"].map(key => ({
      key, label: SKILLS[key].label, base: system.skills[key].base
    }));

    const spells = actor.itemTypes.spell.slice(0, SPELL_LIMIT).map(i => ({
      id: i.id, name: i.name, img: i.img, kind: i.system.kind,
      cost: i.system.variableCost ? "1+" : i.system.staCost
    }));

    const alchemy = (actor.itemTypes.alchemical ?? [])
      .filter(i => i.system.quantity > 0 && i.system.use?.action && !i.system.applied
        && ["drink", "apply", "throw", "trap"].includes(i.system.use.action))
      .slice(0, ALCHEMY_LIMIT)
      .map(i => ({
        id: i.id, name: i.name, img: i.img, quantity: i.system.quantity,
        hint: `${ALCHEMY_ACTIONS[i.system.use.action] ?? ""}${i.system.toxicity ? ` · ${i.system.toxicity}%` : ""}${i.system.effect ? ` — ${i.system.effect}` : ""}`
      }));

    const statuses = STATUS_EFFECTS.filter(s => actor.statuses.has(s.id))
      .map(s => ({ id: s.id, name: s.name, img: s.img, hint: STATUS_HINTS[s.id] ?? s.name }));

    return Object.assign(context, {
      actor, system, vitals, attacks, defenses, spells, alchemy, statuses,
      collapsed: this.collapsed,
      isCurrent,
      isCharacter: actor.type === "character",
      round: combat?.round ?? 0,
      turnName: combat?.combatant?.name ?? "—",
      canAdvance: isCurrent || game.user.isGM,
      stun: d.stun,
      encumbrance: d.encumbrance,
      shield: system.shield?.value ?? 0,
      adrenaline: system.adrenaline?.value ?? 0,
      adrenalineRule: (() => { try { return game.settings.get(SYSTEM_ID, "adrenaline") && actor.type === "character"; } catch { return false; } })(),
      dying: d.dying
    });
  }

  /* ------------------------------ Действия ------------------------------ */

  static #onOpenSheet() {
    this.actor?.sheet.render(true);
  }

  static async #onAttack(event, target) {
    await this.actor?.attack({ kind: target.dataset.kind, itemId: target.dataset.itemId }, { skipDialog: event.shiftKey });
  }

  static async #onRollSkill(event, target) {
    await this.actor?.rollSkill(target.dataset.skill, { skipDialog: event.shiftKey });
  }

  static async #onCastSpell(event, target) {
    const item = this.actor?.items.get(target.dataset.itemId);
    if (item) await castSpell(this.actor, item, { skipDialog: event.shiftKey });
  }

  static async #onUseAlchemical(event, target) {
    const item = this.actor?.items.get(target.dataset.itemId);
    if (item) await useAlchemical(this.actor, item);
  }

  static async #onRestTurn() {
    if (this.actor) await restTurn(this.actor);
  }

  static async #onManualDamage() {
    if (this.actor) await manualDamage([this.actor]);
  }

  static async #onStunSave() {
    await this.actor?.rollStunSave();
  }

  static async #onDeathSave() {
    await this.actor?.rollDeathSave();
  }

  static async #onToggleStatus(event, target) {
    await this.actor?.toggleStatusEffect(target.dataset.status);
  }

  static async #onNextTurn() {
    await game.combat?.nextTurn();
  }

  static async #onToggleCollapse() {
    await game.settings.set(SYSTEM_ID, "combatHudCollapsed", !this.collapsed);
    this.render();
  }
}
