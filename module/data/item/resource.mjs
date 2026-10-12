// Ресурс (PLAN 4.201) — свой тип ресурса ведущего: цена за единицу (монет валюты мира), раздел библиотеки, описание.
// Имя предмета — имя ресурса на складе; значок — его картинка. Перетащенный на лист поселения — склад начинает его учитывать.

import { num, str, html } from "../fields.mjs";
import { RESOURCE_CATEGORIES } from "../../config/resources.mjs";

export class ResourceData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      price: num(5, { min: 0 }),
      category: str("craft", { choices: Object.keys(RESOURCE_CATEGORIES) }),
      description: html()
    };
  }
}
