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
