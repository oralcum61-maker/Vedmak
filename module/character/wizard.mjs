// Мастер создания персонажа (корник стр. 20–71, 237–245):
// раса → происхождение → жизненный путь → профессия → параметры → навыки → магия → снаряжение → итог.

import { STATS, STAT_POINT_BUY } from "../config/stats.mjs";
import { SKILLS } from "../config/skills.mjs";
import {
  HOMELANDS, ORIGIN_REGIONS, NATIVE_LANGUAGE_LEVEL, WITCHER_SCHOOLS, CREATION, nativeLanguage,
  creationSkillCost, HEX_DANGER_LEVEL
} from "../config/character.mjs";
import { levelLabel } from "../config/magic.mjs";
import {
  buildLifepath, clearRoll, dependents, choiceSkillOptions, rollDie, lifepathCards, setDecadeRisk, writeLifepath,
  rollLifepathStep, rollLifepathSection, rollLifepathRest, postLifepathRolls
} from "./lifepath.mjs";
import { chooseDetailSkills, removeRaceExtras } from "./race.mjs";
import { compareRu } from "../util.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const STEPS = [
  { id: "race",       label: "Раса",            icon: "fa-solid fa-people-group" },
  { id: "origin",     label: "Происхождение",   icon: "fa-solid fa-map-location-dot" },
  { id: "lifepath",   label: "Жизненный путь",  icon: "fa-solid fa-dice" },
  { id: "profession", label: "Профессия",       icon: "fa-solid fa-sitemap" },
  { id: "stats",      label: "Параметры",       icon: "fa-solid fa-user-shield" },
  { id: "skills",     label: "Навыки",          icon: "fa-solid fa-list-check" },
  { id: "magic",      label: "Магия",           icon: "fa-solid fa-hand-sparkles" },
  { id: "gear",       label: "Снаряжение",      icon: "fa-solid fa-sack" },
  { id: "summary",    label: "Итог",            icon: "fa-solid fa-scroll" }
];

const STAT_KEYS = Object.keys(STATS);

/** Горные народы: родина по умолчанию — Махакам (краснолюды — корник, гномы, враны, боболаки — «Книга сказаний»). */
const MOUNTAIN_RACES = ["dwarf", "gnome", "vran", "bobolak"];

