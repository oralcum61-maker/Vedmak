// Недоделанное из «Не сделано» (PLAN 4.179): глифы и глифовы слова брони, отвар из накера, «Упрямство» людей,
// «Охота» ведьмака — +2 к Подготовке ведьмака против класса чудовищ.
const GL = await import("/systems/vedmak/module/crafting/glyphs.mjs");
const SB = await import("/systems/vedmak/module/character/stubborn.mjs");
const LP = await import("/systems/vedmak/module/character/lifepath.mjs");
const AL = await import("/systems/vedmak/module/crafting/alchemy.mjs");
const docOf = async (pack, name) => { const p = game.packs.get(`vedmak.${pack}`); const e = (await p.getIndex()).find(x => x.name === name); return e ? (await p.getDocument(e._id)).toObject() : null; };
const glyph = name => ({ name, kind: "glyph", sp: 0, resist: [], effect: "", element: "" });
const armorBase = (await game.packs.get("vedmak.armor").getDocuments()).find(a => (a.system.sp?.torso?.max ?? 0) > 0 && a.system.encumbrance > 0).toObject();

stepName("глифы брони");
const wearer = await Actor.create({ name: "Прогон: в глифах", type: "character", folder: folder.id });
const cha0 = wearer.system.skills.charisma.mod, hp0 = wearer.system.hp.max;
const [armor] = await wearer.createEmbeddedDocuments("Item", [{ ...armorBase, _id: undefined, system: { ...armorBase.system, equipped: true,
  enhancementSlots: 3, enhancements: [glyph("Глиф сопротивления"), glyph("Глиф восстановления"), glyph("Глиф огня")] } }]);
ok(armor.system.allResistances.includes("elemental"), "«Глиф сопротивления»: броня сопротивляется стихийному урону");
ok(GL.spellGlyph(wearer, { kind: "spell", element: "fire" }) === "Глиф огня", "«Глиф огня» узнаёт заклинание огня");
ok(!GL.spellGlyph(wearer, { kind: "spell", element: "water" }), "к заклинанию воды «Глиф огня» не подходит");
await wearer.update({ "system.hp.value": 5 });
await wearer.update({ "system.hp.value": 8 });
ok(wearer.system.hp.value === 9, `«Глиф восстановления»: лечение на 3 дало 4 (${wearer.system.hp.value})`);
await wearer.update({ "system.hp.value": 3 });
ok(wearer.system.hp.value === 3, "урон глиф не трогает");
const spPlus = GL.spPlus(armor.system.toObject().sp, 3);
ok(spPlus.torso.max === armor.system.sp.torso.max + 3, `«Глиф укрепления»: ПБ торса ${armor.system.sp.torso.max} → ${spPlus.torso.max}`);

const [word] = await wearer.createEmbeddedDocuments("Item", [{ ...armorBase, _id: undefined, name: "Прогон: броня со словом",
  system: { ...armorBase.system, equipped: true, enhancementSlots: 3, enhancements: [glyph("Глифово слово: Заблуждение")] } }]);
ok(wearer.system.skills.charisma.mod === cha0 + 1, `«Заблуждение»: +1 к Харизме (${cha0} → ${wearer.system.skills.charisma.mod})`);
await word.update({ "system.enhancements": [glyph("Глифово слово: Защита")] });
ok(wearer.system.hp.max === hp0 + 5, `«Защита»: +5 ПЗ (${hp0} → ${wearer.system.hp.max})`);
await word.update({ "system.enhancements": [glyph("Глифово слово: Вес")] });
ok(word.system.effectiveEncumbrance === armorBase.system.encumbrance * 2, `«Вес»: Скованность ×2 (${armorBase.system.encumbrance} → ${word.system.effectiveEncumbrance})`);
await word.update({ "system.enhancements": [glyph("Глифово слово: Вращение")] });
ok(GL.glyphFlag(wearer, "noUnseen") === "Глифово слово: Вращение", "«Вращение»: нет штрафа против невидимого нападающего");
await word.update({ "system.enhancements": [glyph("Глифово слово: Возмездие")] });
ok(GL.glyphSum(wearer, "retaliate").value === 3, "«Возмездие»: 3 урона нападающему");
await word.update({ "system.equipped": false });
ok(!GL.glyphSum(wearer, "retaliate").value, "снятая броня глифов не даёт");

stepName("отвар из накера");
const witcher = await Actor.create({ name: "Прогон: ведьмак", type: "character", folder: folder.id });
const wRace = await docOf("races", "Ведьмак");
await witcher.createEmbeddedDocuments("Item", [{ ...wRace, _id: undefined }]);
const riding0 = witcher.system.skills.riding.mod;
const nekker = await docOf("alchemy", "Отвар из накера");
const [brew] = await witcher.createEmbeddedDocuments("Item", [{ ...nekker, _id: undefined, system: { ...nekker.system, quantity: 2 } }]);
await AL.drink(witcher, brew); await wait(500);
ok(witcher.system.skills.riding.mod === riding0 + 3 && witcher.system.skills.athletics.mod >= 3,
  `+3 к Верховой езде и Атлетике (${riding0} → ${witcher.system.skills.riding.mod})`);

