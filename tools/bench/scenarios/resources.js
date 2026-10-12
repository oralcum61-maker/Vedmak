// Библиотека ресурсов (PLAN 4.201): ресурсы с ценой и значком, «+» и перетаскивание на лист поселения, свой ресурс ведущего.
const RC = await import("/systems/vedmak/module/config/resources.mjs");
const SC = await import("/systems/vedmak/module/config/settlement.mjs");
const { ResourceLibrary, RESOURCE_DRAG } = await import("/systems/vedmak/module/apps/resource-library.mjs");

stepName("библиотека");
const lib = RC.RESOURCE_LIBRARY;
ok(lib.length >= 120 && new Set(lib.map(x => x.name)).size === lib.length, `ресурсов ${lib.length}, имена не повторяются`);
ok(Object.keys(RC.RESOURCE_CATEGORIES).every(c => lib.some(x => x.cat === c)), "в каждом разделе есть ресурсы");
const missing = [];
for (const x of lib) { const r = await fetch(x.img, { method: "HEAD" }); if (!r.ok) missing.push(x.name); }
ok(!missing.length, `значки на месте${missing.length ? ": нет у " + missing.join(", ") : ""}`);
ok(SC.priceOf("Вино") === 15 && SC.resourceIcon("Вино").includes("wine"), "цена и значок нового ресурса — из библиотеки");
ok(SC.priceOf("Древесина") === 3, "у старых ресурсов цены прежние");

stepName("на склад");
const town = await Actor.create({ name: "Прогон: склад", type: "settlement", folder: folder.id }, { vedmakStarter: false });
const app = ResourceLibrary.open(town); await wait(600);
ok(app.element.querySelectorAll(".rl-item").length === lib.length, "в окне — вся библиотека");
app.element.querySelector('.rl-item[data-name="Вино"] [data-action=add]')?.click(); await wait(500);
ok(town.system.stock["Вино"] === 0, "«+» — вино на складе, с нуля");
ok(app.element.querySelector('.rl-item[data-name="Вино"]')?.classList.contains("have"), "в библиотеке вино отмечено: уже на складе");
const dt = new DataTransfer(); dt.setData("text/plain", JSON.stringify({ type: RESOURCE_DRAG, name: "Соль" }));
await town.sheet.render({ force: true }); await wait(400);
await town.sheet._onDrop(new DragEvent("drop", { dataTransfer: dt })); await wait(400);
ok("Соль" in town.system.stock, "перетащенная соль — на складе");
ok(!!town.sheet.element.querySelector(".sv-res [data-name], .sv-res li") && town.sheet.element.textContent.includes("Соль"), "лист поселения показывает соль");

stepName("свой ресурс");
const own = await Item.create({ name: "Прогон: звёздный камень", type: "resource", img: "icons/commodities/gems/gem-faceted-diamond-blue.webp",
  system: { price: 77, category: "luxury" } });
await wait(400);
ok(SC.priceOf("Прогон: звёздный камень") === 77 && SC.resourceIcon("Прогон: звёздный камень").includes("diamond"), "свой ресурс: цена и значок");
await app.render(); await wait(400);
ok(!!app.element.querySelector('.rl-item.custom[data-name="Прогон: звёздный камень"]'), "свой ресурс — в библиотеке");
await town.sheet._onDropItem(null, own); await wait(400);
ok("Прогон: звёздный камень" in town.system.stock, "перетащенный предмет «Ресурс» — на складе");

await app.close();
await town.sheet.close();
await own.delete();
await town.delete();
