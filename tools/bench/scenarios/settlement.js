// Поселение (PLAN 4.183, 4.185): правила журнала мира manorlords, уровни построек, налог, склад, торговля, своя постройка.
const S = game.vedmak.settlement;
const R = await import("/systems/vedmak/module/settlement/rules.mjs");
const SC = await import("/systems/vedmak/module/config/settlement.mjs");
const tpl = (key, extra) => { const d = SC.buildingItemData(key); Object.assign(d.system, extra); return R.buildingState({ ...d, id: key }); };

stepName("формулы и правила журнала");
ok(R.averageOf("1d6+3") === 6.5 && R.averageOf("1d4+1") === 3.5 && R.parseFormula("абв").length === 0, "формулы: среднее 1d6+3 — 6,5, неверная — 0");
ok(SC.revoltChance(3) === 25 && SC.revoltChance(0) === 100 && SC.revoltChance(2, 2) === 40 && SC.revoltChance(5) === 0, "бунт: 3 — 25%, 0 — 100%, Контроль 2 снимает 10%");
const base = { year: 1, month: 4, week: 1, families: 3, approval: 5, control: 0, wealth: 0, taxes: "low",
  stock: { "Еда": 10, "Топливо": 10, "Древесина": 0 },
  buildings: [tpl("house", { level: 1 }), tpl("house", { level: 1 }), tpl("house", { level: 1 }), tpl("lumber", { level: 1, workers: 2 }), tpl("hunters", { level: 1, workers: 1 })] };
const fc = R.simulateWeek(base, { forecast: true }).report;
ok(fc.produced["Древесина"] === 13.5, `лесорубы: 1d6+3 и 1d6 за каждую из 2 семей — в среднем 13,5 (${fc.produced["Древесина"]})`);
ok(fc.produced["Шкуры"] === fc.produced["Еда"] && fc.produced["Кости"] === 3.5, "охотники: шкур и костей столько же, сколько еды");
ok(fc.needs["Еда"].need === 3 && fc.needs["Топливо"].need === 3, "три семьи: 3 еды и 3 топлива в неделю");
const winter = R.simulateWeek({ ...base, month: 1 }, { forecast: true }).report;
ok(winter.needs["Топливо"].need === 6, "зимой топлива вдвое");
const homeless = R.summarize({ ...base, families: 5, approval: 8 });
ok(homeless.homeless === 2 && homeless.arrival.chance === 40, "5 семей на 3 дома — 2 бездомных; одобрение 8 — шанс прихода 40%");
const monthEnd = R.simulateWeek({ ...base, families: 5, approval: 8, week: 4 }).report;
ok(monthEnd.events.some(e => e.text.includes("пока есть бездомные")) && monthEnd.arrived === 0, "пока есть бездомные, новые семьи не приходят");

stepName("сырьё и цепочки");
const dist = { ...base, families: 5, stock: { "Еда": 10, "Топливо": 10 }, buildings: [tpl("distillery", { level: 1, workers: 1 })] };
ok(!R.simulateWeek(dist, { forecast: true }).report.produced["Водка"], "без зерна винокурня стоит");
const chain = { ...dist, buildings: [tpl("farm", { level: 1, workers: 2 }), tpl("distillery", { level: 1, workers: 1 }), tpl("brewery", { level: 1, workers: 1 }), tpl("tavern", { level: 1, workers: 1 })] };
const cr = R.simulateWeek(chain, { forecast: true }).report;
ok(cr.produced["Водка"] === 2.5 && cr.consumed["Зерно"] === 7, `зерно фермы этой же недели идёт в винокурню и пивоварню (водка ${cr.produced["Водка"]}, зерна взято ${cr.consumed["Зерно"]})`);
ok(cr.produced["Богатство"] === 0.1, "таверна: 2 пива — 0,1 Богатства");
ok(R.summarize({ ...base, buildings: [tpl("barracks", { level: 1, workers: 2 })] }).control === 2, "казарма: Контроль за каждую семью стражи");
ok(Object.keys(SC.BUILDINGS).length >= 30 && SC.BUILDINGS.distillery, `в справочнике ${Object.keys(SC.BUILDINGS).length} построек, есть винокурня`);

