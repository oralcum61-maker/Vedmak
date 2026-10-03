// Анимации JB2A через Sequencer (PLAN 4.66) — если оба модуля включены и настройка не выключена.
// На каждый эффект — список путей (сверены с базой бесплатной JB2A 0.9.4): берётся первый, что есть в базе
// Sequencer. Нет ни одного — вызывающий рисует свой эффект. Заклинания — своими рецептами (spell-fx.mjs).
// Каждый клиент проигрывает у себя (.locally()): хуки срабатывают у всех, рассылка дала бы дубли.

import { SYSTEM_ID } from "../util.mjs";

const CANDIDATES = {
  slash: ["jb2a.melee_generic.slash.01.orange", "jb2a.melee_attack.01.trail.01.orangered", "jb2a.sword.melee.01.white"],
  slashHeavy: ["jb2a.melee_attack.03.trail.01.orangered", "jb2a.greatsword.melee.standard.white", "jb2a.melee_generic.slash.01.orange"],
  unarmed: ["jb2a.unarmed_strike.physical.01.blue", "jb2a.melee_generic.creature_attack.fist.001.red"],
  claws: ["jb2a.claws.200px.red", "jb2a.melee_generic.creature_attack.claw.001.red"],
  bite: ["jb2a.bite.200px.red", "jb2a.claws.200px.red"],
  arrow: ["jb2a.arrow.physical.white.01", "jb2a.arrow.physical.blue"],
  bolt: ["jb2a.bolt.physical.orange", "jb2a.arrow.physical.white.01"],
  thrown: ["jb2a.dagger.throw.01.white", "jb2a.arrow.physical.white.01"],
  impact: ["jb2a.impact.005.orange", "jb2a.impact.008.orange", "jb2a.impact.010.orange"],
  blood: ["jb2a.liquid.splash_side02.red", "jb2a.liquid.splash02.red"],
  sparks: ["jb2a.impact.007.yellow", "jb2a.impact.006.yellow"],
  death: ["jb2a.toll_the_dead.green.skull_smoke"],
  aard: ["jb2a.gust_of_wind.veryfast", "jb2a.gust_of_wind.default"],
  igni: ["jb2a.burning_hands.01.orange", "jb2a.breath_weapons.fire.cone.orange.01"],
  quen: ["jb2a.markers.shield_rampart.complete.01.orange", "jb2a.shield.01.complete.01.blue"],
  axii: ["jb2a.dizzy_stars.400px.blueorange", "jb2a.markers.stun.purple.01"],
  yrden: ["jb2a.magic_signs.circle.02.illusion.complete.purple"],
  arcane: ["jb2a.magic_missile.purple", "jb2a.energy_strands.range.standard.purple.01"],
  arcaneBurst: ["jb2a.particle_burst.01.circle.bluepurple", "jb2a.impact.011.blue"],
  fire: ["jb2a.fire_bolt.orange", "jb2a.scorching_ray.01.orange"],
  explosion: ["jb2a.explosion.01.orange", "jb2a.fireball.explosion.orange"],
  drink: ["jb2a.healing_generic.200px.green", "jb2a.healing_generic.burst.greenorange"],
  glint: ["jb2a.glint.yellow.many", "jb2a.twinkling_stars.points07.white"]
};

/** Sequencer и JB2A включены, и настройка разрешает. */
export function jb2aReady() {
  try { if (!game.settings.get(SYSTEM_ID, "fxJB2A")) return false; } catch { return false; }
  const on = id => game.modules.get(id)?.active;
  return on("sequencer") && (on("JB2A_DnD5e") || on("jb2a_patreon")) && !!globalThis.Sequencer?.Database;
}

const cache = new Map();

function pick(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const key = (CANDIDATES[kind] ?? []).find(k => {
    try { return Sequencer.Database.entryExists(k); } catch { return false; }
  }) ?? null;
  // Найденное запоминаем; «не нашлось» — нет: база JB2A могла ещё не загрузиться (Sequencer наполняет её позже ready)
  if (key) cache.set(kind, key);
  return key;
}

/**
 * Сыграть анимацию JB2A.
 * @param {string} kind — ключ CANDIDATES
 * @param {{at?: object, to?: object, size?: number, scaleToObject?: number, rotateTowards?: object}} o —
 *   at/to — токен (Placeable) или точка {x, y}; size — поперечник в клетках
 * @returns {boolean} проиграно ли
 */
