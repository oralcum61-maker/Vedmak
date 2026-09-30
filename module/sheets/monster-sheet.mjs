// Лист чудовища (бестиарий, корник стр. 267–313).

import { VedmakActorSheet } from "./actor-sheet-base.mjs";
import { MONSTER_CLASSES, THREAT_COMPLEXITY, THREAT_DIFFICULTY, MATERIAL_WEAKNESS, ABILITY_KINDS } from "../data/actor/monster.mjs";
import { BODY_TYPES, RESIST_KEYS, SIZE_MODS } from "../config/combat.mjs";
import { currencyForName, lootCoins } from "../character/money.mjs";

/** Списки объектов на форме (name="system.abilities.0.name") — собираются обратно в массивы. */
const OBJECT_ARRAYS = ["abilities", "loot"];
const ROW_TEMPLATES = {
  abilities: { name: "Новая способность", kind: "ability", description: "" },
  loot: { name: "", quantity: "1", uuid: "" }
};

export class MonsterSheet extends VedmakActorSheet {

  static DEFAULT_OPTIONS = {
    classes: ["monster"],
    position: { width: 820, height: 780 },
    actions: {
      rowAdd: MonsterSheet.#onRowAdd,
      rowDelete: MonsterSheet.#onRowDelete,
      toggleAbilityEdit: MonsterSheet.#onToggleAbilityEdit,
      abilityPost: MonsterSheet.#onAbilityPost,
      lootCoins: MonsterSheet.#onLootCoins
    }
  };

  /** Способности и добыча: просмотр или правка (состояние окна). */
  editAbilities = false;

  static PARTS = {
    header:  { template: "systems/vedmak/templates/actor/monster-header.hbs" },
    tabs:    { template: "templates/generic/tab-navigation.hbs" },
    stats:   { template: "systems/vedmak/templates/actor/monster-stats.hbs", scrollable: [""] },
    combat:  { template: "systems/vedmak/templates/actor/tab-combat.hbs", scrollable: [""] },
    skills:  { template: "systems/vedmak/templates/actor/tab-skills.hbs", scrollable: [""] },
    gear:    { template: "systems/vedmak/templates/actor/tab-gear.hbs", scrollable: [""] },
    magic:   { template: "systems/vedmak/templates/actor/tab-magic.hbs", scrollable: [""] },
    lore:    { template: "systems/vedmak/templates/actor/monster-lore.hbs", scrollable: [""] },
    effects: { template: "systems/vedmak/templates/actor/tab-effects.hbs", scrollable: [""] }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "stats",   label: "Параметры",  icon: "fa-solid fa-dragon" },
        { id: "combat",  label: "Бой",        icon: "fa-solid fa-swords" },
        { id: "skills",  label: "Навыки",     icon: "fa-solid fa-list-check" },
        { id: "gear",    label: "Атаки",      icon: "fa-solid fa-khanda" },
        { id: "magic",   label: "Магия",      icon: "fa-solid fa-hand-sparkles" },
        { id: "lore",    label: "Знания",     icon: "fa-solid fa-book-skull" },
        { id: "effects", label: "Эффекты",    icon: "fa-solid fa-bolt" }
      ],
      initial: "stats"
    }
  };

  /** У чудовищ по умолчанию видны только изученные навыки. */
  trainedOnly = true;

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.actor.system;
    Object.assign(context, {
      monsterClasses: MONSTER_CLASSES,
      threatComplexity: THREAT_COMPLEXITY,
      threatDifficulty: THREAT_DIFFICULTY,
      bodyTypes: BODY_TYPES,
      sizes: Object.fromEntries(Object.entries(SIZE_MODS).map(([k, v]) => [k, v.label])),
      weaknesses: MATERIAL_WEAKNESS,
      resistKeys: RESIST_KEYS,
      weaknessNow: { silver: "серебро", meteorite: "метеоритная сталь" }[system.weakness] ?? "нет",
      enrichedDescription: await this.enrich(system.description),
      enrichedCommon: await this.enrich(system.commonKnowledge),
      enrichedWitcher: await this.enrich(system.witcherKnowledge),
      enrichedNotes: await this.enrich(system.notes)
    });
    context.stats = context.stats.filter(s => s.key !== "luck");

    // Способности по разделам книги; номер строки — для правки и удаления
    context.editAbilities = this.editAbilities;
    context.abilityKinds = ABILITY_KINDS;
    const rows = await Promise.all(system.abilities.map(async (a, index) => ({
      ...a, index, enriched: await this.enrich(a.description)
    })));
    context.abilityGroups = Object.entries(ABILITY_KINDS)
      .map(([kind, label]) => ({ kind, label, rows: rows.filter(r => (ABILITY_KINDS[r.kind] ? r.kind : "ability") === kind) }))
      .filter(g => g.rows.length);
    context.abilityRows = rows;
    context.hasResistText = !!(system.info.resistText || system.info.immunityText || system.info.susceptText);

    // Добыча: ссылка на предмет компендиума тянется мышью на лист героя
    context.loot = await Promise.all(system.loot.map(async (l, index) => ({
      ...l, index,
      link: l.uuid ? await this.enrich(`@UUID[${l.uuid}]{${l.name}}`) : "",
      coins: !l.uuid && !!currencyForName(l.name)
    })));
    return context;
  }

  /** name="system.abilities.0.name" → массив. */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    for (const key of OBJECT_ARRAYS) {
      const v = data.system?.[key];
      if (v && !Array.isArray(v) && typeof v === "object") {
        data.system[key] = Object.keys(v).sort((a, b) => a - b).map(k => v[k]);
      }
    }
    return data;
  }

  /* ------------------------------ Действия ------------------------------ */

  static async #onRowAdd(event, target) {
    const field = target.dataset.field;
    const rows = foundry.utils.deepClone(this.actor.system.toObject()[field] ?? []);
    rows.push(foundry.utils.deepClone(ROW_TEMPLATES[field] ?? {}));
    this.editAbilities = true;
    await this.actor.update({ [`system.${field}`]: rows });
  }

  static async #onRowDelete(event, target) {
    const field = target.dataset.field;
    const index = Number(target.closest("[data-index]").dataset.index);
    const rows = foundry.utils.deepClone(this.actor.system.toObject()[field] ?? []);
    rows.splice(index, 1);
    await this.actor.update({ [`system.${field}`]: rows });
  }

  static #onToggleAbilityEdit() {
    this.editAbilities = !this.editAbilities;
    this.render();
  }

  /** Способность — в чат, чтобы игроки видели, что происходит. */
  /** Монеты из добычи — в кошелёк персонажа пользователя или выделенного токена. */
  static async #onLootCoins(event, target) {
    const row = this.actor.system.loot[Number(target.closest("[data-index]").dataset.index)];
    if (row) await lootCoins(this.actor, row);
  }

  static async #onAbilityPost(event, target) {
    const a = this.actor.system.abilities[Number(target.closest("[data-index]").dataset.index)];
    if (!a) return;
    const kind = ABILITY_KINDS[a.kind] ?? ABILITY_KINDS.ability;
    const content = `<div class="vedmak-card ability">
      <header class="card-head">
        <span class="card-glyph"><i class="fa-solid fa-paw"></i></span>
        <div class="card-ident"><span class="card-name">${foundry.utils.escapeHTML(a.name)}</span>
          <span class="card-sub">${foundry.utils.escapeHTML(this.actor.name)} · ${kind}</span></div>
      </header>
      <div class="card-body">${a.description}</div>
    </div>`;
    await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor: this.actor }) });
  }
}
