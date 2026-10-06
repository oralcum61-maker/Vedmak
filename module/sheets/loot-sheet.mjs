// Лист хранилища — сундук, сумка, повозка, склад, лавка (актёр «loot», PLAN 4.115): вещи одним списком по группам,
// вес и вместимость, деньги, описание. Наблюдатель берёт вещи и деньги (лавка — продаёт), владелец правит.

import { STORAGE_KINDS } from "../data/actor/loot.mjs";
import { STORAGE_GROUPS, takeFromStorage, takeStorageMoney, putIntoStorage, priceFor, unitPrice, STACKABLE,
  crownsLabel } from "../character/storage.mjs";
import { currencies, formatRate } from "../config/money.mjs";
import { compareRu } from "../util.mjs";
import { markLockedActions, guardLockedActions } from "./view-only.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

/** Действия, доступные тому, кто хранилище только видит (Наблюдатель): взять, купить, посмотреть вещь. */
const VIEW_ACTIONS = new Set(["take", "takeMoney", "itemEdit", "itemPost"]);

const kg = n => `${formatRate(n)} кг`;

export class LootSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["vedmak", "sheet", "actor", "storage"],
    position: { width: 600, height: 720 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      take: LootSheet.#onTake,
      takeMoney: LootSheet.#onTakeMoney,
      itemEdit: LootSheet.#onItemEdit,
      itemDelete: LootSheet.#onItemDelete,
      itemPost: LootSheet.#onItemPost
    }
  };

  static PARTS = {
    body: { template: "systems/vedmak/templates/actor/loot-sheet.hbs", scrollable: [".st-scroll"] }
  };

  /** Право ниже Наблюдателя — видно только, что это за хранилище. */
  get limitedView() {
    return !this.document.testUserPermission(game.user, "OBSERVER");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;
    const kind = STORAGE_KINDS[system.kind] ?? STORAGE_KINDS.chest;
    const shop = system.kind === "shop";
    const editable = this.isEditable;
    const limited = this.limitedView;
    const canTake = !limited;

    // Вещи по группам: тип из списка — своя группа, прочее — «Прочее»
    const byType = new Map();
    for (const item of actor.items) {
      const key = STORAGE_GROUPS.some(([t]) => t === item.type) ? item.type : "other";
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key).push(item);
    }
    const groups = [...STORAGE_GROUPS, ["other", "Прочее"]].filter(([t]) => byType.has(t)).map(([type, label]) => {
      const items = byType.get(type).sort((a, b) => (a.sort - b.sort) || compareRu(a.name, b.name)).map(item => {
        const s = item.system;
        const qty = Number.isFinite(s.quantity) ? s.quantity : null;
        const weight = (Number(s.weight) || 0) * (qty ?? 1);
        const cost = typeof s.cost === "number" ? s.cost : 0;
        return {
          id: item.id, img: item.img, name: item.name, qty, stack: STACKABLE.includes(item.type),
          weight: weight ? kg(weight) : "",
          price: shop ? (cost ? crownsLabel(unitPrice(actor, item)) : "") : (cost ? crownsLabel(cost) : ""),
          takeLabel: shop ? (cost ? `Купить · ${crownsLabel(priceFor(actor, item, 1))}` : "Взять") : "Взять"
        };
      });
      return { type, label, items, count: items.length };
    });

    const load = system.load ?? { weight: 0, value: 0, over: false };
    const money = currencies().map(c => ({ key: c.key, label: c.label, abbr: c.abbr, value: system.money?.[c.key] ?? 0 }));
    const hasMoney = money.some(m => m.value > 0);
    Object.assign(context, {
      actor, system, systemFields: system.schema.fields, editable, limited, canTake, shop,
      kind: { ...kind, key: system.kind },
      kinds: Object.entries(STORAGE_KINDS).map(([key, k]) => ({ key, label: k.label, selected: key === system.kind })),
      groups, empty: !groups.length,
      load: {
        weight: kg(load.weight), capacity: system.capacity ? kg(system.capacity) : "", over: load.over,
        pct: system.capacity > 0 ? Math.min(100, Math.round((load.weight / system.capacity) * 100)) : 0,
        value: load.value ? crownsLabel(load.value) : ""
      },
      // Деньги: владелец правит все валюты, остальные видят только непустые
      money: editable ? money : money.filter(m => m.value > 0),
      hasMoney, canTakeMoney: canTake && hasMoney && (!shop || game.user.isGM),
      enrichedDescription: await TextEditor.enrichHTML(system.description ?? "", { secrets: actor.isOwner, relativeTo: actor })
    });
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    markLockedActions(this, { view: VIEW_ACTIONS, inert: new Set() });
  }

  _attachFrameListeners() {
    super._attachFrameListeners();
    guardLockedActions(this, VIEW_ACTIONS);
  }

  /** Положить свою вещь может и тот, кто хранилище только видит: перенос делает ведущий. */
  _canDragDrop() {
    return !this.limitedView;
  }

  /**
   * Своя вещь с листа персонажа — переносится (character/storage.mjs); из компендиума или списка предметов —
   * копия, одинаковое складывается; внутри хранилища — сортировка.
   */
  async _onDropItem(event, item) {
    const actor = this.actor;
    if (item.parent === actor) return actor.isOwner ? super._onDropItem(event, item) : null;
    if (item.parent?.documentName === "Actor") return putIntoStorage(actor, item);
    if (!actor.isOwner) return null;
    if (STACKABLE.includes(item.type)) {
      const same = actor.items.find(i => i.type === item.type && i.name === item.name);
      if (same) return same.update({ "system.quantity": (same.system.quantity ?? 1) + (item.system.quantity ?? 1) });
    }
    return super._onDropItem(event, item);
  }

  static #itemFrom(target) {
    return this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
  }

  static async #onTake(event, target) {
    const item = LootSheet.#itemFrom.call(this, target);
    // Shift — всё сразу, без вопроса «сколько» (в лавке — одну)
    const qty = event.shiftKey ? (this.actor.system.kind === "shop" ? 1 : (item?.system.quantity ?? 1)) : null;
    if (item) await takeFromStorage(this.actor, item, { qty });
  }

  static async #onTakeMoney() {
    await takeStorageMoney(this.actor);
  }

  static #onItemEdit(event, target) {
    LootSheet.#itemFrom.call(this, target)?.sheet.render(true);
  }

  static async #onItemDelete(event, target) {
    const item = LootSheet.#itemFrom.call(this, target);
    if (!item) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Удалить предмет" }, content: `<p>Удалить «${foundry.utils.escapeHTML(item.name)}»?</p>`
    });
    if (ok) await item.delete();
  }

  static async #onItemPost(event, target) {
    await LootSheet.#itemFrom.call(this, target)?.toChat();
  }
}
