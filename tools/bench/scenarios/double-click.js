// Двойной щелчок (16.10): действие с ценой или ходом времени срабатывает один раз, пока первое не закончилось.
// Раньше «Неделя прошла» дважды подряд гнала две недели с одного состояния, «Заложить» и решение события платили дважды.
const S = game.vedmak.settlement;
const town = await Actor.create({ name: "Прогон: двойной щелчок", type: "settlement", folder: folder.id,
  system: { families: 4, wealth: 10, stock: { "Еда": 40, "Топливо": 20, "Древесина": 40, "Камень": 20 } } }, { vedmakStarter: false });
try {
  // Неделя: два вызова подряд — одна неделя, одна запись летописи
  const at = s => s.year * 1000 + s.month * 10 + s.week;
  const before = at(town.system);
  await Promise.all([S.advanceWeek(town), S.advanceWeek(town)]);
  ok(town.system.log.length === 1, `две «Неделя прошла» подряд — одна неделя в летописи (${town.system.log.length})`);
  ok(at(town.system) > before, "неделя всё же прошла");
  await S.advanceWeek(town);
  ok(town.system.log.length === 2, "после первой — следующая неделя проходит");

  // Заложить с листа двойным щелчком: одна постройка, цена — один раз
  const sheet = town.sheet;
  await sheet.render({ force: true });
  await wait(600);
  sheet.tab = "buildings";
  sheet.showCatalog = true;
  await sheet.render();
  await wait(500);
  const btn = [...sheet.element.querySelectorAll('[data-action="build"]')].find(b => !b.disabled);
  ok(!!btn, "в каталоге есть что заложить");
  if (btn) {
    const count = town.system.buildings.length;
    btn.click(); btn.click();
    await wait(2500);
    ok(town.system.buildings.length === count + 1, `двойной щелчок «Заложить» — одна постройка (${town.system.buildings.length - count})`);
  }
  await sheet.close();
} finally {
  for (const b of town.system.buildingActors ?? []) await b.delete();
  game.folders.find(f => f.getFlag("vedmak", "settlement") === town.uuid)?.delete();
  await town.delete();
}
