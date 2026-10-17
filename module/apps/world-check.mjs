// Проверка мира перед игрой (PLAN 4.248): порванные связи королевства — отряд, постройка, управляющий, командир, караван,
// осада ссылаются на удалённого актёра; кривые числа склада. Ведущему при загрузке — предупреждение, в Совете правителя —
// «Проверить мир»: список неполадок и «Починить». Починка ничего не удаляет: ссылка обнуляется, постройка без поселения
// уходит образцом в «Каталог построек», число склада — 0. Ресурс без значка только показывается: значок ставят в библиотеке.

import { realmConfirm } from "./realm-dialog.mjs";
import { RESOURCE_ICONS } from "../config/settlement.mjs";
import { resourceInfo } from "../config/resources.mjs";
import { WEALTH } from "../settlement/rules.mjs";

const SYS = "vedmak";
const CATALOG_FOLDER = "Каталог построек";

/** Живой актёр по uuid нужного типа, иначе null (битый uuid — тоже null). */
function alive(uuid, type) {
  if (!uuid) return null;
  let doc = null;
  try { doc = fromUuidSync(uuid); } catch { return null; }
  return doc && (!type || doc.type === type) ? doc : null;
}

/**
 * Неполадки мира: { actor, text, fix? } — fix — данные update актёра; folder — перенести в каталог построек.
 * Без fix — только показать.
 */
export function scanWorld() {
  const found = [];
  const add = (actor, text, fix = null, extra = {}) => found.push({ actor, text, fix, ...extra });
  for (const a of game.actors) {
    const s = a.system;
    if (a.type === "unit") {
      if (s.settlement && !alive(s.settlement, "settlement")) add(a, "отряд приписан к удалённому поселению — станет без поселения", { "system.settlement": "" });
      if (s.besieging && !alive(s.besieging, "settlement")) add(a, "осаждает удалённое поселение — осада снимется", { "system.besieging": "" });
      if (s.commander && !alive(s.commander, "character")) add(a, "командир удалён — отряд без командира", { "system.commander": "" });
    }
    if (a.type === "building") {
      if (s.settlement && !alive(s.settlement, "settlement")) add(a, "постройка удалённого поселения — уйдёт образцом в «Каталог построек»", { "system.settlement": "" }, { catalog: true });
      if (s.manager && !alive(s.manager, "character")) add(a, "управляющий удалён — постройка без управляющего", { "system.manager": "" });
    }
    if (a.type === "settlement") {
      const routes = s.routes.filter(r => alive(r.to, "settlement") && r.to !== a.uuid);
      if (routes.length !== s.routes.length) add(a, `караванов в удалённое поселение: ${s.routes.length - routes.length} — отменятся`, { "system.routes": routes });
      const units = s.siege.units.filter(u => alive(u, "unit"));
      if (units.length !== s.siege.units.length) add(a, `в осаде удалённых отрядов: ${s.siege.units.length - units.length} — уберутся`,
        { "system.siege": { units, weeks: units.length ? s.siege.weeks : 0 } });
      const stock = s.toObject().stock ?? {};
      const bad = Object.entries(stock).filter(([k, v]) => !k.trim() || !Number.isFinite(Number(v)) || Number(v) < 0);
      if (bad.length) {
        const fixed = Object.fromEntries(Object.entries(stock).filter(([k]) => k.trim()).map(([k, v]) => [k, Math.max(0, Number(v) || 0)]));
        add(a, `на складе кривые числа: ${bad.map(([k, v]) => `${k || "без названия"} ${v}`).join(", ")} — станут 0`, { "system.==stock": fixed });
      }
      const plain = Object.keys(stock).filter(k => k.trim() && k !== WEALTH && !resourceInfo(k)?.img && !RESOURCE_ICONS[k]);
      if (plain.length) add(a, `ресурсы без значка: ${plain.join(", ")} — значок ставится в библиотеке ресурсов`);
    }
  }
  return found;
}

/** Починить найденное (ведущий). */
export async function repairWorld(found = scanWorld()) {
  if (!game.user.isGM) return 0;
  let n = 0;
  let catalog = null;
  for (const p of found.filter(p => p.fix)) {
    const update = { ...p.fix };
    if (p.catalog) {
      catalog ??= game.folders.find(f => f.type === "Actor" && f.name === CATALOG_FOLDER)
        ?? await Folder.create({ name: CATALOG_FOLDER, type: "Actor", color: "#5c4a32" });
      update.folder = catalog.id;
    }
    await p.actor.update(update);
    n++;
  }
  return n;
}

/** Совет правителя → «Проверить мир»: список и «Починить». */
export async function askWorldCheck() {
  if (!game.user.isGM) return null;
  const found = scanWorld();
  if (!found.length) { ui.notifications.info("Проверка мира: всё в порядке — связи королевства целы."); return 0; }
  const fixable = found.filter(p => p.fix).length;
  const rows = found.map(p => ({ name: p.actor.name, img: p.actor.img, text: p.text, fix: !!p.fix }));
  const ok = await realmConfirm("world-check", {
    title: "Проверка мира", template: "world-check", data: { rows, fixable },
    head: { icon: "fa-solid fa-stethoscope", name: "Проверка мира", sub: [`неполадок ${found.length}`, fixable ? `починить можно ${fixable}` : "только показать"] },
    yesLabel: fixable ? `Починить (${fixable})` : "Понятно", noLabel: "Закрыть"
  });
  if (!ok || !fixable) return 0;
  const n = await repairWorld(found);
  ui.notifications.info(`Проверка мира: починено ${n}.`);
  return n;
}

/** При загрузке — ведущему предупреждение, если есть что чинить (настройка «Проверять мир при загрузке»). */
export function registerWorldCheck() {
  game.settings.register(SYS, "worldCheckOnLoad", {
    name: "Королевство: проверять мир при загрузке",
    hint: "Ведущему — предупреждение, если отряды, постройки, караваны или осада ссылаются на удалённых актёров. Починка — Совет правителя → «Проверить мир».",
    scope: "client", config: true, type: Boolean, default: true
  });
  Hooks.once("ready", () => {
    if (!game.user.isGM || game.users.activeGM !== game.user || !game.settings.get(SYS, "worldCheckOnLoad")) return;
    // После переноса построек и прочих задач загрузки
    setTimeout(() => {
      const n = scanWorld().filter(p => p.fix).length;
      if (n) ui.notifications.warn(`Проверка мира: неполадок в королевстве — ${n}. Совет правителя → «Проверить мир».`);
    }, 3000);
  });
}
