// События месяца поселений (PLAN 4.206): в конце месяца с шансом настройки «settlementEvents» случается событие; правитель
// (владелец поселения) выбирает, как поступить, на листе поселения до следующего хода, иначе — решение по умолчанию.
// Выбор: цена со склада и казны, последствия сразу (склад, казна, одобрение, семьи, Ополчение, Контроль) и надолго
// (модификатор на недели: выработка группы или ресурса, нужды, торговля закрыта, шансы бунта и прихода семей), проверка
// d10 + основа против СЛ с последствиями успеха и провала. Чистые данные и функции — без Foundry.

/** Шанс события в конце месяца, %, по умолчанию. */
export const EVENT_CHANCE = 40;

/**
 * Основы проверок: d10 + основа ≥ СЛ.
 * guard — Контроль + укрепления + Ополчение / 10; order — Контроль + одобрение / 2; luck — только d10.
 */
export const CHECK_BASES = {
  guard: { label: "стража", hint: "Контроль + укрепления + Ополчение / 10" },
  order: { label: "порядок", hint: "Контроль + одобрение / 2" },
  luck: { label: "удача", hint: "только d10" }
};

/** Модификатор надолго: {label, weeks, produce: [{group|resource, mult}], needs: {ресурс: mult}, trade: false, arrival, revolt}. */
const mod = (key, label, weeks, data) => ({ mod: { key, label, weeks, ...data } });

/**
 * События. when(s) — может ли случиться (cond — то же словами, для гайда и окна ведущего) (s: month, season, keys — коды построек, siege, approval, families, militia, trade);
 * choices — выборы; default — индекс выбора без решения правителя (недоступен — последний).
 * Последствие: {stock, delta} (формула, «-» — убыль), {wealth}, {approval}, {families}, {militia}, {control} — число или
 * формула; {mod} — модификатор. Выбор: cost [{resource, qty}] (Богатство — казна), check {base, dc, bonus: {код: +N}},
 * effects, success, fail, requires(s) → строка-причина, если нельзя.
 */
