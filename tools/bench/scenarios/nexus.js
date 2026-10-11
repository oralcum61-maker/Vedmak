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

stepName("перевод отряда");
await from.activate();
for (let i = 0; i < 40 && !(canvas.ready && canvas.scene?.id === from.id); i++) await wait(250);
const player = game.users.find(u => !u.isGM);
const hero = await Actor.create({ name: "Прогон: путник", type: "character", folder: folder.id, ownership: { default: 0, [player.id]: 3 } });
const td = await hero.getTokenDocument({ x: 300, y: 300, actorLink: true });
await from.createEmbeddedDocuments("Token", [td.toObject()]); await tick();
document.querySelector(`#vedmak-nexus .nx-place[data-scene-id="${to.id}"]`).click(); await tick();
ok(!!document.querySelector("#vedmak-nexus .nx-pop .nx-carry li.on"), "в окне места — жетон отряда, отмечен");
document.querySelector("#vedmak-nexus .nx-pop [data-action=travel]").click();
for (let i = 0; i < 40 && game.scenes.active?.id !== to.id; i++) await wait(250);
await wait(800);
ok(game.scenes.active?.id === to.id, "сцена стала активной");
ok(to.tokens.some(t => t.actorId === hero.id) && !from.tokens.some(t => t.actorId === hero.id), "жетон перенесён");

stepName("доступ игрокам");
const { openToPlayers } = await import("/systems/vedmak/module/apps/scene-nexus.mjs");
ok(openToPlayers(to) && !openToPlayers(from), "открытость: «куда» открыта, «откуда» закрыта");
document.querySelector(`#vedmak-nexus .nx-place[data-scene-id="${from.id}"]`).click(); await tick();
document.querySelector("#vedmak-nexus .nx-pop [data-action=access]").click(); await tick();
ok(openToPlayers(from), "кнопка открыла сцену игрокам");

await game.settings.set("vedmak", "sceneNexusOpen", false);
if (startActive) await startActive.activate();
await wait(600);
for (const s of [from, to]) await s.delete();
await fold.delete();
await hero.delete();
