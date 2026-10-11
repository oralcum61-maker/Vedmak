// Отряд (PLAN 4.187): род войск, откуда набран, численность, выучка и недели тренировки, снаряжение, боевой дух,
// командир (персонаж) и родное поселение (кормит и тренирует). Правила — army/rules.mjs.

import { int, str, html } from "../fields.mjs";
import { UNIT_KINDS, ORIGINS, MAX_TRAINING, MAX_EQUIPMENT, MORALE_MAX, COMMANDER_MAX } from "../../config/army.mjs";
import { unitState, unitPower, unitFood, unitPay } from "../../army/rules.mjs";

const { BooleanField } = foundry.data.fields;

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
      equipment: int(0, { min: 0, max: MAX_EQUIPMENT }),
      morale: int(5, { min: 0, max: MORALE_MAX }),
      routed: new BooleanField({ initial: false }),
      // uuid родного поселения и командира-персонажа
      settlement: str(""),
      commander: str(""),
      description: html()
    };
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
    this.power = unitPower(u);
    this.food = unitFood(u);
    this.pay = unitPay(u);
  }
}
