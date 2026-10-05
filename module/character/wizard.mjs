// Мастер создания персонажа (корник стр. 20–71, 237–245):
// раса → происхождение → жизненный путь → профессия → параметры → навыки → магия → снаряжение → итог.

import { STATS, STAT_POINT_BUY } from "../config/stats.mjs";
import { SKILLS } from "../config/skills.mjs";
import {
  HOMELANDS, ORIGIN_REGIONS, NATIVE_LANGUAGE_LEVEL, witcherSchools, CREATION, nativeLanguage,
  creationSkillCost, HEX_DANGER_LEVEL
} from "../config/character.mjs";
import { levelLabel } from "../config/magic.mjs";
import {
  buildLifepath, clearRoll, dependents, choiceSkillOptions, rollDie, lifepathCards, setDecadeRisk, writeLifepath,
  rollLifepathStep, rollLifepathSection, rollLifepathRest, postLifepathRolls, VAMPIRE_RACE, LIFEPATH_KINDS
} from "./lifepath.mjs";
import { chooseDetailSkills, removeRaceExtras } from "./race.mjs";
import { compareRu } from "../util.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const STEPS = [
  { id: "race",       label: "Раса",           eyebrow: "кем родился" },
  { id: "origin",     label: "Происхождение",  eyebrow: "откуда родом" },
  { id: "lifepath",   label: "Жизненный путь", eyebrow: "что было до" },
  { id: "profession", label: "Профессия",      eyebrow: "ремесло жизни" },
  { id: "stats",      label: "Параметры",      eyebrow: "чем силён" },
  { id: "skills",     label: "Навыки",         eyebrow: "чему обучен" },
  { id: "magic",      label: "Магия",          eyebrow: "что подвластно" },
  { id: "gear",       label: "Снаряжение",     eyebrow: "что с собой" },
  { id: "summary",    label: "Итог",           eyebrow: "перед дорогой" }
];

const STAT_KEYS = Object.keys(STATS);

/** Горные народы: родина по умолчанию — Махакам (краснолюды — корник, гномы, враны, боболаки — «Книга сказаний»). */
const MOUNTAIN_RACES = ["dwarf", "gnome", "vran", "bobolak"];

/** Склонение по числу: plural(5, ["заклинание", "заклинания", "заклинаний"]). */
function plural(n, [one, few, many]) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const plainText = html => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const signedNum = v => `${v > 0 ? "+" : "−"}${Math.abs(v)}`;

/** Поправка расы словами — биркой у героя: «+1 Реа», «Эмп не выше 6», «броня 4». */
function raceModLabel({ target, value }) {
  const [g, k] = String(target).split(".");
  if (g === "stats") return `${signedNum(value)} ${STATS[k]?.abbr ?? k}`;
  if (g === "skills") return `${signedNum(value)} ${SKILLS[k]?.label ?? k}`;
  if (g === "cap") return `${STATS[k]?.abbr ?? k} не выше ${value}`;
  if (g === "floor") return `${STATS[k]?.abbr ?? k} не ниже ${value}`;
  if (g === "armor") return `броня ${value}`;
  if (target === "bonus.enc") return `${signedNum(value)} к весу`;
  if (target === "melee.body") return `рукопашная: Тел ${signedNum(value)}`;
  return "";
}

/** Стартовая магия профессии словами: «5 заклинаний», «все базовые знаки». */
const QUOTA_WORDS = {
  spell: ["заклинание", "заклинания", "заклинаний"], invocation: ["инвокация", "инвокации", "инвокаций"],
  ritual: ["ритуал", "ритуала", "ритуалов"], hex: ["порча", "порчи", "порч"], sign: ["знак", "знака", "знаков"]
};