stepName("лист и стройка");
const town = await Actor.create({ name: "Прогон: Липов", type: "settlement", folder: folder.id });
ok(town.itemTypes.building.length === 3 && town.img.includes("house-manor"), "новое поселение: два дома и лесорубы — предметы «Постройка»");
const sheet = town.sheet; await sheet.render({ force: true }); await wait(500);
ok(!!sheet.element.querySelector(".sv-plaques .sv-ring") && !!sheet.element.querySelector(".sv-res"), "лист открылся: пластины, кольцо одобрения, склад");
await town.update({ "system.stock.Древесина": 40, "system.stock.Камень": 30 });
await S.build(town, "manor");
const manor = town.items.find(i => i.system.key === "manor");
ok(manor?.system.constructing && town.system.stock["Древесина"] === 25 && town.system.stock["Камень"] === 20, "усадьба заложена, древесина и камень списаны");
await S.build(town, "manor");
ok(town.itemTypes.building.filter(i => i.system.key === "manor").length === 1, "вторую усадьбу не заложить");
ok(town.system.summary.taxMult === 0 && town.system.forecast.taxWealth === 0, "пока усадьба строится, налога нет");
await manor.update({ "system.level": 1, "system.constructing": false });
await town.update({ "system.taxes": "normal" });
ok(town.system.summary.taxCoins === town.system.families * 10, `с усадьбой обычный налог — 10 монет с семьи (${town.system.summary.taxCoins})`);

stepName("уровни, семьи, склад");
const lumber = town.items.find(i => i.system.key === "lumber");
await S.setWorkers(town, lumber.id, 9);
ok(town.system.summary.workers[lumber.id] === Math.min(3, town.system.families), "семей на работе не больше мест и семей");
await S.upgrade(town, lumber.id);
ok(lumber.system.constructing && town.system.stock["Камень"] === 18, "лесорубы улучшаются: цена второго уровня списана");
await S.build(town, "storehouse");
const store = town.items.find(i => i.system.key === "storehouse");
await store.update({ "system.level": 1, "system.constructing": false });
ok(town.system.summary.storage === SC.BASE_STORAGE + 60, `склад: вместимость ${town.system.summary.storage}`);
const before = town.system.year * 100 + town.system.month * 10 + town.system.week;
await S.advanceWeek(town); await wait(300);
ok(town.system.year * 100 + town.system.month * 10 + town.system.week > before && town.system.log.length === 1, "неделя прошла, в летописи запись");
ok(game.messages.contents.at(-1)?.content.includes("settlement-week"), "карточка недели в чате");

stepName("торговля и своя постройка");
const w0 = town.system.wealth;
await S.trade(town, "Древесина", 5, "sell");
ok(town.system.wealth === w0, "без торгового поста торговли нет");
{ const d = SC.buildingItemData("tradepost"); d.system.level = 1; await town.createEmbeddedDocuments("Item", [d]); }
const wood0 = town.system.stock["Древесина"];
await S.trade(town, "Древесина", 5, "sell");
ok(town.system.stock["Древесина"] === wood0 - 5 && Math.abs(town.system.wealth - w0 - 15 / SC.WEALTH_RATE) < 1e-6, "продано 5 древесины: 15 монет — в Богатство по курсу");
const herb = await Item.create({ name: "Прогон: хата травника", type: "building", system: { group: "food",
  levels: [{ cost: [{ resource: "Древесина", qty: 2 }], weeks: 0, families: 1,
    produce: [{ resource: "Мандрагора", formula: "1d6", per: "family", noWinter: true }] }] } });
await herb.sheet.render({ force: true }); await wait(400);
ok(!!herb.sheet.element.querySelector(".building-details .bl-rows input[name='system.levels.0.produce.0.formula']"), "лист постройки: строки выработки уровня");
await herb.sheet.close();
await town.update({ "system.families": 12 });
const hut = await S.build(town, herb.uuid);
ok(hut?.system.level === 1 && !hut.system.constructing, "своя постройка без срока стройки готова сразу");
await S.setWorkers(town, hut.id, 1);
ok(town.system.forecast.produced["Мандрагора"] === 3.5, `своя постройка даёт свой ресурс: Мандрагора ≈ ${town.system.forecast.produced["Мандрагора"]}`);
await herb.delete();

stepName("вкладки листа");
// Настоящий щелчок: обработчик действия вызывает ядро (раньше «tab» перехватывало оно и падало без data-group)
for (const id of ["army", "buildings", "economy"]) {
  sheet.element.querySelector(`nav [data-tab="${id}"]`)?.click(); await wait(300);
  ok(sheet.tab === id && !!sheet.element.querySelector(`nav [data-tab="${id}"].active`), `вкладка «${id}» открывается щелчком`);
}

await sheet.close();
await town.delete();
