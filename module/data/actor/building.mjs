// Постройка — актёр (PLAN 4.198): что это за здание по уровням (цена, срок стройки, сколько семей работает и живёт,
// Контроль, налоги, склад, строки выработки и содержания с бросками) и его состояние в поселении (уровень, стройка,
// семьи на работе). `settlement` — uuid поселения; пусто — образец ведущего в каталоге (свой тип сооружения).
// Уровни — те же, что у прежнего предмета «Постройка» (data/item/building.mjs); правила недели получают постройку
// через buildingState (settlement/rules.mjs).

import { int, str, html } from "../fields.mjs";
import { BUILDING_GROUPS } from "../../config/settlement.mjs";
import { buildingLevel } from "../item/building.mjs";

const { ArrayField, BooleanField } = foundry.data.fields;

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
      description: html()
    };
  }

  /** Поселение постройки (null — образец каталога или поселение удалено). */
  get settlementActor() {
    return this.settlement ? fromUuidSync(this.settlement) : null;
  }
}
