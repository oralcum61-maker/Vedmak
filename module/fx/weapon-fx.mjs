// Анимации JB2A для атак (PLAN 4.70): своё оружие — свой замах, вид атаки — свой рисунок, тип урона — свой удар.
// Пути сверены с бесплатной JB2A 0.9.4. Нет JB2A — работают свои эффекты (scene.mjs), этот файл не нужен.
//
// Шаг анимации (spec): { file, mode, scale, delay, mirror, opacity, proj, full }
//   swing  — от атакующего к цели (оружейные файлы JB2A рассчитаны на соседнюю клетку: если цель дальше, замах идёт
//            с клетки рядом с ней); proj — снаряд, full — дыхание и порыв: эти всегда от самого атакующего;
//   target — на цели (когти, укус, удар, кровь), scale — во сколько раз больше токена;
//   self   — на атакующем (рёв, кольцо огня, топот);
//   ground — под целью, ниже токенов (трещина от подсечки или топота).

const W = {
  sword: "jb2a.sword.melee.01.white",
  greatsword: "jb2a.greatsword.melee.standard.white",
  falchion: "jb2a.falchion.melee.01.white",
  scimitar: "jb2a.scimitar.melee.01.white",
  rapier: "jb2a.rapier.melee.01.white",
  dagger: "jb2a.dagger.melee.02.white",
  sickle: "jb2a.melee_attack.01.sickle.01",
  handaxe: "jb2a.handaxe.melee.standard.white",
  greataxe: "jb2a.greataxe.melee.standard.white",
  mace: "jb2a.mace.melee.01.white",
  flail: "jb2a.melee_attack.01.flail.01",
  warhammer: "jb2a.warhammer.melee.01.white",
  maul: "jb2a.maul.melee.standard.white",
  club: "jb2a.club.melee.01.white",
  greatclub: "jb2a.greatclub.standard.white",
  spear: "jb2a.spear.melee.01.white",
  halberd: "jb2a.halberd.melee.01.white",
  glaive: "jb2a.glaive.melee.01.white",
  scythe: "jb2a.melee_attack.05.scythe.01",
  staff: "jb2a.quarterstaff.melee.01.white",
  whip: "jb2a.melee_attack.05.trail.01.orangered",
  shield: "jb2a.melee_attack.06.shield.01",
  fist: "jb2a.unarmed_strike.physical.01.blue",
  kick: "jb2a.unarmed_strike.physical.02.blue",
  flurry: "jb2a.flurry_of_blows.physical.blue",
  arrow: "jb2a.arrow.physical.white.01",
  arrowMoon: "jb2a.arrow.physical.blue",
  bolt: "jb2a.bolt.physical.orange",
  knife: "jb2a.dagger.throw.01.white",
  stone: "jb2a.boulder.toss.02.01.stone.brown",
  needle: "jb2a.arrow.poison.green.01",
  net: "jb2a.web.02"
};

const TRAIL_HEAVY = "jb2a.melee_attack.03.trail.01.orangered";
const GUST = "jb2a.gust_of_wind.veryfast";
const CRACK = "jb2a.impact.ground_crack.orange.02";
const CHAIN = "jb2a.markers.chain.standard.complete.02.red";

const has = (name, ...words) => words.some(w => name.includes(w));

/** Чем бьёт оружие: файл замаха по названию, категории и хвату. */
function weaponFile(weapon = {}, sourceKind = "") {
  const n = String(weapon.name ?? "").toLowerCase();
  const two = Number(weapon.hands) >= 2;
  if (sourceKind === "shield") return { file: W.shield };
  if (weapon.unarmed) return { file: W.fist };
  switch (weapon.category) {
    case "sword":
      if (has(n, "фальшион", "мессер")) return { file: W.falchion };
      return { file: two || has(n, "фламберг", "полуторн") ? W.greatsword : W.sword };
    case "smallBlade":
      if (has(n, "серп")) return { file: W.sickle };
      if (has(n, "секач", "джамби")) return { file: W.scimitar };
      return { file: W.dagger };
    case "axe":
      return { file: two ? W.greataxe : W.handaxe };
    case "bludgeon":
      if (has(n, "укус", "зуб")) return { target: "jb2a.bite.200px.red" };
      if (has(n, "кистень")) return { file: W.flail };
      if (has(n, "кнут")) return { file: W.whip };
      if (has(n, "кастет")) return { file: W.fist };
      if (has(n, "булав", "звезда смерти", "ламия", "пожиратель")) return { file: W.mace };
      if (has(n, "молот", "мартель", "клевец", "кирк", "огх")) return { file: two ? W.maul : W.warhammer };
      return { file: two ? W.greatclub : W.club };
    case "pole":
      if (has(n, "коса")) return { file: W.scythe };
      if (has(n, "глеф")) return { file: W.glaive };
      if (has(n, "алебард", "секир", "фальшард", "снежная буря")) return { file: W.halberd };
      if (has(n, "молот")) return { file: W.maul };
      return { file: W.spear };
    case "staff":
      return { file: W.staff };
    case "thrown":
      if (has(n, "сеть")) return { target: W.net, scale: 1.6 };
      return { projectile: W.knife };
    case "bow":
      return { projectile: has(n, "лунный") ? W.arrowMoon : W.arrow };
    case "crossbow":
      return { projectile: W.bolt };
    case "other":
      return { file: has(n, "нога") ? W.kick : W.fist };
  }
  return { file: W.sword };
}

