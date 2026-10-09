// Лист персонажа.

import { VedmakActorSheet } from "./actor-sheet-base.mjs";
import { STATS, STAT_GROUPS } from "../config/stats.mjs";
import { REGIONS, HOMELANDS, witcherSchools, schoolMechanics, modTargets, SOCIAL_SKILLS, socialModifier, abilityBonus } from "../config/character.mjs";
import { SKILLS } from "../config/skills.mjs";
import {
  skillOffer, statOffer, definingOffer, abilityOffer, improveSkill, improveStat, improveDefining, improveAbility,
  setAbilityValue, grantImprovementPoints, learnSpellDialog
} from "../character/advancement.mjs";
import { CharacterWizard } from "../character/wizard.mjs";
import { applyRaceExtras, removeRaceExtras } from "../character/race.mjs";
import { racePowersContext, setPowerValue, powerStep } from "../character/race-powers.mjs";
import { transform, extendForm, endForm, regainControl } from "../character/true-form.mjs";
import { SUBSTANCES, COMPONENT_GROUPS, RECIPE_CATEGORIES, RECIPE_LEVELS, ALCHEMY_KINDS, ALCHEMY_ACTIONS, ENHANCEMENT_KINDS, TOOL_KINDS, CRAFTING, IMPLANT_LIMIT, crossbowModLimit } from "../config/crafting.mjs";
import { craft, readiness, requirements, hasTool, forage, repair, disassemble, toggleMemorized } from "../crafting/craft.mjs";
import { useAlchemical, handCannon } from "../crafting/alchemy.mjs";
import { attachEnhancement } from "../crafting/enhancements.mjs";
import { signed, compareRu, worldSetting, postCard } from "../util.mjs";
import { exchangeDialog } from "../character/money.mjs";
import { InvestigationApp } from "../apps/investigation-app.mjs";
import { applyTattoo } from "../crafting/tattoo.mjs";
import { implantDialog } from "../crafting/implant.mjs";
import { dragonFormContext, transformDragon, revertDragon } from "../character/dragon-form.mjs";
import { takeFromStorage } from "../character/storage.mjs";
import {
  readLifepath, writeLifepath, buildFromSaved, savedOpts, lifepathCards, lifepathStory, lifepathSummary, rerollPath, choosePath, setDecadeRisk,
  rollLifepathStep, rollLifepathSection, rollLifepathRest, postLifepathRolls, editLifepathNote, findEntry
} from "../character/lifepath.mjs";

/** Нелюди родом из земель Старших Народов (мастер создания ставит им это происхождение сам). */
const ELDER_RACES = ["elf", "dwarf", "gnome", "vran", "bobolak"];

/**
 * Колонка таблиц жизненного пути: происхождение из мастера, а у персонажа без мастера — по расе и родине.
 * Иначе эльф, собранный перетаскиванием расы, бросал бы судьбу семьи по колонке Севера.
 */
function lifepathRegion(system) {
  if (system.details.origin) return system.details.origin;
  if (ELDER_RACES.includes(system.raceKey)) return "elder";
  return (HOMELANDS[system.details.homelandKey] ?? homelandByName(system.details.homeland))?.region ?? "north";
}

/** Без «ё» и регистра: «Эббинг» и «эббинг», «Темерия » и «Темерия» — одна родина. */
const normName = text => String(text ?? "").trim().toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ");

/**
 * Родина по тексту с листа: «Родину» без мастера пишут словами, а homelandKey ставит только мастер.
 * Совпадение с названием из HOMELANDS без учёта регистра; составные («Лирия и Ривия») — и по каждой части;
 * «Нильфгаард» — сердце Империи.
 */
function homelandByName(text) {
  const name = normName(text);
  if (!name) return null;
  for (const h of Object.values(HOMELANDS)) {
    const label = normName(h.label);
    if (label === name || label.split(" и ").includes(name)) return h;
  }
  return name === "нильфгаард" ? HOMELANDS.nilfgaard : null;
}

/**
 * Остаток срока эффекта словами. Короткое (меньше минуты) — раундами по `CONFIG.time.roundTime` секунд:
 * зелье на 5 раундов (15 с) показывалось «1 мин.»; истёкшее — «истёк», а не минус минуты.
 */
function remainingLabel(seconds) {
  if (!Number.isFinite(seconds)) return "";
  if (seconds <= 0) return "истёк";
  if (seconds < 60) return `${Math.ceil(seconds / (CONFIG.time.roundTime || 3))} р.`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} мин.`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} ч ${minutes % 60} мин.` : `${hours} ч`;
}

export class CharacterSheet extends VedmakActorSheet {

