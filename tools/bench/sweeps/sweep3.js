// Часть 3: магия и алхимия. Каждое заклинание компендиумов — по чучелу (с целью и, если у него зона, — зоной),
// заклинания чудовищ бестиария, каждый алхимический предмет — в ход. Карточки прокликиваются.
const M = await import("/systems/vedmak/module/magic/cast.mjs");
const AL = await import("/systems/vedmak/module/crafting/alchemy.mjs");
const Z = await import("/systems/vedmak/module/combat/zones.mjs");
const chars = game.actors.filter(a => a.type === "character" && !a.folder?.name?.startsWith("Прогон"));
const mage = chars.sort((a, b) => (b.system.derived?.vigor ?? 0) - (a.system.derived?.vigor ?? 0))[0];
const caster = await cloneActor(mage, "Прогон: маг");
const fighter = await cloneActor(chars.sort((a, b) => b.items.size - a.items.size)[0], "Прогон: боец");
const bestiary = game.packs.get("vedmak.bestiary");
const monsterDocs = await bestiary.getDocuments();
const dummySrc = monsterDocs.find(m => /бандит|разбойник|солдат/i.test(m.name)) ?? monsterDocs[0];
const dummy = await Actor.create({ ...dummySrc.toObject(), _id: undefined, name: "Прогон: чучело", folder: folder.id });
const cTok = await placeToken(caster, 1000, 1000);
const fTok = await placeToken(fighter, 900, 1000);
const dTok = await placeToken(dummy, 1300, 1000);
const cKeep = snapshot(caster), fKeep = snapshot(fighter), dKeep = snapshot(dummy);
log("маг:", mage.name, "Энергия", caster.system.derived?.vigor, "чучело:", dummySrc.name);
// Свои заклинания мага убираем — проверяем по одному
await caster.deleteEmbeddedDocuments("Item", caster.itemTypes.spell.map(i => i.id));

// Зона ставится сама — в центр чучела
canvas.regions.placeRegions = async (datas, opts = {}) => {
  const d = foundry.utils.expandObject(foundry.utils.deepClone(datas[0]));
  const c = dTok.object.center;
  d.shapes[0].x = c.x; d.shapes[0].y = c.y;
  const doc = new CONFIG.Region.documentClass(d, { parent: canvas.scene });
  await opts.preConfirm?.({ document: doc });
  return [];
};
const clearZones = async () => { if (sc.regions.size) await sc.deleteEmbeddedDocuments("Region", sc.regions.map(r => r.id)); };

// --- Заклинания ---
const spells = [];
for (const pack of game.packs.filter(p => p.documentName === "Item" && p.metadata.packageName === "vedmak")) {
  const idx = await pack.getIndex({ fields: ["type"] });
  if (!idx.some(e => e.type === "spell")) continue;
  for (const d of await pack.getDocuments({ type: "spell" })) spells.push(d);
}
log("заклинаний в компендиумах:", spells.length);
const LIMIT_S = Number(window.__limitS ?? 9999);
let si = 0, zonesTried = 0, casts = 0;
for (const sp of spells.slice(Number(window.__fromS ?? 0), LIMIT_S)) {
  si++;
  stepName(`заклинание ${si}/${spells.length}: ${sp.name}`);
  let item;
  try {
    const data = sp.toObject(); delete data._id;
    [item] = await caster.createEmbeddedDocuments("Item", [data]);
    const msg = await M.castSpell(caster, item, { skipDialog: true, targets: [C.targetInfo(dTok)] });
    if (msg) { casts++; await crawl(`заклинание ${sp.name}`, 3); }
    await reset(caster, cKeep); await reset(dummy, dKeep);
    // С зоной — ещё раз, зоной (цели — все в ней)
    if (Z.parseArea(item.system.range)) {
      zonesTried++;
      stepName(`заклинание ${sp.name}: зона`);
      dTok.object.setTarget(true, { releaseOthers: true });
      const zm = await M.castSpell(caster, item, { skipDialog: true });
      if (zm) await crawl(`заклинание ${sp.name}: зона`, 3);
      await clearZones();
      await reset(caster, cKeep); await reset(dummy, dKeep);
    }
  } catch (e) { log("ERR заклинание", sp.name, e.message, (e.stack ?? "").split("\n").slice(1, 3).join(" ")); }
  try { if (item) await item.delete(); } catch {}
  for (const e of M.maintainedSpells(caster)) { try { await e.delete(); } catch {} }
  if (si % 10 === 0) { await clearChat(); seen = new Set(); await clearZones(); }
}
log("сотворено:", casts, "с зоной:", zonesTried);
await clearChat(); seen = new Set(); await clearZones();

// --- Заклинания чудовищ ---
let ms = 0;
if (!window.__noTail) {
for (const md of window.__noMonSpells ? [] : monsterDocs.filter(m => m.items.some(i => i.type === "spell"))) {
  stepName(`чудовище-маг ${md.name}`);
  let mon, mTok;
  try {
    mon = await Actor.create({ ...md.toObject(), _id: undefined, folder: folder.id });
    mTok = await placeToken(mon, 1100, 1100);
    const mKeep = snapshot(mon);
    for (const it of mon.itemTypes.spell) {
      stepName(`чудовище-маг ${md.name}: ${it.name}`);
      const msg = await M.castSpell(mon, it, { skipDialog: true, targets: [C.targetInfo(fTok)] });
      if (msg) { ms++; await crawl(`${md.name}: ${it.name}`, 3); }
      await reset(mon, mKeep); await reset(fighter, fKeep);
      for (const e of M.maintainedSpells(mon)) { try { await e.delete(); } catch {} }
    }
  } catch (e) { log("ERR чудовище-маг", md.name, e.message, (e.stack ?? "").split("\n").slice(1, 3).join(" ")); }
  try { if (mTok) await mTok.delete(); if (mon) await mon.delete(); } catch {}
  await clearChat(); seen = new Set(); await clearZones();
}
log("заклинаний чудовищ:", ms);

// --- Алхимия ---
const alch = [];
for (const pack of game.packs.filter(p => p.documentName === "Item" && p.metadata.packageName === "vedmak")) {
  const idx = await pack.getIndex({ fields: ["type"] });
  if (!idx.some(e => e.type === "alchemical")) continue;
  for (const d of await pack.getDocuments({ type: "alchemical" })) alch.push(d);
}
log("алхимии в компендиумах:", alch.length);
let ai = 0;
const actions = {};
for (const al of alch) {
  ai++;
  stepName(`алхимия ${ai}/${alch.length}: ${al.name}`);
  let item;
  try {
    const data = al.toObject(); delete data._id;
    data.system.quantity = 3;
    [item] = await fighter.createEmbeddedDocuments("Item", [data]);
    actions[item.system.use?.action ?? "?"] = (actions[item.system.use?.action ?? "?"] ?? 0) + 1;
    dTok.object.setTarget(true, { releaseOthers: true });
    await AL.useAlchemical(fighter, item);
    await wait(150);
    await crawl(`алхимия ${al.name}`, 3);
  } catch (e) { log("ERR алхимия", al.name, e.message, (e.stack ?? "").split("\n").slice(1, 3).join(" ")); }
  try { if (item && fighter.items.has(item.id)) await item.delete(); } catch {}
  await reset(fighter, fKeep); await reset(dummy, dKeep);
  if (ai % 10 === 0) { await clearChat(); seen = new Set(); await clearZones(); }
}
log("виды алхимии:", JSON.stringify(actions));
}
await clearChat(); await clearZones();
stepName("готово");
log("нажатия кнопок:", JSON.stringify(counts));
log("конец части 3");
