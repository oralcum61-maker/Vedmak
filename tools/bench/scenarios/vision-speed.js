// Ускорение видимости (PLAN 4.195): лучи сквозь стены с правкой ядра и без — одинаковые ответы; правка дешевле.
const SET = game.vedmak.setVisionSpeedups;
const startView = canvas.scene;

stepName("сцена со стенами");
// Стены всех видов: обычные, ограниченные, по близости, двери (закрытые и открытые), односторонние
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const T = CONST.WALL_SENSE_TYPES;
const kinds = [{ sight: T.NORMAL, light: T.NORMAL }, { sight: T.LIMITED, light: T.LIMITED }, { sight: T.PROXIMITY, light: T.PROXIMITY, threshold: { sight: 60, light: 60 } },
  { sight: T.NORMAL, light: T.NORMAL, door: 1, ds: 0 }, { sight: T.NORMAL, light: T.NORMAL, door: 1, ds: 1 }, { sight: T.NORMAL, light: T.NORMAL, dir: 1 }];
const walls = Array.from({ length: 160 }, (_, i) => {
  const x = 100 + rnd() * 2800, y = 100 + rnd() * 1800, a = rnd() * Math.PI, len = 40 + rnd() * 300;
  return { c: [x, y, x + Math.cos(a) * len, y + Math.sin(a) * len].map(Math.round), move: T.NORMAL, sound: T.NORMAL, ...kinds[i % kinds.length] };
});
const scene = await Scene.create({ name: "Прогон: ускорение видимости", width: 3000, height: 2000, padding: 0, walls });
await scene.view(); await wait(1500);
ok(canvas.scene?.id === scene.id && canvas.scene.walls.size === walls.length, `сцена со стенами (${canvas.scene.walls.size})`);

stepName("лучи: одинаковые ответы");
const ser = r => r === null || typeof r === "boolean" ? String(r) : Array.isArray(r) ? r.map(v => Math.round(v.x) + ":" + Math.round(v.y)).join(";") : Math.round(r.x) + ":" + Math.round(r.y);
let n = 0, diff = 0; const ex = [];
for (const type of ["sight", "light", "move", "sound"]) for (const mode of ["any", "closest", "all"]) for (let i = 0; i < 100; i++) {
  const o = { x: 50 + rnd() * 2900, y: 50 + rnd() * 1900, elevation: 0 };
  const p = { x: 50 + rnd() * 2900, y: 50 + rnd() * 1900, elevation: 0 };
  const cfg = { mode, type, tMin: rnd() < .3 ? rnd() * .5 : 0, tMax: rnd() < .3 ? .5 + rnd() * .5 : 1 };
  if (rnd() < .3) Object.assign(cfg, { angle: 60 + rnd() * 240, rotation: rnd() * 360, radius: 300 + rnd() * 1500, externalRadius: 25 });
  // Как проверка видимости ядра: в настройке луча — квадрат всей области обзора (из los.config)
  if (rnd() < .5) cfg.boundingBox = new PIXI.Rectangle(o.x - 1500, o.y - 1500, 3000, 3000);
  const back = CONFIG.Canvas.polygonBackends[type];
  SET(false); const a = ser(back.testCollision(o, p, { ...cfg }));
  SET(true); const b = ser(back.testCollision(o, p, { ...cfg }));
  n++; if (a !== b) { diff++; if (ex.length < 2) ex.push(`${type}/${mode}: ${a} | ${b}`); }
}
ok(diff === 0, `${n} случайных лучей с правкой и без — расхождений ${diff}${ex.length ? ": " + ex.join("; ") : ""}`);

stepName("меньше стен на луч");
// Сколько стен ядро перебирает для луча. Проверка видимости передаёт в луч квадрат всей области обзора (los.config) —
// без правки перебираются все стены в нём, с правкой — только у отрезка луча
const sweep = foundry.canvas.geometry.ClockwiseSweepPolygon.prototype;
const includeEdge = sweep._testEdgeInclusion;
let edgesSeen = 0;
sweep._testEdgeInclusion = function (...args) { edgesSeen++; return includeEdge.apply(this, args); };
const count = on => { SET(on); seed = 5; edgesSeen = 0;
  for (let i = 0; i < 200; i++) CONFIG.Canvas.polygonBackends.sight.testCollision({ x: 1500, y: 1000, elevation: 0 },
    { x: 1500 + (rnd() - .5) * 1200, y: 1000 + (rnd() - .5) * 1200, elevation: 0 }, { mode: "any", type: "sight", angle: 180, rotation: rnd() * 360, radius: 1200, externalRadius: 25,
      boundingBox: new PIXI.Rectangle(300, -200, 2400, 2400) });
  return edgesSeen; };
const edgesOff = count(false), edgesOn = count(true);
sweep._testEdgeInclusion = includeEdge; SET(true);
ok(edgesOn * 2 < edgesOff, `200 лучей конусом: стен перебрано без правки ${edgesOff}, с правкой ${edgesOn}`);

if (startView) await startView.view();
await wait(800);
await scene.delete();
