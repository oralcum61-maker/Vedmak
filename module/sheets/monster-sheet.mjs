// Лист чудовища (бестиарий, корник стр. 267–313).

import { VedmakActorSheet } from "./actor-sheet-base.mjs";
import { MONSTER_CLASSES, THREAT_COMPLEXITY, THREAT_DIFFICULTY, MATERIAL_WEAKNESS, ABILITY_KINDS } from "../data/actor/monster.mjs";
import { BODY_TYPES, RESIST_KEYS, SIZE_MODS } from "../config/combat.mjs";
import { currencyForName, lootCoins } from "../character/money.mjs";
import { asGM } from "../combat/common.mjs";
import { traitSummary } from "../combat/monster-traits.mjs";
import { professionContext, swapBranch } from "./profession-context.mjs";
import { setAbilityValue } from "../character/advancement.mjs";

/** Списки объектов на форме (name="system.abilities.0.name") — собираются обратно в массивы. */
const OBJECT_ARRAYS = ["abilities", "loot"];

/**
 * Ссылка на документ — такая же, как из @UUID[…]{…}: щелчок открывает, мышью тянется на лист.
 * Строится сразу, без обогащения HTML. Для компендиума нужны data-pack и data-type — по ним Foundry
 * собирает данные перетаскивания.
 */
function contentLink(uuid, name) {
  const esc = foundry.utils.escapeHTML;
  const m = uuid.match(/^Compendium\.([^.]+\.[^.]+)\.(\w+)\.([^.]+)$/);
  const type = m?.[2] ?? uuid.split(".")[0];
  const pack = m ? ` data-pack="${esc(m[1])}" data-type="${esc(type)}" data-id="${esc(m[3])}"` : "";
  const icon = CONFIG[type]?.sidebarIcon ?? "fa-solid fa-link";
  return `<a class="content-link" draggable="true" data-link data-uuid="${esc(uuid)}"${pack}><i class="${icon}"></i>${esc(name)}</a>`;
}

