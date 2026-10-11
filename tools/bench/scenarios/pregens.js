// Заготовки канонических персонажей (PLAN 4.149): каждая импортируется из компендиума, открывает лист без ошибок,
// бьёт оружием; ведьмак творит знак, чародейка — заклинание; высший вампир — с ОК и оружием расы.
const M = await import("/systems/vedmak/module/magic/cast.mjs");
const pack = game.packs.get("vedmak.pregens");
ok(!!pack, "компендиум «Заготовки персонажей» есть");
const docs = await pack.getDocuments();
ok(docs.length >= 20, `заготовок: ${docs.length}`);
const dummy = await Actor.create({ name: "Прогон: чучело", type: "character", folder: folder.id });
const dTok = await placeToken(dummy, 1500, 1000);
let sheetsOk = 0, attacksOk = 0;
for (const [i, d] of docs.entries()) {
  stepName(d.name);
  const a = await Actor.create({ ...d.toObject(), folder: folder.id });
  const t = await placeToken(a, 1000, 600 + (i % 6) * 100);
  ok(a.system.race && a.system.profession, `${a.name}: раса «${a.system.race?.name}», профессия «${a.system.profession?.name}»`);
  ok(a.system.hp.value === a.system.hp.max && a.system.hp.max > 0, `${a.name}: ПЗ полные (${a.system.hp.value}/${a.system.hp.max})`);
  await a.sheet.render({ force: true }); await wait(250);
  if (a.sheet.rendered) sheetsOk++;
  await a.sheet.close();
  const src = A.attackSources(a).find(s => s.kind === "weapon") ?? A.attackSources(a)[0];
  const type = Object.keys(src.types ?? {})[0];
  const msg = await A.attack(a, src.kind === "weapon" ? { kind: "weapon", itemId: src.item.id } : { kind: src.kind }, { skipDialog: true, attackType: type, targets: [C.targetInfo(dTok)] });
  if (msg) attacksOk++;
  if (a.system.profession?.system.key === "witcher") {
    const aard = a.items.find(x => x.name === "Аард");
    if (aard) {
      const card = await M.castSpell(a, aard, { skipDialog: true, targets: [C.targetInfo(dTok)] });
      ok(!!card, `${a.name}: знак «Аард» сотворён`);
    }
  }
  if (a.system.profession?.system.key === "mage") {
    const sp = a.items.find(x => x.type === "spell");
    const card = await M.castSpell(a, sp, { skipDialog: true, targets: [C.targetInfo(dTok)] });
    ok(!!card, `${a.name}: заклинание «${sp?.name}» сотворено`);
  }
  if (a.system.raceKey === "highVampire") ok(a.system.blood.value > 0 && a.items.some(x => x.name === "Когти высшего вампира"), `${a.name}: ОК ${a.system.blood.value}, когти расы`);
  await t.delete(); await a.delete();
}
ok(sheetsOk === docs.length, `листы открылись у всех (${sheetsOk}/${docs.length})`);
ok(attacksOk === docs.length, `атаковать смогли все (${attacksOk}/${docs.length})`);
