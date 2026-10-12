// Битва на карте (PLAN 4.207): местность из региона сцены, поле битвы по жетонам рядом, вступление и выход отрядов
// перед раундом, предложение битвы, когда жетоны сошлись, бой у стен поселения.
const BA = await import("/systems/vedmak/module/apps/battle-app.mjs");
const until = async (test, ms = 4000) => { for (let t = 0; t < ms && !test(); t += 100) await wait(100); return test(); };
const DISP = CONST.TOKEN_DISPOSITIONS;
const was = canvas.scene;
window.__noAutoDialog = true; // окна «Отряды сошлись» и «Под стенами» сценарий нажимает сам

const scene = await Scene.create({ name: "Прогон: Поле у Ольховки", width: 3000, height: 2000, padding: 0, folder: null,
  grid: { type: 1, size: 100 } });
await scene.view(); await until(() => canvas.ready && canvas.scene?.id === scene.id, 8000);
await scene.createEmbeddedDocuments("Region", [{ name: "Лес у дороги", shapes: [{ type: "rectangle", x: 0, y: 0, width: 1500, height: 2000, rotation: 0, hole: false }] }]);
const mkUnit = (name, kind, soldiers) => Actor.create({ name, type: "unit", folder: folder.id,
  system: { kind, soldiers, training: 2, weapons: 1, armor: 1, morale: 7 }, prototypeToken: { actorLink: true } });
const ours = await mkUnit("Прогон: Щиты", "infantry", 40);
const archers = await mkUnit("Прогон: Лучники", "archers", 20);
const theirs = await mkUnit("Прогон: Банда", "infantry", 40);
const tok = async (actor, x, y, disposition) => (await scene.createEmbeddedDocuments("Token",
  [{ ...(await actor.getTokenDocument()).toObject(), x, y, disposition, actorLink: true }]))[0];
const tOurs = await tok(ours, 600, 900, DISP.FRIENDLY);
const tTheirs = await tok(theirs, 1000, 900, DISP.HOSTILE);
const tArch = await tok(archers, 2600, 1700, DISP.FRIENDLY);

stepName("местность из региона");
ok(BA.terrainAt(scene, { x: 700, y: 900 })?.key === "forest", "в регионе «Лес у дороги» — местность «Лес»");
ok(!BA.terrainAt(scene, { x: 2000, y: 900 }), "вне региона — местность не задана");

stepName("поле битвы");
const app = BA.BattleApp.fromScene(scene, { x: 800, y: 950 }, { attacker: tOurs }); await wait(700);
ok(app.field && app.terrain === "forest" && app.field.region === "Лес у дороги", "битва на сцене: местность из региона");
ok(app.sides[0].ids.includes(ours.id) && app.sides[1].ids.includes(theirs.id) && !app.sides.some(s => s.ids.includes(archers.id)),
  "стороны по расположению; лучники далеко — не в бою");
ok(app.element.querySelector(".bt-field")?.textContent.includes("Поле у Ольховки"), "в окне — плашка «Битва на сцене»");
await tArch.update({ x: 500, y: 1000 }, { animate: false }); await wait(300);
app.element.querySelector("[data-action=round]").click(); await wait(1500);
ok(app.sides[0].ids.includes(archers.id) && app.roundNo === 2, "лучники подошли — вступили в бой перед раундом");
await tArch.update({ x: 2600, y: 1700 }, { animate: false }); await wait(300);
app.element.querySelector("[data-action=round]").click(); await wait(1500);
ok(!app.sides[0].ids.includes(archers.id) && (app.log.at(-1)?.notes ?? []).some(n => n.includes("покинул")), "лучники отошли — вышли из битвы, в летописи раунда");
await app.close(); await wait(300);

stepName("жетоны сошлись");
await ours.update({ "system.routed": false, "system.morale": 7 }); await theirs.update({ "system.routed": false, "system.morale": 7 });
await tTheirs.update({ x: 1500, y: 900 }, { animate: false }); await wait(300);
await tOurs.update({ x: 1400, y: 900 });
const dlg = await until(() => [...foundry.applications.instances.values()].some(a => a.title === "Отряды сошлись"), 5000);
ok(dlg, "отряд подошёл вплотную к чужому — ведущему предложена битва");
const dg = [...foundry.applications.instances.values()].find(a => a.title === "Отряды сошлись");
dg?.element.querySelector("button[data-action=yes]")?.click(); await wait(1200);
const app2 = foundry.applications.instances.get("vedmak-battle");
ok(app2?.rendered && app2.field?.scene === scene.id && app2.sides.every(s => s.ids.length), `битва открылась на месте встречи (${JSON.stringify(app2?.sides)})`);
await app2?.close();

stepName("у стен поселения");
const town = await Actor.create({ name: "Прогон: Ольховка", type: "settlement", folder: folder.id, system: { families: 2 } }, { vedmakStarter: false });
await ours.update({ "system.settlement": town.uuid });
await scene.createEmbeddedDocuments("Token", [{ ...(await town.getTokenDocument()).toObject(), x: 1700, y: 1100, disposition: DISP.FRIENDLY }]);
const app3 = BA.BattleApp.fromScene(scene, { x: 1450, y: 950 }, { attacker: tTheirs }); await wait(700);
ok(app3.town === town.uuid && app3.terrain === "walls", "поселение рядом — бой у его стен, местность «стены»");
ok(app3.sides.find(s => s.ids.includes(ours.id))?.defender, "обороняется сторона отрядов этого поселения");
await app3.close();

stepName("осада по жетону");
await tOurs.update({ x: 100, y: 100 }, { animate: false }); await wait(300);
await theirs.update({ "system.campaign": true, "system.routed": false });
await tTheirs.update({ x: 1600, y: 1100 });
const sg = await until(() => [...foundry.applications.instances.values()].some(a => a.title === "Под стенами"), 5000);
ok(sg, "отряд в походе подошёл к жетону чужого поселения — предложена осада");
[...foundry.applications.instances.values()].find(a => a.title === "Под стенами")?.element.querySelector("button[data-action=yes]")?.click();
await until(() => town.system.siege.units.includes(theirs.uuid), 3000);
ok(town.system.siege.units.includes(theirs.uuid) && theirs.system.besieging === town.uuid, `осада — у поселения мира (жетон не связан с актёром): ${JSON.stringify(town.system.siege)} / ${theirs.system.besieging}`);
for (const a of [...foundry.applications.instances.values()].filter(a => a.title === "Отряды сошлись")) await a.close();

window.__noAutoDialog = false;
if (was) await was.view();
await scene.delete();
for (const a of [ours, archers, theirs, town]) await a.delete();
