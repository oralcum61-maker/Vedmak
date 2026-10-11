// Поселение (PLAN 4.183, 4.185) по журналу мира manorlords: календарь (год, месяц, неделя), семьи, одобрение 0–10,
// Контроль, Ополчение, казна — Богатство (1 = 500 монет валюты мира), склад — свободный список ресурсов; постройки —
// актёры «Постройка» мира с uuid этого поселения (PLAN 4.198). Правила недели — settlement/rules.mjs; производные (дома, бездомные, работа,
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

  /**
   * Актёры-постройки поселения: в порядке листа, затем по времени создания (от порядка зависят очередь строителей и
   * раздача семей). Пока мир загружается, коллекции актёров ещё нет — пусто; поселения пересчитываются после загрузки.
   */
  get buildingActors() {
    const uuid = this.parent?.uuid;
    if (!uuid || !game.actors || this.parent.pack) return [];
    const born = a => a._stats?.createdTime ?? 0;
    return game.actors.filter(a => a.type === "building" && a.system.settlement === uuid)
      .sort((a, b) => (a.sort - b.sort) || (born(a) - born(b)) || (a.id < b.id ? -1 : 1));
  }

  /** Постройки поселения для правил. */
  get buildings() {
    return this.buildingActors.map(buildingState);
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
