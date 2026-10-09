// Хранилища — сундук, сумка, повозка, склад, лавка (актёр «loot», PLAN 4.115).
//
// Взять вещь — в инвентарь персонажа (одинаковые компоненты, снаряжение, алхимия и усиления складываются, как при
// перетаскивании на лист), из хранилища — убыль. В лавке вещь покупается: цена по книге × наценка лавки, кроны
// из кошелька персонажа уходят в кассу лавки. Положить — перетащить свою вещь на лист хранилища.
// Игрок обычно хранилищем не владеет (сундук на сцене — у ведущего): изменения в нём делает ведущий по сокету,
// проверив, что игрок видит хранилище (Наблюдатель и выше) и владеет персонажем.

import { asGM, registerGMHandler } from "../combat/common.mjs";
import { CURRENCY_KEYS, moneySetting, formatRate } from "../config/money.mjs";
import { STORAGE_KINDS } from "../data/actor/loot.mjs";
import { postCard } from "../util.mjs";

const { DialogV2 } = foundry.applications.api;
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/** Такие вещи складываются с одноимёнными у персонажа (как при перетаскивании на лист персонажа). */
export const STACKABLE = ["gear", "component", "alchemical", "enhancement"];

/** Группы списка хранилища — по типу вещи, в этом порядке. */
export const STORAGE_GROUPS = [
  ["weapon", "Оружие"], ["armor", "Броня"], ["gear", "Снаряжение"], ["alchemical", "Алхимия"],
  ["component", "Компоненты"], ["recipe", "Чертежи и формулы"], ["enhancement", "Усиления"]
];

/** Количество вещи: у предметов без количества (заклинание, раса) — одна. */
const qtyOf = item => (Number.isFinite(item.system?.quantity) ? item.system.quantity : 1);
const hasQty = item => Number.isFinite(item.system?.quantity);

/** Цена одной вещи в лавке, кроны: цена по книге × наценка. */
export function unitPrice(storage, item) {
  const cost = typeof item.system?.cost === "number" ? item.system.cost : 0;
  return cost * (storage.system.markup ?? 100) / 100;
}

/** Цена покупки нескольких — целыми кронами вверх (монеты в кошельке целые). */
export const priceFor = (storage, item, qty) => Math.ceil(unitPrice(storage, item) * qty - 1e-9);

/** Кроны словами: «12 кр.». */
export const crownsLabel = n => `${formatRate(n)} ${moneySetting().list.crowns.abbr}`;

/** Точка в конце фразы — если её уже не поставило сокращение («кр.»). */
const sentence = s => (/[.!?…]$/.test(s) ? s : `${s}.`);

/**
 * Кому достаётся вещь: выделенный токен своего персонажа, назначенный пользователю персонаж, единственный свой
 * персонаж — или выбор из своих.
 */
export async function chooseHero(storage) {
  const token = canvas?.tokens?.controlled?.find(t => t.actor?.type === "character" && t.actor !== storage && t.actor.isOwner);
  if (token) return token.actor;
  if (game.user.character?.isOwner && game.user.character !== storage) return game.user.character;
  // Ведущему — персонажи игроков, игроку — свои
  const pool = game.actors.filter(a => a.type === "character" && a.isOwner && (!game.user.isGM || a.hasPlayerOwner));
  if (pool.length === 1) return pool[0];
  if (!pool.length) {
    ui.notifications.warn("Выделите токен персонажа или назначьте себе персонажа — ему достанется вещь.");
    return null;
  }
  const options = pool.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
  const id = await DialogV2.prompt({
    window: { title: "Кому" },
    content: `<div class="form-group"><label>Персонаж</label><select name="hero">${options}</select></div>`,
    ok: { label: "Выбрать", callback: (event, button) => button.form.elements.hero.value },
    rejectClose: false
  });
  return id ? game.actors.get(id) : null;
}

