// Возможности 2.4.0 (PLAN 4.129): сохранённые части в добыче чудовищ, слот зачарования, медвежья форма берсерка,
// расследование с броском у ведущего.
const BF = await import("/systems/vedmak/module/character/bear-form.mjs");
const EN = await import("/systems/vedmak/module/crafting/enhancements.mjs");
const CR = await import("/systems/vedmak/module/crafting/craft.mjs");
const INV = await import("/systems/vedmak/module/investigation/investigation.mjs");
const docOf = async (pack, name) => { const p = game.packs.get(`vedmak.${pack}`); const e = (await p.getIndex()).find(x => x.name === name); return e ? p.getDocument(e._id) : null; };

stepName("добыча");
const bestiary = await game.packs.get("vedmak.bestiary").getDocuments();
const withHead = bestiary.filter(m => m.system.loot.some(l => l.name === "Сохранённая голова"));
ok(withHead.length > 0, `сохранённая голова в добыче у ${withHead.length} чудовищ`);
const row = withHead[0]?.system.loot.find(l => l.name === "Сохранённая голова");
ok((await fromUuid(row?.uuid ?? ""))?.name === "Сохранённая голова", "строка добычи ведёт на компонент");

stepName("слот зачарования");
const smith = await Actor.create({ name: "Прогон: кузнец", type: "character", folder: folder.id });
const sword = (await game.packs.get("vedmak.weapons").getDocuments()).find(w => w.name === "Кинжал").toObject();
const [w] = await smith.createEmbeddedDocuments("Item", [{ ...sword, _id: undefined }]);
await w.update({ "system.reliability.value": w.system.reliability.max, "system.enhancementSlots": 0 });
const slotDoc = await docOf("enhancements", "Слот зачарования");
ok(slotDoc?.system.kind === "slot", "«Слот зачарования» в компендиуме усилений");
const [slot] = await smith.createEmbeddedDocuments("Item", [{ ...slotDoc.toObject(), _id: undefined }]);
await EN.attachEnhancement(smith, slot); await wait(600);
ok(w.system.enhancementSlots === 1 && !smith.items.has(slot.id), `оружию +1 ячейка, слот израсходован (ячеек ${w.system.enhancementSlots})`);
await w.update({ "system.reliability.value": 0 });
const [slot2] = await smith.createEmbeddedDocuments("Item", [{ ...slotDoc.toObject(), _id: undefined }]);
await EN.attachEnhancement(smith, slot2); await wait(400);
ok(w.system.enhancementSlots === 1, "на сломанное оружие слот не ставится");

stepName("медвежья форма");
const bear = await Actor.create({ name: "Прогон: берсерк", type: "character", folder: folder.id });
await placeToken(bear, 1000, 1000);
await bear.createEmbeddedDocuments("Item", [{ ...(await docOf("professions", "Берсерк")).toObject(), _id: undefined }]);
await bear.system.profession.update({ "system.definingSkill.value": 4 });
await CR.giveItem(bear, (await docOf("gear", "Мардрём")).toObject(), 2);
const max0 = bear.system.hp.max;
await BF.bearTransform(bear); await wait(800);
ok(!!BF.bearFormEffect(bear), "берсерк превращается в медведя");
ok(bear.system.hp.max > max0, `ПЗ в форме больше (${max0} → ${bear.system.hp.max})`);
ok(CR.countNamed(bear, "Мардрём") === 1, "превращение тратит гриб «Мардрём»");
ok(A.attackSources(bear).some(s => /медвеж/i.test(s.label)), "в бою — оружие медвежьей формы");
await BF.bearRevert(bear); await wait(800);
ok(!BF.bearFormEffect(bear) && bear.system.hp.max === max0, "выход из формы возвращает человека");

stepName("расследование");
const list = INV.mysteries();
const m = INV.newMystery(); const c = INV.newClue(); c.dc = 1; m.clues.push(c); m.participants.push(smith.uuid); m.visible = true;
await INV.saveMysteries([...list, m]);
await game.vedmak.investigation.evidenceCheck?.(smith, m.id, c.id);
await wait(1500);
ok(INV.mysteries().find(x => x.id === m.id)?.clues[0]?.found === true, "улика со СЛ 1 разгадана броском у ведущего");
await INV.saveMysteries(list);
