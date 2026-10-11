// Поселение (PLAN 4.183): лист, стройка, работники, неделя, налоги, торговля, казна в валюте мира.
const S = game.vedmak.settlement;
const R = await import("/systems/vedmak/module/settlement/rules.mjs");

stepName("правила недели");
const base = { week: 14, families: 4, money: 50, taxes: "low", stock: { food: 10, fuel: 5, wood: 10, stone: 0, iron: 0, goods: 0 },
  buildings: [{ id: "a", key: "burgage", level: 2 }, { id: "f", key: "farm", level: 1, workers: 2 }, { id: "w", key: "well", level: 1 }] };
const { report } = R.simulateWeek(base);
ok(report.produced.food === 8, `ферма летом: 2 работника × 4 = 8 еды (${report.produced.food})`);
ok(report.needs.food.need === 4 && report.needs.food.got === 4, "четыре семьи съели 4 еды");
ok(report.approvalParts.some(p => p.label === "Колодец" && p.value === 5), "колодец даёт +5 к одобрению");
ok(report.taxes === 0, "без усадьбы налогов нет");
const winter = R.simulateWeek({ ...base, week: 45 }).report;
ok(winter.produced.food === 0 && winter.needs.fuel.need === 8, "зимой поля пусты, дров нужно вдвое");

stepName("лист и стройка");
const town = await Actor.create({ name: "Прогон: Липов", type: "settlement", folder: folder.id });
ok(town.system.buildings.length === 3 && town.img.includes("house-manor"), "новое поселение: три постройки и герб");
const sheet = town.sheet; await sheet.render({ force: true }); await wait(500);
ok(!!sheet.element.querySelector(".sv-plaques .sv-ring"), "лист открылся: плашки и кольцо одобрения");
await town.update({ "system.stock.wood": 20, "system.stock.stone": 20, "system.money": 200 });
await S.build(town, "manor");
const manor = town.system.buildings.find(b => b.key === "manor");
ok(manor?.constructing && town.system.stock.wood === 10 && town.system.money === 100, "усадьба заложена, цена списана");
await S.build(town, "manor");
ok(town.system.buildings.filter(b => b.key === "manor").length === 1, "вторую усадьбу не заложить");

stepName("работники и неделя");
const logging = town.system.buildings.find(b => b.key === "logging");
await S.setWorkers(town, logging.id, 5);
ok(town.system.summary.workers[logging.id] === 1, `работников не больше свободных семей: 2 семьи, одна у собирателей (${town.system.summary.workers[logging.id]})`);
await S.setWorkers(town, logging.id, 1);
const before = town.system.week;
const r1 = await S.advanceWeek(town); await wait(300);
ok(town.system.week === before + 1 && town.system.log.length === 1, "неделя прошла, в летописи запись");
ok(r1.builders >= 0 && game.messages.contents.at(-1)?.content.includes("settlement-week"), "карточка недели в чате");
await town.update({ "system.buildings": town.system.toObject().buildings.map(b => b.key === "manor" ? { ...b, level: 1, constructing: false } : b), "system.taxes": "normal" });
ok(town.system.summary.taxMult === 1 && town.system.forecast.taxes === town.system.families * 2, "с усадьбой обычный налог — 2 кроны с семьи");

stepName("торговля и казна");
await S.trade(town, "wood", 5, "sell");
ok(town.system.money === 100, "без торгового поста торговли нет");
await town.update({ "system.buildings": [...town.system.toObject().buildings, { id: "tp", key: "tradepost", name: "Торговый пост", level: 1 }] });
const money0 = town.system.money, wood0 = town.system.stock.wood;
await S.trade(town, "wood", 5, "sell");
ok(town.system.money === money0 + 10 && town.system.stock.wood === wood0 - 5, "продано 5 дерева по 2 кроны");
const old = foundry.utils.deepClone(game.settings.get("vedmak", "currencies"));
await game.settings.set("vedmak", "currencies", { ...old, world: "florens" });
const { worldLabel } = await import("/systems/vedmak/module/config/money.mjs");
ok(worldLabel(30) === "10 фл.", `казна в валюте мира: 30 крон — ${worldLabel(30)}`);
await game.settings.set("vedmak", "currencies", old);

await sheet.close();
await town.delete();
