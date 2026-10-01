// Чудовище / НИП бестиария (корник стр. 267–313).

import { int, str, html, source } from "../fields.mjs";
import { statsSchema, skillsSchema, resourcesSchema, prepareCommonDerived } from "./common.mjs";
import { BOOK_METEORITE_CLASSES, BOOK_SILVER_CLASSES } from "../../config/combat.mjs";

const { SchemaField, ArrayField, StringField, BooleanField } = foundry.data.fields;

export const MONSTER_CLASSES = {
  humanoid:  "Гуманоиды",
  beast:     "Звери",
  cursed:    "Проклятые",
  necrophage:"Трупоеды",
  hybrid:    "Гибриды",
  specter:   "Духи",
  insectoid: "Инсектоиды",
  elementa:  "Духи стихий",
  relict:    "Реликты",
  ogroid:    "Огры",
  draconid:  "Дракониды",
  vampire:   "Вампиры"
};

export const THREAT_COMPLEXITY = { simple: "Простые", medium: "Средние", complex: "Сложные" };
export const THREAT_DIFFICULTY = { easy: "Обычные", uncommon: "Незаурядные", hard: "Трудные" };

/** Против какого металла чудовище уязвимо. */
export const MATERIAL_WEAKNESS = {
  auto: "По классу",
  silver: "Серебро",
  meteorite: "Метеоритная сталь",
  none: "Нет (обычное оружие — полный урон)"
};

/** Разделы блока способностей в бестиарии (стр. 267). */
export const ABILITY_KINDS = {
  ability:  "Способность",
  weakness: "Уязвимость",
  variant:  "Разновидность",
  service:  "Услуги",
  note:     "Заметка"
};

export class MonsterData extends foundry.abstract.TypeDataModel {

  static defineSchema() {
    const keys = () => new ArrayField(new StringField({ required: true, blank: false }));
    return {
      stats: statsSchema(5),
      skills: skillsSchema(),
      ...resourcesSchema(),
      monsterClass: str("humanoid"),
      threat: new SchemaField({ complexity: str("simple"), difficulty: str("easy") }),
      bounty: int(0),
      armor: int(0, { min: 0 }),
      vigor: int(0),
      bodyType: str("monster", { choices: ["humanoid", "monster"] }),
      size: str("medium"),
      materialWeakness: str("auto"),
      resistances: keys(),
      susceptibilities: keys(),
      immunities: keys(),
      // Духи и духи стихий: без органов и (у духов) без ног (стр. 159)
      noAnatomy: new BooleanField({ initial: false }),
      noLegs: new BooleanField({ initial: false }),
      info: new SchemaField({
        height: str(""), weight: str(""), habitat: str(""), intelligence: str(""), organization: str(""),
        senses: str(""),
        // Сопротивления и невосприимчивости словами — то, что не ложится в ключи («магия, влияющая на разум»)
        resistText: str(""), immunityText: str(""), susceptText: str("")
      }),
      knowledge: new SchemaField({
        commonDC: int(14), witcherDC: int(14)
      }),
      // Способности, уязвимости, разновидности, услуги НИП: название, раздел, описание (HTML)
      abilities: new ArrayField(new SchemaField({
        name: str(""), kind: str("ability"), description: str("")
      })),
      // Добыча: количество — формулой из книги («1d6/2»), uuid — ссылка на предмет компендиума,
      // taken — монеты уже взяты (отмечает ведущий по сокету, «вернуть» снимает отметку)
      loot: new ArrayField(new SchemaField({
        name: str(""), quantity: str("1"), uuid: str(""), taken: new BooleanField({ initial: false })
      })),
      description: html(),
      commonKnowledge: html(),
      witcherKnowledge: html(),
      notes: html(),
      source: source()
    };
  }

  /**
   * Металл, к которому чудовище восприимчиво: "silver" | "meteorite" | null.
   * Без правила «Чудовища из книг» — все, кроме зверей и гуманоидов, боятся серебра (стр. 162).
   */
  get weakness() {
    if (this.materialWeakness === "none") return null;
    if (this.materialWeakness !== "auto") return this.materialWeakness;
    const cls = this.monsterClass;
    if (cls === "humanoid") return null;
    if (game.settings.settings.has("vedmak.booksMonsters") && game.settings.get("vedmak", "booksMonsters")) {
      if (BOOK_SILVER_CLASSES.includes(cls)) return "silver";
      if (BOOK_METEORITE_CLASSES.includes(cls)) return "meteorite";
      return null;
    }
    return cls === "beast" ? null : "silver";
  }

  /** Нет органов — «органные» криты заменяются бонусным уроном (стр. 159). */
  get lacksAnatomy() { return this.noAnatomy || ["specter", "elementa"].includes(this.monsterClass); }

  /** Нет ног — попадание в ноги перебрасывается (духи). */
  get lacksLegs() { return this.noLegs || this.monsterClass === "specter"; }

  prepareDerivedData() {
    prepareCommonDerived(this, { baseVigor: this.vigor, naturalArmor: this.armor, bodyType: this.bodyType });
    this.luck = { value: 0, max: 0 };
  }
}
