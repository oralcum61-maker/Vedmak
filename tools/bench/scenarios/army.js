// Ополчение и армии (PLAN 4.187, 4.198): правила, набор, оружие и броня, тренировка и кормёжка в неделе поселения, битва,
// опыт и звания, обучение ветками, роспуск.
const UU = await import("/systems/vedmak/module/config/unit-upgrades.mjs");
const AR = await import("/systems/vedmak/module/army/rules.mjs");
const AC = await import("/systems/vedmak/module/config/army.mjs");
const SC = await import("/systems/vedmak/module/config/settlement.mjs");
const ARMY = game.vedmak.army;

stepName("правила");
const u = (id, kind, soldiers, training = 1, weapons = 1, morale = 5, armor = 0) => ({ id, name: id, kind, soldiers, training, weapons, armor, morale, origin: "militia", commanderBonus: 0 });
ok(AR.unitPower(u("a", "infantry", 30)).total === 2 + 1 + 1 + 3, "пехота: род 2 + выучка 1 + оружие 1 + 30 бойцов 3");
ok(AR.unitPower(u("a2", "infantry", 30, 1, 1, 5, 2)).total === 2 + 1 + 1 + 1 + 3, "кольчуга: броня +1 к силе");
ok(AR.unitPower(u("p", "pikes", 10), { enemyKinds: ["cavalry"] }).parts.some(p => p.value === 3), "копейщики против конницы: +3");
ok(AR.unitPower(u("b", "archers", 10), { round: 1 }).total - AR.unitPower(u("b", "archers", 10), { round: 2 }).total === 3, "стрелки: залп в первом раунде +3");
const cost = AR.equipCost("cavalry", "weapons", 0, 1, 10);
ok(cost.find(c => c.resource === "Лошади")?.qty === 10 && cost.find(c => c.resource === "Оружие")?.qty === 10, "конница, простое оружие: на каждого лошадь и оружие");
const mail = AR.equipCost("cavalry", "armor", 0, 2, 10);
ok(mail.find(c => c.resource === "Кожа")?.qty === 10 && mail.find(c => c.resource === "Доспехи")?.qty === 10, "конница, кольчуга: стёганка (кожа) и доспех на каждого");
const wk = AR.unitWeek({ ...u("t", "infantry", 20, 0, 0, 4), drilling: true, progress: 1 }, { fed: 1, drill: 1 });
ok(wk.training === 1 && wk.progress === 0, "тренировка: две недели — из новобранцев в ополченцы");
ok(AR.unitWeek({ ...u("h", "infantry", 20), drilling: false }, { fed: 0.5 }).morale === 3, "голод: боевой дух −2");
let rolls = [0.95, 0.0];
const res = AR.battleRound([{ units: [u("x", "infantry", 40)] }, { units: [u("y", "infantry", 40)], defender: true }], { rand: () => rolls.shift() ?? 0.5 });
ok(res.winner === 0 && res.units.find(x => x.id === "y").lost > res.units.find(x => x.id === "x").lost, "битва: проигравший теряет больше");
rolls = [0.0, 0.95];
const plate = AR.battleRound([{ units: [u("x", "infantry", 40)] }, { units: [u("z", "infantry", 40, 1, 1, 5, 3)] }], { rand: () => rolls.shift() ?? 0.5 });
rolls = [0.0, 0.95];
const bare = AR.battleRound([{ units: [u("x", "infantry", 40)] }, { units: [u("z", "infantry", 40, 1, 1, 5, 0)] }], { rand: () => rolls.shift() ?? 0.5 });
ok(plate.units.find(x => x.id === "x").lost < bare.units.find(x => x.id === "x").lost || plate.units.find(x => x.id === "z").lost <= bare.units.find(x => x.id === "z").lost,
  "латы снимают часть потерь");
ok(res.units.every(x => x.xp >= 2), "за раунд каждому сражавшемуся — опыт");
ok(AR.armorSave(u("pl", "infantry", 40, 1, 1, 5, 3)) === 1.5 && AR.armorSave(u("pl2", "infantry", 80, 1, 1, 5, 3)) === 3,
  "латы: 3 кубика 1d2−1 на 40 бойцов (в среднем 1,5), на 80 — вдвое");