export function playJB2A(kind, o = {}) {
  if (!jb2aReady()) return false;
  const file = pick(kind);
  if (!file || !o.at) return false;
  try {
    const seq = new Sequence({ moduleName: "vedmak", softFail: true });
    const fx = seq.effect().file(file).atLocation(o.at).locally(true);
    if (o.to) fx.stretchTo(o.to);
    else if (o.rotateTowards) fx.rotateTowards(o.rotateTowards);
    if (o.scaleToObject && o.at.document) fx.scaleToObject(o.scaleToObject);
    else if (o.size) fx.size(o.size, { gridUnits: true });
    if (o.belowTokens) fx.belowTokens();
    seq.play();
    return true;
  } catch (err) {
    console.warn("vedmak | JB2A", kind, err);
    return false;
  }
}

const exists = key => {
  try { return !!key && Sequencer.Database.entryExists(key); } catch { return false; }
};
const gridSize = () => canvas?.grid?.size ?? 100;

/**
 * Проиграть рецепт заклинания (spell-fx.mjs).
 * @param {object} r — рецепт
 * @param {{caster: Token|null, targets: Token[], zone: object|null, origin: object|null, dir: number, length: number}} ctx —
 *   origin — начало конуса (точка зоны или заклинатель), dir — направление (рад), length — длина в клетках
 * @returns {boolean} проиграно ли
 */
export function playSpellFx(r, { caster, targets = [], zone = null, origin = null, dir = 0, length = 4 }) {
  if (!jb2aReady() || !r || !exists(r.file)) return false;
  const s = gridSize();
  const seq = new Sequence({ moduleName: "vedmak", softFail: true });
  const fx = file => seq.effect().file(file).locally(true);
  const pointAhead = (from, cells) => from ? { x: from.x + Math.cos(dir) * cells * s, y: from.y + Math.sin(dir) * cells * s } : null;
  const centerOf = t => t?.center ?? t;
  try {
    if (r.cast && caster && exists(r.cast)) fx(r.cast).atLocation(caster).scaleToObject(1.6).waitUntilFinished(-700);
    switch (r.mode) {
      case "bolt": {
        const from = caster ?? origin;
        const ends = targets.length ? targets : [pointAhead(centerOf(from), length)].filter(Boolean);
        if (!from || !ends.length) return false;
        ends.forEach((t, i) => {
          const e = fx(r.file).atLocation(from).stretchTo(t);
          if (i === ends.length - 1 && r.impact) e.waitUntilFinished(-500);
        });
        if (r.impact && exists(r.impact)) {
          for (const t of ends) {
            const e = fx(r.impact).atLocation(t);
            if (t.document) e.scaleToObject(r.impactScale ?? 1.4);
            else e.size(r.impactScale ?? 1.4, { gridUnits: true });
          }
        }
        break;
      }
      case "cone": {
        const from = origin ?? centerOf(caster);
        const end = targets.length && !zone ? centerOf(targets[0]) : pointAhead(from, length);
        if (!from || !end) return false;
        fx(r.file).atLocation(from).stretchTo(end);
        break;
      }
      case "area":
      case "ground": {
        const center = zone && zone.type !== "cone" ? { x: zone.x, y: zone.y }
          : r.atCaster || r.mode === "ground" ? centerOf(caster) : centerOf(targets[0] ?? caster);
        if (!center) return false;
        // Поперечник: по зоне (пиксели → клетки), иначе size рецепта — в метрах, а клетка сцены — dimensions.distance метров
        const size = zone?.radius && zone.type !== "cone" ? (zone.radius * 2) / s
          : (r.size ?? 3) / (canvas.dimensions?.distance || 1);
        const e = fx(r.file).atLocation(center).size(size, { gridUnits: true });
        if (r.below || r.mode === "ground") e.belowTokens();
        if (r.impact && exists(r.impact)) fx(r.impact).atLocation(center).size(Math.max(1.5, size / 2), { gridUnits: true }).delay(400);
        break;
      }
      case "self": {
        if (!caster) return false;
        fx(r.file).atLocation(caster).scaleToObject(r.scale ?? 1.6);
        break;
      }
      case "target": {
        const list = targets.length ? targets : caster ? [caster] : [];
        if (!list.length) return false;
        // Нить к цели и знак на ней: знак — с небольшой задержкой, а не после всей нити (она длинная)
        const linked = r.link && caster && exists(r.link) ? list.filter(t => t !== caster) : [];
        for (const t of linked) fx(r.link).atLocation(caster).stretchTo(t);
        for (const t of list) {
          const e = fx(r.file).atLocation(t).scaleToObject(r.scale ?? 1.4);
          if (linked.length) e.delay(450);
        }
        break;
      }
      default:
        return false;
    }
    seq.play();
    return true;
  } catch (err) {
    console.warn("vedmak | JB2A заклинание", r.file, err);
    return false;
  }
}

