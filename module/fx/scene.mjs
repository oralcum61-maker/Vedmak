// Свои эффекты на сцене (PLAN 4.66): рисуются PIXI поверх токенов, без модулей. Размеры — от клетки сцены.
// Каждый эффект живёт долю секунды и убирает себя сам; в фоновой вкладке (кадры стоят) — по таймеру.

const TAU = Math.PI * 2;
const ADD = () => PIXI.BLEND_MODES.ADD;

let layer = null;

/** Слой эффектов над токенами (интерфейсная группа сцены). */
function fxLayer() {
  if (!canvas?.ready || !canvas.interface) return null;
  if (layer && !layer.destroyed && layer.parent) return layer;
  layer = new PIXI.Container();
  layer.eventMode = "none";
  layer.zIndex = 900;
  canvas.interface.addChild(layer);
  canvas.interface.sortableChildren = true;
  return layer;
}
Hooks.on("canvasTearDown", () => { layer = null; });

const gs = () => canvas?.grid?.size ?? 100;
const lerp = (a, b, p) => a + (b - a) * p;
const easeOut = p => 1 - (1 - p) ** 3;
const rand = (a, b) => a + Math.random() * (b - a);

/**
 * Прокрутить анимацию: step(p) на каждом кадре, p — от 0 до 1. Предохранитель убирает графику, если кадров нет.
 * @returns {Promise<void>}
 */
function animate(display, duration, step) {
  const root = fxLayer();
  if (!root) return Promise.resolve();
  root.addChild(display);
  const start = performance.now();
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      canvas.app?.ticker?.remove(tick);
      clearTimeout(guard);
      if (!display.destroyed) display.destroy({ children: true });
      resolve();
    };
    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / duration);
      try { step(p); } catch (err) { console.warn("vedmak | эффект", err); return finish(); }
      if (p >= 1) finish();
    };
    const guard = setTimeout(finish, duration + 1500);
    canvas.app.ticker.add(tick);
  });
}

/** Центр токена или точки. */
export function pointOf(thing) {
  if (!thing) return null;
  if (thing.center) return { x: thing.center.x, y: thing.center.y };
  if (typeof thing.x === "number") return { x: thing.x, y: thing.y };
  return null;
}

/* ---------------------------------------------------------------- Частицы */

/**
 * Облако частиц: вылетают из точки, тормозят, гаснут.
 * @param {object} o — count, color (число или массив), speed [min,max] в клетках/с, life [min,max] мс, size [min,max] в долях
 *   клетки, angle и spread — направление и раствор (рад), gravity (клеток/с²), drag (0..1 за кадр), blend, streak
 */
function particles(at, o) {
  const g = new PIXI.Graphics();
  if (o.blend !== false) g.blendMode = ADD();
  const s = gs();
  const colors = Array.isArray(o.color) ? o.color : [o.color];
  const ps = Array.from({ length: o.count }, () => {
    const a = (o.angle ?? 0) + rand(-(o.spread ?? TAU) / 2, (o.spread ?? TAU) / 2);
    const v = rand(...o.speed) * s;
    const r = o.radius ? rand(0, o.radius) * s : 0;
    return {
      x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: rand(...o.life), born: rand(0, o.stagger ?? 0), size: rand(...o.size) * s,
      color: colors[Math.floor(Math.random() * colors.length)]
    };
  });
  const total = Math.max(...ps.map(p => p.born + p.life));
  let prev = 0;
  return animate(g, total, p => {
    const now = p * total;
    const dt = Math.max(0, (now - prev) / 1000);
    prev = now;
    g.clear();
    for (const q of ps) {
      const age = now - q.born;
      if (age < 0 || age > q.life) continue;
      // Торможение — за время, а не за кадр: при 30 и 144 кадрах частица летит одинаково
      const k60 = (o.drag ?? 0.94) ** (dt * 60);
      q.vx *= k60;
      q.vy = q.vy * k60 + (o.gravity ?? 0) * s * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      const k = 1 - age / q.life;
      const alpha = (o.alpha ?? 1) * (o.fadeIn ? Math.min(1, age / 80) : 1) * k;
      const size = q.size * (o.grow ? lerp(0.6, 1.6, 1 - k) : lerp(0.4, 1, k));
      if (o.streak) {
        g.lineStyle(Math.max(1, size * 0.5), q.color, alpha);
        g.moveTo(q.x, q.y);
        g.lineTo(q.x - q.vx * 0.04, q.y - q.vy * 0.04);
      } else {
        g.lineStyle(0);
        g.beginFill(q.color, alpha);
        g.drawCircle(q.x, q.y, size);
        g.endFill();
      }
    }
  });
}

