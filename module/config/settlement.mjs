// Поселение по правилам автора (журнал мира manorlords: «Постройки» и «Ресурсы»; PLAN 4.185) с уровнями построек,
// налогами, вместимостью склада и торговым постом. Шаг — неделя; месяц — четыре недели, год — двенадцать месяцев;
// зима — декабрь, январь, февраль. Ресурсы — свободный список: постройка называет ресурс, и он появляется на складе.
// Еда и топливо — нужды семей. Выработка — броски кубиков. Казна — Богатство (1 = 500 монет валюты мира).
// Правила хода — module/settlement/rules.mjs, модели — data/actor/settlement.mjs и data/item/building.mjs.

import { buildingTree } from "./building-upgrades.mjs";
import { resourceInfo, RESOURCE_LIBRARY } from "./resources.mjs";

/** Нужды семьи в неделю: еда 1, топливо 1 (зимой 2). Ресурсы-нужды называются так. */
export const FOOD = "Еда";
export const FUEL = "Топливо";
export const WEALTH = "Богатство";
export const NEEDS = { [FOOD]: 1, [FUEL]: 1 };
export const WINTER_FUEL = 2;

/** Значки известных ресурсов; прочим — мешок. */
export const RESOURCE_ICONS = {
  "Еда": "icons/consumables/grains/bread-loaf-boule-rustic-brown.webp",
  "Топливо": "icons/commodities/wood/kindling-sticks-brown.webp",
  "Древесина": "icons/commodities/wood/log-cut-ash-brown.webp",
  "Камень": "icons/commodities/stone/masonry-block-cube-grey.webp",
  "Глина": "icons/commodities/stone/clay-grey.webp",
  "Железная руда": "icons/commodities/stone/boulder-grey.webp",
  "Серебряная руда": "icons/commodities/stone/boulder-grey-blue.webp",
  "Шкуры": "icons/commodities/leather/fur-brown.webp",
  "Кости": "icons/commodities/bones/bone-simple-white.webp",
  "Лесные травы": "icons/commodities/flowers/clover.webp",
  "Травы": "icons/commodities/flowers/clover.webp",
  "Зерно": "icons/consumables/grains/wheat-yellow.webp",
  "Мука": "icons/consumables/grains/sack-rice-flour-brown.webp",
  "Пиво": "icons/consumables/drinks/alcohol-beer-stein-wooden-brown.webp",
  "Водка": "icons/consumables/drinks/alcohol-spirits-bottle-green.webp",
  "Мёд": "icons/consumables/food/honey-beehive-brown.webp",
  "Шерсть": "icons/commodities/leather/fur-pelt-off-white.webp",
  "Ткань": "icons/commodities/cloth/cloth-bolt-tan.webp",
  "Кожа": "icons/commodities/leather/leather-bolt-brown.webp",
  "Доски": "icons/commodities/wood/lumber-plank-brown.webp",
  "Железо": "icons/commodities/metal/barstock-heated-steel.webp",
  "Инструменты": "icons/tools/smithing/anvil.webp",
  "Снадобья": "icons/consumables/potions/bottle-bulb-corked-green.webp",
  "Оружие": "icons/weapons/swords/sword-guard-worn-purple.webp",
  "Доспехи": "icons/equipment/chest/breastplate-banded-steel.webp",
  "Луки": "icons/weapons/bows/bow-ornamental-carved-brown.webp",
  "Лошади": "icons/environment/creatures/horse-brown.webp"
};
export const RESOURCE_ICON = "icons/containers/bags/sack-simple-leather-brown.webp";
export const resourceIcon = name => resourceInfo(name)?.img || RESOURCE_ICONS[name] || RESOURCE_ICON;

/** Цена продажи на торговом посту — монет валюты мира за единицу; покупка — ×1,5. Прочее — по умолчанию. */
export const RESOURCE_PRICES = {
  "Еда": 2, "Топливо": 2, "Древесина": 3, "Камень": 4, "Глина": 2, "Железная руда": 8, "Серебряная руда": 30,
  "Шкуры": 6, "Кости": 1, "Лесные травы": 5, "Травы": 5,
  "Зерно": 2, "Мука": 3, "Пиво": 4, "Водка": 12, "Мёд": 6, "Шерсть": 4, "Ткань": 10, "Кожа": 10, "Доски": 5,
  "Железо": 15, "Инструменты": 30, "Снадобья": 20, "Оружие": 25, "Доспехи": 40, "Луки": 15, "Лошади": 80
};
export const DEFAULT_PRICE = 5;
export const BUY_MARKUP = 1.5;
export const priceOf = name => resourceInfo(name)?.price ?? RESOURCE_PRICES[name] ?? DEFAULT_PRICE;

