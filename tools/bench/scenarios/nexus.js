// «Нексус» — навигация сцен (PLAN 4.181): доска из папок, новые сцены сами, перевод отряда жетонами.
const { SceneNexus } = await import("/systems/vedmak/module/apps/scene-nexus.mjs");
const tick = () => wait(400);
const places = () => [...document.querySelectorAll("#vedmak-nexus .nx-place")].map(p => p.dataset.search);

stepName("названия");
ok(SceneNexus.short("Майена - площадь", ["Майена"]) === "Площадь", "«Майена - площадь» в папке «Майена» — «Площадь»");
ok(SceneNexus.short("Майена — таверна", ["помещения", "Майена"]) === "Таверна", "вложенная папка: снимается имя верхней");
ok(SceneNexus.short("Майенская стража", ["Майена"]) === "Майенская стража", "без разделителя — как есть");

stepName("доска");
const startActive = game.scenes.active;
const fold = await Folder.create({ name: "Прогон: нексус", type: "Scene" });
const mk = (name, extra = {}) => Scene.create({ name, folder: fold.id, width: 1400, height: 1000, padding: 0, ...extra });
const from = await mk("Прогон: нексус - откуда");
const to = await mk("Прогон: нексус - куда", { ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED } });
ok(!getComputedStyle(document.getElementById("scene-navigation")).display.includes("flex") || !document.body.classList.contains("vd-nexus-on"),
  "полоса сцен Foundry скрыта");
await game.settings.set("vedmak", "sceneNexusOpen", true); await tick();
ok(!!document.querySelector("#vedmak-nexus .nx-board"), "доска раскрыта");
ok(places().includes("прогон: нексус - откуда") && places().includes("прогон: нексус - куда"), "сцены папки на доске");
const group = document.querySelector(`#vedmak-nexus .nx-group[data-folder-id="${fold.id}"]`);
ok(group?.querySelector(".nx-card .nx-name")?.textContent.trim().startsWith("Откуда") || group?.textContent.includes("Куда"), "в папке — короткие названия");

stepName("сама подхватывает");
const extra = await mk("Прогон: нексус - новая"); await tick();
ok(places().includes("прогон: нексус - новая"), "новая сцена появилась без перезагрузки");
await extra.update({ name: "Прогон: нексус - переименована" }); await tick();
ok(places().includes("прогон: нексус - переименована") && !places().includes("прогон: нексус - новая"), "переименование подхвачено");
await extra.delete(); await tick();
ok(!places().includes("прогон: нексус - переименована"), "удалённая сцена ушла");

stepName("перенос выделенных");
await from.activate();
for (let i = 0; i < 40 && !(canvas.ready && canvas.scene?.id === from.id); i++) await wait(250);
const player = game.users.find(u => !u.isGM);
const hero = await Actor.create({ name: "Прогон: путник", type: "character", folder: folder.id, ownership: { default: 0, [player.id]: 3 } });
const td = await hero.getTokenDocument({ x: 300, y: 300, actorLink: true });
const [heroTok] = await from.createEmbeddedDocuments("Token", [td.toObject()]);
const [extraTok] = await from.createEmbeddedDocuments("Token", [{ ...td.toObject(), x: 500, name: "Прогон: не выделен" }]); await tick();
document.querySelector(`#vedmak-nexus .nx-place[data-scene-id="${to.id}"]`).click(); await tick();
ok(!document.querySelector("#vedmak-nexus .nx-pop [data-action=travel]"), "без выделения кнопки переноса нет");
canvas.tokens.releaseAll(); heroTok.object.control({ releaseOthers: true }); await wait(600);
ok(document.querySelectorAll("#vedmak-nexus .nx-pop .nx-carry li").length === 1, "в окне места — только выделенный жетон");
document.querySelector("#vedmak-nexus .nx-pop [data-action=travel]").click();
for (let i = 0; i < 40 && canvas.scene?.id !== to.id; i++) await wait(250);
await wait(800);
ok(game.scenes.active?.id === from.id, "активная сцена не сменилась — всех не переносит");
ok(from.tokens.has(extraTok.id), "невыделенный жетон остался");
ok(to.tokens.some(t => t.actorId === hero.id) && !from.tokens.has(heroTok.id), "выделенный жетон перенесён");

stepName("доступ игрокам");
const { openToPlayers } = await import("/systems/vedmak/module/apps/scene-nexus.mjs");
ok(openToPlayers(to) && !openToPlayers(from), "открытость: «куда» открыта, «откуда» закрыта");
document.querySelector(`#vedmak-nexus .nx-place[data-scene-id="${from.id}"]`).click(); await tick();
document.querySelector("#vedmak-nexus .nx-pop [data-action=access]").click(); await tick();
ok(openToPlayers(from), "кнопка открыла сцену игрокам");

stepName("закрытая — не видна игроку");
// Глазами игрока: подменяем пользователя только для сборки данных доски
const ctxFor = async user => { const real = game.user; Object.defineProperty(game, "user", { value: user, configurable: true });
  try { return await SceneNexus.instance._prepareContext(); } finally { Object.defineProperty(game, "user", { value: real, configurable: true }); } };
