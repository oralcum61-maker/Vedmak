// Модели предметов. Этап 0 — основные поля; бой, магия и ремесло расширяют их на следующих этапах.

import { int, num, str, html, source } from "../fields.mjs";
import { ARMOR_LOCATIONS } from "../../config/items.mjs";

const { SchemaField, BooleanField, ArrayField, StringField } = foundry.data.fields;

/** Модификаторы предмета строками {target, value} — как у расы (действуют, пока предмет надет или применён). */
function modsField() {
  return new ArrayField(new SchemaField({ target: str("stats.ref"), value: int(0) }));
}

/** Поля, общие для всего, что можно носить, покупать и продавать. */
function physical() {
  return {
    description: html(),
    quantity: int(1, { min: 0 }),
    weight: num(0, { min: 0 }),
    cost: num(0, { min: 0 }),
    availability: str("common"),
    concealment: str("none"),
    equipped: new BooleanField({ initial: false }),
    source: source()
  };
}

/** «4d6+2» + 1 кость → «5d6+2». Кость берётся того же размера, что в формуле. */
function addDamageDice(damage, count) {
  return String(damage).replace(/^(\d+)(d\d+)/, (m, n, die) => `${Number(n) + count}${die}`);
}

export class WeaponData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...physical(),
      category: str("sword"),
      skill: str("swordsmanship"),
      accuracy: int(0),
      damage: str("2d6"),
      damageTypes: new ArrayField(new StringField(), { initial: ["slashing"] }),
      reliability: new SchemaField({ value: int(10), max: int(10) }),
      hands: int(1, { min: 0, max: 2 }),
      range: str(""),
      attackSpeed: int(1, { min: 1 }),
      effects: new ArrayField(new SchemaField({ key: str(""), value: str(""), source: str(""), slots: int(1, { min: 0 }) })),
      enhancementSlots: int(0, { min: 0 }),
      silverDamage: str(""),
      relic: new BooleanField({ initial: false }),
      mods: modsField(),
      // Масло для меча: +5 урона по классу чудовищ до указанного мирового времени (стр. 248)
      oil: new SchemaField({ name: str(""), target: str(""), until: num(0) }),
      // Модификации арбалета: [{name, key}] — ключи из CONFIG.VEDMAK.CROSSBOW_MODS
      crossbowMods: new ArrayField(new SchemaField({ name: str(""), key: str("") }))
    };
  }

  /** Модификации арбалета меняют точность, урон, надёжность и эффекты (стр. DLC «Фургончик Родольфа»). */
  prepareDerivedData() {
    for (const mod of this.crossbowMods) {
      const cfg = CONFIG.VEDMAK?.CROSSBOW_MODS?.[mod.key];
      if (!cfg) continue;
      if (cfg.accuracy) this.accuracy += cfg.accuracy;
      if (cfg.reliability) {
        this.reliability.max += cfg.reliability;
        this.reliability.value += cfg.reliability;
      }
      if (cfg.damageDice) this.damage = addDamageDice(this.damage, cfg.damageDice);
      if (cfg.effect && !this.effects.some(e => e.key === cfg.effect)) {
        this.effects.push({ key: cfg.effect, value: "", source: mod.name });
      }
    }
  }

  /** Руны, нанесённые на оружие (модификации арбалета ячеек не занимают). */
  get runes() {
    const mods = new Set(this.crossbowMods.map(m => m.name));
    return this.effects.filter(e => e.source && !mods.has(e.source));
  }

  /** Занятые ячейки усиления: руна — одна, малое зачарование — две, большое — три. */
  get usedSlots() { return this.runes.reduce((n, e) => n + (e.slots || 1), 0); }
  get freeSlots() { return Math.max(0, this.enhancementSlots - this.usedSlots); }

  /** Действующее масло или null. */
  get activeOil() {
    if (!this.oil.target) return null;
    const now = globalThis.game?.time?.worldTime ?? 0;
    return this.oil.until > now ? this.oil : null;
  }

  /** Стрелковое и метательное оружие атакует Лвк (стр. 164). */
  get isRanged() { return ["archery", "crossbow", "athletics"].includes(this.skill); }
  get isThrown() { return this.skill === "athletics"; }
  get isBow() { return this.skill === "archery"; }
  get isCrossbow() { return this.skill === "crossbow"; }
  get isSilver() { return !!this.silverDamage.trim(); }

  /** Есть ли у оружия эффект; возвращает запись {key, value} или undefined. */
  effect(key) { return this.effects.find(e => e.key === key); }

  /** Процент срабатывания эффекта («Кровопускающее (25%)» → 25). */
  effectChance(key) {
    const e = this.effect(key);
    if (!e) return 0;
    const n = parseInt(String(e.value).replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(n) ? n : 100;
  }

  /** Числовой параметр эффекта («Дезориентирующее (−2)» → −2, «Фокусирующее (3)» → 3). */
  effectNumber(key) {
    const n = parseInt(String(this.effect(key)?.value ?? "").replace(/[−–]/g, "-").replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Дистанция в метрах. Понимает «100 м», «Тел×4 м», «Тел x 2».
   * @param {number} body — Тел владельца
   */
  rangeMeters(body = 0) {
    const r = String(this.range ?? "").replace(",", ".");
    const byBody = r.match(/Тел\s*[x×х*]\s*(\d+(?:\.\d+)?)/i);
    if (byBody) return body * Number(byBody[1]);
    const n = r.match(/(\d+(?:\.\d+)?)/);
    return n ? Number(n[1]) : 0;
  }
}

/** Критическое ранение на персонаже (стр. 158–160, 174). */
export class CritWoundData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: html(),
      wound: str("crackedRibs"),
      location: str("torso"),
      state: str("fresh", { choices: ["fresh", "stabilized", "treated"] }),
      healingDays: int(0, { min: 0 }),
      nextStunRound: int(0),
      teeth: int(0, { min: 0 }),
      notes: str("")
    };
  }

  get config() { return CONFIG.VEDMAK.CRIT_WOUNDS[this.wound] ?? null; }
  get level() { return this.config?.level ?? "simple"; }
  get levelConfig() { return CONFIG.VEDMAK.CRIT_LEVELS[this.level]; }
  get current() { return this.config?.states[this.state] ?? { text: "", mods: {} }; }
  get mods() { return this.current.mods ?? {}; }
}

