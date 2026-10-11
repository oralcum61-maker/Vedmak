// Бонус к ПЗ (баффы заклинаний и формы, PLAN 4.133): при снятии уходит только непотраченный остаток — снятие не лечит.
const B = await import("/systems/vedmak/module/magic/buffs.mjs");
for (const [hp, max, bonus, base, want, what] of [
  [30, 30, 25, 5, 5, "бафф +25 на раненом 5/30, не бит"],
  [20, 30, 25, 5, 5, "бафф +25, урон 10 съел бонус"],
  [0, 30, 25, 5, 0, "бафф +25, урон 30 — бонус и 5 своих"],
  [75, 30, 30, 30, 30, "форма с полными ПЗ, не бита"],
  [25, 30, 30, 30, 25, "форма, урон 50"],
  [35, 30, 25, null, 30, "эффект без отметки ПЗ (до 09.10) — по-старому"]
]) ok(B.hpAfterBonus(hp, max, bonus, base) === want, `${what}: ${B.hpAfterBonus(hp, max, bonus, base)} (ждём ${want})`);
const a = await Actor.create({ name: "Прогон: раненый", type: "character", folder: folder.id });
await a.update({ "system.hp.value": 5 });
const max = a.system.hp.max;
const eff = await B.applyBuff(a, { name: "Проба: +25 ПЗ", img: "icons/svg/heal.svg", changes: [{ key: "system.fx.hp", type: "add", value: 25 }] });
ok(a.system.hp.value === 30 && a.system.hp.max === max + 25, `бафф: ${a.system.hp.value}/${a.system.hp.max}`);
await eff.delete(); await wait(800);
ok(a.system.hp.value === 5 && a.system.hp.max === max, `после снятия: ${a.system.hp.value}/${a.system.hp.max} — снятие не вылечило`);
