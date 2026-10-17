// Окна поселения и войска на общем каркасе (PLAN 4.226, module/apps/realm-dialog.mjs): каждое открывается из своей
// кнопки, в нём — данные листа, имена экранированы; «Набрать» из окна набирает отряд.
window.__noAutoDialog = true;
const nextDialog = name => new Promise(res => {
  const id = Hooks.on("renderDialogV2", app => {
    if (!app.element?.classList.contains(`vd-realm-${name}`)) return;
    Hooks.off("renderDialogV2", id);
    setTimeout(() => res(app), 150);
  });
});
// «После…» (PLAN 4.236): ввести число в поле и прочитать раздел — пересчитан ли
const typeIn = async (dlg, name, value) => {
  const el = dlg.element.querySelector(`[name=${name}]`); el.value = String(value);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); await wait(300);
  const box = dlg.element.querySelector("[data-realm-after]");
  return { text: box?.textContent.replace(/\s+/g, " ").replace(/\s*→\s*/g, " → ").trim() ?? "", bad: !!box?.querySelector(".realm-cell.bad") };
};
const town = await Actor.create({ name: "Прогон: окна <Липов>", type: "settlement", folder: folder.id,
  system: { militia: 30, families: 4, wealth: 7.4, stock: { "Еда": 40 } } }, { vedmakStarter: false });