export class ArmorData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const sp = {};
    for (const loc of Object.keys(ARMOR_LOCATIONS)) {
      sp[loc] = new SchemaField({ value: int(0, { min: 0 }), max: int(0, { min: 0 }) });
    }
    return {
      ...physical(),
      weightClass: str("light"),
      isShield: new BooleanField({ initial: false }),
      sp: new SchemaField(sp),
      reliability: new SchemaField({ value: int(0), max: int(0) }),
      encumbrance: int(0, { min: 0 }),
      enhancementSlots: int(0, { min: 0 }),
      resistances: new SchemaField({
        slashing: new BooleanField({ initial: false }),
        piercing: new BooleanField({ initial: false }),
        bludgeoning: new BooleanField({ initial: false }),
        elemental: new BooleanField({ initial: false }),
        bleeding: new BooleanField({ initial: false }),
        poison: new BooleanField({ initial: false })
      }),
      effectsText: str(""),
      relic: new BooleanField({ initial: false }),
      mods: modsField(),
      // Усиления брони и глифы: {name, kind, sp, resist[], effect, element}
      enhancements: new ArrayField(new SchemaField({
        name: str(""), kind: str("armor"), sp: int(0), resist: new ArrayField(new StringField()),
        effect: str(""), element: str(""), slots: int(1, { min: 0 })
      }))
    };
  }

  /** Занятые ячейки усиления: глиф или набор — одна, малое зачарование — две, большое — три. */
  get usedSlots() { return this.enhancements.reduce((n, e) => n + (e.slots || 1), 0); }
  get freeSlots() { return Math.max(0, this.enhancementSlots - this.usedSlots); }

  /** Сопротивления с учётом усилений. */
  get allResistances() {
    const out = new Set(Object.entries(this.resistances).filter(([, v]) => v).map(([k]) => k));
    for (const e of this.enhancements) for (const r of e.resist) out.add(r);
    return [...out];
  }

  /** Какие части тела закрывает (есть ненулевая прочность). */
  get covers() {
    return Object.entries(this.sp).filter(([, v]) => v.max > 0).map(([k]) => k);
  }
}

