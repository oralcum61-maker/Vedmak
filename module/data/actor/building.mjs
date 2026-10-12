// Постройка — актёр (PLAN 4.198): что это за здание по уровням (цена, срок стройки, сколько семей работает и живёт,
// Контроль, налоги, склад, строки выработки и содержания с бросками) и его состояние в поселении (уровень, стройка,
// семьи на работе). `settlement` — uuid поселения; пусто — образец ведущего в каталоге (свой тип сооружения).
// Уровни — те же, что у прежнего предмета «Постройка» (data/item/building.mjs); правила недели получают постройку
// через buildingState (settlement/rules.mjs). Прокачка (кусок Б): ветки ступеней с эффектами (config/building-upgrades.mjs),
// купленные ступени и ступень в работе.

import { int, num, str, html } from "../fields.mjs";
import { BUILDING_GROUPS, PERIODS } from "../../config/settlement.mjs";
import { BUILDING_EFFECTS } from "../../config/building-upgrades.mjs";
import { buildingLevel } from "../item/building.mjs";

const { ArrayField, BooleanField, SchemaField } = foundry.data.fields;

/** Эффект ступени: тип из общего набора; ресурс, число; у новой строки выработки — бросок, кому, как часто. */
export const upgradeEffect = () => new SchemaField({
  type: str("produce", { choices: Object.keys(BUILDING_EFFECTS) }),
  resource: str(""),
  value: num(0),
  formula: str("1"),
  per: str("building", { choices: ["building", "family"] }),
  period: str("week", { choices: Object.keys(PERIODS) })
});

/** Ступень ветки: нужный уровень постройки, предыдущая ступень, цена, недели стройки, эффекты. */
export const upgradeNode = () => new SchemaField({
  id: str(""),
  name: str("Ступень"),
  description: str(""),
  level: int(1, { min: 0 }),
  requires: str(""),
  cost: new ArrayField(new SchemaField({ resource: str(""), qty: num(0, { min: 0 }) })),
  weeks: int(1, { min: 0 }),
  effects: new ArrayField(upgradeEffect())
});

export class BuildingActorData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      // Код постройки: по нему поселение узнаёт одинаковые здания
      key: str(""),
      group: str("craft", { choices: Object.keys(BUILDING_GROUPS) }),
      unique: new BooleanField({ initial: false }),
      trade: new BooleanField({ initial: false }),
      levels: new ArrayField(buildingLevel(), { initial: () => [{}] }),
      // Состояние в поселении: уровень 0 — ещё строится первый
      level: int(0, { min: 0 }),
      constructing: new BooleanField({ initial: false }),
      progress: int(0, { min: 0 }),
      workers: int(0, { min: 0 }),
      settlement: str(""),
      // Управляющий (PLAN 4.203): uuid персонажа и навык (пусто — по постройке)
      manager: str(""),
      managerSkill: str(""),
      // Заказы мастерской (PLAN 4.203): очередь, делается по одному, пока в постройке работают
      orders: new ArrayField(new SchemaField({
        id: str(""), uuid: str(""), name: str(""), img: str(""), type: str(""), qty: int(1, { min: 1 }),
        for: str(""), forName: str(""), weeks: int(1, { min: 1 }), progress: int(0, { min: 0 }),
        cost: new ArrayField(new SchemaField({ resource: str(""), qty: num(0, { min: 0 }) }))
      })),
      // Прокачка: ветки, купленные ступени (id), ступень в стройке
      branches: new ArrayField(new SchemaField({ id: str(""), name: str("Ветка"), icon: str("fa-star"), nodes: new ArrayField(upgradeNode()) })),
      upgrades: new ArrayField(str("")),
      research: new SchemaField({ node: str(""), progress: int(0, { min: 0 }) }),
      description: html()
    };
  }

  /** Управляющий-персонаж. */
  get managerActor() {
    return this.manager ? fromUuidSync(this.manager) : null;
  }

  /** Поселение постройки (null — образец каталога или поселение удалено). */
  get settlementActor() {
    return this.settlement ? fromUuidSync(this.settlement) : null;
  }
}
