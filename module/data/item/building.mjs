// Постройка (PLAN 4.185) — предмет: что это за здание по уровням (цена, срок стройки, сколько семей работает и живёт,
// Контроль, налоги, вместимость склада, строки выработки и содержания с бросками) и, когда лежит в поселении, его
// состояние (уровень, стройка, семьи на работе). Ведущий делает свои постройки в боковой панели предметов; встроенные —
// по журналу мира (config/settlement.mjs).

import { int, num, str, html } from "../fields.mjs";
import { BUILDING_GROUPS, PERIODS } from "../../config/settlement.mjs";

const { SchemaField, ArrayField, BooleanField } = foundry.data.fields;

/** Строка выработки или содержания: ресурс, бросок, за семью или за постройку, как часто. */
export const productionRow = () => new SchemaField({
  resource: str(""),
  formula: str("1"),
  per: str("building", { choices: ["building", "family"] }),
  period: str("week", { choices: Object.keys(PERIODS) }),
  noWinter: new BooleanField({ initial: false }),
  minFamilies: int(0, { min: 0 }),
  same: new BooleanField({ initial: false })
});

export const buildingLevel = () => new SchemaField({
  cost: new ArrayField(new SchemaField({ resource: str(""), qty: num(0, { min: 0 }) })),
  weeks: int(1, { min: 0 }),
  families: int(0, { min: 0 }),
  housing: int(0, { min: 0 }),
  control: int(0, { min: 0 }),
  controlPerFamily: num(0, { min: 0 }),
  taxes: num(0, { min: 0 }),
  storage: int(0, { min: 0 }),
  // Скорость тренировки отрядов (плац, казарма): 0 — здесь не тренируют
  drill: int(0, { min: 0 }),
  // Укрепления (PLAN 4.203): прибавка обороняющимся в битве у стен поселения
  defense: int(0, { min: 0 }),
  consume: new ArrayField(productionRow()),
  produce: new ArrayField(productionRow()),
  upkeep: new ArrayField(productionRow())
});

export class BuildingData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      // Код постройки: по нему поселение узнаёт одинаковые здания
      key: str(""),
      group: str("craft", { choices: Object.keys(BUILDING_GROUPS) }),
      unique: new BooleanField({ initial: false }),
      trade: new BooleanField({ initial: false }),
      // Первая ступень — со значениями полей по умолчанию: пустой {} не проходит проверку при «Создать актёра» (PLAN 4.256)
      levels: new ArrayField(buildingLevel(), { initial: () => [buildingLevel().getInitialValue({})] }),
      // Состояние в поселении: уровень 0 — ещё строится первый
      level: int(0, { min: 0 }),
      constructing: new BooleanField({ initial: false }),
      progress: int(0, { min: 0 }),
      workers: int(0, { min: 0 }),
      description: html()
    };
  }
}
