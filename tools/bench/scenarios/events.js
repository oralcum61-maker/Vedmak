// События месяца поселений (PLAN 4.206): событие ведущего, решение правителя (цена, проверка, последствия), последствия
// надолго (торговля закрыта, выработка вполовину) и их истечение, решение по умолчанию при ходе недели, бросок события
// в конце месяца, лист и Совет.
const S = game.vedmak.settlement;
const EV = S.events;
const SC = await import("/systems/vedmak/module/config/settlement.mjs");
const CE = await import("/systems/vedmak/module/config/settlement-events.mjs");
const until = async (test, ms = 4000) => { for (let t = 0; t < ms && !test(); t += 100) await wait(100); return test(); };
const mk = (key, st) => { const d = SC.buildingItemData(key); Object.assign(d.system, st); return d; };
const lastCard = () => game.messages.contents.at(-1)?.content ?? "";
const chance0 = game.settings.get("vedmak", "settlementEvents");

const town = await Actor.create({ name: "Прогон: Ольховка", type: "settlement", folder: folder.id,
  system: { families: 8, militia: 20, approval: 5, wealth: 2, month: 6, week: 1,
    stock: { "Еда": 60, "Топливо": 40, "Древесина": 30, "Снадобья": 5 } } });
await until(() => town.system.buildingActors.length === 3);
await S.createBuildings(town, [mk("tradepost", { level: 1 })]);
await until(() => town.system.summary.trade);

stepName("справочник");
ok(Object.keys(CE.SETTLEMENT_EVENTS).length >= 12, `событий в справочнике: ${Object.keys(CE.SETTLEMENT_EVENTS).length}`);
ok(Object.values(CE.SETTLEMENT_EVENTS).every(e => e.choices.length && e.label && e.img), "у каждого события есть выборы, название и значок");
ok(CE.rollEvent({ keys: new Set() }, 0) === null, "шанс 0 — событий нет");
ok(!!CE.rollEvent(EV.eventState(town), 100), "шанс 100 — событие выбирается из подходящих");

stepName("решение с ценой");
await EV.addEvent(town, "plague"); await wait(300);
ok(town.system.decisions.length === 1 && lastCard().includes("Мор"), "ведущий задал «Мор» — решение ждёт, карточка в чате");
town.sheet.tab = "economy"; await town.sheet.render({ force: true }); await wait(600);
const card = town.sheet.element.querySelector(".rs-event");
ok(card && card.querySelectorAll("[data-action=decide]").length === 3, "на листе — «Решение правителя» с тремя выборами");
await EV.decide(town, town.system.decisions[0].id, 1); await wait(300);
ok(town.system.stock["Снадобья"] === 2 && town.system.approval === 6 && !town.system.decisions.length,
  `«Знахарь и снадобья»: снадобья 5 → ${town.system.stock["Снадобья"]}, одобрение 5 → ${town.system.approval}`);
ok(lastCard().includes("Решение:") && lastCard().includes("Знахарь"), "карточка решения в чате");

stepName("последствия надолго");
await EV.addEvent(town, "bandits"); await wait(200);
await EV.decide(town, town.system.decisions[0].id, 2); await wait(300);
ok(town.system.modifiers.length === 1 && !town.system.summary.trade, "«Закрыть ворота»: торговли нет");
const wood0 = town.system.forecast.produced["Древесина"];
await EV.addEvent(town, "monster"); await wait(200);
await EV.decide(town, town.system.decisions[0].id, 2); await wait(300);
ok(Math.abs(town.system.forecast.produced["Древесина"] - wood0 / 2) < 0.6, `«Не ходить в лес»: древесина вполовину (${wood0} → ${town.system.forecast.produced["Древесина"]})`);
town.sheet.tab = "economy"; await town.sheet.render(); await wait(500);
ok(town.sheet.element.querySelectorAll(".rs-mods li").length === 2, "на листе — два действующих последствия");

stepName("проверка");
await EV.addEvent(town, "dispute"); await wait(200);
const res = await EV.decide(town, town.system.decisions[0].id, 0); await wait(300);
ok(res?.check && lastCard().includes("Проверка") && [5, 7].includes(town.system.approval),
  `«Рассудить»: d10 ${res?.check?.d10} + ${res?.check?.base} против ${res?.check?.dc} — ${res?.check?.ok ? "успех" : "провал"}`);

stepName("решение по умолчанию и истечение");
await town.update({ "system.approval": 5 });
await EV.addEvent(town, "refugees"); await wait(200);
await game.settings.set("vedmak", "settlementEvents", 0);
await S.advanceWeek(town); await wait(500);
ok(!town.system.decisions.length && town.system.approval === 4 && lastCard().includes("Решение не принято"),
  `правитель не решил — «Прогнать»: одобрение 5 → ${town.system.approval}`);
ok(town.system.modifiers.every(m => m.weeks < 4), "последствия стали на неделю короче");
for (let i = 0; i < 3; i++) await S.advanceWeek(town);
await wait(500);
ok(!town.system.modifiers.length && town.system.summary.trade, "через 4 недели последствия кончились — торговля снова есть");

stepName("событие в конце месяца");
await game.settings.set("vedmak", "settlementEvents", 100);
await town.update({ "system.week": 4 });
await S.advanceWeek(town); await wait(500);
ok(town.system.decisions.length === 1 && lastCard().includes("Событие —"), `конец месяца: событие «${CE.SETTLEMENT_EVENTS[town.system.decisions[0]?.key]?.label}»`);
const council = game.vedmak.council.open(); await wait(700);
ok(council.element.textContent.includes("ждёт решения"), "в Совете правителя — «ждёт решения»");
await council.close();
await game.settings.set("vedmak", "settlementEvents", chance0);
await town.sheet.close();

for (const b of town.system.buildingActors) await b.delete();
await game.folders.find(x => x.getFlag("vedmak", "settlement") === town.uuid)?.delete();
await town.delete();
