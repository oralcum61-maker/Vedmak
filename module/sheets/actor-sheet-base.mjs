// Общая основа листов актора: действия с предметами, эффектами и бросками.

import { DERIVED, SKILL_STATS, STATS } from "../config/stats.mjs";
import { SKILLS, skillsByStat } from "../config/skills.mjs";
import { CRIT_LEVELS, CRIT_STATES, CRIT_WOUNDS, HEALING_DAYS, LOCATIONS_HUMANOID, LOCATIONS_MONSTER } from "../config/combat.mjs";
import { attackSources } from "../combat/attack.mjs";
import { STATUS_EFFECTS, STATUS_HINTS } from "../combat/statuses.mjs";
import { manualDamage, restTurn, restDays } from "../combat/manual.mjs";
import { controlCheck } from "../combat/mounted.mjs";
import { MOUNTS } from "../config/combat.mjs";
import { levelLabel } from "../config/magic.mjs";
import { castSpell, vigorUsed, maintainedSpells } from "../magic/cast.mjs";
import { endMaintained } from "../magic/effects.mjs";
import { describeChanges } from "../config/effects.mjs";
import { currencies, toCrowns, coinWeightKg, coinWeightEnabled, formatRate } from "../config/money.mjs";
import { compareRu } from "../util.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

