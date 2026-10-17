// Прокачка построек ветками (PLAN 4.198, кусок Б): эффекты ступеней в правилах недели, взятие ступени, стройка ступени
// семьями, вкладка «Обустройство» и правка дерева ведущим.
const S = game.vedmak.settlement;
const R = await import("/systems/vedmak/module/settlement/rules.mjs");
const SC = await import("/systems/vedmak/module/config/settlement.mjs");
const U = await import("/systems/vedmak/module/config/building-upgrades.mjs");
const st = (key, extra) => { const d = SC.buildingItemData(key); Object.assign(d.system, extra); return R.buildingState({ ...d, id: key + (extra.n ?? "") }); };
const until = async (test, ms = 4000) => { for (let t = 0; t < ms && !test(); t += 100) await wait(100); return test(); };

stepName("справочник");
const keys = Object.keys(SC.BUILDINGS);
const withTree = keys.filter(k => U.buildingTree(k).length >= 2);
ok(withTree.length === keys.length, `у всех ${keys.length} построек не меньше двух веток (${withTree.length})`);
const nodes = keys.flatMap(k => U.buildingTree(k).flatMap(b => b.nodes));
ok(nodes.length >= 150 && nodes.every(n => n.effects.length), `ступеней ${nodes.length}, у каждой есть эффект`);
ok(nodes.every(n => Object.keys(U.BUILDING_EFFECTS).includes(n.effects[0].type)), "типы эффектов — из общего набора");
const res = new Set(Object.keys(SC.RESOURCE_ICONS)); res.add("Богатство");
const unknown = [...new Set(nodes.flatMap(n => [...n.cost.map(c => c.resource), ...n.effects.map(e => e.resource).filter(Boolean)]).filter(r => !res.has(r)))];
ok(!unknown.length, `ресурсы ступеней известны складу${unknown.length ? ": " + unknown.join(", ") : ""}`);

stepName("эффекты в правилах");
const base = { year: 1, month: 4, week: 1, families: 4, approval: 5, control: 0, wealth: 0, taxes: "normal", stock: { "Еда": 30, "Топливо": 30, "Зерно": 30 } };
const plain = R.simulateWeek({ ...base, buildings: [st("lumber", { level: 1, workers: 2 })] }, { forecast: true }).report;
const axes = R.simulateWeek({ ...base, buildings: [st("lumber", { level: 1, workers: 2, upgrades: ["b1n1"] })] }, { forecast: true }).report;
ok(plain.produced["Древесина"] === 13.5 && axes.produced["Древесина"] === 15.5, `«Точильный круг»: +1d3 древесины за уровень (${plain.produced["Древесина"]} → ${axes.produced["Древесина"]})`);
const dist0 = R.simulateWeek({ ...base, buildings: [st("distillery", { level: 1, workers: 1 })] }, { forecast: true }).report;
const dist1 = R.simulateWeek({ ...base, buildings: [st("distillery", { level: 1, workers: 1, upgrades: ["b2n1"] })] }, { forecast: true }).report;
ok(dist1.consumed["Топливо"] < dist0.consumed["Топливо"], `«Кирпичная топка»: топлива меньше (${dist0.consumed["Топливо"]} → ${dist1.consumed["Топливо"]})`);
const garden = R.simulateWeek({ ...base, buildings: [st("house", { level: 1, upgrades: ["b2n1"] })] }, { forecast: true }).report;
ok(garden.produced["Еда"] === 1.5, `«Огород» у дома: новая выработка — еда 1d2 (${garden.produced["Еда"]})`);
const manor = st("manor", { level: 1 });
const t0 = R.summarize({ ...base, buildings: [manor, st("market", { level: 1 })] });
const t1 = R.summarize({ ...base, buildings: [manor, st("market", { level: 1, upgrades: ["b3n1"] })] });
ok(t1.taxMult === t0.taxMult + 0.1, `«Весы и меры»: налог ×${t0.taxMult} → ×${t1.taxMult}`);
ok(R.summarize({ ...base, buildings: [st("market", { level: 1, upgrades: ["b3n1"] })] }).taxMult === 0, "без усадьбы прибавка к налогу не работает");
const angry = { ...base, approval: 2 };
ok(R.summarize({ ...angry, buildings: [st("tavern", { level: 1, upgrades: ["b3n1"] })] }).revolt === Math.round(R.summarize(angry).revolt - 3.5), "«Вышибала»: шанс бунта −1d6 (в среднем −3,5)");
ok(R.summarize({ ...angry, buildings: [st("tavern", { level: 2, upgrades: ["b3n1"] })] }).revolt === Math.round(R.summarize(angry).revolt - 7), "2-й уровень таверны: −1d6 дважды");
const happy = { ...base, approval: 8 };
ok(R.summarize({ ...happy, buildings: [st("house", { level: 2, upgrades: ["b1n1", "b1n2"] })] }).arrival.chance === R.summarize({ ...happy, buildings: [st("house", { level: 2 })] }).arrival.chance + 14,
  "«Дымоход» у дома 2-го уровня: шанс прихода +2d6 дважды (в среднем +14)");
