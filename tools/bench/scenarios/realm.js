// Хозяйство и войско (PLAN 4.203): управляющие построек, заказы мастерских, караваны между поселениями, поход и осада,
// Совет правителя.
const S = game.vedmak.settlement;
const ARMY = game.vedmak.army;
const SC = await import("/systems/vedmak/module/config/settlement.mjs");
const until = async (test, ms = 4000) => { for (let t = 0; t < ms && !test(); t += 100) await wait(100); return test(); };
const bOf = (town, key) => town.system.buildingActors.find(b => b.system.key === key);
const mk = (key, st) => { const d = SC.buildingItemData(key); Object.assign(d.system, st); return d; };

const town = await Actor.create({ name: "Прогон: Вышгород", type: "settlement", folder: folder.id,
  system: { families: 8, militia: 30, stock: { "Еда": 80, "Топливо": 30, "Древесина": 40, "Железо": 20, "Доски": 10, "Камень": 20 } } });
await until(() => town.system.buildingActors.length === 3);
const hero = await Actor.create({ name: "Прогон: Кузнец Брасс", type: "character", folder: folder.id,
  system: { skills: { physique: { value: 6 }, leadership: { value: 8 }, crafting: { value: 5 } } } });

stepName("управляющий");
const lumber = bOf(town, "lumber");
const wood0 = town.system.forecast.produced["Древесина"];
await lumber.update({ "system.manager": hero.uuid }); await wait(300);
const lm = town.system.buildings.find(b => b.key === "lumber").manager;
ok(lm?.skill === "physique" && lm.dice === 2, `лесорубы: навык «Сила» 6 — 2d4 (${JSON.stringify(lm)})`);
ok(town.system.forecast.produced["Древесина"] === wood0 + 5, `к древесине в среднем +5 (${wood0} → ${town.system.forecast.produced["Древесина"]})`);
await hero.update({ "system.skills.physique.value": 9 }); await wait(300);
const lm2 = town.system.buildings.find(b => b.key === "lumber").manager;
ok(lm2?.dice === 3, `управляющий поднял Силу до 9 — поселение пересчиталось: 3d4 (${lm2?.dice})`);
await hero.update({ "system.skills.physique.value": 6 }); await wait(300);
const house = bOf(town, "house");
const c0 = town.system.summary.control;
await house.update({ "system.manager": hero.uuid }); await wait(300);
ok(town.system.summary.control === c0 + 2, "дом без выработки: Лидерство 8 — Контроль +2");
await house.update({ "system.manager": "" });
await lumber.sheet.render({ force: true }); await wait(400);
ok(lumber.sheet.element.querySelector(".rs-stats")?.textContent.includes("Кузнец Брасс"), "на листе постройки — управляющий");
await lumber.sheet.close();

stepName("заказ в мастерской");
await S.createBuildings(town, [mk("smithy", { level: 1, workers: 1 }), mk("tradepost", { level: 1 })]);
const smithy = bOf(town, "smithy");
const sword = await Item.create({ name: "Прогон: короткий меч", type: "weapon", folder: folder.id, system: { cost: 100 } });
const iron0 = town.system.stock["Железо"];
await S.placeOrder(town, smithy.id, sword, hero, 1);
ok(smithy.system.orders.length === 1 && town.system.stock["Железо"] === iron0 - 3, `заказ принят: железо ${iron0} → ${town.system.stock["Железо"]}`);
const shield = await Item.create({ name: "Прогон: щит", type: "armor", folder: folder.id, system: { cost: 50 } });
await S.placeOrder(town, smithy.id, shield, hero, 1);
ok(smithy.system.orders.length === 1, "кузница брони не делает — заказ не принят");

stepName("караван");
const town2 = await Actor.create({ name: "Прогон: Заречье", type: "settlement", folder: folder.id, system: { stock: { "Еда": 30 } } }, { vedmakStarter: false });
await S.addRoute(town, town2.uuid, "Древесина", 5);
ok(town.system.routes.length === 1, "караван в Заречье: древесина 5 в неделю");

