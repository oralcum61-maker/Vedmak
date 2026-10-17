// Правки компендиумов системы (PLAN 4.255): правка, новая запись и правка вложенного сохраняются копией в мире;
// после «обновления» (запись снова из сборки) правка возвращается, повторно — нет; перенос правок из копии компендиума.
const until = async (test, ms = 5000) => { for (let t = 0; t < ms && !(await test()); t += 100) await wait(100); return test(); };
const PE = game.vedmak.packEdits;
const gear = game.packs.get("vedmak.gear"), bestiary = game.packs.get("vedmak.bestiary");
const locks = [gear, bestiary].map(p => [p, p.locked]);
const store = name => game.packs.find(p => p.metadata.packageType === "world" && p.metadata.name === name);
const originals = [];
/** «Обновление системы»: запись заменяется исходной (как из сборки), без слежения — время правки другое. */
const reship = async (pack, data) => {
  await (await pack.getDocument(data._id))?.delete({ vedmakPackEdit: true });
  await CONFIG[pack.documentName].documentClass.create(foundry.utils.deepClone(data), { pack: pack.collection, keepId: true, vedmakPackEdit: true });
};
let copyPack = null, made = null;
try {
  for (const [p] of locks) await p.configure({ locked: false });
  const idx = await gear.getIndex();
  const [aIdx, bIdx] = idx.contents.slice(0, 2);
  const a = await gear.getDocument(aIdx._id), b = await gear.getDocument(bIdx._id);
  originals.push([gear, a.toObject()], [gear, b.toObject()]);

  stepName("правка сохраняется");
  await a.update({ name: `${a.name} (правка)`, "system.weight": 99 });
  await until(async () => !!(await store("vedmak-edits-items")?.getDocument(a.id)));
  const copyA = await store("vedmak-edits-items")?.getDocument(a.id);
  ok(copyA?.name.endsWith("(правка)") && copyA.getFlag("vedmak", "packEdit")?.pack === "vedmak.gear", "копия правки — в компендиуме мира");
  await a.update({ sort: 123456 });
  await wait(900);
  ok((await store("vedmak-edits-items").getDocument(a.id))?.getFlag("vedmak", "packEdit")?.at === copyA.getFlag("vedmak", "packEdit").at,
    "перестановка по порядку — не правка");

  stepName("возврат после обновления");
  await reship(gear, originals[0][1]);
  ok(!(await gear.getDocument(a.id)).name.endsWith("(правка)"), "«обновление» вернуло исходную запись");
  const back = await PE.restoreEdits();
  const a2 = await gear.getDocument(a.id);
  ok(back.length >= 1 && a2.name.endsWith("(правка)") && a2.system.weight === 99, `правка возвращена (${back.join("; ")})`);
  ok(!(await PE.restoreEdits()).length, "повторно возвращать нечего");
  // Запертый компендиум: возврат открывает его на время и запирает снова
  await reship(gear, originals[0][1]);
  await gear.configure({ locked: true });
  const back2 = await PE.restoreEdits();
  ok(back2.length >= 1 && gear.locked && (await gear.getDocument(a.id)).name.endsWith("(правка)"), "запертый компендиум: правка возвращена, замок на месте");
  await gear.configure({ locked: false });

  stepName("новая запись и вложенное");
  made = await CONFIG.Item.documentClass.create({ name: "Прогон: новый предмет компендиума", type: "gear" }, { pack: gear.collection });
  await until(async () => !!(await store("vedmak-edits-items")?.getDocument(made.id)));
  await (await gear.getDocument(made.id)).delete({ vedmakPackEdit: true }); // «обновление» — записи в сборке нет
  await PE.restoreEdits();
  ok(!!(await gear.getDocument(made.id)), "новая запись возвращена после «обновления»");
  const bIdx2 = (await bestiary.getIndex()).contents.find(e => true);
  const beast = await bestiary.getDocument(bIdx2._id);
  originals.push([bestiary, beast.toObject()]);
  const it = beast.items.contents[0];
  if (it) {
    await it.update({ name: `${it.name} (правка)` });
    await until(async () => !!(await store("vedmak-edits-actors")?.getDocument(beast.id)));
    await reship(bestiary, originals.at(-1)[1]);
    await PE.restoreEdits();
    ok((await bestiary.getDocument(beast.id)).items.get(it.id)?.name.endsWith("(правка)"), "правка вложенного предмета существа возвращена");
  }

  stepName("перенос из копии компендиума");
  copyPack = await gear.duplicateCompendium({ label: "Прогон: копия снаряжения" });
  const inCopy = await copyPack.getDocument(b.id);
  await inCopy.update({ name: `${b.name} (из копии)` });
  const diff = await PE.diffCopy(copyPack);
  ok(diff.source?.collection === "vedmak.gear" && diff.items.some(i => i.id === b.id), `сравнение: источник «${diff.source?.title}», отличий ${diff.items.length}`);
  const done = await PE.adoptFromCopy(copyPack, [b.id]);
  ok(done.length === 1 && (await gear.getDocument(b.id)).name.endsWith("(из копии)"), "правка из копии — в компендиуме системы");
  ok((await store("vedmak-edits-items").getDocument(b.id))?.getFlag("vedmak", "packEdit")?.from === copyPack.title, "и сохранена как правка");

  stepName("путь друга: старая версия → копия → обновление → перенос");
  { // Старая версия защиты не знала: правка и новая запись без слежения (vedmakPackEdit). Потом «Дублировать компендиум»,
    // обновление (запись A и новая N — как в сборке; запись X новая версия сама поправила), сравнение и перенос.
    const list = (await gear.getIndex()).contents;
    const [eA, eX] = [list[3], list[4]];
    const A = await gear.getDocument(eA._id), X = await gear.getDocument(eX._id);
    originals.push([gear, A.toObject()], [gear, X.toObject()]);
    await A.update({ name: `${A.name} (правка друга)`, "system.weight": 7 }, { vedmakPackEdit: true });
    const N = await CONFIG.Item.documentClass.create({ name: "Прогон: предмет друга", type: "gear" }, { pack: gear.collection, vedmakPackEdit: true });
    const friendCopy = await gear.duplicateCompendium({ label: "Прогон: копия друга" });
    const copied = await friendCopy.getDocument(A.id);
    const untouched = await friendCopy.getDocument(X.id);
    console.log("копия: у правленой lastModifiedBy", copied?._stats?.lastModifiedBy, "у нетронутой", untouched?._stats?.lastModifiedBy);
    // Обновление: A — из сборки, N — в сборке нет, X — исправлен новой версией
    await reship(gear, originals.at(-2)[1]);
    await (await gear.getDocument(N.id)).delete({ vedmakPackEdit: true });
    await (await gear.getDocument(X.id)).update({ "system.weight": 42 }, { vedmakPackEdit: true });
    await reship(gear, { ...(await gear.getDocument(X.id)).toObject(), _stats: { ...originals.at(-1)[1]._stats } }); // как из сборки: «кем изменено» пусто
    const diff = await PE.diffCopy(friendCopy);
    const byId = new Map(diff.items.map(i => [i.id, i]));
    ok(byId.get(A.id)?.edited && byId.get(N.id)?.isNew, `сравнение нашло правку и новую запись друга (${diff.items.map(i => `${i.name}${i.isNew ? " новая" : i.edited ? " правлена" : " обновлением"}`).join("; ")})`);
    ok(byId.has(X.id) && !byId.get(X.id).edited, "запись, исправленную обновлением, не считает правкой друга (не отмечена)");
    ok(diff.items.length === 3, `лишних отличий нет: ${diff.items.length} из ${(await friendCopy.getIndex()).size}`);
    const done = await PE.adoptFromCopy(friendCopy, diff.items.filter(i => i.edited).map(i => i.id));
    ok(done.length === 2 && (await gear.getDocument(A.id)).name.endsWith("(правка друга)") && (await gear.getDocument(A.id)).system.weight === 7
      && !!(await gear.getDocument(N.id)), "после переноса правка и новая запись друга — в компендиуме системы");
    ok((await gear.getDocument(X.id)).system.weight === 42, "исправление новой версии на месте");
    await reship(gear, originals.at(-1)[1]); // X — как был
    await PE.restoreEdits();
    ok((await gear.getDocument(A.id)).name.endsWith("(правка друга)"), "дальше правка друга защищена: после следующего обновления вернулась");
    await (await gear.getDocument(N.id))?.delete({ vedmakPackEdit: true });
    await friendCopy.deleteCompendium();
  }

  stepName("окно");
  const app = PE.open(); await wait(1200);
  const win = foundry.applications.instances.get("vedmak-pack-edits");
  ok(win?.element.querySelectorAll(".pe-row").length >= 3, `окно «Правки компендиумов»: правок ${win?.element.querySelectorAll(".pe-row").length}`);
  await win?.close(); void app;
} finally {
  for (const [pack, data] of originals) await reship(pack, data);
  if (made) await (await gear.getDocument(made.id))?.delete({ vedmakPackEdit: true });
  for (const p of [copyPack, store("vedmak-edits-items"), store("vedmak-edits-actors")]) if (p) await p.deleteCompendium();
  for (const [p, was] of locks) await p.configure({ locked: was });
}
