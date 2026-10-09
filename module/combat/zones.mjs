// Зоны на сцене: конусы и круги заклинаний, бомб и ловушек (стр. 168).
//
// В Foundry v14 шаблоны — это области (Region) с флагом core.MeasuredTemplate. Размещение —
// canvas.regions.placeRegions, как у dnd5e 6 под v14: зону ведут мышью, колесо поворачивает конус,
// правый клик — отмена. Цели — токены, хотя бы краем попавшие в зону (так же подсвечивает Foundry).
//
// Зона убирается сама: мгновенная — в начале следующего хода заклинателя (вне боя — через 15 секунд),
// на N раундов — через N раундов, активная — когда кончается поддержание. Долгие (часы, дни) —
// остаются, их снимает ведущий.

import { asGM, registerGMHandler, resolveActor, userOwnsAny } from "./common.mjs";
import { zoneAuraFor } from "../config/magic.mjs";
import { alchemyAuto } from "../config/alchemy-auto.mjs";

const INSTANT_SECONDS = 15;

/** Цвет зоны (вид — fx/zone-look.mjs): заклинание — по стихии, бомба — пламя, ловушка — сталь. */
export const ZONE_COLORS = {
  fire: "#e8742a", air: "#bcd8f0", water: "#5a9ee0", earth: "#c29a5a", mixed: "#a98be8",
  bomb: "#e8833a", trap: "#b8b2a6"
};

/**
 * Разбор зоны по тексту дальности: «2-метровый конус», «конус 2 м», «зона радиусом 10 м», «радиус 8 м»,
 * «50 м радиус», «4 м (радиус 2 м)», «круг диаметром 50 см». Мили — не зона на сцене.
 * @param {string} text
 * @param {object} [opts] — plainIsRadius: «4 м» у бомб и ловушек — радиус
 * @returns {{type: "cone"|"circle", size: number}|null} размер в метрах
 */
export function parseArea(text, { plainIsRadius = false } = {}) {
  const t = String(text ?? "").toLowerCase().replace(",", ".");
  if (!t || /мил/.test(t)) return null;
  const num = re => Number(t.match(re)?.[1]) || 0;
  if (/конус/.test(t)) {
    const size = num(/(\d+(?:\.\d+)?)\s*-?\s*метров\S*\s+конус/) || num(/конус\S*\s*(\d+(?:\.\d+)?)/) || num(/(\d+(?:\.\d+)?)/);
    return size ? { type: "cone", size } : null;
  }
  const diameter = t.match(/диаметр\S*\s*(\d+(?:\.\d+)?)\s*(см|м)/);
  if (diameter) return { type: "circle", size: Number(diameter[1]) / (diameter[2] === "см" ? 200 : 2) };
  if (/радиус/.test(t)) {
    const size = num(/радиус\S*\s*(\d+(?:\.\d+)?)/) || num(/(\d+(?:\.\d+)?)\s*м\s*радиус/);
    return size ? { type: "circle", size } : null;
  }
  if (plainIsRadius) {
    const size = num(/(\d+(?:\.\d+)?)/);
    return size ? { type: "circle", size } : null;
  }
  return null;
}

/**
 * Сколько держится зона по тексту длительности.
 * @returns {{instant?: true, rounds?: number, maintain?: true}|null} null — пока не снимет ведущий
 */
export async function parseZoneDuration(text, { cost = 0 } = {}) {
  const t = String(text ?? "").toLowerCase();
  if (!t || /мгновен/.test(t)) return { instant: true };
  if (/активн/.test(t)) return { maintain: true };
  if (/раунд\S*\s+за\s+1\s+очко/.test(t)) return { rounds: Math.max(1, cost) };
  const m = t.match(/(\d+d\d+|\d+)\s*(раунд|ход)/);
  if (!m) return null;
  const rounds = /d/.test(m[1]) ? (await new Roll(m[1]).evaluate()).total : Number(m[1]);
  return { rounds };
}