/** Сколько взять: окно с числом, если вещей больше одной. В лавке по умолчанию одна, из сундука — все. */
async function askQuantity(storage, item, shop) {
  const have = qtyOf(item);
  if (!hasQty(item) || have <= 1) return 1;
  const each = shop ? ` · ${crownsLabel(unitPrice(storage, item))} за штуку` : "";
  const n = await DialogV2.prompt({
    window: { title: shop ? "Купить" : "Взять" },
    content: `<p>${esc(item.name)} — есть ${have}${each}.</p>
      <div class="form-group"><label>Сколько</label><input type="number" name="qty" value="${shop ? 1 : have}" min="1" max="${have}" autofocus></div>`,
    ok: { label: shop ? "Купить" : "Взять", callback: (event, button) => Number(button.form.elements.qty.value) },
    rejectClose: false
  });
  return n > 0 ? Math.min(have, Math.floor(n)) : 0;
}

/**
 * Взять (или купить в лавке) вещь из хранилища.
 * @param {Actor} storage — хранилище (актёр «loot», может быть токеном)
 * @param {Item} item — вещь хранилища
 * @param {{hero?: Actor, qty?: number}} [opts]
 */
export async function takeFromStorage(storage, item, { hero = null, qty = null } = {}) {
  if (storage?.type !== "loot" || item?.parent !== storage) return null;
  hero ??= await chooseHero(storage);
  if (!hero) return null;
  if (!hero.isOwner) return ui.notifications.warn(`Брать вещи в инвентарь «${hero.name}» может его владелец или ведущий.`);
  const shop = storage.system.kind === "shop";
  qty ??= await askQuantity(storage, item, shop);
  if (!qty) return null;
  const price = shop ? priceFor(storage, item, qty) : 0;
  const crowns = hero.system.money?.crowns ?? 0;
  if (price > crowns) {
    return ui.notifications.warn(`«${item.name}»: нужно ${crownsLabel(price)}, а у «${hero.name}» ${crownsLabel(crowns)} `
      + "Другие монеты можно обменять в кошельке на листе.");
  }
  const request = { storageUuid: storage.uuid, itemId: item.id, qty, heroUuid: hero.uuid };
  // Своё хранилище (сумка игрока, ведущий) — сразу; чужое — через ведущего
  if (storage.isOwner) return takeQueued(request, game.user.id);
  return asGM("storageTake", request);
}

/** Взять: выполняет владелец хранилища или ведущий (по сокету — от имени игрока). */
async function performTake({ storageUuid, itemId, qty, heroUuid }, userId) {
  const user = game.users.get(userId);
  const storage = await fromUuid(storageUuid);
  const hero = await fromUuid(heroUuid);
  if (!user || storage?.documentName !== "Actor" || storage.type !== "loot" || hero?.documentName !== "Actor") return null;
  if (!storage.testUserPermission(user, "OBSERVER") || !hero.testUserPermission(user, "OWNER")) return null;
  const item = storage.items.get(itemId);
  if (!item) return null;
  const have = qtyOf(item);
  const n = hasQty(item) ? Math.max(1, Math.min(have, Math.floor(Number(qty) || 1))) : 1;
  const shop = storage.system.kind === "shop";
  // Цена — заново здесь: присланной от игрока не верим
  const price = shop ? priceFor(storage, item, n) : 0;
  const crowns = hero.system.money?.crowns ?? 0;
  if (price > crowns) return null;

  // В инвентарь персонажа: одинаковое складывается
  const same = STACKABLE.includes(item.type)
    && hero.items.find(i => i.type === item.type && i.name === item.name && !i.system.applied);
  if (same) await same.update({ "system.quantity": qtyOf(same) + n });
  else {
    const data = item.toObject();
    delete data._id;
    if (hasQty(item)) data.system.quantity = n;
    if ("equipped" in data.system) data.system.equipped = false;
    if ("stored" in data.system) data.system.stored = false;
    await hero.createEmbeddedDocuments("Item", [data]);
  }
  // Из хранилища
  if (!hasQty(item) || n >= have) await item.delete();
  else await item.update({ "system.quantity": have - n });
  if (price) {
    await hero.update({ "system.money.crowns": crowns - price });
    await storage.update({ "system.money.crowns": (storage.system.money.crowns ?? 0) + price });
  }
  const what = `<b>${esc(item.name)}</b>${n > 1 ? ` ×${n}` : ""}`;
  return postCard(hero, shop ? "Покупка" : "Взято из хранилища",
    `<p>${sentence(`${esc(hero.name)}: ${what} — ${shop ? "в лавке" : "из"} «${esc(storage.name)}»${price ? ` за ${crownsLabel(price)}` : ""}`)}</p>`,
    { icon: `fa-solid ${STORAGE_KINDS[storage.system.kind]?.icon ?? "fa-box-archive"}` });
}

