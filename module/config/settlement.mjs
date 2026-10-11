// Поселение по мотивам Manor Lords (PLAN 4.183), упрощённо: шесть ресурсов, семьи-работники, одобрение, казна,
// постройки с тремя уровнями. Шаг — неделя; год — 52 недели, сезон — 13. Числа — недельные, на одного работника.
// Справочник данных: правила хода — module/settlement/settlement.mjs, модель — data/actor/settlement.mjs.

/** Ресурсы склада: подпись, значок, цена продажи в кронах за единицу (покупка — ×1,5). */
export const RESOURCES = {
  food:  { label: "Еда",    img: "icons/consumables/grains/bread-loaf-boule-rustic-brown.webp", price: 1 },
  fuel:  { label: "Дрова",  img: "icons/commodities/wood/kindling-sticks-brown.webp", price: 1 },
  wood:  { label: "Дерево", img: "icons/commodities/wood/log-cut-ash-brown.webp", price: 2 },
  stone: { label: "Камень", img: "icons/commodities/stone/masonry-block-cube-grey.webp", price: 3 },
  iron:  { label: "Железо", img: "icons/commodities/metal/ingot-engraved-silver.webp", price: 6 },
  goods: { label: "Товары", img: "icons/commodities/cloth/cloth-bolt-gold-orange.webp", price: 5 }
};
export const RESOURCE_KEYS = Object.keys(RESOURCES);
export const BUY_MARKUP = 1.5;

/** Склад без амбара и склада: по стольку единиц каждого ресурса. */
export const BASE_STORAGE = 20;

/** Сезоны: с какой недели года начинаются и множители. */
export const SEASONS = [
  { key: "spring", label: "Весна" },
  { key: "summer", label: "Лето" },
  { key: "autumn", label: "Осень" },
  { key: "winter", label: "Зима" }
];
export const WEEKS_PER_SEASON = 13;
export const WEEKS_PER_YEAR = 52;

/** Сезон и год по номеру недели (с первой). */
export function calendar(week) {
  const w = Math.max(1, Math.floor(week) || 1);
  const inYear = (w - 1) % WEEKS_PER_YEAR;
  const season = SEASONS[Math.floor(inYear / WEEKS_PER_SEASON)];
  return { week: w, year: Math.floor((w - 1) / WEEKS_PER_YEAR) + 1, weekOfSeason: (inYear % WEEKS_PER_SEASON) + 1, season };
}

/** Потребность одной семьи в неделю; дрова зимой — вдвое. */
export const NEEDS = { food: 1, fuel: 1, goods: 0.5 };
export const WINTER_FUEL = 2;

/** Налог с семьи в неделю (кроны) и его цена в одобрении. Без усадьбы налогов нет. */
export const TAXES = {
  none:   { label: "Без налога", perFamily: 0, approval: 10 },
  low:    { label: "Низкий",     perFamily: 1, approval: 0 },
  normal: { label: "Обычный",    perFamily: 2, approval: -10 },
  high:   { label: "Высокий",    perFamily: 3, approval: -25 }
};

/** Одобрение: основа и вклад потребностей. */
export const APPROVAL = {
  base: 50,
  food:  { met: 10, short: -25 },
  fuel:  { met: 5, short: -10, winterShort: -25 },
  goods: { met: 10, short: -5 },
  // Приток и отток семей
  arrive: 50, arriveTwo: 75, leave: 25
};

/** Категории построек — порядок на листе. */
export const BUILDING_GROUPS = {
  living:  "Жильё и власть",
  service: "Нужды жителей",
  food:    "Еда",
  raw:     "Добыча",
  craft:   "Ремесло",
  storage: "Хранение и торговля"
};

/**
 * Постройки. У каждого уровня: cost — цена (ресурсы и кроны), weeks — недели стройки, workers — сколько можно
 * поставить, produce / consume — на работника в неделю, housing — семей, storage — прибавка склада,
 * approval — одобрение (у служб — только если есть работник, когда workers > 0), income — кроны на работника.
 * season — множитель выработки по сезонам [весна, лето, осень, зима]; boost — прибавка к выработке других построек.
 */