export const SETTLEMENT_EVENTS = {
  fair: {
    label: "Ярмарочный день", img: "icons/environment/settlement/market-stall.webp", weight: 3,
    cond: "есть торговля, не зима, не осада",
    text: "Купцы съехались со всей округи. Если устроить ярмарку, поселение заработает и повеселится.",
    when: s => !s.siege && s.trade && s.season !== "winter",
    choices: [
      { label: "Устроить ярмарку", cost: [{ resource: "Еда", qty: 6 }], effects: [{ wealth: "0.5" }, { approval: 1 }] },
      { label: "Не до того", effects: [] }
    ], default: 1
  },
  plague: {
    label: "Мор", img: "icons/magic/unholy/orb-smoking-green.webp", weight: 2,
    cond: "от 4 семей",
    text: "В посаде слегли люди: жар и кашель. Болезнь может пойти по домам.",
    when: s => s.families >= 4,
    choices: [
      { label: "Карантин", hint: "две недели работают вполсилы", effects: [mod("quarantine", "Карантин", 2, { produce: [{ mult: 0.5 }] })] },
      { label: "Знахарь и снадобья", cost: [{ resource: "Снадобья", qty: 3 }], effects: [{ approval: 1 }] },
      { label: "Положиться на богов", check: { base: "order", dc: 12, bonus: { temple: 3, herbalist: 2 } },
        success: [], fail: [{ families: "-1d2" }, { approval: -1 }] }
    ], default: 2
  },
  bandits: {
    label: "Разбойники на тракте", img: "icons/skills/melee/weapons-crossed-swords-black-gray.webp", weight: 3,
    cond: "не в осаде",
    text: "На дороге грабят обозы. Купцы боятся ехать, люди ропщут.",
    when: s => !s.siege,
    choices: [
      { label: "Выслать ополчение", requires: s => s.militia >= 5 ? "" : "В Ополчении меньше 5 человек.",
        check: { base: "guard", dc: 13 }, success: [{ wealth: "0.3" }, { approval: 1 }], fail: [{ militia: "-1d4" }, { approval: -1 }] },
      { label: "Откупиться", cost: [{ resource: "Богатство", qty: 0.5 }], effects: [] },
      { label: "Закрыть ворота", hint: "три недели без торговли и караванов", effects: [mod("gates", "Ворота закрыты", 3, { trade: false })] }
    ], default: 2
  },
  badharvest: {
    label: "Неурожай", img: "icons/consumables/grains/bread-loaf-boule-rustic-brown.webp", weight: 2,
    cond: "есть ферма; лето или осень",
    text: "Дожди побили хлеб на полях. Зерна в этом месяце будет вдвое меньше.",
    when: s => s.keys.has("farm") && (s.season === "summer" || s.season === "autumn"),
    choices: [
      { label: "Открыть закрома", cost: [{ resource: "Еда", qty: 10 }],
        effects: [{ approval: 1 }, mod("badharvest", "Неурожай", 4, { produce: [{ resource: "Зерно", mult: 0.5 }] })] },
      { label: "Затянуть пояса", effects: [{ approval: -1 }, mod("badharvest", "Неурожай", 4, { produce: [{ resource: "Зерно", mult: 0.5 }] })] }
    ], default: 1
  },
  monster: {
    label: "Чудовище в лесу", img: "icons/creatures/abilities/wolf-howl-moon-purple.webp", weight: 2,
    cond: "всегда",
    text: "Лесорубы видели в чаще тварь. Люди боятся ходить за стены.",
    when: () => true,
    choices: [
      { label: "Нанять ведьмака", cost: [{ resource: "Богатство", qty: 1 }], effects: [{ approval: 1 }, { stock: "Когти и клыки", delta: "1d3" }] },
      { label: "Облава ополчением", requires: s => s.militia >= 5 ? "" : "В Ополчении меньше 5 человек.",
        check: { base: "guard", dc: 15 }, success: [{ approval: 1 }, { stock: "Шкуры чудовищ", delta: "1" }],
        fail: [{ militia: "-1d6" }, { approval: -1 }] },
      { label: "Не ходить в лес", hint: "месяц добыча и промыслы — вполовину",
        effects: [mod("monster", "Тварь в лесу", 4, { produce: [{ group: "raw", mult: 0.5 }, { group: "food", mult: 0.75 }] })] }
    ], default: 2
  },
  refugees: {
    label: "Беженцы у ворот", img: "icons/environment/people/group.webp", weight: 2,
    cond: "не в осаде",
    text: "С юга идут погорельцы — война выгнала их из деревень. Просят крова.",
    when: s => !s.siege,
    choices: [
      { label: "Принять", hint: "новые семьи; еды на первое время", cost: [{ resource: "Еда", qty: 5 }], effects: [{ families: "1d3" }] },
      { label: "Дать хлеба и отправить дальше", cost: [{ resource: "Еда", qty: 3 }], effects: [{ approval: 1 }] },
      { label: "Прогнать", effects: [{ approval: -1 }] }
    ], default: 2
  },
  fire: {
    label: "Пожар в посаде", img: "icons/magic/fire/flame-burning-building.webp", weight: 2,
    cond: "всегда",
    text: "Ночью занялся сарай, огонь перекинулся на соседние дворы.",
    when: () => true,
    choices: [
      { label: "Тушить всем миром", check: { base: "order", dc: 10 },
        success: [{ stock: "Древесина", delta: "-1d4" }], fail: [{ stock: "Древесина", delta: "-2d6" }, { stock: "Доски", delta: "-1d4" }, { approval: -1 }] },
      { label: "Отстроить за счёт казны", cost: [{ resource: "Богатство", qty: 0.5 }, { resource: "Древесина", qty: 6 }], effects: [{ approval: 1 }] }
    ], default: 0
  },
  wedding: {
    label: "Свадьба старосты", img: "icons/environment/settlement/tavern.webp", weight: 2,
    cond: "одобрение от 4, не осада",
    text: "Староста женит сына. Народ ждёт, что правитель почтит праздник.",
    when: s => s.approval >= 4 && !s.siege,
    choices: [
      { label: "Устроить пир", cost: [{ resource: "Еда", qty: 8 }], effects: [{ approval: 1 }] },
      { label: "Прислать подарок", cost: [{ resource: "Богатство", qty: 0.2 }], effects: [] },
      { label: "Обойтись поздравлением", effects: [mod("snub", "Обида старосты", 4, { revolt: 5 })] }
    ], default: 2
  },
  merchant: {
    label: "Купец из Новиграда", img: "icons/environment/settlement/wagon.webp", weight: 2,
    cond: "есть торговля, не осада",
    text: "Новиградский купец везёт товар дешевле, чем на торговом посту.",
    when: s => s.trade && !s.siege,
    choices: [
      { label: "Купить инструменты", cost: [{ resource: "Богатство", qty: 0.4 }], effects: [{ stock: "Инструменты", delta: "4" }] },
      { label: "Купить железо", cost: [{ resource: "Богатство", qty: 0.3 }], effects: [{ stock: "Железо", delta: "6" }] },
      { label: "Пропустить", effects: [] }
    ], default: 2
  },
  tribute: {
    label: "Королевский сборщик", img: "icons/commodities/currency/coins-plain-stack-gold-yellow.webp", weight: 2,
    cond: "от 6 семей",
    text: "Сборщик подати требует долю для короны — с бумагой и печатью.",
    when: s => s.families >= 6,
    choices: [
      { label: "Заплатить", cost: [{ resource: "Богатство", qty: 0.5 }], effects: [] },
      { label: "Отказать", check: { base: "order", dc: 14 }, success: [{ approval: 1 }], fail: [{ wealth: "-1" }, { approval: -1 }] }
    ], default: 1
  },
  wolves: {
    label: "Волки режут скот", img: "icons/creatures/mammals/wolf-howl-moon-gray.webp", weight: 2,
    cond: "есть овчарня, конюшня, охотники или ферма",
    text: "Стая повадилась к выгонам: каждую ночь — новая потеря.",
    when: s => ["sheepfold", "stables", "hunters", "farm"].some(k => s.keys.has(k)),
    choices: [
      { label: "Облава", check: { base: "guard", dc: 11, bonus: { hunters: 2 } }, success: [{ stock: "Шкуры", delta: "1d4" }],
        fail: [{ militia: "-1" }, { stock: "Еда", delta: "-1d6" }] },
      { label: "Терпеть", effects: [{ stock: "Еда", delta: "-1d6" }, mod("wolves", "Волки у выгонов", 2, { produce: [{ group: "food", mult: 0.8 }] })] }
    ], default: 1
  },
  warmseason: {
    label: "Благодатная погода", img: "icons/magic/nature/leaf-glow-green.webp", weight: 2,
    cond: "весна или лето",
    text: "Тёплые дожди и солнце — всё растёт как на дрожжах.",
    when: s => s.season === "spring" || s.season === "summer",
    choices: [{ label: "Слава богам", hint: "две недели пища и промыслы — в полторы силы",
      effects: [mod("warm", "Благодатная погода", 2, { produce: [{ group: "food", mult: 1.5 }] })] }], default: 0
  },
  deserters: {
    label: "Беглые солдаты", img: "icons/equipment/head/helm-barbute-steel.webp", weight: 1,
    cond: "не в осаде",
    text: "У ворот — дезертиры с войны. Просят взять их на службу и не выдавать.",
    when: s => !s.siege,
    choices: [
      { label: "Взять в Ополчение", hint: "месяц народ косится — бунт +5%", effects: [{ militia: "1d6" }, mod("deserters", "Беглые в Ополчении", 4, { revolt: 5 })] },
      { label: "Прогнать", effects: [] }
    ], default: 1
  },
  dispute: {
    label: "Тяжба соседей", img: "icons/sundries/documents/document-sealed-signatures-red.webp", weight: 2,
    cond: "от 3 семей",
    text: "Два двора делят межу и колодец — до драки дошло. Ждут суда правителя.",
    when: s => s.families >= 3,
    choices: [
      { label: "Рассудить", check: { base: "order", dc: 11 }, success: [{ approval: 1 }], fail: [{ approval: -1 }] },
      { label: "Отложить", effects: [mod("dispute", "Тяжба не решена", 4, { revolt: 5 })] }
    ], default: 1
  },
  pilgrims: {
    label: "Паломники", img: "icons/sundries/lights/candle-lit-yellow.webp", weight: 1,
    cond: "есть храм, не осада",
    text: "Через поселение идут паломники к святыне Мелитэле. Ищут ночлега.",
    when: s => s.keys.has("temple") && !s.siege,
    choices: [
      { label: "Принять в храме", cost: [{ resource: "Еда", qty: 4 }], effects: [{ wealth: "0.2" }, mod("pilgrims", "Слава о поселении", 4, { arrival: 10 })] },
      { label: "Пусть идут дальше", effects: [] }
    ], default: 1
  }
};