const ROW_TEMPLATES = {
  abilities: { name: "Новая способность", kind: "ability", description: "" },
  loot: { name: "", quantity: "1", uuid: "", taken: false }
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
      lootCoins: MonsterSheet.#onLootCoins,
      lootReset: MonsterSheet.#onLootReset,
      rollDefining: MonsterSheet.#onRollDefining,
      rollAbility: MonsterSheet.#onRollAbility,
      swapBranch: MonsterSheet.#onSwapBranch
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
        { id: "stats",   label: "Параметры" },
        { id: "combat",  label: "Бой" },
        { id: "skills",  label: "Навыки" },
        { id: "gear",    label: "Атаки" },
        { id: "magic",   label: "Магия" },
        { id: "lore",    label: "Знания" },
        { id: "effects", label: "Эффекты" }
      ],
      initial: "stats"
    },
    // Подвкладки «Навыков» (PLAN 4.259): навыки и профессия НИП — как у персонажа
    skills: {
      tabs: [
        { id: "list", label: "Навыки" },
        { id: "profession", label: "Профессия" }
      ],
      initial: "list"
    },
    // Подвкладки «Боя»: обычный бой и словесная дуэль — как у персонажа
    combat: {
      tabs: [
        { id: "fight",  label: "Бой" },
        { id: "social", label: "Социальный бой" }
      ],
      initial: "fight"
    }
  };

  /** У чудовищ по умолчанию видны только изученные навыки. */
  trainedOnly = true;

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.actor.system;
    // Право «Ограниченный»: только то, что видно глазами. Класс, описание, поверья и ведьмачьи знания
    // открывает проверка Образования или Монстрологии против СЛ — их говорит ведущий, а не лист
    if (context.limited) {
      context.limitedFacts = [["Рост", system.info.height], ["Вес", system.info.weight]]
        .filter(([, value]) => value).map(([label, value]) => ({ label, value }));
      context.limitedHint = "Что известно о таком существе, ведущий расскажет после проверки знаний.";
      // Заметки для игроков — то, что ведущий уже открыл
      if (system.playerNotes) context.limitedNotes = await this.enrich(system.playerNotes);
      return context;
    }
    // Две группы вкладок (с 4.42 — ещё подвкладки «Боя»): Foundry сам готовит вкладки, только когда группа одна
    context.tabs = this._prepareTabs("primary");
    Object.assign(context, {
      monsterClasses: MONSTER_CLASSES,
      threatComplexity: THREAT_COMPLEXITY,
      threatDifficulty: THREAT_DIFFICULTY,
      bodyTypes: BODY_TYPES,
      sizes: Object.fromEntries(Object.entries(SIZE_MODS).map(([k, v]) => [k, v.label])),
      weaknesses: MATERIAL_WEAKNESS,
      resistKeys: RESIST_KEYS,
      weaknessNow: { silver: "серебро", meteorite: "метеоритная сталь" }[system.weakness] ?? "нет"
    });
    context.stats = context.stats.filter(s => s.key !== "luck");
    context.editAbilities = this.editAbilities;
    // Профессия НИП (PLAN 4.259): тот же блок, что у персонажа, без развития за О.У
    context.prof = professionContext(this.actor);
    context.skillTabs = this._prepareTabs("skills");
    context.abilityKinds = ABILITY_KINDS;
    context.hasResistText = !!(system.info.resistText || system.info.immunityText || system.info.susceptText);
    return context;
  }

  /**
   * Обогащённый HTML — только вкладке, которая его показывает: «Параметры» — способности,
   * «Знания» — описания и добыча. Раньше всё это обогащалось на каждое изменение любого поля.
   */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    const system = this.actor.system;
    if (partId === "stats") {
      // Способности по разделам книги; номер строки — для правки и удаления
      const rows = await Promise.all(system.abilities.map(async (a, index) => ({
        ...a, index, enriched: await this.enrich(a.description)
      })));
      context.abilityGroups = Object.entries(ABILITY_KINDS)
        .map(([kind, label]) => ({ kind, label, rows: rows.filter(r => (ABILITY_KINDS[r.kind] ? r.kind : "ability") === kind) }))
        .filter(g => g.rows.length);
      context.abilityRows = rows;
      // Что из способностей система делает сама: регенерация, бесплотность, полёт
      context.autoTraits = traitSummary(this.actor);
    }
    if (partId === "lore") {
      const [description, common, witcher, notes, playerNotes] = await Promise.all([system.description, system.commonKnowledge,
        system.witcherKnowledge, this.actor.isOwner ? system.notes : "", system.playerNotes].map(html => this.enrich(html)));
      Object.assign(context, { enrichedDescription: description, enrichedCommon: common, enrichedWitcher: witcher, enrichedNotes: notes,
        enrichedPlayerNotes: playerNotes });
      // Добыча: ссылка на предмет компендиума тянется мышью на лист героя. Ссылку строим сами —
      // без обогащения HTML на каждую строку
      context.loot = system.loot.map((l, index) => ({
        ...l, index, link: l.uuid ? contentLink(l.uuid, l.name) : "", coins: !l.uuid && !!currencyForName(l.name)
      }));
    }
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
    // Отметка «монеты взяты» — не поле формы: без этого правка добычи сбрасывала бы её у всех строк
    if (Array.isArray(data.system?.loot)) {
      const old = this.actor.system.loot;
      data.system.loot.forEach((row, i) => { row.taken = !!old[i]?.taken; });
    }
    return data;
  }

  /* ------------------------------ Действия ------------------------------ */

  static async #onRollDefining(event) { await this.actor.rollDefining({ skipDialog: event.shiftKey }); }

  static async #onSwapBranch(event, target) {
    await swapBranch(this.actor, Number(target.dataset.alt), Number(target.dataset.branch));
  }

  static async #onRollAbility(event, target) {
    await this.actor.rollAbility(Number(target.dataset.branch), Number(target.dataset.index), { skipDialog: event.shiftKey });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Значения древа и определяющего навыка хранятся в предмете профессии — как у персонажа
    this._listen("input.ability-value", "change", (event, input) => {
      event.stopPropagation();
      const prof = this.actor.system.profession;
      if (prof) setAbilityValue(prof, Number(input.dataset.branch), Number(input.dataset.index), input.value);
    });
    this._listen("input.defining-value", "change", (event, input) => {
      event.stopPropagation();
      this.actor.system.profession?.update({ "system.definingSkill.value": Math.max(0, Number(input.value) || 0) });
    });
  }

  /** Профессия у НИП одна: новая заменяет прежнюю (очки древа прежней пропадут). */
  async _onDropItem(event, item) {
    if (item.type === "profession" && this.actor.isOwner && item.parent?.uuid !== this.actor.uuid) {
      const old = this.actor.itemTypes.profession;
      if (old.length) {
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Сменить профессию" },
          content: `<p>Заменить «${old[0].name}» на «${item.name}»? Очки, вложенные в древо прежней профессии, пропадут.</p>` });
        if (!ok) return null;
        await this.actor.deleteEmbeddedDocuments("Item", old.map(i => i.id));
      }
    }
    return super._onDropItem(event, item);
  }

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

  /** Ведущий возвращает монеты в добычу: их снова можно взять. */
  static async #onLootReset(event, target) {
    if (!game.user.isGM) return;
    const index = Number(target.closest("[data-index]").dataset.index);
    const row = this.actor.system.loot[index];
    if (row) await asGM("lootTaken", { uuid: this.actor.uuid, index, name: row.name, taken: false });
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
