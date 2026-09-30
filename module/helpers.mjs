// Хелперы Handlebars и предзагрузка шаблонов.

import { signed } from "./util.mjs";

export function registerHelpers() {
  const H = Handlebars;

  H.registerHelper("vedmakSigned", n => signed(n));

  /** Сумма массива чисел (кости d10 в карточке). */
  H.registerHelper("vedmakSum", arr => (Array.isArray(arr) ? arr.reduce((s, v) => s + (Number(v) || 0), 0) : 0));

  /** Подпись из справочника CONFIG.VEDMAK[group][key] (строка или {label}). */
  H.registerHelper("vedmakLabel", (group, key) => {
    const v = CONFIG.VEDMAK[group]?.[key];
    if (v === undefined) return key ?? "";
    return typeof v === "string" ? v : v.label;
  });

  H.registerHelper("vedmakDamageTypes", types =>
    (types ?? []).map(t => CONFIG.VEDMAK.DAMAGE_TYPES[t]?.abbr ?? t).join(", "));

  /** Какие части тела закрывает броня — коротко. */
  H.registerHelper("vedmakArmorCovers", item => {
    const covers = item.system.covers ?? [];
    if (item.system.isShield) return "Щит";
    if (covers.length === 6) return "Всё тело";
    const short = { head: "Гол", torso: "Тул", rightArm: "ПРк", leftArm: "ЛРк", rightLeg: "ПНг", leftLeg: "ЛНг" };
    return covers.map(k => short[k]).join(", ") || "—";
  });

  /** Прочность брони: одно число, если везде одинаково, иначе по частям. */
  H.registerHelper("vedmakArmorSp", item => {
    const sys = item.system;
    if (sys.isShield) return `${sys.reliability.value}/${sys.reliability.max}`;
    const vals = (sys.covers ?? []).map(k => sys.sp[k]);
    if (!vals.length) return "—";
    const same = vals.every(v => v.value === vals[0].value && v.max === vals[0].max);
    return same ? `${vals[0].value}/${vals[0].max}` : vals.map(v => v.value).join("·");
  });

  H.registerHelper("vedmakIncludes", (arr, v) => Array.isArray(arr) && arr.includes(v));
}

export const TEMPLATE_PATHS = [
  "systems/vedmak/templates/chat/check.hbs",
  "systems/vedmak/templates/chat/item.hbs",
  "systems/vedmak/templates/dialog/roll.hbs",
  "systems/vedmak/templates/dialog/parts/head.hbs",
  "systems/vedmak/templates/dialog/parts/mods.hbs",
  "systems/vedmak/templates/dialog/parts/visibility.hbs",
  "systems/vedmak/templates/dialog/parts/total.hbs",
  "systems/vedmak/templates/dialog/save.hbs",
  "systems/vedmak/templates/item/physical.hbs",
  "systems/vedmak/templates/chat/parts/roll.hbs",
  "systems/vedmak/templates/chat/attack.hbs",
  "systems/vedmak/templates/chat/defense.hbs",
  "systems/vedmak/templates/chat/damage.hbs",
  "systems/vedmak/templates/chat/save.hbs",
  "systems/vedmak/templates/chat/turn.hbs",
  "systems/vedmak/templates/dialog/attack.hbs",
  "systems/vedmak/templates/dialog/defense.hbs",
  "systems/vedmak/templates/dialog/damage.hbs",
  "systems/vedmak/templates/dialog/manual-damage.hbs",
  "systems/vedmak/templates/chat/manual-damage.hbs",
  "systems/vedmak/templates/dialog/control.hbs",
  "systems/vedmak/templates/chat/control.hbs",
  "systems/vedmak/templates/dialog/cast.hbs",
  "systems/vedmak/templates/chat/cast.hbs",
  "systems/vedmak/templates/item/parts/mods.hbs",
  "systems/vedmak/templates/dialog/craft.hbs",
  "systems/vedmak/templates/chat/craft.hbs",
  "systems/vedmak/templates/chat/alchemy.hbs",
  "systems/vedmak/templates/actor/parts/vitals.hbs",
  "systems/vedmak/templates/actor/parts/vitals-rail.hbs",
  "systems/vedmak/templates/hud/combat-hud.hbs",
  "systems/vedmak/templates/actor/tab-stats.hbs",
  "systems/vedmak/templates/actor/parts/effects.hbs",
  "systems/vedmak/templates/actor/parts/profession.hbs",
  "systems/vedmak/templates/actor/parts/skill-list.hbs",
  "systems/vedmak/templates/actor/parts/combat-fight.hbs",
  "systems/vedmak/templates/actor/parts/combat-social.hbs",
  "systems/vedmak/templates/actor/parts/monster-abilities.hbs",
  "systems/vedmak/templates/chat/verbal.hbs",
  "systems/vedmak/templates/actor/tab-effects.hbs",
  "systems/vedmak/templates/actor/tab-skills.hbs",
  "systems/vedmak/templates/actor/tab-gear.hbs",
  "systems/vedmak/templates/actor/tab-craft.hbs",
  "systems/vedmak/templates/effect/changes.hbs",
  "systems/vedmak/templates/effect/header.hbs",
  "systems/vedmak/templates/effect/details.hbs",
  "systems/vedmak/templates/effect/duration.hbs"
];

export function preloadTemplates() {
  return foundry.applications.handlebars.loadTemplates(TEMPLATE_PATHS);
}
