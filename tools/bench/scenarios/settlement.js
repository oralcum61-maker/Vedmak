// Поселение (PLAN 4.183, 4.185, 4.198): правила журнала мира manorlords, уровни построек, налог, склад, торговля, своя
// постройка; постройки — актёры поселения, перенос старых предметов «Постройка».
const BM = await import("/systems/vedmak/module/settlement/buildings.mjs");
const bOf = (town, key) => town.system.buildingActors.find(b => b.system.key === key);
const until = async (test, ms = 4000) => { for (let t = 0; t < ms && !test(); t += 100) await wait(100); return test(); };
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
await until(() => town.system.buildingActors.length === 3);
const townFolder = game.folders.find(x => x.getFlag("vedmak", "settlement") === town.uuid);
ok(town.system.buildingActors.length === 3 && town.img.includes("house-manor") && town.system.buildingActors.every(b => b.folder === townFolder),
  "новое поселение: два дома и лесорубы — актёры «Постройка» в папке поселения");
ok(townFolder?.folder?.id === folder.id && town.system.summary.houses === 2, "папка построек — внутри папки поселения; сводка видит дома");
const sheet = town.sheet; await sheet.render({ force: true }); await wait(500);
ok(!!sheet.element.querySelector(".rs-stats .rs-medal.arc") && !!sheet.element.querySelector(".rs-stock .rs-res"), "лист открылся: пластины, кольцо одобрения, склад");
await town.update({ "system.stock.Древесина": 40, "system.stock.Камень": 30 });
await S.build(town, "manor");
const manor = bOf(town, "manor");
ok(manor?.system.constructing && town.system.stock["Древесина"] === 25 && town.system.stock["Камень"] === 20, "усадьба заложена, древесина и камень списаны");
await S.build(town, "manor");
ok(town.system.buildingActors.filter(b => b.system.key === "manor").length === 1, "вторую усадьбу не заложить");
ok(manor?.ownership.default === town.ownership.default && manor.prototypeToken.actorLink, "права постройки — как у поселения, жетон связан с актёром");
ok(town.system.summary.taxMult === 0 && town.system.forecast.taxWealth === 0, "пока усадьба строится, налога нет");
await manor.update({ "system.level": 1, "system.constructing": false });
await town.update({ "system.taxes": "normal" });
ok(town.system.summary.taxCoins === town.system.families * 10, `с усадьбой обычный налог — 10 монет с семьи (${town.system.summary.taxCoins})`);

stepName("уровни, семьи, склад");
const lumber = bOf(town, "lumber");
await S.setWorkers(town, lumber.id, 9);
ok(town.system.summary.workers[lumber.id] === Math.min(3, town.system.families), "семей на работе не больше мест и семей");
await S.upgrade(town, lumber.id);
ok(lumber.system.constructing && town.system.stock["Камень"] === 18, "лесорубы улучшаются: цена второго уровня списана");
await S.build(town, "storehouse");
const store = bOf(town, "storehouse");
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
{ const d = SC.buildingItemData("tradepost"); d.system.level = 1; await S.createBuildings(town, [d]); }
const wood0 = town.system.stock["Древесина"];
await S.trade(town, "Древесина", 5, "sell");
ok(town.system.stock["Древесина"] === wood0 - 5 && Math.abs(town.system.wealth - w0 - 15 / SC.WEALTH_RATE) < 1e-6, "продано 5 древесины: 15 монет — в Богатство по курсу");
// Свой тип сооружения: актёр-постройка без поселения — образец каталога
const herb = await Actor.create({ name: "Прогон: хата травника", type: "building", folder: folder.id, system: { group: "food",
  levels: [{ cost: [{ resource: "Древесина", qty: 2 }], weeks: 0, families: 1,
    produce: [{ resource: "Мандрагора", formula: "1d6", per: "family", noWinter: true }] }] } });
await herb.sheet.render({ force: true }); await wait(400);
ok(!!herb.sheet.element.querySelector(".rs-flow .rs-side:last-child .rs-chip") && herb.sheet.element.querySelectorAll(".rs-steps .rs-step:not(.add)").length === 1,
  "лист постройки: линия выработки и лестница из одной ступени");
herb.sheet.element.querySelector(".rs-step [data-action=editLevel]")?.click(); await wait(400);
ok(!!herb.sheet.element.querySelector(".bl-blueprint .bl-rows input[name='system.levels.0.produce.0.formula']"), "«Править» раскрывает чертёж ступени со строками выработки");
{ const input = herb.sheet.element.querySelector("input[name='system.levels.0.produce.0.formula']");
  input.value = "1d6+1"; input.dispatchEvent(new Event("change", { bubbles: true })); await wait(500); }
