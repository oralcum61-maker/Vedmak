// Татуировки «Офира и Зеррикании» (стр. 78–81): нанесение проверкой Искусства, провал — СЛ +1, успех — место на
// теле, Репутация +1 и постоянные поправки; места на голове кончаются после двух.
const T = await import("/systems/vedmak/module/crafting/tattoo.mjs");
const a = await Actor.create({ name: "Прогон: татуировки", type: "character", folder: folder.id,
  system: { stats: { emp: { base: 6 } }, skills: { fineArts: { value: 5 } }, reputation: { value: 2 } } });
const ink = (name, extra = {}) => ({ name, type: "gear", system: { category: "tattoo", effect: "Прогонная поправка.",
  mods: [{ target: "stats.ref", value: 1 }], tattoo: { tier: "veryEasy", dc: 12, achievement: "прогон", size: 0.5 } }, ...extra });
const [first, second, third] = await a.createEmbeddedDocuments("Item", [ink("Татуировка «Прогон»"), ink("Татуировка «Второй»"), ink("Татуировка «Третий»")]);
const rnd = CONFIG.Dice.randomUniform;
try {
  // Провал: на d10 единица (u 0.95 → 1) — чернила потрачены, следующая попытка со СЛ +1
  CONFIG.Dice.randomUniform = () => 0.95;
  await T.applyTattoo(a, first);
  CONFIG.Dice.randomUniform = rnd;
  ok(!first.system.tattoo.applied && first.system.tattoo.tries === 1, `провал: не нанесена, попыток ${first.system.tattoo.tries}`);
  ok(a.system.reputation.value === 2, "провал не даёт Репутации");

  // Успех: место — первое свободное (голова), Репутация +1, поправка татуировки действует
  const refBefore = a.system.stats.ref.mod;
  await surely(() => T.applyTattoo(a, first));
  ok(first.system.tattoo.applied && first.system.tattoo.location === "head", `успех: нанесена на «${first.system.tattoo.location}»`);
  ok(a.system.reputation.value === 3, `Репутация +1: ${a.system.reputation.value}`);
  ok(a.system.stats.ref.mod === refBefore + 1, `поправка нанесённой татуировки действует: Реа mod ${refBefore} → ${a.system.stats.ref.mod}`);
  ok(lastMine()?.content.includes("Нанесена"), "карточка нанесения в чате");

  // Уже нанесённую второй раз не наносят
  await T.applyTattoo(a, first);
  ok(a.system.reputation.value === 3, "повтор по нанесённой — без проверки и Репутации");

  // Голова вмещает две: вторая — тоже на голову, третья уходит на корпус
  await surely(() => T.applyTattoo(a, second));
  await surely(() => T.applyTattoo(a, third));
  const slots = T.tattooSlots(a);
  ok(slots.head === 2 && third.system.tattoo.location === "torso", `места: голова ${slots.head}/2, третья — «${third.system.tattoo.location}»`);
  ok(a.system.stats.ref.mod === refBefore + 3, "три нанесённые — три поправки");
} finally {
  CONFIG.Dice.randomUniform = rnd;
}