/**
 * Естественные атаки чудовищ — по названию. Возвращает шаги анимации в момент атаки и что показать при попадании.
 * @returns {{now: object[], hit: object[]}}
 */
function naturalFx(name) {
  const n = String(name ?? "").toLowerCase();
  const at = (file, scale = 1.3) => ({ file, mode: "target", scale });
  if (has(n, "укус", "клык", "зуб")) return { now: [], hit: [at("jb2a.bite.200px.red", 1.2)] };
  if (has(n, "когт", "лап")) return { now: [], hit: [at("jb2a.claws.200px.red", 1.2)] };
  if (has(n, "хвост", "кнут", "хлыст")) return { now: [{ file: W.whip, mode: "swing" }], hit: [at("jb2a.impact.009.orange")] };
  if (has(n, "дыхани", "поток огня", "волна угл")) return { now: [{ file: "jb2a.breath_weapons.fire.cone.orange.01", mode: "swing", full: true }], hit: [] };
  if (has(n, "кольцо огня", "пламенн")) return { now: [{ file: "jb2a.fire_ring.500px.red", mode: "self", scale: 4 }], hit: [] };
  if (has(n, "огненный шар")) return { now: [{ file: "jb2a.fire_bolt.orange", mode: "swing", proj: true }], hit: [at("jb2a.impact.fire.01.orange")] };
  if (has(n, "кольцо льда", "ледян")) return { now: [{ file: "jb2a.ice_spikes.radial.burst.white", mode: "self", scale: 4 }], hit: [] };
  if (has(n, "кольцо камней", "землетрясен", "в землю", "землекруш", "топот")) return { now: [{ file: CRACK, mode: "self", scale: 4, below: true }], hit: [] };
  if (has(n, "кислот", "рвот")) return { now: [{ file: "jb2a.breath_weapons.acid.line.green", mode: "swing", full: true }], hit: [] };
  if (has(n, "яд")) return { now: [{ file: "jb2a.breath_weapons.poison.cone.green", mode: "swing", full: true }], hit: [] };
  if (has(n, "пепл")) return { now: [{ file: "jb2a.smoke.plumes.01.grey", mode: "self", scale: 3 }], hit: [] };
  if (has(n, "паутин")) return { now: [], hit: [at(W.net, 1.6)] };
  if (has(n, "игл", "шип")) return { now: [{ file: W.needle, mode: "swing", proj: true }], hit: [] };
  if (has(n, "камн", "валун")) return { now: [{ file: W.stone, mode: "swing", proj: true }], hit: [at(CRACK)] };
  if (has(n, "вопль", "вой", "звуков", "психическ")) return { now: [{ file: "jb2a.soundwave.02.blue", mode: "self", scale: 4 }], hit: [] };
  if (has(n, "крыл")) return { now: [{ file: GUST, mode: "swing", full: true }], hit: [] };
  if (has(n, "меч")) return { now: [{ file: W.sword, mode: "swing" }], hit: [] };
  if (has(n, "дубин")) return { now: [{ file: W.greatclub, mode: "swing" }], hit: [] };
  if (has(n, "корн")) return { now: [], hit: [at("jb2a.entangle.green", 1.5)] };
  if (has(n, "взрыв", "перерожд")) return { now: [{ file: "jb2a.explosion.01.orange", mode: "self", scale: 3 }], hit: [] };
  if (has(n, "кулак", "рук")) return { now: [{ file: W.fist, mode: "swing" }], hit: [] };
  // Рога, копыта, таран, разбег, просто «удар»
  return { now: [], hit: [at("jb2a.impact.009.orange", 1.4)] };
}