export class CharacterWizard extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor({ actor, ...options } = {}) {
    super(options);
    this.actor = actor;
    const d = actor.system.details;
    this.wiz = {
      step: "race",
      name: actor.name, gender: d.gender ?? "", age: Number.parseInt(d.age) || 25,
      raceUuid: "", origin: "", homeland: "", homelandRoll: null, vassalRoll: null, language: "",
      lifepath: true, rolls: {}, lifepathKind: "",
      // Возраст 80 выставила раса «ведьмак», а не игрок: при смене расы вернём прежний (ageAuto — признак, ageBefore — прежний)
      ageAuto: false, ageBefore: null,
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
    window: { title: "Мастер создания персонажа", resizable: true },
    position: { width: 1180, height: 820 },
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
      setField: CharacterWizard.#onSetField,
      fieldStep: CharacterWizard.#onFieldStep,
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
  /** Высший вампир: свой жизненный путь («Высший вампир. Вторая редакция»). */
  get isVampire() { return this.raceKey === VAMPIRE_RACE; }

  /** От чего зависит жизненный путь: ведьмак ли, возраст, регион, раса и выбранный путь из книг. */
  get #lifepathOpts() {
    const s = this.wiz;
    return { witcher: this.isWitcher, age: s.age, region: s.origin || "north", race: this.raceKey, kind: s.lifepathKind || "" };
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

    // Тракт: под каждым шагом — что выбрано или что не так
    const noteFor = id => {
      if (id === "race" && race) return race.name;
      if (id === "origin" && this.isWitcher) return "ведьмачья школа";
      if (id === "origin" && HOMELANDS[s.homeland]) return HOMELANDS[s.homeland].label;
      if (id === "lifepath") return !s.lifepath ? "без жизненного пути" : !race ? "сначала раса" : lp.next ? "брошен не до конца" : "брошен";
      if (id === "profession" && prof) return prof.name;
      if (id === "magic" && prof && !this.#magicGroups().length) return "у профессии нет";
      return validation[id] ?? "готово";
    };
    // Путь без расы ещё не брошен — вешка не светлеет, хотя шаг и не помечен ошибкой
    const steps = STEPS.map((x, i) => ({ ...x, n: i + 1, active: x.id === s.step, problem: validation[x.id], note: noteFor(x.id),
      done: !validation[x.id] && !(x.id === "lifepath" && s.lifepath && !race) }));
    // Следующий шаг — подписью на кнопке «Далее» (магию без стартовой магии пропускаем)
    let nextStep = STEPS[stepIndex + 1];
    if (nextStep?.id === "magic" && !this.#magicGroups().length) nextStep = STEPS[stepIndex + 2];

    Object.assign(context, {
      state: s, stepIndex, isFirst: stepIndex === 0, isLast: stepIndex === STEPS.length - 1,
      steps, doneCount: steps.filter(x => x.done).length, step: { ...STEPS[stepIndex], n: stepIndex + 1 }, nextLabel: nextStep?.label ?? "",
      stepId: s.step, problem: validation[s.step], [`is_${s.step}`]: true,
      race, profession: prof, isWitcher: this.isWitcher, isVampire: this.isVampire,
      // Дополнительные пути из книг — выбором на шаге жизненного пути (ведьмак и вампир пути не выбирают)
      lifepathKinds: [{ key: "", label: "Обычный путь (корник)" }, ...Object.entries(LIFEPATH_KINDS).map(([key, k]) => ({ key, label: k.label }))],
      hero: this.#hero(lp, stepIndex)
    });

    if (s.step === "race") {
      // Чем раса ограничивает выбор профессии — строкой под карточкой
      const others = this.data.professions.filter(p => p.system.key !== "witcher");
      context.races = this.data.races.map(r => {
        const key = r.system.key;
        const barred = others.filter(p => p.system.allowedRaces.length && !p.system.allowedRaces.includes(key)).map(p => p.name.toLowerCase());
        const limits = key === "witcher" ? "только профессия «Ведьмак»" : barred.length ? `не может быть: ${barred.join(", ")}` : "любая профессия";
        return {
          uuid: r.uuid, name: r.name, img: r.img, selected: r.uuid === s.raceUuid,
          blurb: plainText(r.system.description), traits: r.system.traits, limits, limitBad: key === "witcher" || !!barred.length
        };
      });
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
          vigor: p.system.vigor, vigorSegs: Array.from({ length: Math.min(p.system.vigor, 8) }, () => ({})),
          defining: p.system.definingSkill.name, money: `${p.system.startingMoney} × 2d6`,
          lock: allowed ? "" : p.system.allowedRaces.length === 1 ? "только ведьмаку" : "недоступно расе" };
      });
      if (prof) {
        const q = prof.system.magicQuota ?? {};
        context.profInfo = {
          description: prof.system.description,
          defining: prof.system.definingSkill,
          definingStat: STATS[prof.system.definingSkill.stat]?.label,
          definingAbbr: STATS[prof.system.definingSkill.stat]?.abbr,
          skills: prof.system.skills.map(k => SKILLS[k]?.label ?? k).join(", "),
          skillList: prof.system.skills.map(k => SKILLS[k]?.label ?? k),
          money: prof.system.startingMoney,
          magic: prof.system.magicAbilities,
          quota: [
            ...(q.allBasicSigns ? [{ n: "все", label: "базовые знаки" }] : []),
            ...Object.entries(QUOTA_WORDS).filter(([k]) => q[k] > 0).map(([k, w]) => ({ n: q[k], label: plural(q[k], w) }))
          ],
          branches: prof.system.branches.map(b => ({ name: b.name, abilities: b.abilities.map(a => a.name).join(" → "),
            list: b.abilities.map(a => a.name) })),
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
      context.levels = Object.entries(STAT_POINT_BUY).map(([k, v]) => ({ key: k, label: `${v.label} (${v.points})`, short: v.label,
        points: v.points, selected: k === s.level }));
      context.isPoints = s.statMode === "points";
      context.statRows = STAT_KEYS.map(k => {
        const mods = [rm[k] ? `раса ${signedNum(rm[k])}` : "", life[k] ? `путь ${signedNum(life[k])}` : ""].filter(Boolean).join(" · ");
        return {
          key: k, label: STATS[k].label, abbr: STATS[k].abbr, about: STATS[k].about, base: base[k], race: rm[k] ?? 0, life: life[k] ?? 0,
          final: s.statMode === "random" && s.assign[k] === undefined ? "·" : final[k], mods,
          minOff: base[k] <= CREATION.statMin, maxOff: base[k] >= CREATION.statCap,
          poolOptions: s.pool.map((v, i) => ({ index: i, value: v, selected: s.assign[k] === i,
            used: Object.entries(s.assign).some(([sk, idx]) => idx === i && sk !== k) }))
        };
      });
      context.budget = budget; context.spent = spent; context.remaining = budget - spent;
      context.preview = this.#derivedPreview(final, lp);
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
      // Профессия без списка навыков (из модуля, где книги нет — «Крестьянин», «Аристократ»): все очки в один навык
      // не вложить, так что проверяется только определяющий; остальное ведущий доберёт по книге
      const listed = prof.system.skills.length || prof.system.skillChoices.length;
      if (keys.some(k => (s.profSkills[k] ?? 0) < 1) || s.defining < 1) out.skills = "В каждый навык профессии — хотя бы 1 очко.";
      else if (listed && spent !== CREATION.professionSkillPoints) out.skills = `Навыки профессии: потрачено ${spent} из ${CREATION.professionSkillPoints}.`;
      else if (!listed && spent > CREATION.professionSkillPoints) out.skills = `Навыки профессии: потрачено ${spent} из ${CREATION.professionSkillPoints}.`;
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
    if (fx.school) lines.push(witcherSchools()[fx.school]?.label ?? fx.school);
    if (fx.vampireRole) lines.push(`роль: ${this.race?.system.roles?.find(r => r.key === fx.vampireRole)?.name ?? fx.vampireRole}`);
    if (fx.addictions.length) lines.push(`зависимость (${fx.addictions.length})`);
    for (const i of fx.items) lines.push(`предмет: ${i}`);
    for (const n of fx.notes) lines.push(n);
    return lines;
  }

  /** Производные по итоговым параметрам: ПЗ, Вын, Уст, Отдых, Бег, Вес, Реш. */
  #derivedPreview(final, lp) {
    const bw = Math.floor((final.body + final.will) / 2);
    return [
      { label: "ПЗ", value: bw * 5 + (lp.effects?.hpBonus ?? 0) }, { label: "Вын", value: bw * 5 + (lp.effects?.staBonus ?? 0) },
      { label: "Уст", value: Math.min(10, bw) }, { label: "Отдых", value: bw },
      { label: "Бег", value: final.spd * 3 }, { label: "Вес", value: final.body * 10 },
      { label: "Реш", value: Math.floor((final.will + final.int) / 2) * 5 }
    ];
  }

  /** Герой справа от шагов: арт профессии или расы, имя, кто он, девять параметров клеймами, поправки расы. */
  #hero(lp, stepIndex) {
    const s = this.wiz;
    const race = this.race, prof = this.profession;
    const final = this.#finalStats(lp);
    const unset = k => s.statMode === "random" && s.assign[k] === undefined;
    const statsStep = STEPS.findIndex(x => x.id === "stats");
    return {
      art: prof?.img || race?.img || "",
      name: s.name || "Без имени",
      line: race ? `${race.name} · ${prof?.name ?? "профессия не выбрана"}` : "раса не выбрана",
      sub: [s.gender, s.age ? `${s.age} ${plural(s.age, ["год", "года", "лет"])}` : ""].filter(Boolean).join(" · "),
      stats: STAT_KEYS.map(k => ({ k: STATS[k].abbr, title: STATS[k].label, v: unset(k) ? "·" : final[k], dim: unset(k) || stepIndex < statsStep })),
      note: stepIndex < statsStep ? "Параметры — на пятом шаге; поправки расы уже учтены." : "",
      mods: (race?.system.mods ?? []).map(raceModLabel).filter(Boolean)
    };
  }

