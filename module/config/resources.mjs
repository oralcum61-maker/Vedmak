// Библиотека ресурсов поселений (PLAN 4.201): разделы, цена (монет валюты мира за единицу), значок и подсказка. Ресурс из
// библиотеки (или предмет «Ресурс» ведущего) перетаскивают на лист поселения — склад начинает его учитывать; постройки
// называют ресурс по имени. Значки и цены справочника поселения (config/settlement.mjs) берутся отсюда же; свои ресурсы
// ведущего (предметы мира) переопределяют библиотеку по имени.

const C = "icons/commodities/", F = "icons/consumables/";

export const RESOURCE_CATEGORIES = {
  food: "Пища", drinks: "Напитки", wood: "Дерево, камень и топливо", metal: "Руды и металлы", cloth: "Ткани, кожа и меха",
  craft: "Ремесло", herbs: "Травы и алхимия", livestock: "Скот", war: "Война", luxury: "Роскошь и торговля", monsters: "Трофеи чудовищ"
};

const r = (name, cat, price, img, hint = "") => ({ name, cat, price, img, hint });

export const RESOURCE_LIBRARY = [
  // Пища
  r("Еда", "food", 2, F + "grains/bread-loaf-boule-rustic-brown.webp", "Всякая снедь: семья ест 1 в неделю"),
  r("Зерно", "food", 2, F + "grains/wheat-yellow.webp", "Рожь, пшеница, ячмень — с полей"),
  r("Мука", "food", 3, F + "grains/sack-rice-flour-brown.webp", "С мельницы — для пекарни"),
  r("Хлеб", "food", 3, F + "grains/bread-loaf-wheat-brown.webp", "Караваи из пекарни"),
  r("Мясо", "food", 5, F + "meat/hock-leg-pink-brown.webp", "Свежее мясо — с охоты и скотного двора"),
  r("Солонина", "food", 6, F + "food/shank-meat-bone-glazed-brown.webp", "Солёное мясо — хранится всю зиму"),
  r("Рыба", "food", 3, F + "meat/fish-whole-blue.webp", "Улов с реки и озера"),
  r("Сушёная рыба", "food", 4, F + "food/dried-meat-jerky-fish-red.webp", "Вяленая и копчёная"),
  r("Сыр", "food", 6, F + "food/cheese-wheel-round-yellow.webp", "Коровий и овечий"),
  r("Молоко", "food", 2, F + "drinks/pitcher-dripping-white.webp", "Скисает за неделю"),
  r("Яйца", "food", 2, F + "eggs/eggs-white.webp", "С курятников"),
  r("Овощи", "food", 2, F + "vegetable/cabbage-head-leafy-green.webp", "Капуста, репа, морковь"),
  r("Картофель", "food", 2, F + "vegetable/root-potato-brown.webp", "Земляные яблоки"),
  r("Фрукты", "food", 3, F + "fruit/apple-ripe-red.webp", "Яблоки, груши, сливы"),
  r("Ягоды", "food", 3, F + "fruit/berry-bunch-red-green.webp", "Лесные и садовые"),
  r("Грибы", "food", 3, F + "mushrooms/convex-bolete-brown.webp", "Из леса — съедобные, если повезёт"),
  r("Орехи", "food", 3, F + "nuts/hazelnuts-shelled-whole.webp", "Лещина, грецкий"),
  r("Мёд", "food", 6, F + "food/honey-beehive-brown.webp", "С пасеки"),
  r("Соль", "food", 8, F + "food/salt-seasoning-spice-pink.webp", "Без неё не засолить на зиму"),
  r("Пряности", "food", 25, C + "materials/bowl-powder-gold.webp", "Привозные: перец, корица — из Зеррикании"),
  r("Сало", "food", 4, F + "meat/side-pork-fat-skin-pink.webp", "Свиное, солёное"),
  r("Варенье", "food", 5, F + "food/preserves-jam-jelly-jar-brown-red.webp", "Ягоды в меду"),
  // Напитки
  r("Пиво", "drinks", 4, F + "drinks/alcohol-beer-stein-wooden-brown.webp", "Из пивоварни — для таверны"),
  r("Водка", "drinks", 12, F + "drinks/alcohol-spirits-bottle-green.webp", "Из винокурни"),
  r("Вино", "drinks", 15, F + "drinks/wine-amphora-clay-red.webp", "Туссентское, бочковое"),
  r("Медовуха", "drinks", 8, F + "drinks/tea-jug-gourd-brown.webp", "Хмельной мёд"),
  r("Сидр", "drinks", 5, F + "drinks/water-jug-clay-brown.webp", "Яблочный, кислый"),
  r("Краснолюдский спирт", "drinks", 30, F + "drinks/alcohol-jar-spirits-gray.webp", "Горит синим пламенем; нужен алхимикам"),
  r("Белая чайка", "drinks", 40, F + "drinks/alcohol-spirits-bottle-blue.webp", "Ведьмачья настойка — редкость"),
  r("Травяная настойка", "drinks", 10, F + "drinks/alcohol-jug-spirits-brown.webp", "Горькая, от всех хворей"),
  // Дерево, камень и топливо
  r("Древесина", "wood", 3, C + "wood/log-cut-ash-brown.webp", "Брёвна с лесосеки"),
  r("Доски", "wood", 5, C + "wood/lumber-plank-brown.webp", "С лесопилки"),
  r("Бревна дубовые", "wood", 8, C + "wood/log-cut-hickory-brown.webp", "На крепь, корабли и бочки"),
  r("Топливо", "wood", 2, C + "wood/kindling-sticks-brown.webp", "Дрова и хворост: семья жжёт 1 в неделю, зимой 2"),
  r("Уголь", "wood", 4, C + "stone/ore-chunk-black.webp", "Древесный — для горнов"),
  r("Дёготь", "wood", 6, F + "potions/bottle-round-corked-orange.webp", "Колёсам, сапогам, лекарям"),
  r("Смола", "wood", 6, C + "materials/liquid-orange.webp", "Сосновая"),
  r("Камень", "wood", 4, C + "stone/masonry-block-cube-grey.webp", "Бутовый и тёсаный"),
  r("Мрамор", "wood", 20, C + "stone/masonry-block-cube-white.webp", "Для храмов и усадеб"),
  r("Глина", "wood", 2, C + "stone/clay-grey.webp", "Для гончаров и кирпичников"),
  r("Кирпич", "wood", 5, C + "stone/masonry-bricks-brown.webp", "Обожжённый"),
  r("Черепица", "wood", 6, C + "stone/clay-orange.webp", "Крыши не горят"),
  r("Известь", "wood", 3, C + "materials/bowl-powder-grey.webp", "Раствор для кладки"),
  r("Песок", "wood", 1, C + "materials/bowl-powder-yellow.webp", "Для стекольщиков и раствора"),
  r("Солома", "wood", 1, C + "flowers/wheat-bundle.webp", "Кровля и подстилка"),
  // Руды и металлы
  r("Железная руда", "metal", 8, C + "stone/boulder-grey.webp", "Из шахты — в плавильню"),
  r("Серебряная руда", "metal", 30, C + "stone/boulder-grey-blue.webp", "Попутная руда"),
  r("Медная руда", "metal", 10, C + "stone/ore-chunk-copper-orange.webp", ""),
  r("Оловянная руда", "metal", 10, C + "stone/ore-chunk-grey.webp", ""),
  r("Золотая руда", "metal", 60, C + "stone/ore-pile-nuggets-gold.webp", "Россыпь и жила"),
  r("Железо", "metal", 15, C + "metal/barstock-heated-steel.webp", "Крицы из плавильни"),
  r("Сталь", "metal", 30, C + "metal/ingot-steel.webp", "Каленое железо — на клинки"),
  r("Медь", "metal", 18, C + "metal/ingot-copper.webp", "Котлы и посуда"),
  r("Олово", "metal", 18, C + "metal/ingot-rough-white.webp", ""),
  r("Бронза", "metal", 25, C + "metal/ingot-stamped-bronze.webp", "Колокола и пушечки"),
  r("Серебро", "metal", 80, C + "metal/ingot-silver.webp", "Ведьмачьи клинки и монета"),
  r("Золото", "metal", 200, C + "metal/ingot-gold.webp", ""),
  r("Тёмное железо", "metal", 60, C + "metal/ingot-worn-iron.webp", "Тяжёлое, для лучших доспехов"),
  r("Метеоритная сталь", "metal", 150, C + "metal/ingot-stamped-steel-purple.webp", "Небесное железо"),
  r("Двимерит", "metal", 250, C + "metal/ingot-teal.webp", "Глушит магию; цена — за слиток"),
  // Ткани, кожа и меха
  r("Шерсть", "cloth", 4, C + "leather/fur-pelt-off-white.webp", "С овчарни"),
  r("Лён", "cloth", 4, F + "plants/flax-leaves-spiked-bundle-orange.webp", "На полотно и верёвки"),
  r("Пряжа", "cloth", 5, C + "cloth/thread-spindle-grey.webp", ""),
  r("Ткань", "cloth", 10, C + "cloth/cloth-bolt-tan.webp", "Полотно и холст"),
  r("Сукно", "cloth", 14, C + "cloth/cloth-roll-worn-red.webp", "Шерстяное, крашеное"),
  r("Шёлк", "cloth", 60, C + "cloth/cloth-bolt-gold-red.webp", "Привозной — для знати"),
  r("Войлок", "cloth", 6, C + "cloth/cloth-scraps-plain.webp", "Валенки и потники"),
  r("Шкуры", "cloth", 6, C + "leather/fur-brown.webp", "Сырые — для дубильни"),
  r("Кожа", "cloth", 10, C + "leather/leather-bolt-brown.webp", "Выделанная"),
  r("Меха", "cloth", 30, C + "leather/fur-pelt-spotted-brown.webp", "Соболь, лиса, рысь"),
  r("Медвежья шкура", "cloth", 45, C + "leather/fur-pelt-bear.webp", ""),
  // Ремесло
  r("Инструменты", "craft", 30, "icons/tools/smithing/anvil.webp", "Пилы, топоры, лопаты, молоты"),
  r("Гвозди", "craft", 6, C + "metal/pin-cottar-steel.webp", ""),
  r("Верёвки", "craft", 4, C + "cloth/thread-spindle-black.webp", "Канаты и бечева"),
  r("Бочки", "craft", 8, C + "wood/wood-wheel-brown.webp", "Тара для пива и солонины"),
  r("Посуда", "craft", 5, F + "drinks/water-jug-clay-brown.webp", "Горшки, миски, кружки"),
  r("Стекло", "craft", 20, C + "materials/glass-cube.webp", "Окна и склянки алхимиков"),
  r("Свечи", "craft", 4, C + "treasure/brass-lamp-yellow.webp", "Восковые и сальные"),
  r("Воск", "craft", 5, F + "food/honey-beehive-brown.webp", "С пасеки"),
  r("Мыло", "craft", 4, C + "materials/bowl-powder-teal.webp", ""),
  r("Пергамент", "craft", 12, C + "materials/parchment-secrets.webp", "Для писарей и храма"),
  r("Чернила", "craft", 10, C + "materials/liquid-blue.webp", ""),
  r("Перья", "craft", 2, C + "materials/feather-white.webp", "Гусиные — на стрелы и письмо"),
  r("Кости", "craft", 1, C + "bones/bone-simple-white.webp", "Клей, пуговицы, рукояти"),
  r("Рога", "craft", 5, C + "bones/horn-antler-brown.webp", "Для луков и рукоятей"),
  // Травы и алхимия
  r("Лесные травы", "herbs", 5, C + "flowers/clover.webp", "Что собирает травник"),
  r("Снадобья", "herbs", 20, F + "potions/bottle-bulb-corked-green.webp", "Мази, отвары, эликсиры"),
  r("Ласточкина трава", "herbs", 8, C + "flowers/daisy-white.webp", "Основа «Ласточки»"),
  r("Белый мирт", "herbs", 8, C + "flowers/lily-white.webp", ""),
  r("Мандрагора", "herbs", 25, F + "vegetable/root-ginger-brown.webp", "Корень кричит, когда его выдёргивают"),
  r("Волчий алоэ", "herbs", 15, F + "plants/aloe-succulent-green.webp", ""),
  r("Вербена", "herbs", 6, C + "flowers/cornflower-blue.webp", ""),
  r("Омела", "herbs", 10, C + "flowers/holly-buds-white.webp", ""),
  r("Купорос", "herbs", 12, C + "materials/bowl-powder-blue.webp", "Алхимическая субстанция"),
  r("Ребис", "herbs", 12, C + "materials/bowl-powder-pink.webp", "Алхимическая субстанция"),
  r("Эфир", "herbs", 12, C + "materials/liquid-purple.webp", "Алхимическая субстанция"),
  r("Квебрит", "herbs", 12, C + "materials/bowl-powder-yellow.webp", "Алхимическая субстанция"),
  r("Гидраген", "herbs", 12, C + "materials/liquid-droplet-blue.webp", "Алхимическая субстанция"),
  r("Киноварь", "herbs", 12, C + "materials/bowl-liquid-red.webp", "Алхимическая субстанция"),
  r("Солнце", "herbs", 12, C + "materials/bowl-powder-gold.webp", "Алхимическая субстанция"),
  r("Яды", "herbs", 30, F + "potions/bottle-conical-corked-labeled-skull-poison-green.webp", "Масла и отравы"),
  // Скот
  r("Лошади", "livestock", 80, "icons/environment/creatures/horse-brown.webp", "Под седло и в упряжку"),
  r("Волы", "livestock", 60, C + "bones/horn-curved-brown.webp", "Тянут плуг и телеги"),
  r("Коровы", "livestock", 50, C + "bones/hooves-cloven-brown.webp", "Молоко и мясо"),
  r("Свиньи", "livestock", 25, F + "meat/hock-leg-skin-brown.webp", ""),
  r("Овцы", "livestock", 20, C + "leather/fur-white.webp", "Шерсть и мясо"),
  r("Козы", "livestock", 15, C + "bones/horn-curved-grey.webp", ""),
  r("Куры", "livestock", 3, F + "eggs/egg-nest-pink.webp", ""),
  r("Гуси", "livestock", 5, C + "materials/feather-white.webp", ""),
  r("Собаки", "livestock", 15, C + "claws/claw-canine-brown-grey.webp", "Пастушьи и охотничьи"),
  // Война
  r("Оружие", "war", 25, "icons/weapons/swords/sword-guard-worn-purple.webp", "Мечи, топоры, копья"),
  r("Доспехи", "war", 40, "icons/equipment/chest/breastplate-banded-steel.webp", "Кольчуги, бригантины"),
  r("Луки", "war", 15, "icons/weapons/bows/bow-ornamental-carved-brown.webp", ""),
  r("Стрелы", "war", 3, C + "metal/arrowhead-steel.webp", "Колчан — 20 стрел"),
  r("Арбалеты", "war", 35, "icons/weapons/crossbows/crossbow-simple-brown.webp", ""),
  r("Болты", "war", 4, C + "metal/arrowhead-steel.webp", ""),
  r("Щиты", "war", 12, "icons/equipment/shield/buckler-wooden-boss-brown.webp", ""),
  r("Копья", "war", 10, "icons/weapons/polearms/spear-flared-steel.webp", ""),
  r("Кольчуги", "war", 60, C + "metal/mail-chain-steel.webp", ""),
  r("Сбруя", "war", 15, C + "leather/leather-buckle-steel-tan.webp", "Сёдла, уздечки"),
  r("Осадный лес", "war", 20, C + "wood/framing-reinforced-brown.webp", "На тараны и лестницы"),
  // Роскошь и торговля
  r("Самоцветы", "luxury", 120, C + "gems/gem-faceted-radiant-red.webp", ""),
  r("Янтарь", "luxury", 40, C + "gems/gem-amber-insect-orange.webp", "С побережья"),
  r("Жемчуг", "luxury", 90, C + "gems/gem-faceted-round-white.webp", ""),
  r("Украшения", "luxury", 100, C + "treasure/brooch-gold-ruby.webp", "Броши, перстни, ожерелья"),
  r("Благовония", "luxury", 30, C + "materials/bowl-powder-pink.webp", "Для храма и знати"),
  r("Духи", "luxury", 50, F + "potions/flask-decorated-label-pink.webp", "Туссентские"),
  r("Книги", "luxury", 40, "icons/sundries/books/book-embossed-bound-brown.webp", ""),
  r("Ковры", "luxury", 60, C + "cloth/cloth-patterned-orange.webp", "Офирские"),
  r("Фарфор", "luxury", 70, C + "treasure/goblet-worn-gold.webp", "Привозной"),
  r("Гвинт-карты", "luxury", 10, "icons/sundries/gaming/playing-cards.webp", "Колоды для таверны"),
  // Трофеи чудовищ
  r("Мутагены", "monsters", 100, C + "biological/organ-heart-red.webp", "Из тел чудовищ — для ведьмаков и алхимиков"),
  r("Шкуры чудовищ", "monsters", 50, C + "leather/scales-green.webp", "Чешуя и шкуры"),
  r("Когти и клыки", "monsters", 20, C + "claws/claw-bear-brown.webp", ""),
  r("Ядовитые железы", "monsters", 35, C + "biological/organ-bladder-red.webp", ""),
  r("Глаза чудовищ", "monsters", 30, C + "biological/eye-lizard-green.webp", ""),
  r("Кровь чудовищ", "monsters", 25, C + "materials/liquid-green.webp", ""),
  r("Перья гарпий", "monsters", 15, C + "materials/feather-black-blue.webp", "")
];

/** Ресурс библиотеки по имени. */
export const LIBRARY_BY_NAME = new Map(RESOURCE_LIBRARY.map(x => [x.name, x]));

/** Свои ресурсы ведущего (предметы «Ресурс» мира) по имени: {img, price, cat, hint}. Заполняет settlement/resources.mjs. */
export const CUSTOM_RESOURCES = new Map();

/** Ресурс по имени: свой ведущего, затем библиотека. */
export const resourceInfo = name => CUSTOM_RESOURCES.get(name) ?? LIBRARY_BY_NAME.get(name) ?? null;
