// Хелперы Handlebars и предзагрузка шаблонов.

import { signed, ringHtml } from "./util.mjs";

export function registerHelpers() {
  const H = Handlebars;

  H.registerHelper("vedmakSigned", n => signed(n));

  /** Сумма массива чисел (кости d10 в карточке). */
  H.registerHelper("vedmakSum", arr => (Array.isArray(arr) ? arr.reduce((s, v) => s + (Number(v) || 0), 0) : 0));

  /** Кольцо медальона в карточке чата: десять насечек, десятка сверху; выпавшие грани d10 светятся
      (десятка — калёная, единица первой кости — киноварь). Без костей — простое кольцо. */
  H.registerHelper("vedmakRing", (dice, options) => new H.SafeString(ringHtml(dice, { plain: !!options?.hash?.plain })));

  /** Насечки вместо полосы (надёжность, прочность): value светлых из max, не больше limit штук. */
  H.registerHelper("vedmakNotches", (value, max, options) => {
    const m = Math.max(0, Math.min(Number(max) || 0, 30));
    const v = Math.max(0, Math.min(Number(value) || 0, m));
    return new H.SafeString(`<span class="vd-notches" aria-hidden="true">${"<i></i>".repeat(v)}${'<i class="off"></i>'.repeat(m - v)}</span>`);
  });

  /** Порог испытания d10 «меньше порога»: какие грани проходят — «1–7», «никакие», «все». */
  H.registerHelper("vedmakSaveRange", threshold => {
    const t = Number(threshold) || 0;
    if (t <= 1) return "не пройти";
    if (t > 10) return "любой бросок";
    return t === 2 ? "только 1" : `1–${t - 1}`;
  });

  H.registerHelper("vedmakSub", (a, b) => (Number(a) || 0) - (Number(b) || 0));

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
  "systems/vedmak/templates/apps/tavern-hand.hbs",
  "systems/vedmak/templates/chat/check.hbs",
  "systems/vedmak/templates/chat/initiative.hbs",
  "systems/vedmak/templates/chat/item.hbs",
  "systems/vedmak/templates/dialog/roll.hbs",
  "systems/vedmak/templates/dialog/parts/head.hbs",
  "systems/vedmak/templates/dialog/parts/mods.hbs",
  "systems/vedmak/templates/dialog/parts/visibility.hbs",
  "systems/vedmak/templates/dialog/parts/total.hbs",
  "systems/vedmak/templates/dialog/save.hbs",
  "systems/vedmak/templates/item/physical.hbs",
  "systems/vedmak/templates/chat/parts/roll.hbs",
  "systems/vedmak/templates/chat/parts/die.hbs",
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
  "systems/vedmak/templates/actor/parts/armor-part.hbs",
  "systems/vedmak/templates/hud/combat-hud.hbs",
  "systems/vedmak/templates/actor/tab-stats.hbs",
  "systems/vedmak/templates/actor/parts/effects.hbs",
  "systems/vedmak/templates/actor/parts/profession.hbs",
  "systems/vedmak/templates/actor/parts/race-powers.hbs",
  "systems/vedmak/templates/actor/parts/dragon-form.hbs",
  "systems/vedmak/templates/actor/parts/skill-list.hbs",
  "systems/vedmak/templates/actor/parts/combat-fight.hbs",
  "systems/vedmak/templates/actor/parts/combat-social.hbs",
  "systems/vedmak/templates/actor/parts/social-status.hbs",
  "systems/vedmak/templates/actor/parts/monster-abilities.hbs",
  "systems/vedmak/templates/chat/verbal.hbs",
  "systems/vedmak/templates/chat/verbal-outcome.hbs",
  "systems/vedmak/templates/parts/lifepath-cards.hbs",
  "systems/vedmak/templates/parts/lifepath-story.hbs",
  "systems/vedmak/templates/actor/tab-effects.hbs",
  "systems/vedmak/templates/actor/tab-skills.hbs",
  "systems/vedmak/templates/actor/tab-gear.hbs",
  "systems/vedmak/templates/actor/tab-craft.hbs",
  "systems/vedmak/templates/effect/changes.hbs",
  "systems/vedmak/templates/effect/header.hbs",
  "systems/vedmak/templates/effect/details.hbs",
  "systems/vedmak/templates/effect/duration.hbs",
  "systems/vedmak/templates/actor/parts/medal.hbs",
  // Части листов, окон и предметов — тоже заранее (PLAN 4.54): иначе каждый шаблон скачивается и компилируется
  // при первом открытии своего окна или вкладки, и первый клик подвисает
  "systems/vedmak/templates/actor/character-rail.hbs",
  "systems/vedmak/templates/actor/limited.hbs",
  "systems/vedmak/templates/actor/monster-header.hbs",
  "systems/vedmak/templates/actor/loot-sheet.hbs",
  "systems/vedmak/templates/actor/monster-lore.hbs",
  "systems/vedmak/templates/actor/monster-stats.hbs",
  "systems/vedmak/templates/actor/tab-bio.hbs",
  "systems/vedmak/templates/actor/tab-combat.hbs",
  "systems/vedmak/templates/actor/tab-magic.hbs",
  "systems/vedmak/templates/apps/currencies-footer.hbs",
  "systems/vedmak/templates/apps/currencies.hbs",
  "systems/vedmak/templates/apps/schools-footer.hbs",
  "systems/vedmak/templates/apps/schools.hbs",
  "systems/vedmak/templates/apps/cleanup.hbs",
  "systems/vedmak/templates/apps/cleanup-footer.hbs",
  "systems/vedmak/templates/apps/wizard.hbs",
  "systems/vedmak/templates/chat/lifepath.hbs",
  "systems/vedmak/templates/item/description.hbs",
  "systems/vedmak/templates/item/details-alchemical.hbs",
  "systems/vedmak/templates/item/details-armor.hbs",
  "systems/vedmak/templates/item/details-component.hbs",
  "systems/vedmak/templates/item/details-critWound.hbs",
  "systems/vedmak/templates/item/details-enhancement.hbs",
  "systems/vedmak/templates/item/details-gear.hbs",
  "systems/vedmak/templates/item/details-profession.hbs",
  "systems/vedmak/templates/item/details-race.hbs",
  "systems/vedmak/templates/item/details-recipe.hbs",
  "systems/vedmak/templates/item/details-spell.hbs",
  "systems/vedmak/templates/item/details-weapon.hbs",
  "systems/vedmak/templates/item/effects.hbs",
  "systems/vedmak/templates/item/header.hbs"
];

export function preloadTemplates() {
  return foundry.applications.handlebars.loadTemplates(TEMPLATE_PATHS);
}
