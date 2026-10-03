// Вид зон заклинаний, бомб и ловушек (PLAN 4.71). Вместо подсветки Foundry — заштрихованных клеток, рамки и
// пунктирной линейки — свой рисунок: у круга — рунный круг с вращающимся кольцом рисок, у конуса — клин с рисками
// по дуге. Цвет — из цвета зоны (стихия, бомба, ловушка). Трогаются только зоны системы (флаг vedmak.look или
// vedmak.zone): остальные области ведущего Foundry рисует как всегда.

const TAU = Math.PI * 2;

/** Зона системы — при постановке (предпросмотр) и уже на сцене. */
function isOurs(region) {
  const f = region?.document?.flags?.vedmak;
  return !!(f?.look || f?.zone);
}

const colorOf = region => {
  const c = region.document.color;
  return c ? Number(c) : 0xc9bdf0;
};

/** Спрятать подложку Foundry: меш подсветки в слое областей и рамку. renderable, а не visible — его Foundry не трогает. */
function hideDefault(region) {
  const mesh = region.layer?._highlights?.children?.find(m => m.region === region);
  if (mesh) mesh.renderable = false;
  // Линейка (кружок центра, пунктир радиуса, «3 м») — при постановке Foundry рисует её всегда; у нас подпись своя
  if (region._measurementLines) region._measurementLines.renderable = false;
  if (region._measurementLabels) region._measurementLabels.renderable = false;
  for (const child of region.children) {
    if (child === region._vdLook || child === region._measurementLines || child === region._measurementLabels) continue;
    // Рамка и ручки фигуры; пятно для наведения (hitbox) оставляем — по нему зону выбирают и двигают
    if (child instanceof PIXI.Graphics && child.eventMode !== "static") child.renderable = false;
    else if (child instanceof PIXI.Container && !(child instanceof PIXI.Graphics)) child.renderable = false;
  }
}

/** Подпись размера — мелко, в цвет зоны, литым шрифтом системы. */
function label(text, color) {
  const t = new PIXI.Text(text, {
    fontFamily: "Vedmak Display, Forum, serif", fontSize: Math.round(22 * (canvas.dimensions.uiScale ?? 1)),
    fill: 0xf1ece0, stroke: 0x050607, strokeThickness: 4, dropShadow: true, dropShadowColor: color, dropShadowBlur: 6, dropShadowDistance: 0
  });
  t.anchor.set(0.5);
  t.alpha = 0.85;
  return t;
}

function drawCircle(look, shape, color, units) {
  const { x, y, radius: r } = shape;
  const ui = canvas.dimensions.uiScale ?? 1;
  const g = look.addChild(new PIXI.Graphics());
  // Мягкая заливка — к краю гуще, как свечение изнутри
  for (const [k, a] of [[1, 0.07], [0.82, 0.05], [0.6, 0.04]]) {
    g.beginFill(color, a);
    g.drawCircle(x, y, r * k);
    g.endFill();
  }
  g.lineStyle(3 * ui, color, 0.95);
  g.drawCircle(x, y, r);
  g.lineStyle(1.5 * ui, color, 0.55);
  g.drawCircle(x, y, r * 0.9);
  // Руны: восемь ромбов между кольцами
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8;
    const cx = x + Math.cos(a) * r * 0.95, cy = y + Math.sin(a) * r * 0.95, s = 5 * ui;
    g.lineStyle(0);
    g.beginFill(color, 0.9);
    g.drawPolygon([cx, cy - s, cx + s * 0.6, cy, cx, cy + s, cx - s * 0.6, cy]);
    g.endFill();
  }
  // Метка центра — четырёхлучевая звезда
  const s = 9 * ui;
  g.beginFill(color, 0.85);
  g.drawPolygon([x, y - s, x + s * 0.25, y - s * 0.25, x + s, y, x + s * 0.25, y + s * 0.25, x, y + s, x - s * 0.25, y + s * 0.25, x - s, y, x - s * 0.25, y - s * 0.25]);
  g.endFill();
  // Кольцо рисок медленно вращается
  const ring = look.addChild(new PIXI.Graphics());
  ring.position.set(x, y);
  for (let i = 0; i < 48; i++) {
    const a = i * TAU / 48, long = i % 4 === 0;
    ring.lineStyle((long ? 2 : 1.2) * ui, color, long ? 0.8 : 0.45);
    ring.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
    ring.lineTo(Math.cos(a) * r * (long ? 0.8 : 0.85), Math.sin(a) * r * (long ? 0.8 : 0.85));
  }
  look._spin = ring;
  const t = look.addChild(label(`⌀ ${formatUnits(shape.radius * 2, units)}`, color));
  t.position.set(x, y + r + 16 * ui);
}

