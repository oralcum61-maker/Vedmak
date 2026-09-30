// Документ предмета: карточка в чат и краткая сводка свойств.

import { renderTemplate, signed } from "../util.mjs";

const TextEditor = foundry.applications.ux.TextEditor.implementation;

export class VedmakItem extends Item {

  /** Ключевые свойства для карточки и подсказок: [{label, value}]. */
  get summary() {
    const s = this.system;
    const V = CONFIG.VEDMAK;
    const out = [];
    const push = (label, value) => { if (value !== "" && value !== null && value !== undefined) out.push({ label, value }); };
    switch (this.type) {
      case "weapon":
        push("Навык", V.WEAPON_SKILLS[s.skill] ?? s.skill);
        push("Точность", signed(s.accuracy));
        push("Урон", s.damage);
        push("Тип", s.damageTypes.map(t => V.DAMAGE_TYPES[t]?.label ?? t).join(", "));
        push("Надёжность", `${s.reliability.value}/${s.reliability.max}`);
        push("Хват", s.hands ? `${s.hands}` : "");
        push("Дистанция", s.range);
        push("Эффекты", s.effects.map(e => {
          const label = V.WEAPON_EFFECTS[e.key]?.label ?? e.key;
          return e.value ? `${label} (${e.value})` : label;
        }).join(", "));
        break;
      case "armor": {
        push("Класс", V.ARMOR_WEIGHT_CLASS[s.weightClass]);
        if (s.isShield) push("Надёжность", `${s.reliability.value}/${s.reliability.max}`);
        else for (const k of s.covers) push(V.ARMOR_LOCATIONS[k], `${s.sp[k].value}/${s.sp[k].max}`);
        push("Скованность", s.encumbrance || "");
        const res = Object.entries(s.resistances).filter(([, v]) => v).map(([k]) => ({
          slashing: "режущий", piercing: "колющий", bludgeoning: "дробящий", elemental: "стихийный",
          bleeding: "кровотечение", poison: "отравление"
        })[k]);
        push("Сопротивление", res.join(", "));
        push("Эффекты", s.effectsText);
        push("Усиления", s.enhancements.map(e => e.name).join(", "));
        break;
      }
      case "component":
        push("Группа", V.COMPONENT_GROUPS[s.group]);
        push("Субстанция", V.SUBSTANCES[s.substance]?.label ?? "");
        push("Где найти", s.forage.where);
        push("Собрать", s.forage.dc ? `${s.forage.quantity} (Выживание, СЛ ${s.forage.dc})` : "");
        break;
      case "recipe":
        push("Вид", V.RECIPE_KINDS[s.kind]);
        push("Уровень", V.RECIPE_LEVELS[s.level]);
        push("СЛ", s.dc);
        push("Время", s.time);
        push("Результат", `${s.result.name}${s.result.quantity > 1 ? ` ×${s.result.quantity}` : ""}`);
        push("Компоненты", s.components.map(c => `${c.name} ×${c.quantity}`).join(", "));
        push("Субстанции", s.substanceList.map(([k, n]) => `${V.SUBSTANCES[k].label} ×${n}`).join(", "));
        push("Доплата", s.surcharge ? `${s.surcharge} кр.` : "");
        push("Кузница", s.needsForge ? "нужна" : "");
        break;
      case "alchemical":
        push("Вид", V.ALCHEMY_KINDS[s.kind]);
        push("Эффект", s.effect);
        push("Длительность", s.duration);
        push("Токсичность", s.toxicity ? `${s.toxicity}%` : "");
        push("Урон", s.use.damage);
        push("Зона", s.use.area);
        push("Малая мутация", s.mutagen.minor);
        push("СЛ Алхимии", s.mutagen.dc || "");
        break;
      case "enhancement":
        push("Вид", V.ENHANCEMENT_KINDS[s.kind]);
        push("ПБ", s.sp ? `+${s.sp}` : "");
        push("Эффект", s.effect);
        break;
      case "gear":
        push("Категория", V.GEAR_CATEGORIES[s.category]);
        push("Эффект", s.effect);
        break;
      case "spell":
        push("Вид", V.MAGIC_KINDS[s.kind]);
        push("Уровень", V.levelLabel(s.kind, s.level));
        push("Стихия", ["spell", "sign"].includes(s.kind) ? V.MAGIC_ELEMENTS[s.element] : "");
        push("Ветвь", V.MAGIC_BRANCHES[s.branch] ?? "");
        push("Божество", s.god);
        push("Затраты Вын", s.variableCost ? `переменные${s.maxCost ? ` (до ${s.maxCost})` : ""}` : s.staCost);
        push("Дистанция", s.range);
        push("Длительность", s.duration);
        push("Защита", s.kind === "ritual" ? "" : s.defenseText || V.MAGIC_DEFENSES[s.defense]);
        push("Подготовка", s.preparation);
        push("СЛ", s.dcText || s.dc || "");
        push("Ингредиенты", s.ingredients);
        push("На замену", s.altIngredients);
        break;
      case "profession":
        push("Определяющий навык", s.definingSkill.name);
        push("Энергия", s.vigor || "");
        push("Магия", s.magicAbilities);
        break;
      case "race":
        push("Черты", s.traits.map(t => t.name).join(", "));
        break;
    }
    if (["weapon", "armor", "gear", "component", "alchemical", "enhancement"].includes(this.type)) {
      push("Вес", s.weight);
      push("Цена", s.cost ? `${s.cost} кр.` : "");
    }
    if (s.source?.page) push("Источник", `${s.source.book}, стр. ${s.source.page}`);
    return out;
  }

  /** Вывести описание предмета в чат. */
  async toChat() {
    const description = await TextEditor.enrichHTML(this.system.description ?? "", {
      secrets: this.isOwner, relativeTo: this
    });
    const content = await renderTemplate("systems/vedmak/templates/chat/item.hbs", {
      item: this, typeLabel: game.i18n.localize(`TYPES.Item.${this.type}`), summary: this.summary, description
    });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content,
      flags: { vedmak: { itemUuid: this.uuid } }
    });
  }
}