/** Вид атаки меняет рисунок замаха (стр. 165–167). */
function styled(base, attackType) {
  const swing = { file: base, mode: "swing" };
  switch (attackType) {
    case "strong":
      return [swing, { file: TRAIL_HEAVY, mode: "swing", delay: 120 }];
    case "charge":
      return [{ file: GUST, mode: "swing", full: true }, { ...swing, delay: 280 }];
    case "pommel":
      return [{ file: W.kick, mode: "swing" }];
    case "trip":
      return [swing, { file: CRACK, mode: "ground", scale: 1, delay: 350 }];
    case "feint":
      return [{ ...swing, opacity: 0.4, mirror: true }, { ...swing, delay: 380 }];
    case "dual":
      return [swing, { ...swing, mirror: true, delay: 260 }];
    case "disarm":
      return [swing, { file: "jb2a.impact.006.yellow", mode: "target", scale: 0.8, delay: 400 }];
  }
  return [swing];
}

/** Приёмы без оружия. */
function unarmedFx(attackType) {
  switch (attackType) {
    case "punchStrong": return [{ file: W.kick, mode: "swing" }];
    case "kick": return [{ file: W.kick, mode: "swing" }];
    case "kickStrong": return [{ file: W.flurry, mode: "swing" }];
    case "pushKick": return [{ file: W.kick, mode: "swing" }, { file: GUST, mode: "swing", full: true, delay: 200 }];
    case "charge": return [{ file: GUST, mode: "swing", full: true }, { file: W.kick, mode: "swing", delay: 280 }];
    case "grapple":
    case "pin":
    case "choke": return [{ file: CHAIN, mode: "target", scale: 1.2 }];
    case "throw": return [{ file: W.kick, mode: "swing" }, { file: CRACK, mode: "ground", scale: 1.2, delay: 450 }];
    case "trip": return [{ file: CRACK, mode: "ground", scale: 1, delay: 150 }];
  }
  return [{ file: W.fist, mode: "swing" }];
}

/**
 * Анимация в момент атаки (карточка атаки).
 * @param {object} a — flags.vedmak.attack
 * @returns {object[]} шаги; пусто — показать нечего (естественные атаки бьют на попадании)
 */
export function attackSteps(a) {
  const w = a.weapon ?? {};
  if (a.source?.kind === "ram") return [{ file: GUST, mode: "swing", full: true }, { file: "jb2a.impact.009.orange", mode: "target", scale: 1.6, delay: 300 }];
  if (a.source?.kind === "unarmed" || w.unarmed) return unarmedFx(a.attackType);
  if (w.category === "natural") return naturalFx(w.name).now;
  const f = weaponFile(w, a.source?.kind);
  if (f.projectile) return [{ file: f.projectile, mode: "swing", proj: true }];
  if (f.target) return [{ file: f.target, mode: "target", scale: f.scale ?? 1.3, delay: 200 }];
  return styled(f.file, a.attackType);
}

/**
 * Анимация попадания (карточка защиты): по типу урона, у чудовищ — по виду атаки; крит — сильнее.
 * @param {object} d — flags.vedmak.defense
 */
export function hitSteps(d) {
  const w = d.attack?.weapon ?? {};
  const crit = !!d.critLevel;
  const steps = [];
  if (w.category === "natural") steps.push(...naturalFx(w.name).hit);
  const types = w.damageTypes ?? [];
  if (types.includes("slashing")) steps.push({ file: "jb2a.liquid.splash_side02.red", mode: "target", scale: crit ? 1.6 : 1.1 });
  else if (types.includes("piercing")) steps.push({ file: "jb2a.impact.010.orange", mode: "target", scale: crit ? 1.2 : 0.8 },
    { file: "jb2a.liquid.splash02.red", mode: "target", scale: 0.7, delay: 120 });
  else steps.push({ file: crit ? "jb2a.impact.009.orange" : "jb2a.impact.005.orange", mode: "target", scale: crit ? 1.6 : 1.1 });
  if (crit) steps.push({ file: "jb2a.impact.014.001.orangeyellow", mode: "target", scale: 1.5, delay: 80 });
  return steps;
}

/** Блок, парирование, блок рукой. */
export function blockSteps(kind) {
  if (kind === "parry") return [{ file: "jb2a.impact.006.yellow", mode: "target", scale: 1 }];
  if (kind === "brawlBlock") return [{ file: "jb2a.impact.005.orange", mode: "target", scale: 0.8 }];
  return [{ file: "jb2a.impact.007.yellow", mode: "target", scale: 1 }];
}