export class GearData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...physical(),
      category: str("general"),
      effect: str(""),
      // Фокусирующий предмет (амулет): −N к затратам Вын на магию, минимум 1 (стр. 92, 167)
      focus: int(0, { min: 0 }),
      // Набор инструментов: алхимика, ремесленника, кузница… (стр. 92)
      tool: str("")
    };
  }
}

/** Компонент ремесла или алхимический ингредиент (стр. 128–129, 143–145). */
export class ComponentData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...physical(),
      group: str("materials"),
      substance: str(""),
      forage: new SchemaField({ where: str(""), quantity: str(""), dc: int(0, { min: 0 }) })
    };
  }
}

/** Чертёж или формула (стр. 127, 130–139, 142, 146–147, 249–250, 255). */
export class RecipeData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const substances = {};
    for (const k of ["vitriol", "rebis", "aether", "quebrith", "hydragenum", "vermilion", "sol", "caelum", "fulgur"]) {
      substances[k] = int(0, { min: 0 });
    }
    return {
      description: html(),
      kind: str("blueprint"),
      category: str("other"),
      level: str("novice"),
      dc: int(10, { min: 0 }),
      time: str(""),
      skill: str("crafting"),
      components: new ArrayField(new SchemaField({ name: str(""), quantity: int(1, { min: 1 }) })),
      substances: new SchemaField(substances),
      result: new SchemaField({ name: str(""), type: str("gear"), quantity: int(1, { min: 1 }) }),
      surcharge: int(0, { min: 0 }),
      cost: num(0, { min: 0 }),
      needsForge: new BooleanField({ initial: false }),
      memorized: new BooleanField({ initial: false }),
      quantity: int(1, { min: 0 }),
      weight: num(0, { min: 0 }),
      source: source()
    };
  }

  get isFormula() { return this.kind === "formula"; }
  get substanceList() { return Object.entries(this.substances).filter(([, n]) => n > 0); }
}

/** Алхимический предмет: составы, эликсиры, масла, отвары, мутагены, бомбы, ловушки (стр. 87–89, 247–255). */
export class AlchemicalData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...physical(),
      kind: str("preparation"),
      effect: str(""),
      toxicity: int(0, { min: 0 }),
      duration: str(""),
      durationRounds: int(0, { min: 0 }),
      durationMinutes: int(0, { min: 0 }),
      oilTarget: str(""),
      use: new SchemaField({
        action: str(""),
        damage: str(""),
        damageType: str("elemental"),
        area: str(""),
        range: str(""),
        status: str(""),
        statusChance: int(100, { min: 0, max: 100 }),
        statusRounds: str(""),
        removeStatuses: new ArrayField(new StringField()),
        regen: int(0, { min: 0 }),
        heal: int(0, { min: 0 }),
        charges: int(1, { min: 1 }),
        clearToxicity: new BooleanField({ initial: false })
      }),
      // Изменения активного эффекта при употреблении: [{key, type, value, phase}]
      changes: new ArrayField(new foundry.data.fields.ObjectField()),
      // Мутаген: постоянные модификаторы после приёма
      mods: modsField(),
      applied: new BooleanField({ initial: false }),
      mutagen: new SchemaField({ color: str(""), dc: int(0, { min: 0 }), minor: str("") })
    };
  }

  get isMutagen() { return this.kind === "mutagen"; }
}