/** Расходящееся кольцо. */
function ring(at, { color, from = 0.1, to = 0.8, width = 0.06, duration = 450, alpha = 0.9 }) {
  const g = new PIXI.Graphics();
  g.blendMode = ADD();
  const s = gs();
  return animate(g, duration, p => {
    const e = easeOut(p);
    g.clear();
    g.lineStyle(Math.max(1, width * s * (1 - p)), color, alpha * (1 - p));
    g.drawCircle(at.x, at.y, lerp(from, to, e) * s);
  });
}

/** Вспышка — мягкий круг, гаснет. */
function flash(at, { color, radius = 0.6, duration = 220, alpha = 0.6 }) {
  const g = new PIXI.Graphics();
  g.blendMode = ADD();
  const s = gs();
  return animate(g, duration, p => {
    g.clear();
    for (let i = 3; i >= 1; i--) {
      g.beginFill(color, alpha * (1 - p) * (0.35 / i));
      g.drawCircle(at.x, at.y, radius * s * (0.5 + i * 0.3) * (0.8 + 0.4 * p));
      g.endFill();
    }
  });
}

/** Подпись над точкой («Промах», «Блок», «Крит!»). */
export function floatText(at, text, color = 0xf1ece0) {
  if (!at || !canvas.interface?.createScrollingText) return;
  canvas.interface.createScrollingText(at, text, {
    anchor: CONST.TEXT_ANCHOR_POINTS.TOP, direction: CONST.TEXT_ANCHOR_POINTS.TOP,
    fontSize: 30, fill: color, stroke: 0x050607, strokeThickness: 5, jitter: 0.25, duration: 1600
  });
}

/* ---------------------------------------------------------------- Бой */

/** Взмах клинка: дуга поперёк направления удара на цели. */
export function slash(to, from, { color = 0xf2ece0, heavy = false } = {}) {
  if (!to) return;
  // Тёмная подложка (обычное смешение) — чтобы дугу было видно и на светлой карте; поверх — свечение
  const box = new PIXI.Container();
  const shade = box.addChild(new PIXI.Graphics());
  const g = box.addChild(new PIXI.Graphics());
  g.blendMode = ADD();
  const s = gs();
  const dir = from ? Math.atan2(to.y - from.y, to.x - from.x) : rand(0, TAU);
  const r = s * (heavy ? 0.7 : 0.55);
  const span = heavy ? 2.3 : 1.9;
  const a0 = dir - Math.PI / 2 - span / 2;
  const flip = Math.random() < 0.5 ? 1 : -1;
  animate(box, heavy ? 380 : 300, p => {
    const e = easeOut(p);
    g.clear();
    shade.clear();
    const head = a0 + span * e;
    const tail = a0 + span * Math.max(0, e - 0.45);
    const fade = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
    const cx = to.x - Math.cos(dir) * s * 0.15;
    const cy = to.y - Math.sin(dir) * s * 0.15;
    const arc = (w, c, a, gr = g) => {
      gr.lineStyle(w, c, a * fade);
      const st = flip > 0 ? tail : -tail + 2 * dir;
      const en = flip > 0 ? head : -head + 2 * dir;
      const lo = Math.min(st, en);
      gr.moveTo(cx + Math.cos(lo) * r, cy + Math.sin(lo) * r);
      gr.arc(cx, cy, r, lo, Math.max(st, en));
    };
    arc(s * (heavy ? 0.13 : 0.1), 0x050607, 0.35, shade);
    arc(s * (heavy ? 0.16 : 0.12), color, 0.45);
    arc(s * 0.055, 0xffffff, 1);
  });
}

/** Снаряд: стрела или болт летит от стрелка к цели; по прилёте — удар. */
export function projectile(from, to, { color = 0xe2ddd0, onHit } = {}) {
  if (!from || !to) return Promise.resolve();
  const g = new PIXI.Graphics();
  const s = gs();
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const dir = Math.atan2(to.y - from.y, to.x - from.x);
  const duration = Math.min(600, 120 + dist / s * 45);
  const len = s * 0.45;
  return animate(g, duration, p => {
    const x = lerp(from.x, to.x, p);
    const y = lerp(from.y, to.y, p);
    g.clear();
    g.lineStyle(s * 0.05, color, 0.35);
    g.moveTo(x - Math.cos(dir) * len * 1.8, y - Math.sin(dir) * len * 1.8);
    g.lineTo(x, y);
    g.lineStyle(Math.max(2, s * 0.025), 0xf8f4ea, 1);
    g.moveTo(x - Math.cos(dir) * len, y - Math.sin(dir) * len);
    g.lineTo(x, y);
  }).then(() => onHit?.());
}