/** Забрать все деньги хранилища (кроме лавки: её касса — у ведущего). */
export async function takeStorageMoney(storage) {
  if (storage?.type !== "loot") return null;
  if (storage.system.kind === "shop" && !game.user.isGM) return ui.notifications.warn("Касса лавки — у ведущего.");
  if (!CURRENCY_KEYS.some(k => storage.system.money[k] > 0)) return ui.notifications.info(`В «${storage.name}» нет денег.`);
  const hero = await chooseHero(storage);
  if (!hero) return null;
  if (!hero.isOwner) return ui.notifications.warn(`Класть деньги в кошелёк «${hero.name}» может его владелец или ведущий.`);
  const request = { storageUuid: storage.uuid, heroUuid: hero.uuid };
  if (storage.isOwner) return moneyQueued(request, game.user.id);
  return asGM("storageMoney", request);
}

async function performTakeMoney({ storageUuid, heroUuid }, userId) {
  const user = game.users.get(userId);
  const storage = await fromUuid(storageUuid);
  const hero = await fromUuid(heroUuid);
  if (!user || storage?.type !== "loot" || hero?.documentName !== "Actor") return null;
  if (!storage.testUserPermission(user, "OBSERVER") || !hero.testUserPermission(user, "OWNER")) return null;
  if (storage.system.kind === "shop" && !user.isGM) return null;
  const { list } = moneySetting();
  const heroUpdate = {}, storageUpdate = {}, parts = [];
  for (const k of CURRENCY_KEYS) {
    const n = storage.system.money[k] ?? 0;
    if (n <= 0) continue;
    heroUpdate[`system.money.${k}`] = (hero.system.money?.[k] ?? 0) + n;
    storageUpdate[`system.money.${k}`] = 0;
    parts.push(`${n} ${list[k].abbr}`);
  }
  if (!parts.length) return null;
  await storage.update(storageUpdate);
  await hero.update(heroUpdate);
  return postCard(hero, "Деньги из хранилища", `<p>${esc(hero.name)}: <b>${parts.join(", ")}</b> — из «${esc(storage.name)}».</p>`,
    { icon: "fa-solid fa-coins" });
}

/**
 * Положить свою вещь в хранилище (перетаскиванием с листа персонажа): переносится целиком, одинаковое складывается.
 * В лавку кладёт только ведущий — продажу система не ведёт.
 */
export async function putIntoStorage(storage, item) {
  const source = item?.parent;
  if (storage?.type !== "loot" || source?.documentName !== "Actor" || source === storage) return null;
  if (!source.isOwner) return ui.notifications.warn(`Брать вещи у «${source.name}» может его владелец или ведущий.`);
  if (storage.system.kind === "shop" && !game.user.isGM) return ui.notifications.warn("Класть вещи в лавку может ведущий.");
  if (item.system?.equipped) return ui.notifications.warn(`«${item.name}» в руках или надето — сначала снимите.`);
  const request = { storageUuid: storage.uuid, itemUuid: item.uuid };
  if (storage.isOwner) return putQueued(request, game.user.id);
  return asGM("storagePut", request);
}

