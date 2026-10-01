// «Ведьмак: НРИ» — система для Foundry VTT v14.

import * as STATS_CFG from "./module/config/stats.mjs";
import * as SKILLS_CFG from "./module/config/skills.mjs";
import * as ITEMS_CFG from "./module/config/items.mjs";
import * as COMBAT_CFG from "./module/config/combat.mjs";
import * as MAGIC_CFG from "./module/config/magic.mjs";
import * as CHARACTER_CFG from "./module/config/character.mjs";
import * as CRAFTING_CFG from "./module/config/crafting.mjs";
import * as crafting from "./module/crafting/craft.mjs";
import * as alchemy from "./module/crafting/alchemy.mjs";
import * as enhancements from "./module/crafting/enhancements.mjs";
import { MONSTER_CLASSES, THREAT_COMPLEXITY, THREAT_DIFFICULTY } from "./module/data/actor/monster.mjs";
import { ACTOR_MODELS, ITEM_MODELS } from "./module/data/_module.mjs";
import { VedmakActor } from "./module/documents/actor.mjs";
import { VedmakItem } from "./module/documents/item.mjs";
import { CharacterSheet } from "./module/sheets/character-sheet.mjs";
import { MonsterSheet } from "./module/sheets/monster-sheet.mjs";
import { VedmakItemSheet } from "./module/sheets/item-sheet.mjs";
import { VedmakEffectConfig } from "./module/sheets/effect-sheet.mjs";
import { registerHelpers, preloadTemplates } from "./module/helpers.mjs";
import { performCheck, rollD10 } from "./module/dice/check.mjs";
import { SYSTEM_ID } from "./module/util.mjs";
import { registerStatusEffects } from "./module/combat/statuses.mjs";
import { VedmakCombat } from "./module/combat/combat.mjs";
import { registerChatListeners } from "./module/combat/chat.mjs";
import { registerCombatAutomation } from "./module/combat/auto.mjs";
import { registerZoneHooks } from "./module/combat/zones.mjs";
import { registerAlchemyHooks } from "./module/crafting/alchemy-triggers.mjs";
import { registerBuffHooks } from "./module/magic/buffs.mjs";
import { registerRaceHooks } from "./module/character/race.mjs";
import { initSocket } from "./module/combat/common.mjs";
import { attack } from "./module/combat/attack.mjs";
import { computeDamage, applyDamageToActor } from "./module/combat/damage.mjs";
import { rollStunSave, rollDeathSave } from "./module/combat/saves.mjs";
import { manualDamage, restTurn, restDays } from "./module/combat/manual.mjs";
import { controlCheck } from "./module/combat/mounted.mjs";
import { castSpell } from "./module/magic/cast.mjs";
import "./module/magic/effects.mjs";
import { CharacterWizard } from "./module/character/wizard.mjs";
import * as advancement from "./module/character/advancement.mjs";
import { CombatHud } from "./module/apps/combat-hud.mjs";
import { CurrencyConfig } from "./module/apps/currency-config.mjs";
import { SchoolConfig } from "./module/apps/school-config.mjs";
import { profileSheet } from "./module/apps/perf.mjs";
import { DEFAULT_MONEY_SETTING } from "./module/config/money.mjs";

