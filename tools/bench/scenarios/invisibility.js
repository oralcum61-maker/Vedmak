// Невидимость чудовищ и урон от падения сбитого летуна (PLAN 4.145).
const MT = await import("/systems/vedmak/module/combat/monster-traits.mjs");
const ST = await import("/systems/vedmak/module/combat/statuses.mjs");
const bestiary = game.packs.get("vedmak.bestiary");
const bIdx = await bestiary.getIndex();
const fromBestiary = async re => { const e = bIdx.find(x => re.test(x.name)); return e ? (await bestiary.getDocument(e._id)).toObject() : null; };
const sum = parts => parts.reduce((s, p) => s + p.value, 0);

stepName("брукса");
const bruxa = await Actor.create({ ...(await fromBestiary(/^Брукса/)), folder: folder.id });
await bruxa.toggleStatusEffect("invisible", { active: true });
ok(MT.monsterTraits(bruxa).invisibility === "superior", "у бруксы — превосходная невидимость");
ok(sum(ST.statusRollMods(bruxa, "attack").filter(p => /невидим/i.test(p.label))) === 5, "брукса: +5 к атаке");
ok(sum(ST.statusRollMods(bruxa, "defense").filter(p => /невидим/i.test(p.label))) === 5, "брукса: +5 к защите");
await MT.dropInvisibility(bruxa, "hit");
ok(!bruxa.statuses.has("invisible"), "попадание снимает превосходную невидимость");

stepName("катакан");
const fighter = await Actor.create({ name: "Прогон: боец", type: "character", folder: folder.id });
const dagger = (await game.packs.get("vedmak.weapons").getDocuments()).find(w => w.name === "Кинжал").toObject();
const [blade] = await fighter.createEmbeddedDocuments("Item", [{ ...dagger, _id: undefined, system: { ...dagger.system, equipped: true } }]);
const fTok = await placeToken(fighter, 1000, 1000);
const kat = await Actor.create({ ...(await fromBestiary(/^Катакан/)), folder: folder.id });
await placeToken(kat, 1100, 1000);
await kat.toggleStatusEffect("invisible", { active: true });
ok(MT.monsterTraits(kat).invisibility === "basic", "у катакана — обычная невидимость");
ok(sum(MT.invisibleOpponentPart(kat)) === -3, "противнику невидимого катакана −3");
const s0 = A.attackSources(kat).find(x => x.kind === "weapon") ?? A.attackSources(kat)[0];
const src = s0.kind === "weapon" ? { kind: "weapon", itemId: s0.item?.id } : { kind: s0.kind };
const type = Object.keys(s0.types ?? { single: 1 })[0];
const atk = await A.attack(kat, src, { skipDialog: true, attackType: type, mod: 6, targets: [C.targetInfo(fTok)] });
const ad = atk.flags.vedmak.attack;
ok(ad.attackerUnseen === true && ad.roll.parts.some(p => /невидим/i.test(p.label) && p.value === 5), "атака из невидимости: +5 и признак в данных атаки");
ok(!kat.statuses.has("invisible"), "атакой обычная невидимость снимается");
await D.defend(atk, C.targetInfo(fTok), "dodge", { skipDialog: true });
ok(lastMine().flags.vedmak.defense.roll.parts.some(p => /невидим/.test(p.label) && p.value === -3), "защита от атаки из невидимости — с −3");
const atk2 = await A.attack(kat, src, { skipDialog: true, attackType: type, mod: 6, targets: [C.targetInfo(fTok)] });
await D.defend(atk2, C.targetInfo(fTok), "dodge", { skipDialog: true });
ok(!lastMine().flags.vedmak.defense.roll.parts.some(p => /невидим/.test(p.label)), "вторая атака уже видимого — без штрафа");

stepName("падение");
const harpy = await Actor.create({ ...(await fromBestiary(/^Гарпия/)), folder: folder.id });
const hTok = await placeToken(harpy, 1000, 1200);
await hTok.update({ elevation: 10 });
const thr = MT.monsterTraits(harpy).flight?.threshold;
ok(thr === 5, `порог сбивания гарпии ${thr}`);
let fell = "";
for (let i = 0; i < 8 && !fell; i++) {
  const m = await A.attack(fighter, { kind: "weapon", itemId: blade.id }, { skipDialog: true, attackType: "strong", mod: 30, targets: [C.targetInfo(hTok)] });
  await D.defend(m, C.targetInfo(hTok), "dodge", { skipDialog: true });
  const dc = lastMine();
  if (!dc.flags.vedmak?.defense?.canDamage) continue;
  await G.damageFromDefense(dc, { skipDialog: true });
  await G.requestApplyDamage(lastMine());
  await wait(1500);
  const text = game.messages.contents.filter(mine).slice(-4).map(x => x.content.replace(/<[^>]+>/g, " ")).join(" ");
  if (/сбит в полёте/.test(text)) fell = text;
}
ok(!!fell, "сильный удар сбивает гарпию в полёте");
ok(/Падение \(|удержался/.test(fell), "сбитая гарпия проверяет Атлетику и при провале получает урон от падения");
ok(hTok.elevation === 0, "токен сбитой гарпии — на земле");
