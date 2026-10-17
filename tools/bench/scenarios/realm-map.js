// Поселения на карте (PLAN 4.249, module/fx/realm-map.mjs): плашка сводки над жетоном поселения, стрелка каравана между
// жетонами, тревога красной строкой; несвязанный жетон — поселение из актёра мира; настройка выключает слой.
const until = async (test, ms = 4000) => { for (let t = 0; t < ms && !test(); t += 100) await wait(100); return test(); };
const was = canvas.scene;
const scene = await Scene.create({ name: "Прогон: Карта королевства", width: 3000, height: 2000, padding: 0, folder: null, grid: { type: 1, size: 100 } });
await scene.view(); await until(() => canvas.ready && canvas.scene?.id === scene.id, 8000);
const mkTown = (name, stock) => Actor.create({ name, type: "settlement", folder: folder.id, system: { families: 4, wealth: 3.5, stock } }, { vedmakStarter: false });
const a = await mkTown("Прогон: Карта — Ольховка", { "Еда": 60, "Топливо": 30 });
const b = await mkTown("Прогон: Карта — Белый Сад", { "Еда": 60, "Топливо": 30 });
const layer = () => canvas.interface.children.find(c => c.name === "vedmak-realm-map");
const plates = () => (layer()?.children ?? []).filter(c => c.name?.startsWith("realm-plate"));
const routes = () => (layer()?.children ?? []).filter(c => c.name === "realm-route");
const words = box => box.children.filter(c => c instanceof PIXI.Text).map(c => c.text).join(" | ");
const setMap = async on => { await game.settings.set("vedmak", "realmMap", on); await wait(300); };
try {
  await setMap(true);
  const tok = async (actor, x, link) => (await scene.createEmbeddedDocuments("Token", [{ ...(await actor.getTokenDocument()).toObject(), x, y: 900, actorLink: link }]))[0];
  const ta = await tok(a, 500, true);
  const tb = await tok(b, 2200, false);
  await until(() => plates().length === 2);
  const pa = plates().find(p => p.name === `realm-plate:${a.id}`);
  ok(plates().length === 2 && words(pa ?? { children: [] }).includes("Семьи 4") && words(pa).includes("Казна 3,5"),
    `плашки над обоими жетонами, несвязанный — тоже (${plates().length}: ${words(pa ?? { children: [] })})`);
  ok(pa && pa.y < ta.y, "плашка — над жетоном");

  await a.update({ "system.routes": [{ id: "r1", to: b.uuid, resource: "Еда", qty: 3 }, { id: "r2", to: b.uuid, resource: "Топливо", qty: 2 }] });
  await until(() => routes().length === 1);
  ok(routes().length === 1 && words(routes()[0]).includes("Еда 3") && words(routes()[0]).includes("Топливо 2"),
    `караваны в одно поселение — одной стрелкой с грузом (${routes().map(words).join("; ")})`);

  await a.update({ "system.==stock": { "Еда": 0, "Топливо": 0 } });
  await until(() => words(plates().find(p => p.name === `realm-plate:${a.id}`) ?? { children: [] }).includes("не хватит"));
  ok(words(plates().find(p => p.name === `realm-plate:${a.id}`) ?? { children: [] }).includes("не хватит"), "нехватка — тревога на плашке");

  const x0 = routes()[0]?.children[2]?.x;
  await tb.update({ x: 2200, y: 300 }, { animate: false });
  await until(() => routes()[0]?.children[2]?.x !== x0);
  ok(routes().length === 1 && routes()[0].children[2].x !== x0, "жетон сдвинули — стрелка перерисована");

  await setMap(false);
  ok(!plates().length && !routes().length, "настройка выключена — на карте пусто");
  await setMap(true);
  await until(() => plates().length === 2);
  ok(plates().length === 2 && routes().length === 1, "настройка включена — снова плашки и стрелка");

  await a.update({ "system.routes": [] });
  await until(() => !routes().length);
  ok(!routes().length, "караван отменён — стрелки нет");
} finally {
  await game.settings.set("vedmak", "realmMap", true);
  if (was) await was.view();
  await scene.delete();
  for (const d of [a, b]) await d.delete();
}
