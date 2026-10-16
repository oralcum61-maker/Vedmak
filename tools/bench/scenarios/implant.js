// Вживление рун и глифов («Офир и Зеррикания», стр. 84–86): СЛ от подопытного, вся Вын мага, поправки руны, заклинание
// глифа, камень из сумки; провал — вторая мутация; не больше двух; удаление вживлённого убирает всё связанное.
const I = await import("/systems/vedmak/module/crafting/implant.mjs");
const a = await Actor.create({ name: "Прогон: вживление", type: "character", folder: folder.id,
  system: { stats: { body: { base: 6 }, will: { base: 8 }, int: { base: 7 } }, skills: { spellCasting: { value: 6 } } } });
const rnd = CONFIG.Dice.randomUniform;
try {
  ok(I.implantDc(a, "rune") === 28 - Math.floor((6 + 8) / 2), `СЛ руны: 28 − (Тел + Воля)/2 = ${I.implantDc(a, "rune")}`);
  ok(I.implantDc(a, "rune", "large") === I.implantDc(a, "rune") + 2, "большой камень — СЛ +2");
  ok(I.implantDc(a, "glyph") === 28 - Math.floor((6 + Math.floor(8 / 2)) / 2), `СЛ глифа: 28 − (Тел + Воля/2)/2 = ${I.implantDc(a, "glyph")}`);

  // Руна Перун (обычный камень): +2 Скор, камень из сумки израсходован, Вын мага — в ноль
  await a.createEmbeddedDocuments("Item", [{ name: "Руна «Перун»", type: "enhancement", system: { quantity: 2 } }]);
  const spd = a.system.stats.spd.mod;
  await surely(() => I.implant(a, { kind: "rune", key: "perun", tier: "normal", mage: a, spend: true }));
  ok(I.implantsOf(a).length === 1 && a.system.derived.implants === 1, `вживлено: ${I.implantsOf(a).length}`);
  ok(a.system.derived.mutagens === 0, "гнёзд мутагенов вживлённое не занимает");
  ok(a.system.stats.spd.mod === spd + 2, `руна Перун, обычный камень: Скор mod ${spd} → ${a.system.stats.spd.mod}`);
  ok(a.items.find(i => i.name === "Руна «Перун»")?.system.quantity === 1, "камень из сумки израсходован");
  ok(a.system.sta.value === 0, "вся Вын мага потрачена");
  ok(!a.items.some(i => i.flags?.vedmak?.implant?.extra), "успех — без второй мутации");

  // Глиф Аард с провалом: заклинание глифа из компендиума и вторая мутация
  CONFIG.Dice.randomUniform = () => 0.95;
  await I.implant(a, { kind: "glyph", key: "aard", mage: a });
  CONFIG.Dice.randomUniform = rnd;
  const glyph = I.implantsOf(a).find(i => i.flags.vedmak.implant.kind === "glyph");
  ok(!!glyph, "глиф вживлён и при провале");
  ok(a.items.some(i => i.type === "spell" && i.name === "Вживлённый глиф: Аард"), "заклинание глифа — на листе");
  ok(a.items.some(i => i.flags?.vedmak?.implant?.extra), "провал — вторая малая мутация");
  ok(a.system.derived.implants === 2, "вживлённых два");

  // Третье — нельзя
  const before = a.items.size;
  await I.implantDialog(a);
  ok(a.items.size === before, "третье вживление окно не открывает");

  // Удалили глиф — ушли и его заклинание, и вторая мутация
  await glyph.delete();
  await wait(800);
  ok(!a.items.some(i => i.type === "spell" && i.name === "Вживлённый глиф: Аард"), "удаление глифа убирает его заклинание");
  ok(!a.items.some(i => i.flags?.vedmak?.implant?.extra), "и вторую мутацию");
  ok(a.system.derived.implants === 1, "вживлённых снова одно");
} finally {
  CONFIG.Dice.randomUniform = rnd;
}
