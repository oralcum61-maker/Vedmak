// Укрытие по стенам сцены (стр. 155): если между стрелком и целью стоит стена, окно урона дальней атаки само
// выбирает укрытие цели. Материал стены ведущий задаёт в её настройке («Укрытие», флаг vedmak.cover); без него
// стена, закрывающая обзор, считается каменной, остальное (ограда, окно) — деревянной, дверь — тяжёлой дверью.
// Выбор в окне урона можно поменять.

import { COVER } from "../config/combat.mjs";

/** Токен на холсте по uuid токена (карточки хранят tokenUuid). */
function tokenObject(uuid) {
  try { return uuid ? fromUuidSync(uuid)?.object ?? null : null; } catch { return null; }
}

/**
 * Укрытие цели от стены между двумя токенами: ближайшая к цели стена, преграждающая движение
 * (открытые двери — не укрытие). null — линия чистая или стена помечена «не укрытие».
 * @returns {{key: string, label: string, sp: number, flagged: boolean}|null}
 */
export function wallCover(fromUuid, toUuid) {
  if (!canvas?.ready) return null;
  const from = tokenObject(fromUuid);
  const to = tokenObject(toUuid);
  if (!from || !to || from.document.parent !== canvas.scene || to.document.parent !== canvas.scene) return null;
  const a = from.center;
  const b = to.center;
  let best = null;
  let bestDist = Infinity;
  for (const wall of canvas.walls?.placeables ?? []) {
    const d = wall.document;
    if (!(d.move > 0)) continue;
    if (d.door > 0 && d.ds === CONST.WALL_DOOR_STATES.OPEN) continue;
    const hit = foundry.utils.lineSegmentIntersection(a, b, { x: d.c[0], y: d.c[1] }, { x: d.c[2], y: d.c[3] });
    if (!hit) continue;
    const dist = Math.hypot(hit.x - b.x, hit.y - b.y);
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  if (!best) return null;
  const flag = best.getFlag("vedmak", "cover");
  if (flag === "none") return null;
  const key = COVER[flag] ? flag : best.door > 0 ? "heavyDoor" : best.sight > 0 ? "stoneWall" : "woodWall";
  return { key, label: COVER[key].label, sp: COVER[key].sp, flagged: !!COVER[flag] };
}

/** Поле «Укрытие» в настройке стены: материал для укрытия от дальних атак. */
export function registerWallCover() {
  Hooks.on("renderWallConfig", (app, element) => {
    const root = element instanceof HTMLElement ? element : element?.[0];
    const anchor = root?.querySelector("[name='move']")?.closest(".form-group");
    if (!anchor || root.querySelector("[name='flags.vedmak.cover']")) return;
    const current = app.document?.getFlag("vedmak", "cover") ?? "";
    const options = [`<option value="" ${current ? "" : "selected"}>По виду стены</option>`,
      `<option value="none" ${current === "none" ? "selected" : ""}>Не укрытие</option>`]
      .concat(Object.entries(COVER).filter(([k]) => k !== "none")
        .map(([k, c]) => `<option value="${k}" ${current === k ? "selected" : ""}>${c.label} (ПБ ${c.sp})</option>`));
    const group = document.createElement("div");
    group.className = "form-group";
    group.innerHTML = `<label>Укрытие</label><div class="form-fields"><select name="flags.vedmak.cover">${options.join("")}</select></div>
      <p class="hint">ПБ укрытия от выстрелов сквозь стену. «По виду стены»: закрывает обзор — каменная, иначе деревянная; дверь — тяжёлая.</p>`;
    anchor.after(group);
  });
}