const axes2 = R.simulateWeek({ ...base, buildings: [st("lumber", { level: 2, workers: 2, upgrades: ["b1n1"] })] }, { forecast: true }).report;
const plain2 = R.simulateWeek({ ...base, buildings: [st("lumber", { level: 2, workers: 2 })] }, { forecast: true }).report;
ok(axes2.produced["Древесина"] - plain2.produced["Древесина"] === 4, "на 2-м уровне «Точильный круг» бросается дважды (+4 в среднем)");
const monthEnd = R.simulateWeek({ ...base, week: 4, approval: 5, buildings: [st("house", { level: 1, upgrades: ["b1n1"] })] }, { rand: () => 0.99 });
ok(monthEnd.next.approval === 6 && monthEnd.report.events.some(e => e.kind === "approval"), "«Глиняная печь»: в конце месяца одобрение +1");
ok(R.summarize({ ...base, buildings: [st("lumber", { level: 1, upgrades: ["b2n1"] })] }).workers !== undefined
  && R.activeLevel(st("lumber", { level: 1, upgrades: ["b2n1"] })).families === 4, "«Подсека»: рабочих мест 3 → 4");

{ // Новое сырьё и новое содержание от ступени (PLAN 4.256): строки встают в сырьё и содержание постройки
  const d = SC.buildingItemData("lumber");
  d.system.branches = [{ id: "x", name: "Прогон", icon: "fa-star", nodes: [{ id: "xn1", name: "Смолокурня", level: 1, requires: "", cost: [], weeks: 1,
    effects: [{ type: "consumeAdd", resource: "Зерно", formula: "2", per: "building", period: "week" },
      { type: "upkeepAdd", resource: "Топливо", formula: "3", per: "building", period: "week" },
      { type: "produceAdd", resource: "Еда", formula: "1", per: "building", period: "week" }] }] }];
  Object.assign(d.system, { level: 1, workers: 2, upgrades: ["xn1"] });
  const lv = R.activeLevel(R.buildingState({ ...d, id: "lx" }));
  ok(lv.consume.some(r => r.resource === "Зерно") && lv.upkeep.some(r => r.resource === "Топливо") && lv.produce.some(r => r.resource === "Еда"),
    "ступень: новое сырьё, новое содержание и новая выработка — в строках постройки");
  const was = R.simulateWeek({ ...base, buildings: [st("lumber", { level: 1, workers: 2 })] }, { forecast: true }).report;
  const now = R.simulateWeek({ ...base, buildings: [R.buildingState({ ...d, id: "lx" })] }, { forecast: true }).report;
  ok((now.consumed["Зерно"] ?? 0) - (was.consumed["Зерно"] ?? 0) === 2 && (now.consumed["Топливо"] ?? 0) - (was.consumed["Топливо"] ?? 0) === 3,
    `неделя: зерна +${(now.consumed["Зерно"] ?? 0) - (was.consumed["Зерно"] ?? 0)}, топлива +${(now.consumed["Топливо"] ?? 0) - (was.consumed["Топливо"] ?? 0)}`);
  ok(U.BUILDING_EFFECTS.consumeAdd?.kind === "row" && U.BUILDING_EFFECTS.upkeepAdd?.kind === "row", "в списке эффектов — «Новое сырьё» и «Новое содержание»");
}