ok(herb.system.levels[0].produce[0].formula === "1d6+1" && herb.system.levels[0].produce[0].noWinter, "правка выработки на листе сохраняется, прочие поля строки целы");
herb.sheet.element.querySelector("[data-action=blLevelAdd]")?.click(); await wait(500);
ok(herb.system.levels.length === 2 && herb.sheet.editing === 1, "«+ Ступень» — вторая ступень, её чертёж открыт");
{ const w = herb.sheet.element.querySelector("input[name='system.levels.1.weeks']"); w.value = "5"; w.dispatchEvent(new Event("change", { bubbles: true })); await wait(500); }
ok(herb.system.levels[1].weeks === 5 && herb.system.levels[0].produce[0].formula === "1d6+1", "правка второй ступени не трогает первую");
await herb.update({ "system.levels": [{ ...herb._source.system.levels[0], produce: [{ ...herb._source.system.levels[0].produce[0], formula: "1d6" }] }] });
await herb.sheet.close();
await town.sheet.render({ force: true }); town.sheet.tab = "buildings"; town.sheet.showCatalog = true; await town.sheet.render(); await wait(400);
ok(!!town.sheet.element.querySelector(`[data-action=build][data-src="${herb.uuid}"]`), "образец ведущего — в каталоге листа поселения");
await town.update({ "system.families": 12 });
const hut = await S.build(town, herb.uuid);
ok(hut?.system.level === 1 && !hut.system.constructing, "своя постройка без срока стройки готова сразу");
await S.setWorkers(town, hut.id, 1);
ok(town.system.forecast.produced["Мандрагора"] === 3.5, `своя постройка даёт свой ресурс: Мандрагора ≈ ${town.system.forecast.produced["Мандрагора"]}`);
await herb.delete();

stepName("перенос старых предметов");
// Поселение со старыми вложенными предметами «Постройка» и образец-предмет мира — перенос делает ведущий при загрузке
const old = await Actor.create({ name: "Прогон: Старое поселение", type: "settlement", folder: folder.id }, { vedmakStarter: false });
const mk = (key, st) => { const d = SC.buildingItemData(key); Object.assign(d.system, st); return d; };
// Порядок на листе задаёт sort (у созданных одним вызовом он одинаковый — порядок коллекции не определён)
await old.createEmbeddedDocuments("Item", [mk("house", { level: 2 }), mk("lumber", { level: 1, workers: 2 }), mk("manor", { level: 0, constructing: true, progress: 3 })]
  .map((d, i) => ({ ...d, sort: (i + 1) * CONST.SORT_INTEGER_DENSITY })));
const oldItem = await Item.create({ name: "Прогон: старый образец", type: "building", system: { group: "food", levels: [{ weeks: 2, families: 1 }] } });
const moved = await BM.migrateBuildingItems();
const ob = old.system.buildingActors;
ok(moved >= 4 && old.items.filter(i => i.type === "building").length === 0 && !game.items.get(oldItem.id), `перенесено ${moved}: предметов не осталось`);
ok(ob.map(b => b.system.key).join() === "house,lumber,manor", `порядок построек тот же (${ob.map(b => b.system.key).join(", ")})`);
ok(ob[0].system.level === 2 && ob[1].system.workers === 2 && ob[2].system.constructing && ob[2].system.progress === 3, "уровень, работники и стройка сохранились");
const sample = game.actors.find(a => a.type === "building" && a.name === "Прогон: старый образец");
ok(sample && !sample.system.settlement && sample.folder?.name === "Каталог построек", "образец-предмет мира стал образцом каталога");
ok(await BM.migrateBuildingItems() === 0, "повторный перенос ничего не делает");
for (const a of [...ob, sample].filter(Boolean)) await a.delete();
await game.folders.find(x => x.getFlag("vedmak", "settlement") === old.uuid)?.delete();
if (sample?.folder && !sample.folder.contents?.length) await sample.folder.delete?.();
await old.delete();

stepName("склад: добавить и убрать ресурс");
// Щелчками, как ведущий; удаление ключа — значением _del (старый «-=имя» в v14 устарел и обрывал обновление)
// Строгая совместимость: устаревший вызов не предупреждает, а обрывает обновление — как в мире автора
const compat = CONFIG.compatibility.mode; CONFIG.compatibility.mode = CONST.COMPATIBILITY_MODES.FAILURE;
sheet.tab = "economy"; await sheet.render(); await wait(400);
sheet.element.querySelector(".rs-new-res").value = "Прогон-ресурс"; sheet.element.querySelector(".rs-new-qty").value = "3";
sheet.element.querySelector("[data-action=addResource]").click(); await wait(500);
ok(town.system.stock["Прогон-ресурс"] === 3, "«Добавить» кладёт новый ресурс на склад");
sheet.element.querySelector(`[data-action=removeResource][data-name="Прогон-ресурс"]`)?.click(); await wait(500);
ok(!("Прогон-ресурс" in town.system.stock) && !("Прогон-ресурс" in town._source.system.stock), "«×» убирает ресурс со склада");
CONFIG.compatibility.mode = compat;

