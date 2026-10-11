// Поселение (PLAN 4.183): семьи, склад, казна, налоги, постройки и летопись недель. Казна хранится в кронах —
// показывается в валюте мира (настройка «Валюты и обмен»). Правила недели — settlement/rules.mjs; производные
// (жильё, склад, работники, прогноз недели) считаются здесь из тех же правил.

import { int, num, str, html } from "../fields.mjs";
import { RESOURCE_KEYS, TAXES, calendar } from "../../config/settlement.mjs";
import { summarize, simulateWeek } from "../../settlement/rules.mjs";

const { SchemaField, ArrayField, BooleanField, ObjectField } = foundry.data.fields;

export class SettlementData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      week: int(1, { min: 1 }),
      families: int(2, { min: 0 }),
      money: num(50, { min: 0 }),
      taxes: str("low", { choices: Object.keys(TAXES) }),
      stock: new SchemaField(Object.fromEntries(RESOURCE_KEYS.map(k => [k, num(k === "food" ? 10 : k === "wood" ? 12 : k === "fuel" ? 6 : 0, { min: 0 })]))),
      buildings: new ArrayField(new SchemaField({
        id: str(""),
        key: str(""),
        name: str(""),
        level: int(0, { min: 0 }),
        constructing: new BooleanField({ initial: false }),
        progress: int(0, { min: 0 }),
        workers: int(0, { min: 0 })
      })),
      // Летопись: последние недели — отчёты simulateWeek
      log: new ArrayField(new ObjectField()),
      description: html()
    };
  }

  /** Состояние для правил недели. */
  get state() {
    return { week: this.week, families: this.families, money: this.money, taxes: this.taxes, stock: { ...this.stock },
      buildings: this.buildings.map(b => ({ ...b })) };
  }

  prepareDerivedData() {
    const state = this.state;
    this.calendar = calendar(this.week);
    this.summary = summarize(state);
    // Прогноз: что будет, если неделя пройдёт сейчас
    this.forecast = simulateWeek(state).report;
  }
}
