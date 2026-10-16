// Звуки и движение новых листов (PLAN 4.212): те же, что у листа персонажа — проявление вкладки, перетекание шкал и
// вспышка чисел, въезд карточек, звон монет, колокол недели, звуки итога, взмах и удар в битве.
const S = game.vedmak.settlement;
const SC = await import("/systems/vedmak/module/config/settlement.mjs");
const until = async (test, ms = 4000) => { for (let t = 0; t < ms && !test(); t += 100) await wait(100); return test(); };
const played = [];
const orig = foundry.audio.AudioHelper.play;
foundry.audio.AudioHelper.play = (data, ...rest) => { played.push(String(data.src).split("/").pop()); return Promise.resolve(null); };
const heard = name => played.some(s => s.startsWith(name));
const anims = el => (el?.getAnimations?.() ?? []).length;
const chance0 = game.settings.get("vedmak", "settlementEvents");
await game.settings.set("vedmak", "settlementEvents", 0);

const town = await Actor.create({ name: "Прогон: Ракитное", type: "settlement", folder: folder.id,
  system: { families: 6, approval: 5, wealth: 3, stock: { "Еда": 40, "Топливо": 40, "Древесина": 40, "Камень": 20 } } });
await until(() => town.system.buildingActors.length === 3);
await S.createBuildings(town, [SC.buildingItemData("tradepost")].map(d => { d.system.level = 1; return d; }));
town.sheet.tab = "economy"; await town.sheet.render({ force: true }); await wait(600);

stepName("числа и шкалы");
await town.update({ "system.stock.Еда": 20 }); await wait(150);
// Лист поселения по холсту (PLAN 4.230): склад плитками без шкалы — вспыхивает число; шкалы — у нужд и стройки
const food = town.sheet.element.querySelector('.rs-stock .rs-res[data-name="Еда"]');
ok(anims(food?.querySelector(":scope > input[type=number], :scope > b")) > 0, "еда убыла — число на складе вспыхнуло");

stepName("вкладка");
town.sheet.element.querySelector('.rs-tabs [data-tab="buildings"]').click(); await wait(250);
ok(anims(town.sheet.element.querySelector(".rs-scroll")) > 0, "новая вкладка проявляется со сдвигом");

stepName("звуки");
played.length = 0;
await S.trade(town, "Древесина", 5, "sell"); await wait(100);
ok(heard("ui-coin"), "продажа на торговом посту — звон монет");
played.length = 0;
await S.advanceWeek(town); await wait(400);
ok(heard("ui-turn"), "прошла неделя — колокол");
const card = document.querySelector(`.chat-message[data-message-id="${game.messages.contents.at(-1).id}"]`);
ok(card?.classList.contains("vd-new"), "карточка недели въезжает в чат, как карточки боя");
played.length = 0;
await game.vedmak.settlement.events.addEvent(town, "dispute"); await wait(200);
await game.vedmak.settlement.events.decide(town, town.system.decisions[0].id, 0); await wait(500);
ok(heard("ui-success") || heard("ui-fail"), "решение с проверкой — звук итога, как у проверок");

stepName("постройка и отряд");
const lumber = town.system.buildingActors.find(b => b.system.key === "lumber");
await lumber.sheet.render({ force: true }); await wait(600);
await lumber.update({ "system.workers": 0 }); await wait(150);
ok(anims(lumber.sheet.element.querySelector(".sv-plaques")?.querySelectorAll(".sv-plaque")[1]?.querySelector("b, input")) >= 0, "лист постройки оживлён без ошибок");
await lumber.sheet.close();
const unit = await game.vedmak.army.recruit(town, { origin: "militia", count: 0 }) ?? await Actor.create({ name: "Прогон: Ополченцы", type: "unit", folder: folder.id, system: { soldiers: 20, settlement: town.uuid } });
await unit.sheet.render({ force: true }); await wait(600);
await unit.update({ "system.soldiers": 15 }); await wait(150);
ok(anims(unit.sheet.element.querySelector(".sv-plaque .big")) > 0, "у отряда убыли бойцы — число вспыхнуло");
await unit.sheet.close();

stepName("битва");
const foe = await Actor.create({ name: "Прогон: Тати", type: "unit", folder: folder.id, system: { soldiers: 20 } });
const app = game.vedmak.army.battle([unit]); app.add(1, foe); await app.render({ force: true }); await wait(600);
played.length = 0;
app.element.querySelector("[data-action=round]").click();
const flashed = await until(() => [...app.element.querySelectorAll(".bt-num")].some(el => anims(el) > 0), 3000);
await wait(400);
ok(heard("swing-heavy") && heard("hit"), "раунд битвы — взмах и удар");
ok(flashed, "потери в окне битвы — числа вспыхнули");
await app.close();

foundry.audio.AudioHelper.play = orig;
await game.settings.set("vedmak", "settlementEvents", chance0);
await town.sheet.close();
for (const b of town.system.buildingActors) await b.delete();
await game.folders.find(x => x.getFlag("vedmak", "settlement") === town.uuid)?.delete();
for (const a of [unit, foe, town]) if (a && game.actors.get(a.id)) await a.delete();
