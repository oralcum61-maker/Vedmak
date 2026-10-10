// Решения автора 10.10 (PLAN 4.136): снаряды отбивает только ведьмак «Отбиванием стрел», без оружия не парируют,
// Энергия жреца — общий пул (не выше 12), стартовая магия «Мага огня» 6/2.
const DEF = D;
const profPack = game.packs.get("vedmak.professions");
const idx = await profPack.getIndex({ fields: ["system.key"] });
const profDoc = key => profPack.getDocument(idx.find(e => e.system?.key === key)._id);
stepName("Маг огня");
const fire = await profDoc("fireMage");
ok(fire.system.magicQuota.spell === 6 && fire.system.magicQuota.ritual === 2, `«Маг огня»: заклинаний ${fire.system.magicQuota.spell}, ритуалов ${fire.system.magicQuota.ritual}`);

stepName("Энергия жреца");
const pr = await Actor.create({ name: "Прогон: жрец", type: "character", folder: folder.id });
const [prof] = await pr.createEmbeddedDocuments("Item", [{ ...(await profDoc("priest")).toObject(), _id: undefined }]);
for (const [a, b, want] of [[0, 0, 2], [4, 0, 6], [10, 0, 12], [6, 4, 12], [8, 6, 12], [10, 10, 12]]) {
  await prof.update({ "system.branches": prof.toObject().system.branches.map(br => ({ ...br, abilities: br.abilities.map(x =>
    ({ ...x, value: x.name === "Божественная сила" ? a : x.name === "Единение с природой" ? b : 0 })) })) });
  ok(pr.system.derived.vigor === want, `Божественная сила ${a} + Единение ${b} → Энергия ${pr.system.derived.vigor} (ждём ${want})`);
}

stepName("парирование и отбивание");
const roll = { total: 15, rolls: [] };
const thrown = { label: "Нож", weapon: { name: "Нож", isThrown: true, isRanged: true }, isRanged: true, roll, attacker: { name: "Проба" } };
const arrow = { label: "Лук", weapon: { name: "Лук", isBow: true, isRanged: true }, isRanged: true, roll, attacker: { name: "Проба" } };
const melee = { label: "Меч", weapon: { name: "Меч", isRanged: false }, isRanged: false, roll, attacker: { name: "Проба" } };
const witcherProf = (await profDoc("witcher")).toObject();
const dagger = (await game.packs.get("vedmak.weapons").getDocuments()).find(w => w.name === "Кинжал").toObject();
const mk = async (name, ability, weapon) => {
  const a = await Actor.create({ name, type: "character", folder: folder.id, "system.stats.dex.base": 8 });
  const items = [];
  if (ability !== null) {
    const pd = foundry.utils.deepClone(witcherProf);
    for (const b of pd.system.branches) for (const ab of b.abilities) if (ab.name === "Отбивание стрел") ab.value = ability;
    items.push({ ...pd, _id: undefined });
  }
  if (weapon) items.push({ ...dagger, _id: undefined, system: { ...dagger.system, equipped: true } });
  if (items.length) await a.createEmbeddedDocuments("Item", items);
  return a;
};
const w5 = await mk("Прогон: ведьмак", 5, true), w0 = await mk("Прогон: ведьмак без навыка", 0, true);
const wBare = await mk("Прогон: ведьмак без оружия", 5, false), human = await mk("Прогон: человек", null, true);
const bare = await mk("Прогон: безоружный", null, false);
const warns = []; const ow = ui.notifications.warn.bind(ui.notifications);
ui.notifications.warn = (m, ...r) => { warns.push(String(m)); return ow(m, ...r); };
const tryDef = async (a, atk, def) => {
  warns.length = 0;
  const msg = await ChatMessage.create({ content: "проба", flags: { vedmak: { attack: atk } } });
  const card = await DEF.defend(msg, { actorUuid: a.uuid }, def, { skipDialog: true });
  await msg.delete();
  return { refused: warns.length > 0, why: warns.join("; "), card };
};
let r = await tryDef(w5, thrown, "deflect"); ok(!r.refused && r.card?.flags?.vedmak?.defense?.label === "Отбивание стрел", "ведьмак отбивает метательное");
r = await tryDef(w5, arrow, "deflect"); ok(!r.refused, "ведьмак отбивает стрелу");
r = await tryDef(w5, melee, "deflect"); ok(r.refused, `«отбить» удар меча нельзя (${r.why})`);
r = await tryDef(w5, thrown, "parry"); ok(r.refused, "парировать снаряд нельзя даже ведьмаку");
r = await tryDef(w0, thrown, "deflect"); ok(r.refused, "без навыка «Отбивание стрел» — отказ");
r = await tryDef(wBare, thrown, "deflect"); ok(r.refused, "без оружия в руке отбить нельзя");
r = await tryDef(human, thrown, "parry"); ok(r.refused, "человек не парирует снаряд");
r = await tryDef(human, melee, "parry"); ok(!r.refused, "человек с кинжалом парирует меч");
r = await tryDef(bare, melee, "parry"); ok(r.refused, `безоружный не парирует (${r.why})`);
ok(DEF.bestDefense(w5, thrown) === "deflect", "автозащита ведьмака от метательного — отбивание");
ui.notifications.warn = ow;