/** Удар: вспышка, кольцо, искры. */
export function impact(at, { color = 0xf0a08c, scale = 1 } = {}) {
  if (!at) return;
  flash(at, { color, radius: 0.45 * scale });
  ring(at, { color, to: 0.6 * scale, duration: 380 });
  particles(at, { count: Math.round(14 * scale), color: [color, 0xffffff], speed: [2, 6], life: [180, 380], size: [0.015, 0.035], streak: true });
}

/** Кровь: тёмные брызги, без свечения. */
export function blood(at, from, { scale = 1 } = {}) {
  if (!at) return;
  const dir = from ? Math.atan2(at.y - from.y, at.x - from.x) : rand(0, TAU);
  particles(at, {
    count: Math.round(22 * scale), color: [0x8f1d12, 0x6e1510, 0xb8302a], speed: [1.5, 4.5], life: [350, 700],
    size: [0.02, 0.05], angle: dir, spread: 1.6, gravity: 3, drag: 0.9, blend: false
  });
  flash(at, { color: 0xb8302a, radius: 0.5, duration: 260, alpha: 0.45 });
}

/** Искры стали — блок и парирование. */
export function sparks(at, from) {
  if (!at) return;
  const dir = from ? Math.atan2(from.y - at.y, from.x - at.x) : rand(0, TAU);
  const p = { x: at.x + Math.cos(dir) * gs() * 0.3, y: at.y + Math.sin(dir) * gs() * 0.3 };
  flash(p, { color: 0xffe2a0, radius: 0.3, duration: 160, alpha: 0.9 });
  particles(p, { count: 26, color: [0xfff3c4, 0xffc463, 0xffffff], speed: [3, 8], life: [150, 420], size: [0.012, 0.025],
    angle: dir, spread: 2.4, gravity: 4, drag: 0.92, streak: true });
}

/** Промах: свист мимо цели. */
export function whoosh(to, from) {
  if (!to) return;
  const s = gs();
  const dir = from ? Math.atan2(to.y - from.y, to.x - from.x) : 0;
  const side = dir + Math.PI / 2;
  const off = s * 0.55;
  const a = { x: to.x - Math.cos(dir) * s * 0.8 + Math.cos(side) * off, y: to.y - Math.sin(dir) * s * 0.8 + Math.sin(side) * off };
  const b = { x: to.x + Math.cos(dir) * s * 0.9 + Math.cos(side) * off, y: to.y + Math.sin(dir) * s * 0.9 + Math.sin(side) * off };
  const g = new PIXI.Graphics();
  g.blendMode = ADD();
  animate(g, 260, p => {
    g.clear();
    const head = easeOut(p);
    const tail = Math.max(0, head - 0.5);
    g.lineStyle(s * 0.04, 0xe2ddd0, 0.7 * (1 - p));
    g.moveTo(lerp(a.x, b.x, tail), lerp(a.y, b.y, tail));
    g.lineTo(lerp(a.x, b.x, head), lerp(a.y, b.y, head));
  });
}

/** Смерть: тёмный дым поднимается, красное кольцо. */
export function death(at) {
  if (!at) return;
  ring(at, { color: 0x8f1d12, from: 0.2, to: 1.1, width: 0.08, duration: 900, alpha: 0.8 });
  particles(at, { count: 30, color: [0x1a1a1c, 0x2a2224, 0x3a1614], speed: [0.2, 0.8], life: [900, 1600], size: [0.08, 0.16],
    angle: -Math.PI / 2, spread: 1.4, radius: 0.35, gravity: -0.6, drag: 0.98, blend: false, grow: true, alpha: 0.7, stagger: 300, fadeIn: true });
}

/** Провал: облачко пыли у атакующего. */
export function fizzle(at, color = 0xa8a296) {
  if (!at) return;
  particles(at, { count: 14, color, speed: [0.3, 1.2], life: [400, 800], size: [0.04, 0.08], gravity: -0.4, blend: false, grow: true, alpha: 0.5 });
}

/* ---------------------------------------------------------------- Магия */

