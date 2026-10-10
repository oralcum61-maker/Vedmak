// Часть 2: бой. Каждое оружие компендиума — каждым видом атаки по чудовищу; каждое чудовище бестиария бьёт бойца
// всеми своими атаками и получает удар. Карточки прокликиваются до применения урона.
const chars = game.actors.filter(a => a.type === "character" && !a.folder?.name?.startsWith("Прогон"));
log("персонажей в мире:", chars.length, chars.map(a => a.name).join(", "));
const base = chars.sort((a, b) => b.items.size - a.items.size)[0];
const fighter = await cloneActor(base, "Прогон: боец");
const bestiary = game.packs.get("vedmak.bestiary");
const monsterDocs = await bestiary.getDocuments();
const dummySrc = monsterDocs.find(m => /бандит|разбойник|солдат/i.test(m.name)) ?? monsterDocs[0];
const dummy = await Actor.create({ ...dummySrc.toObject(), _id: undefined, name: "Прогон: чучело", folder: folder.id });
const fTok = await placeToken(fighter, 1000, 1000);
const dTok = await placeToken(dummy, 1100, 1000);
const fKeep = snapshot(fighter), dKeep = snapshot(dummy);
log("боец:", base.name, "чучело:", dummySrc.name);

// --- Оружие ---
const weapons = [];
for (const pack of game.packs.filter(p => p.documentName === "Item" && p.metadata.packageName === "vedmak")) {
  const idx = await pack.getIndex({ fields: ["type"] });
  if (!idx.some(e => e.type === "weapon")) continue;
  for (const d of await pack.getDocuments({ type: "weapon" })) weapons.push(d);
}
log("оружия в компендиумах:", weapons.length);
const LIMIT_W = Number(window.__limitW ?? 9999);
let wi = 0;
for (const w of weapons.slice(Number(window.__fromW ?? 0), LIMIT_W)) {
  wi++;
  stepName(`оружие ${wi}/${weapons.length}: ${w.name}`);
  let item;
  try {
    const data = w.toObject(); delete data._id;
    data.system.equipped = true;
    [item] = await fighter.createEmbeddedDocuments("Item", [data]);
    // Боеприпас для стрелкового — если нужен, оружие возьмёт любой подходящий из рюкзака
    const src = A.describeSource(fighter, { kind: "weapon", itemId: item.id });
    if (!src) { log("ERR нет источника", w.name); continue; }
    const types = Object.keys(src.types ?? {});
    if (!types.length) log("ERR нет видов атаки", w.name);
    for (const [ti, type] of types.entries()) {

      stepName(`оружие ${w.name}: ${type}`);
      const msg = await A.attack(fighter, { kind: "weapon", itemId: item.id }, { skipDialog: true, attackType: type, mod: 6, targets: [C.targetInfo(dTok)] });
      if (!msg) { log("нет карточки атаки:", w.name, type); continue; }
      if (ti === 0) await crawl(`оружие ${w.name}: ${type}`, 4);
      else {
        // Прочие виды — коротко: защита по выбору системы, урон, применение
        seen.add(msg.id);
        const def = D.bestDefense(dummy, msg.flags.vedmak.attack);
        await D.defend(msg, C.targetInfo(dTok), def, { skipDialog: true });
        const dm = lastMine();
        seen.add(dm.id);
        if (dm.flags.vedmak?.defense?.canDamage) {
          await G.damageFromDefense(dm, { skipDialog: true });
          const gm = lastMine();
          seen.add(gm.id);
          if (gm.flags.vedmak?.damage) await G.requestApplyDamage(gm);
        }
      }
      await reset(dummy, dKeep);
    }
  } catch (e) { log("ERR оружие", w.name, e.message, (e.stack ?? "").split("\n").slice(1, 3).join(" ")); }
  try { if (item) await item.delete(); } catch {}
  await reset(fighter, fKeep);
  if (wi % 10 === 0) { await clearChat(); seen = new Set(); }
}
await clearChat(); seen = new Set();

// --- Чудовища ---
const LIMIT_M = Number(window.__limitM ?? 9999);
let mi = 0;
for (const md of monsterDocs.slice(Number(window.__fromM ?? 0), LIMIT_M)) {
  mi++;
  stepName(`чудовище ${mi}/${monsterDocs.length}: ${md.name}`);
  let mon, mTok;
  try {
    mon = await Actor.create({ ...md.toObject(), _id: undefined, folder: folder.id });
    mTok = await placeToken(mon, 1000, 1100);
    const mKeep = snapshot(mon);
    const sources = A.attackSources(mon);
    for (const src of sources) {
      for (const type of Object.keys(src.types ?? {}).slice(0, 2)) {
        stepName(`чудовище ${md.name}: ${src.label} / ${type}`);
        const source = src.kind === "weapon" || src.kind === "shield" || src.kind === "prosthetic" ? { kind: src.kind, itemId: src.item?.id } : { kind: src.kind };
        const msg = await A.attack(mon, source, { skipDialog: true, attackType: type, mod: 6, targets: [C.targetInfo(fTok)] });
        if (msg) await crawl(`чудовище ${md.name}: ${src.label}/${type}`, 4);
        await reset(fighter, fKeep);
      }
    }
    // Удар по чудовищу — без оружия
    stepName(`по чудовищу ${md.name}`);
    const msg = await A.attack(fighter, { kind: "unarmed" }, { skipDialog: true, attackType: "punch", mod: 6, targets: [C.targetInfo(mTok)] });
    if (msg) await crawl(`по чудовищу ${md.name}`, 4);
    await reset(mon, mKeep);
  } catch (e) { log("ERR чудовище", md.name, e.message, (e.stack ?? "").split("\n").slice(1, 3).join(" ")); }
  try { if (mTok) await mTok.delete(); if (mon) await mon.delete(); } catch {}
  if (mi % 5 === 0) { await clearChat(); seen = new Set(); }
}
await clearChat();
stepName("готово");
log("нажатия кнопок:", JSON.stringify(counts));
log("конец части 2");
