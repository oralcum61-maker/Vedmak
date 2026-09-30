// Персонаж игрока (корник стр. 20–60).

import { int, str, html } from "../fields.mjs";
import { statsSchema, skillsSchema, resourcesSchema, prepareCommonDerived } from "./common.mjs";
import { SOCIAL_TABLE, REGIONS, WITCHER_SCHOOLS, abilityBonus, socialLabel } from "../../config/character.mjs";

const { SchemaField, BooleanField, ArrayField } = foundry.data.fields;

export class CharacterData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      stats: statsSchema(5),
      skills: skillsSchema(),
      ...resourcesSchema(),
      luck: new SchemaField({ value: int(0) }),
      toxicity: new SchemaField({ value: int(0, { min: 0 }) }),
      adrenaline: new SchemaField({ value: int(0, { min: 0 }) }),
      reputation: new SchemaField({ value: int(0), fame: str("") }),
      improvementPoints: new SchemaField({ value: int(0), total: int(0) }),
      // Кошелёк по валютам (config/money.mjs): крона — основная, остальные меняются по курсу
      money: new SchemaField({
        crowns: int(0), orens: int(0, { min: 0 }), florens: int(0, { min: 0 }), ducats: int(0, { min: 0 }),
        marks: int(0, { min: 0 }), lintars: int(0, { min: 0 }), bizants: int(0, { min: 0 })
      }),
      details: new SchemaField({
        age: str(""),
        gender: str(""),
        homeland: str(""),
        homelandKey: str(""),
        origin: str(""),
        languageNative: str(""),
        appearance: str(""),
        personality: str(""),
        values: str(""),
        school: str("")
      }),
      // Социальный статус: территория (пусто — из настроек мира) и «опасение» (шрам, поступки, стр. 21)
      social: new SchemaField({
        region: str(""),
        feared: new BooleanField({ initial: false })
      }),
      // Зависимости (стр. 32): дни без дозы увеличивают сложность
      addictions: new ArrayField(new SchemaField({ name: str(""), days: int(0, { min: 0 }) })),
      biography: html(),
      notes: html()
    };
  }

  /** Раса и профессия берутся из вложенных предметов (не больше одного каждого типа). */
  get race() { return this.parent.itemTypes.race?.[0] ?? null; }
  get profession() { return this.parent.itemTypes.profession?.[0] ?? null; }
  get raceKey() { return this.race?.system.key ?? ""; }
  get professionKey() { return this.profession?.system.key ?? ""; }

  prepareDerivedData() {
    const race = this.race?.system;
    const prof = this.profession?.system;
    const school = WITCHER_SCHOOLS[this.details.school] ?? {};

    // Модификаторы расы, надетых реликвий и принятых мутагенов: параметры и навыки — в `mod`, прочее — бонусами
    const extra = { hp: 0, sta: 0, vigor: 0, stun: 0, rec: 0, run: 0, enc: 0, damage: 0, meleeDamage: 0 };
    const caps = {}, floors = {};
    let innateArmor = 0, meleeBodyMod = 0;
    const itemMods = [];
    for (const item of this.parent.items) {
      const s = item.system;
      if (!s?.mods?.length) continue;
      if (["weapon", "armor"].includes(item.type) && s.equipped) itemMods.push(...s.mods);
      else if (item.type === "alchemical" && s.isMutagen && s.applied) itemMods.push(...s.mods);
    }
    this.derived ??= {};
    this.derived.mutagens = this.parent.items.filter(i => i.type === "alchemical" && i.system.isMutagen && i.system.applied).length;
    for (const { target, value } of [...(race?.mods ?? []), ...itemMods]) {
      const [group, key] = target.split(".");
      if (group === "stats" && this.stats[key]) this.stats[key].mod += value;
      else if (group === "skills" && this.skills[key]) this.skills[key].mod += value;
      else if (group === "bonus" && key in extra) extra[key] += value;
      else if (group === "cap") caps[key] = Math.min(caps[key] ?? Infinity, value);
      else if (group === "floor") floors[key] = Math.max(floors[key] ?? -Infinity, value);
      else if (target === "armor") innateArmor += value;
      else if (target === "melee.body") meleeBodyMod += value;
    }

    // Древо профессии: Энергия и порог токсичности
    let toxicity = 0;
    for (const branch of prof?.branches ?? []) {
      for (const ab of branch.abilities) {
        const b = abilityBonus(ab.mechanic, ab.value);
        extra.vigor += b.vigor ?? 0;
        toxicity += b.toxicity ?? 0;
      }
    }
    extra.vigor += school.vigor ?? 0;

    prepareCommonDerived(this, {
      baseVigor: prof?.vigor ?? 0, bodyType: "humanoid", innateArmor, extra, caps, floors, evMod: school.ev ?? 0,
      meleeBodyMod
    });
    this.luck.max = this.stats.luck.total;
    this.toxicity.max = 100 + toxicity;
    // Токсичность: ручное значение + действующие эликсиры и отвары (стр. 247)
    let active = 0;
    for (const effect of this.parent.effects) {
      const tox = effect.flags?.vedmak?.alchemy?.toxicity;
      if (tox && effect.active) active += tox;
    }
    this.toxicity.active = active;
    this.toxicity.total = this.toxicity.value + active;
    this.toxicity.over = this.toxicity.total > this.toxicity.max;
    this.derived.innateArmor = innateArmor;
    this.derived.social = this.socialStatus();
  }

  /** Группы для таблицы статуса: раса и (для магов) «маги». */
  get socialGroups() {
    const groups = [];
    const race = this.raceKey;
    if (race) groups.push(race);
    if (this.professionKey === "mage") groups.push("mage");
    return groups;
  }

  /** Социальный статус на текущей территории (стр. 21): худшее отношение из всех групп персонажа. */
  socialStatus(regionKey) {
    let region = regionKey || this.social.region;
    if (!region) {
      try { region = game.settings.get("vedmak", "region"); } catch { region = "north"; }
    }
    const row = SOCIAL_TABLE[region] ?? SOCIAL_TABLE.north;
    const status = { region, regionLabel: REGIONS[region]?.label ?? region, level: "equal", feared: !!this.social.feared };
    const rank = { equal: 0, tolerated: 1, hated: 2 };
    for (const g of this.socialGroups) {
      const s = row[g];
      if (!s) continue;
      if (rank[s.level] > rank[status.level]) status.level = s.level;
      if (s.feared) status.feared = true;
    }
    status.label = socialLabel(status);
    return status;
  }
}