stepName("неделя");
await S.advanceWeek(town); await wait(500);
ok(hero.items.some(i => i.name === "Прогон: короткий меч") && !smithy.system.orders.length, "заказ готов: меч у заказчика");
ok(town2.system.stock["Древесина"] === 5, `караван довёз древесину (${town2.system.stock["Древесина"]})`);
const card = game.messages.contents.at(-1)?.content ?? "";
ok(card.includes("Мастерские") && card.includes("Караваны"), "в карточке недели — мастерские и караваны");
ok(card.includes("управляющий"), "в карточке недели — бросок управляющего");

stepName("поход и осада");
const unit = await ARMY.recruit(town, { origin: "militia", count: 20, kind: "infantry", name: "Прогон: дружина" });
const food0 = town.system.stock["Еда"];
await ARMY.marchOut(unit, 2);
ok(unit.system.campaign && unit.system.supplies === 8 && town.system.stock["Еда"] === food0 - 8, `в поход: припасы 8, еда со склада (${food0} → ${town.system.stock["Еда"]})`);
await ARMY.besiege(unit, town2);
ok(town2.system.siege.units.includes(unit.uuid) && unit.system.besieging === town2.uuid, "Заречье в осаде");
ok(!town2.system.summary.trade && !town2.system.summary.arrival, "в осаде нет торговли и прихода семей");
await S.advanceWeek(town2); await wait(400);
ok(town2.system.siege.weeks === 1 && (game.messages.contents.at(-1)?.content ?? "").includes("осад"), "неделя осады: счёт и событие в карточке");
await S.advanceWeek(town); await wait(400);
ok(unit.system.supplies === 4, `в походе отряд ест припасы (${unit.system.supplies})`);
await ARMY.liftSiege(null, town2); await wait(300);
ok(!town2.system.siege.units.length && !unit.system.besieging, "ведущий снял осаду с листа поселения — у отряда отметки осады нет");
await ARMY.besiege(unit, town2); await wait(200);
await ARMY.returnHome(unit); await wait(300);
ok(!unit.system.campaign && !town2.system.siege.units.length, "домой: осада снята");

stepName("Совет правителя");
const council = game.vedmak.council.open(); await wait(600);
ok(council.element.querySelectorAll(".rc-town").length >= 2 && council.element.textContent.includes("Вышгород"), "в Совете — оба поселения");
ok(!!council.element.querySelector("[data-action=weekAll]"), "у ведущего — «Неделя для всех»");
{ // Тревоги на кнопке Совета (PLAN 4.242): поселение в осаде или с нехваткой — красная метка с числом и списком
  await town2.update({ "system.stock.Еда": 0 }); await wait(600);
  const badge = document.querySelector(".vd-council .vd-council-badge");
  ok(!!badge && Number(badge.textContent) > 0 && badge.closest(".vd-council")?.dataset.tooltip?.includes(town2.name),
    `тревоги: метка на кнопке Совета (${badge?.textContent ?? "нет"}) — ${badge?.closest(".vd-council")?.dataset.tooltip?.slice(0, 80) ?? ""}`);
}
await council.close();
{ // «Неделя для всех» (PLAN 4.241): одна сводная карточка вместо карточки на поселение, неделя сдвинулась у обоих
  const w = [town.system.week, town2.system.week];
  const msgs = game.messages.size;
  await game.vedmak.settlement.advanceAll([town, town2]); await wait(500);
  const card = game.messages.contents.at(-1)?.content ?? "";
  ok(game.messages.size === msgs + 1 && card.includes("settlement-weekall") && card.includes(town.name) && card.includes(town2.name),
    `«Неделя для всех»: одна сводная карточка с обоими поселениями (+${game.messages.size - msgs})`);
  ok(town.system.week !== w[0] && town2.system.week !== w[1], "«Неделя для всех»: неделя сдвинулась у обоих");
}