/** Усиление брони, руна или глиф (стр. 90, 256). */
export class EnhancementData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...physical(),
      kind: str("armor"),
      effect: str(""),
      sp: int(0),
      resistances: new ArrayField(new StringField()),
      weaponEffect: new SchemaField({ key: str(""), value: str("") }),
      element: str(""),
      // Зачарование словом: «small» — две ячейки, «large» — три
      size: str("")
    };
  }
}

/** Магия: заклинания, инвокации, знаки, ритуалы, порча (стр. 99–123). */
export class SpellData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const status = () => new SchemaField({ status: str(""), chance: str("100") });
    return {
      description: html(),
      kind: str("spell"),
      level: str("novice"),
      element: str("mixed"),
      branch: str(""),
      god: str(""),
      staCost: int(1, { min: 0 }),
      // Чем платят: "" — Выносливость (и Энергия), "blood" — Очки Крови (при нехватке — Вын), "sta" — только Вын
      resource: str(""),
      variableCost: new BooleanField({ initial: false }),
      maxCost: int(0, { min: 0 }),
      maintainCost: int(0, { min: 0 }),
      maintainMode: str(""),            // "" — фиксированная, "half" — ½ вложенной, "full" — вся вложенная
      effect: str(""),
      range: str(""),
      duration: str(""),
      defense: str("none"),
      defenseText: str(""),
      // Ритуалы и порча
      preparation: str(""),
      dc: int(0),
      dcText: str(""),
      ingredients: str(""),
      altIngredients: str(""),
      danger: str(""),
      removal: str(""),
      // Автоматизация в бою: @sta — вложенная Вын, @margin — превышение защиты
      automation: new SchemaField({
        damage: str(""),
        damageType: str("elemental"),
        location: str(""),
        ignoreArmor: new BooleanField({ initial: false }),
        canCrit: new BooleanField({ initial: false }),
        staDamage: str(""),
        statuses: new ArrayField(status()),
        statusRounds: str(""),
        statusesByCost: new foundry.data.fields.ObjectField(),
        regen: new SchemaField({ hp: int(0, { min: 0 }), rounds: str("") }),
        shieldPerSta: int(0, { min: 0 }),
        shieldRounds: int(0, { min: 0 })
      }),
      source: source()
    };
  }

  get isRitual() { return this.kind === "ritual"; }
  /** Вампирская магия высшего вампира: проверка — базовый навык роли, оплата — Очки Крови. */
  get isVampire() { return this.kind === "vampire"; }
  get isHex() { return this.kind === "hex"; }
  get skill() { return CONFIG.VEDMAK.MAGIC_SKILL[this.kind] ?? "spellCasting"; }
  get targeting() { return CONFIG.VEDMAK.targetingFor(this.range); }
  get hasEffect() {
    const a = this.automation;
    return !!(a.damage || a.staDamage || a.statuses.length || Object.keys(a.statusesByCost ?? {}).length || a.regen.hp || a.shieldPerSta);
  }

  /** Стоимость поддержания за раунд при вложенной Вын. */
  maintainFor(spent) {
    if (this.maintainMode === "full") return spent;
    if (this.maintainMode === "half") return Math.max(1, Math.ceil(spent / 2));
    return this.maintainCost;
  }
}

/** Способность древа профессии: название, параметр, описание, механика и вложенные очки. */
function abilityField() {
  return new SchemaField({
    name: str(""),
    stat: str("int"),
    description: str(""),
    mechanic: str(""),
    value: int(0, { min: 0 })
  });
}

/**
 * Профессия (стр. 37–46, 61–70). Предмет живёт на персонаже, поэтому очки определяющего навыка
 * и способностей древа хранятся прямо в нём.
 */
