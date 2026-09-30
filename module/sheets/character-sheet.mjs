// Лист персонажа.

import { VedmakActorSheet } from "./actor-sheet-base.mjs";
import { STATS, STAT_GROUPS } from "../config/stats.mjs";
import { REGIONS, WITCHER_SCHOOLS, SOCIAL_SKILLS, socialModifier, abilityBonus } from "../config/character.mjs";
import { SKILLS } from "../config/skills.mjs";
import {
  skillOffer, statOffer, definingOffer, abilityOffer, improveSkill, improveStat, improveDefining, improveAbility,
  setAbilityValue, grantImprovementPoints, learnSpellDialog
} from "../character/advancement.mjs";
import { CharacterWizard } from "../character/wizard.mjs";
import { applyRaceExtras, removeRaceExtras } from "../character/race.mjs";
import { SUBSTANCES, COMPONENT_GROUPS, RECIPE_CATEGORIES, RECIPE_LEVELS, ALCHEMY_KINDS, ALCHEMY_ACTIONS, ENHANCEMENT_KINDS, TOOL_KINDS } from "../config/crafting.mjs";
import { craft, readiness, requirements, forage, repair, disassemble, toggleMemorized } from "../crafting/craft.mjs";
import { useAlchemical } from "../crafting/alchemy.mjs";
import { attachEnhancement, detachEnhancement, detachCrossbowMod } from "../crafting/enhancements.mjs";
import { signed } from "../util.mjs";
import { verbalAction, verbalContext, resetDuel } from "../combat/verbal.mjs";
import { exchangeDialog } from "../character/money.mjs";
import {
  readLifepath, writeLifepath, buildFromSaved, savedOpts, lifepathCards, lifepathSummary, rerollPath, choosePath, setDecadeRisk,
  rollLifepathStep, rollLifepathRest, postLifepathRolls
} from "../character/lifepath.mjs";

export class CharacterSheet extends VedmakActorSheet {

  static DEFAULT_OPTIONS = {
    classes: ["character"],
    position: { width: 1040, height: 860 },
    actions: {
      rollDefining: CharacterSheet.#onRollDefining,
      verbalAction: CharacterSheet.#onVerbalAction,
      duelReset: CharacterSheet.#onDuelReset,
      rollAbility: CharacterSheet.#onRollAbility,
      toggleAdvance: CharacterSheet.#onToggleAdvance,
      improveSkill: CharacterSheet.#onImproveSkill,
      improveStat: CharacterSheet.#onImproveStat,
      improveDefining: CharacterSheet.#onImproveDefining,
      improveAbility: CharacterSheet.#onImproveAbility,
      grantIp: CharacterSheet.#onGrantIp,
      restoreLuck: CharacterSheet.#onRestoreLuck,
      rollReputation: CharacterSheet.#onRollReputation,
      addictionAdd: CharacterSheet.#onAddictionAdd,
      addictionDelete: CharacterSheet.#onAddictionDelete,
      addictionRoll: CharacterSheet.#onAddictionRoll,
      addictionDay: CharacterSheet.#onAddictionDay,
      addictionDose: CharacterSheet.#onAddictionDose,
      openWizard: CharacterSheet.#onOpenWizard,
      craftRecipe: CharacterSheet.#onCraftRecipe,
      toggleMemorized: CharacterSheet.#onToggleMemorized,
      useAlchemical: CharacterSheet.#onUseAlchemical,
      forage: CharacterSheet.#onForage,
      attachEnhancement: CharacterSheet.#onAttachEnhancement,
      detachEnhancement: CharacterSheet.#onDetachEnhancement,
      detachCrossbowMod: CharacterSheet.#onDetachCrossbowMod,
      repairItem: CharacterSheet.#onRepairItem,
      disassembleItem: CharacterSheet.#onDisassembleItem,
      endAlchemyEffect: CharacterSheet.#onEndAlchemyEffect,
      moneyExchange: CharacterSheet.#onMoneyExchange,
      lifepathEdit: CharacterSheet.#onLifepathEdit,
      lifepathReroll: CharacterSheet.#onLifepathReroll,
      lifepathRerollAll: CharacterSheet.#onLifepathRerollAll,
      lifepathRoll: CharacterSheet.#onLifepathRoll,
      lifepathStep: CharacterSheet.#onLifepathStep,
      lifepathRest: CharacterSheet.#onLifepathRest,
      lifepathClear: CharacterSheet.#onLifepathClear
    }
  };