stepName("проверка мира");
{ // Проверка мира (PLAN 4.248): ссылки на удалённых актёров и кривой склад находятся и чинятся без удаления
  const W = game.vedmak.worldCheck;
  const ghost = "Actor.vdGhostTown00000";
  const hadCatalog = !!game.folders.find(f => f.type === "Actor" && f.name === "Каталог построек");
  const lost = await Actor.create({ name: "Прогон: отряд-сирота", type: "unit", folder: folder.id, system: { settlement: ghost, commander: "Actor.vdGhostHero00000" } });
  const ruin = await Actor.create({ ...mk("house", { level: 1 }), name: "Прогон: постройка-сирота", folder: folder.id, system: { ...mk("house", { level: 1 }).system, settlement: ghost } });
  await town2.update({ "system.routes": [...town2.system.toObject().routes, { id: "ghost", to: ghost, resource: "Еда", qty: 1 }], "system.stock.Камень": -5 });
  try {
    const mine = () => W.scanWorld().filter(p => [lost.id, ruin.id, town2.id].includes(p.actor.id));
    const found = mine();
    const has = (doc, word) => found.some(p => p.actor === doc && p.text.includes(word) && p.fix);
    ok(has(lost, "поселению") && has(lost, "командир") && has(ruin, "Каталог") && has(town2, "караван") && has(town2, "Камень"),
      `проверка мира: нашла отряд, командира, постройку, караван и склад (${found.length}: ${found.map(p => p.text.split(" — ")[0]).join("; ")})`);
    // Окно со списком: подтверждение Foundry выделяет «Нет» — «Починить» нажимаем сами
    window.__noAutoDialog = true;
    const hook = Hooks.on("renderDialogV2", app => {
      if (!app.element?.classList.contains("vd-realm-world-check")) return;
      Hooks.off("renderDialogV2", hook);
      setTimeout(() => {
        ok(app.element.querySelectorAll(".realm-check li").length >= 5 && app.element.querySelector("footer [data-action=yes]")?.textContent.includes("Починить"),
          `окно проверки: список неполадок и «Починить» (${app.element.querySelectorAll(".realm-check li").length})`);
        app.element.querySelector("footer [data-action=yes]").click();
      }, 200);
    });
    const n = await W.askWorldCheck().finally(() => { window.__noAutoDialog = false; }); await wait(400);
    ok(n >= 5 && !lost.system.settlement && !lost.system.commander && !ruin.system.settlement && ruin.folder?.name === "Каталог построек",
      `«Починить»: ссылки обнулены, постройка — образцом в каталоге (починено ${n})`);
    ok(!town2.system.routes.some(r => r.to === ghost) && town2.system.stock["Камень"] === 0 && !!game.actors.get(lost.id) && !!game.actors.get(ruin.id),
      "«Починить»: караван отменён, Камень 0, актёры не удалены");
    ok(!mine().some(p => p.fix), "после починки — чинить нечего");
  } finally {
    for (const d of [lost, ruin]) if (game.actors.get(d.id)) await d.delete();
    if (!hadCatalog) await game.folders.find(f => f.type === "Actor" && f.name === "Каталог построек")?.delete();
  }
}

