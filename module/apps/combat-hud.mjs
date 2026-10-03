// Худ персонажа (PLAN 4.58, холст design/11): пульт внизу экрана. Слева — портрет и показатели (ПЗ, Вын, Токсичность,
// Энергия раунда, Удача), в центре — вкладки «Бой», «Магия», «Алхимия», «Действия», «Состояния», справа — раунд,
// кто дальше и «Конец хода». В бою: игроку — его персонаж, мастеру — выделенный токен или тот, чей ход. Вне боя —
// актор выделенного своего токена (настройка клиента «Худ вне боя»): зелья и знаки нужны не только в бою.

import { SYSTEM_ID } from "../util.mjs";
import { SKILLS } from "../config/skills.mjs";
import { STATUS_EFFECTS, STATUS_HINTS } from "../combat/statuses.mjs";
import { attackSources } from "../combat/attack.mjs";
import { manualDamage, restTurn } from "../combat/manual.mjs";
import { controlCheck } from "../combat/mounted.mjs";
import { MOUNTS } from "../config/combat.mjs";
import { verbalAction, VERBAL_GROUPS } from "../combat/verbal.mjs";
import { castSpell, vigorUsed, maintainedSpells } from "../magic/cast.mjs";
import { endMaintained } from "../magic/effects.mjs";
import { useAlchemical } from "../crafting/alchemy.mjs";
import { ALCHEMY_ACTIONS } from "../config/crafting.mjs";
import { flipToken, canFlip } from "./token-flip.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TABS = [
  { id: "fight", label: "Бой" }, { id: "magic", label: "Магия" }, { id: "alchemy", label: "Алхимия" },
  { id: "actions", label: "Действия" }, { id: "states", label: "Состояния" }
];
/** Цвет кнопки алхимии по действию: выпить и применить — фиолет, масло — зелень, бросок и ловушка — киноварь. */
const ALCH_GO = { drink: "violet", apply: "violet", mutagen: "violet", oil: "green", throw: "", trap: "" };
/** Словесные действия на худе — самые ходовые; остальные — на вкладке «Социальный бой» листа. */
const VERBAL_QUICK = ["persuade", "seduce", "deceive", "intimidate", "ignore", "changeSubject"];