/** Аард: ударная волна конусом. */
export function aard(from, dir, length = 4, width = 0.9) {
  if (!from) return;
  const s = gs();
  const box = new PIXI.Container();
  const shade = box.addChild(new PIXI.Graphics());
  const g = box.addChild(new PIXI.Graphics());
  g.blendMode = ADD();
  animate(box, 700, p => {
    g.clear();
    shade.clear();
    for (let i = 0; i < 3; i++) {
      const q = Math.max(0, Math.min(1, p * 1.4 - i * 0.18));
      if (!q) continue;
      const r = easeOut(q) * length * s;
      for (const [gr, w, c, a] of [[shade, 0.13, 0x1a2430, 0.3], [g, 0.1, 0xdcecff, 0.8]]) {
        gr.lineStyle(s * w * (1 - q), c, a * (1 - q));
        gr.moveTo(from.x + Math.cos(dir - width / 2) * r, from.y + Math.sin(dir - width / 2) * r);
        gr.arc(from.x, from.y, r, dir - width / 2, dir + width / 2);
      }
    }
  });
  particles({ x: from.x + Math.cos(dir) * s * 0.4, y: from.y + Math.sin(dir) * s * 0.4 }, {
    count: 40, color: [0xcfe2ff, 0xffffff, 0xa8b8cc], speed: [length * 2.5, length * 4.5], life: [350, 700], size: [0.02, 0.05],
    angle: dir, spread: width, drag: 0.95, streak: true, alpha: 0.75
  });
}

/** Игни: огонь конусом. */
export function igni(from, dir, length = 4, width = 0.9) {
  if (!from) return;
  const s = gs();
  flash(from, { color: 0xff8a3a, radius: 0.5, duration: 300 });
  particles({ x: from.x + Math.cos(dir) * s * 0.3, y: from.y + Math.sin(dir) * s * 0.3 }, {
    count: 120, color: [0xffd27a, 0xff9a3a, 0xff5a1f, 0xd8341a], speed: [length * 2.6, length * 4.2], life: [450, 850],
    size: [0.05, 0.12], angle: dir, spread: width * 0.9, drag: 0.965, grow: true, stagger: 380, alpha: 0.85
  });
}

/** Квен: золотой щит вокруг токена. */
export function quen(at) {
  if (!at) return;
  const s = gs();
  const g = new PIXI.Graphics();
  g.blendMode = ADD();
  const hex = (r, rot) => Array.from({ length: 7 }, (_, i) => {
    const a = rot + i * TAU / 6;
    return [at.x + Math.cos(a) * r, at.y + Math.sin(a) * r];
  });
  animate(g, 1400, p => {
    const grow = easeOut(Math.min(1, p / 0.3));
    const fade = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
    const r = s * 0.75 * grow * (1 + 0.04 * Math.sin(p * TAU * 3));
    g.clear();
    g.beginFill(0xf0c24a, 0.12 * fade);
    g.drawCircle(at.x, at.y, r);
    g.endFill();
    for (const [w, a] of [[s * 0.08, 0.25], [s * 0.025, 0.9]]) {
      g.lineStyle(w, 0xffd970, a * fade);
      const pts = hex(r, p * 0.8);
      g.moveTo(...pts[0]);
      for (const pt of pts.slice(1)) g.lineTo(...pt);
    }
  });
  particles(at, { count: 20, color: [0xffe29a, 0xffffff], speed: [0.3, 1], life: [500, 1000], size: [0.012, 0.025], radius: 0.7, stagger: 500 });
}