Hooks.once("init", () => {
  console.log(`${SYSTEM_ID} | Инициализация системы «Ведьмак: НРИ»`);

  CONFIG.VEDMAK = {
    ...STATS_CFG,
    ...SKILLS_CFG,
    ...ITEMS_CFG,
    ...COMBAT_CFG,
    ...MAGIC_CFG,
    ...CHARACTER_CFG,
    ...CRAFTING_CFG,
    MONSTER_CLASSES, THREAT_COMPLEXITY, THREAT_DIFFICULTY
  };

  // Документы и модели данных
  CONFIG.Actor.documentClass = VedmakActor;
  CONFIG.Item.documentClass = VedmakItem;
  Object.assign(CONFIG.Actor.dataModels, ACTOR_MODELS);
  Object.assign(CONFIG.Item.dataModels, ITEM_MODELS);

  CONFIG.Actor.trackableAttributes = {
    character: { bar: ["hp", "sta"], value: ["luck.value", "toxicity.value", "adrenaline.value"] },
    monster: { bar: ["hp", "sta"], value: ["armor"] }
  };

  // Бой: инициатива Реакция + d10 (стр. 151), статусы, начало хода
  CONFIG.Combat.initiative = { formula: "1d10 + @stats.ref.effective", decimals: 2 };
  CONFIG.Combat.documentClass = VedmakCombat;
  // Корник: «раунд длится 3 секунды». По этому числу Foundry двигает время мира в бою и переводит раунды во время
  CONFIG.time.roundTime = 3;
  registerStatusEffects();

  game.settings.register(SYSTEM_ID, "booksMonsters", {
    name: "Чудовища из книг",
    hint: "Серебро действует только на проклятых, духов стихий, трупоедов, реликтов, духов и вампиров; метеоритная сталь — на зверей, гибридов, драконидов, инсектоидов и огров (стр. 175).",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => game.actors.forEach(a => a.prepareData())
  });
  game.settings.register(SYSTEM_ID, "region", {
    name: "Текущая территория",
    hint: "Где сейчас находятся персонажи — от этого зависит социальный статус рас, ведьмаков и магов (стр. 21). У персонажа можно указать свою территорию.",
    scope: "world", config: true, type: String, default: "north",
    choices: Object.fromEntries(Object.entries(CHARACTER_CFG.REGIONS).map(([k, v]) => [k, v.label])),
    onChange: () => game.actors.forEach(a => { a.prepareData(); a.sheet?.rendered && a.sheet.render(); })
  });
  game.settings.register(SYSTEM_ID, "combatHud", {
    name: "Боевой худ",
    hint: "Полоса внизу экрана, пока идёт бой: показатели, атаки, защиты, знаки и алхимия того, кем вы играете.",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => CombatHud.refresh()
  });
  game.settings.register(SYSTEM_ID, "combatHudCollapsed", {
    scope: "client", config: false, type: Boolean, default: false
  });
  // Фактуры с наложением на цвет — самое дорогое в отрисовке окон (styles/vedmak.css, «Облегчённая графика»)
  game.settings.register(SYSTEM_ID, "liteGraphics", {
    name: "Облегчённая графика",
    hint: "Листы, окна бросков, чат и худ — без фактур кожи, железа и пергамента. Цвета и раскладка те же, а рисуется быстрее: включите, если окна подтормаживают.",
    scope: "client", config: true, type: Boolean, default: false,
    onChange: value => document.body.classList.toggle("vedmak-lite", !!value)
  });
  document.body.classList.toggle("vedmak-lite", !!game.settings.get(SYSTEM_ID, "liteGraphics"));
  // Курсор-клинок (assets/cursors): в окнах — правилами styles/vedmak.css, на сцене — стилями указателя холста
  game.settings.register(SYSTEM_ID, "themedCursor", {
    name: "Курсор системы",
    hint: "Указатель — клинок вороненой стали, над тем, что можно нажать, — раскалённый золотом. Выключите, чтобы вернуть обычный курсор.",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: value => applyCursor(!!value)
  });
  applyCursor(!!game.settings.get(SYSTEM_ID, "themedCursor"));
  // Какие компендиумы уже разложены по папкам: новые паки системы раскладываются при следующем запуске
  game.settings.register(SYSTEM_ID, "packFoldersDone", {
    scope: "world", config: false, type: String, default: ""
  });
  game.settings.register(SYSTEM_ID, "adrenaline", {
    name: "Адреналин",
    hint: "Каждый нанесённый крит даёт кость d6 (не больше Тел). Кость: +1d6 урона, −10 Вын. Сгорает в конце боя (стр. 175).",
    scope: "world", config: true, type: Boolean, default: false
  });
  // Автоматизация боя (module/combat/auto.mjs): по умолчанию выключена — всё по кнопкам, включается по шагу
  game.settings.register(SYSTEM_ID, "autoDefense", {
    name: "Бой: защита НИП сама",
    hint: "Цели без игрока-владельца защищаются сразу лучшим способом: уклонение, блок, парирование или Сопротивление магии — что выше. Игроки выбирают защиту сами.",
    scope: "world", config: true, type: Boolean, default: false
  });
  game.settings.register(SYSTEM_ID, "autoDamage", {
    name: "Бой: урон сразу после попадания",
    hint: "Урон бросается без окна: часть тела — из прицеливания или d10, первый тип урона оружия. Укрытие, адреналин и правка урона — если выключить и бросать кнопкой «Урон».",
    scope: "world", config: true, type: Boolean, default: false
  });
  game.settings.register(SYSTEM_ID, "autoApply", {
    name: "Бой: применять урон и эффекты сразу",
    hint: "Ведущий применяет урон, эффекты заклинаний и статусы приёмов без кнопки «Применить». Нужен ведущий в игре.",
    scope: "world", config: true, type: Boolean, default: false
  });
  // Деньги (module/config/money.mjs): курсы и вес монет правит ведущий в меню «Валюты и обмен»
  const refreshActors = () => game.actors.forEach(a => { a.prepareData(); if (a.sheet?.rendered) a.sheet.render(); });
  game.settings.register(SYSTEM_ID, "currencies", {
    scope: "world", config: false, type: Object, default: DEFAULT_MONEY_SETTING, onChange: refreshActors
  });
  // Свои ведьмачьи школы (module/apps/school-config.mjs): школы корника встроены, здесь — из дополнений и домашние
  game.settings.register(SYSTEM_ID, "witcherSchools", {
    scope: "world", config: false, type: Object, default: { list: [] }, onChange: refreshActors
  });
  game.settings.registerMenu(SYSTEM_ID, "witcherSchoolsMenu", {
    name: "Ведьмачьи школы",
    label: "Свои школы",
    hint: "Школы из дополнений (например, «Книги Весемира») или домашние: описание, Энергия, скованность движений, виды атаки без штрафа, поправки к параметрам и навыкам.",
    icon: "fa-solid fa-shield-cat",
    type: SchoolConfig,
    restricted: true
  });
  game.settings.registerMenu(SYSTEM_ID, "currencyMenu", {
    name: "Валюты и обмен",
    label: "Курсы и вес монет",
    hint: "Названия валют, курс к кроне, вес монеты и комиссия менялы. Цены в книгах — в кронах.",
    icon: "fa-solid fa-coins",
    type: CurrencyConfig,
    restricted: true
  });
  game.settings.register(SYSTEM_ID, "coinWeight", {
    name: "Вес монет",
    hint: "Монеты в кошельке входят в нагрузку: вес одной монеты задаётся в «Валюты и обмен» (по умолчанию 5 г — 200 монет весят килограмм). Домашнее правило: в корнике монеты ничего не весят.",
    scope: "world", config: true, type: Boolean, default: true, onChange: refreshActors
  });
  game.settings.register(SYSTEM_ID, "ammo", {
    name: "Бой: расход боеприпасов",
    hint: "Выстрел из лука или арбалета тратит один боеприпас из снаряжения персонажа: надетый, иначе стандартный, иначе любой. Без боеприпасов выстрелить нельзя. У чудовищ не считается.",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(SYSTEM_ID, "zones", {
    name: "Зоны заклинаний и бомб на сцене",
    hint: "Конусы и круги ставятся мышью (колесо — поворот, правый клик — отмена), цели — все, кто в зоне. Мгновенная зона исчезает к следующему ходу заклинателя, на N раундов — через N раундов, активная — с концом поддержания.",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(SYSTEM_ID, "verbalDuel", {
    name: "Словесная дуэль",
    hint: "Подвкладка «Социальный бой» у персонажей и чудовищ: Решительность и действия словесной дуэли (стр. 176–177). Выключено — во вкладке «Бой» только обычный бой.",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => game.actors.forEach(a => a.sheet?.rendered && a.sheet.render())
  });

  // Листы
  const DSC = foundry.applications.apps.DocumentSheetConfig;
  DSC.registerSheet(Actor, SYSTEM_ID, CharacterSheet, {
    types: ["character"], makeDefault: true, label: "VEDMAK.SheetCharacter"
  });
  DSC.registerSheet(Actor, SYSTEM_ID, MonsterSheet, {
    types: ["monster"], makeDefault: true, label: "VEDMAK.SheetMonster"
  });
  DSC.registerSheet(Item, SYSTEM_ID, VedmakItemSheet, {
    makeDefault: true, label: "VEDMAK.SheetItem"
  });
  DSC.registerSheet(ActiveEffect, SYSTEM_ID, VedmakEffectConfig, {
    makeDefault: true, label: "VEDMAK.SheetEffect"
  });

  registerHelpers();
  preloadTemplates();
  registerChatListeners();
  registerCombatAutomation();
  registerZoneHooks();
  registerAlchemyHooks();
  registerBuffHooks();
  registerRaceHooks();
  CombatHud.registerHooks();

  // API для макросов
  game.vedmak = {
    performCheck, rollD10, attack, computeDamage, applyDamageToActor, rollStunSave, rollDeathSave,
    manualDamage, restTurn, restDays, controlCheck, castSpell,
    advancement, crafting, alchemy, enhancements,
    openWizard: actor => new CharacterWizard({ actor }).render(true),
    profileSheet,
    hud: CombatHud,
    config: CONFIG.VEDMAK
  };
});

Hooks.once("ready", () => {
  initSocket();
  sortCompendiaIntoFolders();
});

/* ------------------------------- Курсор ------------------------------- */

const CURSOR = {
  default: 'url("systems/vedmak/assets/cursors/arrow.svg") 2 2, default',
  pointer: 'url("systems/vedmak/assets/cursors/pointer.svg") 2 2, pointer'
};

/** Курсор-клинок: окна берут его из CSS по классу на body, холст сцены — из своих стилей указателя (PIXI). */
function applyCursor(on) {
  document.body.classList.toggle("vedmak-cursor", on);
  const styles = canvas?.app?.renderer?.events?.cursorStyles;
  if (!styles) return;
  styles.default = on ? CURSOR.default : "inherit";
  styles.pointer = on ? CURSOR.pointer : "pointer";
}

Hooks.on("canvasReady", () => applyCursor(!!game.settings.get(SYSTEM_ID, "themedCursor")));

/**
 * Разложить компендиумы по папкам из манифеста.
 * Foundry делает это только при первом запуске мира, поэтому в уже созданных мирах
 * группы не появлялись бы вовсе.
 */
async function sortCompendiaIntoFolders() {
  if (!game.user.isActiveGM) return;
  const packs = [...game.system.packs].map(p => p.name).sort().join(",");
  if (game.settings.get(SYSTEM_ID, "packFoldersDone") === packs) return;
  const existing = new Set(game.folders.filter(f => f.type === "Compendium").map(f => f.name));

  const build = async (def, parent) => {
    let folder = game.folders.find(f => f.type === "Compendium" && f.name === def.name
      && (f.folder?.id ?? null) === (parent?.id ?? null));
    if (!folder) {
      folder = await Folder.create({
        name: def.name, type: "Compendium", color: def.color?.css ?? def.color,
        sorting: def.sorting ?? "m", folder: parent?.id ?? null
      });
    }
    for (const name of def.packs ?? []) {
      const pack = game.packs.get(`${SYSTEM_ID}.${name}`);
      if (pack && !pack.folder) await pack.configure({ folder: folder.id });
    }
    for (const sub of def.folders ?? []) await build(sub, folder);
  };

  for (const def of game.system.packFolders) await build(def);
  await game.settings.set(SYSTEM_ID, "packFoldersDone", packs);
  if (!existing.size) ui.notifications.info("Компендиумы «Ведьмака» разложены по папкам.");
}

// Адреналин сгорает в конце боя
Hooks.on("deleteCombat", async combat => {
  if (!game.users.activeGM?.isSelf) return;
  for (const c of combat.combatants) {
    if (c.actor?.system.adrenaline?.value) await c.actor.update({ "system.adrenaline.value": 0 });
  }
});

/** Иконки по умолчанию для новых предметов. */
const DEFAULT_ICONS = {
  weapon: "icons/weapons/swords/sword-guard-worn-purple.webp",
  armor: "icons/equipment/chest/breastplate-banded-steel.webp",
  gear: "icons/containers/bags/pack-leather-brown.webp",
  spell: "icons/magic/symbols/runes-star-pentagon-orange.webp",
  profession: "icons/skills/trades/academics-study-reading-book.webp",
  race: "icons/environment/people/group.webp",
  critWound: "icons/skills/wounds/injury-body-pain-gray.webp",
  component: "icons/commodities/materials/bowl-powder-teal.webp",
  recipe: "icons/sundries/documents/document-sealed-brown-red.webp",
  alchemical: "icons/consumables/potions/bottle-round-corked-green.webp",
  enhancement: "icons/commodities/gems/gem-rough-cushion-violet.webp"
};

Hooks.on("preCreateItem", (item, data) => {
  if (!data.img || data.img === Item.DEFAULT_ICON) {
    const img = DEFAULT_ICONS[item.type];
    if (img) item.updateSource({ img });
  }
});

Hooks.on("preCreateActor", (actor, data) => {
  // Новое чудовище получает трофейный значок вместо человечка Foundry
  if (actor.type === "monster" && (!data.img || data.img === Actor.DEFAULT_ICON)) {
    actor.updateSource({ img: "systems/vedmak/assets/fan/monsters/mons-wraith.webp" });
  }
  // Токен персонажа привязан к актору, дружелюбен и видит — если создатель не задал этого сам:
  // копия, импорт или враждебный НИП-персонаж сохраняют свои настройки токена
  if (actor.type === "character") {
    const has = key => foundry.utils.hasProperty(data, `prototypeToken.${key}`);
    const token = {};
    if (!has("actorLink")) token.actorLink = true;
    if (!has("disposition")) token.disposition = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
    if (!has("sight.enabled")) token.sight = { enabled: true };
    if (Object.keys(token).length) actor.updateSource({ prototypeToken: token });
  }
});