  static DEFAULT_OPTIONS = {
    classes: ["character"],
    position: { width: 1040, height: 860 },
    actions: {
      rollDefining: CharacterSheet.#onRollDefining,
      rollAbility: CharacterSheet.#onRollAbility,
      rollPower: CharacterSheet.#onRollPower,
      unlockPower: CharacterSheet.#onUnlockPower,
      setBeast: CharacterSheet.#onSetBeast,
      swapBranch: CharacterSheet.#onSwapBranch,
      tfTransform: CharacterSheet.#onTfTransform,
      tfExtend: CharacterSheet.#onTfExtend,
      tfEnd: CharacterSheet.#onTfEnd,
      tfRegain: CharacterSheet.#onTfRegain,
      tfReset: CharacterSheet.#onTfReset,
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
      repairItem: CharacterSheet.#onRepairItem,
      handCannon: CharacterSheet.#onHandCannon,
      disassembleItem: CharacterSheet.#onDisassembleItem,
      endAlchemyEffect: CharacterSheet.#onEndAlchemyEffect,
      moneyExchange: CharacterSheet.#onMoneyExchange,
      lifepathEdit: CharacterSheet.#onLifepathEdit,
      lifepathReroll: CharacterSheet.#onLifepathReroll,
      lifepathRerollAll: CharacterSheet.#onLifepathRerollAll,
      lifepathRoll: CharacterSheet.#onLifepathRoll,
      lifepathChoose: CharacterSheet.#onLifepathChoose,
      lifepathNote: CharacterSheet.#onLifepathNote,
      investigation: () => InvestigationApp.open(),
      applyTattoo: CharacterSheet.#onApplyTattoo,
      implant: function () { return implantDialog(this.actor); },
      dragonTransform: function () { return transformDragon(this.actor); },
      dragonRevert: function () { return revertDragon(this.actor); },
      lifepathStep: CharacterSheet.#onLifepathStep,
      lifepathSection: CharacterSheet.#onLifepathSection,
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
        { id: "stats",  label: "Параметры" },
        { id: "combat", label: "Бой" },
        { id: "skills", label: "Навыки" },
        { id: "gear",   label: "Снаряжение" },
        { id: "craft",  label: "Ремесло" },
        { id: "magic",  label: "Магия" },
        { id: "bio",    label: "Дневник" }
      ],
      initial: "stats"
    },
    // Подвкладки «Боя»: обычный бой и словесная дуэль
    combat: {
      tabs: [
        { id: "fight",  label: "Бой" },
        { id: "social", label: "Социальный бой" }
      ],
      initial: "fight"
    },
    // Подвкладки «Навыков»: переключатель внутри вкладки, а не вторая полоса поперёк листа
    skills: {
      tabs: [
        { id: "list",       label: "Навыки" },
        { id: "profession", label: "Профессия" },
        // Расовые навыки (высший вампир) — подвкладка видна, только если они есть у расы
        { id: "race",       label: "Раса" }
      ],
      initial: "list"
    },
    craft: {
      tabs: [
        { id: "alchemy",      label: "Алхимия" },
        { id: "recipes",      label: "Чертежи и формулы" },
        { id: "components",   label: "Компоненты" },
        { id: "enhancements", label: "Усиления" }
      ],
      initial: "alchemy"
    }
  };

  /** Режим развития: кнопки «+» со стоимостью в О.У (состояние окна). */
  advanceMode = false;

  /** «Дневник»: жизненный путь в режиме правки (кости и списки у каждой строки). */
  lifepathEdit = false;

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    // Право «Ограниченный»: имя, портрет и внешность — то, что видно со стороны
    if (context.limited) {
      context.limitedText = this.actor.system.details.appearance;
      return context;
    }
    context.tabs = this._prepareTabs("primary");
    // Подвкладка «Раса» есть только у рас с навыками: раса сменилась — вкладка навыков не должна остаться пустой
    if (this.tabGroups.skills === "race" && !racePowersContext(this.actor)) this.tabGroups.skills = "list";
    context.skillTabs = this._prepareTabs("skills");
    context.craftTabs = this._prepareTabs("craft");
    const actor = this.actor;
    const system = actor.system;

    // Тревожные метки под именем: их видно на любой вкладке, поэтому они в левой колонке
    context.states = [];
    if (system.derived.dying) {
      context.states.push({ kind: "dying", label: "При смерти",
        hint: "Все параметры ⅓, каждый ход — испытание против смерти" });
    } else if (system.derived.wounded) {
      context.states.push({ kind: "wounded", label: "Ниже порога ранения",
        hint: "Реа, Лвк, Инт и Воля вдвое" });
    }
    if (system.derived.overload) {
      context.states.push({
        kind: "overload", label: `Перегруз −${system.derived.overload}`,
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

    context.race = system.race;
    context.profession = system.profession;
    context.advanceMode = this.advanceMode;

    // Социальный статус
    const social = system.derived.social;
    const mods = [...SOCIAL_SKILLS, "intimidation"]
      .map(k => ({ k, v: socialModifier(social, k) })).filter(x => x.v)
      .map(x => `${SKILLS[x.k].label} ${signed(x.v)}`);
    context.social = { ...social, mods: mods.join(", ") };
    let worldRegion = "north";
    worldRegion = worldSetting("region", worldRegion);
    context.regionOptions = { "": `Из настроек мира (${REGIONS[worldRegion]?.label ?? worldRegion})`,
      ...Object.fromEntries(Object.entries(REGIONS).map(([k, v]) => [k, v.label])) };
    context.isWitcher = system.raceKey === "witcher" || system.professionKey === "witcher" || !!system.details.school;
    // Расследование — необязательное правило «Журнала ведьмака»: Фокус и окно тайн
    context.investigation = worldSetting("investigation", true);
    // Школы корника и свои (настройка «Ведьмачьи школы»); под выбором — описание и механика словами
    const schools = witcherSchools();
    context.schoolOptions = Object.fromEntries(Object.entries(schools).map(([k, v]) => [k, v.label]));
    const school = schools[system.details.school];
    const mechanics = school?.custom ? schoolMechanics(school, modTargets(STATS, SKILLS)) : "";
    context.schoolHint = [school?.hint, mechanics].filter(Boolean).join(" ");
    // Медальон школы в досье: свой у пяти школ корника и Мантикоры, у прочих — общий ведьмачий
    const MEDALLIONS = ["wolf", "griffin", "cat", "viper", "bear", "manticore"];
    context.schoolCard = { img: `systems/vedmak/assets/fan/gear/${MEDALLIONS.includes(system.details.school)
      ? `med-school-${system.details.school}` : "g-medallion"}.webp` };
    // Зависимости: дни без дозы засечками, порог проверки словами (actor.rollAddiction)
    const will = system.stats.will.effective;
    context.addictionRows = (system.addictions ?? []).map((a, index) => ({
      ...a, index, tally: Array.from({ length: Math.min(a.days, 30) }, () => ({})),
      checkText: will - a.days > 1
        ? `Проверка: d10 меньше Воли ${will} − ${a.days} дн., то есть меньше ${will - a.days}`
        : `Воля ${will} − ${a.days} дн.: проверку без дозы не пройти — ломка`
    }));

    // Развитие: стоимость на вкладках параметров и навыков
    if (this.advanceMode) {
      for (const s of context.stats) if (s.key !== "luck") s.offer = statOffer(actor, s.key);
      for (const g of context.statGroups) for (const s of g.stats) s.offer = statOffer(actor, s.key);
      for (const g of context.skillGroups) for (const s of g.skills) s.offer = skillOffer(actor, s.key);
    }

    // Профессия и древо
    const prof = system.profession;
    if (prof) {
      const ps = prof.system;
      const ds = ps.definingSkill;
      context.prof = {
        id: prof.id, name: prof.name, img: prof.img, vigor: ps.vigor, magicAbilities: ps.magicAbilities,
        defining: {
          name: ds.name, value: ds.value, effect: ds.effect, statLabel: STATS[ds.stat]?.label ?? "",
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
              // Застёжка к следующей ступени: открыта, когда вложено 5
              gate: ai < b.abilities.length - 1, gateOpen: ab.value >= 5,
              statAbbr: STATS[ab.stat]?.abbr ?? "",
              base: ab.stat ? (system.stats[ab.stat]?.effective ?? 0) + ab.value : null,
              mechanicNote: bonus.vigor ? `+${bonus.vigor} Эн.` : bonus.toxicity ? `+${bonus.toxicity}%` : "",
              offer: this.advanceMode ? abilityOffer(actor, bi, ai) : null
            };
          })
        }))
      };
      context.prof.altBranches = (ps.altBranches ?? []).map((a, ai) => ({
        ...a, index: ai,
        abilities: a.abilities.map(x => ({ ...x, statAbbr: STATS[x.stat]?.abbr ?? "" })),
        targets: ps.branches.map((b, bi) => ({ index: bi, name: b.name }))
      }));
      const abilities = context.prof.branches.flatMap(b => b.abilities);
      context.prof.learned = abilities.filter(ab => ab.value > 0).length;
      context.prof.total = abilities.length;
    }

    // Расовые навыки (высший вампир)
    context.vamp = racePowersContext(actor);
    // Золотой дракон («Офир и Зеррикания»): Драконья форма над древом профессии
    context.dragon = dragonFormContext(actor);
    return context;
  }

  /**
   * То, что нужно одной вкладке, считается только при её отрисовке: «Дневник» обогащает HTML и собирает
   * жизненный путь, «Ремесло» проверяет готовность каждого рецепта.
   */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    const system = this.actor.system;
    if (partId === "bio") {
      context.enrichedBiography = await this.enrich(system.biography);
      context.enrichedNotes = await this.enrich(system.notes);
      context.lifepath = this.#lifepathContext();
    }
    if (partId === "craft") context.craft = this.#craftContext();
    return context;
  }

  /** Жизненный путь карточками: броски хранятся в system.lifepath, разделы собираются заново. */
  #lifepathContext() {
    const saved = readLifepath(this.actor.system.lifepath);
    if (!saved) return null;
    // Путь бросается по шагу: next — следующий бросок, пока путь не брошен до конца
    const lp = buildFromSaved(foundry.utils.deepClone(saved));
    const nextAction = this.isEditable ? "lifepathStep" : null;
    // Для чтения — летопись; в правке — карточки со списками и костями у каждой строки
    const edit = this.lifepathEdit && this.isEditable;
    return {
      edit, age: saved.age, next: lp.next,
      cards: edit ? lifepathCards(lp.sections, { editable: true, action: "lifepathReroll", nextAction, noteAction: "lifepathNote" }) : null,
      story: edit ? null : lifepathStory(lp.sections, { nextAction, sectionAction: nextAction && "lifepathSection" }),
      summary: lp.next ? [] : lifepathSummary(lp.effects)
    };
  }

  /** Вкладка «Ремесло»: алхимия, рецепты, компоненты, усиления. */
  #craftContext() {
    const actor = this.actor;
    const items = type => actor.itemTypes[type]?.slice().sort((a, b) => compareRu(a.name, b.name)) ?? [];
    const subImg = key => `systems/vedmak/assets/substances/${key}.svg`;
    const LEVEL_ORDER = Object.keys(RECIPE_LEVELS);
    // Цвет главной кнопки по действию: выпить — фиолет (как полоса токсичности), масло — зелень, бросок — киноварь
    const GO = { drink: "arcane", apply: "arcane", oil: "oil", throw: "blood", trap: "blood", mutagen: "arcane" };

    const alchemy = Object.entries(ALCHEMY_KINDS).map(([kind, label]) => ({
      kind, label,
      items: items("alchemical").filter(i => i.system.kind === kind && !(i.system.isMutagen && i.system.applied)).map(i => ({
        id: i.id, name: i.name, img: i.img, quantity: i.system.quantity, toxicity: i.system.toxicity, duration: i.system.duration,
        effect: i.system.effect, applied: i.system.applied,
        action: i.system.use.action, actionLabel: ALCHEMY_ACTIONS[i.system.use.action] && i.system.use.action ? ALCHEMY_ACTIONS[i.system.use.action] : "",
        goCls: GO[i.system.use.action] ?? "arcane"
      }))
    })).filter(g => g.items.length);

    // Рецепт целиком: компоненты и субстанции «есть / нужно», инструменты символами, уровень ромбами
    const recipesAll = items("recipe");
    const toolKind = t => t.forge ? "forge" : /алхимик/i.test(t.label) ? "alch" : "craft";
    const recipes = [["formula", "Формулы", "нужны инструменты алхимика"], ["blueprint", "Чертежи", "нужны инструменты ремесленника"]]
      .map(([kind, label, note]) => ({
        label, note,
        items: recipesAll.filter(r => r.system.kind === kind).map(r => {
          const req = requirements(actor, r);
          const missing = [...req.components.filter(c => !c.ok), ...req.substances.filter(s => !s.ok)].length;
          const level = Math.max(0, LEVEL_ORDER.indexOf(r.system.level)) + 1;
          const ready = !missing && req.toolsOk;
          return {
            id: r.id, name: r.name.replace(/^(Чертёж|Формула): /, ""), img: r.img, dc: r.system.dc, time: r.system.time,
            levelLabel: RECIPE_LEVELS[r.system.level] ?? "", memorized: r.system.memorized, formula: r.system.isFormula,
            categoryLabel: RECIPE_CATEGORIES[r.system.category] ?? "",
            resultQty: (r.system.result?.quantity ?? 1) > 1 ? r.system.result.quantity : 0,
            pips: [1, 2, 3, 4].map(n => ({ on: n <= level })),
            components: req.components, substances: req.substances.map(s => ({ ...s, img: subImg(s.key) })),
            tools: req.tools.map(t => ({ ...t, kind: toolKind(t) })),
            ready, surcharge: !ready && r.system.surcharge > 0 ? r.system.surcharge : 0,
            state: ready ? "Всё под рукой"
              : [missing ? `не хватает: ${missing}` : "", req.toolsOk ? "" : "нет нужного инструмента"].filter(Boolean).join(" · ")
          };
        })
      })).filter(g => g.items.length);

    const comps = items("component");
    const components = Object.entries(COMPONENT_GROUPS).map(([group, label]) => ({
      label, alchemy: group === "alchemy",
      items: comps.filter(c => (c.system.group || "other") === group).map(c => {
        const sub = SUBSTANCES[c.system.substance];
        return {
          id: c.id, name: c.name, img: c.img, quantity: c.system.quantity,
          substance: sub ? { ...sub, key: c.system.substance, img: subImg(c.system.substance) } : null,
          canForage: !!(c.system.forage.dc || c.system.forage.quantity), where: c.system.forage.where, dc: c.system.forage.dc,
          forageQty: c.system.forage.quantity
        };
      })
    })).filter(g => g.items.length);
    // Все девять субстанций — и те, которых нет: пустая гаснет
    const substances = Object.entries(SUBSTANCES).map(([key, s]) => {
      const count = comps.filter(c => c.system.substance === key).reduce((n, c) => n + c.system.quantity, 0);
      return { ...s, key, img: subImg(key), count, zero: !count };
    });

    // Действует сейчас: что осталось от срока — полосой
    const activeEffects = actor.effects.filter(e => e.flags?.vedmak?.alchemy).map(e => {
      const timed = e.flags.vedmak.timed;
      const rounds = timed?.rounds;
      const remaining = rounds ? `${rounds} р.` : remainingLabel(e.duration?.secondsRemaining);
      const total = timed?.total ?? e.duration?.seconds;
      const left = rounds ?? e.duration?.secondsRemaining;
      const pct = total > 0 && Number.isFinite(left) ? Math.max(0, Math.min(100, Math.round(left / total * 100))) : 100;
      return { id: e.id, name: e.name, img: e.img, toxicity: e.flags.vedmak.alchemy.toxicity, remaining, pct,
        oil: e.flags.vedmak.alchemy.kind === "oil" };
    });

    // Верстак: гнёзда мутагенов, печати памяти, три инструмента
    const taken = items("alchemical").filter(i => i.system.isMutagen && i.system.applied && !i.flags?.vedmak?.implant);
    const sockets = Array.from({ length: CRAFTING.mutagenLimit }, (_, n) => {
      const m = taken[n];
      return m ? { id: m.id, img: m.img, name: m.name, effect: m.system.effect, color: m.system.mutagen?.color || "" } : { empty: true };
    });
    // Вживлённые руны и глифы — свои места, не гнёзда мутагенов; осложнение провала — подсказкой у своего места
    const implanted = items("alchemical").filter(i => i.flags?.vedmak?.implant && !i.flags.vedmak.implant.extra);
    const extras = items("alchemical").filter(i => i.flags?.vedmak?.implant?.extra);
    const implants = Array.from({ length: IMPLANT_LIMIT }, (_, n) => {
      const m = implanted[n];
      if (!m) return { empty: true };
      const extra = extras.find(x => x.flags.vedmak.implant.key === m.flags.vedmak.implant.key);
      return { id: m.id, img: m.img, name: m.name, effect: m.system.effect, extra: extra ? " · вторая малая мутация" : "" };
    });
    const memorized = recipesAll.filter(r => r.system.memorized).length;
    const memoLimit = actor.system.stats.int.total;
    const seals = Array.from({ length: Math.max(memoLimit, memorized) }, (_, n) => ({ on: n < memorized, over: n >= memoLimit }));
    const workTools = [["alchemist", "алхимика", "Инструменты алхимика"], ["craftsman", "ремесл.", "Инструменты ремесленника"],
      ["forge", "кузница", "Кузница (походная или в поселении)"]].map(([kind, short, title]) => {
      const has = hasTool(actor, kind);
      return { kind, alch: kind === "alchemist", craft: kind === "craftsman", forge: kind === "forge", short, has,
        title: `${title}${has ? "" : " — нет"}` };
    });
    const otherTools = actor.itemTypes.gear.filter(g => g.system.tool && !["alchemist", "craftsman", "forge"].includes(g.system.tool))
      .map(g => TOOL_KINDS[g.system.tool] ?? g.name);

    // Усиления: куда можно нанести — оружие или броня с ячейками (занятые и свободные)
    const weapons = actor.itemTypes.weapon ?? [];
    const armors = (actor.itemTypes.armor ?? []).filter(a => !a.system.isShield);
    const slotTarget = (item, used, total) => ({
      name: item.name, slots: Array.from({ length: total }, (_, n) => ({ used: n < used })), free: used < total,
      title: used < total ? `${item.name}: свободно ${total - used} из ${total}` : `${item.name}: ячеек нет`
    });
    const targetsFor = kind => {
      if (kind === "crossbow") return weapons.filter(w => w.system.isCrossbow)
        .map(w => slotTarget(w, w.system.crossbowMods.length, crossbowModLimit(w)));
      if (["glyph", "glyphword", "armor"].includes(kind)) return armors.filter(a => a.system.enhancementSlots > 0)
        .map(a => slotTarget(a, a.system.usedSlots, a.system.enhancementSlots));
      return weapons.filter(w => w.system.enhancementSlots > 0).map(w => slotTarget(w, w.system.usedSlots, w.system.enhancementSlots));
    };
    const enhancements = items("enhancement").map(e => ({
      id: e.id, name: e.name, img: e.img, quantity: e.system.quantity, effect: e.system.effect,
      kind: e.system.kind, kindLabel: ENHANCEMENT_KINDS[e.system.kind] ?? "",
      goLabel: e.system.kind === "armor" ? "Прикрепить" : e.system.kind === "crossbow" ? "Поставить" : "Нанести",
      magic: !["armor", "crossbow"].includes(e.system.kind), targets: targetsFor(e.system.kind)
    }));

    const toxicity = actor.system.toxicity;
    return {
      alchemy, recipes, components, substances, activeEffects, memorized, memoLimit, memoOver: memorized > memoLimit,
      mutagenCount: taken.length, mutagenLimit: CRAFTING.mutagenLimit, sockets, seals, workTools, otherTools, enhancements,
      implants, implantCount: implanted.length, implantLimit: IMPLANT_LIMIT,
      readyCount: recipes.reduce((n, g) => n + g.items.filter(r => r.ready).length, 0),
      counts: {
        alchemy: alchemy.reduce((n, g) => n + g.items.length, 0), recipes: recipesAll.length,
        components: comps.length, enhancements: enhancements.length
      },
      toxicity: toxicity ? `${toxicity.total ?? toxicity.value} из ${toxicity.max}` : "",
      filter: this.craftFilter ?? ""
    };
  }

  /** «Ремесло» → «Компоненты»: отбор по субстанции (ключ или ""); живёт в окне, без перерисовки листа. */
  craftFilter = "";

  #applyCraftFilter() {
    const pane = this.element?.querySelector(".craft-tab .components-pane");
    if (!pane) return;
    const f = this.craftFilter;
    pane.dataset.filter = f;
    for (const btn of pane.querySelectorAll("button.sub-filter")) {
      const on = btn.dataset.substance === f;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    // Плитки без этой субстанции и опустевшие группы прячутся; ничего не нашлось — подсказка, где взять
    const match = el => el.querySelector(`.gear-tile[data-substance="${f}"]`);
    for (const tile of pane.querySelectorAll(".gear-tile")) tile.hidden = !!f && tile.dataset.substance !== f;
    for (const group of pane.querySelectorAll(".comp-group")) group.hidden = !!f && !match(group);
    const empty = pane.querySelector(".filter-empty");
    if (empty) empty.hidden = !f || !!match(pane);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Отбор компонентов по субстанции: щелчок по знаку ещё раз снимает отбор
    this._listen("button.sub-filter", "click", (event, btn) => {
      event.preventDefault();
      this.craftFilter = this.craftFilter === btn.dataset.substance ? "" : btn.dataset.substance;
      this.#applyCraftFilter();
    });
    this.#applyCraftFilter();
    // Жизненный путь: свой результат из списка (и следующий — не бросая), поведение ведьмака в десятилетии, возраст
    const onLifepath = (selector, fn) => this._listen(selector, "change", (event, el) => {
      event.stopPropagation();
      if (el.value === "") return;
      this.#saveLifepath(data => fn(data, el));
    });
    onLifepath("select[data-roll-path]", (data, el) => choosePath(data.rolls, el.dataset.rollPath, el.value, el.dataset.mod));
    onLifepath("select[data-lp-risk]", (data, el) => setDecadeRisk(data.rolls, el.dataset.lpRisk, el.value));
    onLifepath("input[data-lp-age]", (data, el) => { data.age = Math.max(0, Math.min(1000, Number(el.value) || 0)); });
    // Значения древа хранятся в предмете профессии — меняем их напрямую.
    // Профессию берём в момент правки: вкладка могла не перерисовываться с тех пор, как её сменили
    this._listen("input.ability-value", "change", (event, input) => {
      event.stopPropagation();
      const prof = this.actor.system.profession;
      if (prof) setAbilityValue(prof, Number(input.dataset.branch), Number(input.dataset.index), input.value);
    });
    // Расовые навыки: уровни и роль хранятся в предмете расы
    this._listen("input.power-value", "change", (event, input) => {
      event.stopPropagation();
      setPowerValue(this.actor.system.race, input.dataset.key, Number(input.value) || 0);
    });
    this._listen("select[data-race-role]", "change", (event, select) => {
      event.stopPropagation();
      this.actor.system.race?.update({ [`system.${select.dataset.raceRole}`]: select.value });
    });
    this._listen("input.defining-value", "change", (event, input) => {
      event.stopPropagation();
      this.actor.system.profession?.update({ "system.definingSkill.value": Math.max(0, Number(input.value) || 0) });
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
    // Из хранилища — взять (в лавке — купить): из сундука вещь уходит, а не копируется
    if (fromElsewhere && item.parent?.type === "loot") return takeFromStorage(item.parent, item, { hero: actor });
    // Вампирская магия не изучается за О.У: её даёт роль высшего вампира
    if (fromElsewhere && item.type === "spell" && item.system.kind === "vampire") {
      const roles = actor.system.race?.system.activeRoles ?? [];
      if (!actor.system.race?.system.roles?.some(r => r.key === item.system.branch)) {
        ui.notifications.warn(`«${item.name}» — вампирская магия; у расы персонажа нет такой роли.`);
      } else if (roles.length && !roles.includes(item.system.branch)) {
        ui.notifications.warn(`«${item.name}» — магия роли, которой у персонажа нет: сотворить её он не сможет.`);
      }
      return super._onDropItem(event, item);
    }
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

  /** Бросить раздел: броски карточки по одному — каждый в чат и сразу на лист. */
  static async #onLifepathSection() {
    const data = readLifepath(this.actor.system.lifepath);
    if (!data || this.#lifepathBusy) return;
    this.#lifepathBusy = true;
    try {
      await rollLifepathSection(data.rolls, savedOpts(data), async res => {
        await this.actor.update({ "system.lifepath": writeLifepath(data) });
        await postLifepathRolls(this.actor, res.rows, { roll: res.roll });
      });
    } finally {
      this.#lifepathBusy = false;
    }
  }

  /** Добросить остаток пути разом — все броски одной карточкой в чат. */
  static async #onLifepathRest() {
    // Тот же замок, что у «Раздела»: второй щелчок читал бы путь до записи первого — две разные карточки в чате,
    // а на листе остался бы только второй результат
    if (this.#lifepathBusy) return;
    this.#lifepathBusy = true;
    try {
      const data = readLifepath(this.actor.system.lifepath);
      if (!data) return;
      const res = rollLifepathRest(data.rolls, savedOpts(data));
      await this.actor.update({ "system.lifepath": writeLifepath(data) });
      await postLifepathRolls(this.actor, res.rows);
    } finally {
      this.#lifepathBusy = false;
    }
  }

  /** Нанести татуировку «Офира и Зеррикании» (плитка снаряжения). */
  static async #onApplyTattoo(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (item) await applyTattoo(this.actor, item);
  }

  /**
   * Начать жизненный путь персонажу без него: по расе, происхождению и возрасту с листа.
   * Первый бросок — сразу, остальные — кнопкой «Бросить» по одному.
   */
  static async #onLifepathRoll() {
    await this.#stepLifepath(this.#newLifepath());
  }

  /** Начать путь без бросков: каждый результат выбирается из списка в карточках правки. */
  static async #onLifepathChoose() {
    this.lifepathEdit = true;
    await this.actor.update({ "system.lifepath": writeLifepath(this.#newLifepath()) });
  }

  /** Своё описание строки: окно с текстом книги и полем для своего. */
  static async #onLifepathNote(event, target) {
    const saved = readLifepath(this.actor.system.lifepath);
    const entry = saved && findEntry(buildFromSaved(foundry.utils.deepClone(saved)), target.dataset.path);
    if (!entry) return;
    const notes = foundry.utils.deepClone(saved.notes ?? {});
    if (!await editLifepathNote(entry, notes)) return;
    // Пока окно было открыто, путь могли поменять: записываем только эту строку
    const path = entry.path;
    await this.#saveLifepath(data => {
      data.notes = { ...data.notes };
      if (notes[path]) data.notes[path] = notes[path];
      else delete data.notes[path];
    });
  }

  /** Новый жизненный путь по расе, происхождению, профессии и возрасту с листа. */
  #newLifepath() {
    const actor = this.actor;
    const witcher = actor.system.raceKey === "witcher" || actor.system.professionKey === "witcher";
    return {
      rolls: {}, witcher,
      age: Number.parseInt(actor.system.details.age) || (witcher ? 80 : 25),
      region: lifepathRegion(actor.system),
      race: actor.system.raceKey || "human",
      // Магу — путь мага «Тома Хаоса» (стр. 18): книга предлагает его вместо обычного
      kind: actor.system.professionKey === "mage" ? "tomeMage" : "",
      gender: actor.system.details.gender ?? ""
    };
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

  static async #onRollDefining(event) {
    await this.actor.rollDefining({ skipDialog: event.shiftKey });
  }

  static async #onRollPower(event, target) {
    await this.actor.rollRacePower(target.dataset.key, { skipDialog: event.shiftKey });
  }

  /** Открыть ступень древа, стадию или следующий уровень расового навыка за Очки Крови. */
  static async #onUnlockPower(event, target) {
    const actor = this.actor;
    const race = actor.system.race;
    const p = race?.system.power(target.dataset.key);
    const step = p && powerStep(race.system, p);
    if (!step) return;
    const blood = actor.system.blood.value;
    if (blood < step.cost) return ui.notifications.warn(`Не хватает Очков Крови: нужно ${step.cost}, есть ${blood}.`);
    await actor.update({ "system.blood.value": blood - step.cost });
    await setPowerValue(race, p.key, p.value + 1);
    await postCard(actor, step.label, `<p><b>${foundry.utils.escapeHTML(p.name)}</b>: ${p.value} → ${p.value + 1}.</p><p>Потрачено ${step.cost} ОК.</p>`,
      { icon: "fa-solid fa-droplet", cls: "advancement" });
  }

  /** Взять дополнительную ветвь вместо основной: ветви меняются местами вместе с вложенными очками. */
  static async #onSwapBranch(event, target) {
    const prof = this.actor.system.profession;
    if (!prof) return;
    const ai = Number(target.dataset.alt), bi = Number(target.dataset.branch);
    const data = prof.system.toObject();
    const alt = data.altBranches[ai], old = data.branches[bi];
    if (!alt || !old) return;
    if (old.abilities.some(a => a.value > 0)) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Сменить ветвь" },
        content: `<p>В ветви «${foundry.utils.escapeHTML(old.name)}» уже вложены очки. Ветвь уйдёт в «Другие ветви» вместе с ними — её можно вернуть. Сменить на «${foundry.utils.escapeHTML(alt.name)}»?</p>`
      });
      if (!ok) return;
    }
    data.branches[bi] = { name: alt.name, extra: alt.extra ?? "", source: alt.source ?? "", abilities: alt.abilities };
    // Своя книга ветви; у основной ветви профессии её нет — книга профессии
    data.altBranches[ai] = { name: old.name, source: old.source || prof.system.source?.book || "", extra: old.extra ?? "", abilities: old.abilities };
    await prof.update({ "system.branches": data.branches, "system.altBranches": data.altBranches });
  }

  /* Истинная форма высшего вампира */
  static async #onTfTransform(event, target) {
    if (target.classList.contains("disabled")) return;
    await transform(this.actor, { skipDialog: event.shiftKey });
  }
  static async #onTfExtend(event, target) {
    if (!target.classList.contains("disabled")) await extendForm(this.actor);
  }
  static async #onTfEnd() { await endForm(this.actor); }
  static async #onTfRegain() { await regainControl(this.actor); }
  static async #onTfReset() {
    if (game.user.isGM) await this.actor.unsetFlag("vedmak", "trueFormReady");
  }

  /** Шкала Зверя: щелчок по делению ставит значение, по верхнему закрашенному — убирает его. */
  static async #onSetBeast(event, target) {
    const n = Number(target.dataset.value) || 0;
    const now = this.actor.system.beast.value;
    await this.actor.update({ "system.beast.value": n === now ? n - 1 : n });
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

  static async #onAddictionAdd(event) {
    if (event?.detail > 1) return; // двойной щелчок — второй клик не создаёт дубль
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

  static async #onHandCannon(event, target) {
    const item = CharacterSheet.#item.call(this, target);
    if (item) await handCannon(this.actor, item);
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