stepName("«Упрямство»");
const human = await Actor.create({ name: "Прогон: упрямый", type: "character", folder: folder.id });
await human.createEmbeddedDocuments("Item", [{ ...(await docOf("races", "Человек")), _id: undefined }]);
ok(SB.stubbornLimit(human) === 3, `у людей — 3 раза за партию (${SB.stubbornLimit(human)})`);
ok(SB.stubbornOffer(human, "courage") && !SB.stubbornOffer(human, "athletics"), "только Храбрость и Сопротивление убеждению");
ok(!SB.stubbornOffer(witcher, "courage"), "у ведьмака черты нет");
await human.rollSkill("courage", { skipDialog: true, dc: 99 }); await wait(300);
const msg = lastMine() ?? game.messages.contents.at(-1);
ok(msg.flags.vedmak?.check?.stubborn?.left === 3 && msg.content.includes('data-vedmak="stubborn"'), "провал — на карточке кнопка «Упрямство»");
const first = msg.flags.vedmak.check.total;
await SB.stubbornReroll(msg); await wait(300);
const used = msg.flags.vedmak.check.stubbornUsed;
ok(used && used.first === first && msg.flags.vedmak.check.total === Math.max(first, used.second), `взят больший из ${first} и ${used?.second}`);
ok(!msg.content.includes('data-vedmak="stubborn"'), "второй раз на этой проверке нельзя");
ok(SB.stubbornLeft(human) === 2, `осталось 2 (${SB.stubbornLeft(human)})`);

stepName("«Охота» ведьмака");
let saved = null, classes = [];
for (let i = 0; i < 300 && !classes.length; i++) {
  const rolls = {};
  classes = LP.buildLifepath(rolls, { witcher: true, age: 120, region: "north", race: "witcher" }).effects.huntClasses;
  saved = LP.writeLifepath({ rolls, witcher: true, age: 120, region: "north", race: "witcher" });
}
ok(classes.length > 0, `жизненный путь с охотой: ${classes.join(", ")}`);
await witcher.update({ "system.lifepath": saved });
ok(LP.huntClasses(witcher).join() === [...new Set(classes)].join(), "классы читаются из сохранённого пути");
await witcher.createEmbeddedDocuments("Item", [{ ...(await docOf("professions", "Ведьмак")), _id: undefined }]);
const { MONSTER_CLASSES } = await import("/systems/vedmak/module/data/actor/monster.mjs");
const clsKey = Object.entries(MONSTER_CLASSES).find(([, v]) => v === classes[0])?.[0];
const prey = await Actor.create({ name: "Прогон: добыча", type: "monster", folder: folder.id, "system.monsterClass": clsKey });
await placeToken(witcher, 1000, 1400);
const preyTok = await placeToken(prey, 1100, 1400);
preyTok.object?.setTarget(true, { releaseOthers: true });
const res = await witcher.rollDefining({ skipDialog: true });
preyTok.object?.setTarget(false); await wait(800);
ok(res?.parts.some(p => p.value === 2 && p.label.includes(classes[0])), `против цели класса «${classes[0]}» — +2 к Подготовке ведьмака`);

stepName("глиф огня в заклинании");
const M = await import("/systems/vedmak/module/magic/cast.mjs");
const pg = game.packs.get("vedmak.pregens");
const mageDoc = (await pg.getDocuments()).find(d => d.items.some(i => i.type === "spell") && d.system.profession?.system.key === "mage");
const mage = await Actor.create({ ...mageDoc.toObject(), name: "Прогон: маг в глифах", folder: folder.id });
await mage.createEmbeddedDocuments("Item", [{ ...armorBase, _id: undefined, name: "Прогон: мантия с глифом",
  system: { ...armorBase.system, equipped: true, enhancementSlots: 3, enhancements: [glyph("Глиф огня")] } }]);
const waveDoc = await docOf("magic", "Волна огня");
const [wave] = await mage.createEmbeddedDocuments("Item", [{ ...waveDoc, _id: undefined }]);
await mage.update({ "system.vigor.value": 99 });
const castMsg = await M.castSpell(mage, wave, { skipDialog: true, mod: 30, targets: [] }); await wait(400);
const castText = (castMsg?.content ?? lastMine()?.content ?? "");
ok(castText.includes("Глиф огня: СЛ заклинания +3"), "«Волна огня» с глифом огня: СЛ +3 (по умолчанию для заклинаний с защитой)");
const castDmg = await M.castSpell(mage, wave, { skipDialog: true, mod: 30, glyph: "damage", targets: [] }); await wait(400);
ok((castDmg?.content ?? lastMine()?.content ?? "").includes("Глиф огня: урон +1d6"), "выбор «урон +1d6» — к урону");