/**
 * Подгрузить заранее анимации боя (по первой из списка на каждый вид): иначе первый удар за сессию
 * ждёт загрузки файла и запаздывает на секунду. Заклинания грузятся по требованию — их сотни.
 */
export function preloadCombatFx() {
  if (!jb2aReady() || !globalThis.Sequencer?.Preloader) return;
  const files = ["slash", "slashHeavy", "unarmed", "claws", "bite", "arrow", "bolt", "impact", "blood", "sparks", "death"]
    .map(pick).filter(Boolean);
  try { Sequencer.Preloader.preload(files, false)?.catch?.(() => {}); } catch { /* старый Sequencer — без предзагрузки */ }
}

/**
 * Проиграть шаги анимации атаки (weapon-fx.mjs) от атакующего к цели.
 * @param {object[]} steps — {file, mode: swing|target|self|ground, scale, delay, mirror, opacity, below}
 * @param {{from: Token|null, to: Token|null}} ends
 * @returns {boolean} проиграно ли хоть что-то
 */
export function playSteps(steps, { from = null, to = null } = {}) {
  if (!jb2aReady() || !steps?.length) return false;
  const seq = new Sequence({ moduleName: "vedmak", softFail: true });
  let n = 0;
  try {
    for (const st of steps) {
      if (!exists(st.file)) continue;
      // Чего не хватает (нет цели у замаха, нет бойца у «на себе») — шаг пропускаем
      if (st.mode === "swing" && !(from && to)) continue;
      if ((st.mode === "target" || st.mode === "ground") && !to) continue;
      if ((st.mode === "self" || st.mode === "kick") && !from) continue;
      if (st.mode === "kick" && !to) continue;
      const e = seq.effect().file(st.file).locally(true);
      if (st.mode === "swing") {
        // Замах рассчитан на соседнюю клетку: если цель дальше (древковое, разбег), он идёт с клетки рядом с ней,
        // а не растягивается во весь путь. Снаряды, дыхание и порыв — от самого атакующего
        let start = from;
        if (!st.proj && !st.full) {
          const a = from.center ?? from, b = to.center ?? to, g = canvas?.grid?.size ?? 100;
          const dist = Math.hypot(b.x - a.x, b.y - a.y);
          if (dist > g * 1.6) start = { x: b.x - ((b.x - a.x) / dist) * g * 1.1, y: b.y - ((b.y - a.y) / dist) * g * 1.1 };
        }
        e.atLocation(start).stretchTo(to);
        if (st.mirror) e.mirrorY();
      } else if (st.mode === "kick") {
        // Пыль из-под ног: на атакующем, клубится назад, от цели
        e.atLocation(from).rotateTowards(to).scaleToObject(st.scale ?? 1.2).mirrorX();
      } else if (st.mode === "self") {
        e.atLocation(from).size(st.scale ?? 3, { gridUnits: true });
        if (st.below) e.belowTokens();
      } else {
        e.atLocation(to).scaleToObject(st.scale ?? 1.3);
        if (st.mode === "ground") e.belowTokens();
      }
      if (st.delay) e.delay(st.delay);
      if (st.opacity) e.opacity(st.opacity);
      // Плавное появление и исчезновение (корни, паутина): без него анимация возникает и пропадает рывком
      if (st.fadeIn) e.fadeIn(st.fadeIn, { ease: "easeOutCubic" });
      if (st.fadeOut) e.fadeOut(st.fadeOut, { ease: "easeInCubic" });
      if (st.scaleIn) e.scaleIn(st.scaleIn, st.scaleInMs ?? 500, { ease: "easeOutCubic" });
      if (st.playbackRate) e.playbackRate(st.playbackRate);
      n++;
    }
    if (!n) return false;
    seq.play();
    return true;
  } catch (err) {
    console.warn("vedmak | JB2A атака", err);
    return false;
  }
}
