// Бессмертие и регенерация ранений (PLAN 4.219): вампир-персонаж не умирает до −максимума ПЗ, «Вампирская регенерация»
// лечит ранения по раундам (вне боя — сразу); чудовище с «Бессмертием» лечит ранения 1/2/4/6 раундов и возвращается
// через недели по отрицательным ПЗ.
const IM = await import("/systems/vedmak/module/combat/immortality.mjs");
const DM = await import("/systems/vedmak/module/combat/damage.mjs");
const SV = await import("/systems/vedmak/module/combat/saves.mjs");
const races = game.packs.get("vedmak.races");
const raceDoc = await races.getDocument((await races.getIndex({ fields: ["system.key"] })).find(e => e.system?.key === "highVampire")._id);
const hit = (actor, final, crit = null) => DM.applyDamageToActor(actor, {
  final, location: "torso", nonLethal: false, blockable: false, ablate: false, penetrated: false,
  crit: crit ? { wound: crit, woundLocation: "torso" } : null, effects: [], staLoss: 0, stunSave: false, wear: null
});
const wounds = a => a.items.filter(i => i.type === "critWound");
const addWound = async (a, key) => {
  const cfg = CONFIG.VEDMAK.CRIT_WOUNDS?.[key] ?? (await import("/systems/vedmak/module/config/combat.mjs")).CRIT_WOUNDS[key];
  const [w] = await a.createEmbeddedDocuments("Item", [{ name: cfg.label, type: "critWound", system: { wound: key, location: "torso", state: "fresh" } }]);
  return w;
};

stepName("вампир-персонаж: бессмертие");
const v = await Actor.create({ name: "Прогон: бессмертный", type: "character", folder: folder.id, "system.stats.body.base": 6 });
await v.createEmbeddedDocuments("Item", [{ ...raceDoc.toObject(), _id: undefined }]);
const tok = await placeToken(v, 1200, 1000);
ok(IM.isImmortalPC(v), "раса «Высший вампир» — бессмертен");
const max = v.system.hp.max;
let r = await hit(v, v.system.hp.value + 5);
ok(v.system.hp.value === -5 && !r.deathSave && r.lines.some(l => /Бессмертие/.test(l)), `ПЗ −5: испытания против смерти нет (${r.lines.at(-1)})`);
ok(await SV.rollDeathSave(v) === null && !v.statuses.has("dead"), "испытание против смерти вручную — не нужно, жив");
r = await hit(v, 1, "decapitation"); await wait(800);
ok(!v.statuses.has("dead") && r.lines.some(l => /не убивает/.test(l)), "отсечение головы не убивает высшего вампира");

stepName("регенерация ранений вне боя");
ok(!IM.critRegenKind(v), "регенерация не открыта — ранения не лечатся");
await v.system.race.update({ "system.powers": v.system.race.system.toObject().powers.map(p => p.key === "critHealing" ? { ...p, value: 1 } : p) });
ok(IM.critRegenKind(v) === "pc", "«Вампирская регенерация» открыта");
await addWound(v, "brokenRibs"); await wait(1200);
ok(!wounds(v).length, `вне боя ранения исцеляются сразу (осталось ${wounds(v).length})`);

stepName("регенерация ранений в бою");
const combat = await Combat.create({ scene: canvas.scene.id, active: true });
await combat.createEmbeddedDocuments("Combatant", [{ tokenId: tok.id, sceneId: canvas.scene.id, actorId: v.id }]);
await combat.startCombat(); await wait(1500);
const deadly = await addWound(v, "heartDamage");
const light = await addWound(v, "crackedJaw");
await wait(800);
ok(wounds(v).length === 2, `в бою ранения остаются до хода (${wounds(v).length})`);
// Ход за ходом — настоящим началом хода (combat.mjs): одно ранение за раз, с лёгких
await combat.nextRound(); await wait(1500);
ok(!v.items.get(light.id) && v.items.get(deadly.id), "сначала лёгкое — за раунд");
let rounds = 0;
for (; rounds < 6 && v.items.get(deadly.id); rounds++) {
  await combat.nextRound(); await wait(1500);
  if (rounds === 0) ok(v.items.get(deadly.id)?.system.state === "stabilized", "смертельное сразу стабилизировано");
}
ok(rounds === 4 && !v.items.get(deadly.id), `смертельное — за ${rounds} раунда (ждали 4)`);
await addWound(v, "sprainedArm"); await wait(500);
await combat.delete(); await wait(1200);
ok(!wounds(v).length, "бой окончен — оставшиеся ранения исцелены");

stepName("окончательная смерть");
await hit(v, v.system.hp.value + max + 1); await wait(1200);
ok(v.statuses.has("dead"), `ниже −${max} ПЗ (${v.system.hp.value}) — окончательная смерть`);

stepName("чудовище: ранения и возвращение");
const best = game.packs.get("vedmak.bestiary");
const mIdx = (await best.getIndex()).find(e => e.name === "Высший вампир");
const m = await Actor.create({ ...(await best.getDocument(mIdx._id)).toObject(), _id: undefined, name: "Прогон: высший вампир", folder: folder.id });
ok(IM.isImmortalMonster(m) && IM.critRegenKind(m) === "monster", "«Бессмертие» чудовища узнано");
const c2 = await Combat.create({ scene: canvas.scene.id, active: true });
const mt = await placeToken(m, 1400, 1000);
await c2.createEmbeddedDocuments("Combatant", [{ tokenId: mt.id, sceneId: canvas.scene.id, actorId: m.id }]);
await c2.startCombat(); await wait(1000); // начало хода от боя — до ранения, иначе оно и цикл ниже двигают его оба
const serious = await addWound(m, "fracturedArm");
const need = { simple: 1, complex: 2, difficult: 4, deadly: 6 }[serious.system.level];
let n = 0;
for (; n < 8 && m.items.get(serious.id); n++) {
  await IM.critRegenStartOfTurn(m);
  if (n === 0 && need > 1) ok(m.items.get(serious.id)?.system.state === "stabilized", "после первого раунда стабилизировано");
}
ok(n === need, `${serious.name} (${serious.system.level}) — за ${n} раунд(ов), ждали ${need}`);
await c2.delete();
await m.update({ "system.hp.value": -7 });
await SV.markDead(m); await wait(1200);
const rev = m.getFlag("vedmak", "revival");
ok(rev?.weeks === 7 && rev.at === game.time.worldTime + 7 * 7 * 86400, `убит при −7 ПЗ — вернётся через ${rev?.weeks} нед.`);
const before = game.messages.size;
await game.time.advance(7 * 7 * 86400); await wait(1200);
ok(m.getFlag("vedmak", "revival")?.notified && game.messages.contents.slice(before).some(msg => /может вернуться/.test(msg.content)),
  "срок вышел — ведущему карточка «Вернуть к жизни»");
await IM.revive(m); await wait(500);
ok(!m.statuses.has("dead") && m.system.hp.value === m.system.hp.max && !m.getFlag("vedmak", "revival"), `вернулся: ПЗ ${m.system.hp.value}/${m.system.hp.max}`);
await game.time.advance(-7 * 7 * 86400);