stepName("вкладки листа");
// Настоящий щелчок: обработчик действия вызывает ядро (раньше «tab» перехватывало оно и падало без data-group)
for (const id of ["army", "buildings", "economy"]) {
  sheet.element.querySelector(`nav [data-tab="${id}"]`)?.click(); await wait(300);
  ok(sheet.tab === id && !!sheet.element.querySelector(`nav [data-tab="${id}"].on`), `вкладка «${id}» открывается щелчком`);
}

stepName("караван и «Торговать по»");
// Лист по холсту (PLAN 4.230) сменил классы полей — код листа искал старые: караван не добавлялся, «−/+» молчали
{
  const other = await Actor.create({ name: "Прогон: Гарвена", type: "settlement", folder: folder.id }, { vedmakStarter: false });
  sheet.tab = "economy"; await sheet.render(); await wait(400);
  const el = sheet.element;
  const to = el.querySelector(".rs-route-to");
  ok(!!to, "форма каравана на листе");
  if (to) {
    to.value = other.uuid;
    el.querySelector(".rs-route-res").value = "Еда";
    el.querySelector(".rs-route-qty").value = "4";
    el.querySelector("[data-action=addRoute]").click(); await wait(500);
    ok(town.system.routes.length === 1 && town.system.routes[0].to === other.uuid && town.system.routes[0].qty === 4, "«Отправлять» добавляет караван");
  }
  const plus = sheet.element.querySelector('[data-action=tradeStep][data-delta="1"]');
  if (plus) {
    const q0 = sheet.tradeQty;
    plus.click(); await wait(400);
    ok(sheet.tradeQty === q0 + 1 && sheet.element.querySelector(".rs-mini-step output")?.textContent.trim() === String(q0 + 1), `«+» у «Торговать по»: ${q0} → ${sheet.tradeQty}`);
  }
  await other.delete();
}

stepName("горячие клавиши");
{ // ← / → на вкладке и Alt+цифра (PLAN 4.245)
  sheet.tab = "economy"; await sheet.render(); await wait(400);
  const tab = sheet.element.querySelector('.rs-tabs [data-tab="economy"]');
  tab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true })); await wait(500);
  ok(sheet.tab === "buildings", `клавиши: → на вкладке — следующая (${sheet.tab})`);
  sheet.element.querySelector(".rs-scroll").dispatchEvent(new KeyboardEvent("keydown", { key: "4", code: "Digit4", altKey: true, bubbles: true })); await wait(500);
  ok(sheet.tab === "chronicle", `клавиши: Alt+4 — четвёртая вкладка (${sheet.tab})`);
  ok(sheet.element.contains(document.activeElement) && document.activeElement?.dataset?.tab === "chronicle", `клавиши: фокус на выбранной вкладке (${document.activeElement?.dataset?.tab ?? document.activeElement?.tagName})`);
}

stepName("управляющий перетаскиванием");
{ // Персонаж на карточку постройки на листе поселения — управляющий этой постройки (PLAN 4.244)
  const hero = await Actor.create({ name: "Прогон: управляющий", type: "character", folder: folder.id });
  sheet.tab = "buildings"; await sheet.render(); await wait(400);
  const card = sheet.element.querySelector(".rs-bcard[data-id]");
  const b = game.actors.get(card?.dataset.id);
  await sheet._onDropActor({ target: card.querySelector("b") ?? card }, hero); await wait(300);
  ok(b?.system.manager === hero.uuid, `перетаскивание: «${hero.name}» — управляющий «${b?.name}»`);
  await b?.update({ "system.manager": "" });
  await hero.delete();
}

stepName("отмена недели");
{
  // Ход недели и отмена (PLAN 4.240): склад, казна, календарь, семьи, стройки — как до хода; карточка недели убрана
  const pick = () => JSON.stringify({ s: town.system.toObject().stock, w: town.system.wealth, cal: [town.system.year, town.system.month, town.system.week],
    f: town.system.families, a: town.system.approval, log: town.system.log.length,
    b: town.system.buildingActors.map(b => [b.id, b.system.level, b.system.constructing, b.system.progress]).sort() });
  const before = pick();
  const msgs = game.messages.size;
  const D = foundry.applications.api.DialogV2; const c = D.confirm; D.confirm = async () => true;
  try {
    await S.advanceWeek(town); await wait(400);
    ok(pick() !== before && !!S.lastWeek(town), "отмена: неделя прошла и запомнена");
    await S.undoWeek(town); await wait(400);
  } finally { D.confirm = c; }
  ok(pick() === before, `отмена: поселение как до хода (склад, казна, календарь, семьи, стройки, летопись)${pick() === before ? "" : ` — было ${before}, стало ${pick()}`}`);
  ok(game.messages.size === msgs, `отмена: карточки недели убраны (${msgs} → ${game.messages.size})`);
  ok(!S.lastWeek(town), "отмена: второй раз отменять нечего");
}

await sheet.close();
for (const b of town.system.buildingActors) await b.delete();
await townFolder?.delete();
await town.delete();
