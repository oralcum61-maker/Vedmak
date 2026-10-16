// Верховая езда и транспорт (стр. 169–171): Реа + Верховая езда (Мореходство) + скакун против СЛ манёвра; провал —
// потеря управления (наездник и скакун — d10, транспорт — d6); «без седла» только верхом, «таран упряжкой» — упряжке.
const M = await import("/systems/vedmak/module/combat/mounted.mjs");
const a = await Actor.create({ name: "Прогон: всадник", type: "character", folder: folder.id,
  system: { stats: { ref: { base: 7 } }, skills: { riding: { value: 4 }, sailing: { value: 2 } } } });
const rnd = CONFIG.Dice.randomUniform;
const cfg = (o = {}) => ({ mount: "horse", maneuver: "simple", luck: 0, mod: 0, dcCustom: "", noSaddle: false, reins: false, ramDrawn: false, ...o });
const flags = () => lastMine()?.flags.vedmak?.control;
try {
  // Успех: лошадь, простой манёвр
  await surely(() => M.rollControl(a, cfg()));
  ok(flags()?.success === true && flags().mount === "horse", "лошадь, простой манёвр — управление удержано");
  ok(lastMine().content.includes("Лошадь"), "карточка называет скакуна");

  // Провал верхом: потеря управления у наездника и у скакуна
  CONFIG.Dice.randomUniform = () => 0.95;
  await M.rollControl(a, cfg({ maneuver: "veryDifficult" }));
  CONFIG.Dice.randomUniform = rnd;
  const c1 = lastMine();
  ok(c1.flags.vedmak.control.success === false, "очень сложный манёвр на единице — провал");
  ok(c1.content.includes("Наездник") && c1.content.includes("Скакун"), "потеря управления: наездник и скакун");

  // Провал на повозке: таблица транспорта
  CONFIG.Dice.randomUniform = () => 0.95;
  await M.rollControl(a, cfg({ mount: "cart" }));
  CONFIG.Dice.randomUniform = rnd;
  ok(lastMine().content.includes("Транспорт") && !lastMine().content.includes("Наездник"), "повозка: потеря управления транспортом");

  // Поправки окна: «без седла» −2 только верхом, «таран упряжкой» −10 только упряжке, лодка — Мореходство
  const label = () => lastMine().content;
  await surely(() => M.rollControl(a, cfg({ noSaddle: true, ramDrawn: true })));
  ok(label().includes("Без седла") && !label().includes("Таран упряжкой"), "лошадь: «без седла» есть, «таран упряжкой» нет");
  await surely(() => M.rollControl(a, cfg({ mount: "carriage", noSaddle: true, ramDrawn: true })));
  ok(!label().includes("Без седла") && label().includes("Таран упряжкой"), "карета: «таран упряжкой» есть, «без седла» нет");
  await surely(() => M.rollControl(a, cfg({ mount: "sailboat" })));
  ok(label().includes("Мореходство"), "лодка — Мореходство");
} finally {
  CONFIG.Dice.randomUniform = rnd;
}