  #summary(lp) {
    const s = this.wiz;
    const prof = this.profession;
    const final = this.#finalStats(lp);
    const skills = this.#finalSkills(lp);
    const money = (s.money?.total ?? 0) + (lp.effects?.crowns ?? 0);
    const magicChosen = this.#magicGroups().flatMap(g => g.items.filter(i => g.auto || s.magic.includes(i.uuid)));
    return {
      art: prof?.img || this.race?.img || "",
      line: [this.race?.name, prof?.name, s.gender, s.age ? `${s.age} ${plural(s.age, ["год", "года", "лет"])}` : "",
        HOMELANDS[s.homeland]?.label].filter(Boolean).join(" · "),
      derived: this.#derivedPreview(final, lp),
      skillList: Object.entries(skills).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || compareRu(SKILLS[a[0]].label, SKILLS[b[0]].label))
        .map(([k, v]) => ({ n: SKILLS[k].label, v })),
      magicList: magicChosen.map(i => ({ n: i.name, img: i.img })),
      gearList: [...(prof?.system.gearFixed ?? []), ...s.gear, ...(lp.effects?.items ?? [])],
      definingName: prof?.system.definingSkill.name ?? "", definingValue: prof ? s.defining + (lp.effects?.definingBonus ?? 0) : 0,
      moneyRoll: s.money ? `${prof?.system.startingMoney ?? 0} × ${s.money.sum}` : "",
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
      // Снятый навык уносит свои очки профессии, взятый — освоенные очки (иначе они считались бы дважды)
      this.#pruneSkills();
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
      if (HOMELANDS[s.homeland]?.region !== value) { s.homeland = ""; s.language = ""; }
      this.#pruneChoices();
    } else if (field === "homeland") {
      s.homeland = value;
      s.language = "";
      this.#pruneChoices();
    } else if (field === "age") {
      s.age = clamp(value, 0, 1000);
      // Возраст вписал игрок — расе «ведьмак» его уже не менять
      s.ageAuto = false; s.ageBefore = null;
    } else if (field === "lifepath" || field === "statMode" || field === "level" || field === "name" || field === "gender" || field === "language") {
      s[field] = value;
      if (field === "language") this.#pruneChoices();
    } else if (field === "lifepathKind") {
      // Путь из книги: броски прежнего пути не подходят — начинаем заново
      if (s.lifepathKind !== value) { s.lifepathKind = value; s.rolls = {}; }
    }
  }

  /**
   * Выбор навыков профессии, которых уже нет среди предлагаемых: родной язык (его в списке нет, он и так на 8) после
   * смены расы, родины или языка. Лишний выбор уносит свои очки через `#pruneSkills`.
   */
  #pruneChoices() {
    const s = this.wiz;
    const native = this.nativeLanguageKey;
    const prof = this.profession;
    for (const [idx, list] of Object.entries(s.skillChoices)) {
      const offered = prof?.system.skillChoices[idx]?.options;
      s.skillChoices[idx] = list.filter(k => k !== native && (!offered || offered.includes(k)));
    }
    this.#pruneSkills();
  }

  /**
   * Очки навыков — по нынешней профессии. Очки профессии у навыка, который больше не навык профессии
   * (снят с выбора, сменилась профессия), пропадают: проверка шага считает только навыки профессии, а итог
   * сложил бы их как бесплатные. Освоенные очки у навыка, ставшего навыком профессии, тоже пропадают:
   * в списке освоенных его уже нет, а бюджет Инт + Реа они ели бы дальше.
   */
  #pruneSkills() {
    const s = this.wiz;
    const keys = new Set(this.#professionSkillKeys());
    for (const k of Object.keys(s.profSkills)) if (!keys.has(k)) delete s.profSkills[k];
    for (const k of Object.keys(s.pickup)) if (keys.has(k)) delete s.pickup[k];
  }

  /** Сменить профессию: выборы, очки, магия, снаряжение и капитал прежней — заново. */
  #setProfession(uuid) {
    const s = this.wiz;
    if (s.professionUuid === uuid) return;
    s.professionUuid = uuid;
    s.skillChoices = {};
    s.profSkills = {};
    s.defining = 1;
    s.magic = [];
    s.gear = [];
    s.money = null;
    this.#pruneSkills();
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
      if (s.age < 50) { s.ageBefore = s.age; s.age = 80; s.ageAuto = true; }
      // Профессия ведьмака — так же, как выбором на шаге «Профессия»: капитал, очки и снаряжение прежней не остаются
      const witcher = this.data.professions.find(p => p.system.key === "witcher");
      if (witcher) this.#setProfession(witcher.uuid);
    } else {
      if (key === "elf") { s.origin = "elder"; s.homeland = "dolBlathanna"; }
      else if (MOUNTAIN_RACES.includes(key)) { s.origin = "elder"; s.homeland = "mahakam"; }
      else if (s.origin === "elder") { s.origin = ""; s.homeland = ""; }
      s.language = "";
      if (this.profession?.system.key === "witcher") this.#setProfession("");
      // Возраст 80 поставила раса «ведьмак»: при уходе от неё возвращаем прежний, если игрок не вписал свой
      if (s.ageAuto && s.ageBefore !== null) s.age = s.ageBefore;
      s.ageAuto = false; s.ageBefore = null;
    }
    // Родной язык и родина сменились: выбор навыка, которого теперь нет в списке, не должен остаться и считаться
    this.#pruneChoices();
    this.render();
  }

  static #onPickProfession(event, target) {
    if (target.classList.contains("disabled")) return;
    this.#setProfession(target.dataset.uuid);
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
    this.#pruneChoices();
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

  /** Переключатель кнопками (способ параметров, уровень игры): поле и значение — в data-field / data-value. */
  static #onSetField(event, target) {
    this.#setField(target.dataset.field, target.dataset.value, target);
    this.render();
  }

  /** Ступенька «− / +» у числа: параметр, навык профессии, освоенный или определяющий навык. */
  static #onFieldStep(event, target) {
    const s = this.wiz;
    const field = target.dataset.field;
    const [group, key] = field.split(".");
    const current = field === "defining" ? s.defining
      : group === "stats" ? s.stats[key] : group === "profSkills" ? s.profSkills[key] ?? 0 : group === "pickup" ? s.pickup[key] ?? 0 : 0;
    this.#setField(field, current + Number(target.dataset.step), target);
    this.render();
  }

  static async #onRollMoney() {
    const prof = this.profession;
    if (!prof) return;
    const roll = await new Roll("2d6").evaluate();
    this.wiz.money = { dice: roll.dice[0].results.map(r => r.result), sum: roll.total, total: roll.total * prof.system.startingMoney };
    this.render();
  }

  /** Персонаж создаётся: второй щелчок по «Создать» не создаёт его дважды (две расы, двойное снаряжение). */
  #applyBusy = false;

  static async #onApply(event, target) {
    if (this.#applyBusy) return;
    this.#applyBusy = true;
    const button = target instanceof HTMLButtonElement ? target : null;
    if (button) button.disabled = true;
    try {
      await this.#apply();
    } finally {
      this.#applyBusy = false;
      if (button?.isConnected) button.disabled = false;
    }
  }

  async #apply() {
    const lp = this.#lifepath();
    const problems = this.#validate(lp);
    if (problems.summary) return ui.notifications.warn(problems.summary);
    const actor = this.actor;
    const hasData = actor.items.size > 0 || Object.values(actor.system.skills).some(sk => sk.value > 0);
    if (hasData || actor.system.lifepath) {
      const ok = await DialogV2.confirm({
        window: { title: "Создать персонажа" },
        content: replaceWarning(actor)
      });
      if (!ok) return;
    }
    // Прежний мастер писал путь в биографию. Теперь путь — в «Дневнике», но под ним мог остаться текст игрока:
    // биографию очищаем только с согласия
    let clearBio = false;
    if (GENERATED_BIO.test((actor.system.biography ?? "").trim())) {
      clearBio = await DialogV2.confirm({
        window: { title: "Биография" },
        content: "<p>В биографии записан жизненный путь прежнего мастера создания. Теперь путь хранится в «Дневнике»"
          + " карточками, и в биографии он задвоится.</p><p>Очистить биографию? Если вы дописывали туда своё, нажмите"
          + " «Нет» — текст останется, лишнее уберёте сами.</p>"
      });
    }
    await applyCharacter(this, lp, { clearBio });
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
  "фляга с выпивкой": [["Бурдюк", 1]],
  "одеяло": [["Походная постель", 1]],
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