  static PARTS = {
    rail:   { template: "systems/vedmak/templates/actor/character-rail.hbs", scrollable: [""] },
    tabs:   { template: "templates/generic/tab-navigation.hbs" },
    stats:  { template: "systems/vedmak/templates/actor/tab-stats.hbs", scrollable: [""] },
    combat: { template: "systems/vedmak/templates/actor/tab-combat.hbs", scrollable: [""] },
    skills: { template: "systems/vedmak/templates/actor/tab-skills.hbs", scrollable: [""] },
    gear:   { template: "systems/vedmak/templates/actor/tab-gear.hbs", scrollable: [""] },
    craft:  { template: "systems/vedmak/templates/actor/tab-craft.hbs", scrollable: [""] },
    magic:  { template: "systems/vedmak/templates/actor/tab-magic.hbs", scrollable: [""] },
    bio:    { template: "systems/vedmak/templates/actor/tab-bio.hbs", scrollable: [""] }
  };

  /**
   * Один ряд вкладок: второй полосы подвкладок больше нет. В левой колонке постоянно видно,
   * кто персонаж, сколько в нём жизни и четыре ходовых значения; характеристики и производные
   * живут на «Параметрах», состояния и эффекты — в «Бое», древо профессии — в «Навыках»,
   * особенности расы — в «Дневнике».
   */
  static TABS = {
    primary: {
      tabs: [
        { id: "stats",  label: "Параметры",  icon: "fa-solid fa-chart-simple" },
        { id: "combat", label: "Бой",        icon: "fa-solid fa-swords" },
        { id: "skills", label: "Навыки",     icon: "fa-solid fa-list-check" },
        { id: "gear",   label: "Снаряжение", icon: "fa-solid fa-sack" },
        { id: "craft",  label: "Ремесло",    icon: "fa-solid fa-flask" },
        { id: "magic",  label: "Магия",      icon: "fa-solid fa-hand-sparkles" },
        { id: "bio",    label: "Дневник",    icon: "fa-solid fa-feather" }
      ],
      initial: "stats"
    },
    // Подвкладки «Боя»: обычный бой и словесная дуэль
    combat: {
      tabs: [
        { id: "fight",  label: "Бой",             icon: "fa-solid fa-swords" },
        { id: "social", label: "Социальный бой",  icon: "fa-solid fa-comments" }
      ],
      initial: "fight"
    },
    // Подвкладки «Навыков»: переключатель внутри вкладки, а не вторая полоса поперёк листа
    skills: {
      tabs: [
        { id: "list",       label: "Навыки",    icon: "fa-solid fa-list-check" },
        { id: "profession", label: "Профессия", icon: "fa-solid fa-sitemap" }
      ],
      initial: "list"
    }
  };

  /** Режим развития: кнопки «+» со стоимостью в О.У (состояние окна). */
  advanceMode = false;

  /** «Дневник»: жизненный путь в режиме правки (кости и списки у каждой строки). */
  lifepathEdit = false;

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.tabs = this._prepareTabs("primary");
    context.skillTabs = this._prepareTabs("skills");
    context.combatTabs = this._prepareTabs("combat");
    const actor = this.actor;
    const system = actor.system;

    // Тревожные метки под именем: их видно на любой вкладке, поэтому они в левой колонке
    context.states = [];
    if (system.derived.dying) {
      context.states.push({ kind: "dying", icon: "fa-solid fa-skull", label: "При смерти",
        hint: "Все параметры ⅓, каждый ход — испытание против смерти" });
    } else if (system.derived.wounded) {
      context.states.push({ kind: "wounded", icon: "fa-solid fa-heart-crack", label: "Ниже порога ранения",
        hint: "Реа, Лвк, Инт и Воля вдвое" });
    }
    if (system.derived.overload) {
      context.states.push({
        kind: "overload", icon: "fa-solid fa-weight-hanging", label: `Перегруз −${system.derived.overload}`,
        hint: `${system.derived.carried} кг при пределе ${system.derived.enc} кг`
      });
    }