await from.update({ ownership: { default: 0 } });
await from.activate(); await wait(800);
const pc = await ctxFor(player);
const ids = pc.groups.flatMap(g => [...g.scenes, ...g.subs.flatMap(s => s.scenes)]).map(s => s.id);
ok(!ids.includes(from.id) && ids.includes(to.id), "закрытой активной сцены у игрока на доске нет, открытая — есть");
ok(pc.here?.name === "Неизвестное место" || pc.here?.id !== from.id, "в бирке — без названия закрытой сцены");

stepName("этажи");
// Этажи сцены (Scene Levels ядра v14) — под биркой: сверху вниз, щелчок показывает этаж
const lv = { cellar: foundry.utils.randomID(), ground: foundry.utils.randomID(), attic: foundry.utils.randomID() };
const tower = await mk("Прогон: нексус - башня", { initialLevel: lv.ground, levels: [
  { _id: lv.cellar, name: "Подвал", elevation: { bottom: -20, top: 0 } },
  { _id: lv.ground, name: "Первый этаж", elevation: { bottom: 0, top: 20 } },
  { _id: lv.attic, name: "Чердак", elevation: { bottom: 20, top: 40 } }] });
const startView = canvas.scene;
await tower.view(); await wait(1500);
const rows = () => [...document.querySelectorAll("#vedmak-nexus .nx-level")];
ok(rows().map(r => r.dataset.levelId).join() === [lv.attic, lv.ground, lv.cellar].join(), `под биркой три этажа сверху вниз (${rows().map(r => r.textContent.trim()).join(", ")})`);
ok(rows().find(r => r.classList.contains("view"))?.dataset.levelId === canvas.level?.id, "текущий этаж отмечен");
rows().find(r => r.dataset.levelId === lv.attic)?.querySelector("a").click(); await wait(1500);
ok(canvas.level?.id === lv.attic, "щелчок по «Чердак» показывает чердак");
ok(rows().find(r => r.classList.contains("view"))?.dataset.levelId === lv.attic, "отметка переехала на чердак");

// Панель этажа по правой кнопке: высота, места этажей, окно ядра
const nexusEl = () => document.querySelector("#vedmak-nexus");
const menu = () => nexusEl().querySelector(".nx-lvlmenu");
const rmb = id => rows().find(r => r.dataset.levelId === id)?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
rmb(lv.ground); await wait(500);
ok(menu()?.dataset.levelId === lv.ground, "правая кнопка по «Первый этаж» открыла панель этажа");
ok(menu()?.querySelector("input[name=bottom]").value === "0" && menu()?.querySelector("input[name=top]").value === "20", "в панели — высота этажа 0–20");
{ const top = menu().querySelector("input[name=top]"); top.value = "25"; top.dispatchEvent(new Event("change")); }
await wait(700);
ok(tower.levels.get(lv.ground).elevation.top === 25, "верх этажа поднят до 25 из панели");
{ const bottom = menu().querySelector("input[name=bottom]"); bottom.value = "30"; bottom.dispatchEvent(new Event("change")); }
await wait(500);
ok(tower.levels.get(lv.ground).elevation.bottom === 0, "низ выше верха — высота не меняется");
const [tk] = await tower.createEmbeddedDocuments("Token", [{ name: "Прогон: жилец", x: 100, y: 100, level: lv.ground, elevation: 5 }]);
menu().querySelector("[data-action=levelUp]").click(); await wait(900);
ok(rows().map(r => r.dataset.levelId).join() === [lv.ground, lv.attic, lv.cellar].join(), `«Выше»: первый этаж поменялся местами с чердаком (${rows().map(r => r.textContent.trim()).join(", ")})`);
const g = tower.levels.get(lv.ground).elevation, at = tower.levels.get(lv.attic).elevation;
ok(g.bottom === 20 && g.top === 40 && at.bottom === 0 && at.top === 25, "высоты остались за местами: верхний 20–40, средний 0–25");
ok(tower.tokens.get(tk.id).elevation === 25, `жетон этажа переехал вместе с ним: высота ${tower.tokens.get(tk.id).elevation}`);
ok(menu()?.querySelector("[data-action=levelUp]").disabled, "верхнему этажу «Выше» недоступно");
menu().querySelector("[data-action=levelDown]").click(); await wait(900);
ok(rows().map(r => r.dataset.levelId).join() === [lv.attic, lv.ground, lv.cellar].join(), "«Ниже» вернул порядок");
menu().querySelector("[data-action=levelConfig]").click(); await wait(700);
const lvSheet = tower.levels.get(lv.ground).sheet;
ok(lvSheet.rendered && !menu(), "«Все настройки этажа» открыли окно этажа Foundry, панель закрылась");
await lvSheet.close();
rmb(lv.cellar); await wait(400);
document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); await wait(400);
ok(!menu(), "щелчок мимо панели закрывает её");
if (startView) await startView.view();
await wait(800);
ok(!document.querySelector("#vedmak-nexus .nx-levels") || (canvas.scene?.availableLevels?.size ?? 0) > 1, "на сцене с одним этажом списка нет");
await tower.delete();

await game.settings.set("vedmak", "sceneNexusOpen", false);
if (startActive) await startActive.activate();
await wait(600);
for (const s of [from, to]) await s.delete();
await fold.delete();
await hero.delete();