async function performPut({ storageUuid, itemUuid }, userId) {
  const user = game.users.get(userId);
  const storage = await fromUuid(storageUuid);
  const item = await fromUuid(itemUuid);
  const source = item?.parent;
  if (!user || storage?.type !== "loot" || source?.documentName !== "Actor" || source === storage) return null;
  if (!storage.testUserPermission(user, "OBSERVER") || !source.testUserPermission(user, "OWNER")) return null;
  if (storage.system.kind === "shop" && !user.isGM) return null;
  const n = qtyOf(item);
  const same = STACKABLE.includes(item.type) && storage.items.find(i => i.type === item.type && i.name === item.name);
  if (same) await same.update({ "system.quantity": qtyOf(same) + n });
  else {
    const data = item.toObject();
    delete data._id;
    if ("equipped" in data.system) data.system.equipped = false;
    if ("stored" in data.system) data.system.stored = false;
    await storage.createEmbeddedDocuments("Item", [data]);
  }
  await item.delete();
  return postCard(source, "Положено в хранилище",
    `<p>${esc(source.name)}: <b>${esc(item.name)}</b>${n > 1 ? ` ×${n}` : ""} — в «${esc(storage.name)}».</p>`,
    { icon: `fa-solid ${STORAGE_KINDS[storage.system.kind]?.icon ?? "fa-box-archive"}` });
}

/**
 * Изменения одного хранилища — по очереди: каждое читает остаток в начале, а пишет после ответа сервера, и два
 * одновременных «Взять» (два игрока, двойной щелчок) иначе выдавали бы одну вещь дважды.
 */
const storageQueues = new Map();
function serialByStorage(fn) {
  return (request, userId) => {
    const key = request?.storageUuid ?? "";
    const run = (storageQueues.get(key) ?? Promise.resolve()).then(() => fn(request, userId));
    const tail = run.catch(() => {});
    storageQueues.set(key, tail);
    tail.then(() => { if (storageQueues.get(key) === tail) storageQueues.delete(key); });
    return run;
  };
}
const takeQueued = serialByStorage(performTake);
const moneyQueued = serialByStorage(performTakeMoney);
const putQueued = serialByStorage(performPut);

registerGMHandler("storageTake", takeQueued);
registerGMHandler("storageMoney", moneyQueued);
registerGMHandler("storagePut", putQueued);

/** Вид хранилища по названию — для перенесённых из старой системы: «Повозка», «Портной», «Склад». */
export function guessStorageKind(name) {
  const n = String(name ?? "").toLowerCase();
  if (/повозк|телег|фургон|карет|воз\b/.test(n)) return "cart";
  if (/сумк|мешок|рюкзак|котомк|ножны|кошел/.test(n)) return "bag";
  if (/лавк|магазин|портн|кузн|мастерск|банк|торгов|сыновья|аптек|трактир|корчм|каменщ|каменьщ|алхими/.test(n)) return "shop";
  if (/склад|амбар|дом|жил|лагер|шахт|тайник|подвал|хранилищ/.test(n)) return "stash";
  return "chest";
}

/**
 * Перенос из TheWitcherTRPG (PLAN 4.108) делал «добычу» персонажами с отметкой `vedmak.migratedLoot`: своего
 * хранилища тогда не было. Теперь они становятся хранилищами — вещи (и на токенах), деньги и описание сохраняются.
 * @returns {Promise<number>} сколько преобразовано
 */
export async function convertMigratedLoot() {
  const { ForcedReplacement, ForcedDeletion } = foundry.data.operators;
  const list = game.actors.filter(a => a.type === "character" && a.getFlag("vedmak", "migratedLoot"));
  for (const actor of list) {
    const src = actor._source.system ?? {};
    const notes = String(src.notes ?? "");
    const capacity = Number(notes.match(/вместимость ([\d.,]+) кг/)?.[1]?.replace(",", ".")) || 0;
    const description = notes.replace(/<p>Перенесено из старой системы: хранилище \(«добыча»\)[^<]*<\/p>/, "");
    await actor.update({
      type: "loot",
      system: ForcedReplacement.create({
        kind: guessStorageKind(actor.name), capacity, markup: 100, money: { ...(src.money ?? {}) }, description
      }),
      "flags.vedmak.migratedLoot": ForcedDeletion.create()
    });
  }
  return list.length;
}
