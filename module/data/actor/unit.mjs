// Отряд (PLAN 4.187): род войск, откуда набран, численность, выучка и недели тренировки, снаряжение, боевой дух,
// командир (персонаж) и родное поселение (кормит и тренирует). Правила — army/rules.mjs. PLAN 4.198: оружие и броня —
// отдельные шкалы (было одно «снаряжение» — переносится в обе); опыт и звания; ветки обучения (config/unit-upgrades.mjs).

import { int, num, str, html } from "../fields.mjs";
import { UNIT_KINDS, ORIGINS, MAX_TRAINING, MAX_GEAR, MORALE_MAX, COMMANDER_MAX, TERRAIN } from "../../config/army.mjs";
import { UNIT_EFFECTS, RANKS } from "../../config/unit-upgrades.mjs";
import { unitState, unitPower, unitFood, unitPay } from "../../army/rules.mjs";

const { BooleanField, ArrayField, SchemaField } = foundry.data.fields;

/** Ступень обучения: нужное звание, оружие и броня, предыдущая ступень, цена, недели на плацу, эффекты. */
export const unitNode = () => new SchemaField({
  id: str(""),
  name: str("Ступень"),
  description: str(""),
  rank: int(0, { min: 0, max: RANKS.length - 1 }),
  weapons: int(0, { min: 0, max: MAX_GEAR }),
  armor: int(0, { min: 0, max: MAX_GEAR }),
  requires: str(""),
  cost: new ArrayField(new SchemaField({ resource: str(""), qty: num(0, { min: 0 }) })),
  weeks: int(1, { min: 0 }),
  effects: new ArrayField(new SchemaField({
    type: str("power", { choices: Object.keys(UNIT_EFFECTS) }),
    value: num(0),
    // Бросок эффекта-броска (меньше потерь, еды, платы)
    formula: str(""),
    kind: str("", { blank: true, choices: ["", ...Object.keys(UNIT_KINDS)] }),
    terrain: str("", { blank: true, choices: ["", ...Object.keys(TERRAIN)] })
  }))
});

/** Прибавка командира: (Эмпатия + Лидерство) / 3, не больше 5. */
export function commanderBonus(actor) {
  if (!actor?.system?.skills) return 0;
  const emp = actor.system.stats?.emp?.effective ?? actor.system.stats?.emp?.total ?? 0;
  const lead = actor.system.skills.leadership?.total ?? 0;
  return Math.max(0, Math.min(COMMANDER_MAX, Math.floor((emp + lead) / 3)));
}

export class UnitData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      kind: str("infantry", { choices: Object.keys(UNIT_KINDS) }),
      origin: str("militia", { choices: Object.keys(ORIGINS) }),
      soldiers: int(0, { min: 0 }),
      training: int(0, { min: 0, max: MAX_TRAINING }),
      progress: int(0, { min: 0 }),
      drilling: new BooleanField({ initial: false }),
      weapons: int(0, { min: 0, max: MAX_GEAR }),
      armor: int(0, { min: 0, max: MAX_GEAR }),
      xp: int(0, { min: 0 }),
      morale: int(5, { min: 0, max: MORALE_MAX }),
      routed: new BooleanField({ initial: false }),
      // uuid родного поселения и командира-персонажа
      settlement: str(""),
      commander: str(""),
      // Обучение: ветки, освоенные ступени (id), ступень на плацу
      branches: new ArrayField(new SchemaField({ id: str(""), name: str("Ветка"), icon: str("fa-star"), nodes: new ArrayField(unitNode()) })),
      upgrades: new ArrayField(str("")),
      research: new SchemaField({ node: str(""), progress: int(0, { min: 0 }) }),
      description: html()
    };
  }

  /** Было одно «снаряжение» (PLAN 4.187) — оно становится и оружием, и бронёй. */
  static migrateData(source) {
    if ("equipment" in source && !("weapons" in source) && !("armor" in source)) {
      const e = Math.max(0, Math.min(MAX_GEAR, Number(source.equipment) || 0));
      source.weapons = e;
      source.armor = e;
    }
    return super.migrateData(source);
  }

  /** Командир-персонаж (из мира). */
  get commanderActor() {
    return this.commander ? fromUuidSync(this.commander) : null;
  }

  /** Родное поселение. */
  get settlementActor() {
    return this.settlement ? fromUuidSync(this.settlement) : null;
  }

  prepareDerivedData() {
    this.commanderBonus = commanderBonus(this.commanderActor);
    const u = unitState(this.parent);
    u.commanderBonus = this.commanderBonus;
    this.rank = u.rank;
    this.mods = u.mods;
    this.power = unitPower(u);
    this.food = unitFood(u);
    this.pay = unitPay(u);
  }
}