export class ProfessionData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      key: str(""),
      description: html(),
      definingSkill: new SchemaField({
        name: str(""), stat: str("int"), value: int(0, { min: 0 }), effect: str(""),
        // Как и у способностей древа: Энергия по уровню («Том Альзура»: Провидец, Псионик)
        mechanic: str("")
      }),
      vigor: int(0, { min: 0 }),
      magicAbilities: str(""),
      // Стартовая магия: сколько чего выбрать (знаки ведьмака — все базовые)
      magicQuota: new SchemaField({
        spell: int(0, { min: 0 }), invocation: int(0, { min: 0 }), ritual: int(0, { min: 0 }),
        hex: int(0, { min: 0 }), sign: int(0, { min: 0 }), allBasicSigns: new BooleanField({ initial: false })
      }),
      skills: new ArrayField(new StringField()),
      // Выбор навыков: «Язык (выберите 1)», «любые 5 боевых»
      skillChoices: new ArrayField(new SchemaField({
        label: str(""), count: int(1, { min: 1 }), options: new ArrayField(new StringField())
      })),
      startingMoney: int(0),
      gear: str(""),
      gearChoice: new SchemaField({
        count: int(5, { min: 0 }), options: new ArrayField(new StringField())
      }),
      gearFixed: new ArrayField(new StringField()),
      allowedRaces: new ArrayField(new StringField()),
      branches: new ArrayField(new SchemaField({
        name: str(""),
        abilities: new ArrayField(abilityField())
      })),
      source: source()
    };
  }

  /** Способность по адресу «ветвь.номер». */
  ability(branch, index) {
    return this.branches[branch]?.abilities[index] ?? null;
  }

  /**
   * Доступна ли способность для изучения: первая в ветви — после 5 очков в определяющем навыке,
   * следующие — после 5 очков в предыдущей (стр. 61).
   */
  isUnlocked(branch, index) {
    if (index === 0) return this.definingSkill.value >= 5;
    return (this.ability(branch, index - 1)?.value ?? 0) >= 5;
  }
}

/** Раса (стр. 20–24): черты текстом и модификаторы строками {target, value}. */
export class RaceData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      key: str(""),
      description: html(),
      traits: new ArrayField(new SchemaField({ name: str(""), effect: str("") })),
      mods: new ArrayField(new SchemaField({ target: str("stats.ref"), value: int(0) })),
      // Что раса даёт предметом: естественное оружие врана и боболака (названия из компендиума)
      grants: new ArrayField(new StringField()),
      canUseMagic: new BooleanField({ initial: true }),
      // Свой ресурс расы: "blood" — Очки Крови высшего вампира (максимум — максимум ПЗ) и Шкала Зверя
      resource: str(""),
      // Роли — ветки расовых навыков (Монарх, Заклинатель крови, Повелитель Теней); у вампира одна роль на всю жизнь:
      // после прокачки её древа другая не даётся
      roles: new ArrayField(new SchemaField({ key: str(""), name: str(""), base: str(""), description: str("") })),
      role: str(""),
      // Расовые навыки: база роли, ступени древа (открываются за ОК), навыки за опыт, уровни, стадии
      powers: new ArrayField(new SchemaField({
        key: str(""), name: str(""), group: str("core"), kind: str("tree"), stat: str(""),
        roll: new BooleanField({ initial: false }), dc: int(0), max: int(10, { min: 1 }),
        unlockCost: int(0, { min: 0 }), levelCost: int(0, { min: 0 }),
        stageCosts: new ArrayField(int(0)),
        requires: str(""), cost: str(""), range: str(""), duration: str(""), defense: str(""), page: str(""),
        description: str(""), value: int(0, { min: 0 })
      })),
      source: source()
    };
  }

  power(key) { return this.powers.find(p => p.key === key) ?? null; }

  /** Роль персонажа (одна) — списком, как её ждут лист и мастер. */
  get activeRoles() { return this.role ? [this.role] : []; }

  /** Базовый навык роли — проверка её заклинаний. */
  roleBase(role) { return this.power(this.roles.find(r => r.key === role)?.base ?? ""); }

  /** Открыта ли ступень: предыдущая (`requires`) изучена. */
  isUnlockable(power) {
    if (!power.requires) return true;
    return (this.power(power.requires)?.value ?? 0) > 0;
  }
}