/** Все известные ресурсы по имени: библиотека (PLAN 4.201) и справочник поселения — для подсказок в полях. */
export const resourceNames = () => [...new Set([...RESOURCE_LIBRARY.map(x => x.name), ...Object.keys(RESOURCE_ICONS)])];

/** Порядок на складе: нужды, затем остальное по алфавиту. */
export const RESOURCE_ORDER = [FOOD, FUEL];

/** Вместимость склада по каждому ресурсу без построек-складов. */
export const BASE_STORAGE = 40;

/** Месяцы и сезоны. */
export const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
export const SEASONS = { winter: "Зима", spring: "Весна", summer: "Лето", autumn: "Осень" };
export const WEEKS_PER_MONTH = 4;
export function seasonOf(month) {
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

/** Календарь поселения. */
export function calendar({ year = 1, month = 4, week = 1 } = {}) {
  const season = seasonOf(month);
  return { year, month, week, monthLabel: MONTHS[month - 1], season, seasonLabel: SEASONS[season], winter: season === "winter",
    monthEnd: week >= WEEKS_PER_MONTH };
}

/** Одобрение 0–10. */
export const APPROVAL_MAX = 10;
/** Шанс прихода семей в конце месяца по уровню одобрения: [шанс %, формула числа семей]. */
export const ARRIVALS = { 6: [20, "1"], 7: [30, "1d2"], 8: [40, "1d4"], 9: [50, "1d4+1"], 10: [50, "1d4+2"] };
/** Без свободных домов приходят самое большее столько семей (бездомными). */
export const HOMELESS_CAP = 2;
/** Бунт: с третьего уровня 25 %, +25 % за каждый уровень ниже; Контроль снимает по 5 % за уровень. */
export function revoltChance(approval, control = 0) {
  const base = approval <= 3 ? Math.min(100, (4 - Math.max(0, approval)) * 25) : 0;
  return Math.max(0, base - Math.max(0, control) * 5);
}
/** С этого уровня народ доволен: в конце месяца — награда на усмотрение ведущего. */
export const CONTENT_LEVEL = 7;

/** Казна: единица Богатства — столько монет валюты мира (журнал: 500 оренов). */
export const WEALTH_RATE = 500;

/**
 * Налог с семьи в неделю — монет валюты мира (в казну идёт Богатством по курсу). Собирать налог можно, только если
 * в поселении есть постройка с налогами (усадьба); её уровень множит налог. Раз в месяц налог двигает одобрение.
 */
export const TAXES = {
  none:   { label: "Без налога", perFamily: 0,  approval: 1 },
  low:    { label: "Низкий",     perFamily: 5,  approval: 0 },
  normal: { label: "Обычный",    perFamily: 10, approval: 0 },
  high:   { label: "Высокий",    perFamily: 20, approval: -1 }
};

/** Группы построек — порядок на листе. */
export const BUILDING_GROUPS = {
  living:  "Жильё и власть",
  food:    "Еда и промысел",
  raw:     "Добыча",
  craft:   "Ремесло",
  service: "Торговля и службы",
  defense: "Оборона и вера",
  storage: "Хранение"
};

/** Как часто строка выработки или содержания срабатывает. */
export const PERIODS = { week: "в неделю", month: "в месяц", bimonth: "раз в два месяца" };

/**
 * Встроенные постройки: первый уровень — по журналу мира manorlords, следующие — улучшения. В поселение постройка
 * попадает предметом «Постройка» (buildingItemData); ведущий правит её или делает свои.
 * Уровень: cost — цена [{resource, qty}] (ресурс «Богатство» берётся из казны), weeks — недели стройки, families —
 * сколько семей работает, housing — сколько живёт, control — к Контролю (controlPerFamily — за каждую семью на работе),
 * taxes — множитель налога, storage — прибавка вместимости склада к каждому ресурсу, consume — сырьё (без него
 * постройка работает частью), produce и upkeep — строки выработки и содержания: resource, formula,
 * per (за семью или за постройку), period, noWinter, minFamilies, same (столько же, сколько выпало строкой выше).
 */
export const BUILDINGS = {
  house: {
    label: "Жилой дом", group: "living", img: "icons/environment/settlement/house-farmland-small.webp",
    hint: "Дом для семьи: очаг, спальные места, кладовая. Свободный дом позволяет прийти новой семье, если одобрение высоко.",
    levels: [
      { cost: [{ resource: "Древесина", qty: 5 }], weeks: 1, housing: 1 },
      { cost: [{ resource: "Древесина", qty: 5 }, { resource: "Камень", qty: 3 }], weeks: 2, housing: 2 }
    ]
  },
  manor: {
    label: "Усадьба", group: "living", img: "icons/environment/settlement/house-manor.webp", unique: true,
    hint: "Дом правителя: без усадьбы налоги не собрать. Второй уровень — налог в полтора раза больше и +1 к Контролю.",
    levels: [
      { cost: [{ resource: "Древесина", qty: 15 }, { resource: "Камень", qty: 10 }], weeks: 4, housing: 1, taxes: 1 },
      { cost: [{ resource: "Камень", qty: 20 }, { resource: WEALTH, qty: 1 }], weeks: 4, housing: 1, taxes: 1.5, control: 1 }
    ]
  },
  lumber: {
    label: "Лагерь лесорубов", group: "raw", img: "icons/environment/settlement/lumbermill.webp",
    hint: "Каждую неделю 1d6+3 древесины и ещё 1d6 за каждую семью в лагере, вплоть до трёх семей.",
    levels: [
      { cost: [{ resource: "Древесина", qty: 3 }], weeks: 1, families: 3,
        produce: [{ resource: "Древесина", formula: "1d6+3" }, { resource: "Древесина", formula: "1d6", per: "family" }] },
      { cost: [{ resource: "Древесина", qty: 6 }, { resource: "Камень", qty: 2 }], weeks: 2, families: 4,
        produce: [{ resource: "Древесина", formula: "1d6+4" }, { resource: "Древесина", formula: "1d6", per: "family" }] }
    ]
  },
  herbalist: {
    label: "Хата травника", group: "food", img: "icons/environment/settlement/hut.webp",
    hint: "Травники собирают травы, ягоды и грибы: раз в неделю 1d6 лесных трав и 1 еда, кроме зимы. Посаженные растения — свои строки выработки (1d6 каждого).",
    levels: [
      { cost: [{ resource: "Древесина", qty: 4 }], weeks: 1, families: 1,
        produce: [{ resource: "Лесные травы", formula: "1d6", minFamilies: 1, noWinter: true },
          { resource: FOOD, formula: "1", minFamilies: 1, noWinter: true }] },
      { cost: [{ resource: "Древесина", qty: 4 }, { resource: "Камень", qty: 2 }], weeks: 2, families: 2,
        produce: [{ resource: "Лесные травы", formula: "1d6", per: "family", noWinter: true },
          { resource: FOOD, formula: "1", per: "family", noWinter: true }] }
    ]
  },
  hunters: {
    label: "Лагерь охотников", group: "food", img: "icons/environment/settlement/house-woods.webp",
    hint: "Раз в неделю 1d6 еды и столько же шкур и костей за каждую семью охотников.",
    levels: [
      { cost: [{ resource: "Древесина", qty: 4 }], weeks: 1, families: 1,
        produce: [{ resource: FOOD, formula: "1d6", per: "family" }, { resource: "Шкуры", formula: "1d6", per: "family", same: true },
          { resource: "Кости", formula: "1d6", per: "family", same: true }] },
      { cost: [{ resource: "Древесина", qty: 6 }], weeks: 1, families: 2,
        produce: [{ resource: FOOD, formula: "1d6", per: "family" }, { resource: "Шкуры", formula: "1d6", per: "family", same: true },
          { resource: "Кости", formula: "1d6", per: "family", same: true }] }
    ]
  },
  mine: {
    label: "Шахта", group: "raw", img: "icons/environment/settlement/mine-cart-rocks-red.webp",
    hint: "С каждой семьи в неделю 1d6 камня, 1d3 железной руды и 1 серебряной. Раз в месяц — 1 древесина на опорные балки: без неё может случиться обвал.",
    levels: [
      { cost: [{ resource: "Древесина", qty: 10 }], weeks: 2, families: 3,
        produce: [{ resource: "Камень", formula: "1d6", per: "family" }, { resource: "Железная руда", formula: "1d3", per: "family" },
          { resource: "Серебряная руда", formula: "1", per: "family" }],
        upkeep: [{ resource: "Древесина", formula: "1", period: "month" }] },
      { cost: [{ resource: "Древесина", qty: 10 }, { resource: "Камень", qty: 6 }], weeks: 3, families: 5,
        produce: [{ resource: "Камень", formula: "1d6", per: "family" }, { resource: "Железная руда", formula: "1d3", per: "family" },
          { resource: "Серебряная руда", formula: "1", per: "family" }],
        upkeep: [{ resource: "Древесина", formula: "2", period: "month" }] }
    ]
  },
  market: {
    label: "Рыночная площадь", group: "service", img: "icons/environment/settlement/market-stall.webp", unique: true,
    hint: "Здесь торгуют тем, что сделали дома и на работе. Если прилавков (семей) хотя бы пять — +1 Богатство раз в два месяца.",
    levels: [
      { cost: [{ resource: "Древесина", qty: 6 }], weeks: 2, families: 10,
        produce: [{ resource: WEALTH, formula: "1", period: "bimonth", minFamilies: 5 }] },
      { cost: [{ resource: "Древесина", qty: 6 }, { resource: "Камень", qty: 6 }], weeks: 3, families: 15,
        produce: [{ resource: WEALTH, formula: "1", period: "month", minFamilies: 5 }] }
    ]
  },
  tradepost: {
    label: "Торговый пост", group: "service", img: "icons/environment/settlement/wagon.webp", unique: true, trade: true,
    hint: "Купцы заезжают каждую неделю: без поста ресурсы не продать и не купить.",
    levels: [{ cost: [{ resource: "Древесина", qty: 8 }], weeks: 2 }]
  },
  farm: {
    label: "Ферма",
    group: "food",
    img: "icons/environment/settlement/house-farmland.webp",
    hint: "Поля с зерном: 2d6 зерна с каждой семьи в неделю, кроме зимы. Зерно идёт на мельницу, в пивоварню и винокурню.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 6
          }
        ],
        weeks: 2,
        families: 3,
        produce: [
          {
            resource: "Зерно",
            formula: "2d6",
            per: "family",
            noWinter: true
          }
        ]
      },
      {
        cost: [
          {
            resource: "Древесина",
            qty: 6
          },
          {
            resource: "Камень",
            qty: 4
          }
        ],
        weeks: 2,
        families: 5,
        produce: [
          {
            resource: "Зерно",
            formula: "2d6",
            per: "family",
            noWinter: true
          }
        ]
      }
    ]
  },
  windmill: {
    label: "Мельница",
    group: "food",
    img: "icons/environment/settlement/farm-silo-windmill.webp",
    unique: true,
    hint: "Мелет зерно: 4 зерна с семьи — 1d6+2 муки.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 10
          },
          {
            resource: "Камень",
            qty: 6
          }
        ],
        weeks: 3,
        families: 1,
        consume: [
          {
            resource: "Зерно",
            formula: "4",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Мука",
            formula: "1d6+2",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Древесина",
            qty: 6
          },
          {
            resource: "Камень",
            qty: 8
          }
        ],
        weeks: 3,
        families: 2,
        consume: [
          {
            resource: "Зерно",
            formula: "4",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Мука",
            formula: "1d6+2",
            per: "family"
          }
        ]
      }
    ]
  },
  bakery: {
    label: "Пекарня",
    group: "food",
    img: "icons/environment/settlement/house-two-stories-small.webp",
    hint: "Хлеб: 2 муки и 1 топливо с семьи — 2d6 еды.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 6
          },
          {
            resource: "Камень",
            qty: 2
          }
        ],
        weeks: 2,
        families: 1,
        consume: [
          {
            resource: "Мука",
            formula: "2",
            per: "family"
          },
          {
            resource: FUEL,
            formula: "1",
            per: "family"
          }
        ],
        produce: [
          {
            resource: FOOD,
            formula: "2d6",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Древесина",
            qty: 4
          },
          {
            resource: "Камень",
            qty: 4
          }
        ],
        weeks: 2,
        families: 2,
        consume: [
          {
            resource: "Мука",
            formula: "2",
            per: "family"
          },
          {
            resource: FUEL,
            formula: "1",
            per: "family"
          }
        ],
        produce: [
          {
            resource: FOOD,
            formula: "2d6",
            per: "family"
          }
        ]
      }
    ]
  },
  fishery: {
    label: "Рыбацкая хижина",
    group: "food",
    img: "icons/environment/settlement/abandoned-pier.webp",
    hint: "Рыба из реки: 1d6 еды с семьи в неделю.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 4
          }
        ],
        weeks: 1,
        families: 2,
        produce: [
          {
            resource: FOOD,
            formula: "1d6",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Древесина",
            qty: 4
          },
          {
            resource: "Доски",
            qty: 2
          }
        ],
        weeks: 1,
        families: 3,
        produce: [
          {
            resource: FOOD,
            formula: "1d6",
            per: "family"
          }
        ]
      }
    ]
  },
  apiary: {
    label: "Пасека",
    group: "food",
    img: "icons/environment/settlement/gazebo.webp",
    hint: "Ульи: 1d4 мёда с семьи в неделю, кроме зимы.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 3
          }
        ],
        weeks: 1,
        families: 1,
        produce: [
          {
            resource: "Мёд",
            formula: "1d4",
            per: "family",
            noWinter: true
          }
        ]
      },
      {
        cost: [
          {
            resource: "Доски",
            qty: 3
          }
        ],
        weeks: 1,
        families: 2,
        produce: [
          {
            resource: "Мёд",
            formula: "1d4",
            per: "family",
            noWinter: true
          }
        ]
      }
    ]
  },
  sheepfold: {
    label: "Овчарня",
    group: "food",
    img: "icons/environment/settlement/stable.webp",
    hint: "Овцы: 1d4 шерсти и 1 еда с семьи в неделю.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 6
          }
        ],
        weeks: 2,
        families: 1,
        produce: [
          {
            resource: "Шерсть",
            formula: "1d4",
            per: "family"
          },
          {
            resource: FOOD,
            formula: "1",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Древесина",
            qty: 4
          },
          {
            resource: "Доски",
            qty: 2
          }
        ],
        weeks: 2,
        families: 2,
        produce: [
          {
            resource: "Шерсть",
            formula: "1d4",
            per: "family"
          },
          {
            resource: FOOD,
            formula: "1",
            per: "family"
          }
        ]
      }
    ]
  },
  brewery: {
    label: "Пивоварня",
    group: "craft",
    img: "icons/environment/settlement/tavern-tan.webp",
    hint: "Варит пиво: 3 зерна и 1 топливо с семьи — 1d6+1 пива.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 8
          },
          {
            resource: "Камень",
            qty: 2
          }
        ],
        weeks: 2,
        families: 1,
        consume: [
          {
            resource: "Зерно",
            formula: "3",
            per: "family"
          },
          {
            resource: FUEL,
            formula: "1",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Пиво",
            formula: "1d6+1",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Доски",
            qty: 4
          },
          {
            resource: "Камень",
            qty: 4
          }
        ],
        weeks: 2,
        families: 2,
        consume: [
          {
            resource: "Зерно",
            formula: "3",
            per: "family"
          },
          {
            resource: FUEL,
            formula: "1",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Пиво",
            formula: "1d6+1",
            per: "family"
          }
        ]
      }
    ]
  },
  distillery: {
    label: "Винокурня",
    group: "craft",
    img: "icons/environment/settlement/house-shelter-stone.webp",
    hint: "Гонит водку: 4 зерна и 2 топлива с семьи — 1d4 водки. Водка дорога на торговом посту.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 8
          },
          {
            resource: "Камень",
            qty: 6
          }
        ],
        weeks: 3,
        families: 1,
        consume: [
          {
            resource: "Зерно",
            formula: "4",
            per: "family"
          },
          {
            resource: FUEL,
            formula: "2",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Водка",
            formula: "1d4",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Камень",
            qty: 6
          },
          {
            resource: "Железо",
            qty: 2
          }
        ],
        weeks: 3,
        families: 2,
        consume: [
          {
            resource: "Зерно",
            formula: "4",
            per: "family"
          },
          {
            resource: FUEL,
            formula: "2",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Водка",
            formula: "1d4",
            per: "family"
          }
        ]
      }
    ]
  },
  sawmill: {
    label: "Лесопилка",
    group: "craft",
    img: "icons/environment/settlement/sawmill-shed-red.webp",
    hint: "Распиливает брёвна: 2 древесины с семьи — 1d4+1 досок.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 6
          }
        ],
        weeks: 2,
        families: 2,
        consume: [
          {
            resource: "Древесина",
            formula: "2",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Доски",
            formula: "1d4+1",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Древесина",
            qty: 6
          },
          {
            resource: "Железо",
            qty: 1
          }
        ],
        weeks: 2,
        families: 3,
        consume: [
          {
            resource: "Древесина",
            formula: "2",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Доски",
            formula: "1d4+1",
            per: "family"
          }
        ]
      }
    ]
  },
  charcoal: {
    label: "Углежог",
    group: "craft",
    img: "icons/environment/settlement/hut.webp",
    hint: "Жжёт уголь: 2 древесины с семьи — 1d6+2 топлива. Без топлива зимой семьи мёрзнут.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 3
          }
        ],
        weeks: 1,
        families: 2,
        consume: [
          {
            resource: "Древесина",
            formula: "2",
            per: "family"
          }
        ],
        produce: [
          {
            resource: FUEL,
            formula: "1d6+2",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Древесина",
            qty: 4
          },
          {
            resource: "Камень",
            qty: 2
          }
        ],
        weeks: 1,
        families: 3,
        consume: [
          {
            resource: "Древесина",
            formula: "2",
            per: "family"
          }
        ],
        produce: [
          {
            resource: FUEL,
            formula: "1d6+2",
            per: "family"
          }
        ]
      }
    ]
  },
  tannery: {
    label: "Дубильня",
    group: "craft",
    img: "icons/environment/settlement/house-poles.webp",
    hint: "Выделывает шкуры: 2 шкуры с семьи — 1d3+1 кожи.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 6
          }
        ],
        weeks: 2,
        families: 1,
        consume: [
          {
            resource: "Шкуры",
            formula: "2",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Кожа",
            formula: "1d3+1",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Доски",
            qty: 4
          }
        ],
        weeks: 2,
        families: 2,
        consume: [
          {
            resource: "Шкуры",
            formula: "2",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Кожа",
            formula: "1d3+1",
            per: "family"
          }
        ]
      }
    ]
  },
  weaver: {
    label: "Ткацкая мастерская",
    group: "craft",
    img: "icons/environment/settlement/house-two-stories.webp",
    hint: "Прядёт и ткёт: 2 шерсти с семьи — 1d3+1 ткани.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 6
          },
          {
            resource: "Доски",
            qty: 2
          }
        ],
        weeks: 2,
        families: 1,
        consume: [
          {
            resource: "Шерсть",
            formula: "2",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Ткань",
            formula: "1d3+1",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Доски",
            qty: 4
          }
        ],
        weeks: 2,
        families: 2,
        consume: [
          {
            resource: "Шерсть",
            formula: "2",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Ткань",
            formula: "1d3+1",
            per: "family"
          }
        ]
      }
    ]
  },
  bloomery: {
    label: "Плавильня",
    group: "craft",
    img: "icons/environment/settlement/watchtower-lit-orange.webp",
    unique: true,
    hint: "Плавит руду: 2 железной руды и 2 топлива с семьи — 1d3 железа.",
    levels: [
      {
        cost: [
          {
            resource: "Камень",
            qty: 8
          },
          {
            resource: "Древесина",
            qty: 4
          }
        ],
        weeks: 3,
        families: 1,
        consume: [
          {
            resource: "Железная руда",
            formula: "2",
            per: "family"
          },
          {
            resource: FUEL,
            formula: "2",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Железо",
            formula: "1d3",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Камень",
            qty: 10
          },
          {
            resource: "Железо",
            qty: 2
          }
        ],
        weeks: 3,
        families: 2,
        consume: [
          {
            resource: "Железная руда",
            formula: "2",
            per: "family"
          },
          {
            resource: FUEL,
            formula: "2",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Железо",
            formula: "1d3",
            per: "family"
          }
        ]
      }
    ]
  },
  smithy: {
    label: "Кузница",
    group: "craft",
    img: "icons/environment/settlement/blacksmith.webp",
    hint: "Куёт инструменты: 2 железа и 1 топливо с семьи — 1d2 инструментов.",
    levels: [
      {
        cost: [
          {
            resource: "Камень",
            qty: 6
          },
          {
            resource: "Древесина",
            qty: 6
          }
        ],
        weeks: 3,
        families: 1,
        consume: [
          {
            resource: "Железо",
            formula: "2",
            per: "family"
          },
          {
            resource: FUEL,
            formula: "1",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Инструменты",
            formula: "1d2",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Камень",
            qty: 6
          },
          {
            resource: "Железо",
            qty: 3
          }
        ],
        weeks: 3,
        families: 2,
        consume: [
          {
            resource: "Железо",
            formula: "2",
            per: "family"
          },
          {
            resource: FUEL,
            formula: "1",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Инструменты",
            formula: "1d2",
            per: "family"
          }
        ]
      }
    ]
  },
  alchemist: {
    label: "Алхимическая лавка",
    group: "craft",
    img: "icons/environment/settlement/pottery-shop-shed-red.webp",
    unique: true,
    hint: "Травник-алхимик: 3 лесные травы с семьи — 1d3 снадобий.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 6
          },
          {
            resource: "Камень",
            qty: 2
          }
        ],
        weeks: 2,
        families: 1,
        consume: [
          {
            resource: "Лесные травы",
            formula: "3",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Снадобья",
            formula: "1d3",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Доски",
            qty: 4
          },
          {
            resource: WEALTH,
            qty: 1
          }
        ],
        weeks: 2,
        families: 2,
        consume: [
          {
            resource: "Лесные травы",
            formula: "3",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Снадобья",
            formula: "1d3",
            per: "family"
          }
        ]
      }
    ]
  },
  quarry: {
    label: "Каменоломня",
    group: "raw",
    img: "icons/environment/settlement/quarry.webp",
    hint: "Камень для стен и домов: 1d6+1 камня с семьи в неделю.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 6
          }
        ],
        weeks: 2,
        families: 3,
        produce: [
          {
            resource: "Камень",
            formula: "1d6+1",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Древесина",
            qty: 6
          },
          {
            resource: "Инструменты",
            qty: 1
          }
        ],
        weeks: 2,
        families: 4,
        produce: [
          {
            resource: "Камень",
            formula: "1d6+1",
            per: "family"
          }
        ]
      }
    ]
  },
  claypit: {
    label: "Глиняный карьер",
    group: "raw",
    img: "icons/environment/settlement/building-rubble.webp",
    hint: "Глина для кирпича и посуды: 1d6 глины с семьи, кроме зимы.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 3
          }
        ],
        weeks: 1,
        families: 2,
        produce: [
          {
            resource: "Глина",
            formula: "1d6",
            per: "family",
            noWinter: true
          }
        ]
      },
      {
        cost: [
          {
            resource: "Доски",
            qty: 2
          }
        ],
        weeks: 1,
        families: 3,
        produce: [
          {
            resource: "Глина",
            formula: "1d6",
            per: "family",
            noWinter: true
          }
        ]
      }
    ]
  },
  tavern: {
    label: "Таверна",
    group: "service",
    img: "icons/environment/settlement/tavern.webp",
    unique: true,
    hint: "Пиво и сплетни: 2 пива в неделю — 0,1 Богатства (50 оренов). Второй уровень — ещё и водка, доход вдвое.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 10
          },
          {
            resource: "Камень",
            qty: 2
          }
        ],
        weeks: 2,
        families: 2,
        consume: [
          {
            resource: "Пиво",
            formula: "2"
          }
        ],
        produce: [
          {
            resource: WEALTH,
            formula: "0.1",
            minFamilies: 1
          }
        ]
      },
      {
        cost: [
          {
            resource: "Доски",
            qty: 6
          },
          {
            resource: "Камень",
            qty: 4
          }
        ],
        weeks: 2,
        families: 3,
        consume: [
          {
            resource: "Пиво",
            formula: "3"
          },
          {
            resource: "Водка",
            formula: "1"
          }
        ],
        produce: [
          {
            resource: WEALTH,
            formula: "0.2",
            minFamilies: 1
          }
        ]
      }
    ]
  },
  temple: {
    label: "Храм",
    group: "defense",
    img: "icons/environment/settlement/church.webp",
    unique: true,
    hint: "Храм Вечного Огня или Мелитэле: +1 к Контролю (каменный — +2). Жрецы кормятся с общины — 1 еда в неделю.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 10
          },
          {
            resource: "Камень",
            qty: 6
          }
        ],
        weeks: 4,
        families: 1,
        control: 1,
        upkeep: [
          {
            resource: FOOD,
            formula: "1"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Камень",
            qty: 15
          },
          {
            resource: WEALTH,
            qty: 1
          }
        ],
        weeks: 4,
        families: 1,
        control: 2,
        upkeep: [
          {
            resource: FOOD,
            formula: "1"
          }
        ]
      }
    ]
  },
  barracks: {
    label: "Казарма стражи",
    group: "defense",
    img: "icons/environment/settlement/watchtower-wood-tan.webp",
    unique: true,
    hint: "Стража: +1 к Контролю за каждую семью стражников; каждая ест 1 еду в неделю.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 10
          },
          {
            resource: "Камень",
            qty: 4
          }
        ],
        weeks: 3,
        families: 3,
        controlPerFamily: 1,
        drill: 1,
        upkeep: [
          {
            resource: FOOD,
            formula: "1",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Камень",
            qty: 10
          },
          {
            resource: "Железо",
            qty: 2
          }
        ],
        weeks: 3,
        families: 5,
        controlPerFamily: 1,
        drill: 1,
        upkeep: [
          {
            resource: FOOD,
            formula: "1",
            per: "family"
          }
        ]
      }
    ]
  },
  palisade: {
    label: "Частокол",
    group: "defense",
    img: "icons/environment/settlement/fence-wooden-picket.webp",
    unique: true,
    hint: "Стена вокруг поселения: +1 к Контролю; каменная — +2.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 20
          }
        ],
        weeks: 3,
        control: 1
      },
      {
        cost: [
          {
            resource: "Камень",
            qty: 30
          }
        ],
        weeks: 6,
        control: 2
      }
    ]
  },
  drillground: {
    label: "Плац",
    group: "defense",
    img: "icons/environment/settlement/target-dummy.webp",
    unique: true,
    hint: "Здесь отряды учатся строю: без плаца или казармы тренировки нет. Второй уровень — учатся вдвое быстрее.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 8
          }
        ],
        weeks: 2,
        drill: 1
      },
      {
        cost: [
          {
            resource: "Доски",
            qty: 6
          },
          {
            resource: "Камень",
            qty: 4
          }
        ],
        weeks: 2,
        drill: 2
      }
    ]
  },
  armory: {
    label: "Оружейная",
    group: "craft",
    img: "icons/environment/settlement/blacksmith.webp",
    hint: "Копья, топоры, мечи: 1 железо и 1 доска с семьи — 1d2 оружия.",
    levels: [
      {
        cost: [
          {
            resource: "Камень",
            qty: 6
          },
          {
            resource: "Древесина",
            qty: 6
          }
        ],
        weeks: 3,
        families: 1,
        consume: [
          {
            resource: "Железо",
            formula: "1",
            per: "family"
          },
          {
            resource: "Доски",
            formula: "1",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Оружие",
            formula: "1d2",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Камень",
            qty: 6
          },
          {
            resource: "Железо",
            qty: 2
          }
        ],
        weeks: 3,
        families: 2,
        consume: [
          {
            resource: "Железо",
            formula: "1",
            per: "family"
          },
          {
            resource: "Доски",
            formula: "1",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Оружие",
            formula: "1d2",
            per: "family"
          }
        ]
      }
    ]
  },
  armorer: {
    label: "Бронник",
    group: "craft",
    img: "icons/environment/settlement/house-city.webp",
    hint: "Стёганки и кольчуги: 2 железа и 1 кожа с семьи — 1d2 доспехов.",
    levels: [
      {
        cost: [
          {
            resource: "Камень",
            qty: 6
          },
          {
            resource: "Древесина",
            qty: 6
          }
        ],
        weeks: 3,
        families: 1,
        consume: [
          {
            resource: "Железо",
            formula: "2",
            per: "family"
          },
          {
            resource: "Кожа",
            formula: "1",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Доспехи",
            formula: "1d2",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Камень",
            qty: 6
          },
          {
            resource: "Железо",
            qty: 2
          }
        ],
        weeks: 3,
        families: 2,
        consume: [
          {
            resource: "Железо",
            formula: "2",
            per: "family"
          },
          {
            resource: "Кожа",
            formula: "1",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Доспехи",
            formula: "1d2",
            per: "family"
          }
        ]
      }
    ]
  },
  bowyer: {
    label: "Мастерская лучника",
    group: "craft",
    img: "icons/environment/settlement/house-woods.webp",
    hint: "Луки и стрелы: 2 доски с семьи — 1d3 луков.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 6
          }
        ],
        weeks: 2,
        families: 1,
        consume: [
          {
            resource: "Доски",
            formula: "2",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Луки",
            formula: "1d3",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Доски",
            qty: 4
          }
        ],
        weeks: 2,
        families: 2,
        consume: [
          {
            resource: "Доски",
            formula: "2",
            per: "family"
          }
        ],
        produce: [
          {
            resource: "Луки",
            formula: "1d3",
            per: "family"
          }
        ]
      }
    ]
  },
  stables: {
    label: "Конюшня",
    group: "food",
    img: "icons/environment/settlement/stables-horses.webp",
    hint: "Растит коней: 1 лошадь с семьи в месяц; кони едят 1 зерно с семьи в неделю.",
    levels: [
      {
        cost: [
          {
            resource: "Древесина",
            qty: 10
          }
        ],
        weeks: 3,
        families: 1,
        produce: [
          {
            resource: "Лошади",
            formula: "1",
            per: "family",
            period: "month"
          }
        ],
        upkeep: [
          {
            resource: "Зерно",
            formula: "1",
            per: "family"
          }
        ]
      },
      {
        cost: [
          {
            resource: "Доски",
            qty: 6
          },
          {
            resource: "Камень",
            qty: 4
          }
        ],
        weeks: 3,
        families: 2,
        produce: [
          {
            resource: "Лошади",
            formula: "1",
            per: "family",
            period: "month"
          }
        ],
        upkeep: [
          {
            resource: "Зерно",
            formula: "1",
            per: "family"
          }
        ]
      }
    ]
  },
  storehouse: {
    label: "Склад", group: "storage", img: "icons/environment/settlement/warehouse-crates.webp",
    hint: "Здесь можно хранить огромное количество ресурсов; хорошее место для еды и всего, что портится.",
    levels: [
      { cost: [{ resource: "Древесина", qty: 6 }], weeks: 2, storage: 60 },
      { cost: [{ resource: "Древесина", qty: 6 }, { resource: "Камень", qty: 4 }], weeks: 2, storage: 150 }
    ]
  }
};

