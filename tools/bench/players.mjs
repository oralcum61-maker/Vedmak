// Проверки двумя клиентами: ведущий и игрок — два безголовых Edge в тестовом мире (PLAN 4.226).
// Ловят то, чего не видит быстрый набор (он идёт одним ведущим): права Foundry у игрока. Игрок-правитель набирал отряд
// и распускал его — актёров создавать и удалять Foundry игроку не даёт, люди списывались или удваивались.
//
//   node tools/bench/players.mjs          — сервер должен работать на VD_PORT (как у run.mjs)
//   node tools/bench/players.mjs --start  — поднять тестовый Foundry самому и остановить после
//
// Пути — как у run.mjs (VD_FOUNDRY, VD_DATA, VD_NODE, VD_EDGE, VD_PORT, VD_WORLD, VD_USER); игрок — VD_PLAYER
// (пользователь мира с ролью игрока и пустым паролем). Живой мир пользователя не используется.

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { syncSystem } from "./lib/sync.mjs";
import { openClient, sleep } from "./lib/cdp.mjs";

const env = (k, d) => process.env[k] || d;
const CFG = {
  foundry: env("VD_FOUNDRY", "D:/FoundryVTT-WindowsPortable-14.365/App/resources/app"),
  data: env("VD_DATA", "D:/Witcher/_foundry_test"),
  node: env("VD_NODE", "D:/New Folder/node.exe"),
  edge: env("VD_EDGE", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"),
  port: Number(env("VD_PORT", 30014)),
  world: env("VD_WORLD", "test-vedmak"),
  gm: env("VD_USER", "iRVlIbuaU0okU3Ky"),
  player: env("VD_PLAYER", "USl6aWmmccLzLSKJ")
};
const URL = `http://localhost:${CFG.port}`;
const up = async () => { try { return (await fetch(`${URL}/join`)).ok; } catch { return false; } };

let server = null;
if (!(await up())) {
  if (!process.argv.includes("--start")) { console.error(`Тестовый Foundry не отвечает на ${URL}. Запустите с --start.`); process.exit(2); }
  syncSystem(CFG.data, { packs: true });
  rmSync(join(CFG.data, "Config/options.json.lock"), { recursive: true, force: true });
  server = spawn(CFG.node, ["main.mjs", `--dataPath=${CFG.data}`, `--port=${CFG.port}`, "--noupnp", "--noupdate", `--world=${CFG.world}`],
    { cwd: CFG.foundry, stdio: "ignore" });
  for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
} else syncSystem(CFG.data, { packs: false });

const out = [];
const ok = (c, t) => { out.push(`${c ? "✓" : "✗"} ${t}`); return !!c; };
const gm = await openClient({ edge: CFG.edge, url: URL, user: CFG.gm, port: 9642 });
const pl = await openClient({ edge: CFG.edge, url: URL, user: CFG.player, port: 9643 });
const P = JSON.stringify(CFG.player);
const unitByName = n => `game.actors.find(a => a.name === ${JSON.stringify(n)})`;
const confirmYes = body => `(async () => { const D = foundry.applications.api.DialogV2; const c = D.confirm; D.confirm = async () => true;
  try { ${body} } finally { D.confirm = c; } return 1; })()`;

try {
  await gm.ev(`(async () => {
    for (const a of game.actors.filter(a => a.name.startsWith("Правитель:"))) await a.delete();
    const O = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const town = await Actor.create({ name: "Правитель: Липов", type: "settlement", ownership: { default: 0, ${P}: O.OWNER },
      system: { militia: 30, families: 6, wealth: 5, stock: { "Еда": 40, "Древесина": 60, "Камень": 30, "Доски": 30 } } });
    window.__town = town.uuid; return 1; })()`);
  await sleep(1500);
  const town = JSON.stringify(await gm.ev("window.__town"));
  const T = `fromUuidSync(${town})`;

  // Набор нового отряда: людей списывает игрок, отряд создаёт ведущий, лист открывается у игрока
  const r1 = await pl.ev(`(async () => { const r = await game.vedmak.army.recruit(${T}, { origin: "militia", count: 10, kind: "infantry", name: "Правитель: Ополчение" });
    return { r: r === null ? "null" : typeof r, militia: ${T}.system.militia }; })()`);
  await sleep(2500);
  const made = await gm.ev(`(() => { const u = ${unitByName("Правитель: Ополчение")}; return u ? { soldiers: u.system.soldiers, home: u.system.settlement === ${town},
    owner: u.testUserPermission(game.users.get(${P}), "OWNER"), folder: u.folder?.name } : null; })()`);
  ok(made?.soldiers === 10 && made.home, `игрок набрал новый отряд — его создал ведущий (${JSON.stringify(made)})`);
  ok(made?.owner, "отряд — во владении игрока");
  ok(r1.militia === 20, `Ополчение списано один раз: ${r1.militia}`);
  ok(await pl.ev(`!!${unitByName("Правитель: Ополчение")}?.sheet.rendered`), "у игрока открылся лист нового отряда");

  // Наёмники и пополнение своего отряда
  await pl.ev(`(async () => { await game.vedmak.army.recruit(${T}, { origin: "mercenary", count: 5, kind: "archers", name: "Правитель: Стрелки" }); return 1; })()`);
  await sleep(2500);
  ok(await gm.ev(`${unitByName("Правитель: Стрелки")}?.system.soldiers`) === 5, "игрок нанял наёмников");
  await pl.ev(`(async () => { await game.vedmak.army.recruit(${T}, { origin: "militia", count: 5, unit: ${unitByName("Правитель: Ополчение")} }); return 1; })()`);
  await sleep(1500);
  ok(await gm.ev(`${unitByName("Правитель: Ополчение")}?.system.soldiers`) === 15, "пополнение своего отряда");

  // Поход и возвращение
  await pl.ev(`(async () => { await game.vedmak.army.marchOut(${unitByName("Правитель: Ополчение")}, 2); return 1; })()`);
  await sleep(1200);
  const march = await gm.ev(`(() => { const u = ${unitByName("Правитель: Ополчение")}; return { campaign: u.system.campaign, supplies: u.system.supplies }; })()`);
  ok(march.campaign && march.supplies > 0, `игрок вывел отряд в поход (${JSON.stringify(march)})`);
  await pl.ev(`(async () => { await game.vedmak.army.returnHome(${unitByName("Правитель: Ополчение")}); return 1; })()`);
  await sleep(1200);

  // Роспуск: отряд убирает ведущий, люди возвращаются один раз; удаление — без возврата
  await pl.ev(confirmYes(`await game.vedmak.army.disband(${unitByName("Правитель: Ополчение")});`));
  await sleep(1800);
  const back = await gm.ev(`({ gone: !${unitByName("Правитель: Ополчение")}, militia: ${T}.system.militia })`);
  ok(back.gone && back.militia === 30, `роспуск игроком: отряд убран, Ополчение вернулось (${JSON.stringify(back)})`);
  await pl.ev(`(async () => { await game.vedmak.army.removeUnit(${unitByName("Правитель: Стрелки")}); return 1; })()`);
  await sleep(1800);
  const del = await gm.ev(`({ gone: !${unitByName("Правитель: Стрелки")}, militia: ${T}.system.militia })`);
  ok(del.gone && del.militia === 30, `удаление игроком: наёмники убраны, Ополчение не тронуто (${JSON.stringify(del)})`);

  // Стройка и снос
  const was = await gm.ev(`${T}.system.buildingActors.length`);
  ok(await pl.ev(`(async () => String(await game.vedmak.settlement.build(${T}, "house")))()`) === "true", "игрок закладывает дом");
  await sleep(2000);
  ok(await gm.ev(`${T}.system.buildingActors.length`) === was + 1, "постройку создал ведущий");
  await pl.ev(confirmYes(`const t = ${T}; await game.vedmak.settlement.demolish(t, t.system.buildingActors.at(-1).id);`));
  await sleep(2000);
  ok(await gm.ev(`${T}.system.buildingActors.length`) === was, "игрок снёс постройку");

  // Что только для ведущего (PLAN 4.240–4.250): у игрока нет печати шаблона и отмены недели, экрана ведущего, кнопок Совета
  const seen = await pl.ev(`(async () => { const s = ${T}.sheet; await s.render({ force: true }); await new Promise(r => setTimeout(r, 1200));
    const sheet = { stamp: !!s.element.querySelector("[data-action=saveTemplate]"), undo: !!s.element.querySelector("[data-action=undoWeek]") }; await s.close();
    const gmApp = game.vedmak.gmScreen.open(); await new Promise(r => setTimeout(r, 500));
    const c = game.vedmak.council.open(); await new Promise(r => setTimeout(r, 1000));
    const council = { newTown: !!c.element.querySelector("[data-action=newTown]"), check: !!c.element.querySelector("[data-action=worldCheck]"), weekAll: !!c.element.querySelector("[data-action=weekAll]") };
    await c.close();
    return { sheet, gmScreen: !!gmApp || !!foundry.applications.instances.get("vedmak-gm-screen")?.rendered, council,
      tool: !!ui.controls?.controls?.tokens?.tools?.vedmakGmScreen }; })()`);
  ok(!seen.sheet.stamp && !seen.sheet.undo, `у игрока на листе нет печати шаблона и отмены недели (${JSON.stringify(seen.sheet)})`);
  ok(!seen.gmScreen && !seen.tool, `экран ведущего игроку не открывается, кнопки на панели нет (${seen.gmScreen}, ${seen.tool})`);
  ok(!seen.council.newTown && !seen.council.check && !seen.council.weekAll, `в Совете у игрока нет кнопок ведущего (${JSON.stringify(seen.council)})`);

  // Лист во время чужой правки (PLAN 4.258): ведущий набирает в поле листа персонажа игрока, игрок в это время меняет
  // персонажа — набранное не пропадает, после выхода из поля уходит только это поле (правка игрока не откатывается)
  const hero = await gm.ev(`(async () => { const a = await Actor.create({ name: "Правитель: герой", type: "character", ownership: { default: 0, ${P}: 3 } });
    await a.createEmbeddedDocuments("Item", [{ name: "Меч", type: "weapon" }]);
    const s = a.sheet; await s.render({ force: true }); await new Promise(r => setTimeout(r, 1000)); s.element.querySelector('[data-tab="bio"]')?.click();
    await new Promise(r => setTimeout(r, 700)); const f = s.element.querySelector('input[name="name"]'); f.focus(); f.value = "Правитель: набранное имя"; return a.id; })()`);
  await pl.ev(`(async () => { await game.actors.get(${JSON.stringify(hero)}).update({ "system.hp.value": 17 }); return 1; })()`);
  await sleep(1500);
  const typing = await gm.ev(`(async () => { const a = game.actors.get(${JSON.stringify(hero)}); const f = a.sheet.element.querySelector('input[name="name"]');
    const kept = f?.value; f.dispatchEvent(new Event("change", { bubbles: true })); f.blur(); await new Promise(r => setTimeout(r, 1500));
    return { kept, name: a.name, hp: a.system.hp.value }; })()`);
  ok(typing.kept === "Правитель: набранное имя" && typing.name === "Правитель: набранное имя" && typing.hp === 17,
    `чужая правка во время набора: текст не пропал, сохранился, ПЗ игрока не откатились (${JSON.stringify(typing)})`);
  // Меню предмета по правой кнопке — у игрока на своём листе
  const menu = await pl.ev(`(async () => { const a = game.actors.get(${JSON.stringify(hero)}); const s = a.sheet; await s.render({ force: true });
    await new Promise(r => setTimeout(r, 1000)); s.element.querySelector('[data-tab="gear"]')?.click(); await new Promise(r => setTimeout(r, 800));
    const row = s.element.querySelector(".gear-item"); const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 60, clientY: r.top + 20 }));
    const m = document.querySelector(".vd-item-menu"); const n = m?.querySelectorAll("a").length ?? 0;
    [...(m?.querySelectorAll("a") ?? [])].find(x => /не при себе/i.test(x.textContent))?.click(); await new Promise(z => setTimeout(z, 900));
    await s.close(); return { n, stored: a.items.find(i => i.type === "weapon")?.system.stored }; })()`);
  ok(menu.n >= 5 && menu.stored === true, `у игрока меню предмета по правой кнопке: пунктов ${menu.n}, «не при себе» сработало`);
  await gm.ev(`(async () => { const a = game.actors.get(${JSON.stringify(hero)}); await a?.sheet.close(); await a?.delete(); return 1; })()`);

  // Скрытая атака (PLAN 4.263): ведущий бьёт «вслепую» по жетону героя игрока — игрок не видит карточку атаки, но
  // получает приглашение защищаться без числа атаки; защита с него — итог без числа, кнопки гаснут на обеих карточках
  const hid = await gm.ev(`(async () => {
    const A = await import("/systems/vedmak/module/combat/attack.mjs"); const C = await import("/systems/vedmak/module/combat/common.mjs");
    const was = canvas.scene?.id;
    const scene = await Scene.create({ name: "Правитель: поле", width: 1600, height: 1000, padding: 0, grid: { type: 1, size: 100 } });
    await scene.view(); for (let i = 0; i < 80 && !(canvas.ready && canvas.scene?.id === scene.id); i++) await new Promise(r => setTimeout(r, 100));
    const hero = await Actor.create({ name: "Правитель: защитник", type: "character", ownership: { default: 0, ${P}: 3 }, system: { stats: { ref: { value: 6 } }, skills: { dodge: { value: 4 } } } });
    const foe = await Actor.create({ name: "Правитель: бандит", type: "monster" });
    const [ht] = await scene.createEmbeddedDocuments("Token", [{ ...(await hero.getTokenDocument()).toObject(), x: 300, y: 300, actorLink: true }]);
    const [ft] = await scene.createEmbeddedDocuments("Token", [{ ...(await foe.getTokenDocument()).toObject(), x: 400, y: 300 }]);
    await new Promise(r => setTimeout(r, 600));
    const card = await A.attack(ft.actor, { kind: "unarmed" }, { skipDialog: true, messageMode: "blind", targets: [C.targetInfo(canvas.tokens.get(ht.id))] });
    await new Promise(r => setTimeout(r, 800));
    const prompt = game.messages.contents.findLast(m => m.flags.vedmak?.defensePrompt?.attackMessageId === card?.id);
    window.__hid = { scene: scene.id, was, hero: hero.id, foe: foe.id, card: card?.id, prompt: prompt?.id, total: card?.flags.vedmak?.attack?.roll?.total };
    return { card: !!card, prompt: !!prompt, whisper: prompt?.whisper.length ?? 0 }; })()`);
  await sleep(1200);
  const seen2 = await pl.ev(`(async () => { const h = ${JSON.stringify(await gm.ev("window.__hid"))};
    const card = game.messages.get(h.card), prompt = game.messages.get(h.prompt);
    const visibleCard = !!card && card.isContentVisible; const html = prompt ? (await prompt.renderHTML()).outerHTML : "";
    const btn = prompt ? ui.chat.element?.querySelector('[data-message-id="' + h.prompt + '"] [data-vedmak="defend"][data-defense="dodge"]') : null;
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); await new Promise(r => setTimeout(r, 2500));
    const def = game.messages.contents.findLast(m => m.flags.vedmak?.defense?.attackMessageId === h.card);
    return { visibleCard, prompt: !!prompt, promptHasTotal: html.includes(">" + h.total + "<"), btn: !!btn, def: !!def,
      defHidden: def?.flags.vedmak.defense.attack.hidden, defText: def ? def.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160) : "" }; })()`);
  ok(seen2.prompt && !seen2.visibleCard && !seen2.promptHasTotal, `скрытая атака: игрок не видит содержимого карточки атаки, приглашение без числа (${JSON.stringify(seen2).slice(0, 160)})`);
  ok(seen2.btn && seen2.def && seen2.defHidden === true, `игрок защитился с приглашения: ${seen2.defText}`);
  const marks = await gm.ev(`(async () => { await new Promise(r => setTimeout(r, 800)); const h = window.__hid;
    const dk = Object.keys(game.messages.get(h.card)?.flags.vedmak?.defended ?? {}).length, dp = Object.keys(game.messages.get(h.prompt)?.flags.vedmak?.defended ?? {}).length;
    if (h.was) await game.scenes.get(h.was)?.view(); await game.scenes.get(h.scene)?.delete(); for (const id of [h.hero, h.foe]) await game.actors.get(id)?.delete();
    return { dk, dp }; })()`);
  ok(marks.dk === 1 && marks.dp === 1, `защита отмечена на скрытой карточке и на приглашении (${JSON.stringify(marks)})`);

  const errs = await pl.ev("window.__errs ?? []");
  ok(!errs.length, `у игрока без ошибок${errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""}`);
} catch (e) {
  ok(false, `исключение: ${e.message}`);
} finally {
  await gm.ev(`(async () => { for (const a of game.actors.filter(a => a.name.startsWith("Правитель:") || a.type !== "character"
    && fromUuidSync(a.system?.settlement ?? "")?.name?.startsWith("Правитель:"))) await a.delete(); return 1; })()`).catch(() => {});
  console.log(out.join("\n"));
  const failed = out.filter(l => l.startsWith("✗")).length;
  console.log(`\nИтог: ${out.length - failed} из ${out.length} проверок${failed ? `, упало ${failed}` : ""}.`);
  gm.close(); pl.close();
  if (server) { server.kill(); await sleep(1500); }
  process.exitCode = failed ? 1 : 0;
}
