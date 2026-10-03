// Анимации JB2A через Sequencer (PLAN 4.66) — если оба модуля включены и настройка не выключена.
// Пути в базе у бесплатной и платной JB2A различаются, поэтому на каждый эффект — список кандидатов:
// берётся первый, что есть в базе Sequencer. Нет ни одного — вызывающий рисует свой эффект.
// Каждый клиент проигрывает у себя (.locally()): хуки срабатывают у всех, рассылка дала бы дубли.

import { SYSTEM_ID } from "../util.mjs";

const CANDIDATES = {
  slash: ["jb2a.melee_generic.slash.01.orange", "jb2a.melee_generic.slash", "jb2a.melee_attack.01.trail", "jb2a.sword.melee.01.white"],
  slashHeavy: ["jb2a.melee_generic.slashing.two_handed.orange", "jb2a.greatsword.melee.standard.white", "jb2a.melee_generic.slash.01.orange"],
  arrow: ["jb2a.arrow.physical.white.01", "jb2a.arrow.physical", "jb2a.arrow"],
  bolt: ["jb2a.bolt.physical.white", "jb2a.bolt.physical", "jb2a.arrow.physical.white.01"],
  impact: ["jb2a.impact.004.orange", "jb2a.impact.002.orange", "jb2a.impact.001.orange", "jb2a.impact"],
  blood: ["jb2a.liquid.splash_side.red", "jb2a.liquid.splash.red", "jb2a.liquid.splash"],
  sparks: ["jb2a.impact.007.orange", "jb2a.impact.003.orange", "jb2a.impact.004.yellow"],
  death: ["jb2a.toll_the_dead.red.skull_smoke", "jb2a.toll_the_dead.green.skull_smoke", "jb2a.toll_the_dead"],
  aard: ["jb2a.gust_of_wind.veryfast", "jb2a.gust_of_wind.default", "jb2a.breath_weapons.cold.cone.blue"],
  igni: ["jb2a.burning_hands.01.orange", "jb2a.breath_weapons.fire.cone.orange.01", "jb2a.fire_jet.orange"],
  quen: ["jb2a.shield.01.complete.01.orange", "jb2a.shield.01.complete.01", "jb2a.shield"],
  axii: ["jb2a.dizzy_stars.400px.purple", "jb2a.dizzy_stars", "jb2a.markers.light_orb.loop.purple"],
  yrden: ["jb2a.magic_signs.circle.02.abjuration.complete.dark_purple", "jb2a.magic_signs.circle.02.abjuration", "jb2a.magic_signs.circle"],
  arcane: ["jb2a.magic_missile.purple", "jb2a.magic_missile", "jb2a.energy_strands.range.standard.purple"],
  arcaneBurst: ["jb2a.impact.010.purple", "jb2a.impact.010", "jb2a.misty_step.01.purple"],
  fire: ["jb2a.fire_bolt.orange", "jb2a.fire_bolt", "jb2a.scorching_ray.01.orange"],
  explosion: ["jb2a.explosion.01.orange", "jb2a.explosion.02.orange", "jb2a.fireball.explosion.orange", "jb2a.explosion"],
  drink: ["jb2a.healing_generic.200px.green", "jb2a.healing_generic.loop.greenorange", "jb2a.healing_generic"],
  glint: ["jb2a.static_electricity.01.blue", "jb2a.sparkles.01.yellow", "jb2a.twinkling_stars.points07.white"]
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
  cache.set(kind, key);
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