    const d = system.derived;
    // В левой колонке — только то, что спрашивают каждый ход; остальное на вкладке «Параметры»
    context.railDerived = [
      { label: "Энергия", value: d.vigor, hint: "Сколько Вын можно без вреда потратить на магию за раунд" },
      { label: "Уст", value: d.stun, hint: "Устойчивость. Испытание: d10 меньше значения, иначе дезориентация" },
      { label: "Порог", value: d.woundThreshold, hint: "Порог ранения: ниже него Реа, Лвк, Инт и Воля вдвое" },
      { label: "Бег", value: d.run, unit: "м", hint: "Скорость × 3 за ход" }
    ];

    // Производные — не безымянной сеткой плиток, а смысловыми группами
    context.derivedGroups = [
      { label: "Движение", items: [
        { label: "Бег", value: d.run, unit: "м", hint: "Скорость × 3 за ход" },
        { label: "Прыжок", value: d.leap, unit: "м", hint: "Бег ÷ 5" },
        { label: "Подъём", value: d.liftMax, unit: "кг", hint: "Телосложение × 50 — сколько можно поднять с места" }
      ] },
      { label: "Стойкость", items: [
        { label: "Устойчивость", value: d.stun, hint: "Испытание: d10 меньше значения, иначе дезориентация" },
        { label: "Отдых", value: d.rec, hint: "Сколько ПЗ возвращает день покоя и сколько Вын — действие отдыха" },
        { label: "Порог ранения", value: d.woundThreshold,
          hint: "Ниже порога Реа, Лвк, Инт и Воля вдвое" }
      ] },
      { label: "Дух", items: [
        { label: "Энергия", value: d.vigor, hint: "Сколько Вын можно без вреда потратить на магию за раунд" },
        { label: "Решительность", value: d.resolve, hint: "(Воля + Интеллект) ÷ 2 × 5" },
        { label: "Фокус", value: d.focus || "—",
          hint: d.focus ? `«${d.focusItem}» — на столько дешевле сотворение` : "Фокусирующий предмет не надет" }
      ] },
      { label: "Рукопашная", items: [
        { label: "Удар рукой", value: d.punch, hint: "Несмертельный урон" },
        { label: "Удар ногой", value: d.kick, hint: "Несмертельный урон" },
        { label: "Бонус урона", value: signed(d.meleeBonus),
          hint: "Прибавляется к урону в ближнем бою" }
      ] }
    ];

    // Параметры двумя столбцами по смыслу; под названием — за что параметр отвечает
    // или откуда взялась разница с вложенным значением
    const statNote = (key, stat) => {
      const bits = [];
      if (stat.mod) bits.push(`${stat.base} вложено, ${signed(stat.mod)} от расы и эффектов`);
      if (stat.penalty) bits.push(`ранения и скованность ${signed(stat.penalty)}`);
      if (stat.effective !== stat.total) bits.push(d.dying ? "при смерти: треть" : "ниже порога ранения: вдвое");
      if (bits.length) return bits.join(" · ");
      if (key === "body") return `удар рукой ${d.punch} · вес ${d.enc} кг`;
      if (key === "spd") return `бег ${d.run} м · прыжок ${d.leap} м`;
      return STATS[key].about ?? "";
    };
    const statCard = key => {
      const stat = system.stats[key];
      return {
        key, ...stat, about: statNote(key, stat), rollable: key !== "luck",
        tone: stat.effective < stat.raw ? "down" : stat.mod > 0 ? "up" : ""
      };
    };
    context.statGroups = STAT_GROUPS.map(g => ({ ...g, stats: g.stats.map(statCard) }));
    context.luckStat = statCard("luck");
    // Удача в колонке — жетонами, теми же, что в окнах бросков
    context.luckDots = Array.from({ length: Math.max(0, system.luck?.max ?? 0) },
      (_, i) => ({ value: i + 1, on: i < (system.luck?.value ?? 0) }));

    context.trainedCount = Object.values(system.skills).filter(sk => sk.value > 0).length;
    context.verbal = verbalContext(actor);
    // Словесная дуэль — необязательное правило: без неё «Бой» показывает только обычный бой
    context.showSocialCombat = game.settings.get("vedmak", "verbalDuel");

    context.race = system.race;
    context.profession = system.profession;
    context.enrichedBiography = await this.enrich(system.biography);