const sheet = town.sheet;
try {
  await sheet.render({ force: true });
  await wait(700);

  // Казна
  let wait1 = nextDialog("wealth");
  sheet.element.querySelector('[data-action="wealth"][data-mode="withdraw"]').click();
  let dlg = await wait1;
  const input = dlg.element.querySelector("input[name=units]");
  ok(input?.max === "7.4" && input.step === "0.1", `казна: взять до 7,4 десятыми (max ${input?.max}, step ${input?.step})`);
  ok(dlg.element.querySelector(".hint")?.textContent.includes("в казне 7,4"), "казна: подсказка — сколько в казне");
  { const box = dlg.element.querySelector("[data-realm-after]"); input.value = "2"; input.dispatchEvent(new Event("input", { bubbles: true })); await wait(300);
    ok(/7,4\s*→\s*5,4/.test(box?.textContent ?? ""), `казна: «После…» пересчитывается при вводе (${box?.textContent.replace(/\s+/g, " ").trim()})`); }
  await dlg.close();

  // Событие (ведущий)
  sheet.tab = "chronicle"; await sheet.render(); await wait(400);
  wait1 = nextDialog("event");
  sheet.element.querySelector('[data-action="addEvent"]').click();
  dlg = await wait1;
  const opts = dlg.element.querySelectorAll("select[name=key] option");
  ok(opts.length > 3 && opts[0].value === "", `событие: «случайное» и список событий (${opts.length})`);
  await dlg.close();

  // Набор: окно с данными поселения; имя с угловыми скобками — текстом, а не разметкой
  sheet.tab = "army"; await sheet.render(); await wait(400);
  wait1 = nextDialog("recruit");
  sheet.element.querySelector('[data-action="recruit"]').click();
  dlg = await wait1;
  const origin = dlg.element.querySelector("select[name=origin]");
  ok(origin?.options[0].textContent.includes("есть 30"), "набор: Ополчение — 30 чел.");
  ok(dlg.element.querySelector("input[name=name]")?.placeholder === "Ополчение Прогон: окна <Липов>", "набор: имя поселения экранировано");
  ok(dlg.element.querySelectorAll("select[name=kind] option").length >= 4, "набор: роды войск");
  { let a = await typeIn(dlg, "count", 6);
    ok(/Ополчение\s*30\s*→\s*24/.test(a.text) && /Бойцов в новом отряде\s*0\s*→\s*6/.test(a.text) && !a.bad, `набор: «После…» — Ополчение 30 → 24, бойцов 0 → 6 (${a.text})`);
    a = await typeIn(dlg, "count", 40);
    ok(/30\s*→\s*-10/.test(a.text) && a.bad, `набор: больше, чем есть, — строка красная (${a.text})`);
    await typeIn(dlg, "origin", "mercenary");
    a = await typeIn(dlg, "count", 2);
    ok(a.text.includes("Казна") && !a.text.includes("Ополчение"), `набор: наёмники — «После…» о казне (${a.text})`);
    await typeIn(dlg, "origin", "militia"); await typeIn(dlg, "count", 6); }
  dlg.element.querySelector("input[name=name]").value = "Прогон: окна — дружина";
  dlg.element.querySelector('footer button[data-action="ok"], footer button[autofocus], footer button').click();
  await wait(1500);
  const unit = game.actors.find(a => a.name === "Прогон: окна — дружина");
  ok(unit?.system.soldiers === 6 && town.system.militia === 24, `«Набрать» из окна: отряд ${unit?.system.soldiers}, Ополчение ${town.system.militia}`);
  unit?.sheet.close();

  // Поход и осада — с листа отряда
  if (unit) {
    const other = await Actor.create({ name: "Прогон: окна — Гарвена", type: "settlement", folder: folder.id }, { vedmakStarter: false });
    const us = unit.sheet;
    await us.render({ force: true }); await wait(600);
    wait1 = nextDialog("march");
    us.element.querySelector('[data-action="march"]')?.click();
    dlg = await wait1;
    ok(dlg.element.querySelector("input[name=weeks]")?.value === "2", "поход: припасов на 2 недели по умолчанию");
    { const food = unit.system.food, have = town.system.stockMap["Еда"], need = Math.round(food * 3 * 10) / 10;
      let a = await typeIn(dlg, "weeks", 3);
      const n = v => (Math.round(v * 10) / 10).toLocaleString("ru-RU");
      ok(a.text.includes(`${n(have)} → ${n(have - need)}`) && a.text.includes("Припасы отряда") && !a.bad,
        `поход: «После…» — еда ${n(have)} → ${n(have - need)} за 3 нед. (${a.text})`);
      a = await typeIn(dlg, "weeks", Math.ceil(have / Math.max(food, 0.1)) + 5);
      ok(a.bad, "поход: еды на складе не хватит — строка красная");
      await typeIn(dlg, "weeks", 2); }
    dlg.element.querySelector("footer button").click();
    await wait(1200);
    ok(unit.system.campaign, "«В поход» из окна — отряд в походе");
    await us.render(); await wait(400);
    wait1 = nextDialog("siege");
    us.element.querySelector('[data-action="besiege"]')?.click();
    dlg = await wait1;
    ok([...dlg.element.querySelectorAll("select[name=town] option")].some(o => o.textContent === other.name), "осада: в списке чужое поселение");
    await dlg.close();
    await us.close();
    await other.delete();
  }
  // Заказ мастерской (перетащили предмет на лист постройки): «После…» — склад за штуку × сколько и срок
  {
    const SC = await import("/systems/vedmak/module/config/settlement.mjs");
    const d = SC.buildingItemData("smithy"); Object.assign(d.system, { level: 1, workers: 1 });
    const [smithy] = await game.vedmak.settlement.createBuildings(town, [d]);
    const sword = await Item.create({ name: "Прогон: окна — меч", type: "weapon", folder: folder.id, system: { cost: 100 } });
    try {
      const { cost, weeks } = SC.orderCost("weapon", 100, 1, sword.name);
      const iron = cost.find(c => c.resource === "Железо");
      // На складе — ровно на три штуки: две — хватает, четыре — нет
      await town.update(Object.fromEntries(cost.filter(c => c.resource !== "Богатство").map(c => [`system.stock.${c.resource}`, c.qty * 3])));
      const have = iron.qty * 3;
      const wo = nextDialog("order");
      smithy.sheet._onDropItem(new Event("drop"), sword);
      const o = await wo;
      let a = await typeIn(o, "qty", 2);
      ok(a.text.includes(`Железо ${have} → ${have - iron.qty * 2}`) && a.text.includes(`0 → ${weeks * 2}`) && !a.bad,
        `заказ: «После…» — железо ${have} → ${have - iron.qty * 2}, срок ${weeks * 2} нед. (${a.text})`);
      a = await typeIn(o, "qty", 4);
      ok(a.bad, "заказ: железа не хватит — строка красная");
      await o.close(); await wait(300);
      ok(!smithy.system.orders.length, "заказ: окно закрыли — заказа нет");
    } finally {
      await sword.delete(); await smithy.delete();
      await game.folders.find(x => x.getFlag("vedmak", "settlement") === town.uuid)?.delete();
    }
  }
  // Предпросмотр недели (PLAN 4.239): окно с прогнозом; «Отмена» — неделя стоит, «Неделя прошла» — идёт
  {
    sheet.tab = "economy"; await sheet.render(); await wait(400);
    const week0 = town.system.week;
    let wp = nextDialog("week");
    sheet.element.querySelector('[data-action="week"]')?.click();
    let w = await wp;
    ok(!!w.element.querySelector(".realm-dlg-week") && w.element.querySelector(".realm-lead")?.textContent.includes("неделя"), "неделя: предпросмотр открылся");
    ok(w.element.querySelectorAll(".realm-cell").length >= 1, `неделя: в предпросмотре строки склада (${w.element.querySelectorAll(".realm-cell").length})`);
    w.element.querySelector('[data-action="no"]')?.click(); await wait(600);
    ok(town.system.week === week0, "неделя: «Отмена» — неделя не сдвинулась");
    wp = nextDialog("week");
    sheet.element.querySelector('[data-action="week"]')?.click();
    w = await wp;
    w.element.querySelector('[data-action="yes"]')?.click(); await wait(2500);
    ok(town.system.week !== week0 || town.system.month !== 4, `неделя: «Неделя прошла» — неделя сдвинулась (${week0} → ${town.system.week})`);
  }
} finally {
  window.__noAutoDialog = false;
  await sheet.close();
  for (const a of game.actors.filter(a => a.type === "unit" && a.system.settlement === town.uuid)) await a.delete();
  await town.delete();
}
