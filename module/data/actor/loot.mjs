// Хранилище: сундук, сумка, повозка, склад, лавка (PLAN 4.115). Параметров и здоровья нет — только вещи
// (вложенные предметы), кошелёк и описание. Взять, купить и положить — character/storage.mjs.

import { int, num, str, html, moneySchema } from "../fields.mjs";

/**
 * Виды хранилищ: подпись и значок. Лавка продаёт — вещь берётся за цену по книге с наценкой лавки,
 * кроны уходят в её кассу; из остальных вещи берут даром.
 */
export const STORAGE_KINDS = {
  chest: { label: "Сундук", icon: "fa-box-archive" },
  bag:   { label: "Сумка", icon: "fa-sack" },
  cart:  { label: "Повозка", icon: "fa-horse-head" },
  stash: { label: "Склад", icon: "fa-warehouse" },
  shop:  { label: "Лавка", icon: "fa-store" }
};

export class LootData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      kind: str("chest", { choices: Object.keys(STORAGE_KINDS) }),
      // Вместимость в килограммах; 0 — без предела
      capacity: num(0, { min: 0 }),
      // Наценка лавки в процентах от цены по книге (100 — цена по книге)
      markup: int(100, { min: 0 }),
      money: moneySchema(),
      description: html()
    };
  }

  /** Вес и стоимость содержимого: с количеством, монеты не в счёт. */
  prepareDerivedData() {
    let weight = 0, value = 0;
    for (const item of this.parent.items) {
      const s = item.system;
      const qty = Number.isFinite(s.quantity) ? s.quantity : 1;
      weight += (Number(s.weight) || 0) * qty;
      value += (typeof s.cost === "number" ? s.cost : 0) * qty;
    }
    this.load = {
      weight: Math.round(weight * 10) / 10,
      value: Math.round(value * 10) / 10,
      over: this.capacity > 0 && weight > this.capacity
    };
  }
}
