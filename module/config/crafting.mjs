// Ремесло и алхимия (корник стр. 125–147, 246–256).

/** Девять алхимических субстанций (стр. 142). `symbol` — значок как на страницах формул. */
export const SUBSTANCES = {
  vitriol:    { label: "Купорос",  color: "#8e5aa0", symbol: "‹" },
  rebis:      { label: "Ребис",    color: "#e1603a", symbol: "/" },
  aether:     { label: "Эфир",     color: "#8fbcbb", symbol: "∨" },
  quebrith:   { label: "Квебрит",  color: "#d4c22c", symbol: "−" },
  hydragenum: { label: "Гидраген", color: "#6a73b8", symbol: "×" },
  vermilion:  { label: "Киноварь", color: "#5f9e4f", symbol: "›" },
  sol:        { label: "Солнце",   color: "#e3a43a", symbol: "|" },
  caelum:     { label: "Аер",      color: "#b9cc44", symbol: "\\" },
  fulgur:     { label: "Фульгор",  color: "#b53b3b", symbol: "∧" }
};

/** Группы компонентов (стр. 128–129, 143–145). */
export const COMPONENT_GROUPS = {
  materials:  "Ремесленные материалы",
  hides:      "Шкуры и части животных",
  treatments: "Алхимические пропитки и составы",
  ingots:     "Слитки и минералы",
  alchemy:    "Алхимические ингредиенты",
  other:      "Прочее"
};

export const RECIPE_KINDS = { blueprint: "Чертёж", formula: "Формула" };

export const RECIPE_CATEGORIES = {
  components: "Компоненты", weapons: "Оружие", armor: "Броня", elderWeapons: "Оружие Старшего Народа",
  elderArmor: "Броня Старшего Народа", ammo: "Боеприпасы", enhancements: "Усиления брони", witcher: "Ведьмачье снаряжение",
  traps: "Ловушки", expAmmo: "Экспериментальные боеприпасы", alchemy: "Алхимические составы", elixirs: "Ведьмачьи эликсиры",
  oils: "Масла для мечей", decoctions: "Ведьмачьи отвары", bombs: "Бомбы", other: "Прочее"
};

export const RECIPE_LEVELS = { novice: "Новичок", journeyman: "Подмастерье", master: "Мастер", grandmaster: "Великий мастер" };

/** Виды алхимических предметов. */
export const ALCHEMY_KINDS = {
  preparation: "Алхимический состав",
  elixir:      "Ведьмачий эликсир",
  oil:         "Масло для меча",
  decoction:   "Ведьмачий отвар",
  mutagen:     "Мутаген",
  bomb:        "Бомба",
  trap:        "Ловушка"
};

/** Как используется алхимический предмет. */
export const ALCHEMY_ACTIONS = {
  "":      "—",
  drink:   "Выпить",
  apply:   "Применить",
  throw:   "Бросить",
  oil:     "Нанести на оружие",
  mutagen: "Принять мутаген",
  trap:    "Установить ловушку"
};

export const MUTAGEN_COLORS = { "": "—", red: "Красный", green: "Зелёный", blue: "Синий" };

/** Инструменты (стр. 92): без них ремесло и алхимия невозможны. */
export const TOOL_KINDS = {
  "":        "—",
  alchemist: "Инструменты алхимика",
  craftsman: "Инструменты ремесленника",
  forge:     "Кузница (походная)",
  surgeon:   "Хирургические инструменты",
  thief:     "Воровские инструменты",
  forgery:   "Инструменты для подделки",
  artisan:   "Инструменты для творчества",
  cooking:   "Принадлежности для готовки",
  disguise:  "Набор для маскировки",
  writing:   "Письменные принадлежности"
};

export const ENHANCEMENT_KINDS = { armor: "Усиление брони", weapon: "Усиление оружия", rune: "Руна (оружие)", glyph: "Глиф (броня)", crossbow: "Модификация арбалета",
  runeword: "Рунное слово (оружие)", glyphword: "Глифово слово (броня)" };

/** Зачарование словом занимает две ячейки (малое) или три (большое) и не уживается с другими рунами и глифами. */
export const ENCHANT_SLOTS = { small: 2, large: 3 };

/** Модификации арбалета («Фургончик Родольфа»). Ручной арбалет несёт одну, прочие — две. */
export const CROSSBOW_MODS = {
  sight:    { label: "Прицел", accuracy: 1 },
  windlass: { label: "Ворот" },
  stirrup:  { label: "Стремя для удара", reliability: 5 },
  string:   { label: "Усиленная тетива", damageDice: 1 },
  balance:  { label: "Балансировочное стремя", effect: "balanced" }
};

/** Сколько модификаций влезает на арбалет: ручной — одна, остальные — две. */
export function crossbowModLimit(weapon) {
  return /ручн/i.test(weapon.name) ? 1 : 2;
}

/** Ремесло (стр. 127, 90, 140). */
export const CRAFTING = {
  blueprintBonus: 2,       // чертёж или формула перед глазами
  repairDcMinus: 5,        // починка: СЛ изготовления − 5
  repairPerEnhancement: 2, // +2 за каждую руну, глиф или усиление
  attachDc: 14,            // прикрепить усиление брони
  detachDc: 15,            // снять усиление брони
  oilBonus: 5,             // масло: +5 урона по классу
  oilMinutes: 30,
  mutagenLimit: 2,
  toxicitySaveDc: 18,      // отравление токсичностью и эликсир у не-мутанта
  mutagenSaveDc: 18
};

