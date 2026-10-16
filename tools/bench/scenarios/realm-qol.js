// Удобства правителя (PLAN 4.210): решение события из чата, метки «ждёт решения», связанные жетоны отрядов, одобрение
// от нужд (настройка), летопись в журнале.
const S = game.vedmak.settlement;
const EV = S.events;
const until = async (test, ms = 4000) => { for (let t = 0; t < ms && !test(); t += 100) await wait(100); return test(); };
const needs0 = game.settings.get("vedmak", "settlementNeedsApproval");
const chance0 = game.settings.get("vedmak", "settlementEvents");
await game.settings.set("vedmak", "settlementEvents", 0);

const town = await Actor.create({ name: "Прогон: Берёзовка", type: "settlement", folder: folder.id,
  system: { families: 4, approval: 5, wealth: 2, month: 6, week: 1, stock: { "Еда": 40, "Топливо": 40, "Снадобья": 5 } } }, { vedmakStarter: false });

stepName("решение из чата");
await EV.addEvent(town, "plague"); await wait(500);
const msg = game.messages.contents.at(-1);
const card = () => ui.chat.element?.querySelector(`[data-message-id="${msg.id}"]`) ?? document.querySelector(`.chat-message[data-message-id="${msg.id}"]`);
await until(() => card()?.querySelector("button[data-se-choice]"));
ok(card()?.querySelectorAll("button[data-se-choice]").length === 3, "в карточке события — три кнопки вариантов");
town.sheet.tab = "economy"; await town.sheet.render({ force: true }); await wait(500);
ok(town.sheet.element.querySelector(".rs-tabs .rs-badge")?.textContent.trim() === "1", "на вкладке «Хозяйство» — метка «1»");
ui.actors.render(); await wait(500);
ok(!!document.querySelector(`#actors [data-entry-id="${town.id}"] .vd-pending, .directory-item[data-entry-id="${town.id}"] .vd-pending`), "в списке актёров у поселения — метка «ждёт решения»");
card().querySelector('button[data-se-choice="1"]').click();
await until(() => !town.system.decisions.length);
ok(!town.system.decisions.length && town.system.stock["Снадобья"] === 2, "кнопка «Знахарь и снадобья» в чате — решение принято");
await until(() => card()?.querySelector(".se-done"));
ok(!!card()?.querySelector(".se-done"), "карточка события перерисовалась: «Решено»");
await town.sheet.render(); await wait(300);
ok(!town.sheet.element.querySelector(".rs-tabs .rs-badge"), "метка на вкладке ушла");
await town.sheet.close();

stepName("связанные жетоны отрядов");
const u = await Actor.create({ name: "Прогон: Вольные", type: "unit", folder: folder.id, system: { soldiers: 10 } });
ok(u.prototypeToken.actorLink, "отряд, созданный вручную, — жетон связан с актёром");
const [tk] = await canvas.scene.createEmbeddedDocuments("Token", [{ ...(await u.getTokenDocument()).toObject(), actorLink: false, x: 200, y: 200 }]);
ok(tk.actorLink, "несвязанный жетон отряда на сцене — связан");
await tk.delete();

stepName("одобрение от нужд");
await game.settings.set("vedmak", "settlementNeedsApproval", true);
await town.update({ "system.stock.Еда": 0, "system.week": 4, "system.approval": 5 });
await town.sheet.render({ force: true }); await wait(400);
ok(town.sheet.element.textContent.includes("одобрение −1"), "на листе — «нужд не хватит — одобрение −1»");
await town.sheet.close();
await S.advanceWeek(town); await wait(500);
ok(town.system.approval === 4 && (game.messages.contents.at(-1)?.content ?? "").includes("Голод и холод"), `месяц с голодом: одобрение 5 → ${town.system.approval}`);
await game.settings.set("vedmak", "settlementNeedsApproval", false);
await town.update({ "system.stock.Еда": 0, "system.week": 4, "system.approval": 5 });
await S.advanceWeek(town); await wait(400);
ok(town.system.approval === 5, "настройка выключена — одобрение от нужд не меняется");

stepName("летопись в журнале");
const filler = Array.from({ length: 40 }, (_, i) => ({ year: 1, month: 1 + Math.floor(i / 4), monthLabel: "Март", week: 1 + (i % 4), net: { "Еда": -1 }, events: [], built: [], shortages: [] }));
await town.update({ "system.log": filler });
await S.advanceWeek(town); await wait(600);
const jid = town.getFlag("vedmak", "chronicle");
const j = game.journal.get(jid);
ok(town.system.log.length === 40 && j?.pages.size >= 1, `неделя сверх 40 ушла в журнал «${j?.name}»`);
await S.moveChronicle(town); await wait(500);
ok(!town.system.log.length && (j.pages.contents.reduce((n, p) => n + (p.text.content.match(/<h3>/g) ?? []).length, 0) >= 41), "«В журнал» — вся летопись перенесена, лист чист");
for (const app of [...foundry.applications.instances.values()]) if (app.document?.id === jid) await app.close();

await game.settings.set("vedmak", "settlementNeedsApproval", needs0);
await game.settings.set("vedmak", "settlementEvents", chance0);
await j?.delete();
for (const f of game.folders.filter(f => f.type === "JournalEntry" && f.name === "Летописи поселений" && !f.contents.length)) await f.delete();
await u.delete(); await town.delete();