/**
 * Что мастер заменит у уже заполненного персонажа — словами и с нынешними значениями, чтобы повторный
 * мастер не обнулял кроны и О.У молча.
 */
function replaceWarning(actor) {
  const sys = actor.system;
  const esc = foundry.utils.escapeHTML;
  const lines = [`параметры, навыки, раса и профессия${sys.lifepath ? ", жизненный путь в «Дневнике»" : ""}`];
  lines.push(`кроны (сейчас ${sys.money?.crowns ?? 0}) — на стартовый капитал и кроны жизненного пути`);
  const ip = sys.improvementPoints ?? {};
  lines.push(`О.У обнулятся: сейчас ${ip.value ?? 0}, всего получено ${ip.total ?? 0}`);
  lines.push(`репутация (сейчас ${sys.reputation?.value ?? 0}) — на итог жизненного пути`);
  lines.push(`токсичность (сейчас ${sys.toxicity?.value ?? 0}) и адреналин обнулятся, зависимости — по жизненному пути`);
  lines.push("постоянные бонусы ПЗ, Вын и Энергии, поправки эффекта «Жизненный путь»");
  const oldMagic = actor.itemTypes.spell?.filter(i => i.getFlag("vedmak", "wizardMagic")) ?? [];
  if (oldMagic.length) lines.push(`стартовая магия прежней профессии: ${oldMagic.map(i => esc(i.name)).join(", ")}`);
  // Магия без метки мастера (стартовая, добавленная до метки, или изученная позже) не удаляется: если среди неё есть
  // стартовая магия прежней профессии, её придётся убрать самим. Одноимённая магия новой профессии получит метку.
  if (actor.itemTypes.profession?.length) {
    const kept = actor.itemTypes.spell?.filter(i => !i.getFlag("vedmak", "wizardMagic")) ?? [];
    if (kept.length) {
      const names = kept.slice(0, 12).map(i => esc(i.name)).join(", ") + (kept.length > 12 ? ` и ещё ${kept.length - 12}` : "");
      lines.push(`магия без метки мастера останутся: ${names} (если это стартовая магия прежней профессии, уберите её сами; одноимённая магия новой профессии получит метку и уйдёт при следующем запуске мастера)`);
    }
  }
  return `<p>У персонажа «${esc(actor.name)}» мастер заменит:</p><ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul>`
    + "<p>Остальные предметы останутся. Стартовое снаряжение, которое у персонажа уже есть (то же название и тип),"
    + " второй раз не добавится. Продолжить?</p>";
}