/** Зоны включены и Foundry умеет их ставить (v14). */
export function zonesAvailable() {
  return !!(game.settings.get("vedmak", "zones") && canvas?.ready && canvas.scene
    && typeof canvas.regions?.placeRegions === "function");
}

/** Пикселей в метре сцены. */
const pxPerUnit = () => canvas.scene.grid.size / canvas.scene.grid.distance;
const toRad = deg => deg * Math.PI / 180;

function shapeData(area) {
  // Круг меньше клетки (вживлённый Ирден — 50 см) занимает одну клетку: мельче на сетке его не поймать,
  // а 0,45 клетки не задевает соседей
  const radius = area.type === "circle" ? Math.max(area.size * pxPerUnit(), canvas.scene.grid.size * 0.45) : area.size * pxPerUnit();
  if (area.type === "cone") {
    return { type: "cone", x: 0, y: 0, rotation: 0, radius, angle: CONFIG.MeasuredTemplate?.defaults?.angle ?? 53.13 };
  }
  return { type: "circle", x: 0, y: 0, radius };
}

/**
 * Поставить зону мышью. Окна на время сворачиваются, чтобы не закрывали сцену.
 * @returns {Promise<{shape: object}|{cancelled: true}|null>} null — зоны недоступны или сломались:
 *   тогда цели берутся как раньше, выбранные вручную
 */
export async function placeZone(area, { name = "Зона", color } = {}) {
  if (!zonesAvailable()) return null;
  const windows = [...(foundry.applications.instances?.values() ?? [])]
    .filter(a => a.rendered && a.hasFrame && !a.minimized && !a.window?.windowId);
  await Promise.all(windows.map(a => a.minimize()));
  const placed = [];
  try {
    ui.notifications.info(`${name}: поставьте зону на сцене. Колесо мыши поворачивает, правый клик — отмена.`);
    await canvas.regions.placeRegions([{
      // Вид — свой (fx/zone-look.mjs): без штриховки клеток и пунктирной линейки Foundry
      name, color: color ?? game.user.color, displayMeasurements: false, highlightMode: "shapes",
      shapes: [shapeData(area)], "flags.core.MeasuredTemplate": true, "flags.vedmak.look": true
    }], {
      create: false,
      preConfirm: ({ document }) => { placed.push(document.toObject().shapes.at(-1)); }
    });
  } catch (err) {
    console.error("vedmak | размещение зоны", err);
    ui.notifications.warn("Не удалось поставить зону — берутся цели, выбранные вручную.");
    return null;
  } finally {
    await Promise.all(windows.map(a => a.maximize()));
  }
  return placed[0] ? { shape: placed[0] } : { cancelled: true };
}