stepName("взять ступень");
const town = await Actor.create({ name: "Прогон: прокачка", type: "settlement", folder: folder.id,
  system: { families: 6, stock: { "Еда": 40, "Топливо": 20, "Древесина": 30, "Камень": 20, "Инструменты": 10 } } });
await until(() => town.system.buildingActors.length === 3);
const lumber = town.system.buildingActors.find(b => b.system.key === "lumber");
ok(lumber.system.branches.length === 3 && lumber.system.branches[0].nodes[0].id === "b1n1", "у лагеря лесорубов — три ветки из справочника");
ok(!S.canResearch(town, lumber, "b1n2").ok && S.canResearch(town, lumber, "b1n2").why.includes("2-й уровень"), "«Стальные топоры» — закрыты до 2-го уровня");
await S.research(town, lumber.id, "b1n1");
ok(lumber.system.research.node === "b1n1" && town.system.stock["Камень"] === 17, "«Точильный круг» строится, камень списан");
ok(!S.canResearch(town, lumber, "b3n1").ok, "пока строится ступень, вторую не взять");
await S.advanceWeek(town); await wait(400);
ok(lumber.system.upgrades.includes("b1n1") && !lumber.system.research.node, "за неделю свободная семья достроила ступень");
ok(game.messages.contents.at(-1)?.content.includes("Точильный круг"), "в карточке недели — достроенная ступень");
await S.research(town, lumber.id, "b3n1");
ok(lumber.system.upgrades.includes("b1n1") && lumber.system.research.node === "b3n1", "«Хворост» (1 нед.) строится");

stepName("вкладка «Обустройство»");
const sheet = lumber.sheet; sheet.tab = "tree"; await sheet.render({ force: true }); await wait(500);
const el = () => sheet.element;
ok(el().querySelectorAll(".rs-branch").length === 3 && !!el().querySelector('.rs-node.bought[data-node="b1n1"]') && !!el().querySelector('.rs-node.work[data-node="b3n1"]'),
  "три ветки; взятая посеребрена, строящаяся — с полосой");
ok(el().querySelector('.rs-node[data-node="b1n2"]')?.classList.contains("locked") && el().querySelector('.rs-node[data-node="b1n2"] .rs-why')?.textContent.includes("уровень"), "закрытая — с причиной");
el().querySelector('.rs-node[data-node="b2n1"] [data-action=grant]')?.click(); await wait(500);
ok(lumber.system.upgrades.includes("b2n1"), "ведущий выдал «Подсеку» даром");
el().querySelector("[data-action=treeEdit]")?.click(); await wait(400);
ok(!!el().querySelector('input[name="system.branches.0.nodes.0.name"]'), "правка дерева: поля ступеней");
{ const v = el().querySelector('input[name="system.branches.0.nodes.0.effects.0.formula"]'); v.value = "1d6"; v.dispatchEvent(new Event("change", { bubbles: true })); await wait(500); }
ok(lumber.system.branches[0].nodes[0].effects[0].formula === "1d6" && lumber.system.branches[2].nodes.length === 3, "бросок эффекта изменён, остальное дерево цело");
el().querySelector('[data-action=treeAdd][data-kind=branch]')?.click(); await wait(500);
ok(lumber.system.branches.length === 4, "ведущий добавил ветку");
el().querySelector('[data-action=treeAdd][data-kind=node][data-path="system.branches.3.nodes"]')?.click(); await wait(500);
ok(lumber.system.branches[3].nodes.length === 1, "в новой ветке — ступень");
el().querySelector('[data-action=treeDel][data-path=branches][data-index="3"]')?.click(); await wait(500);
ok(lumber.system.branches.length === 3, "ветка убрана");
await sheet.close();

