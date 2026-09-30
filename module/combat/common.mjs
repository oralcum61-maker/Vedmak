// Общие помощники боевых карточек: поиск документов, цели, сокет ведущего.

import { renderTemplate } from "../util.mjs";

const SOCKET = "system.vedmak";
const HANDLERS = {};

/** Актор по UUID токена или актора. */
export function resolveActor(uuid) {
  if (!uuid) return null;
  const doc = fromUuidSync(uuid);
  if (!doc) return null;
  return doc.actor ?? (doc.documentName === "Actor" ? doc : null);
}

/** Сведения о цели для флагов сообщения. */
export function targetInfo(token) {
  const doc = token.document ?? token;
  return {
    tokenUuid: doc.uuid,
    actorUuid: doc.actor?.uuid ?? null,
    name: doc.name,
    img: doc.texture?.src ?? doc.actor?.img
  };
}

export function currentTargets() {
  return [...game.user.targets].map(targetInfo);
}

/** Токен актора на текущей сцене (для расстояния и речи). */
export function actorToken(actor) {
  if (actor?.token) return actor.token.object ?? null;
  return actor?.getActiveTokens?.()[0] ?? null;
}

/** Расстояние между токенами в единицах сцены или null. */
export function tokenDistance(a, b) {
  try {
    if (!a || !b || !canvas?.ready) return null;
    return canvas.grid.measurePath([a.center, b.center]).distance;
  } catch {
    return null;
  }
}

/** Защитник для кнопки без цели: выделенный токен или персонаж пользователя. */
export function fallbackDefender() {
  const token = canvas?.tokens?.controlled?.[0];
  if (token) return targetInfo(token);
  const actor = game.user.character;
  return actor ? { tokenUuid: null, actorUuid: actor.uuid, name: actor.name, img: actor.img } : null;
}

/** Участник активного боя для актора. */
export function combatantFor(actor) {
  const combat = game.combat;
  if (!combat?.started || !actor) return null;
  return combat.combatants.find(c => c.actor === actor || c.actorId === actor.id) ?? null;
}

/** Выполнить действие от имени ведущего (сразу, если пользователь — ГМ). */
export async function asGM(action, data) {
  const handler = HANDLERS[action];
  if (!handler) throw new Error(`vedmak | неизвестное действие ГМ: ${action}`);
  if (game.user.isGM) return handler(data, game.user.id);
  if (!game.users.activeGM) {
    ui.notifications.warn("Для этого действия нужен ведущий в игре.");
    return null;
  }
  game.socket.emit(SOCKET, { action, data, userId: game.user.id });
  return null;
}

export function registerGMHandler(action, fn) {
  HANDLERS[action] = fn;
}

/**
 * Может ли пользователь действовать за кого-то из акторов: ведущий — за всех, игрок — за своих.
 * Для проверок на стороне ведущего: кто прислал запрос по сокету и кто создал карточку в чате.
 */
export function userOwnsAny(userId, ...actors) {
  const user = game.users.get(userId);
  if (!user) return false;
  return user.isGM || actors.some(a => a?.testUserPermission(user, "OWNER"));
}

export function initSocket() {
  game.socket.on(SOCKET, async ({ action, data, userId }) => {
    if (!game.users.activeGM?.isSelf) return;
    try {
      await HANDLERS[action]?.(data, userId);
    } catch (err) {
      console.error(`vedmak | ошибка действия ${action}`, err);
    }
  });
}

/** Создать карточку боя из шаблона. */
export async function postCard({ template, data, actor, flags, rolls, messageMode, speaker }) {
  const content = await renderTemplate(template, data);
  return ChatMessage.create({
    speaker: speaker ?? ChatMessage.getSpeaker({ actor }),
    content,
    rolls,
    flags: { vedmak: flags }
  }, { messageMode });
}

/** Режимы видимости сообщения для окон. */
export function messageModes() {
  return Object.entries(CONFIG.ChatMessage.modes)
    .filter(([k]) => k !== "ic")
    .map(([value, cfg]) => ({ value, label: game.i18n.localize(cfg.label) }));
}

/** Бросок формулы; пустая или ошибочная формула → 0. */
export async function rollFormula(formula, data = {}) {
  const f = String(formula ?? "").trim();
  if (!f) return { roll: null, total: 0 };
  try {
    const roll = await new Roll(f, data).evaluate();
    return { roll, total: roll.total };
  } catch (err) {
    ui.notifications.warn(`Не удалось бросить «${f}»: ${err.message}`);
    return { roll: null, total: 0 };
  }
}
