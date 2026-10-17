// Экран ведущего (PLAN 4.250, module/apps/gm-screen.mjs): герои игроков, тайная проверка отмеченных одной карточкой
// ведущему, бросок генератора с вложенными таблицами, заметки переживают перерисовку героев, кнопка на панели сцены.
const until = async (test, ms = 4000) => { for (let t = 0; t < ms && !test(); t += 100) await wait(100); return test(); };
const GS = game.vedmak.gmScreen;
const player = game.users.find(u => !u.isGM);
const notes0 = game.settings.get("vedmak", "gmNotes");
const mk = name => Actor.create({ name, type: "character", folder: folder.id, ownership: { default: 0, [player.id]: 3 } });
const geralt = await mk("Прогон: экран — Геральт");
const dandy = await mk("Прогон: экран — Лютик");
const made = [];
let app = null;
try {
  ok(!!player, "в мире есть игрок");
  app = GS.open(); await until(() => app.rendered && app.element.querySelector(".gs-hero")); await wait(400);
  const card = a => app.element.querySelector(`.gs-hero[data-uuid="${a.uuid}"]`);
  ok(!!card(geralt) && !!card(dandy), `герои игроков на экране (${app.element.querySelectorAll(".gs-hero").length})`);
  ok(card(geralt)?.querySelector(".gs-bar.hp b")?.textContent.includes(`${geralt.system.hp.value} / ${geralt.system.hp.max}`)
    && card(geralt).textContent.includes(player.name), "у героя — ПЗ и имя игрока");

  // Тайная проверка: Лютика сняли с отметки — в карточке только Геральт; карточку видит только ведущий
  const box = card(dandy).querySelector("input[data-pick]"); box.checked = false; box.dispatchEvent(new Event("change", { bubbles: true }));
  for (const a of game.actors.filter(a => a.type === "character" && a.hasPlayerOwner && ![geralt.id].includes(a.id))) app.picked.delete(a.id);
  const sel = app.element.querySelector("select[name=skill]"); sel.value = "awareness"; sel.dispatchEvent(new Event("change", { bubbles: true }));
  const dc = app.element.querySelector("input[name=dc]"); dc.value = "12"; dc.dispatchEvent(new Event("change", { bubbles: true }));
  const n0 = game.messages.size;
  app.element.querySelector("[data-action=groupCheck]").click();
  await until(() => game.messages.size > n0);
  const msg = game.messages.contents.at(-1);
  ok(msg?.content.includes("gm-check") && msg.content.includes(geralt.name) && !msg.content.includes(dandy.name) && msg.content.includes("СЛ 12"),
    "тайная проверка: одна карточка, только отмеченный герой, со Сложностью");
  ok(msg?.whisper.length > 0 && msg.whisper.every(id => game.users.get(id)?.isGM) && game.messages.size === n0 + 1,
    `карточка — шёпот ведущему, без карточек героев (+${game.messages.size - n0})`);
  made.push(...game.messages.contents.slice(n0).map(m => m.id));

  // Генератор с подтаблицами: строки ступенями
  const pack = game.packs.get("vedmak.generators");
  const idx = await pack.getIndex();
  const tav = idx.find(e => e.name === "Генератор Таверн");
  const n1 = game.messages.size;
  app.element.querySelector(`[data-action=rollTable][data-uuid="${tav?.uuid}"]`)?.click();
  await until(() => game.messages.size > n1, 6000);
  const gm = game.messages.contents.at(-1);
  ok(gm?.content.includes("gm-table") && gm.content.includes("Генератор Таверн") && gm.whisper.length > 0, "генератор: бросок ведущему");
  ok(gm?.content.includes("gmt-sub"), "генератор: вложенные таблицы брошены внутри");
  made.push(...game.messages.contents.slice(n1).map(m => m.id));

  // Поиск по генераторам
  const find = app.element.querySelector("input[name=genFind]"); find.value = "таверн"; find.dispatchEvent(new Event("input", { bubbles: true }));
  const shown = [...app.element.querySelectorAll(".gs-gen-col [data-action=rollTable]")].filter(b => !b.hidden);
  ok(shown.length > 0 && shown.every(b => b.textContent.toLowerCase().includes("таверн")), `поиск генераторов: осталось ${shown.length}`);

  // Заметки: ввод сохраняется в мир; перерисовка героев не трогает поле
  const ta = app.element.querySelector("textarea[name=gmNotes]");
  ta.value = "Прогон: Лютик должен 40 крон"; ta.dispatchEvent(new Event("input", { bubbles: true })); ta.dispatchEvent(new Event("change", { bubbles: true }));
  await until(() => game.settings.get("vedmak", "gmNotes").includes("40 крон"));
  ok(game.settings.get("vedmak", "gmNotes").includes("40 крон"), "заметки сохранены в мире");
  await geralt.update({ "system.hp.value": 3 });
  await until(() => card(geralt)?.querySelector(".gs-bar.hp b")?.textContent.startsWith("3 /"));
  ok(card(geralt)?.querySelector(".gs-bar.hp b")?.textContent.startsWith("3 /") && app.element.querySelector("textarea[name=gmNotes]") === ta,
    "ПЗ героя изменились — столбец героев обновился, поле заметок то же");
  ok(!!ui.controls?.controls?.tokens?.tools?.vedmakGmScreen, "кнопка «Экран ведущего» на панели токенов");
  ok(!!game.keybindings.get("vedmak", "gmScreen")?.length, "клавиши экрана ведущего (Shift+G)");
} finally {
  await app?.close();
  await game.settings.set("vedmak", "gmNotes", notes0);
  const ids = made.filter(id => game.messages.has(id));
  if (ids.length) await ChatMessage.implementation.deleteDocuments(ids);
  for (const d of [geralt, dandy]) await d.delete();
}
