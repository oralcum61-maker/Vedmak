// Постройки-актёры (PLAN 4.198): пересчёт поселений, когда постройки меняются; права построек — как у поселения;
// стартовые постройки нового поселения; перенос старых предметов «Постройка» в актёров.

import { buildingItemData } from "../config/settlement.mjs";
import { createBuildings, buildingSource } from "./settlement.mjs";

const SYS = "vedmak";
const CATALOG_FOLDER = "Каталог построек";

/** Пересчитать поселения (сводка и прогноз берут постройки из актёров мира) и перерисовать открытые листы. */
export function refreshSettlements(uuids = null) {
  for (const a of game.actors ?? []) {
    if (a.type !== "settlement" || (uuids && !uuids.has(a.uuid))) continue;
    a.reset();
    if (a.sheet?.rendered) a.sheet.render();
  }
}

/** Новое поселение: два жилых дома и лагерь лесорубов, уже готовые. */
async function starterBuildings(settlement) {
  const list = [["house", 0], ["house", 0], ["lumber", 1]].map(([key, workers]) => {
    const d = buildingItemData(key);
    Object.assign(d.system, { level: 1, workers, constructing: false, progress: 0 });
    return d;
  });
  await createBuildings(settlement, list);
}

/**
 * Перенос (ведущий, при загрузке мира): вложенные предметы «Постройка» поселений → актёры поселения (уровень, стройка,
 * работники сохраняются, порядок — тот же); предметы «Постройка» мира → образцы каталога. Предмет удаляется после
 * создания актёра; созданный помнит, из какого предмета он (повторный запуск не дублирует).
 */
export async function migrateBuildingItems() {
  if (!game.user.isGM || game.users.activeGM !== game.user) return 0;
  const made = new Set(game.actors.filter(a => a.type === "building").map(a => a.getFlag(SYS, "fromItem")).filter(Boolean));
  let moved = 0;
  for (const town of game.actors.filter(a => a.type === "settlement")) {
    const items = town.items.filter(i => i.type === "building").sort((a, b) => a.sort - b.sort);
    if (!items.length) continue;
    const todo = items.filter(i => !made.has(i.uuid));
    const list = [];
    for (const item of todo) {
      const d = await buildingSource(item.toObject());
      const s = item.system;
      Object.assign(d.system, { level: s.level, constructing: s.constructing, progress: s.progress, workers: s.workers });
      foundry.utils.setProperty(d, `flags.${SYS}.fromItem`, item.uuid);
      list.push(d);
    }
    await createBuildings(town, list);
    await town.deleteEmbeddedDocuments("Item", items.map(i => i.id));
    moved += items.length;
  }
  const loose = game.items.filter(i => i.type === "building");
  if (loose.length) {
    let folder = game.folders.find(f => f.type === "Actor" && f.name === CATALOG_FOLDER);
    folder ??= await Folder.create({ name: CATALOG_FOLDER, type: "Actor", color: "#5c4a32" });
    const list = [];
    for (const item of loose.filter(i => !made.has(i.uuid))) {
      const d = await buildingSource(item.toObject());
      d.folder = folder.id;
      foundry.utils.setProperty(d, `flags.${SYS}.fromItem`, item.uuid);
      list.push(d);
    }
    if (list.length) await Actor.implementation.createDocuments(list);
    await Item.implementation.deleteDocuments(loose.map(i => i.id));
    moved += loose.length;
  }
  if (moved) ui.notifications.info(`Постройки перенесены в актёров «Постройка»: ${moved}.`);
  return moved;
}

export function registerBuildingHooks() {
  // Пока мир загружается, поселения считаются без построек — пересчёт после загрузки, затем перенос старых предметов
  Hooks.once("ready", async () => {
    refreshSettlements();
    try { await migrateBuildingItems(); } catch (err) { console.error("vedmak | перенос построек", err); }
  });
  // Постройку перенесли в другое поселение — пересчитать и прежнее
  const was = new Map();
  const touched = doc => {
    if (doc.type !== "building") return;
    const uuids = new Set([doc.system.settlement]);
    if (was.has(doc.id)) { uuids.add(was.get(doc.id)); was.delete(doc.id); }
    refreshSettlements(uuids);
  };
  Hooks.on("preUpdateActor", (doc, changes) => {
    if (doc.type === "building" && foundry.utils.hasProperty(changes, "system.settlement")) was.set(doc.id, doc.system.settlement);
  });
  Hooks.on("createActor", doc => touched(doc));
  Hooks.on("updateActor", doc => touched(doc));
  Hooks.on("deleteActor", doc => touched(doc));

  Hooks.on("createActor", (doc, options, userId) => {
    if (doc.type !== "settlement" || userId !== game.user.id || options.vedmakStarter === false) return;
    if (!game.user.isGM) return; // поселения создаёт ведущий; игроку стартовые постройки не создать
    starterBuildings(doc).catch(err => console.error("vedmak | стартовые постройки", err));
  });

  // Права поселения сменились — у его построек те же
  Hooks.on("updateActor", (doc, changes) => {
    if (doc.type !== "settlement" || !("ownership" in changes) || game.users.activeGM !== game.user) return;
    const ownership = foundry.utils.deepClone(doc.ownership);
    const updates = doc.system.buildingActors.map(b => ({ _id: b.id, ownership }));
    if (updates.length) Actor.implementation.updateDocuments(updates, { diff: false, recursive: false });
  });
}