export const BUILDINGS = {
  burgage: {
    label: "Жилой двор", group: "living", img: "icons/environment/settlement/house-farmland-small.webp",
    hint: "Дом с огородом: здесь живут семьи. Чем выше уровень, тем больше семей.",
    levels: [
      { cost: { wood: 4 }, weeks: 1, housing: 2 },
      { cost: { wood: 6, stone: 2, money: 30 }, weeks: 2, housing: 4 },
      { cost: { wood: 6, stone: 6, iron: 1, money: 80 }, weeks: 3, housing: 6 }
    ]
  },
  manor: {
    label: "Усадьба", group: "living", img: "icons/environment/settlement/house-manor.webp", unique: true,
    hint: "Дом лорда. Без усадьбы налоги не собрать; второй уровень — налог в полтора раза больше.",
    levels: [
      { cost: { wood: 10, stone: 10, money: 100 }, weeks: 4, approval: 5, taxes: 1 },
      { cost: { stone: 20, iron: 2, money: 200 }, weeks: 4, approval: 5, taxes: 1.5, storage: { goods: 20 } }
    ]
  },
  well: {
    label: "Колодец", group: "service", img: "icons/environment/settlement/well.webp", unique: true,
    hint: "Чистая вода: +5 к одобрению.",
    levels: [{ cost: { wood: 2, stone: 4 }, weeks: 1, approval: 5 }]
  },
  church: {
    label: "Храм", group: "service", img: "icons/environment/settlement/church.webp", unique: true,
    hint: "Храм Мелитэле или Вечного Огня: +10 к одобрению, каменный — +15.",
    levels: [
      { cost: { wood: 8, stone: 6, money: 40 }, weeks: 3, approval: 10 },
      { cost: { stone: 15, money: 120 }, weeks: 4, approval: 15 }
    ]
  },
  tavern: {
    label: "Таверна", group: "service", img: "icons/environment/settlement/tavern.webp", unique: true,
    hint: "Пиво и сплетни: +5 к одобрению, пока работает. Тратит еду, приносит кроны.",
    levels: [
      { cost: { wood: 8, money: 30 }, weeks: 2, workers: 1, consume: { food: 1 }, income: 4, approval: 5 },
      { cost: { wood: 6, stone: 4, money: 60 }, weeks: 2, workers: 2, consume: { food: 1 }, income: 5, approval: 8 }
    ]
  },
  market: {
    label: "Рынок", group: "service", img: "icons/environment/settlement/market-stall.webp", unique: true,
    hint: "Лавки торгуют товарами: +5 к одобрению, пока работает; товары превращаются в кроны.",
    levels: [
      { cost: { wood: 6, money: 20 }, weeks: 1, workers: 1, consume: { goods: 1 }, income: 6, approval: 5 },
      { cost: { wood: 6, stone: 4, money: 50 }, weeks: 2, workers: 3, consume: { goods: 1 }, income: 6, approval: 8 }
    ]
  },
  watchtower: {
    label: "Сторожевая вышка", group: "service", img: "icons/environment/settlement/watchtower-wood.webp",
    hint: "Дозорные на вышке — жителям спокойнее: +3 к одобрению.",
    levels: [{ cost: { wood: 6, stone: 2 }, weeks: 1, approval: 3 }]
  },
  farm: {
    label: "Ферма", group: "food", img: "icons/environment/settlement/house-farmland.webp",
    hint: "Поля дают еду: весной мало, летом много, осенью — урожай, зимой ничего.",
    season: [0.3, 1, 2, 0],
    levels: [
      { cost: { wood: 6, money: 20 }, weeks: 2, workers: 3, produce: { food: 4 } },
      { cost: { wood: 6, stone: 2, money: 40 }, weeks: 2, workers: 4, produce: { food: 4 } },
      { cost: { wood: 6, stone: 6, money: 80 }, weeks: 3, workers: 5, produce: { food: 5 } }
    ]
  },
  windmill: {
    label: "Мельница", group: "food", img: "icons/environment/settlement/farm-silo-windmill.webp", unique: true,
    hint: "Мелет зерно: фермы дают на треть больше еды (второй уровень — наполовину).",
    levels: [
      { cost: { wood: 10, stone: 4, money: 40 }, weeks: 3, boost: { farm: 0.3 } },
      { cost: { wood: 6, stone: 8, iron: 1, money: 80 }, weeks: 3, boost: { farm: 0.5 } }
    ]
  },
  forager: {
    label: "Собиратели", group: "food", img: "icons/environment/settlement/hut.webp",
    hint: "Ягоды и грибы из леса: летом больше, зимой — ничего.",
    season: [1, 1.5, 1, 0],
    levels: [
      { cost: { wood: 3 }, weeks: 1, workers: 2, produce: { food: 2 } },
      { cost: { wood: 4, money: 15 }, weeks: 1, workers: 3, produce: { food: 2 } }
    ]
  },
  hunter: {
    label: "Охотничий домик", group: "food", img: "icons/environment/settlement/house-woods.webp",
    hint: "Дичь в любое время года; шкуры идут на товары.",
    levels: [
      { cost: { wood: 4 }, weeks: 1, workers: 2, produce: { food: 2, goods: 0.5 } },
      { cost: { wood: 4, money: 20 }, weeks: 1, workers: 3, produce: { food: 2, goods: 0.5 } }
    ]
  },
  fishery: {
    label: "Рыбацкая хижина", group: "food", img: "icons/environment/settlement/abandoned-pier.webp",
    hint: "Рыба из реки; зимой — подлёдный лов, вполовину.",
    season: [1, 1, 1, 0.5],
    levels: [
      { cost: { wood: 4 }, weeks: 1, workers: 2, produce: { food: 3 } },
      { cost: { wood: 4, money: 20 }, weeks: 1, workers: 3, produce: { food: 3 } }
    ]
  },
  logging: {
    label: "Лесорубы", group: "raw", img: "icons/environment/settlement/lumbermill.webp",
    hint: "Валят лес: брёвна на стройку и в ремесло.",
    levels: [
      { cost: { wood: 3, money: 10 }, weeks: 1, workers: 2, produce: { wood: 3 } },
      { cost: { wood: 4, money: 20 }, weeks: 1, workers: 3, produce: { wood: 3 } },
      { cost: { wood: 4, stone: 2, iron: 1, money: 40 }, weeks: 2, workers: 4, produce: { wood: 4 } }
    ]
  },
  woodcutter: {
    label: "Дровосек", group: "raw", img: "icons/environment/settlement/sawmill-shed-red.webp",
    hint: "Колет брёвна на дрова: без дров зимой жители мёрзнут.",
    levels: [
      { cost: { wood: 4 }, weeks: 1, workers: 2, consume: { wood: 1 }, produce: { fuel: 4 } },
      { cost: { wood: 4, money: 15 }, weeks: 1, workers: 3, consume: { wood: 1 }, produce: { fuel: 4 } }
    ]
  },
  quarry: {
    label: "Каменоломня", group: "raw", img: "icons/environment/settlement/quarry.webp",
    hint: "Камень для домов, храма и усадьбы.",
    levels: [
      { cost: { wood: 6, money: 20 }, weeks: 2, workers: 2, produce: { stone: 2 } },
      { cost: { wood: 6, money: 40 }, weeks: 2, workers: 3, produce: { stone: 2 } },
      { cost: { wood: 6, iron: 2, money: 60 }, weeks: 2, workers: 4, produce: { stone: 3 } }
    ]
  },
  mine: {
    label: "Рудник", group: "raw", img: "icons/environment/settlement/mine-cart-rocks-red.webp",
    hint: "Железная руда, сразу переплавленная в крицы.",
    levels: [
      { cost: { wood: 8, stone: 4, money: 40 }, weeks: 3, workers: 2, produce: { iron: 1 } },
      { cost: { wood: 8, stone: 6, money: 80 }, weeks: 3, workers: 3, produce: { iron: 1 } }
    ]
  },
  smithy: {
    label: "Кузница", group: "craft", img: "icons/environment/settlement/blacksmith.webp",
    hint: "Железо — в инструменты и утварь.",
    levels: [
      { cost: { wood: 6, stone: 4, money: 30 }, weeks: 2, workers: 1, consume: { iron: 1 }, produce: { goods: 3 } },
      { cost: { wood: 4, stone: 6, money: 60 }, weeks: 2, workers: 2, consume: { iron: 1 }, produce: { goods: 3 } },
      { cost: { stone: 8, iron: 2, money: 100 }, weeks: 3, workers: 3, consume: { iron: 1 }, produce: { goods: 4 } }
    ]
  },
  workshop: {
    label: "Мастерские", group: "craft", img: "icons/environment/settlement/pottery-shop-shed-red.webp",
    hint: "Ткачи, сапожники и гончары: из дерева — товары.",
    levels: [
      { cost: { wood: 6, money: 20 }, weeks: 1, workers: 2, consume: { wood: 1 }, produce: { goods: 2 } },
      { cost: { wood: 6, stone: 2, money: 40 }, weeks: 2, workers: 3, consume: { wood: 1 }, produce: { goods: 2 } }
    ]
  },
  granary: {
    label: "Амбар", group: "storage", img: "icons/environment/settlement/warehouse-barn-crates.webp",
    hint: "Склад еды: +30 к запасу еды за уровень.",
    levels: [
      { cost: { wood: 6 }, weeks: 2, storage: { food: 30 } },
      { cost: { wood: 6, stone: 4 }, weeks: 2, storage: { food: 60 } }
    ]
  },
  storehouse: {
    label: "Склад", group: "storage", img: "icons/environment/settlement/warehouse-crates.webp",
    hint: "Склад дров, дерева, камня, железа и товаров: +30 к каждому за уровень.",
    levels: [
      { cost: { wood: 6 }, weeks: 2, storage: { fuel: 30, wood: 30, stone: 30, iron: 30, goods: 30 } },
      { cost: { wood: 6, stone: 4 }, weeks: 2, storage: { fuel: 60, wood: 60, stone: 60, iron: 60, goods: 60 } }
    ]
  },
  tradepost: {
    label: "Торговый пост", group: "storage", img: "icons/environment/settlement/wagon.webp", unique: true,
    hint: "Купцы заезжают каждую неделю: без поста ничего не купить и не продать.",
    levels: [{ cost: { wood: 8, money: 40 }, weeks: 2 }]
  }
};
