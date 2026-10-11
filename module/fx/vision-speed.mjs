/**
 * Ускорение проверки видимости ядра (PLAN 4.195). Результаты те же — только меньше лишней работы.
 *
 * Жетон с обзором конусом на одном этаже смотрит на жетоны другого («Лурица - Холм и площадь»: стража на этаже «Стена»,
 * деревня — на «Пол»). Тогда ядро для каждой точки каждого жетона пускает луч сквозь стены, а при повороте жетона —
 * в каждом кадре анимации: 800–1200 лучей и 120–200 мс на шаг поворота к деревне.
 *
 * 1. Луч (`ClockwiseSweepPolygon#_testCollision`) пересекает только свой отрезок. `testCollision` и сам сужает выборку
 *    стен до прямоугольника отрезка, но через `config.boundingBox ??=`, а проверка видимости передаёт в луч копию
 *    настроек области обзора (`{...los.config}`) с готовым квадратом всего радиуса — и ядро перебирает и копирует все
 *    стены в нём (~200 на луч). Стена, не задевшая прямоугольник отрезка, луч не пересечёт — выборка сужается до него
 *    внутри прежнего квадрата.
 * 2. `LimitedAnglePolygon#_includeEdge` строит две граничные прямые конуса заново для каждой стены — строим один раз на
 *    многоугольник. Округление концов в ядре ничего не меняет (результат `roundPoint` не сохраняется) — его нет и здесь.
 */

let enabled = true;

/** Для проверки: включить или выключить ускорение (сравнение видимости с ним и без него). */
export function setVisionSpeedups(on) { enabled = !!on; }

export function registerVisionSpeedups() {
  const CSP = foundry.canvas.geometry?.ClockwiseSweepPolygon;
  const LAP = foundry.canvas.geometry?.LimitedAnglePolygon;
  const Ray = foundry.canvas.geometry?.Ray;
  if (!CSP?.prototype._testCollision || !LAP?.prototype._includeEdge || !Ray) {
    return console.warn("vedmak | ускорение видимости не включено: в этой версии Foundry другое устройство");
  }

  // 1. Стены для луча — только у его отрезка
  const testCollision = CSP.prototype._testCollision;
  CSP.prototype._testCollision = function (ray, mode, destination, tMin, tMax) {
    const box = this.config?.boundingBox;
    const o = this.origin;
    if (!enabled || !box || !o || !ray?.B) return testCollision.call(this, ray, mode, destination, tMin, tMax);
    const dx = ray.B.x - o.x, dy = ray.B.y - o.y;
    const t0 = Math.max(0, tMin), t1 = Math.min(1, tMax);
    const x0 = o.x + dx * t0, x1 = o.x + dx * t1, y0 = o.y + dy * t0, y1 = o.y + dy * t1;
    const left = Math.max(box.x, Math.min(x0, x1) - 1), top = Math.max(box.y, Math.min(y0, y1) - 1);
    const right = Math.min(box.right, Math.max(x0, x1) + 1), bottom = Math.min(box.bottom, Math.max(y0, y1) + 1);
    if (!(right >= left && bottom >= top)) return testCollision.call(this, ray, mode, destination, tMin, tMax);
    this.config.boundingBox = new PIXI.Rectangle(left, top, right - left, bottom - top);
    try { return testCollision.call(this, ray, mode, destination, tMin, tMax); }
    finally { this.config.boundingBox = box; }
  };

  // 2. Границы конуса — один раз на многоугольник
  const includeEdge = LAP.prototype._includeEdge;
  LAP.prototype._includeEdge = function (a, b) {
    if (!enabled) return includeEdge.call(this, a, b);
    if (this.externalBounds?.lineSegmentIntersects(a, b, { inside: true })) return true;
    const o = this.origin;
    let r = this._vdRays;
    if (!r || r.x !== o.x || r.y !== o.y || r.aMin !== this.aMin || r.aMax !== this.aMax || r.radius !== this.radius) {
      r = this._vdRays = { x: o.x, y: o.y, aMin: this.aMin, aMax: this.aMax, radius: this.radius,
        min: Ray.fromAngle(o.x, o.y, this.aMin, this.radius), max: Ray.fromAngle(o.x, o.y, this.aMax, this.radius) };
    }
    const { min, max } = r;
    if (LAP.pointBetweenRays(a, min, max, this.angle) || LAP.pointBetweenRays(b, min, max, this.angle)) return true;
    const cross = foundry.utils.lineSegmentIntersects;
    return cross(min.A, min.B, a, b) || cross(max.A, max.B, a, b);
  };
}