export class CharacterWizard extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor({ actor, ...options } = {}) {
    super(options);
    this.actor = actor;
    const d = actor.system.details;
    this.wiz = {
      step: "race",
      name: actor.name, gender: d.gender ?? "", age: Number.parseInt(d.age) || 25,
      raceUuid: "", origin: "", homeland: "", homelandRoll: null, vassalRoll: null, language: "",
      lifepath: true, rolls: {},
      professionUuid: "", skillChoices: {},
      statMode: "points", level: "average",
      stats: Object.fromEntries(STAT_KEYS.map(k => [k, 5])),
      pool: [], assign: {},
      profSkills: {}, defining: 1, pickup: {},
      magic: [],
      money: null, gear: []
    };
    this.data = null;
  }

  static DEFAULT_OPTIONS = {
    id: "vedmak-character-wizard-{id}",
    classes: ["vedmak", "sheet", "vedmak-wizard"],
    tag: "div",
    window: { title: "Мастер создания персонажа", icon: "fa-solid fa-wand-magic-sparkles", resizable: true },
    position: { width: 900, height: 780 },
    actions: {
      step: CharacterWizard.#onStep,
      next: CharacterWizard.#onNext,
      prev: CharacterWizard.#onPrev,
      pickRace: CharacterWizard.#onPickRace,
      pickProfession: CharacterWizard.#onPickProfession,
      rollOrigin: CharacterWizard.#onRollOrigin,
      reroll: CharacterWizard.#onReroll,
      rerollAll: CharacterWizard.#onRerollAll,
      lpStep: CharacterWizard.#onLifepathStep,
      lpSection: CharacterWizard.#onLifepathSection,
      lpRest: CharacterWizard.#onLifepathRest,
      rollStats: CharacterWizard.#onRollStats,
      rollMoney: CharacterWizard.#onRollMoney,
      apply: CharacterWizard.#onApply
    }
  };

  static PARTS = {
    main: { template: "systems/vedmak/templates/apps/wizard.hbs", scrollable: [".wizard-body"] }
  };

  get title() {
    return `Мастер создания персонажа: ${this.actor.name}`;
  }

  /* ------------------------------ Данные ------------------------------ */

  /** Расы, профессии и магия из компендиумов системы и мира. */
  async #loadData() {
    if (this.data) return this.data;
    const docsOf = async type => {
      const out = [];
      for (const pack of game.packs.filter(p => p.documentName === "Item")) {
        const index = await pack.getIndex({ fields: ["type"] });
        if (!index.some(i => i.type === type)) continue;
        const docs = await pack.getDocuments({ type });
        out.push(...docs);
      }
      out.push(...game.items.filter(i => i.type === type));
      return out;
    };
    const magic = [];
    for (const pack of game.packs.filter(p => p.documentName === "Item")) {
      const index = await pack.getIndex({ fields: ["type", "system.kind", "system.level", "system.danger", "system.branch", "system.staCost"] });
      for (const e of index) if (e.type === "spell") magic.push({ ...e, uuid: e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}` });
    }
    for (const i of game.items.filter(i => i.type === "spell")) {
      magic.push({ _id: i.id, uuid: i.uuid, name: i.name, img: i.img, type: "spell", system: i.system });
    }
    const byName = (x, y) => compareRu(x.name, y.name);
    this.data = { races: (await docsOf("race")).sort(byName), professions: (await docsOf("profession")).sort(byName), magic };
    return this.data;
  }

  get race() { return this.data?.races.find(r => r.uuid === this.wiz.raceUuid) ?? null; }
  get profession() { return this.data?.professions.find(p => p.uuid === this.wiz.professionUuid) ?? null; }
  get raceKey() { return this.race?.system.key ?? ""; }
  get isWitcher() { return this.raceKey === "witcher"; }

  /** От чего зависит жизненный путь: ведьмак ли, возраст, регион, раса. */
  get #lifepathOpts() {
    const s = this.wiz;
    return { witcher: this.isWitcher, age: s.age, region: s.origin || "north", race: this.raceKey };
  }

  /**
   * Жизненный путь по текущим броскам (пересобирается при каждом рендере). Пошагово: недостающие
   * броски не делаются, `next` — какой бросок следующий.
   */
  #lifepath() {
    const s = this.wiz;
    if (!s.lifepath || !this.race) return { sections: [], effects: null, next: null };
    return buildLifepath(s.rolls, { ...this.#lifepathOpts, step: true });
  }

  /** Идёт бросок пути: второй щелчок не бросает ту же строку дважды. */
  #lifepathBusy = false;

  /** Следующий бросок пути — в чат. */
  async #lifepathStep() {
    if (this.#lifepathBusy) return;
    this.#lifepathBusy = true;
    try {
      const res = await rollLifepathStep(this.wiz.rolls, this.#lifepathOpts);
      if (res) await postLifepathRolls(this.actor, res.rows, { roll: res.roll, name: this.wiz.name });
    } finally {
      this.#lifepathBusy = false;
    }
  }

  /** Модификаторы параметров от расы и жизненного пути. */
  #statParts(lp) {
    const race = {}, caps = {}, floors = {};
    for (const { target, value } of this.race?.system.mods ?? []) {
      const [g, k] = target.split(".");
      if (g === "stats") race[k] = (race[k] ?? 0) + value;
      if (g === "cap") caps[k] = value;
      if (g === "floor") floors[k] = value;
    }
    const life = { ...(lp.effects?.statMods ?? {}) };
    if (lp.effects?.luck) life.luck = (life.luck ?? 0) + lp.effects.luck;
    return { race, life, caps, floors };
  }

  /** Базовые значения параметров (очки или распределённые броски). */
  #baseStats() {
    const s = this.wiz;
    if (s.statMode === "points") return { ...s.stats };
    return Object.fromEntries(STAT_KEYS.map(k => [k, s.pool[s.assign[k]] ?? 0]));
  }

  #finalStats(lp) {
    const base = this.#baseStats();
    const { race, life, caps, floors } = this.#statParts(lp);
    return Object.fromEntries(STAT_KEYS.map(k => {
      let v = base[k] + (race[k] ?? 0) + (life[k] ?? 0);
      if (caps[k] !== undefined) v = Math.min(v, caps[k]);
      if (floors[k] !== undefined) v = Math.max(v, floors[k]);
      return [k, Math.max(0, v)];
    }));
  }

  /** Навыки профессии: перечисленные и выбранные, без родного языка. */
  #professionSkillKeys() {
    const prof = this.profession;
    if (!prof) return [];
    const keys = [...prof.system.skills];
    prof.system.skillChoices.forEach((c, i) => {
      for (const k of this.wiz.skillChoices[i] ?? []) if (!keys.includes(k)) keys.push(k);
    });
    return keys;
  }

  get nativeLanguageKey() {
    if (this.isWitcher) return this.wiz.language || "langCommon";
    return this.wiz.language || nativeLanguage(this.wiz.homeland);
  }

  /** Бонусы жизненного пути и родины к навыкам (не выше предела при создании). */
  #skillBonuses(lp) {
    const out = {};
    const add = (k, n) => (out[k] = (out[k] ?? 0) + n);
    const home = HOMELANDS[this.wiz.homeland];
    if (home && !this.isWitcher) add(home.skill, 1);
    for (const [k, n] of Object.entries(lp.effects?.skills ?? {})) add(k, n);
    return out;
  }

  /** Итоговые значения навыков с учётом бонусов и выборов «+1 или новый +2». */
  #finalSkills(lp) {
    const s = this.wiz;
    const bonuses = this.#skillBonuses(lp);
    const values = {};
    for (const k of Object.keys(SKILLS)) values[k] = (s.profSkills[k] ?? 0) + (s.pickup[k] ?? 0);
    for (const [k, n] of Object.entries(bonuses)) values[k] = Math.min(CREATION.skillCapCreation, Math.max(values[k], values[k] + n));
    for (const choice of lp.effects?.skillChoices ?? []) {
      const key = s.rolls[choice.path];
      if (!key || !SKILLS[key]) continue;
      values[key] = values[key] > 0 ? Math.min(CREATION.skillCapCreation, values[key] + 1) : 2;
    }
    const native = this.nativeLanguageKey;
    if (native) values[native] = Math.max(values[native], NATIVE_LANGUAGE_LEVEL);
    return values;
  }

  /* ------------------------------ Контекст ------------------------------ */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    await this.#loadData();
    const s = this.wiz;
    const lp = this.#lifepath();
    const race = this.race, prof = this.profession;
    const stepIndex = STEPS.findIndex(x => x.id === s.step);
    const validation = this.#validate(lp);

    Object.assign(context, {
      state: s, stepIndex, isFirst: stepIndex === 0, isLast: stepIndex === STEPS.length - 1,
      steps: STEPS.map((x, i) => ({ ...x, active: x.id === s.step, done: !validation[x.id], problem: validation[x.id] })),
      stepId: s.step, problem: validation[s.step], [`is_${s.step}`]: true,
      race, profession: prof, isWitcher: this.isWitcher
    });

    if (s.step === "race") {
      context.races = this.data.races.map(r => ({
        uuid: r.uuid, name: r.name, img: r.img, selected: r.uuid === s.raceUuid,
        description: r.system.description, traits: r.system.traits
      }));
    }

    if (s.step === "origin") {
      context.origins = Object.entries(ORIGIN_REGIONS).map(([k, v]) => ({ key: k, label: v.label, selected: k === s.origin }));
      context.homelands = Object.entries(HOMELANDS)
        .filter(([, h]) => !s.origin || h.region === s.origin)
        .map(([k, h]) => ({ key: k, label: `${h.label} (+1 ${SKILLS[h.skill].label})`, selected: k === s.homeland }));
      context.languages = ["langCommon", "langElder", "langDwarven"].map(k => ({ key: k, label: SKILLS[k].label, selected: k === this.nativeLanguageKey }));
      context.homelandInfo = HOMELANDS[s.homeland];
      context.homelandSkill = context.homelandInfo ? SKILLS[context.homelandInfo.skill].label : "";
      context.originHint = this.raceKey === "elf" ? "Эльфы родом из земель Старших Народов (Доль Блатанна)."
        : this.raceKey === "dwarf" ? "Краснолюды родом из земель Старших Народов (Махакам)."
        : this.raceKey === "gnome" ? "Гномы живут общинами в Махакаме и горах Тир Тохаир."
        : ["vran", "bobolak"].includes(this.raceKey) ? "Враны и боболаки держатся горных общин Старших Народов; по умолчанию — Махакам."
        : "Люди: нечётный результат d10 — Королевства Севера, чётный — Империя Нильфгаард.";
    }

    if (s.step === "lifepath") {
      context.lifepathCards = lifepathCards(lp.sections, { editable: true, action: "reroll", nextAction: "lpStep", sectionAction: "lpSection" });
      context.lifepathNext = lp.next;
      context.lifeChoices = (lp.effects?.skillChoices ?? []).map(c => ({
        ...c, options: choiceSkillOptions(c).map(o => ({ ...o, selected: s.rolls[c.path] === o.value }))
      }));
      context.effectsSummary = this.#effectsSummary(lp.effects);
    }

    if (s.step === "profession") {
      context.professions = this.data.professions.map(p => {
        const allowed = !p.system.allowedRaces.length || !this.raceKey || p.system.allowedRaces.includes(this.raceKey);
        return { uuid: p.uuid, name: p.name, img: p.img, selected: p.uuid === s.professionUuid, allowed,
          vigor: p.system.vigor, defining: p.system.definingSkill.name };
      });
      if (prof) {
        context.profInfo = {
          description: prof.system.description,
          defining: prof.system.definingSkill,
          definingStat: STATS[prof.system.definingSkill.stat]?.label,
          skills: prof.system.skills.map(k => SKILLS[k]?.label ?? k).join(", "),
          money: prof.system.startingMoney,
          magic: prof.system.magicAbilities,
          branches: prof.system.branches.map(b => ({ name: b.name, abilities: b.abilities.map(a => a.name).join(" → ") })),
          choices: prof.system.skillChoices.map((c, i) => ({
            label: c.label, count: c.count, index: i,
            options: c.options.filter(k => k !== this.nativeLanguageKey).map(k => ({
              key: k, label: SKILLS[k]?.label ?? k, checked: (s.skillChoices[i] ?? []).includes(k),
              taken: prof.system.skills.includes(k)
            }))
          }))
        };
      }
    }

    if (s.step === "stats") {
      const { race: rm, life } = this.#statParts(lp);
      const base = this.#baseStats();
      const final = this.#finalStats(lp);
      const budget = STAT_POINT_BUY[s.level]?.points ?? 60;
      const spent = STAT_KEYS.reduce((sum, k) => sum + (s.stats[k] || 0), 0);
      context.levels = Object.entries(STAT_POINT_BUY).map(([k, v]) => ({ key: k, label: `${v.label} (${v.points})`, selected: k === s.level }));
      context.statRows = STAT_KEYS.map(k => ({
        key: k, label: STATS[k].label, abbr: STATS[k].abbr, base: base[k], race: rm[k] ?? 0, life: life[k] ?? 0, final: final[k],
        poolOptions: s.pool.map((v, i) => ({ index: i, value: v, selected: s.assign[k] === i,
          used: Object.entries(s.assign).some(([sk, idx]) => idx === i && sk !== k) }))
      }));
      context.budget = budget; context.spent = spent; context.remaining = budget - spent;
      const bw = Math.floor((final.body + final.will) / 2);
      context.preview = [
        { label: "ПЗ", value: bw * 5 + (lp.effects?.hpBonus ?? 0) }, { label: "Вын", value: bw * 5 + (lp.effects?.staBonus ?? 0) },
        { label: "Уст", value: Math.min(10, bw) }, { label: "Отдых", value: bw },
        { label: "Бег", value: final.spd * 3 }, { label: "Вес", value: final.body * 10 },
        { label: "Реш", value: Math.floor((final.will + final.int) / 2) * 5 }
      ];
      context.witcherNote = this.isWitcher ? "Ведьмак: −4 к Эмп (не ниже 1, не выше 6), +1 к Реа и Лвк (могут быть больше 10)." : "";
    }

    if (s.step === "skills") {
      const final = this.#finalStats(lp);
      const profKeys = this.#professionSkillKeys();
      const bonuses = this.#skillBonuses(lp);
      const native = this.nativeLanguageKey;
      const profSpent = profKeys.reduce((sum, k) => sum + creationSkillCost(s.profSkills[k] ?? 0, SKILLS[k]?.difficult), 0) + (s.defining || 0);
      const pickupBudget = final.int + final.ref;
      const pickupSpent = Object.entries(s.pickup).reduce((sum, [k, v]) => sum + creationSkillCost(v || 0, SKILLS[k]?.difficult), 0);
      const finalSkills = this.#finalSkills(lp);
      context.definingSkill = prof ? { name: prof.system.definingSkill.name, stat: STATS[prof.system.definingSkill.stat]?.abbr, value: s.defining } : null;
      context.profSkillRows = profKeys.map(k => ({
        key: k, label: SKILLS[k].label, stat: STATS[SKILLS[k].stat].abbr, difficult: SKILLS[k].difficult,
        value: s.profSkills[k] ?? 0, bonus: bonuses[k] ?? 0, final: finalSkills[k], native: k === native
      }));
      context.pickupRows = Object.entries(SKILLS).filter(([k]) => !profKeys.includes(k)).map(([k, def]) => ({
        key: k, label: def.label, stat: STATS[def.stat].abbr, difficult: def.difficult,
        value: s.pickup[k] ?? 0, bonus: bonuses[k] ?? 0, final: finalSkills[k], native: k === native
      }));
      Object.assign(context, {
        profSpent, profBudget: CREATION.professionSkillPoints, profRemaining: CREATION.professionSkillPoints - profSpent,
        pickupBudget, pickupSpent, pickupRemaining: pickupBudget - pickupSpent, cap: CREATION.skillCapCreation,
        nativeLabel: SKILLS[native]?.label
      });
    }

    if (s.step === "magic") {
      context.magicGroups = this.#magicGroups().map(g => ({
        ...g, chosen: g.items.filter(i => s.magic.includes(i.uuid)).length,
        items: g.items.map(i => ({ ...i, checked: g.auto || s.magic.includes(i.uuid) }))
      }));
    }

    if (s.step === "gear" && prof) {
      context.gearOptions = prof.system.gearChoice.options.map(name => ({ name, checked: s.gear.includes(name) }));
      context.gearCount = prof.system.gearChoice.count;
      context.gearFixed = prof.system.gearFixed;
      context.lifeItems = lp.effects?.items ?? [];
      context.moneyBase = prof.system.startingMoney;
    }

    if (s.step === "summary") {
      context.summary = this.#summary(lp);
    }
    return context;
  }

  /** Группы стартовой магии по квоте профессии. */
  /** Стартовая магия профессии — считается один раз на профессию: список сотен заклинаний не меняется. */
  #magicCache = null;

  #magicGroups() {
    const prof = this.profession;
    if (!prof) return [];
    if (this.#magicCache?.prof === prof) return this.#magicCache.groups;
    const groups = this.#buildMagicGroups(prof);
    this.#magicCache = { prof, groups };
    return groups;
  }

  #buildMagicGroups(prof) {
    const q = prof.system.magicQuota;
    const all = this.data.magic;
    const novice = e => {
      const sys = e.system ?? {};
      if (sys.kind === "hex") return (HEX_DANGER_LEVEL[String(sys.danger ?? "").toLowerCase()] ?? sys.level) === "novice";
      return sys.level === "novice";
    };
    const pick = kind => all.filter(e => e.system?.kind === kind && novice(e))
      .map(e => ({ uuid: e.uuid, name: e.name, img: e.img, level: levelLabel(kind, e.system.level), cost: e.system.staCost }))
      .sort((a, b) => compareRu(a.name, b.name));
    const groups = [];
    if (q.allBasicSigns) groups.push({ kind: "sign", label: "Все базовые знаки", count: 0, auto: true, items: pick("sign") });
    const labels = { spell: "Заклинания новичка", invocation: "Инвокации новичка", ritual: "Ритуалы новичка", hex: "Порча низкой опасности", sign: "Знаки" };
    for (const kind of ["spell", "invocation", "ritual", "hex", "sign"]) {
      if (q[kind] > 0) groups.push({ kind, label: labels[kind], count: q[kind], auto: false, items: pick(kind) });
    }
    return groups;
  }

  /** Что не так на каждом шаге (пусто — всё в порядке). */
  #validate(lp) {
    const s = this.wiz;
    const out = {};
    const race = this.race, prof = this.profession;
    if (!race) out.race = "Выберите расу.";
    if (!this.isWitcher && !s.homeland) out.origin = "Выберите родину.";
    if (!prof) out.profession = "Выберите профессию.";
    else {
      const allowed = prof.system.allowedRaces;
      if (race && allowed.length && !allowed.includes(race.system.key)) out.profession = `${prof.name} недоступен для расы «${race.name}».`;
      prof.system.skillChoices.forEach((c, i) => {
        if ((s.skillChoices[i] ?? []).length !== c.count) out.profession ??= `${c.label}: выбрано ${(s.skillChoices[i] ?? []).length} из ${c.count}.`;
      });
    }
    if (s.statMode === "points") {
      const spent = STAT_KEYS.reduce((sum, k) => sum + (s.stats[k] || 0), 0);
      const budget = STAT_POINT_BUY[s.level]?.points ?? 60;
      if (spent !== budget) out.stats = `Распределено ${spent} очков из ${budget}.`;
      if (STAT_KEYS.some(k => s.stats[k] < CREATION.statMin || s.stats[k] > CREATION.statCap)) out.stats = "Параметр — от 1 до 10.";
    } else {
      if (s.pool.length !== 9) out.stats = "Бросьте кости параметров.";
      else if (STAT_KEYS.some(k => s.assign[k] === undefined)) out.stats = "Распределите все результаты бросков.";
      else if (new Set(Object.values(s.assign)).size !== 9) out.stats = "Каждый результат можно использовать один раз.";
    }
    if (prof) {
      const keys = this.#professionSkillKeys();
      const spent = keys.reduce((sum, k) => sum + creationSkillCost(s.profSkills[k] ?? 0, SKILLS[k]?.difficult), 0) + (s.defining || 0);
      if (keys.some(k => (s.profSkills[k] ?? 0) < 1) || s.defining < 1) out.skills = "В каждый навык профессии — хотя бы 1 очко.";
      else if (spent !== CREATION.professionSkillPoints) out.skills = `Навыки профессии: потрачено ${spent} из ${CREATION.professionSkillPoints}.`;
      const final = this.#finalStats(lp);
      const pickupSpent = Object.entries(s.pickup).reduce((sum, [k, v]) => sum + creationSkillCost(v || 0, SKILLS[k]?.difficult), 0);
      if (!out.skills && pickupSpent > final.int + final.ref) out.skills = `Освоенные навыки: потрачено ${pickupSpent} из ${final.int + final.ref}.`;
      for (const g of this.#magicGroups()) {
        if (g.auto) continue;
        const n = g.items.filter(i => s.magic.includes(i.uuid)).length;
        if (n !== g.count) { out.magic = `${g.label}: выбрано ${n} из ${g.count}.`; break; }
      }
      if (s.money === null) out.gear = "Бросьте начальный капитал.";
      else if (s.gear.length !== prof.system.gearChoice.count && prof.system.gearChoice.options.length) {
        out.gear = `Снаряжение: выбрано ${s.gear.length} из ${prof.system.gearChoice.count}.`;
      }
    } else {
      out.skills = out.magic = out.gear = "Сначала выберите профессию.";
    }
    if (s.lifepath && race && lp.next) out.lifepath = "Жизненный путь брошен не до конца.";
    for (const k of Object.keys(out)) if (!out[k]) delete out[k];
    const blocking = ["race", "origin", "lifepath", "profession", "stats", "skills", "magic", "gear"].find(k => out[k]);
    if (blocking) out.summary = `Не завершён шаг «${STEPS.find(x => x.id === blocking).label}».`;
    return out;
  }

  #effectsSummary(fx) {
    if (!fx) return [];
    const lines = [];
    if (fx.crowns) lines.push(`+${fx.crowns} крон`);
    if (fx.reputation) lines.push(`+${fx.reputation} к репутации`);
    if (fx.luck) lines.push(`+${fx.luck} к Удаче`);
    if (fx.hpBonus) lines.push(`${fx.hpBonus} ПЗ навсегда`);
    if (fx.staBonus) lines.push(`${fx.staBonus} Вын навсегда`);
    if (fx.vigorBonus) lines.push(`${fx.vigorBonus} к Энергии`);
    if (fx.feared) lines.push("социальный статус: опасение");
    if (fx.definingBonus) lines.push(`+${fx.definingBonus} к определяющему навыку`);
    for (const [k, v] of Object.entries(fx.statMods)) if (v) lines.push(`${v > 0 ? "+" : ""}${v} к ${STATS[k].abbr}`);
    for (const [k, v] of Object.entries(fx.skills)) lines.push(`+${v} к навыку «${SKILLS[k].label}»`);
    for (const [k, v] of Object.entries(fx.skillMods)) lines.push(`${v} к навыку «${SKILLS[k].label}»`);
    if (fx.school) lines.push(WITCHER_SCHOOLS[fx.school].label);
    if (fx.addictions.length) lines.push(`зависимость (${fx.addictions.length})`);
    for (const i of fx.items) lines.push(`предмет: ${i}`);
    for (const n of fx.notes) lines.push(n);
    return lines;
  }

  #summary(lp) {
    const s = this.wiz;
    const prof = this.profession;
    const final = this.#finalStats(lp);
    const skills = this.#finalSkills(lp);
    const money = (s.money?.total ?? 0) + (lp.effects?.crowns ?? 0);
    return {
      name: s.name, race: this.race?.name, profession: prof?.name, age: s.age, gender: s.gender,
      homeland: HOMELANDS[s.homeland]?.label ?? "—",
      stats: STAT_KEYS.map(k => ({ abbr: STATS[k].abbr, value: final[k] })),
      skills: Object.entries(skills).filter(([, v]) => v > 0).map(([k, v]) => `${SKILLS[k].label} ${v}`).join(", "),
      defining: prof ? `${prof.system.definingSkill.name} ${s.defining + (lp.effects?.definingBonus ?? 0)}` : "",
      money,
      gear: [...(prof?.system.gearFixed ?? []), ...s.gear, ...(lp.effects?.items ?? [])].join(", "),
      magic: this.#magicGroups().flatMap(g => g.items.filter(i => g.auto || s.magic.includes(i.uuid)).map(i => i.name)).join(", "),
      effects: this.#effectsSummary(lp.effects)
    };
  }

  /* ------------------------------ Ввод ------------------------------ */

  _onRender(context, options) {
    super._onRender(context, options);
    const s = this.wiz;
    for (const el of this.element.querySelectorAll("[data-field]")) {
      el.addEventListener("change", event => {
        const field = el.dataset.field;
        const value = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
        this.#setField(field, value, el);
        this.render();
      });
    }
    // Поведение ведьмака в десятилетии
    for (const el of this.element.querySelectorAll("select[data-lp-risk]")) {
      el.addEventListener("change", () => {
        setDecadeRisk(s.rolls, el.dataset.lpRisk, el.value);
        this.render();
      });
    }
    // Своё значение броска из списка
    for (const el of this.element.querySelectorAll("select[data-roll-path]")) {
      el.addEventListener("change", () => {
        const path = el.dataset.rollPath;
        const mod = Number(el.dataset.mod) || 0;
        this.#clearDependents(path);
        s.rolls[path] = Number(el.value) - mod;
        this.render();
      });
    }
  }

  #setField(field, value, el) {
    const s = this.wiz;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
    if (field.startsWith("stats.")) s.stats[field.slice(6)] = clamp(value, 1, 10);
    else if (field.startsWith("assign.")) {
      const k = field.slice(7);
      if (value === "") delete s.assign[k]; else s.assign[k] = Number(value);
    } else if (field.startsWith("profSkills.")) s.profSkills[field.slice(11)] = clamp(value, 0, CREATION.skillCapCreation);
    else if (field.startsWith("pickup.")) s.pickup[field.slice(7)] = clamp(value, 0, CREATION.skillCapCreation);
    else if (field === "defining") s.defining = clamp(value, 0, CREATION.skillCapCreation);
    else if (field.startsWith("skillChoice.")) {
      const [, idx, key] = field.split(".");
      const list = new Set(s.skillChoices[idx] ?? []);
      if (value) list.add(key); else list.delete(key);
      s.skillChoices[idx] = [...list];
    } else if (field === "magic") {
      const uuid = el.dataset.uuid;
      s.magic = value ? [...new Set([...s.magic, uuid])] : s.magic.filter(u => u !== uuid);
    } else if (field === "gear") {
      const name = el.dataset.name;
      s.gear = value ? [...new Set([...s.gear, name])] : s.gear.filter(n => n !== name);
    } else if (field.startsWith("risk.")) {
      const i = field.slice(5);
      for (const key of Object.keys(s.rolls)) if (key.startsWith(`decade.${i}.`)) delete s.rolls[key];
      s.rolls[`decade.${i}.risk`] = value;
    } else if (field.startsWith("choice.")) {
      s.rolls[el.dataset.path] = value;
    } else if (field === "origin") {
      s.origin = value;
      if (HOMELANDS[s.homeland]?.region !== value) s.homeland = "";
    } else if (field === "homeland") {
      s.homeland = value;
      s.language = "";
    } else if (field === "age") {
      s.age = clamp(value, 0, 1000);
    } else if (field === "lifepath" || field === "statMode" || field === "level" || field === "name" || field === "gender" || field === "language") {
      s[field] = value;
    }
  }

  #clearDependents(path) {
    const rolls = this.wiz.rolls;
    delete rolls[path];
    for (const d of dependents(path)) clearRoll(rolls, d);
  }

  /* ------------------------------ Действия ------------------------------ */

  static #onStep(event, target) {
    this.wiz.step = target.dataset.step;
    this.render();
  }

  static #onNext() {
    const i = STEPS.findIndex(x => x.id === this.wiz.step);
    let next = STEPS[Math.min(STEPS.length - 1, i + 1)].id;
    if (next === "magic" && !this.#magicGroups().length) next = "gear";
    this.wiz.step = next;
    this.render();
  }

  static #onPrev() {
    const i = STEPS.findIndex(x => x.id === this.wiz.step);
    let prev = STEPS[Math.max(0, i - 1)].id;
    if (prev === "magic" && !this.#magicGroups().length) prev = "skills";
    this.wiz.step = prev;
    this.render();
  }

  static #onPickRace(event, target) {
    const s = this.wiz;
    if (s.raceUuid === target.dataset.uuid) return;
    s.raceUuid = target.dataset.uuid;
    s.rolls = {};
    const key = this.race?.system.key;
    if (key === "witcher") {
      s.origin = ""; s.homeland = ""; s.language = "langCommon";
      if (s.age < 50) s.age = 80;
      const witcher = this.data.professions.find(p => p.system.key === "witcher");
      if (witcher) s.professionUuid = witcher.uuid;
    } else {
      if (key === "elf") { s.origin = "elder"; s.homeland = "dolBlathanna"; }
      else if (MOUNTAIN_RACES.includes(key)) { s.origin = "elder"; s.homeland = "mahakam"; }
      else if (s.origin === "elder") { s.origin = ""; s.homeland = ""; }
      s.language = "";
      if (this.profession?.system.key === "witcher") s.professionUuid = "";
    }
    this.render();
  }

  static #onPickProfession(event, target) {
    if (target.classList.contains("disabled")) return;
    this.wiz.professionUuid = target.dataset.uuid;
    this.wiz.skillChoices = {};
    this.wiz.profSkills = {};
    this.wiz.defining = 1;
    this.wiz.magic = [];
    this.wiz.gear = [];
    this.wiz.money = null;
    this.render();
  }

  /** Бросок родины (стр. 25): регион людей — чёт/нечет, затем d10 по королевствам. */
  static #onRollOrigin() {
    const s = this.wiz;
    const key = this.raceKey;
    if (key === "elf") { s.origin = "elder"; s.homeland = "dolBlathanna"; }
    else if (MOUNTAIN_RACES.includes(key)) { s.origin = "elder"; s.homeland = "mahakam"; }
    else {
      const regionRoll = rollDie(10);
      s.origin = regionRoll % 2 === 1 ? "north" : "nilfgaard";
      const d = rollDie(10);
      if (s.origin === "north") s.homeland = Object.entries(HOMELANDS).find(([, h]) => h.region === "north" && h.roll === d)[0];
      else if (d <= 3) s.homeland = "nilfgaard";
      else {
        const v = rollDie(10);
        s.homeland = Object.entries(HOMELANDS).find(([, h]) => h.vassal === v)[0];
      }
      ui.notifications.info(`Регион: d10 = ${regionRoll} → ${ORIGIN_REGIONS[s.origin].label}; родина: ${HOMELANDS[s.homeland].label}.`);
    }
    s.language = "";
    this.render();
  }

  /** Переброс строки: она бросается заново (в чат), зависящие от неё — следующими шагами. */
  static async #onReroll(event, target) {
    this.#clearDependents(target.dataset.path);
    await this.#lifepathStep();
    this.render();
  }

  /** Весь путь заново: первый бросок сразу, остальные — по шагу. Поведение ведьмака сохраняется. */
  static async #onRerollAll() {
    const ok = await DialogV2.confirm({ window: { title: "Жизненный путь" }, content: "<p>Перебросить весь жизненный путь?</p>" });
    if (!ok) return;
    const risks = Object.fromEntries(Object.entries(this.wiz.rolls).filter(([k]) => k.endsWith(".risk")));
    this.wiz.rolls = risks;
    await this.#lifepathStep();
    this.render();
  }

  static async #onLifepathStep() {
    await this.#lifepathStep();
    this.render();
  }

  /** Бросить раздел: броски карточки по одному — каждый в чат и сразу на экран. */
  static async #onLifepathSection() {
    if (this.#lifepathBusy) return;
    this.#lifepathBusy = true;
    try {
      await rollLifepathSection(this.wiz.rolls, this.#lifepathOpts, async res => {
        await postLifepathRolls(this.actor, res.rows, { roll: res.roll, name: this.wiz.name });
        this.render();
      });
    } finally {
      this.#lifepathBusy = false;
    }
    this.render();
  }

  /** Добросить остаток пути разом — все броски одной карточкой в чат. */
  static async #onLifepathRest() {
    const res = rollLifepathRest(this.wiz.rolls, this.#lifepathOpts);
    await postLifepathRolls(this.actor, res.rows, { name: this.wiz.name });
    this.render();
  }

  /** Девять бросков d10, 1 и 2 перебрасываются (стр. 47). */
  static #onRollStats() {
    const pool = [];
    while (pool.length < 9) {
      let v = rollDie(10);
      while (v < CREATION.rollRerollBelow) v = rollDie(10);
      pool.push(v);
    }
    pool.sort((a, b) => b - a);
    this.wiz.pool = pool;
    this.wiz.assign = {};
    this.render();
  }

  static async #onRollMoney() {
    const prof = this.profession;
    if (!prof) return;
    const roll = await new Roll("2d6").evaluate();
    this.wiz.money = { dice: roll.dice[0].results.map(r => r.result), sum: roll.total, total: roll.total * prof.system.startingMoney };
    this.render();
  }

  static async #onApply() {
    const lp = this.#lifepath();
    const problems = this.#validate(lp);
    if (problems.summary) return ui.notifications.warn(problems.summary);
    const actor = this.actor;
    const hasData = actor.items.size > 0 || Object.values(actor.system.skills).some(sk => sk.value > 0);
    if (hasData) {
      const ok = await DialogV2.confirm({
        window: { title: "Создать персонажа" },
        content: `<p>Параметры, навыки, раса и профессия персонажа «${actor.name}» будут заменены. Остальные предметы останутся. Продолжить?</p>`
      });
      if (!ok) return;
    }
    await applyCharacter(this, lp);
    ui.notifications.info(`Персонаж «${this.wiz.name}» создан.`);
    this.close();
    actor.sheet.render(true);
  }

  /* ------ доступ для функции применения ------ */
  get applyData() {
    const lp = this.#lifepath();
    return {
      state: this.wiz, race: this.race, profession: this.profession, lifepath: lp,
      stats: this.#baseStats(), statParts: this.#statParts(lp), skills: this.#finalSkills(lp),
      profKeys: this.#professionSkillKeys(), magic: this.#magicGroups().flatMap(g => g.items.filter(i => g.auto || this.wiz.magic.includes(i.uuid))),
      native: this.nativeLanguageKey
    };
  }
}

/* ----------------------------- Применение ----------------------------- */

/** Найти предмет снаряжения по названию в компендиумах; иначе — простой предмет. */
/**
 * Стартовое снаряжение профессий названо не так, как в таблицах снаряжения: «Метательные ножи ×5» — это пять
 * метательных ножей, «Арбалет и арбалетные болты ×20» — арбалет и двадцать болтов.
 */
const GEAR_ALIASES = {
  "метательные ножи": [["Метательный нож", null]],
  "дневник с замком": [["Дневник/гроссбух", 1]],
  "дневник": [["Дневник/гроссбух", 1]],
  "свечи": [["Свечи (х5)", q => Math.ceil(q / 5)]],
  "небольшой сундук": [["Деревянный сундук", 1]],
  "арбалет и арбалетные болты": [["Арбалет", 1], ["Стандартные боеприпасы", null]],
  "мул и повозка с товарами на 1000 крон": [["Мул", 1], ["Повозка", 1]],
  "формула эликсира": [["Формула эликсира (на выбор)", null]],
  "формула масла": [["Формула масла (на выбор)", null]],
  "формула отвара": [["Формула отвара (на выбор)", null]]
};

export async function itemsForLabel(label) {
  const qty = Number(label.match(/[×x]\s*(\d+)\s*$/)?.[1] ?? 1);
  const name = label.replace(/\s*[×x]\s*\d+\s*$/, "").trim();
  const alias = GEAR_ALIASES[name.toLowerCase()];
  if (!alias) return [await itemByName(name, qty)];
  const out = [];
  for (const [n, q] of alias) out.push(await itemByName(n, typeof q === "function" ? q(qty) : q ?? qty));
  return out;
}

async function itemByName(name, qty = 1) {
  const lower = name.toLowerCase();
  const physical = ["weapon", "armor", "gear", "alchemical", "component", "enhancement"];
  for (const pack of game.packs.filter(p => p.documentName === "Item")) {
    const index = await pack.getIndex({ fields: ["type"] });
    const e = index.find(i => i.name.toLowerCase() === lower && physical.includes(i.type));
    if (e) {
      const data = (await pack.getDocument(e._id)).toObject();
      delete data._id;
      // У боеприпасов в компендиуме пачка по 10 — берём ровно нужное число штук
      if (qty > 1 || data.system.category === "ammo") data.system.quantity = qty;
      return data;
    }
  }
  const world = game.items.find(i => i.name.toLowerCase() === lower && physical.includes(i.type));
  if (world) {
    const data = world.toObject();
    delete data._id;
    if (qty > 1) data.system.quantity = qty;
    return data;
  }
  return { name, type: "gear", system: { quantity: qty, category: "general" } };
}

async function applyCharacter(wizard, lp) {
  const { state: s, race, profession, stats, skills, profKeys, magic, native, statParts } = wizard.applyData;
  const actor = wizard.actor;
  const fx = lp.effects ?? { crowns: 0, reputation: 0, luck: 0, hpBonus: 0, staBonus: 0, vigorBonus: 0, feared: false,
    skills: {}, skillChoices: [], statMods: {}, skillMods: {}, definingBonus: 0, items: [], addictions: [], notes: [], school: "" };

  // Старые раса и профессия; клыки и эффекты черт прежней расы — вместе с ней
  const oldRace = actor.itemTypes.race[0];
  if (oldRace) await removeRaceExtras(actor, oldRace);
  const old = actor.items.filter(i => ["race", "profession"].includes(i.type)).map(i => i.id);
  if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
  const oldEffects = actor.effects.filter(e => e.getFlag("vedmak", "lifepath")).map(e => e.id);
  if (oldEffects.length) await actor.deleteEmbeddedDocuments("ActiveEffect", oldEffects);

  // Жизненный путь в биографию
  const style = lp.sections.find(x => x.title === "Личный стиль")?.entries ?? [];
  const values = lp.sections.find(x => x.title === "Ценности")?.entries ?? [];
  const styleText = i => style[i]?.text ?? "";
  // Жизненный путь хранится бросками и показывается карточками в «Дневнике»; биография остаётся свободным текстом.
  // Прежний мастер писал путь в биографию HTML-ом — такую биографию убираем, чтобы путь не задвоился.
  const lifepath = s.lifepath && lp.sections.length
    ? writeLifepath({ rolls: s.rolls, witcher: race?.system.key === "witcher", age: s.age, region: s.origin || "north", race: race?.system.key ?? "" })
    : "";
  const oldBio = actor.system.biography ?? "";
  const generatedBio = /^<h3>(Семья|Школа и испытания)(<\/h3>| — )/.test(oldBio.trim());

  const update = {
    name: s.name || actor.name,
    "system.details.age": String(s.age),
    "system.details.gender": s.gender,
    "system.details.homeland": HOMELANDS[s.homeland]?.label ?? "",
    "system.details.homelandKey": s.homeland,
    "system.details.origin": s.origin,
    "system.details.languageNative": SKILLS[native]?.label.replace("Язык: ", "") ?? "",
    "system.details.personality": styleText(1),
    "system.details.appearance": [styleText(0), styleText(2), styleText(3)].filter(Boolean).join("; "),
    "system.details.values": values.map(v => v.text).filter(Boolean).join("; "),
    "system.details.school": fx.school || (race?.system.key === "witcher" ? actor.system.details.school : ""),
    "system.social.feared": !!fx.feared,
    "system.social.region": "",
    "system.money.crowns": (s.money?.total ?? 0) + fx.crowns,
    "system.reputation.value": fx.reputation,
    "system.bonus.hp": fx.hpBonus,
    "system.bonus.sta": fx.staBonus,
    "system.bonus.vigor": fx.vigorBonus,
    "system.addictions": fx.addictions.map(name => ({ name, days: 0 })),
    "system.improvementPoints.value": 0,
    "system.improvementPoints.total": 0,
    "system.toxicity.value": 0,
    "system.adrenaline.value": 0
  };
  update["system.lifepath"] = lifepath;
  if (generatedBio) update["system.biography"] = "";
  for (const k of STAT_KEYS) {
    update[`system.stats.${k}.base`] = stats[k] + (k === "luck" ? fx.luck : 0);
  }
  for (const k of Object.keys(SKILLS)) {
    update[`system.skills.${k}.value`] = skills[k] ?? 0;
    update[`system.skills.${k}.profession`] = profKeys.includes(k);
  }
  await actor.update(update);

  // Раса, профессия, магия, снаряжение
  const items = [];
  if (race) items.push(race.toObject());
  if (profession) {
    const p = profession.toObject();
    p.system.definingSkill.value = s.defining + fx.definingBonus;
    items.push(p);
  }
  for (const m of magic) {
    const doc = await fromUuid(m.uuid);
    if (doc && !actor.items.some(i => i.type === "spell" && i.name === doc.name)) items.push(doc.toObject());
  }
  const gearNames = [...(race?.system.grants ?? []), ...(profession?.system.gearFixed ?? []), ...s.gear, ...fx.items];
  for (const name of gearNames) items.push(...await itemsForLabel(name));
  for (const data of items) delete data._id;
  await actor.createEmbeddedDocuments("Item", items);

  // Постоянные поправки жизненного пути — эффектом, чтобы их было видно
  const changes = [];
  for (const [k, v] of Object.entries(fx.statMods)) if (v) changes.push({ key: `system.stats.${k}.mod`, type: "add", value: v, phase: "initial" });
  for (const [k, v] of Object.entries(fx.skillMods)) if (v) changes.push({ key: `system.skills.${k}.mod`, type: "add", value: v, phase: "initial" });
  if (changes.length) {
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: "Жизненный путь", img: "icons/sundries/scrolls/scroll-worn-tan.webp",
      system: { changes }, flags: { vedmak: { lifepath: true } }
    }]);
  }

  // Ресурсы — на максимум
  await actor.update({
    "system.hp.value": actor.system.hp.max,
    "system.sta.value": actor.system.sta.max,
    "system.luck.value": actor.system.luck.max
  });

  // «Внимание к деталям» гнома: три навыка Ремесла на выбор
  if (race?.system.key === "gnome") await chooseDetailSkills(actor, race);
}