    // Жизненный путь карточками: броски хранятся в system.lifepath, разделы собираются заново.
    // Путь бросается по шагу: next — следующий бросок, пока путь не брошен до конца
    const saved = readLifepath(system.lifepath);
    if (saved) {
      const lp = buildFromSaved(foundry.utils.deepClone(saved));
      context.lifepath = {
        cards: lifepathCards(lp.sections, {
          editable: this.lifepathEdit && this.isEditable, action: "lifepathReroll", nextAction: this.isEditable ? "lifepathStep" : null
        }),
        summary: lp.next ? [] : lifepathSummary(lp.effects), edit: this.lifepathEdit, age: saved.age, next: lp.next
      };
    } else {
      context.lifepath = null;
    }
    context.enrichedNotes = await this.enrich(system.notes);
    context.advanceMode = this.advanceMode;

    // Социальный статус
    const social = system.derived.social;
    const mods = [...SOCIAL_SKILLS, "intimidation"]
      .map(k => ({ k, v: socialModifier(social, k) })).filter(x => x.v)
      .map(x => `${SKILLS[x.k].label} ${signed(x.v)}`);
    context.social = { ...social, mods: mods.join(", ") };
    let worldRegion = "north";
    try { worldRegion = game.settings.get("vedmak", "region"); } catch { /* до регистрации настроек */ }
    context.regionOptions = { "": `Из настроек мира (${REGIONS[worldRegion]?.label ?? worldRegion})`,
      ...Object.fromEntries(Object.entries(REGIONS).map(([k, v]) => [k, v.label])) };
    context.isWitcher = system.raceKey === "witcher" || system.professionKey === "witcher" || !!system.details.school;
    context.schoolOptions = Object.fromEntries(Object.entries(WITCHER_SCHOOLS).map(([k, v]) => [k, v.label]));
    context.schoolHint = WITCHER_SCHOOLS[system.details.school]?.hint ?? "";

    // Развитие: стоимость на вкладках параметров и навыков
    if (this.advanceMode) {
      for (const s of context.stats) if (s.key !== "luck") s.offer = statOffer(actor, s.key);
      for (const g of context.statGroups) for (const s of g.stats) s.offer = statOffer(actor, s.key);
      for (const g of context.skillGroups) for (const s of g.skills) s.offer = skillOffer(actor, s.key);
    }

    context.craft = this.#craftContext();