/**
 * Вживление рун и глифов в тело («Офир и Зеррикания», стр. 84–86). Камень бывает малым, обычным и большим:
 * чем крупнее, тем сильнее эффект и выше СЛ (+1 обычный, +2 большой). `mods` — поправки по размеру камня
 * (как у мутагенов), `text` — эффект, который система не считает сама (шансы состояний), `minor` — малая мутация.
 */
export const IMPLANT_TIERS = { small: { label: "Малый", dc: 0 }, normal: { label: "Обычный", dc: 1 }, large: { label: "Большой", dc: 2 } };
const RUNE_IMG = n => `systems/vedmak/assets/fan/enhancements/rune-${n}.webp`;
const tiers = (target, a, b, c) => ({ small: [{ target, value: a }], normal: [{ target, value: b }], large: [{ target, value: c }] });
const chance = label => ({ small: `${label} +5 %`, normal: `${label} +10 %`, large: `${label} +15 %` });
export const IMPLANT_RUNES = {
  chernobog: { label: "Чернобог", img: RUNE_IMG("chernobog"), mods: tiers("bonus.meleeDamage", 1, 2, 3), bonus: "к урону в ближнем бою",
    minor: "Мышцы деформированы, вены светятся ярко-красным" },
  perun: { label: "Перун", img: RUNE_IMG("perun"), mods: tiers("stats.spd", 1, 2, 3), bonus: "к Скор", minor: "Постоянная трупная худоба" },
  veles: { label: "Велес", img: RUNE_IMG("veles"), mods: tiers("bonus.vigor", 1, 2, 3), bonus: "к Энергии",
    minor: "Хаос оставил чёрную дорожку по венам" },
  dazhbog: { label: "Даждьбог", img: RUNE_IMG("dazhbog"), text: chance("Горение"), minor: "Тело не остывает ниже 45 °C" },
  stribog: { label: "Стрибог", img: RUNE_IMG("stribog"), text: chance("Ошеломление"),
    minor: "Тело обрастает густыми волосами, кожа на руках и ногах толстеет, как у слона" },
  zorya: { label: "Зоря", img: RUNE_IMG("zoria"), text: chance("Замораживание"), minor: "Тело не согревается выше 18 °C" },
  devana: { label: "Девана", img: RUNE_IMG("devana"), text: chance("Кровотечение"),
    minor: "Руки твёрдые, как камень; сильная тяга к сырому мясу" },
  marena: { label: "Марена", img: RUNE_IMG("morana"), text: chance("Отравление"), minor: "Вены и кровь зеленеют" },
  svarog: { label: "Сварог", img: RUNE_IMG("svarog"), accuracy: { small: 1, normal: 2, large: 3 }, bonus: "к Точности (броски атаки)",
    minor: "Орлиные глаза с белым третьим веком" },
  triglav: { label: "Триглав", img: RUNE_IMG("triglav"), text: chance("Дезориентирующее"), minor: "Череп странно деформирован" },
  pirog: { label: "Пирог", img: "icons/magic/symbols/runes-carved-stone-yellow.webp", mods: tiers("bonus.enc", 5, 10, 15), bonus: "к переносимому весу",
    minor: "Огромные плечи выгибают спину, как у огра" },
  tvorog: { label: "Творог", img: "icons/magic/symbols/runes-carved-stone-green.webp", mods: tiers("armor", 1, 2, 3), bonus: "ПБ крепости тела (естественная броня)",
    minor: "Кожа сверкает, как бриллианты, при дневном свете" }
};
/** Глифы знаков: носитель получает заклинание «Вживлённый глиф: …» из компендиума магии. */
export const IMPLANT_GLYPHS = {
  aard: { label: "Аард", spell: "Вживлённый глиф: Аард", img: "icons/magic/air/wind-vortex-swirl-blue.webp",
    minor: "Очень громкое чихание со странным эхом, которое трудно скрыть" },
  quen: { label: "Квен", spell: "Вживлённый глиф: Квен", img: "icons/magic/defensive/shield-barrier-glowing-triangle-orange.webp",
    minor: "Слабое свечение в темноте выдаёт колдовство" },
  igni: { label: "Игни", spell: "Вживлённый глиф: Игни", img: "icons/magic/fire/flame-burning-hand-white.webp",
    minor: "Легко воспламеняется: шанс поджечь носителя на +10 %" },
  yrden: { label: "Ирден", spell: "Вживлённый глиф: Ирден", img: "icons/magic/symbols/runes-star-pentagon-orange.webp",
    minor: "Кожа покрывается пурпурными родимыми пятнами" },
  axii: { label: "Аксий", spell: "Вживлённый глиф: Аксий", img: "icons/magic/perception/eye-tendrils-web-purple.webp",
    minor: "Постоянная обильная испарина: −2 к Эмп", mods: [{ target: "stats.emp", value: -2 }] }
};
export const IMPLANT_LIMIT = 2;

/** Металлические компоненты — для них нужна кузница (стр. 127). */
export const METAL_COMPONENTS = ["Сталь", "Железо", "Тёмная сталь", "Тёмное железо", "Махакамская сталь", "Двимерит",
  "Махакамский двимерит", "Метеорит", "Серебро", "Третогорская сталь", "Золото"];
