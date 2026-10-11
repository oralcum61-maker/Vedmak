// Ополчение и армии (PLAN 4.187): правила, набор, снаряжение, тренировка и кормёжка в неделе поселения, битва, роспуск.
const AR = await import("/systems/vedmak/module/army/rules.mjs");
const AC = await import("/systems/vedmak/module/config/army.mjs");
const SC = await import("/systems/vedmak/module/config/settlement.mjs");
const ARMY = game.vedmak.army;

stepName("правила");
const u = (id, kind, soldiers, training = 1, equipment = 1, morale = 5) => ({ id, name: id, kind, soldiers, training, equipment, morale, origin: "militia", commanderBonus: 0 });
ok(AR.unitPower(u("a", "infantry", 30)).total === 2 + 1 + 1 + 3, "пехота: род 2 + выучка 1 + снаряжение 1 + 30 бойцов 3");
ok(AR.unitPower(u("p", "pikes", 10), { enemyKinds: ["cavalry"] }).parts.some(p => p.value === 3), "копейщики против конницы: +3");
ok(AR.unitPower(u("b", "archers", 10), { round: 1 }).total - AR.unitPower(u("b", "archers", 10), { round: 2 }).total === 3, "стрелки: залп в первом раунде +3");
const cost = AR.equipCost("cavalry", 0, 2, 10);
ok(cost.find(c => c.resource === "Лошади")?.qty === 10 && cost.find(c => c.resource === "Доспехи")?.qty === 10, "конница до среднего: на каждого лошадь, оружие и доспех");
const wk = AR.unitWeek({ ...u("t", "infantry", 20, 0, 0, 4), drilling: true, progress: 1 }, { fed: 1, drill: 1 });
ok(wk.training === 1 && wk.progress === 0, "тренировка: две недели — из новобранцев в ополченцы");
ok(AR.unitWeek({ ...u("h", "infantry", 20), drilling: false }, { fed: 0.5 }).morale === 3, "голод: боевой дух −2");
let rolls = [0.95, 0.0];
const res = AR.battleRound([{ units: [u("x", "infantry", 40)] }, { units: [u("y", "infantry", 40)], defender: true }], { rand: () => rolls.shift() ?? 0.5 });
ok(res.winner === 0 && res.units.find(x => x.id === "y").lost > res.units.find(x => x.id === "x").lost, "битва: проигравший теряет больше");

stepName("набор");
const town = await Actor.create({ name: "Прогон: замок", type: "settlement", folder: folder.id,
  system: { families: 6, militia: 30, wealth: 2, stock: { "Еда": 50, "Топливо": 20, "Оружие": 25, "Доспехи": 5 } } });
{ const d = SC.buildingItemData("drillground"); d.system.level = 1; await town.createEmbeddedDocuments("Item", [d]); }
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
await ARMY.equip(militia, 1);
ok(militia.system.equipment === 1 && town.system.stock["Оружие"] === 5, "снаряжение: 20 оружия со склада");
await ARMY.equip(militia, 2);
ok(militia.system.equipment === 1, "на доспехи для 20 бойцов не хватает — не снарядили");
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

stepName("битва");
const foe = await Actor.create({ name: "Прогон: разбойники", type: "unit", folder: folder.id, system: { kind: "infantry", soldiers: 25, training: 0, morale: 4 } });
const app = ARMY.battle([militia, fam]);
app.add(1, foe); await app.render(); await wait(400);
const before = militia.system.soldiers + foe.system.soldiers;
app.element.querySelector("[data-action=round]").click(); await wait(800);
ok(militia.system.soldiers + foe.system.soldiers < before, "раунд: обе стороны понесли потери");
ok(game.messages.contents.at(-1)?.content.includes("battle-round"), "карточка раунда в чате");
await app.close();

stepName("роспуск");
const m0 = town.system.militia, left = militia.system.soldiers;
window.__noAutoDialog = true;
const disbanding = ARMY.disband(militia); await wait(500);
document.querySelector(".application.dialog button[data-action=yes]")?.click();
await disbanding; window.__noAutoDialog = false; await wait(400);
ok(!game.actors.get(militia.id) && town.system.militia === m0 + left, "распущенное ополчение вернулось в Ополчение");

for (const a of [fam, merc, foe]) if (game.actors.get(a.id)) await a.delete();
await town.delete();