function drawCone(look, shape, color, units) {
  const { x, y, radius: r } = shape;
  const ui = canvas.dimensions.uiScale ?? 1;
  const rot = (shape.rotation ?? 0) * Math.PI / 180;
  const half = ((shape.angle ?? 53.13) * Math.PI / 180) / 2;
  const a0 = rot - half, a1 = rot + half;
  const g = look.addChild(new PIXI.Graphics());
  const wedge = (k, alpha) => {
    g.lineStyle(0);
    g.beginFill(color, alpha);
    g.moveTo(x, y);
    g.arc(x, y, r * k, a0, a1);
    g.lineTo(x, y);
    g.endFill();
  };
  wedge(1, 0.06);
  wedge(0.66, 0.05);
  wedge(0.33, 0.05);
  // Рёбра и дуга
  g.lineStyle(3 * ui, color, 0.95);
  g.moveTo(x, y);
  g.lineTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
  g.arc(x, y, r, a0, a1);
  g.lineTo(x, y);
  // Промежуточные дуги — прерывистые, риски по краю
  for (const k of [0.33, 0.66]) {
    g.lineStyle(1.2 * ui, color, 0.45);
    const steps = 10;
    for (let i = 0; i < steps; i += 2) {
      const s0 = a0 + (a1 - a0) * (i / steps), s1 = a0 + (a1 - a0) * ((i + 1) / steps);
      g.moveTo(x + Math.cos(s0) * r * k, y + Math.sin(s0) * r * k);
      g.arc(x, y, r * k, s0, s1);
    }
  }
  for (let i = 0; i <= 12; i++) {
    const a = a0 + (a1 - a0) * (i / 12), long = i % 3 === 0;
    g.lineStyle((long ? 2 : 1.2) * ui, color, long ? 0.8 : 0.5);
    g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    g.lineTo(x + Math.cos(a) * r * (long ? 0.92 : 0.95), y + Math.sin(a) * r * (long ? 0.92 : 0.95));
  }
  // Вершина — ромб
  const s = 7 * ui;
  g.lineStyle(0);
  g.beginFill(color, 0.9);
  g.drawPolygon([x, y - s, x + s * 0.6, y, x, y + s, x - s * 0.6, y]);
  g.endFill();
  const t = look.addChild(label(formatUnits(r, units), color));
  t.position.set(x + Math.cos(rot) * (r + 22 * ui), y + Math.sin(rot) * (r + 22 * ui));
}

/** Пиксели → метры сцены, без лишних нулей. */
function formatUnits(px, units) {
  const v = (px / canvas.dimensions.size) * canvas.dimensions.distance;
  return `${Math.round(v * 10) / 10} ${units}`;
}

function decorate(region) {
  if (!isOurs(region) || region.destroyed) return;
  hideDefault(region);
  region._vdLook?.destroy({ children: true });
  const shape = region.document.shapes?.[0];
  if (!shape || !["circle", "cone"].includes(shape.type) || !shape.radius) return;
  const look = region._vdLook = new PIXI.Container();
  look.eventMode = "none";
  const color = colorOf(region);
  const units = canvas.scene?.grid?.units || "м";
  if (shape.type === "circle") drawCircle(look, shape, color, units);
  else drawCone(look, shape, color, units);
  // Фигуры области — в координатах сцены; сама область может быть сдвинута (перетаскивание предпросмотра)
  look.position.set(-region.position.x, -region.position.y);
  region.addChild(look);
}

/** Вращение колец у всех зон на сцене — один обработчик кадра на всех (тикер приложения живёт между сценами). */
function spin() {
  const ticker = canvas?.app?.ticker;
  if (!ticker || ticker._vdZoneSpin) return;
  ticker._vdZoneSpin = true;
  ticker.add(() => {
    if (document.body.classList.contains("vd-no-anim")) return;
    for (const r of canvas.regions?.placeables ?? []) if (r._vdLook?._spin) r._vdLook._spin.rotation += 0.003;
    const preview = canvas.regions?.preview?.children ?? [];
    for (const r of preview) if (r._vdLook?._spin) r._vdLook._spin.rotation += 0.003;
  });
}

export function registerZoneLook() {
  Hooks.on("refreshRegion", region => {
    try { decorate(region); } catch (err) { console.warn("vedmak | вид зоны", err); }
  });
  Hooks.on("canvasReady", spin);
}
