// Высший вампир, третья редакция с правками автора (PLAN 4.133): навыки, Истинная форма (полное лечение, временные ПЗ),
// возврат разума (СЛ 18, −2 за провал), Шкала Зверя после Высасывания, оплата Монарха Выносливостью 2:1, жизненный путь.
const TF = await import("/systems/vedmak/module/character/true-form.mjs");
const M = await import("/systems/vedmak/module/magic/cast.mjs");
const LP = await import("/systems/vedmak/module/character/lifepath.mjs");
const races = game.packs.get("vedmak.races");
const raceDoc = await races.getDocument((await races.getIndex({ fields: ["system.key"] })).find(e => e.system?.key === "highVampire")._id);
const v = await Actor.create({ name: "Прогон: вампир", type: "character", folder: folder.id, "system.stats.will.base": 7, "system.stats.body.base": 6 });
await v.createEmbeddedDocuments("Item", [{ ...raceDoc.toObject(), _id: undefined }]);
await v.system.race.update({ "system.role": "monarch" });
await placeToken(v, 1000, 1000);
await v.update({ "system.blood.value": v.system.blood.max, "system.sta.value": v.system.sta.max });
const p = k => v.system.race.system.power(k);
stepName("навыки");
ok(p("command")?.stat === "will" && p("command")?.value === 4, `Приказ от Воли, на старте 4 (${p("command")?.stat} ${p("command")?.value})`);
ok(p("trueForm")?.dc === 14, `Превращение СЛ 14 (${p("trueForm")?.dc})`);
ok(p("thirstResist")?.value === 4, `Сопротивление Жажде крови 4 (${p("thirstResist")?.value})`);
ok(v.items.some(i => i.name === "Когти высшего вампира" && i.system.damage === "4d6+3") || !v.items.some(i => i.name === "Когти высшего вампира"), "когти 4d6+3");

stepName("истинная форма");
await v.update({ "system.hp.value": 10 });
const max0 = v.system.hp.max;
await v.system.race.update({ "system.powers": v.system.race.system.toObject().powers.map(x => x.key === "trueForm" ? { ...x, value: 3 } : x) });
for (let i = 0; i < 8 && !TF.trueFormEffect(v); i++) {
  await v.update({ "system.blood.value": v.system.blood.max });
  await v.unsetFlag("vedmak", "trueFormBlocked"); await v.unsetFlag("vedmak", "trueFormReady");
  await TF.transform(v, { skipDialog: true }); await wait(400);
}
ok(!!TF.trueFormEffect(v), "превращение удалось");
ok(v.system.hp.value === v.system.hp.max, `вход в форму раненым — все ПЗ (${v.system.hp.value}/${v.system.hp.max})`);
ok(v.system.hp.max >= max0 + 30, `временные ПЗ брони сверху (+30 и Тел): ${max0} → ${v.system.hp.max}`);
const inForm = v.system.hp.max;
await v.update({ "system.hp.value": inForm - 50 });
await TF.endForm(v); await wait(1200);
ok(v.system.hp.value === Math.min(max0, inForm - 50), `выход после 50 урона: ПЗ ${v.system.hp.value} (ждём ${Math.min(max0, inForm - 50)})`);

stepName("возврат разума");
await v.update({ "system.blood.value": v.system.blood.max });
await TF.transform(v, { forced: true }); await wait(500);
const eff = () => TF.trueFormEffect(v)?.flags.vedmak.trueForm;
ok(!!eff()?.frenzy, "насильная форма — звериный срыв");
let dcOk = true, tries = 0;
for (; tries < 12 && eff()?.frenzy; tries++) {
  const f = eff();
  if (TF.regainDc(f) !== Math.max(10, 18 - 2 * (f.fails ?? 0))) dcOk = false;
  await TF.regainControl(v); await wait(250);
}
ok(dcOk, "СЛ возврата: 18 и −2 за каждый провал");
ok(!eff()?.frenzy, `разум вернулся за ${tries} попыток`);
if (TF.trueFormEffect(v)) await TF.trueFormEffect(v).delete();
await wait(600);

stepName("Шкала Зверя");
await v.update({ "system.beast.value": 2 });
let fails = 0;
for (let i = 0; i < 4; i++) { const line = await TF.drainBeastCheck(v); if (/провалено/.test(line)) fails++; }
ok(v.system.beast.value === 2 + fails, `Высасывание: Шкала 2 + ${fails} провала = ${v.system.beast.value}`);

stepName("оплата Выносливостью");
const magic = game.packs.get("vedmak.magic");
const sIdx = (await magic.getIndex({ fields: ["system.kind", "system.branch", "system.staCost", "system.resource"] }))
  .find(e => e.system?.kind === "vampire" && e.system?.branch === "monarch" && e.system?.staCost > 0 && e.system?.resource !== "sta");
const [spell] = await v.createEmbeddedDocuments("Item", [{ ...(await magic.getDocument(sIdx._id)).toObject(), _id: undefined }]);
await v.update({ "system.sta.value": v.system.sta.max });
const sta0 = v.system.sta.value, blood0 = v.system.blood.value;
await M.castSpell(v, spell, { skipDialog: true, payWith: "sta", targets: [] }); await wait(600);
ok(sta0 - v.system.sta.value === spell.system.staCost * 2 && v.system.blood.value === blood0,
  `«${spell.name}» за ${spell.system.staCost} ОК Выносливостью: −${sta0 - v.system.sta.value} Вын, ОК не тронуты`);

stepName("жизненный путь");
const lp = LP.buildLifepath({}, { race: "highVampire" });
const events = lp.sections.find(s => /События/.test(s.title))?.entries.filter(e => !/слава/i.test(e.label ?? "")).length;
ok(events === 3, `событий в жизненном пути: ${events}`);
