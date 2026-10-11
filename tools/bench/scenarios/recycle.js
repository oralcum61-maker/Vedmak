// Переработка после провала ремесла через обход карточек (crawl), как в обходе sweep4: метка «переработано» ставится
// до броска и сразу перерисовывает карточку — кнопка отцепляется от страницы, хотя бросок и выдача ещё впереди.
// Обход должен дождаться конца действия, иначе обход sweep4 удалял предметы посреди переработки
// («undefined id … does not exist in the EmbeddedCollection», PLAN 4.165). Окно броска нажимается с задержкой.
const a = await Actor.create({ name: "Прогон: переработка", type: "character", folder: folder.id });
const ORE = "Прогонная руда";
// Порядок созданных документов не гарантирован (рецепт приходил не первым — сценарий падал раз в несколько прогонов)
const created = await a.createEmbeddedDocuments("Item", [
  { name: "Чертёж: прогонный слиток", type: "recipe",
    system: { dc: 50, components: [{ name: ORE, quantity: 4 }], result: { name: "Прогонный слиток", type: "gear", quantity: 1 } } },
  { name: "Инструменты ремесленника", type: "gear", system: { tool: "craftsman" } },
  { name: ORE, type: "component", system: { quantity: 4 } }
]);
const recipe = created.find(d => d.type === "recipe");
const CR = await import("/systems/vedmak/module/crafting/craft.mjs");
const rnd = CONFIG.Dice.randomUniform;
CONFIG.Dice.randomUniform = () => 0.5;
let slow = null;
try {
  await CR.craft(a, recipe, { skipDialog: true });
  const card = lastMine();
  ok(card?.flags.vedmak?.craft && !card.flags.vedmak.craft.recycled, "карточка изготовления с переработкой");
  ok(!a.items.some(i => i.name === ORE), "провал при СЛ 50: руда потрачена");
  // Переработка — по той же СЛ из карточки; понижаем, чтобы она удалась
  await card.setFlag("vedmak", "craft.dc", 2);
  await wait(300);

  window.__noAutoDialog = true;
  slow = Hooks.on("renderDialogV2", app => setTimeout(() => app.element?.querySelector('[data-action="roll"]')?.click(), 700));
  const t0 = performance.now();
  await crawl("переработка", 0);
  const ms = Math.round(performance.now() - t0);
  const back = a.items.find(i => i.name === ORE);
  ok(back?.system.quantity === 2, `обход вернулся после конца переработки (${ms} мс): руды ${back?.system.quantity ?? 0}, ждём 2`);
  ok(game.messages.contents.filter(mine).some(m => m.content.includes("Переработка")), "карточка переработки уже в чате");
  // Как обход sweep4: сразу убрать всё созданное — посреди переработки это роняло обновление удалённой стопки
  await a.deleteEmbeddedDocuments("Item", a.items.map(i => i.id));
  await wait(1200);
  ok(!a.items.size, `после уборки предметов не появилось: ${a.items.map(i => i.name).join(", ")}`);
} finally {
  if (slow !== null) Hooks.off("renderDialogV2", slow);
  window.__noAutoDialog = false;
  CONFIG.Dice.randomUniform = rnd;
}
await clearChat();
await a.delete();