/**
 * Случится ли событие в конце месяца и какое: d100 ≤ шанс, затем по весам среди подходящих. Нет — null.
 * @param {object} s — состояние для when (см. eventState)
 */
export function rollEvent(s, chance = EVENT_CHANCE, rand = Math.random) {
  if (!(chance > 0) || Math.floor(rand() * 100) + 1 > chance) return null;
  const list = Object.entries(SETTLEMENT_EVENTS).filter(([, e]) => { try { return e.when(s); } catch { return false; } });
  const total = list.reduce((n, [, e]) => n + (e.weight ?? 1), 0);
  if (!total) return null;
  let r = rand() * total;
  for (const [key, e] of list) { r -= e.weight ?? 1; if (r < 0) return key; }
  return list.at(-1)[0];
}

/** Последствие подписью: «Еда −1d6», «одобрение +1», «на 2 нед.: Карантин». */
export function effectLabel(e) {
  const sign = v => { const s = String(v).replace(".", ","); return s.startsWith("-") ? `−${s.slice(1)}` : `+${s}`; };
  if (e.mod) {
    const bits = [];
    for (const p of e.mod.produce ?? []) bits.push(`${p.resource ?? { food: "пища", raw: "добыча", craft: "ремесло" }[p.group] ?? "вся выработка"} ×${String(p.mult).replace(".", ",")}`);
    if (e.mod.trade === false) bits.push("без торговли");
    if (e.mod.revolt) bits.push(`бунт ${sign(e.mod.revolt)}%`);
    if (e.mod.arrival) bits.push(`приход семей ${sign(e.mod.arrival)}%`);
    return `${e.mod.weeks} нед. «${e.mod.label}»${bits.length ? `: ${bits.join(", ")}` : ""}`;
  }
  if (e.stock) return `${e.stock} ${sign(e.delta)}`;
  if (e.wealth != null) return `Богатство ${sign(e.wealth)}`;
  if (e.approval != null) return `одобрение ${sign(e.approval)}`;
  if (e.families != null) return `семьи ${sign(e.families)}`;
  if (e.militia != null) return `Ополчение ${sign(e.militia)}`;
  if (e.control != null) return `Контроль ${sign(e.control)}`;
  return "";
}
