// Общие помощники боевых карточек: поиск документов, цели, сокет ведущего, отметки «уже брошено».

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
  // Сначала точное совпадение: у несвязанных токенов одного прототипа actorId общий, и поиск по нему отдал бы
  // всем бандитам первого — с одним счётчиком защит и Энергии на всех
  const exact = combat.combatants.find(c => c.actor === actor);
  if (exact || actor.isToken) return exact ?? null;
  return combat.combatants.find(c => c.actorId === actor.id) ?? null;
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
  game.socket.emit(SOCKET, { action, data });
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
  // Отправителя подставляет сервер Foundry вторым аргументом. Своё поле userId в теле запроса клиент может
  // подделать из консоли — и выдать себя за ведущего, обойдя проверки владения у обработчиков
  game.socket.on(SOCKET, async ({ action, data }, userId) => {
    if (!game.users.activeGM?.isSelf) return;
    try {
      await HANDLERS[action]?.(data, userId);
    } catch (err) {
      console.error(`vedmak | ошибка действия ${action}`, err);
    }
  });
}

/**
 * Видимость карточки без окна (Shift): режим чата пользователя. v14 применяет режим, только если его передали
 * явно, — без этого карточка уходила всем, даже если в чате выбрано «Ведущему».
 */
export function defaultMessageMode() {
  return safeMessageMode(game.settings.get("core", "messageMode"));
}

/**
 * Режим карточки системы: «ic» (в роли) превращает карточку в речевой пузырь персонажа — для боевых карточек он не
 * годится, поэтому он идёт как «всем». Пустой режим тоже «всем».
 */
export function safeMessageMode(mode) {
  return !mode || mode === "ic" ? "public" : mode;
}

/**
 * Режим карточки, которую клиент ведущего создаёт за другого (защита НИП, урон за игрока, начало хода игрока).
 * Режим чата самого ведущего тут нельзя брать: поставив «Ведущему», он спрятал бы карточку от игроков, которым она
 * нужна. Для карточки по чужой атаке — режим, выбранный в атаке (если атакует НИП ведущего), иначе всем.
 * @param {Actor|null} owner — чья это карточка по смыслу (атакующий или тот, чей ход)
 * @param {string} [stored] — режим исходной карточки
 */
export function proxyMessageMode(owner, stored) {
  if (owner?.hasPlayerOwner) return "public";
  return safeMessageMode(stored);
}

/**
 * Штраф ран руки к действиям этой рукой (−2 вывих, −3 перелом; стр. 158–160). В какой руке оружие,
 * система не знает — берём худшую руку и показываем отдельной строкой, чтобы Мастер видел и мог поправить.
 */
export function armWoundParts(actor) {
  const d = actor?.system?.derived;
  return d?.armMod ? [{ label: `Ранение руки${d.armLabel ? ` (${d.armLabel})` : ""}`, value: d.armMod }] : [];
}

/* -------------------------------------------------------------------------- */
/*  Один бросок на карточку: защита на цель, урон на защиту                   */
/* -------------------------------------------------------------------------- */

/** Ключ цели во флагах: точки UUID превратили бы его во вложенный путь. */
export function doneKey(uuid) {
  return String(uuid ?? "").replaceAll(".", "_");
}

/**
 * Отметить на карточке-источнике, что по ней уже бросили: атака → защита цели, защита → урон.
 * Отметка нужна, чтобы при перерисовке погасить кнопки. Карточку-источник часто создал другой игрок,
 * поэтому чужую карточку отмечает ведущий; без ведущего отметки нет, но повтор всё равно ловит поиск по чату.
 */
export async function markDone(source, result) {
  if (!source || !result) return;
  if (source.isOwner) return applyDoneMark(source, result);
  if (game.users.activeGM) return asGM("markDone", { messageId: source.id, resultId: result.id });
}

async function applyDoneMark(source, result) {
  const def = result.flags.vedmak?.defense;
  const dmg = result.flags.vedmak?.damage;
  const duel = result.flags.vedmak?.verbal;
  if (def?.attackMessageId === source.id) {
    await source.update({ [`flags.vedmak.defended.${doneKey(def.defender.tokenUuid ?? def.defender.actorUuid)}`]: result.id });
  } else if (dmg?.defenseMessageId === source.id) {
    await source.update({ "flags.vedmak.damaged": result.id });
  } else if (duel?.kind === "outcome" && duel.attackMessageId === source.id) {
    // Словесная дуэль: исход — это «защита» цели от карточки атаки
    await source.update({ [`flags.vedmak.defended.${doneKey(duel.defender.tokenUuid ?? duel.defender.actorUuid)}`]: result.id });
  }
}

/** Карточка-источник результата (атака для защиты, защита для урона, атака дуэли для исхода) или null. */
export function sourceOfResult(result) {
  const f = result?.flags?.vedmak;
  const id = f?.defense?.attackMessageId ?? f?.damage?.defenseMessageId
    ?? (f?.verbal?.kind === "outcome" ? f.verbal.attackMessageId : null);
  return id ? game.messages.get(id) ?? null : null;
}

registerGMHandler("markDone", async ({ messageId, resultId }, userId) => {
  const source = game.messages.get(messageId);
  const result = game.messages.get(resultId);
  if (!source || !result) return;
  // Отмечать можно только своей карточкой-итогом и только её источник (что именно — читаем из самой карточки)
  if (result.author?.id !== userId && !game.users.get(userId)?.isGM) return;
  await applyDoneMark(source, result);
});

/**
 * Повтор броска, который уже сделан: игроку — отказ, ведущему — подтверждение
 * (у Мастера всегда есть ручная правка: перебросить после ошибки или спорного случая).
 * @param {string} what — «Защита Геральта уже брошена.»
 */
export async function allowRepeat(what) {
  if (!game.user.isGM) {
    ui.notifications.warn(`${what} Перебросить может ведущий.`);
    return false;
  }
  return !!(await foundry.applications.api.DialogV2.confirm({
    window: { title: "Повторный бросок" },
    content: `<p>${what}</p><p>Бросить ещё раз? Прежняя карточка останется в чате — лишнюю удалите сами.</p>`,
    rejectClose: false
  }));
}

/** Создать карточку боя из шаблона. */
export async function postCard({ template, data, actor, flags, rolls, messageMode, speaker }) {
  const content = await renderTemplate(template, data);
  // Пустой режим v14 не применяет вовсе (карточка уходит всем), «ic» — только защита от пузыря речи
  if (messageMode === "ic") messageMode = "public";
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