export class VedmakActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["vedmak", "sheet", "actor"],
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      rollSkill: VedmakActorSheet.#onRollSkill,
      rollStat: VedmakActorSheet.#onRollStat,
      itemCreate: VedmakActorSheet.#onItemCreate,
      itemEdit: VedmakActorSheet.#onItemEdit,
      itemDelete: VedmakActorSheet.#onItemDelete,
      itemToggleEquip: VedmakActorSheet.#onItemToggleEquip,
      itemPost: VedmakActorSheet.#onItemPost,
      effectCreate: VedmakActorSheet.#onEffectCreate,
      effectEdit: VedmakActorSheet.#onEffectEdit,
      effectDelete: VedmakActorSheet.#onEffectDelete,
      effectToggle: VedmakActorSheet.#onEffectToggle,
      toggleTrainedOnly: VedmakActorSheet.#onToggleTrainedOnly,
      attack: VedmakActorSheet.#onAttack,
      stunSave: VedmakActorSheet.#onStunSave,
      deathSave: VedmakActorSheet.#onDeathSave,
      toggleStatus: VedmakActorSheet.#onToggleStatus,
      critCreate: VedmakActorSheet.#onCritCreate,
      restTurn: VedmakActorSheet.#onRestTurn,
      restDays: VedmakActorSheet.#onRestDays,
      manualDamage: VedmakActorSheet.#onManualDamage,
      controlCheck: VedmakActorSheet.#onControlCheck,
      ram: VedmakActorSheet.#onRam,
      castSpell: VedmakActorSheet.#onCastSpell,
      endMaintained: VedmakActorSheet.#onEndMaintained
    }
  };

  /** Показывать только изученные навыки (состояние окна, не документа). */
  trainedOnly = false;

  /* ------------------------- Перерисовка видимого ------------------------- */

  /** Вкладки, которые изменились, пока были скрыты: дорисуются, когда их откроют. */
  #staleParts = new Set();

  /**
   * Повторная перерисовка без явного списка частей (изменился актор, его предмет или эффект, действие листа)
   * рисует только шапку, полосу вкладок и открытую вкладку. Остальные вкладки помечаются устаревшими:
   * раньше каждое изменение поля перестраивало все семь-девять вкладок, и лист подвисал на каждой правке.
   */
  _configureRenderOptions(options) {
    const firstRender = options.isFirstRender ?? !this.rendered;
    const lazy = !firstRender && !options.parts;
    super._configureRenderOptions(options);
    const parts = options.parts ??= Object.keys(this.constructor.PARTS);
    if (!lazy) {
      for (const p of parts) this.#staleParts.delete(p);
      return;
    }
    const tabIds = new Set(this.constructor.TABS?.primary?.tabs?.map(t => t.id) ?? []);
    const active = this.tabGroups.primary;
    if (!active) return;
    options.parts = parts.filter(p => {
      if (!tabIds.has(p) || p === active) {
        this.#staleParts.delete(p);
        return true;
      }
      this.#staleParts.add(p);
      return false;
    });
  }

  /** Открыли вкладку, которая менялась в скрытом виде, — дорисовать её. */
  changeTab(tab, group, options = {}) {
    super.changeTab(tab, group, options);
    if (group === "primary" && this.#staleParts.has(tab)) {
      this.#staleParts.delete(tab);
      this.render({ parts: [tab] });
    }
  }

  /** Какие слушатели уже висят на элементе: элементы вкладок, которые не перерисовывались, второй не получают. */
  #bound = new WeakMap();

  /**
   * Повесить слушатель на элементы листа по селектору — по одному разу на элемент.
   * @param {string} selector
   * @param {string} type — событие
   * @param {(event: Event, el: HTMLElement) => any} handler
   */
  _listen(selector, type, handler) {
    const key = `${type} ${selector}`;
    for (const el of this.element.querySelectorAll(selector)) {
      let keys = this.#bound.get(el);
      if (!keys) this.#bound.set(el, keys = new Set());
      if (keys.has(key)) continue;
      keys.add(key);
      el.addEventListener(type, event => handler(event, el));
    }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;
    Object.assign(context, {
      actor, system,
      systemFields: system.schema.fields,
      editable: this.isEditable,
      owner: actor.isOwner,
      isGM: game.user.isGM,
      config: CONFIG.VEDMAK,
      isCharacter: actor.type === "character",
      trainedOnly: this.trainedOnly
    });

    context.stats = Object.entries(system.stats).map(([key, s]) => ({ key, ...s, rollable: key !== "luck" }));

    // Навыки по параметрам
    const groups = skillsByStat();
    context.skillGroups = SKILL_STATS.map(stat => ({
      stat,
      label: STATS[stat].label,
      abbr: STATS[stat].abbr,
      value: system.stats[stat].effective,
      skills: groups[stat]
        .map(def => ({ ...def, ...system.skills[def.key], key: def.key }))
        .filter(s => !this.trainedOnly || s.trained || s.profession)
    }));
    context.hasSkills = context.skillGroups.some(g => g.skills.length);

    // Предметы по типам
    const byType = type => actor.itemTypes[type]?.slice().sort((a, b) => a.sort - b.sort) ?? [];
    context.items = {
      weapons: byType("weapon"),
      armor: byType("armor"),
      gear: byType("gear"),
      spells: byType("spell")
    };

    // Снаряжение по категориям книги; пустые категории не показываем
    const CATS = CONFIG.VEDMAK.GEAR_CATEGORIES ?? {};
    const line = item => ({
      id: item.id, name: item.name, img: item.img, system: item.system,
      total: Math.round((item.system.weight ?? 0) * (item.system.quantity ?? 1) * 10) / 10
    });
    const known = new Set(Object.keys(CATS));
    context.gearGroups = Object.entries(CATS).map(([key, label]) => ({
      key, label, items: context.items.gear.filter(i => (i.system.category || "general") === key).map(line)
    })).concat([{ key: "unknown", label: "Прочее",
      items: context.items.gear.filter(i => !known.has(i.system.category || "general")).map(line) }])
      .filter(g => g.items.length);

    // Полосы ПЗ, Вын и Токсичности в шапке
    const d = system.derived;
    const pct = (v, m) => (m > 0 ? Math.max(0, Math.min(100, Math.round((v / m) * 100))) : 0);
    context.vitals = [
      {
        key: "hp", label: "ПЗ", full: "ПЗ", name: "system.hp.value", value: system.hp.value, max: system.hp.max,
        pct: pct(system.hp.value, system.hp.max), notch: pct(d.woundThreshold, system.hp.max),
        state: d.dying ? "dying" : d.wounded ? "wounded" : "",
        hint: d.dying ? "При смерти: все параметры ⅓, нужны испытания против смерти"
          : `Порог ранения ${d.woundThreshold}: ниже него Реа, Лвк, Инт и Воля вдвое`
      },
      {
        key: "sta", label: "Вын", full: "ВЫНОСЛИВОСТЬ", name: "system.sta.value", value: system.sta.value, max: system.sta.max,
        pct: pct(system.sta.value, system.sta.max),
        hint: `Отдых восстанавливает ${d.rec} за ход`
      }
    ];
    if (system.toxicity) {
      const tox = system.toxicity;
      context.vitals.push({
        key: "tox", label: "Токс", full: "ТОКСИЧНОСТЬ", name: "system.toxicity.value", value: tox.value, max: tox.max, suffix: "%",
        notch: 50, notchHint: "Выше половины — дурнота",
        pct: pct(tox.value, tox.max), extraPct: pct(tox.active, tox.max), state: tox.over ? "over" : "",
        hint: tox.active ? `Своё ${tox.value}% + эликсиры и отвары ${tox.active}% = ${tox.total}% из ${tox.max}%`
          : `Сверх ${tox.max}% — отравление и испытание Стойкости`
      });
    }
    context.load = {
      carried: d.carried, enc: d.enc, liftMax: d.liftMax, overload: d.overload,
      pct: pct(d.carried, d.enc), over: d.carried > d.enc
    };
    // Кошелёк по валютам: итог в кронах и вес монет
    if (system.money) {
      context.purse = {
        rows: currencies().map(c => ({ ...c, main: c.key === "crowns", value: system.money[c.key] ?? 0, rateText: formatRate(c.rate) })),
        crowns: formatRate(toCrowns(system.money)),
        kg: formatRate(coinWeightKg(system.money)),
        weightOn: coinWeightEnabled()
      };
    }

    // Производные — порядок как на листе книги
    context.derived = [
      { key: "vigor", value: d.vigor },
      { key: "stun", value: d.stun },
      { key: "run", value: d.run, unit: "м" },
      { key: "leap", value: d.leap, unit: "м" },
      { key: "enc", value: d.enc, unit: "кг" },
      { key: "rec", value: d.rec },
      { key: "woundThreshold", value: d.woundThreshold },
      { key: "resolve", value: d.resolve }
    ].map(x => ({ ...DERIVED[x.key], ...x }));

    const LEVEL_ORDER = { novice: 0, journeyman: 1, master: 2, archPriest: 3 };
    context.spellGroups = Object.entries(CONFIG.VEDMAK.MAGIC_KINDS).map(([kind, label]) => ({
      kind, label,
      items: context.items.spells.filter(s => s.system.kind === kind)
        .sort((a, b) => (LEVEL_ORDER[a.system.level] - LEVEL_ORDER[b.system.level]) || compareRu(a.name, b.name))
        .map(item => ({
          id: item.id, name: item.name, img: item.img, system: item.system,
          levelLabel: levelLabel(kind, item.system.level),
          elementLabel: ["spell", "sign"].includes(kind) ? CONFIG.VEDMAK.MAGIC_ELEMENTS[item.system.element] : "",
          maintain: item.system.maintainMode ? (item.system.maintainMode === "half" ? "½" : "=") : item.system.maintainCost,
          castLabel: kind === "ritual" ? "Провести" : kind === "hex" ? "Навести" : "Сотворить"
        }))
    }));
    context.hasMagic = context.spellGroups.some(g => g.items.length);
    const skill = key => system.skills[key].base;
    context.magic = {
      used: vigorUsed(actor).used,
      casting: skill("spellCasting"), rituals: skill("ritualCrafting"), hexes: skill("hexWeaving"),
      maintained: maintainedSpells(actor).map(e => ({ id: e.id, name: e.name, img: e.img, cost: e.flags.vedmak.maintain.cost }))
    };

    // Бой
    context.attacks = attackSources(actor).map(src => {
      const skill = system.skills[src.skill];
      const rel = src.item?.system.reliability;
      const w = src.weapon ?? {};
      return {
        kind: src.kind, itemId: src.item?.id ?? "", label: src.label, img: src.img,
        skillLabel: SKILLS[src.skill]?.label ?? "", base: skill.base + (src.accuracy || 0),
        damage: src.kind === "unarmed" ? `${system.derived.punch} / ${system.derived.kick}` : w.damage,
        damageLabel: src.kind === "unarmed" ? "рука / нога" : "урон",
        // Естественное оружие (когти, клыки) не надевают — оно готово всегда
        equipped: src.item ? !!src.item.system.equipped || src.item.system.category === "natural" : true,
        reliability: rel, relPct: rel?.max ? Math.round((rel.value / rel.max) * 100) : 0,
        isRanged: src.isRanged,
        range: src.isRanged ? w.range : null,
        // Чем примечательно оружие: масло, серебро, свойства — одной строкой под названием
        oil: w.oil ? `масло: ${w.oil.target || w.oil.name}` : "",
        silver: w.silverDamage ? `серебро ${w.silverDamage}` : "",
        traits: (w.effects ?? []).map(e => {
          const cfg = CONFIG.VEDMAK.WEAPON_EFFECTS?.[e.key];
          return `${cfg?.label ?? e.key}${e.value ? ` ${e.value}` : ""}`;
        }).join(", "),
        nonLethal: !!w.nonLethal,
        attackSpeed: actor.type === "monster" && src.kind === "weapon" ? src.item.system.attackSpeed : null
      };
    });
    const DEFENSE_ABOUT = {
      dodge: "уйти с линии удара",
      athletics: "изменение позиции: шаг на ½ Скор",
      brawling: "блок рукой и приёмы",
      melee: "блок и парирование оружием"
    };
    context.defenses = ["dodge", "athletics", "brawling", "melee"].map(key => ({
      key, label: SKILLS[key].label, base: system.skills[key].base, about: DEFENSE_ABOUT[key] ?? ""
    }));
    const armorLocs = Object.values(system.derived.armor ?? {});
    // Шкала общая для всех частей: сразу видно, где в защите дыра
    const spScale = Math.max(10, ...armorLocs.map(l => l.sp || 0));
    context.armorLocations = armorLocs.map(loc => ({
      ...loc,
      pct: Math.round(((loc.sp || 0) / spScale) * 100),
      multLabel: loc.mult === 0.5 ? "×½" : `×${loc.mult}`,
      layerNames: loc.layers.map(l => `${l.name} ${l.value}/${l.max}`).join(", "),
      resistLabels: loc.resist.map(k => CONFIG.VEDMAK.DAMAGE_TYPES[k]?.label ?? k).join(", ")
    }));
    context.armorLayers = [...new Set(armorLocs.flatMap(l => l.layers.map(x => x.name)))].join(" · ");
    context.armorResists = [...new Set(armorLocs.flatMap(l => l.resist))]
      .map(k => CONFIG.VEDMAK.DAMAGE_TYPES[k]?.label ?? k).join(", ");
    context.shields = (system.derived.shields ?? []).map(i => ({
      id: i.id, name: i.name, img: i.img,
      reliability: `${i.system.reliability.value}/${i.system.reliability.max}`
    }));
    const locTable = system.derived.bodyType === "monster" ? LOCATIONS_MONSTER : LOCATIONS_HUMANOID;
    context.critWounds = (actor.itemTypes.critWound ?? []).map(item => {
      const cfg = item.system.config;
      const level = CRIT_LEVELS[item.system.level];
      return {
        id: item.id, name: item.name, img: item.img, state: item.system.state,
        levelKey: item.system.level, levelLabel: level?.label ?? "",
        locationLabel: (LOCATIONS_HUMANOID[item.system.location] ?? LOCATIONS_MONSTER[item.system.location])?.label ?? "",
        text: item.system.current.text, teeth: item.system.teeth, healingDays: item.system.healingDays,
        states: Object.entries(CRIT_STATES).map(([key, label]) => ({ key, label, selected: key === item.system.state })),
        hint: level ? `Стабилизация: Первая помощь СЛ ${level.stabilizeDC}. Лечение: Лечащее прикосновение СЛ ${level.treatDC} (${level.treatRounds} раунда) или ${level.magicCount} заклинаний СЛ ${level.magicDC}.` : "",
        unknown: !cfg
      };
    });
    context.statusList = STATUS_EFFECTS.map(s => {
      const hint = STATUS_HINTS[s.id] ?? s.name;
      return {
        id: s.id, name: s.name, img: s.img, active: actor.statuses.has(s.id), hint,
        // Чем состояние обходится — первая фраза подсказки, чтобы цена была видна без наведения
        cost: hint.split(". ")[0].replace(/\.$/, "")
      };
    });
    context.activeStatuses = context.statusList.filter(s => s.active);
    context.locTable = locTable;
    context.adrenalineRule = game.settings.get("vedmak", "adrenaline") && actor.type === "character";

    // Эффекты
    context.effects = [...actor.allApplicableEffects()].map(e => ({
      id: e.id, uuid: e.uuid, name: e.name, img: e.img, disabled: e.disabled,
      source: e.parent === actor ? "" : e.parent?.name, parentId: e.parent === actor ? "" : e.parent?.id,
      changes: describeChanges(e.system?.changes),
      duration: e.flags?.vedmak?.timed?.rounds ? `${e.flags.vedmak.timed.rounds} р.` : (e.isTemporary ? e.duration.label : ""),
      expired: e.isTemporary && !e.active && !e.disabled
    }));

    return context;
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (context.tabs?.[partId]) context.tab = context.tabs[partId];
    return context;
  }

  /** Обогатить HTML-поле для просмотра в редакторе. */
  async enrich(html) {
    return TextEditor.enrichHTML(html ?? "", { secrets: this.document.isOwner, relativeTo: this.document });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Поля предметов прямо в списках (количество): пишем в предмет, а не в актора
    this._listen("input.item-field", "change", async (event, input) => {
      event.stopPropagation();
      const item = this.actor.items.get(input.closest("[data-item-id]")?.dataset.itemId);
      if (item) await item.update({ [input.dataset.field]: Number(input.value) || 0 });
    });
    // Состояние критического ранения меняется прямо в списке
    this._listen("select.crit-state", "change", async (event, select) => {
      const item = this.actor.items.get(select.closest("[data-item-id]")?.dataset.itemId);
      if (!item) return;
      const state = select.value;
      const update = { "system.state": state };
      if (state === "treated") {
        const body = Math.max(3, Math.min(13, this.actor.system.stats.body.raw));
        const idx = ["simple", "complex", "difficult"].indexOf(item.system.level);
        update["system.healingDays"] = idx >= 0 ? HEALING_DAYS[body][idx] : 0;
      }
      await item.update(update);
    });
  }

  /* ------------------------------ Действия ------------------------------ */

  static #itemFrom(target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return this.actor.items.get(id);
  }

  static async #onRollSkill(event, target) {
    await this.actor.rollSkill(target.dataset.skill, { skipDialog: event.shiftKey });
  }

  static async #onRollStat(event, target) {
    await this.actor.rollStat(target.dataset.stat, { skipDialog: event.shiftKey });
  }

  static async #onItemCreate(event, target) {
    const type = target.dataset.type;
    const extra = target.dataset.kind ? { "system.kind": target.dataset.kind } : {};
    const label = game.i18n.localize(`TYPES.Item.${type}`);
    const [item] = await this.actor.createEmbeddedDocuments("Item", [{ name: `Новый: ${label}`, type, ...foundry.utils.expandObject(extra) }]);
    item?.sheet.render(true);
  }

  static #onItemEdit(event, target) {
    VedmakActorSheet.#itemFrom.call(this, target)?.sheet.render(true);
  }

  static async #onItemDelete(event, target) {
    const item = VedmakActorSheet.#itemFrom.call(this, target);
    if (!item) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Удалить предмет" },
      content: `<p>Удалить «${item.name}»?</p>`
    });
    if (ok) await item.delete();
  }

  static async #onItemToggleEquip(event, target) {
    const item = VedmakActorSheet.#itemFrom.call(this, target);
    if (item) await item.update({ "system.equipped": !item.system.equipped });
  }

  static async #onItemPost(event, target) {
    await VedmakActorSheet.#itemFrom.call(this, target)?.toChat();
  }

  static async #onEffectCreate() {
    const [effect] = await this.actor.createEmbeddedDocuments("ActiveEffect", [{
      name: "Новый эффект", img: "icons/svg/aura.svg"
    }]);
    effect?.sheet.render(true);
  }

  static #effectFrom(target) {
    const row = target.closest("[data-effect-id]");
    const parentId = row?.dataset.parentId;
    const parent = parentId ? this.actor.items.get(parentId) : this.actor;
    return parent?.effects.get(row?.dataset.effectId);
  }

  static #onEffectEdit(event, target) {
    VedmakActorSheet.#effectFrom.call(this, target)?.sheet.render(true);
  }

  static async #onEffectDelete(event, target) {
    await VedmakActorSheet.#effectFrom.call(this, target)?.delete();
  }

  static async #onEffectToggle(event, target) {
    const effect = VedmakActorSheet.#effectFrom.call(this, target);
    if (effect) await effect.update({ disabled: !effect.disabled });
  }

  static async #onAttack(event, target) {
    const kind = target.dataset.kind;
    await this.actor.attack({ kind, itemId: target.dataset.itemId || target.closest("[data-item-id]")?.dataset.itemId },
      { skipDialog: event.shiftKey });
  }

  static async #onRestTurn() {
    await restTurn(this.actor);
  }

  static async #onRestDays() {
    await restDays(this.actor);
  }

  static async #onCastSpell(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (item) await castSpell(this.actor, item, { skipDialog: event.shiftKey });
  }

  static async #onEndMaintained(event, target) {
    await endMaintained(this.actor, target.closest("[data-effect-id]")?.dataset.effectId);
  }

  static async #onControlCheck() {
    await controlCheck(this.actor);
  }

  /** Таран: выбрать скакуна или транспорт, затем обычное окно атаки. */
  static async #onRam() {
    const options = Object.entries(MOUNTS).map(([k, m]) => `<option value="${k}">${m.label} (${m.ram})</option>`).join("");
    const key = await foundry.applications.api.DialogV2.wait({
      window: { title: "Таран", icon: "fa-solid fa-horse-head" },
      classes: ["vedmak", "vedmak-dialog"],
      content: `<div class="vedmak-roll-dialog"><div class="form-group"><label>Чем таранить</label><select name="mount">${options}</select></div></div>`,
      buttons: [{ action: "ok", label: "Далее", default: true, callback: (e, b) => b.form.elements.mount.value },
        { action: "cancel", label: "Отмена" }],
      rejectClose: false
    });
    if (!key || key === "cancel") return;
    await this.actor.attack({ kind: "ram", key }, { chargeMeters: 10 });
  }

  static async #onManualDamage() {
    await manualDamage([this.actor]);
  }

  static async #onStunSave() {
    await this.actor.rollStunSave();
  }

  static async #onDeathSave() {
    await this.actor.rollDeathSave();
  }

  static async #onToggleStatus(event, target) {
    await this.actor.toggleStatusEffect(target.dataset.status);
  }

  /** Добавить критическое ранение вручную. */
  static async #onCritCreate() {
    const table = this.actor.system.derived.bodyType === "monster" ? LOCATIONS_MONSTER : LOCATIONS_HUMANOID;
    const groups = Object.entries(CRIT_LEVELS).map(([level, cfg]) => {
      const options = Object.entries(CRIT_WOUNDS).filter(([, w]) => w.level === level)
        .map(([key, w]) => `<option value="${key}">${w.label} (${w.roll[0] === w.roll[1] ? w.roll[0] : w.roll.join("–")})</option>`).join("");
      return `<optgroup label="${cfg.label}">${options}</optgroup>`;
    }).join("");
    const locations = Object.entries(table).map(([k, l]) => `<option value="${k}">${l.label}</option>`).join("");
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Критическое ранение", icon: "fa-solid fa-bone" },
      classes: ["vedmak", "vedmak-dialog"],
      content: `<div class="vedmak-roll-dialog">
        <div class="form-group"><label>Ранение</label><select name="wound">${groups}</select></div>
        <div class="form-group"><label>Часть тела</label><select name="location">${locations}</select></div></div>`,
      buttons: [{ action: "ok", label: "Добавить", icon: "fa-solid fa-plus", default: true,
        callback: (e, b) => ({ wound: b.form.elements.wound.value, location: b.form.elements.location.value }) },
        { action: "cancel", label: "Отмена" }],
      rejectClose: false
    });
    if (!result || result === "cancel") return;
    const cfg = CRIT_WOUNDS[result.wound];
    await this.actor.createEmbeddedDocuments("Item", [{
      name: cfg.label, type: "critWound", img: cfg.img ?? "icons/skills/wounds/injury-body-pain-gray.webp",
      system: { wound: result.wound, location: result.location, state: "fresh" }
    }]);
  }

  static #onToggleTrainedOnly() {
    this.trainedOnly = !this.trainedOnly;
    this.render();
  }
}