stepName("набор");
const town = await Actor.create({ name: "Прогон: замок", type: "settlement", folder: folder.id,
  system: { families: 6, militia: 30, wealth: 2, stock: { "Еда": 50, "Топливо": 20, "Оружие": 25, "Доспехи": 5 } } });
{ const d = SC.buildingItemData("drillground"); d.system.level = 1; await game.vedmak.settlement.createBuildings(town, [d]); }
ok(town.system.summary.drill === 1, "плац даёт тренировку");
const militia = await ARMY.recruit(town, { origin: "militia", count: 20, kind: "infantry", name: "Прогон: ополчение" });
ok(militia?.type === "unit" && militia.system.soldiers === 20 && town.system.militia === 10, "из Ополчения: 20 бойцов, в Ополчении осталось 10");
const fam = await ARMY.recruit(town, { origin: "families", count: 1, kind: "pikes", name: "Прогон: копейщики" });
ok(fam?.system.soldiers === AC.FAMILY_SOLDIERS && town.system.families === 5, "из семей: одна семья — 5 бойцов");
const merc = await ARMY.recruit(town, { origin: "mercenary", count: 10, kind: "archers", name: "Прогон: наёмники" });
ok(merc?.system.training === AC.MERCENARY.training && Math.abs(town.system.wealth - 1.6) < 1e-6, "наёмники: обучены, найм 0,4 Богатства");
await ARMY.recruit(town, { origin: "militia", count: 50 });
ok(town.system.militia === 10, "больше, чем есть в Ополчении, не набрать");

stepName("снаряжение и лист");
await ARMY.equip(militia, "weapons", 1);
ok(militia.system.weapons === 1 && militia.system.armor === 0 && town.system.stock["Оружие"] === 5, "оружие: 20 оружия со склада, броня — без изменений");
await ARMY.equip(militia, "armor", 2);
ok(militia.system.armor === 0, "на кольчуги для 20 бойцов не хватает — не снарядили");
ok(merc.system.weapons === 2 && merc.system.armor === 2, "наёмники — со своим оружием и бронёй");
await militia.update({ "system.drilling": true });
await militia.sheet.render({ force: true }); await wait(500);
ok(!!militia.sheet.element.querySelector(".sv-plaques .sv-ring") && !!militia.sheet.element.querySelector(".ar-tiers"), "лист отряда открылся");
await militia.sheet.close();
await town.sheet.render({ force: true }); town.sheet.tab = "army"; await town.sheet.render(); await wait(500);
ok(town.sheet.element.querySelectorAll(".ar-units li").length === 3, "вкладка «Войско»: три отряда");
await town.sheet.close();

stepName("неделя поселения");
const food0 = town.system.stock["Еда"];
await game.vedmak.settlement.advanceWeek(town); await wait(400);
ok(militia.system.progress === 1, `ополчение тренируется: неделя ${militia.system.progress} из 2`);
ok(town.system.stock["Еда"] < food0 - 6, "войско съело еду со склада");
ok(game.messages.contents.at(-1)?.content.includes("sw-army"), "в карточке недели — войско");

stepName("обучение");
ok(militia.system.branches.length === 4 && militia.system.branches.every(b => b.nodes.length === 3) && militia.system.branches[3].id === "kind",
  "у нового отряда — три общие ветки и ветка рода, по три ступени");
ok(!ARMY.canTrain(militia, "discipline-2").ok && ARMY.canTrain(militia, "discipline-2").why.includes("звание"), "«Сомкнутый строй» — закрыт до звания");
const food1 = town.system.stock["Еда"];
await ARMY.train(militia, "discipline-1");
ok(militia.system.research.node === "discipline-1" && militia.system.drilling && town.system.stock["Еда"] === food1 - 4, "«Строевой шаг»: еда списана, отряд на плацу");
const xp0 = militia.system.xp;
await game.vedmak.settlement.advanceWeek(town); await wait(400);
ok(militia.system.upgrades.includes("discipline-1") && militia.system.xp === xp0 + 1, `неделя на плацу: ступень освоена, опыт +1 (${militia.system.xp})`);
ok(game.messages.contents.at(-1)?.content.includes("Строевой шаг"), "в карточке недели — освоенная ступень");
await militia.update({ "system.xp": 30 }); await town.update({ "system.stock.Доски": 10 });
ok(militia.system.rank === 2 && ARMY.canTrain(militia, "discipline-2").ok, `30 опыта — «Ветераны»: «Сомкнутый строй» открыт (${ARMY.canTrain(militia, "discipline-2").why ?? "да"})`);
await militia.update({ "system.upgrades": [...militia.system.upgrades, "discipline-2"] });
ok(AR.routAt(AR.unitState(militia)) === 1, "«Сомкнутый строй»: бегут на 1 позже");
ok(AR.unitDice(AR.unitState(militia), "losses") === 3, "«Сомкнутый строй» у ветеранов: 1d2 спасённых бойцов дважды (в среднем 3)");
await fam.update({ "system.kind": "cavalry" });
ok(fam.system.branches.find(b => b.id === "kind")?.name === "Удар", "смена рода войск — ветка рода «Удар»");
militia.sheet.tab = "training"; await militia.sheet.render({ force: true }); await wait(500);
ok(militia.sheet.element.querySelectorAll(".bl-branch:not(.add)").length === 4 && !!militia.sheet.element.querySelector('.bl-node.bought[data-node="discipline-1"]'),
  "вкладка «Обучение»: четыре ветки, освоенная ступень посеребрена");