    // Профессия и древо
    const prof = system.profession;
    if (prof) {
      const ps = prof.system;
      const ds = ps.definingSkill;
      context.prof = {
        id: prof.id, name: prof.name, img: prof.img, vigor: ps.vigor, magicAbilities: ps.magicAbilities,
        defining: {
          name: ds.name, value: ds.value, effect: ds.effect,
          statAbbr: STATS[ds.stat]?.abbr ?? "", base: (system.stats[ds.stat]?.effective ?? 0) + ds.value,
          offer: this.advanceMode ? definingOffer(actor) : null
        },
        branches: ps.branches.map((b, bi) => ({
          name: b.name, index: bi,
          abilities: b.abilities.map((ab, ai) => {
            const bonus = abilityBonus(ab.mechanic, ab.value);
            const unlocked = ps.isUnlocked(bi, ai);
            const prev = ai === 0 ? ds.name : b.abilities[ai - 1].name;
            return {
              ...ab, index: ai, unlocked,
              lockNote: `Нужно 5 очков в «${prev}».`,
              statAbbr: STATS[ab.stat]?.abbr ?? "",
              base: ab.stat ? (system.stats[ab.stat]?.effective ?? 0) + ab.value : null,
              mechanicNote: bonus.vigor ? `+${bonus.vigor} Эн.` : bonus.toxicity ? `+${bonus.toxicity}%` : "",
              offer: this.advanceMode ? abilityOffer(actor, bi, ai) : null
            };
          })
        }))
      };
      const abilities = context.prof.branches.flatMap(b => b.abilities);
      context.prof.learned = abilities.filter(ab => ab.value > 0).length;
      context.prof.total = abilities.length;
    }
    return context;
  }

  /** Вкладка «Ремесло»: алхимия, рецепты, компоненты, усиления. */
  #craftContext() {
    const actor = this.actor;
    const items = type => actor.itemTypes[type]?.slice().sort((a, b) => a.name.localeCompare(b.name, "ru")) ?? [];
    const ACTION_ICONS = { drink: "fa-solid fa-wine-bottle", apply: "fa-solid fa-hand-holding-droplet", throw: "fa-solid fa-bomb",
      oil: "fa-solid fa-droplet", mutagen: "fa-solid fa-dna", trap: "fa-solid fa-dharmachakra" };

    const alchemy = Object.entries(ALCHEMY_KINDS).map(([kind, label]) => ({
      kind, label,
      items: items("alchemical").filter(i => i.system.kind === kind).map(i => ({
        id: i.id, name: i.name, img: i.img, quantity: i.system.quantity, toxicity: i.system.toxicity, duration: i.system.duration,
        effect: i.system.effect, applied: i.system.applied,
        action: i.system.use.action, actionLabel: ALCHEMY_ACTIONS[i.system.use.action] && i.system.use.action ? ALCHEMY_ACTIONS[i.system.use.action] : "",
        actionIcon: ACTION_ICONS[i.system.use.action] ?? "fa-solid fa-flask"
      }))
    })).filter(g => g.items.length);

    const recipesAll = items("recipe");
    const recipes = [["blueprint", "Чертежи"], ["formula", "Формулы"]].map(([kind, label]) => ({
      label,
      items: recipesAll.filter(r => r.system.kind === kind).map(r => {
        const req = requirements(actor, r);
        const missing = [...req.components.filter(c => !c.ok).map(c => `${c.name} ${c.have}/${c.need}`),
          ...req.substances.filter(s => !s.ok).map(s => `${s.label} ${s.have}/${s.need}`),
          ...req.tools.filter(t => !t.ok).map(t => t.label)];
        return {
          id: r.id, name: r.name.replace(/^(Чертёж|Формула): /, ""), img: r.img, dc: r.system.dc, time: r.system.time,
          levelLabel: RECIPE_LEVELS[r.system.level] ?? "", memorized: r.system.memorized, formula: r.system.isFormula,
          ready: !missing.length, readyHint: missing.length ? `Не хватает: ${missing.join(", ")}` : "Всё готово"
        };
      })
    })).filter(g => g.items.length);

    const comps = items("component");
    const components = Object.entries(COMPONENT_GROUPS).map(([group, label]) => ({
      label,
      items: comps.filter(c => (c.system.group || "other") === group).map(c => ({
        id: c.id, name: c.name, img: c.img, quantity: c.system.quantity,
        substance: SUBSTANCES[c.system.substance] ? { ...SUBSTANCES[c.system.substance] } : null,
        canForage: !!(c.system.forage.dc || c.system.forage.quantity), where: c.system.forage.where, dc: c.system.forage.dc,
        forageQty: c.system.forage.quantity
      }))
    })).filter(g => g.items.length);
    const substances = Object.entries(SUBSTANCES).map(([key, s]) => ({
      ...s, key, count: comps.filter(c => c.system.substance === key).reduce((n, c) => n + c.system.quantity, 0)
    })).filter(s => s.count > 0);

    const now = game.time.worldTime ?? 0;
    const activeEffects = actor.effects.filter(e => e.flags?.vedmak?.alchemy).map(e => {
      let remaining = "";
      const rounds = e.flags.vedmak.timed?.rounds;
      if (rounds) remaining = `${rounds} р.`;
      else if (e.duration?.secondsRemaining && Number.isFinite(e.duration.secondsRemaining)) remaining = `${Math.ceil(e.duration.secondsRemaining / 60)} мин.`;
      return { id: e.id, name: e.name, img: e.img, toxicity: e.flags.vedmak.alchemy.toxicity, remaining };
    });

    const memorized = recipesAll.filter(r => r.system.memorized).length;
    const memoLimit = actor.system.stats.int.total;
    return {
      alchemy, recipes, components, substances, activeEffects, memorized, memoLimit, memoOver: memorized > memoLimit,
      mutagenCount: actor.system.derived.mutagens ?? 0,
      tools: actor.itemTypes.gear.filter(g => g.system.tool).map(g => TOOL_KINDS[g.system.tool] ?? g.name),
      enhancements: items("enhancement").map(e => ({ id: e.id, name: e.name, img: e.img, quantity: e.system.quantity, effect: e.system.effect,
        kind: e.system.kind, kindLabel: ENHANCEMENT_KINDS[e.system.kind] ?? "" }))
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Жизненный путь: свой результат из списка, поведение ведьмака в десятилетии, возраст
    const onLifepath = (selector, fn) => {
      for (const el of this.element.querySelectorAll(selector)) {
        el.addEventListener("change", event => {
          event.stopPropagation();
          this.#saveLifepath(data => fn(data, el));
        });
      }
    };
    onLifepath("select[data-roll-path]", (data, el) => choosePath(data.rolls, el.dataset.rollPath, el.value, el.dataset.mod));
    onLifepath("select[data-lp-risk]", (data, el) => setDecadeRisk(data.rolls, el.dataset.lpRisk, el.value));
    onLifepath("input[data-lp-age]", (data, el) => { data.age = Math.max(0, Math.min(1000, Number(el.value) || 0)); });
    const prof = this.actor.system.profession;
    // Значения древа хранятся в предмете профессии — меняем их напрямую
    for (const input of this.element.querySelectorAll("input.ability-value")) {
      input.addEventListener("change", event => {
        event.stopPropagation();
        if (prof) setAbilityValue(prof, Number(input.dataset.branch), Number(input.dataset.index), input.value);
      });
    }
    this.element.querySelector("input.defining-value")?.addEventListener("change", event => {
      event.stopPropagation();
      prof?.update({ "system.definingSkill.value": Math.max(0, Number(event.currentTarget.value) || 0) });
    });
  }

  /** Строки зависимостей: name="system.addictions.0.name" → массив. */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const v = data.system?.addictions;
    if (v && !Array.isArray(v) && typeof v === "object") {
      data.system.addictions = Object.keys(v).sort((a, b) => a - b).map(k => v[k]);
    }
    return data;
  }

  /**
   * Раса и профессия у персонажа одна: новая заменяет старую.
   * Профессия отмечает свои навыки; магию можно изучить за О.У (стр. 124).
   */
  async _onDropItem(event, item) {
    if (!this.actor.isOwner) return null;
    const actor = this.actor;
    const fromElsewhere = item.parent?.uuid !== actor.uuid;
    if (fromElsewhere && item.type === "spell") {
      const choice = await learnSpellDialog(actor, item);
      if (!choice) return null;
      return super._onDropItem(event, item);
    }
    const stackable = ["gear", "component", "alchemical", "enhancement"];
    if (fromElsewhere && stackable.includes(item.type)) {
      const same = actor.items.find(i => i.type === item.type && i.name === item.name && !(i.system.applied));
      if (same) return same.update({ "system.quantity": (same.system.quantity ?? 1) + (item.system.quantity ?? 1) });
    }
    const unique = ["race", "profession"];
    if (unique.includes(item.type) && fromElsewhere) {
      const old = actor.itemTypes[item.type];
      if (old.length) {
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: item.type === "race" ? "Сменить расу" : "Сменить профессию" },
          content: `<p>Заменить «${old[0].name}» на «${item.name}»?${item.type === "profession" ? " Очки, вложенные в древо прежней профессии, пропадут." : ""}</p>`
        });
        if (!ok) return null;
        // Клыки и эффекты черт прежней расы уходят вместе с ней
        if (item.type === "race") await removeRaceExtras(actor, old[0]);
        await actor.deleteEmbeddedDocuments("Item", old.map(i => i.id));
      }
    }
    const result = await super._onDropItem(event, item);
    // Естественное оружие расы и выбор навыков гнома — как в мастере создания
    if (item.type === "race" && fromElsewhere && result) await applyRaceExtras(actor, item);
    if (item.type === "profession" && fromElsewhere) {
      const listed = new Set(item.system.skills);
      const update = {};
      for (const key of Object.keys(actor.system.skills)) update[`system.skills.${key}.profession`] = listed.has(key);
      await actor.update(update);
      if (item.system.skillChoices.length) {
        ui.notifications.info(`${item.name}: отметьте навыки на выбор (${item.system.skillChoices.map(c => c.label).join("; ")}) галочкой на вкладке «Навыки».`);
      }
    }
    const race = item.type === "race" ? item.system.key : actor.system.raceKey;
    const profKey = item.type === "profession" ? item.system.key : actor.system.professionKey;
    if (race && profKey && (race === "witcher") !== (profKey === "witcher")) {
      ui.notifications.warn("Раса и профессия ведьмака неразделимы: ведьмак может быть только ведьмаком (стр. 37).");
    }
    return result;
  }

  /* ------------------------------ Действия ------------------------------ */

  /* --------------------------- Жизненный путь --------------------------- */

  /** Поменять сохранённый жизненный путь. Недостающие после правки броски делаются кнопкой «Бросить». */
  async #saveLifepath(mutate) {
    const data = readLifepath(this.actor.system.lifepath);
    if (!data) return;
    mutate(data);
    await this.actor.update({ "system.lifepath": writeLifepath(data) });
  }

  /**
   * Следующий бросок пути — в чат. `data` — уже прочитанный путь (или новый),
   * `mutate` — что поменять перед броском (переброс строки, сброс всего).
   */
  async #stepLifepath(data = readLifepath(this.actor.system.lifepath), mutate = null) {
    if (!data || this.#lifepathBusy) return;
    this.#lifepathBusy = true;
    try {
      mutate?.(data);
      const res = await rollLifepathStep(data.rolls, savedOpts(data));
      await this.actor.update({ "system.lifepath": writeLifepath(data) });
      if (res) await postLifepathRolls(this.actor, res.rows, { roll: res.roll });
    } finally {
      this.#lifepathBusy = false;
    }
  }

  /** Идёт бросок пути: второй щелчок не бросает ту же строку дважды. */
  #lifepathBusy = false;

  static #onLifepathEdit() {
    this.lifepathEdit = !this.lifepathEdit;
    this.render();
  }

  /** Переброс строки: она бросается заново (в чат), зависящие от неё — следующими шагами. */
  static async #onLifepathReroll(event, target) {
    await this.#stepLifepath(undefined, data => rerollPath(data.rolls, target.dataset.path));
  }

  static async #onLifepathRerollAll() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Жизненный путь" },
      content: "<p>Перебросить весь жизненный путь? Он начнётся заново с первого броска; поведение ведьмака по десятилетиям сохранится.</p>"
    });
    if (ok) await this.#stepLifepath(undefined, data => {
      data.rolls = Object.fromEntries(Object.entries(data.rolls).filter(([k]) => k.endsWith(".risk")));
    });
  }

  static async #onLifepathStep() {
    await this.#stepLifepath();
  }

  /** Добросить остаток пути разом — все броски одной карточкой в чат. */
  static async #onLifepathRest() {
    const data = readLifepath(this.actor.system.lifepath);
    if (!data) return;
    const res = rollLifepathRest(data.rolls, savedOpts(data));
    await this.actor.update({ "system.lifepath": writeLifepath(data) });
    await postLifepathRolls(this.actor, res.rows);
  }

  /**
   * Начать жизненный путь персонажу без него: по расе, происхождению и возрасту с листа.
   * Первый бросок — сразу, остальные — кнопкой «Бросить» по одному.
   */
  static async #onLifepathRoll() {
    const actor = this.actor;
    const witcher = actor.system.raceKey === "witcher" || actor.system.professionKey === "witcher";
    const data = {
      rolls: {}, witcher,
      age: Number.parseInt(actor.system.details.age) || (witcher ? 80 : 25),
      region: actor.system.details.origin || "north",
      race: actor.system.raceKey || "human"
    };
    await this.#stepLifepath(data);
  }

  static async #onLifepathClear() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Жизненный путь" }, content: "<p>Убрать жизненный путь с листа? Биография и то, что мастер уже выдал, останутся.</p>"
    });
    if (!ok) return;
    this.lifepathEdit = false;
    await this.actor.update({ "system.lifepath": "" });
  }

  static async #onMoneyExchange() {
    await exchangeDialog(this.actor);
  }

  static async #onVerbalAction(event, target) {
    await verbalAction(this.actor, target.dataset.verbal, { skipDialog: event.shiftKey });
  }

  /** Новая словесная дуэль: Решительность снова полная, накопленные бонусы противников сброшены. */
  static async #onDuelReset() {
    await resetDuel(this.actor);
  }

  static async #onRollDefining(event) {
    await this.actor.rollDefining({ skipDialog: event.shiftKey });
  }

  static async #onRollAbility(event, target) {
    await this.actor.rollAbility(Number(target.dataset.branch), Number(target.dataset.index), { skipDialog: event.shiftKey });
  }

  static #onToggleAdvance() {
    this.advanceMode = !this.advanceMode;
    this.render();
  }

  static async #onImproveSkill(event, target) {
    await improveSkill(this.actor, target.dataset.skill, { skipConfirm: event.shiftKey });
  }

  static async #onImproveStat(event, target) {
    await improveStat(this.actor, target.dataset.stat, { skipConfirm: event.shiftKey });
  }

  static async #onImproveDefining(event) {
    await improveDefining(this.actor, { skipConfirm: event.shiftKey });
  }

  static async #onImproveAbility(event, target) {
    await improveAbility(this.actor, Number(target.dataset.branch), Number(target.dataset.index), { skipConfirm: event.shiftKey });
  }

  static async #onGrantIp() {
    if (game.user.isGM) await grantImprovementPoints(this.actor);
  }

  static async #onRestoreLuck() {
    const luck = this.actor.system.luck;
    await this.actor.update({ "system.luck.value": luck.max });
    ui.notifications.info(`${this.actor.name}: Удача восстановлена (${luck.max}).`);
  }

  static async #onRollReputation() {
    await this.actor.rollReputation();
  }

  #addictions() {
    return this.actor.system.toObject().addictions;
  }

  static async #onAddictionAdd() {
    const list = this.#addictions();
    list.push({ name: "", days: 0 });
    await this.actor.update({ "system.addictions": list });
  }

  static async #onAddictionDelete(event, target) {
    const list = this.#addictions();
    list.splice(Number(target.closest("[data-index]").dataset.index), 1);
    await this.actor.update({ "system.addictions": list });
  }

  static async #onAddictionRoll(event, target) {
    await this.actor.rollAddiction(Number(target.closest("[data-index]").dataset.index));
  }

  static async #onAddictionDay(event, target) {
    const list = this.#addictions();
    const row = list[Number(target.closest("[data-index]").dataset.index)];
    if (!row) return;
    row.days += 1;
    await this.actor.update({ "system.addictions": list });
  }

  static async #onAddictionDose(event, target) {
    const list = this.#addictions();
    const row = list[Number(target.closest("[data-index]").dataset.index)];
    if (!row) return;
    row.days = 0;
    await this.actor.update({ "system.addictions": list });
    if (this.actor.statuses.has("withdrawal")) await this.actor.toggleStatusEffect("withdrawal", { active: false });
  }

  static #item(target) {
    return this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
  }

  static async #onCraftRecipe(event, target) {
    const item = CharacterSheet.#item.call(this, target);
    if (item) await craft(this.actor, item, { skipDialog: event.shiftKey });
  }

  static async #onToggleMemorized(event, target) {
    const item = CharacterSheet.#item.call(this, target);
    if (item) await toggleMemorized(this.actor, item);
  }

  static async #onUseAlchemical(event, target) {
    const item = CharacterSheet.#item.call(this, target);
    if (item) await useAlchemical(this.actor, item);
  }

  static async #onForage(event, target) {
    const item = CharacterSheet.#item.call(this, target);
    if (item) await forage(this.actor, item);
  }

  static async #onAttachEnhancement(event, target) {
    const item = CharacterSheet.#item.call(this, target);
    if (item) await attachEnhancement(this.actor, item);
  }

  static async #onDetachEnhancement(event, target) {
    const item = CharacterSheet.#item.call(this, target);
    if (item) await detachEnhancement(this.actor, item, Number(target.dataset.index));
  }

  static async #onDetachCrossbowMod(event, target) {
    const item = CharacterSheet.#item.call(this, target);
    if (item) await detachCrossbowMod(this.actor, item, Number(target.dataset.index));
  }

  static async #onRepairItem(event, target) {
    const item = CharacterSheet.#item.call(this, target);
    if (item) await repair(this.actor, item);
  }

  static async #onDisassembleItem(event, target) {
    const item = CharacterSheet.#item.call(this, target);
    if (item) await disassemble(this.actor, item);
  }

  static async #onEndAlchemyEffect(event, target) {
    const effect = this.actor.effects.get(target.closest("[data-effect-id]")?.dataset.effectId);
    if (effect) await effect.delete();
  }

  static #onOpenWizard() {
    new CharacterWizard({ actor: this.actor }).render(true);
  }
}