/** Биография, которую прежний мастер создания собирал из жизненного пути. */
const GENERATED_BIO = /^<h3>(Семья|Школа и испытания)(<\/h3>| — )/;

/** Предметы, у которых есть число штук: докладываются до нужного (остальные при повторе пропускаются). */
const STACKABLE_TYPES = ["gear", "component", "alchemical"];

async function applyCharacter(wizard, lp, { clearBio = false } = {}) {
  const { state: s, race, profession, stats, skills, profKeys, magic, native, statParts } = wizard.applyData;
  const actor = wizard.actor;
  const fx = lp.effects ?? { crowns: 0, reputation: 0, luck: 0, hpBonus: 0, staBonus: 0, vigorBonus: 0, feared: false,
    skills: {}, skillChoices: [], statMods: {}, skillMods: {}, definingBonus: 0, items: [], addictions: [], notes: [], school: "" };

  // Старые раса и профессия; клыки и эффекты черт прежней расы — вместе с ней
  const oldRace = actor.itemTypes.race[0];
  if (oldRace) await removeRaceExtras(actor, oldRace);
  // Стартовая магия прежнего мастера (помечена флагом) уходит вместе с профессией; изученное позже — остаётся
  const old = actor.items.filter(i => ["race", "profession"].includes(i.type)
    || (i.type === "spell" && i.getFlag("vedmak", "wizardMagic"))).map(i => i.id);
  if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
  const oldEffects = actor.effects.filter(e => e.getFlag("vedmak", "lifepath")).map(e => e.id);
  if (oldEffects.length) await actor.deleteEmbeddedDocuments("ActiveEffect", oldEffects);

  // Жизненный путь в биографию
  // У высшего вампира вместо стиля и ценностей — «Характер»: черта характера и что он ценит, ненавидит, как пьёт кровь
  const vampChar = lp.sections.find(x => x.title === "Характер")?.entries ?? [];
  const style = lp.sections.find(x => x.title === "Личный стиль")?.entries
    ?? (vampChar.length ? [{ text: "" }, vampChar[0]] : []);
  const values = lp.sections.find(x => x.title === "Ценности")?.entries
    ?? vampChar.slice(1).map(e => ({ text: `${e.label.toLowerCase()}: ${e.text}` }));
  const styleText = i => style[i]?.text ?? "";
  // Жизненный путь хранится бросками и показывается карточками в «Дневнике»; биография остаётся свободным текстом.
  const lifepath = s.lifepath && lp.sections.length
    ? writeLifepath({ rolls: s.rolls, witcher: race?.system.key === "witcher", age: s.age, region: s.origin || "north", race: race?.system.key ?? "", kind: s.lifepathKind || "" })
    : "";

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
  if (clearBio) update["system.biography"] = "";
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
  if (race) {
    const r = race.toObject();
    // Роль высшего вампира выпала в жизненном пути — сразу на расу (на листе её потом не сменить)
    if (fx.vampireRole && r.system.roles?.some(x => x.key === fx.vampireRole)) r.system.role = fx.vampireRole;
    items.push(r);
  }
  if (profession) {
    const p = profession.toObject();
    p.system.definingSkill.value = s.defining + fx.definingBonus;
    items.push(p);
  }
  const flagUpdates = [];
  for (const m of magic) {
    const doc = await fromUuid(m.uuid);
    if (!doc) continue;
    // Заклинание с таким именем уже есть (старая стартовая магия без флага мастера): не задваиваем, но метим, чтобы
    // следующий запуск мастера смог убрать его вместе со стартовой магией профессии
    const same = actor.items.find(i => i.type === "spell" && i.name === doc.name);
    if (same) {
      if (!same.getFlag("vedmak", "wizardMagic")) flagUpdates.push({ _id: same.id, "flags.vedmak.wizardMagic": true });
      continue;
    }
    // Флаг — чтобы повторный мастер мог убрать стартовую магию этой профессии
    const data = doc.toObject();
    foundry.utils.setProperty(data, "flags.vedmak.wizardMagic", true);
    items.push(data);
  }
  // Снаряжение, которое у персонажа уже есть (то же название и тип), повторный мастер не задваивает.
  // Исчисляемое (снаряжение, компоненты, алхимия, боеприпасы) докладывается до нужного числа: «болты ×20» при одном
  // болте в колчане — ещё 19; оружие, броня и усиления (по одной штуке) пропускаются.
  const key = i => `${i.type}\u0000${i.name}`;
  const owned = new Map();
  for (const i of actor.items) owned.set(key(i), [...(owned.get(key(i)) ?? []), i]);
  const topUps = new Map();
  const gearNames = [...(race?.system.grants ?? []), ...(profession?.system.gearFixed ?? []), ...s.gear, ...fx.items];
  for (const name of gearNames) {
    for (const data of await itemsForLabel(name)) {
      const have = owned.get(key(data));
      if (!have) { items.push(data); continue; }
      if (!STACKABLE_TYPES.includes(data.type)) continue;
      const want = Number(data.system.quantity) || 1;
      const had = have.reduce((sum, i) => sum + (Number(i.system.quantity) || 0), 0);
      // Новое число в первой из одноимённых стопок; повтор того же названия в списке не складывается, берётся большее
      const total = Math.max(topUps.get(have[0].id) ?? 0, want - had + (Number(have[0].system.quantity) || 0));
      if (want > had) topUps.set(have[0].id, total);
    }
  }
  for (const data of items) delete data._id;
  await actor.createEmbeddedDocuments("Item", items);
  const updates = [...flagUpdates, ...[...topUps].map(([_id, quantity]) => ({ _id, "system.quantity": quantity }))];
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);

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