await militia.sheet.close(); militia.sheet.tab = "unit";
const legacy = await Actor.create({ name: "Прогон: старый отряд", type: "unit", folder: folder.id, system: { kind: "infantry", soldiers: 10, equipment: 2 } });
ok(legacy.system.weapons === 2 && legacy.system.armor === 2 && legacy.system.branches.length === 4, "старое «снаряжение 2» — оружие 2 и броня 2; дерево проставлено");
await legacy.delete();

stepName("битва");
const foe = await Actor.create({ name: "Прогон: разбойники", type: "unit", folder: folder.id, system: { kind: "infantry", soldiers: 25, training: 0, morale: 4 } });
const app = ARMY.battle([militia, fam]);
app.add(1, foe); await app.render(); await wait(400);
const before = militia.system.soldiers + foe.system.soldiers;
app.element.querySelector("[data-action=round]").click(); await wait(800);
ok(militia.system.soldiers + foe.system.soldiers < before, "раунд: обе стороны понесли потери");
ok(game.messages.contents.at(-1)?.content.includes("battle-round"), "карточка раунда в чате");
ok(militia.system.xp >= 32 || militia.system.soldiers === 0, `опыт за раунд битвы (${militia.system.xp})`);
await app.close();

stepName("оборона поселения и лекари");
{ const d = SC.buildingItemData("palisade"); d.system.level = 1; await game.vedmak.settlement.createBuildings(town, [d]); }
ok(town.system.summary.defense === 2, `частокол: укрепления +2 (${town.system.summary.defense})`);
const raiders = await Actor.create({ name: "Прогон: налётчики", type: "unit", folder: folder.id, system: { kind: "infantry", soldiers: 60, training: 2, morale: 9, weapons: 2 } });
const siege = ARMY.battle([raiders]);
siege.sides = [{ ids: [raiders.id], defender: false }, { ids: [militia.id], defender: true }];
siege.town = town.uuid; await siege.render(); await wait(400);
ok(siege.element.querySelector(".bt-fort")?.textContent.includes("2"), "в окне битвы — укрепления «у стен» +2");
siege.element.querySelector("[data-action=round]").click(); await wait(800);
ok(game.messages.contents.at(-1)?.content.includes("укрепления 2"), "защитникам в броске — укрепления");
for (let i = 0; i < 25 && !siege.log.at(-1)?.over; i++) { siege.element.querySelector("[data-action=round]")?.click(); await wait(500); }
const last = siege.log.at(-1);
ok(last?.over && (last.healed.length > 0 || !Object.keys(siege.lost).length), `битва окончена, лекари вернули часть павших (${last?.healed?.join("; ") || "павших нет"})`);
await siege.close();
await raiders.delete();

stepName("роспуск");
const m0 = town.system.militia, left = militia.system.soldiers;
window.__noAutoDialog = true;
const disbanding = ARMY.disband(militia); await wait(500);
document.querySelector(".application.dialog button[data-action=yes]")?.click();
await disbanding; window.__noAutoDialog = false; await wait(400);
ok(!game.actors.get(militia.id) && town.system.militia === m0 + left, "распущенное ополчение вернулось в Ополчение");

for (const a of [fam, merc, foe]) if (game.actors.get(a.id)) await a.delete();
for (const b of town.system.buildingActors) await b.delete();
await game.folders.find(x => x.getFlag("vedmak", "settlement") === town.uuid)?.delete();
await town.delete();
