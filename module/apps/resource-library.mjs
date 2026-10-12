// Библиотека ресурсов (PLAN 4.201): все ресурсы библиотеки (config/resources.mjs) и свои ведущего (предметы «Ресурс») —
// разделами, с поиском, ценой и значком. Ресурс перетаскивают на лист поселения или жмут «+» (окно, открытое с листа,
// знает своё поселение) — склад начинает его учитывать. Ведущий создаёт здесь свой ресурс.

import { RESOURCE_CATEGORIES, RESOURCE_LIBRARY, CUSTOM_RESOURCES } from "../config/resources.mjs";
import { worldCurrency } from "../config/money.mjs";
import { addResource } from "../settlement/resources.mjs";
import { compareRu } from "../util.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Тип данных перетаскивания ресурса (лист поселения принимает его в _onDrop). */
export const RESOURCE_DRAG = "VedmakResource";

export class ResourceLibrary extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "vedmak-resources",
    classes: ["vedmak", "vedmak-dialog", "resource-library"],
    window: { title: "Библиотека ресурсов", icon: "fa-solid fa-boxes-stacked", resizable: true },
    position: { width: 780, height: 700 },
    actions: {
      add: ResourceLibrary.#onAdd,
      category: ResourceLibrary.#onCategory,
      create: ResourceLibrary.#onCreate,
      openItem: ResourceLibrary.#onOpenItem
    }
  };

  static PARTS = { body: { template: "systems/vedmak/templates/apps/resource-library.hbs", scrollable: [".rl-list"] } };

  /** Открыть библиотеку; с листа поселения — «+» добавляет в него. */
  static open(settlement = null) {
    const app = foundry.applications.instances.get("vedmak-resources") ?? new ResourceLibrary();
    if (settlement) app.target = settlement.uuid;
    app.render({ force: true });
    return app;
  }

  target = null;
  category = "";
  query = "";

  get #settlement() { return this.target ? fromUuidSync(this.target) : null; }

  async _prepareContext() {
    const town = this.#settlement;
    const stock = town?.system.stock ?? {};
    const cur = worldCurrency();
    const custom = [...CUSTOM_RESOURCES.values()];
    const customNames = new Set(custom.map(x => x.name));
    const all = [...custom, ...RESOURCE_LIBRARY.filter(x => !customNames.has(x.name))];
    const entry = x => ({ name: x.name, img: x.img, hint: x.hint, custom: !!x.custom, uuid: x.uuid ?? "",
      price: `${x.price} ${cur.abbr}`, have: x.name in stock, search: x.name.toLowerCase() });
    const groups = Object.entries(RESOURCE_CATEGORIES)
      .map(([key, label]) => ({ key, label, items: all.filter(x => (x.cat ?? "craft") === key).sort((a, b) => compareRu(a.name, b.name)).map(entry) }))
      .filter(g => g.items.length);
    return {
      town: town ? { name: town.name } : null, gm: game.user.isGM, query: this.query, category: this.category,
      tabs: [{ key: "", label: "Все", count: all.length, active: !this.category },
        ...groups.map(g => ({ key: g.key, label: g.label, count: g.items.length, active: this.category === g.key }))],
      groups: groups.filter(g => !this.category || g.key === this.category),
      ownCount: custom.length
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    const input = el.querySelector(".rl-search");
    const filter = () => {
      const q = this.query.trim().toLowerCase();
      for (const g of el.querySelectorAll(".rl-group")) {
        let any = false;
        for (const it of g.querySelectorAll(".rl-item")) { const hit = !q || it.dataset.search.includes(q); it.hidden = !hit; any ||= hit; }
        g.hidden = !any;
      }
    };
    input?.addEventListener("input", () => { this.query = input.value; filter(); });
    filter();
    for (const it of el.querySelectorAll(".rl-item")) {
      it.addEventListener("dragstart", ev => {
        ev.dataTransfer.setData("text/plain", JSON.stringify({ type: RESOURCE_DRAG, name: it.dataset.name }));
      });
    }
  }

  static async #onAdd(event, target) {
    const name = target.closest("[data-name]").dataset.name;
    const town = this.#settlement;
    if (!town) return ui.notifications.info("Перетащите ресурс на лист поселения или откройте библиотеку с листа поселения.");
    if (await addResource(town, name)) { ui.notifications.info(`«${name}» — на складе «${town.name}».`); this.render(); }
  }

  static #onCategory(event, target) { this.category = target.dataset.key; this.render(); }

  /** Ведущий: свой ресурс — предмет «Ресурс» в папке «Ресурсы». */
  static async #onCreate() {
    if (!game.user.isGM) return;
    const folder = game.folders.find(f => f.type === "Item" && f.name === "Ресурсы")
      ?? await Folder.create({ name: "Ресурсы", type: "Item", color: "#5c4a32" });
    const item = await Item.create({ name: "Новый ресурс", type: "resource", folder: folder.id,
      system: { category: this.category || "craft" } });
    item?.sheet.render(true);
  }

  static async #onOpenItem(event, target) { (await fromUuid(target.closest("[data-uuid]").dataset.uuid))?.sheet.render(true); }
}
