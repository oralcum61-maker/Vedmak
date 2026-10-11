// Валюты Континента, обмен и вес монет.
//
// Цены в книгах — в кронах, поэтому крона — мера всего: курс валюты — сколько крон стоит одна её монета.
// Курсы по умолчанию — из корника, стр. 71: 1 реданская крона = 1 темерский орен = 1/3 нильфгаардского флорена =
// 3 каэдвенских дуката = 1/4 бизанта (Ковир и Повисс) = 1/2 линтара (Хенгфорсская лига). Марок в книге нет —
// их курс домашний, как и вес монет. Ведущий правит названия, курсы, вес монеты и комиссию менялы в настройках —
// меню «Валюты и обмен», значение лежит в настройке `currencies`.

import { worldSetting, memoBySource } from "../util.mjs";

/** Ключи валют в данных персонажа (`system.money.<ключ>`). Крона — первая и основная. */
export const CURRENCY_KEYS = ["crowns", "orens", "florens", "ducats", "marks", "lintars", "bizants"];

/** Валюты по умолчанию: название, сокращение, где ходит, курс к кроне, вес монеты в граммах. */
export const DEFAULT_CURRENCIES = {
  crowns:  { label: "Кроны",   abbr: "кр.", region: "Новиград, Редания",      rate: 1,   grams: 5 },
  orens:   { label: "Орены",   abbr: "ор.", region: "Темерия и Север ниже Понтара", rate: 1, grams: 5 },
  florens: { label: "Флорены", abbr: "фл.", region: "Нильфгаард и провинции", rate: 3,   grams: 5 },
  ducats:  { label: "Дукаты",  abbr: "дук.", region: "Каэдвен",               rate: 1 / 3, grams: 5 },
  marks:   { label: "Марки",   abbr: "мар.", region: "(нет в корнике)",       rate: 0.6, grams: 5 },
  lintars: { label: "Линтары", abbr: "лин.", region: "Хенгфорсская лига",     rate: 2,   grams: 5 },
  bizants: { label: "Бизанты", abbr: "биз.", region: "Ковир и Повисс",        rate: 4,   grams: 5 }
};

/** Значение настройки по умолчанию: валюты и комиссия менялы в процентах. */
export const DEFAULT_MONEY_SETTING = { fee: 0, list: DEFAULT_CURRENCIES };

/** Настройка мира с подстановкой умолчаний (неверные числа не ломают расчёты). Считается заново, только когда
    настройку поменяли (worldSetting отдаёт тот же объект); результат общий — не менять. */
export const moneySetting = () => normalizeMoney(worldSetting("currencies", null));
const normalizeMoney = memoBySource(raw => {
  const saved = raw ?? {};
  const list = {};
  for (const key of CURRENCY_KEYS) {
    const def = DEFAULT_CURRENCIES[key];
    const s = saved.list?.[key] ?? {};
    const rate = Number(s.rate);
    const grams = Number(s.grams);
    list[key] = {
      key,
      label: s.label || def.label,
      abbr: s.abbr || def.abbr,
      region: s.region ?? def.region,
      rate: key === "crowns" ? 1 : (rate > 0 ? rate : def.rate),
      grams: grams >= 0 && Number.isFinite(grams) ? grams : def.grams
    };
  }
  const fee = Number(saved.fee);
  return { fee: Number.isFinite(fee) ? Math.min(100, Math.max(0, fee)) : 0, list };
});

/** Валюты списком в порядке ключей. */
export const currencies = () => Object.values(moneySetting().list);

/** Сколько всё это стоит в кронах. */
export function toCrowns(money) {
  const { list } = moneySetting();
  return CURRENCY_KEYS.reduce((sum, k) => sum + (Number(money?.[k]) || 0) * list[k].rate, 0);
}

/** Вес монет, кг (без учёта настройки «вес монет»). */
export function coinWeightKg(money) {
  const { list } = moneySetting();
  const grams = CURRENCY_KEYS.reduce((sum, k) => sum + (Number(money?.[k]) || 0) * list[k].grams, 0);
  return Math.round(grams / 100) / 10;
}

/** Считаются ли монеты в нагрузку (настройка мира «Вес монет»). */
export function coinWeightEnabled() {
  return !!worldSetting("coinWeight", false);
}

/**
 * Обмен: сколько монет получится и сколько уйдёт менялe.
 * @returns {{get: number, feeCrowns: number, value: number}} get — целых монет на выходе, value — стоимость в кронах
 */
export function exchangeQuote(from, to, amount, feePct) {
  const { list } = moneySetting();
  const value = Math.max(0, Number(amount) || 0) * list[from].rate;
  const feeCrowns = value * Math.max(0, Math.min(100, Number(feePct) || 0)) / 100;
  const get = Math.floor((value - feeCrowns) / list[to].rate + 1e-9);
  return { get, feeCrowns: Math.round(feeCrowns * 100) / 100, value: Math.round(value * 100) / 100 };
}

/** Число без лишних нулей: 1.5 → «1,5», 2 → «2». */
export const formatRate = n => String(Math.round(n * 100) / 100).replace(".", ",");