export class CombatHud extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "vedmak-combat-hud",
    classes: ["vedmak", "vedmak-hud"],
    window: { frame: false, positioned: false },
    actions: {
      openSheet: CombatHud.#onOpenSheet,
      setTab: CombatHud.#onSetTab,
      attack: CombatHud.#onAttack,
      rollSkill: CombatHud.#onRollSkill,
      castSpell: CombatHud.#onCastSpell,
      endMaintained: CombatHud.#onEndMaintained,
      useAlchemical: CombatHud.#onUseAlchemical,
      restTurn: CombatHud.#onRestTurn,
      manualDamage: CombatHud.#onManualDamage,
      controlCheck: CombatHud.#onControlCheck,
      ram: CombatHud.#onRam,
      flipToken: CombatHud.#onFlipToken,
      verbal: CombatHud.#onVerbal,
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

  /** Вкладка худа — одна на клиента, переживает перерисовки. */
  tab = "fight";

  /** Актор, чьи кнопки показывать. */
  static actorFor() {
    const controlled = canvas?.tokens?.controlled?.[0]?.actor ?? null;
    if (!game.combat?.started) {
      let outside = true;
      try { outside = game.settings.get(SYSTEM_ID, "hudOutOfCombat"); } catch { /* до регистрации */ }
      return outside && controlled?.isOwner ? controlled : null;
    }
    const current = game.combat.combatant?.actor ?? null;
    if (game.user.isGM) return controlled ?? current;
    // Игроку нужен свой лист и на чужом ходу — он защищается
    if (controlled?.isOwner) return controlled;
    if (game.user.character?.isOwner) return game.user.character;
    return current?.isOwner ? current : null;
  }

  /** Показать, спрятать или перерисовать худ по текущему состоянию. */
  static refresh() {
    if (!game.ready) return;
    let enabled = true;
    try { enabled = game.settings.get(SYSTEM_ID, "combatHud"); } catch { /* до регистрации настроек */ }
    const hud = CombatHud.instance;
    const actor = enabled ? CombatHud.actorFor() : null;
    if (!actor) {
      // Элемент живёт не в body, а в нижней панели: убираем его сами, чтобы полоса не осталась висеть
      const el = document.getElementById(CombatHud.DEFAULT_OPTIONS.id);
      // Без анимации: закрытие с ней ждёт кадров, а в фоновой вкладке их нет — полоса оставалась висеть
      if (hud.rendered) hud.close({ animate: false }).finally(() => el?.remove());
      else el?.remove();
      return;
    }
    hud.render({ force: true });
  }

  /**
   * Перерисовать, если изменился показанный сейчас актор, его предмет или эффект — и эффект на предмете:
   * у него родитель — предмет, а актор — родитель предмета, поэтому актор ищется вверх по родителям.
   */
  static refreshFor(doc) {
    let actor = doc;
    while (actor && actor.documentName !== "Actor") actor = actor.parent;
    if (!CombatHud.#instance?.rendered) return;
    if (!actor) return;
    if (CombatHud.#instance.actor && actor.id !== CombatHud.#instance.actor.id) return;
    CombatHud.schedule();
  }

  static #timer = null;

  /** Перерисовать одним разом после пачки изменений (удар — это ПЗ, эффект состояния и смена хода). */
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

  /** Навык из поля поиска: Enter или выбор из подсказок — бросок. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const input = this.element.querySelector("input.vh-skill");
    if (!input || input.dataset.bound) return;
    input.dataset.bound = "1";
    const roll = event => {
      const label = input.value.trim().toLowerCase();
      if (!label || !this.actor) return;
      const key = Object.entries(SKILLS).find(([, s]) => s.label.toLowerCase() === label)?.[0]
        ?? Object.entries(SKILLS).find(([, s]) => s.label.toLowerCase().startsWith(label))?.[0];
      if (!key || !this.actor.system.skills?.[key]) return ui.notifications.warn(`Навык «${input.value}» не найден.`);
      input.value = "";
      this.actor.rollSkill(key, { skipDialog: event.shiftKey });
    };
    input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); roll(event); } });
    input.addEventListener("change", roll);
  }

  async _prepareContext(options) {
    const actor = this.actor = CombatHud.actorFor();
    const context = await super._prepareContext(options);
    if (!actor) return context;
    const system = actor.system;
    const d = system.derived;
    const combat = game.combat?.started ? game.combat : null;
    const isCurrent = combat?.combatant?.actor?.id === actor.id;
    const pct = (v, m) => (m > 0 ? Math.max(0, Math.min(100, Math.round((v / m) * 100))) : 0);
    const isCharacter = actor.type === "character";

    const vitals = [
      { key: "hp", label: "пз", value: system.hp.value, max: system.hp.max, pct: pct(system.hp.value, system.hp.max),
        notch: pct(d.woundThreshold, system.hp.max), bad: system.hp.value <= 0, hint: `Порог ранения ${d.woundThreshold}` },
      { key: "sta", label: "вын", value: system.sta.value, max: system.sta.max, pct: pct(system.sta.value, system.sta.max),
        hint: `Отдых восстанавливает ${d.rec}` }
    ];
    if (system.toxicity) vitals.push({
      key: "tox", label: "токс", value: system.toxicity.total, max: system.toxicity.max, suffix: "%",
      pct: pct(system.toxicity.total, system.toxicity.max), hint: `Токсичность ${system.toxicity.total}% из ${system.toxicity.max}%`
    });
    const vigor = d.vigor ?? 0;
    const used = vigor ? vigorUsed(actor).used : 0;
    const energy = Array.from({ length: Math.min(vigor, 10) }, (_, k) => ({ on: k < Math.max(0, vigor - used) }));
    const luck = isCharacter ? Array.from({ length: Math.min(system.luck?.max ?? 0, 12) }, (_, k) => ({ on: k < (system.luck?.value ?? 0) })) : [];

    // Бой: чем бить (только то, что в руках — см. isReadyWeapon), защиты, испытания
    const attacks = attackSources(actor).map(src => ({
      kind: src.kind, itemId: src.item?.id ?? "", label: src.label, img: src.img,
      base: system.skills[src.skill].base + (src.accuracy || 0),
      damage: src.kind === "unarmed" ? `${d.punch} / ${d.kick}` : src.weapon.damage,
      sub: [SKILLS[src.skill]?.label, src.item?.system.activeOil ? `масло: ${src.item.system.activeOil.name}` : "", src.isRanged ? `дистанция ${src.weapon.range}` : ""].filter(Boolean).join(" · "),
      isRanged: !!src.isRanged
    }));
    const defenses = ["dodge", "athletics", "brawling", "melee"].map(key => ({ key, label: SKILLS[key].label.split("/")[0], base: system.skills[key].base }));
    const deathThreshold = (d.stun ?? 0) - (system.deathSaves?.penalty ?? 0);

    // Магия: всё, что есть, знаки — первыми; поддерживаемое — с кнопкой «снять»
    const order = { sign: 0, spell: 1, invocation: 2, ritual: 3, hex: 4, gift: 5 };
    const spells = actor.itemTypes.spell.slice().sort((a, b) => (order[a.system.kind] ?? 9) - (order[b.system.kind] ?? 9))
      .map(i => ({
        id: i.id, name: i.name, img: i.img, sign: i.system.kind === "sign",
        cost: i.system.variableCost ? "1+ вын" : `${i.system.staCost ?? 0} вын`
      }));
    const maintained = maintainedSpells(actor).map(e => ({ id: e.id, name: e.name, img: e.img, cost: e.flags.vedmak.maintain.cost }));

    // Алхимия: всё, чем можно воспользоваться сейчас
    const alchemy = (actor.itemTypes.alchemical ?? [])
      .filter(i => i.system.quantity > 0 && i.system.use?.action && !(i.system.isMutagen && i.system.applied) && !i.system.applied)
      .map(i => {
        const action = i.system.use.action;
        return {
          id: i.id, name: i.name, img: i.img, quantity: i.system.quantity,
          note: [i.system.toxicity ? `токс. ${i.system.toxicity}%` : "", i.system.duration].filter(Boolean).join(" · "),
          actionLabel: ALCHEMY_ACTIONS[action] ?? "Применить", go: ALCH_GO[action] ?? "violet",
          hint: i.system.effect ?? ""
        };
      });

    // Действия: словесная дуэль — ходовые атаки и защиты
    const verbal = VERBAL_GROUPS.flatMap(g => g.actions).filter(a => VERBAL_QUICK.includes(a.key))
      .map(a => ({ key: a.key, label: a.label, base: system.skills?.[a.skill]?.base ?? 0 }));
    const token = actor.token ?? canvas?.tokens?.controlled?.find(t => t.actor?.id === actor.id)?.document ?? null;

    // Состояния: что действует (эффекты со сроком и состояния) и сетка всех состояний
    const effects = actor.appliedEffects.filter(e => e.isTemporary || e.statuses.size).map(e => ({
      name: e.name, img: e.img,
      left: e.flags?.vedmak?.timed?.rounds ? `${e.flags.vedmak.timed.rounds} р.` : (e.isTemporary ? e.duration.label : ""),
      bad: [...e.statuses].some(s => ["bleeding", "poisoned", "burning", "dying", "staggered", "stunned"].includes(s))
    }));
    const statusList = STATUS_EFFECTS.map(s => ({ id: s.id, name: s.name, img: s.img, on: actor.statuses.has(s.id), hint: STATUS_HINTS[s.id] ?? s.name }));

    const counts = { magic: spells.length, alchemy: alchemy.length, states: effects.length };
    const tabs = TABS.filter(t => !(t.id === "magic" && !spells.length && !maintained.length)
      && !(t.id === "alchemy" && !alchemy.length && !isCharacter))
      .map(t => ({ ...t, active: t.id === this.tab, count: counts[t.id] || "" }));
    if (!tabs.some(t => t.active)) { this.tab = "fight"; tabs[0].active = true; }

    // Кто дальше: как в Foundry — поверженных пропускаем, если так настроено в трекере
    const turns = combat?.turns ?? [];
    let next = null;
    for (let k = 1; combat && k <= turns.length; k++) {
      const c = turns[(combat.turn + k) % turns.length];
      if (c && !(combat.settings?.skipDefeated && c.isDefeated)) { next = c; break; }
    }
    return Object.assign(context, {
      actor, vitals, energy, luck, tabs, tab: this.tab,
      energyMax: vigor, energyLeft: Math.max(0, vigor - used), tox: vitals.find(v => v.key === "tox") ?? null,
      showFight: this.tab === "fight", showMagic: this.tab === "magic", showAlchemy: this.tab === "alchemy",
      showActions: this.tab === "actions", showStates: this.tab === "states",
      attacks, defenses, stun: d.stun, deathThreshold, dying: d.dying,
      spells, maintained, shield: system.shield?.value ?? 0,
      alchemy, verbal, canFlip: !!token && token.isOwner && canFlip(token), rec: d.rec,
      adrenalineRule: (() => { try { return game.settings.get(SYSTEM_ID, "adrenaline") && isCharacter; } catch { return false; } })(),
      adrenaline: system.adrenaline?.value ?? 0,
      skillOptions: Object.entries(SKILLS).filter(([k]) => system.skills?.[k]).map(([, s]) => s.label),
      effects, statusList,
      collapsed: this.collapsed, isCurrent, isCharacter, inCombat: !!combat,
      round: combat?.round ?? 0, nextName: combat ? (next?.name ?? "—") : "",
      canAdvance: !!combat && (isCurrent || game.user.isGM)
    });
  }

  /* ------------------------------ Действия ------------------------------ */

  static #onOpenSheet() { this.actor?.sheet.render(true); }

  static async #onSetTab(event, target) {
    this.tab = target.dataset.tab;
    if (this.collapsed) await game.settings.set(SYSTEM_ID, "combatHudCollapsed", false);
    this.render();
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

  static async #onEndMaintained(event, target) {
    if (this.actor) await endMaintained(this.actor, target.dataset.effectId);
  }

  static async #onUseAlchemical(event, target) {
    const item = this.actor?.items.get(target.dataset.itemId);
    if (item) await useAlchemical(this.actor, item);
  }

  static async #onRestTurn() { if (this.actor) await restTurn(this.actor); }

  static async #onManualDamage() { if (this.actor) await manualDamage([this.actor]); }

  static async #onControlCheck() { if (this.actor) await controlCheck(this.actor); }

  /** Таран: выбрать скакуна или транспорт, затем обычное окно атаки (как на листе). */
  static async #onRam() {
    if (!this.actor) return;
    const options = Object.entries(MOUNTS).map(([k, m]) => `<option value="${k}">${m.label} (${m.ram})</option>`).join("");
    const key = await foundry.applications.api.DialogV2.wait({
      window: { title: "Таран" }, classes: ["vedmak", "vedmak-dialog"],
      content: `<div class="vedmak-roll-dialog"><div class="form-group"><label>Чем таранить</label><select name="mount">${options}</select></div></div>`,
      buttons: [{ action: "ok", label: "Далее", default: true, callback: (e, b) => b.form.elements.mount.value },
        { action: "cancel", label: "Отмена" }],
      rejectClose: false
    });
    if (!key || key === "cancel") return;
    await this.actor.attack({ kind: "ram", key }, { chargeMeters: 10 });
  }

  static async #onFlipToken() {
    const token = this.actor?.token ?? canvas.tokens.controlled.find(t => t.actor?.id === this.actor?.id)?.document;
    if (token) await flipToken(token);
  }

  static async #onVerbal(event, target) {
    if (this.actor) await verbalAction(this.actor, target.dataset.verbal, { skipDialog: event.shiftKey });
  }

  static async #onStunSave() { await this.actor?.rollStunSave(); }

  static async #onDeathSave() { await this.actor?.rollDeathSave(); }

  static async #onToggleStatus(event, target) { await this.actor?.toggleStatusEffect(target.dataset.status); }

  static async #onNextTurn() { await game.combat?.nextTurn(); }

  static async #onToggleCollapse() {
    await game.settings.set(SYSTEM_ID, "combatHudCollapsed", !this.collapsed);
    this.render();
  }
}