stepName("шаблоны поселений");
{ // Шаблоны (PLAN 4.246): печать в шапке листа сохраняет поселение, «Новое поселение…» в Совете основывает из шаблона
  const T = S.templates;
  const nextDialog = name => new Promise(res => {
    const id = Hooks.on("renderDialogV2", app => {
      if (!app.element?.classList.contains(`vd-realm-${name}`)) return;
      Hooks.off("renderDialogV2", id); setTimeout(() => res(app), 150);
    });
  });
  const had = T.templates().length;
  window.__noAutoDialog = true;
  let made = null;
  try {
    await town.sheet.render({ force: true }); await wait(600);
    let next = nextDialog("template-save");
    town.sheet.element.querySelector('[data-action="saveTemplate"]').click();
    let dlg = await next;
    dlg.element.querySelector("input[name=name]").value = "Прогон: шаблон";
    dlg.element.querySelector("footer button").click();
    await until(() => T.templates().some(t => t.name === "Прогон: шаблон"));
    const tpl = T.templates().find(t => t.name === "Прогон: шаблон");
    const levels = d => d.map(b => `${b.system.key}:${b.system.level}`).sort().join(",");
    ok(tpl?.buildings.length === town.system.buildingActors.length && tpl.system.families === town.system.families
      && levels(tpl.buildings) === levels(town.system.buildingActors),
      `шаблон: постройки с уровнями и семьи (${tpl?.buildings.length} построек, семей ${tpl?.system.families})`);
    ok(tpl && !tpl.buildings.some(b => b.system.manager || b.system.orders?.length || b.system.settlement) && !("log" in tpl.system),
      "шаблон: без управляющих, заказов, связи с поселением и летописи");
    await town.sheet.close();

    const council = game.vedmak.council.open(); await wait(600);
    next = nextDialog("template-new");
    council.element.querySelector("[data-action=newTown]").click();
    dlg = await next;
    ok(dlg.element.querySelectorAll(".realm-tpl").length === had + 2, `новое поселение: «С нуля» и шаблоны (${dlg.element.querySelectorAll(".realm-tpl").length})`);
    dlg.element.querySelector(`input[name=tpl][value="${tpl.id}"]`).checked = true;
    dlg.element.querySelector("input[name=name]").value = "Прогон: Новгородок";
    dlg.element.querySelector("footer button").click();
    await until(() => (made = game.actors.find(a => a.name === "Прогон: Новгородок")) && made.system.buildingActors.length === tpl.buildings.length, 6000);
    const peer = game.actors.find(a => a.type === "settlement");
    ok(!!made && levels(made.system.buildingActors) === levels(tpl.buildings) && made.system.stockMap["Еда"] === tpl.system.stock["Еда"]
      && made.system.week === peer.system.week && made.system.month === peer.system.month,
      `новое из шаблона: те же постройки и склад, календарь как у мира (${made?.system.buildingActors.length} построек)`);
    ok(made && !made.system.log.length && !made.system.routes.length, "новое из шаблона: летопись и караваны пустые");
    await made?.sheet.close();

    next = nextDialog("template-new");
    council.element.querySelector("[data-action=newTown]").click();
    dlg = await next;
    const sure = nextDialog("confirm");
    dlg.element.querySelector(`[data-tpl-delete="${tpl.id}"]`).click();
    const yes = await sure;
    yes.element.querySelector("footer button[data-action=yes]").click();
    await until(() => !T.templates().some(t => t.id === tpl.id) && !dlg.element.querySelector(`[data-tpl-delete="${tpl.id}"]`));
    ok(!T.templates().some(t => t.id === tpl.id) && !dlg.element.querySelector(`[data-tpl-delete="${tpl.id}"]`), "✕ удаляет шаблон и его карточку");
    await dlg.close();
    await council.close();
  } finally {
    window.__noAutoDialog = false;
    for (const t of T.templates().filter(t => t.name.startsWith("Прогон"))) await game.settings.set("vedmak", "settlementTemplates",
      Object.fromEntries(T.templates().filter(x => x.id !== t.id).map(x => [x.id, x])));
    if (made) {
      for (const b of made.system.buildingActors) await b.delete();
      await game.folders.find(x => x.getFlag("vedmak", "settlement") === made.uuid)?.delete();
      await made.delete();
    }
  }
}

for (const b of [...town.system.buildingActors, ...town2.system.buildingActors]) await b.delete();
for (const t of [town, town2]) await game.folders.find(x => x.getFlag("vedmak", "settlement") === t.uuid)?.delete();
for (const d of [unit, sword, shield, hero, town2, town]) if (d && (game.actors.get(d.id) || game.items.get(d.id))) await d.delete();