stepName("свой тип сооружения с прокачкой");
const own = await Actor.create({ name: "Прогон: мельница-самоделка", type: "building", folder: folder.id, system: { group: "food",
  levels: [{ weeks: 0, families: 1, produce: [{ resource: "Мука", formula: "2", per: "family" }] }],
  branches: [{ id: "x", name: "Жернова", nodes: [{ id: "x1", name: "Камень", level: 1, weeks: 0, cost: [], effects: [{ type: "produce", resource: "Мука", formula: "1d4" }] }] }] } });
const mill = await S.build(town, own.uuid);
await S.setWorkers(town, mill.id, 1);
await S.research(town, mill.id, "x1");
ok(mill.system.upgrades.includes("x1") && town.system.forecast.produced["Мука"] === 4.5, `своя постройка: ступень ведущего даёт +1d4 муки (${town.system.forecast.produced["Мука"]})`);

stepName("чертёж ступени: плюсики и пустые строки");
{ // PLAN 4.256: новая пустая строка видна сразу (редактор — по хранимой ступени), крестик убирает её же; «Создать актёра»
  const blank = await Actor.create({ name: "Прогон: постройка через «Создать актёра»", type: "building", folder: folder.id });
  ok(blank?.system.levels.length === 1 && blank.system.levels[0].weeks === 1 && Array.isArray(blank.system.levels[0].consume),
    `«Создать актёра»: постройка с одной ступенью по умолчанию (${blank?.system.levels.length})`);
  const sh = own.sheet; await sh.render({ force: true }); await wait(600);
  sh.element.querySelector("[data-action=editLevel]")?.click(); await wait(700);
  const rowsOf = list => list === "cost" ? sh.element.querySelectorAll(".bl-cost-row").length
    : [...sh.element.querySelectorAll(".bl-group")].find(g => g.querySelector(`[data-action=blAdd][data-list="${list}"]`))?.querySelectorAll("tbody tr").length ?? 0;
  const seen = {};
  for (const list of ["cost", "consume", "produce", "upkeep"]) {
    const n0 = rowsOf(list);
    sh.element.querySelector(`[data-action=blAdd][data-list="${list}"]`)?.click(); await wait(700);
    seen[list] = `${n0}→${rowsOf(list)}`;
  }
  ok(Object.values(seen).every(s => { const [x, y] = s.split("→").map(Number); return y === x + 1; }), `плюсики: новая строка видна сразу (${JSON.stringify(seen)})`);
  // Ресурс в новой строке сырья и крестик у пустой строки выработки: уходит именно она
  const consumeIn = [...sh.element.querySelectorAll('input[name^="system.levels.0.consume."][name$=".resource"]')].at(-1);
  consumeIn.value = "Зерно"; consumeIn.dispatchEvent(new Event("change", { bubbles: true })); await wait(800);
  ok(own._source.system.levels[0].consume.some(r => r.resource === "Зерно"), "ресурс вписан в новую строку сырья");
  const prod0 = own._source.system.levels[0].produce.map(r => r.resource);
  const xs = [...sh.element.querySelectorAll('[data-action=blDelete][data-list="produce"]')];
  xs.at(-1)?.click(); await wait(700);
  ok(JSON.stringify(own._source.system.levels[0].produce.map(r => r.resource)) === JSON.stringify(prod0.slice(0, -1)), `крестик убрал свою строку (${prod0.join(", ")} → ${own._source.system.levels[0].produce.map(r => r.resource).join(", ")})`);
  await sh.close();
  // Проверка мира: пустые строки ступеней находятся и убираются
  const found = game.vedmak.worldCheck.scanWorld().filter(p => p.actor === own && /пустых строк/.test(p.text));
  ok(found.length === 1, `проверка мира: ${found[0]?.text ?? "пустые строки не найдены"}`);
  await game.vedmak.worldCheck.repairWorld(found);
  const lv0 = own._source.system.levels[0];
  ok(["cost", "consume", "produce", "upkeep"].every(k => (lv0[k] ?? []).every(r => String(r.resource).trim())) && lv0.consume.some(r => r.resource === "Зерно"),
    "после починки пустых строк нет, заполненные на месте");
  await blank.delete();
}

for (const b of town.system.buildingActors) await b.delete();
await game.folders.find(x => x.getFlag("vedmak", "settlement") === town.uuid)?.delete();
await own.delete();
await town.delete();
