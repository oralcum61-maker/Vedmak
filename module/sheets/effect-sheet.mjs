// Лист активного эффекта: вместо путей данных — выпадающий список целей, и всё по-русски.

import { CHANGE_TYPES, effectTargets, targetLabel } from "../config/effects.mjs";

const { ActiveEffectConfig } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

const DURATION_UNITS = {
  seconds: "секунды", minutes: "минуты", hours: "часы", days: "дни", months: "месяцы", years: "годы",
  rounds: "раунды", turns: "ходы"
};
const EXPIRY_EVENTS = {
  turnStart: "в начале хода", turnEnd: "в конце хода",
  roundStart: "в начале раунда", roundEnd: "в конце раунда",
  combatStart: "в начале боя", combatEnd: "в конце боя"
};

export class VedmakEffectConfig extends ActiveEffectConfig {

  static DEFAULT_OPTIONS = {
    classes: ["vedmak", "sheet", "vedmak-effect"],
    position: { width: 620, height: 620 },
    window: { icon: "fa-solid fa-bolt" },
    actions: {
      customKey: VedmakEffectConfig.#onCustomKey
    }
  };

  static PARTS = {
    header: { template: "systems/vedmak/templates/effect/header.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    details: { template: "systems/vedmak/templates/effect/details.hbs", scrollable: [""] },
    duration: { template: "systems/vedmak/templates/effect/duration.hbs", scrollable: [""] },
    changes: { template: "systems/vedmak/templates/effect/changes.hbs", scrollable: ["ol[data-changes]"] },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  static TABS = {
    sheet: {
      tabs: [
        { id: "changes", label: "Изменения", icon: "fa-solid fa-gears" },
        { id: "duration", label: "Длительность", icon: "fa-solid fa-clock" },
        { id: "details", label: "Описание", icon: "fa-solid fa-book" }
      ],
      initial: "changes"
    }
  };

  get title() {
    return `Эффект: ${this.document.name}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const effect = this.document;
    const source = effect._source;

    context.statusChoices = CONFIG.statusEffects
      .map(s => ({ value: s.id, label: game.i18n.localize(s.name) }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));
    context.durationUnits = DURATION_UNITS;
    context.expiryEvents = EXPIRY_EVENTS;
    context.enrichedDescription = await TextEditor.enrichHTML(source.description ?? "", { relativeTo: effect });
    context.isItemEffect = effect.parent?.documentName === "Item";
    context.originLabel = context.isItemEffect ? `Из предмета: ${effect.parent.name}` : "Эффект персонажа";

    const rounds = effect.flags?.vedmak?.timed?.rounds;
    if (rounds) context.durationLabel = `${rounds} р.`;
    else if (source.duration?.value) {
      context.durationLabel = `${source.duration.value} ${DURATION_UNITS[source.duration.units] ?? source.duration.units}`;
    }
    if (effect.start?.round) context.startLabel = `Поставлен в раунде ${effect.start.round}, ход ${effect.start.turn ?? 0}.`;
    return context;
  }

  async _preparePartContext(partId, context, options) {
    const partContext = await super._preparePartContext(partId, context, options);
    if (partId === "duration") {
      // Стандартный лист подставляет свои англоязычные подписи — возвращаем наши
      partContext.durationUnits = DURATION_UNITS;
      partContext.expiryEvents = EXPIRY_EVENTS;
      return partContext;
    }
    if (partId === "footer") {
      partContext.buttons = [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "Сохранить" }];
      return partContext;
    }
    if (partId !== "changes") return partContext;

    const targets = effectTargets();
    const known = new Set(targets.flatMap(g => g.options.map(o => o.value)));
    partContext.changeTypes = CHANGE_TYPES;
    partContext.changes = (context.source.system?.changes ?? []).map((change, index) => ({
      index,
      key: change.key ?? "",
      type: change.type ?? "add",
      value: typeof change.value === "string" ? change.value : JSON.stringify(change.value ?? ""),
      phase: change.phase ?? "initial",
      custom: !!change.key && !known.has(change.key),
      empty: !change.key,
      label: targetLabel(change.key),
      groups: targets.map(g => ({
        label: g.label,
        options: g.options.map(o => ({ ...o, selected: o.value === change.key }))
      }))
    }));
    return partContext;
  }

  /** Переключить строку между списком целей и своим путём данных. */
  static #onCustomKey(event, target) {
    const row = target.closest("[data-index]");
    const custom = row.classList.toggle("custom");
    const select = row.querySelector(".key-field");
    const input = row.querySelector(".key-custom");
    if (custom) input.focus();
    else {
      // Возврат к списку: если путь из списка — выбираем его, иначе сбрасываем
      const known = [...select.options].some(o => o.value === input.value);
      select.value = known ? input.value : "";
      row.querySelector(".key-value").value = select.value;
      select.focus();
    }
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const row of this.element.querySelectorAll("li[data-index]")) {
      const select = row.querySelector("select.key-field");
      const custom = row.querySelector("input.key-custom");
      const value = row.querySelector("input.key-value");
      if (!select || !custom || !value) continue;
      select.addEventListener("change", event => {
        event.stopPropagation();
        if (select.value === "__custom__") {
          row.classList.add("custom");
          custom.value = "";
          custom.focus();
          return;
        }
        value.value = select.value;
        custom.value = select.value;
      });
      custom.addEventListener("change", event => {
        event.stopPropagation();
        value.value = custom.value.trim();
      });
      custom.addEventListener("input", () => { value.value = custom.value.trim(); });
    }
  }
}