/** Строка выработки со всеми полями. */
export const fullRow = r => ({ resource: r.resource ?? "", formula: r.formula ?? "1", per: r.per ?? "building", period: r.period ?? "week",
  noWinter: !!r.noWinter, minFamilies: r.minFamilies ?? 0, same: !!r.same });

/** Уровень со всеми полями. */
export const fullLevel = l => ({
  cost: (l.cost ?? []).map(c => ({ ...c })), weeks: l.weeks ?? 1, families: l.families ?? 0, housing: l.housing ?? 0,
  control: l.control ?? 0, controlPerFamily: l.controlPerFamily ?? 0, taxes: l.taxes ?? 0, storage: l.storage ?? 0, drill: l.drill ?? 0,
  consume: (l.consume ?? []).map(fullRow), produce: (l.produce ?? []).map(fullRow), upkeep: (l.upkeep ?? []).map(fullRow)
});

/** Данные предмета «Постройка» для встроенной постройки (ещё не заложенной). */
export function buildingItemData(key) {
  const d = BUILDINGS[key];
  if (!d) return null;
  return {
    name: d.label, type: "building", img: d.img,
    system: { key, group: d.group, unique: !!d.unique, trade: !!d.trade, levels: d.levels.map(fullLevel),
      branches: buildingTree(key, d.levels.length), description: `<p>${d.hint}</p>` }
  };
}
