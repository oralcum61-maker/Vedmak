// Настройки мира «Валюты и обмен»: названия, курс к кроне, вес монеты и комиссия менялы.

import { moneySetting, DEFAULT_MONEY_SETTING, CURRENCY_KEYS } from "../config/money.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CurrencyConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "vedmak-currencies",
    tag: "form",
    classes: ["vedmak", "vedmak-dialog", "currency-config"],
    window: { title: "Валюты и обмен" },
    position: { width: 680 },
    form: { handler: CurrencyConfig.#onSubmit, closeOnSubmit: true },
    actions: { reset: CurrencyConfig.#onReset }
  };

  // Часть шаблона в v14 — ровно один корневой элемент, поэтому кнопки — отдельной частью
  static PARTS = {
    form: { template: "systems/vedmak/templates/apps/currencies.hbs" },
    footer: { template: "systems/vedmak/templates/apps/currencies-footer.hbs" }
  };

  async _prepareContext() {
    const { fee, list } = moneySetting();
    return { fee, rows: CURRENCY_KEYS.map(k => ({ ...list[k], base: k === "crowns" })) };
  }

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const list = {};
    for (const key of CURRENCY_KEYS) {
      const row = data.list?.[key] ?? {};
      list[key] = {
        label: String(row.label ?? "").trim(), abbr: String(row.abbr ?? "").trim(), region: String(row.region ?? "").trim(),
        rate: key === "crowns" ? 1 : Number(row.rate) || 0, grams: Math.max(0, Number(row.grams) || 0)
      };
    }
    await game.settings.set("vedmak", "currencies", { fee: Math.max(0, Math.min(100, Number(data.fee) || 0)), list });
  }

  static async #onReset() {
    await game.settings.set("vedmak", "currencies", foundry.utils.deepClone(DEFAULT_MONEY_SETTING));
    this.render();
  }
}