/** Данные области для создания. */
function regionData(shape, { name, color, zone }) {
  return {
    name, color: color ?? game.user.color,
    shapes: [shape],
    levels: canvas.level?.id ? [canvas.level.id] : undefined,
    visibility: CONST.REGION_VISIBILITY?.ALWAYS ?? 2,
    highlightMode: "shapes",
    displayMeasurements: false,
    // Права на область v14 берёт только отсюда: без владельца игрок не может ни сдвинуть, ни снять свою зону
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE, [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
    flags: { core: { MeasuredTemplate: true }, vedmak: { zone } }
  };
}

/**
 * Создать область на сцене. Если игроку нельзя — через ведущего (тогда документа сразу нет).
 * @param {object} shape — из placeZone
 * @param {object} opts — name, color, actor, itemName, duration ({instant|rounds|maintain}|null), maintainItemId
 * @returns {Promise<RegionDocument|null>}
 */
export async function createZone(shape, { name, color, actor, itemName = "", duration = null, maintainItemId = null, extra = {} }) {
  const combat = game.combat?.started ? game.combat : null;
  const zone = {
    ...extra,
    actorUuid: actor?.uuid ?? null, itemName,
    instant: !!duration?.instant,
    combatId: combat?.id ?? null,
    until: duration?.rounds && combat ? combat.round + duration.rounds : null,
    // Вне боя раунды не считаются — срок временем мира (раунд — 3 с), иначе зона висела бы, пока не снимут вручную
    expiresAt: duration?.rounds && !combat ? game.time.worldTime + duration.rounds * (CONFIG.time.roundTime || 3) : null,
    rounds: duration?.rounds ?? null,
    maintain: duration?.maintain ? maintainItemId : null
  };
  const data = regionData(shape, { name, color, zone });
  try {
    const [region] = await canvas.scene.createEmbeddedDocuments("Region", [data]);
    if (region && zone.instant && !combat) scheduleRemoval(region);
    return region ?? null;
  } catch (err) {
    // Игроку область создаёт ведущий; ждём её по метке — по ней цели считаются областью, а карточки (газ «Сна
    // дракона», снятие зоны несработавшего заклинания) знают, какое облако их
    console.warn("vedmak | зону создаёт ведущий", err);
    const key = foundry.utils.randomID();
    data.flags.vedmak.zone.key = key;
    const created = waitForZone(key);
    await asGM("createZone", { sceneId: canvas.scene.id, data });
    return created;
  }
}

/** Область, созданную ведущим по просьбе игрока, — по метке zone.key; null, если не пришла за timeout мс. */
function waitForZone(key, timeout = 4000) {
  return new Promise(resolve => {
    const done = region => { Hooks.off("createRegion", hook); clearTimeout(timer); resolve(region); };
    const hook = Hooks.on("createRegion", region => { if (region.flags?.vedmak?.zone?.key === key) done(region); });
    const timer = setTimeout(() => done(null), timeout);
  });
}

function scheduleRemoval(region) {
  setTimeout(() => removeZones([region]), INSTANT_SECONDS * 1000);
}

/** Удалить зоны: свои — сразу, чужие (для игрока) — просьбой к ведущему. */
export async function removeZones(regions) {
  // Уже удаляемые не трогаем: время мира, сдвинутое дважды подряд, иначе удаляло бы ту же зону второй раз
  const list = regions.filter(r => r?.parent?.regions?.has(r.id) && !removingZones.has(r.uuid));
  if (!list.length) return;
  for (const r of list) removingZones.add(r.uuid);
  try {
    const byScene = new Map();
    for (const r of list) byScene.set(r.parent, [...(byScene.get(r.parent) ?? []), r]);
    for (const [scene, rs] of byScene) {
      const mine = rs.filter(r => game.user.isGM || r.canUserModify(game.user, "delete"));
      const others = rs.filter(r => !mine.includes(r));
      if (mine.length) await scene.deleteEmbeddedDocuments("Region", mine.map(r => r.id));
      if (others.length) await asGM("deleteZones", { sceneId: scene.id, ids: others.map(r => r.id) });
    }
  } finally {
    for (const r of list) removingZones.delete(r.uuid);
  }
}
const removingZones = new Set();

/* ------------------- Область, присланная игроком, — только из белого списка ------------------- */

const finite = (v, { min = -1e6, max = 1e6 } = {}) => Number.isFinite(v) && v >= min && v <= max;
const text = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
const flag = v => (typeof v === "boolean" ? v : undefined);

/** Фигура области: только известные виды и только числовые поля (иначе null). */
function cleanShape(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = { type: raw.type };
  const nums = (keys, opts) => keys.every(k => finite(raw[k], opts) && (out[k] = raw[k]) !== undefined);
  const angles = keys => keys.every(k => raw[k] === undefined || (finite(raw[k], { min: -3600, max: 3600 }) && (out[k] = raw[k]) !== undefined));
  let ok = false;
  switch (raw.type) {
    case "circle": ok = nums(["x", "y"]) && nums(["radius"], { min: 0 }); break;
    case "ellipse": ok = nums(["x", "y"]) && nums(["radiusX", "radiusY"], { min: 0 }) && angles(["rotation"]); break;
    case "rectangle": ok = nums(["x", "y"]) && nums(["width", "height"], { min: 0 }) && angles(["rotation"])
      && (raw.anchorX === undefined || nums(["anchorX", "anchorY"], { min: 0, max: 1 })); break;
    case "cone":
      ok = nums(["x", "y"]) && nums(["radius"], { min: 0 }) && nums(["angle"], { min: 0, max: 360 }) && angles(["rotation"]);
      if (ok && ["round", "flat", "semicircle"].includes(raw.curvature)) out.curvature = raw.curvature;
      break;
    case "polygon":
      ok = Array.isArray(raw.points) && raw.points.length >= 4 && raw.points.length <= 400 && raw.points.length % 2 === 0
        && raw.points.every(n => finite(n));
      if (ok) out.points = [...raw.points];
      break;
  }
  if (!ok) return null;
  if (flag(raw.gridBased) !== undefined) out.gridBased = raw.gridBased;
  if (flag(raw.hole) !== undefined) out.hole = raw.hole;
  return out;
}

/**
 * Область для создания из присланных игроком данных. Создаёт ведущий, а у него права на всё, поэтому берутся
 * только известные поля (в первую очередь — без поведений: «Выполнить скрипт» исполнился бы с правами ведущего).
 * @returns {object|null} null — данные негодны
 */
/**
 * Особые свойства зоны от игрока: аура («Ирден», «Лунная пыль» — magic/zone-effects.mjs) и запрет магии
 * (двимеритовая бомба). Берутся из справочников по названию; из запроса — только Вын ауры и картинка.
 */
function trustedZoneExtras(z) {
  const out = {};
  const name = text(z.itemName);
  const aura = zoneAuraFor(name);
  if (aura && z.aura) {
    out.aura = { ...aura, value: finite(z.aura.value, { min: 0, max: 100 }) ? z.aura.value : 0, img: text(z.aura.img, 300) };
  }
  if (alchemyAuto(name)?.zone?.noMagic) out.noMagic = true;
  return out;
}

function cleanRegionData(raw, scene, userId) {
  if (!raw || typeof raw !== "object") return null;
  const shapes = (Array.isArray(raw.shapes) ? raw.shapes : []).map(cleanShape);
  if (!shapes.length || shapes.length > 8 || shapes.some(sh => !sh)) return null;
  const z = raw.flags?.vedmak?.zone;
  if (!z || typeof z !== "object") return null;
  const visibilities = Object.values(CONST.REGION_VISIBILITY ?? {});
  const levels = (Array.isArray(raw.levels) ? raw.levels : []).filter(id => typeof id === "string" && scene.levels?.has?.(id));
  // Цвет пользователя по сокету приходит числом (Color — наследник Number), а из окна — строкой «#rrggbb»
  const asCss = c => /^#[0-9a-f]{6}$/i.test(c) ? c
    : (Number.isInteger(c) && c >= 0 && c <= 0xffffff ? `#${c.toString(16).padStart(6, "0")}` : null);
  const color = asCss(raw.color) ?? game.users.get(userId)?.color?.css ?? "#ff6400";
  return {
    name: text(raw.name, 100) || "Зона",
    color,
    shapes,
    ...(levels.length ? { levels } : {}),
    visibility: visibilities.includes(raw.visibility) ? raw.visibility : (CONST.REGION_VISIBILITY?.ALWAYS ?? 2),
    highlightMode: raw.highlightMode === "shapes" ? "shapes" : "coverage",
    displayMeasurements: raw.displayMeasurements !== false,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE, [userId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
    flags: {
      core: { MeasuredTemplate: true },
      vedmak: { zone: {
        actorUuid: typeof z.actorUuid === "string" ? z.actorUuid : null,
        itemName: text(z.itemName),
        instant: !!z.instant,
        combatId: typeof z.combatId === "string" ? z.combatId : null,
        until: finite(z.until, { min: 0, max: 1e6 }) ? z.until : null,
        expiresAt: finite(z.expiresAt, { min: 0, max: 1e12 }) ? z.expiresAt : null,
        rounds: finite(z.rounds, { min: 0, max: 1e6 }) ? z.rounds : null,
        maintain: typeof z.maintain === "string" ? z.maintain : null,
        ...(typeof z.itemId === "string" ? { itemId: z.itemId } : {}),
        ...(typeof z.repeat === "boolean" ? { repeat: z.repeat } : {}),
        ...(typeof z.key === "string" ? { key: z.key.slice(0, 32) } : {}),
        // Аура и запрет магии — из справочников по названию, а не из запроса: игрок не задаёт штрафы сам
        ...trustedZoneExtras(z)
      } }
    }
  };
}

registerGMHandler("createZone", async ({ sceneId, data }, userId) => {
  const scene = game.scenes.get(sceneId);
  const actor = resolveActor(data?.flags?.vedmak?.zone?.actorUuid);
  if (!scene || !userOwnsAny(userId, actor)) return;
  const clean = cleanRegionData(data, scene, userId);
  if (!clean) return console.warn(`vedmak | отклонена область от ${game.users.get(userId)?.name ?? userId}`);
  const [region] = await scene.createEmbeddedDocuments("Region", [clean]);
  const zone = clean.flags.vedmak.zone;
  if (region && zone.instant && !zone.combatId) scheduleRemoval(region);
});

registerGMHandler("deleteZones", async ({ sceneId, ids }, userId) => {
  const scene = game.scenes.get(sceneId);
  if (!scene) return;
  // Игрок снимает только свои зоны
  const own = ids.map(id => scene.regions.get(id)).filter(r => r?.flags?.vedmak?.zone
    && userOwnsAny(userId, resolveActor(r.flags.vedmak.zone.actorUuid)));
  if (own.length) await scene.deleteEmbeddedDocuments("Region", own.map(r => r.id));
});

/* --------------------------------- Цели --------------------------------- */

/** Точки токена: центр и восемь точек по краю — «хотя бы краем в зоне». */
function tokenPoints(token) {
  const b = token.bounds ?? { x: token.x, y: token.y, width: token.w, height: token.h };
  const pad = 0.1;
  const xs = [b.x + b.width * pad, b.x + b.width / 2, b.x + b.width * (1 - pad)];
  const ys = [b.y + b.height * pad, b.y + b.height / 2, b.y + b.height * (1 - pad)];
  return xs.flatMap(x => ys.map(y => ({ x, y })));
}

/** Попадает ли точка в фигуру (своя геометрия: круг и конус; угол 0 — вправо, по часовой). */
function inShape(shape, p) {
  const dx = p.x - shape.x;
  const dy = p.y - shape.y;
  const dist = Math.hypot(dx, dy);
  if (dist > shape.radius + 0.5) return false;
  if (shape.type !== "cone" || dist < 0.5) return true;
  const diff = Math.atan2(dy, dx) - toRad(shape.rotation ?? 0);
  const norm = Math.atan2(Math.sin(diff), Math.cos(diff));
  return Math.abs(norm) <= toRad(shape.angle ?? 53.13) / 2 + 1e-6;
}

/** Проверка точки самой областью Foundry, если умеет; иначе своя геометрия. */
function tester(shape, region) {
  if (typeof region?.testPoint === "function") {
    return p => {
      try {
        const elevation = 0;
        const r = region.testPoint({ ...p, elevation }, elevation);
        return typeof r === "boolean" ? r : inShape(shape, p);
      } catch {
        return inShape(shape, p);
      }
    };
  }
  return p => inShape(shape, p);
}

/** Кого зона может задеть: не заклинатель, не павший; скрытых ведущим токенов игрок не видит — и зона их не выдаёт. */
function eligible(t, exclude, showHidden) {
  if (!t.actor || t === exclude) return false;
  if (t.document.hidden && !showHidden) return false;
  return !t.actor.statuses?.has(CONFIG.specialStatusEffects.DEFEATED);
}

/**
 * Токены в зоне (без заклинателя).
 * @param {object} [opts] — showHidden: брать ли скрытых; по умолчанию — только у ведущего. Повтор зоны игрока
 *   в начале хода считает ведущий, и там скрытых брать нельзя: карточка уйдёт в общий чат
 * @returns {Token[]}
 */
export function zoneTokens(shape, { region = null, exclude = null, showHidden = game.user.isGM } = {}) {
  const pick = test => canvas.tokens.placeables.filter(t => eligible(t, exclude, showHidden) && tokenPoints(t).some(test));
  const own = pick(p => inShape(shape, p));
  if (!region) return own;
  // Область Foundry точнее (поворот, уровни сцены), но если она не нашла никого, а геометрия нашла —
  // вероятнее, что не сошлась высота или уровень, чем что зона пуста
  const byRegion = pick(tester(shape, region));
  return byRegion.length || !own.length ? byRegion : own;
}

/** Точка в зоне: по области Foundry, если она умеет, иначе своя геометрия. */
export function pointInZone(region, p) {
  const shape = region?.shapes?.[0];
  return !!shape && tester(shape, region)(p);
}

/* ------------------------------ Срок действия ------------------------------ */

export const zonesOf = scene => (scene?.regions ?? []).filter(r => r.flags?.vedmak?.zone);

/** Начало хода: снять мгновенные и истёкшие зоны этого актора. */
export async function expireZonesForTurn(actor, combat) {
  const scene = combat?.scene ?? canvas?.scene;
  const expired = zonesOf(scene).filter(r => {
    const z = r.flags.vedmak.zone;
    if (z.actorUuid !== actor.uuid) return false;
    if (z.instant) return true;
    return z.until !== null && z.until !== undefined && combat && combat.round >= z.until;
  });
  if (!expired.length) return [];
  await removeZones(expired);
  return [`Зоны сняты: ${expired.map(r => r.name).join(", ")}.`];
}

/** Конец поддержания: снять зоны этого заклинания. */
export async function expireMaintainedZones(actor, itemId) {
  const scenes = game.scenes.filter(s => zonesOf(s).length);
  const regions = scenes.flatMap(s => zonesOf(s).filter(r => {
    const z = r.flags.vedmak.zone;
    return z.actorUuid === actor.uuid && z.maintain === itemId;
  }));
  await removeZones(regions);
}

/** Конец боя: снять все зоны с отсчётом раундов и мгновенные. */
export async function expireCombatZones(combat) {
  const regions = game.scenes.contents.flatMap(s => zonesOf(s).filter(r => {
    const z = r.flags.vedmak.zone;
    return z.combatId === combat.id && (z.instant || z.until !== null);
  }));
  await removeZones(regions);
}

/** Снятие зон по событиям: конец поддержания и конец боя (у активного ведущего). */
export function registerZoneHooks() {
  Hooks.on("deleteActiveEffect", effect => {
    const maintain = effect.flags?.vedmak?.maintain;
    if (!maintain || effect.parent?.documentName !== "Actor" || !game.users.activeGM?.isSelf) return;
    expireMaintainedZones(effect.parent, maintain.itemId).catch(err => console.error("vedmak | зоны", err));
  });
  Hooks.on("deleteCombat", combat => {
    if (!game.users.activeGM?.isSelf) return;
    expireCombatZones(combat).catch(err => console.error("vedmak | зоны", err));
  });
  // Зоны со сроком во времени мира (поставлены вне боя): время мира идёт и раундами боя
  Hooks.on("updateWorldTime", worldTime => {
    if (!game.users.activeGM?.isSelf) return;
    const expired = game.scenes.contents.flatMap(s => zonesOf(s))
      .filter(r => { const at = r.flags.vedmak.zone.expiresAt; return at !== null && at !== undefined && worldTime >= at; });
    if (expired.length) removeZones(expired).catch(err => console.error("vedmak | зоны", err));
  });
}
