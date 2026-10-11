// Поселение (PLAN 4.183, 4.185) по журналу мира manorlords: календарь (год, месяц, неделя), семьи, одобрение 0–10,
// Контроль, Ополчение, казна — Богатство (1 = 500 монет валюты мира), склад — свободный список ресурсов; постройки —
// вложенные предметы «Постройка». Правила недели — settlement/rules.mjs; производные (дома, бездомные, работа,
// шансы месяца, прогноз недели) считаются здесь из тех же правил.

import { int, num, str, html } from "../fields.mjs";
import { calendar, APPROVAL_MAX, TAXES } from "../../config/settlement.mjs";
import { summarize, simulateWeek, buildingState } from "../../settlement/rules.mjs";

const { ArrayField, ObjectField } = foundry.data.fields;

export class SettlementData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    return {
      year: int(1, { min: 1 }),
      month: int(4, { min: 1, max: 12 }),
      week: int(1, { min: 1, max: 4 }),
      families: int(2, { min: 0 }),
      approval: int(5, { min: 0, max: APPROVAL_MAX }),
      control: int(0, { min: 0 }),
      militia: int(0, { min: 0 }),
      wealth: num(0, { min: 0 }),
      taxes: str("low", { choices: Object.keys(TAXES) }),
      // Склад: { "Еда": 10, "Древесина": 12, … }
      stock: new ObjectField({ initial: () => ({ "Еда": 10, "Топливо": 6, "Древесина": 12 }) }),
      // Летопись: последние недели — отчёты simulateWeek
      log: new ArrayField(new ObjectField()),
      description: html()
    };
  }

  /** Постройки поселения для правил: в порядке листа. */
  get buildings() {
    return (this.parent?.itemTypes?.building ?? []).slice().sort((a, b) => a.sort - b.sort).map(buildingState);
  }

  /** Склад числами (неверное — 0). */
  get stockMap() {
    return Object.fromEntries(Object.entries(this.stock ?? {}).map(([k, v]) => [k, Number(v) || 0]));
  }

  /** Состояние для правил недели. */
  get state() {
    return { year: this.year, month: this.month, week: this.week, families: this.families, approval: this.approval,
      control: this.control, wealth: this.wealth, taxes: this.taxes, stock: this.stockMap, buildings: this.buildings };
  }

  prepareDerivedData() {
    const state = this.state;
    this.calendar = calendar(state);
    this.summary = summarize(state);
    // Прогноз: что принесёт неделя в среднем
    this.forecast = simulateWeek(state, { forecast: true }).report;
  }
}