/** Аксий: фиолетовая спираль на цели. */
export function axii(at) {
  if (!at) return;
  const s = gs();
  const g = new PIXI.Graphics();
  g.blendMode = ADD();
  animate(g, 1100, p => {
    g.clear();
    const fade = p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25;
    for (let k = 0; k < 3; k++) {
      const rot = p * TAU * 1.5 + k * TAU / 3;
      g.lineStyle(s * 0.035, 0xc9a8ff, 0.8 * fade);
      for (let i = 0; i <= 24; i++) {
        const q = i / 24;
        const r = s * lerp(0.75, 0.08, q) * (1 - 0.3 * p);
        const a = rot + q * Math.PI * 1.4;
        const x = at.x + Math.cos(a) * r;
        const y = at.y + Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    }
  });
  flash(at, { color: 0x9a6ae0, radius: 0.5, duration: 900, alpha: 0.35 });
}

/** Ирден: магический круг со звездой. */
export function yrden(at, radius = 1.2) {
  if (!at) return;
  const s = gs();
  const g = new PIXI.Graphics();
  g.blendMode = ADD();
  const R = Math.max(0.8, radius) * s;
  animate(g, 1700, p => {
    g.clear();
    const fade = p < 0.15 ? p / 0.15 : p > 0.75 ? 1 - (p - 0.75) / 0.25 : 1;
    const rot = p * 0.6;
    g.lineStyle(s * 0.035, 0xb48cff, 0.85 * fade);
    g.drawCircle(at.x, at.y, R);
    g.lineStyle(s * 0.02, 0xd6c2ff, 0.7 * fade);
    g.drawCircle(at.x, at.y, R * 0.86);
    const pts = Array.from({ length: 7 }, (_, i) => rot + i * TAU / 7);
    for (let i = 0; i < 7; i++) {
      const a = pts[i];
      const b = pts[(i + 3) % 7];
      g.moveTo(at.x + Math.cos(a) * R * 0.86, at.y + Math.sin(a) * R * 0.86);
      g.lineTo(at.x + Math.cos(b) * R * 0.86, at.y + Math.sin(b) * R * 0.86);
    }
    for (let i = 0; i < 21; i++) {
      const a = -rot * 1.5 + i * TAU / 21;
      g.moveTo(at.x + Math.cos(a) * R * 0.9, at.y + Math.sin(a) * R * 0.9);
      g.lineTo(at.x + Math.cos(a) * R * 0.97, at.y + Math.sin(a) * R * 0.97);
    }
  });
}

/** Прочая магия: сгусток летит к цели или вспыхивает у заклинателя. */
export function arcane(from, to, color = 0xc9bdf0) {
  if (!from) return;
  flash(from, { color, radius: 0.5, duration: 350 });
  particles(from, { count: 18, color: [color, 0xffffff], speed: [0.5, 1.5], life: [300, 600], size: [0.015, 0.03], radius: 0.4 });
  if (!to) return ring(from, { color, to: 0.9, duration: 500 });
  const g = new PIXI.Graphics();
  g.blendMode = ADD();
  const s = gs();
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  return animate(g, Math.min(700, 200 + dist / s * 40), p => {
    const x = lerp(from.x, to.x, easeOut(p));
    const y = lerp(from.y, to.y, easeOut(p));
    g.clear();
    g.beginFill(color, 0.35);
    g.drawCircle(x, y, s * 0.16);
    g.endFill();
    g.beginFill(0xffffff, 0.9);
    g.drawCircle(x, y, s * 0.06);
    g.endFill();
  }).then(() => impact(to, { color, scale: 0.8 }));
}

/* ---------------------------------------------------------------- Алхимия */

/** Выпить: пузырьки поднимаются по токену. */
export function drink(at, color = 0x8fd27a) {
  if (!at) return;
  const s = gs();
  particles({ x: at.x, y: at.y + s * 0.3 }, {
    count: 26, color: [color, 0xffffff], speed: [0.4, 1.1], life: [600, 1100], size: [0.02, 0.045],
    angle: -Math.PI / 2, spread: 0.8, radius: 0.3, gravity: -0.8, drag: 0.98, stagger: 500
  });
  flash(at, { color, radius: 0.55, duration: 700, alpha: 0.3 });
}

/** Взрыв бомбы по зоне. */
export function explosion(at, radius = 1, color = 0xff8a3a) {
  if (!at) return;
  const r = Math.max(0.6, radius);
  flash(at, { color: 0xfff1c4, radius: r * 0.6, duration: 260, alpha: 0.9 });
  ring(at, { color, from: 0.1, to: r, width: 0.15, duration: 520 });
  particles(at, { count: 70, color: [color, 0xffd27a, 0xff5a1f], speed: [r * 2, r * 4.5], life: [250, 600], size: [0.04, 0.09], drag: 0.9, grow: true });
  particles(at, { count: 28, color: [0x2a2a2c, 0x3c3a36, 0x1a1a1c], speed: [0.3, r * 1.2], life: [800, 1500], size: [0.1, 0.2],
    radius: r * 0.5, gravity: -0.5, blend: false, grow: true, alpha: 0.45, stagger: 200, fadeIn: true });
}

/** Масло: блик по клинку. */
export function glint(at) {
  if (!at) return;
  const s = gs();
  const g = new PIXI.Graphics();
  g.blendMode = ADD();
  animate(g, 500, p => {
    g.clear();
    const x = at.x + lerp(-0.45, 0.45, easeOut(p)) * s;
    g.lineStyle(s * 0.06, 0xfff6d8, 0.8 * Math.sin(p * Math.PI));
    g.moveTo(x - s * 0.15, at.y + s * 0.35);
    g.lineTo(x + s * 0.15, at.y - s * 0.35);
  });
  particles(at, { count: 10, color: [0xfff6d8, 0xbfe39a], speed: [0.2, 0.8], life: [300, 600], size: [0.01, 0.022], radius: 0.4, stagger: 250 });
}
