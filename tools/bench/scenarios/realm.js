// Хозяйство и войско (PLAN 4.203): управляющие построек, заказы мастерских, караваны между поселениями, поход и осада,
// Совет правителя.
const S = game.vedmak.settlement;
const ARMY = game.vedmak.army;
const SC = await import("/systems/vedmak/module/config/settlement.mjs");
const until = async (test, ms = 4000) => { for (let t = 0; t < ms && !test(); t += 100) await wait(100); return test(); };
const bOf = (town, key) => town.system.buildingActors.find(b => b.system.key === key);
const mk = (key, st) => { const d = SC.buildingItemData(key); Object.assign(d.system, st); return d; };

const town = await Actor.create({ name: "Прогон: Вышгород", type: "settlement", folder: folder.id,
  system: { families: 8, militia: 30, stock: { "Еда": 80, "Топливо": 30, "Древесина": 40, "Железо": 20, "Доски": 10, "Камень": 20 } } });
await until(() => town.system.buildingActors.length === 3);
const hero = await Actor.create({ name: "Прогон: Кузнец Брасс", type: "character", folder: folder.id,
  system: { skills: { physique: { value: 6 }, leadership: { value: 8 }, crafting: { value: 5 } } } });

stepName("управляющий");
const lumber = bOf(town, "lumber");
const wood0 = town.system.forecast.produced["Древесина"];
await lumber.update({ "system.manager": hero.uuid }); await wait(300);
const lm = town.system.buildings.find(b => b.key === "lumber").manager;
ok(lm?.skill === "physique" && lm.dice === 2, `лесорубы: навык «Сила» 6 — 2d4 (${JSON.stringify(lm)})`);
ok(town.system.forecast.produced["Древесина"] === wood0 + 5, `к древесине в среднем +5 (${wood0} → ${town.system.forecast.produced["Древесина"]})`);
await hero.update({ "system.skills.physique.value": 9 }); await wait(300);
const lm2 = town.system.buildings.find(b => b.key === "lumber").manager;
ok(lm2?.dice === 3, `управляющий поднял Силу до 9 — поселение пересчиталось: 3d4 (${lm2?.dice})`);
await hero.update({ "system.skills.physique.value": 6 }); await wait(300);
const house = bOf(town, "house");
const c0 = town.system.summary.control;
await house.update({ "system.manager": hero.uuid }); await wait(300);
ok(town.system.summary.control === c0 + 2, "дом без выработки: Лидерство 8 — Контроль +2");
await house.update({ "system.manager": "" });
await lumber.sheet.render({ force: true }); await wait(400);
ok(lumber.sheet.element.querySelector(".bl-manager")?.textContent.includes("Кузнец Брасс"), "на листе постройки — управляющий");
await lumber.sheet.close();

stepName("заказ в мастерской");
await S.createBuildings(town, [mk("smithy", { level: 1, workers: 1 }), mk("tradepost", { level: 1 })]);
const smithy = bOf(town, "smithy");
const sword = await Item.create({ name: "Прогон: короткий меч", type: "weapon", folder: folder.id, system: { cost: 100 } });
const iron0 = town.system.stock["Железо"];
await S.placeOrder(town, smithy.id, sword, hero, 1);
ok(smithy.system.orders.length === 1 && town.system.stock["Железо"] === iron0 - 3, `заказ принят: железо ${iron0} → ${town.system.stock["Железо"]}`);
const shield = await Item.create({ name: "Прогон: щит", type: "armor", folder: folder.id, system: { cost: 50 } });
await S.placeOrder(town, smithy.id, shield, hero, 1);
ok(smithy.system.orders.length === 1, "кузница брони не делает — заказ не принят");

stepName("караван");
const town2 = await Actor.create({ name: "Прогон: Заречье", type: "settlement", folder: folder.id, system: { stock: { "Еда": 30 } } }, { vedmakStarter: false });
await S.addRoute(town, town2.uuid, "Древесина", 5);
ok(town.system.routes.length === 1, "караван в Заречье: древесина 5 в неделю");

stepName("неделя");
await S.advanceWeek(town); await wait(500);
ok(hero.items.some(i => i.name === "Прогон: короткий меч") && !smithy.system.orders.length, "заказ готов: меч у заказчика");
ok(town2.system.stock["Древесина"] === 5, `караван довёз древесину (${town2.system.stock["Древесина"]})`);
const card = game.messages.contents.at(-1)?.content ?? "";
ok(card.includes("Мастерские") && card.includes("Караваны"), "в карточке недели — мастерские и караваны");
ok(card.includes("управляющий"), "в карточке недели — бросок управляющего");

stepName("поход и осада");
const unit = await ARMY.recruit(town, { origin: "militia", count: 20, kind: "infantry", name: "Прогон: дружина" });
const food0 = town.system.stock["Еда"];
await ARMY.marchOut(unit, 2);
ok(unit.system.campaign && unit.system.supplies === 8 && town.system.stock["Еда"] === food0 - 8, `в поход: припасы 8, еда со склада (${food0} → ${town.system.stock["Еда"]})`);
await ARMY.besiege(unit, town2);
ok(town2.system.siege.units.includes(unit.uuid) && unit.system.besieging === town2.uuid, "Заречье в осаде");
ok(!town2.system.summary.trade && !town2.system.summary.arrival, "в осаде нет торговли и прихода семей");
await S.advanceWeek(town2); await wait(400);
ok(town2.system.siege.weeks === 1 && (game.messages.contents.at(-1)?.content ?? "").includes("осад"), "неделя осады: счёт и событие в карточке");
await S.advanceWeek(town); await wait(400);
ok(unit.system.supplies === 4, `в походе отряд ест припасы (${unit.system.supplies})`);
await ARMY.liftSiege(null, town2); await wait(300);
ok(!town2.system.siege.units.length && !unit.system.besieging, "ведущий снял осаду с листа поселения — у отряда отметки осады нет");
await ARMY.besiege(unit, town2); await wait(200);
await ARMY.returnHome(unit); await wait(300);
ok(!unit.system.campaign && !town2.system.siege.units.length, "домой: осада снята");

stepName("Совет правителя");
const council = game.vedmak.council.open(); await wait(600);
ok(council.element.querySelectorAll(".rc-town").length >= 2 && council.element.textContent.includes("Вышгород"), "в Совете — оба поселения");
ok(!!council.element.querySelector("[data-action=weekAll]"), "у ведущего — «Неделя для всех»");
await council.close();

for (const b of [...town.system.buildingActors, ...town2.system.buildingActors]) await b.delete();
for (const t of [town, town2]) await game.folders.find(x => x.getFlag("vedmak", "settlement") === t.uuid)?.delete();
for (const d of [unit, sword, shield, hero, town2, town]) if (d && (game.actors.get(d.id) || game.items.get(d.id))) await d.delete();
