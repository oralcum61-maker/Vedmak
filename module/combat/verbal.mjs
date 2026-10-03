// Словесная дуэль (корник стр. 176–177): Решительность вместо ПЗ, эмпатические и антагонистические
// атаки, защиты и рычаги давления. Проведение как у боя: атака с выбранными целями даёт карточку
// с кнопками защиты у каждой цели; атака больше защиты — урон Решительности цели, иначе успешная
// защита бьёт атакующего. Исход применяется через ведущего (сам — настройкой «применять сразу»).

import { SKILLS } from "../config/skills.mjs";
import { STATS } from "../config/stats.mjs";
import { performCheck } from "../dice/check.mjs";
import { rollDialog } from "../dice/roll-dialog.mjs";
import { statusRollMods } from "./statuses.mjs";
import { renderTemplate } from "../util.mjs";
import {
  asGM, registerGMHandler, resolveActor, postCard, rollFormula, fallbackDefender, currentTargets, actorToken, userOwnsAny,
  defaultMessageMode, markDone, allowRepeat, doneKey
} from "./common.mjs";
import { registerChatAction } from "./chat.mjs";

const { DialogV2 } = foundry.applications.api;

/**
 * Действия дуэли. `damage` — формула урона Решительности (@emp, @int, @will — параметры действующего),
 * `empathic` — эмпатическое действие (на него действуют свои штрафы от ран).
 */
export const VERBAL_GROUPS = [
  {
    key: "empathic", label: "Эмпатические атаки",
    about: "Располагают цель к вам. Слабее, но не портят отношений.",
    actions: [
      { key: "seduce", label: "Соблазнить", skill: "seduction", damage: "1d6 + @emp", empathic: true,
        effect: "Защищающийся смущён: +2 накапливающегося урона от каждого Соблазнения в дуэли." },
      { key: "persuade", label: "Убедить", skill: "persuasion", damage: "floor(1d6 / 2) + @emp", empathic: true,
        effect: "Завершите дуэль успешным Убеждением — противник признал вашу правоту." },
      { key: "reason", label: "Привести довод", skill: "leadership", damage: "1d10 + @emp", empathic: true,
        effect: "+1 накапливающегося урона от эмпатических атак за каждый успешный довод." },
      { key: "befriend", label: "Сдружиться", skill: "charisma", damage: "1d6 + @emp", empathic: true,
        effect: "Завершите дуэль успешным «сдружиться» — противник станет знакомым, потом другом." }
    ]
  },
  {
    key: "antagonistic", label: "Антагонистические атаки",
    about: "Сильнее и выигрывают чаще, но настраивают противника против вас.",
    actions: [
      { key: "deceive", label: "Обмануть", skill: "deceit", damage: "1d6 + @int",
        effect: "Завершите дуэль успешным Обманом — противник поверил в вашу ложь." },
      { key: "ridicule", label: "Насмехаться", skill: "etiquette", damage: "1d6 + @will",
        effect: "Публичная насмешка: −2 к репутации противника у окружающих за каждую, на 1 день." },
      { key: "intimidate", label: "Запугать", skill: "intimidation", damage: "1d10 + @will",
        effect: "Цель боится вас: +4 накапливающегося урона за каждое Запугивание в дуэли." }
    ]
  },
  {
    key: "defense", label: "Защита",
    about: "Успешная защита наносит урон Решительности атакующего.",
    actions: [
      { key: "ignore", label: "Игнорировать", skill: "resistCoercion", damage: "1d10 + @emp", effect: "" },
      { key: "changeSubject", label: "Смена темы", skill: "persuasion", damage: "1d6 + @int", effect: "" },
      { key: "disengage", label: "Прекращение", skill: "resistCoercion", damage: "",
        effect: "Успех — спор окончен, никто не выиграл." }
    ],
    note: "Контраргумент: вместо защиты бросьте любую атаку. Если ваш результат выше — атака противника отменяется, а ваша наносит урон."
  },
  {
    key: "leverage", label: "Рычаги давления",
    about: "Полный ход вместо атаки: урона нет, зато бонус в дальнейшей дуэли.",
    actions: [
      { key: "love", label: "Любовь", skill: "charisma", damage: "", empathic: true,
        effect: "Противник влюблён: −3 против вас в дуэли, пока вы с ним хорошо обращаетесь." },
      { key: "examine", label: "Изучение", skill: "perception", damage: "", empathic: true,
        effect: "Против Инт × 3 противника: успех даёт +2 в дуэли на 1 раунд." },
      { key: "hint", label: "Намёк", skill: "persuasion", damage: "",
        effect: "Успех — противник получает −4 к защите. Один раз за дуэль (можно и Обманом)." },
      { key: "bribe", label: "Подкуп", skill: "gambling", damage: "",
        effect: "За каждые 50 крон — +1 к эмпатическим проверкам до конца дуэли." }
    ]
  }
];

const ACTIONS = Object.fromEntries(VERBAL_GROUPS.flatMap(g => g.actions.map(a => [a.key, { ...a, group: g.key, groupLabel: g.label }])));

/** Текущая Решительность: хранится во флаге, пока дуэль не начата — равна максимуму. */
export function currentResolve(actor) {
  const max = actor.system.derived?.resolve ?? 0;
  const value = actor.getFlag("vedmak", "duelResolve");
  return { value: Number.isFinite(value) ? value : max, max };
}

/**
 * Правка Решительности с листа. Полная (не меньше максимума) — снова без флага: тогда она следует
 * за Волей и Инт. Возвращает null, если сохранять нечего (не число или и так полная), — лист перерисуется.
 */
export async function setDuelResolve(actor, value) {
  // Пустое поле — не «0» (Number("") даёт 0), а «без правки»: полная Решительность, без флага
  if (value === null || value === undefined || String(value).trim() === "") {
    return actor.getFlag("vedmak", "duelResolve") === undefined ? null : actor.unsetFlag("vedmak", "duelResolve");
  }
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return null;
  const max = actor.system.derived?.resolve ?? 0;
  if (n >= max) return actor.getFlag("vedmak", "duelResolve") === undefined ? null : actor.unsetFlag("vedmak", "duelResolve");
  return actor.setFlag("vedmak", "duelResolve", Math.max(0, n));
}

/** Правки к проверкам дуэли: навык, раны, опьянение (−3 в словесной дуэли, стр. 36). */
function duelParts(actor, def) {
  const skillDef = SKILLS[def.skill];
  const skill = actor.system.skills[def.skill];
  const stat = actor.system.stats[skillDef.stat];
  const parts = [
    { label: STATS[skillDef.stat].label, value: stat.effective, always: true },
    { label: skillDef.label, value: skill.total, always: true }
  ];
  const sum = stat.effective + skill.total + skill.penalty;
  if (skill.penalty) parts.push({ label: "Ранения и СД", value: skill.penalty });
  if (skill.base !== Math.max(0, sum)) parts.push({ label: "Ранения (множитель)", value: skill.base - sum });
  parts.push(...statusRollMods(actor, "skill", { skill: def.skill }));
  const d = actor.system.derived ?? {};
  if (d.duelMod) parts.push({ label: "Раны: словесная дуэль", value: d.duelMod });
  if (def.empathic && d.empathicDuelMod) parts.push({ label: "Раны: эмпатическая дуэль", value: d.empathicDuelMod });
  if (actor.statuses?.has("intoxicated")) parts.push({ label: "Опьянение", value: -3 });
  return parts;
}

/** Формула урона с подставленными параметрами действующего — для листа и карточки. */
function damageText(actor, def) {
  if (!def.damage) return "";
  const s = actor.system.stats;
  return def.damage
    .replace("@emp", s.emp.effective).replace("@int", s.int.effective).replace("@will", s.will.effective)
    .replace("floor(1d6 / 2)", "½d6");
}

/** Строки действий для вкладки «Социальный бой». */
export function verbalContext(actor) {
  const d = actor.system.derived ?? {};
  const mods = [];
  if (d.duelMod) mods.push(`раны ${d.duelMod}`);
  if (d.empathicDuelMod) mods.push(`эмпатия ${d.empathicDuelMod}`);
  if (actor.statuses?.has("intoxicated")) mods.push("опьянение −3");
  const resolve = currentResolve(actor);
  return {
    resolve: { ...resolve, pct: resolve.max ? Math.round(Math.max(0, Math.min(1, resolve.value / resolve.max)) * 100) : 0,
      broken: resolve.value <= 0 },
    mods: mods.join(" · "),
    groups: VERBAL_GROUPS.map(g => ({
      key: g.key, label: g.label, about: g.about, note: g.note ?? "",
      actions: g.actions.map(a => ({
        ...a,
        skillLabel: SKILLS[a.skill]?.label ?? a.skill,
        base: duelParts(actor, a).reduce((sum, p) => sum + (Number(p.value) || 0), 0),
        damageLabel: damageText(actor, a)
      }))
    }))
  };
}

/* -------------------------------------------------------------------------- */
/*  Атака                                                                     */
/* -------------------------------------------------------------------------- */

const isAttack = def => def.group === "empathic" || def.group === "antagonistic";

/** Кнопки защиты у цели в карточке атаки. */
export const DUEL_DEFENSES = [
  { key: "ignore", short: "Игнор", label: "Игнорировать — Сопротивление убеждению; успех бьёт атакующего" },
  { key: "changeSubject", short: "Тема", label: "Смена темы — Убеждение; успех бьёт атакующего" },
  { key: "counter", short: "Ответ", label: "Контраргумент — ответная атака: выше — атака отменена, ваша наносит урон" },
  { key: "disengage", short: "Уйти", label: "Прекращение — успех: спор окончен, никто не выиграл" },
  { key: "none", short: "Принять", label: "Без защиты — атака проходит" }
];

/** Ключ пары «кто бьёт» для флагов накопления (в пути флага не должно быть точек). */
const pairKey = actor => actor.uuid.replaceAll(".", "_");

/** Что копит успешное действие: +2 за Соблазнение, +4 за Запугивание, +1 к эмпатическим за довод. */
const STACKS = { seduce: 2, intimidate: 4, reason: 1 };

/** Накопленный бонус урона от прошлых успехов этого действующего против этой цели. */
function stackBonus(dealer, action, victim) {
  const st = victim?.getFlag("vedmak", `duelStacks.${pairKey(dealer)}`) ?? {};
  const why = [];
  let bonus = 0;
  if (action.key === "seduce" && st.seduce) { bonus += STACKS.seduce * st.seduce; why.push(`смущение +${STACKS.seduce * st.seduce}`); }
  if (action.key === "intimidate" && st.intimidate) { bonus += STACKS.intimidate * st.intimidate; why.push(`страх +${STACKS.intimidate * st.intimidate}`); }
  if (action.empathic && st.reason) { bonus += st.reason; why.push(`доводы +${st.reason}`); }
  return { bonus, why };
}

/** Урон Решительности: формула действия с параметрами действующего, накопление и правка из окна. */
async function rollDuelDamage(dealer, action, victim, extraMod = 0) {
  if (!action?.damage) return null;
  const { bonus, why } = stackBonus(dealer, action, victim);
  const mod = (Number(extraMod) || 0) + bonus;
  const s = dealer.system.stats;
  const formula = mod ? `${action.damage} ${mod > 0 ? "+" : "-"} ${Math.abs(mod)}` : action.damage;
  const res = await rollFormula(formula, { emp: s.emp.effective, int: s.int.effective, will: s.will.effective });
  return {
    total: Math.max(0, res.total), roll: res.roll, why,
    formula: damageText(dealer, action) + (mod ? ` ${mod > 0 ? "+" : "−"} ${Math.abs(mod)}` : "")
  };
}

/**
 * Состояние противника меняет дуэль: ранен — −3 к эмпатическим атакам и +3 к Запугиванию,
 * ниже порога ранения — −10 и +10 (стр. 177). Галочкой в окне, включена сама.
 */
function targetStateParts(def, target) {
  const sys = target?.system;
  if (!sys?.hp || sys.hp.value >= sys.hp.max) return [];
  const badly = sys.hp.value < (sys.derived?.woundThreshold ?? 0);
  const n = badly ? 10 : 3;
  const label = `${target.name} ${badly ? "ниже порога ранения" : "ранен"}`;
  if (def.empathic) return [{ label, value: -n, checked: true }];
  if (def.key === "intimidate") return [{ label, value: n, checked: true }];
  return [];
}

/** Проверка действия: окно броска (кроме Shift) и бросок без карточки. */
async function duelRoll(actor, def, { skipDialog = false, title = def.label, optional = [] } = {}) {
  const parts = duelParts(actor, def);
  const all = [...(actor.socialParts?.(def.skill) ?? []), ...optional];
  // Без окна (Shift) режим не выбирался — берём режим чата, иначе v14 отдаст карточку всем
  let choice = { mod: 0, damageMod: 0, luck: 0, messageMode: defaultMessageMode(), optional: all.filter(o => o.checked) };
  if (!skipDialog) {
    choice = await rollDialog({ title: `${title} · словесная дуэль`, parts, luckMax: actor.luckAvailable ?? 0, optional: all,
      damage: damageText(actor, def) });
    if (!choice) return null;
  }
  parts.push(...choice.optional);
  if (choice.mod) parts.push({ label: "Модификатор", value: choice.mod });
  const roll = await performCheck({ actor, title, parts, luck: choice.luck, toChat: false });
  return { roll, choice };
}

const refOf = (actor, tokenUuid = null) => ({
  actorUuid: actor.uuid, tokenUuid: tokenUuid ?? actor.token?.uuid ?? actorToken(actor)?.document.uuid ?? null,
  name: actor.name, img: actor.img
});

/**
 * Действие словесной дуэли. Атака (эмпатическая или антагонистическая) — карточка с кнопками защиты
 * у каждой выбранной цели. Защита и рычаги вне обмена — просто проверка с уроном, как раньше.
 * @param {Actor} actor
 * @param {string} key — ключ действия из VERBAL_GROUPS
 * @param {object} [opts] — {skipDialog, targets}
 */
export async function verbalAction(actor, key, { skipDialog = false, targets: forced = null } = {}) {
  const def = ACTIONS[key];
  if (!def) return null;
  const attack = isAttack(def);
  const targets = attack ? (forced ?? currentTargets()) : [];
  const single = targets.length === 1 ? resolveActor(targets[0].tokenUuid) ?? resolveActor(targets[0].actorUuid) : null;
  const res = await duelRoll(actor, def, { skipDialog, optional: attack ? targetStateParts(def, single) : [] });
  if (!res) return null;
  const { roll, choice } = res;

  if (attack) {
    const damageMod = choice.damageMod ?? 0;
    const data = {
      ...roll, label: def.label, groupLabel: def.groupLabel, skillLabel: SKILLS[def.skill]?.label ?? "",
      kind: def.group, effect: def.effect, isAttack: true,
      damageHint: damageText(actor, def) + (damageMod ? ` ${damageMod > 0 ? "+" : "−"} ${Math.abs(damageMod)}` : ""),
      targets, hasTargets: targets.length > 0, defenses: DUEL_DEFENSES
    };
    return postCard({
      template: "systems/vedmak/templates/chat/verbal.hbs", data, actor,
      flags: { verbal: { kind: "attack", key, label: def.label, total: roll.total, damageMod, empathic: !!def.empathic,
        attacker: refOf(actor), targets, actorUuid: actor.uuid, messageMode: choice.messageMode } },
      rolls: roll.rolls ?? [], messageMode: choice.messageMode
    });
  }

  let damage = null;
  const rolls = [...(roll.rolls ?? [])];
  if (def.damage) {
    const dmg = await rollDuelDamage(actor, def, null, choice.damageMod);
    if (dmg.roll) rolls.push(dmg.roll);
    damage = { total: dmg.total, formula: dmg.formula };
  }
  const data = {
    ...roll, label: def.label, groupLabel: def.groupLabel, skillLabel: SKILLS[def.skill]?.label ?? "",
    kind: def.group, damage, effect: def.effect, actorUuid: actor.uuid
  };
  return postCard({
    template: "systems/vedmak/templates/chat/verbal.hbs", data, actor,
    flags: { verbal: { key, damage: damage?.total ?? 0, actorUuid: actor.uuid, total: roll.total } },
    rolls, messageMode: choice.messageMode
  });
}

/* -------------------------------------------------------------------------- */
/*  Защита и исход                                                            */
/* -------------------------------------------------------------------------- */

/** Основа действия — для выбора лучшей защиты и списка контраргументов. */
// Основа может быть отрицательной (стр. 157 обрезает только вычитание провала), поэтому лучшую сравниваем по настоящему значению
const actionBase = (actor, def) => duelParts(actor, def).reduce((sum, p) => sum + (Number(p.value) || 0), 0);

/** Лучшая защита для автоматического броска: Игнорировать или Смена темы — что выше. */
export function bestVerbalDefense(actor) {
  return actionBase(actor, ACTIONS.ignore) >= actionBase(actor, ACTIONS.changeSubject) ? "ignore" : "changeSubject";
}

/** Контраргумент: какую атаку бросить в ответ (по умолчанию — с наибольшей основой). */
async function pickCounter(actor, skipDialog) {
  const options = Object.values(ACTIONS).filter(isAttack).map(a => ({ ...a, base: actionBase(actor, a) }))
    .sort((a, b) => b.base - a.base);
  if (skipDialog) return options[0]?.key ?? null;
  const rows = options.map((a, i) => `<label class="chip"><input type="radio" name="counter" value="${a.key}" ${i === 0 ? "checked" : ""}>
    <span>${a.label} <b>${a.base}</b></span></label>`).join("");
  const key = await DialogV2.wait({
    window: { title: `Контраргумент: ${actor.name}` },
    classes: ["vedmak", "vedmak-dialog"],
    content: `<div class="vedmak-roll-dialog"><p class="hint">Бросьте атаку в ответ: если результат выше, атака противника отменяется, а ваша наносит урон.</p>
      <div class="opt-row">${rows}</div></div>`,
    buttons: [{ action: "ok", label: "Ответить", default: true,
      callback: (e, b) => b.form.querySelector('[name="counter"]:checked')?.value ?? null },
    { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  return key && key !== "cancel" ? key : null;
}

/**
 * Защититься от атаки из карточки.
 * @param {ChatMessage} message — карточка атаки
 * @param {object} target — {tokenUuid, actorUuid} или пусто (выделенный токен)
 * @param {string} defense — ignore | changeSubject | disengage | counter | none
 * @param {object} [opts] — {skipDialog, messageMode}; messageMode — когда карточку создаёт клиент ведущего за НИП
 */
export async function verbalDefend(message, target, defense, { skipDialog = false, messageMode } = {}) {
  const atk = message.flags.vedmak?.verbal;
  if (atk?.kind !== "attack") return null;
  const info = target?.tokenUuid || target?.actorUuid ? target : fallbackDefender();
  const defender = resolveActor(info?.tokenUuid) ?? resolveActor(info?.actorUuid);
  if (!defender) return ui.notifications.warn("Выделите токен того, кто защищается.");
  if (!defender.isOwner) return ui.notifications.warn(`Защищаться за «${defender.name}» может только его владелец или ведущий.`);
  const attacker = resolveActor(atk.attacker.tokenUuid) ?? resolveActor(atk.attacker.actorUuid);
  if (!attacker) return ui.notifications.warn("Атакующий не найден.");
  const action = ACTIONS[atk.key];
  const who = refOf(defender, info.tokenUuid);
  // Одна защита цели от одной атаки (как в бою): иначе игрок бросал бы, пока не повезёт, и каждый исход снимал бы Решительность.
  // Повтор — только ведущему и с подтверждением
  if (priorVerbalDefense(message, who) && !(await allowRepeat(`${defender.name} уже отвечал на эту атаку.`))) return null;

  // Бросок защиты или контраргумента
  let defAction = null, res = null, label = "Без защиты";
  if (defense === "counter") {
    const key = await pickCounter(defender, skipDialog);
    if (!key) return null;
    defAction = ACTIONS[key];
    label = `Контраргумент: ${defAction.label}`;
    res = await duelRoll(defender, defAction, { skipDialog, title: label, optional: targetStateParts(defAction, attacker) });
    if (!res) return null;
  } else if (defense !== "none") {
    defAction = ACTIONS[defense];
    if (!defAction) return null;
    label = defAction.label;
    res = await duelRoll(defender, defAction, { skipDialog });
    if (!res) return null;
  }
  const defTotal = res?.roll.total ?? null;
  const hit = defTotal === null || atk.total > defTotal;
  const rolls = [...(res?.roll.rolls ?? [])];
  const lines = [];
  let loss = null, stack = null;

  if (hit) {
    const dmg = await rollDuelDamage(attacker, action, defender, atk.damageMod);
    if (dmg) {
      if (dmg.roll) rolls.push(dmg.roll);
      loss = { ...who, amount: dmg.total, formula: dmg.formula, why: dmg.why.join(", ") };
    }
    if (STACKS[action.key]) stack = { holder: who.tokenUuid ?? who.actorUuid, pair: pairKey(attacker), key: action.key };
    if (defense === "counter") lines.push("Контраргумент не перебил атаку.");
    if (action.effect) lines.push(action.effect);
  } else if (defAction?.damage) {
    const ref = refOf(attacker, atk.attacker.tokenUuid);
    const dmg = await rollDuelDamage(defender, defAction, attacker, res.choice.damageMod);
    if (dmg.roll) rolls.push(dmg.roll);
    loss = { ...ref, amount: dmg.total, formula: dmg.formula, why: dmg.why.join(", ") };
    if (defense === "counter") {
      lines.push("Атака противника отменена.");
      if (STACKS[defAction.key]) stack = { holder: ref.tokenUuid ?? ref.actorUuid, pair: pairKey(defender), key: defAction.key };
    }
  } else if (defense === "disengage") {
    lines.push("Спор окончен: никто не выиграл.");
  }

  const data = {
    kind: "outcome", attackMessageId: message.id,
    attack: { label: atk.label, total: atk.total }, attacker: atk.attacker, defender: who,
    label, roll: res?.roll ?? null, total: defTotal, hit, loss, stack, lines, applied: false, report: []
  };
  const card = await postCard({
    template: "systems/vedmak/templates/chat/verbal-outcome.hbs", data, actor: defender,
    flags: { verbal: data }, rolls, messageMode: res?.choice.messageMode ?? messageMode ?? defaultMessageMode()
  });
  await markDone(message, card);
  return card;
}

/** Есть ли уже исход ответа этой цели на эту атаку. Поиск по чату, а не отметка: её может не быть без ведущего. */
function priorVerbalDefense(message, who) {
  const same = d => (who.tokenUuid && d?.tokenUuid ? d.tokenUuid === who.tokenUuid : d?.actorUuid === who.actorUuid);
  return game.messages.some(m => {
    const v = m.flags.vedmak?.verbal;
    return v?.kind === "outcome" && v.attackMessageId === message.id && same(v.defender);
  });
}

/** Снять Решительность у актора. */
async function applyResolve({ uuid, amount }) {
  const actor = resolveActor(uuid);
  if (!actor) return null;
  const { value, max } = currentResolve(actor);
  const next = Math.max(0, value - amount);
  await actor.setFlag("vedmak", "duelResolve", next);
  return { name: actor.name, from: value, to: next, max };
}
// Старые карточки с кнопкой «−N Решительности цели». Запрос игрока: цель — его, либо карточка его собственная
// (messageId, автор — отправитель, он же владелец действовавшего), сумма — ровно из карточки, и один раз на цель
registerGMHandler("applyResolve", async ({ uuid, amount, messageId }, userId) => {
  const actor = resolveActor(uuid);
  const n = Number(amount);
  if (!actor || !Number.isFinite(n)) return null;
  if (!userOwnsAny(userId, actor)) {
    const card = game.messages.get(messageId);
    const v = card?.flags.vedmak?.verbal;
    const key = doneKey(uuid);
    if (!v?.damage || n !== v.damage || card.author?.id !== userId || v.resolveApplied?.[key]
      || !userOwnsAny(userId, resolveActor(v.actorUuid))) {
      return console.warn(`vedmak | отклонена потеря Решительности от ${game.users.get(userId)?.name ?? userId}`);
    }
    await card.update({ [`flags.vedmak.verbal.resolveApplied.${key}`]: true });
  }
  return applyResolve({ uuid, amount: n });
});

const applyingOutcomes = new Set();

/** Применить исход обмена: Решительность проигравшего и накопление бонусов (у ведущего). */
registerGMHandler("verbalApply", async ({ messageId }, userId) => {
  if (applyingOutcomes.has(messageId)) return;
  const message = game.messages.get(messageId);
  const v = message?.flags.vedmak?.verbal;
  if (v?.kind !== "outcome" || v.applied || !v.loss) return;
  const attacker = resolveActor(v.attacker.tokenUuid) ?? resolveActor(v.attacker.actorUuid);
  const defender = resolveActor(v.defender.tokenUuid) ?? resolveActor(v.defender.actorUuid);
  // Запрос игрока: он участник обмена, и карточку исхода создал участник — иначе её можно подделать
  if (!game.users.get(userId)?.isGM
    && (!userOwnsAny(userId, attacker, defender) || !userOwnsAny(message.author?.id, attacker, defender))) {
    return console.warn(`vedmak | отклонён исход дуэли от ${game.users.get(userId)?.name ?? userId}`);
  }
  applyingOutcomes.add(messageId);
  try {
    const report = [];
    const r = await applyResolve({ uuid: v.loss.tokenUuid ?? v.loss.actorUuid, amount: v.loss.amount });
    if (r) {
      report.push(`${r.name}: Решительность ${r.from} → ${r.to} из ${r.max}.`);
      if (r.to <= 0) report.push(`${r.name} проигрывает дуэль и делает то, чего хотел противник.`);
    }
    if (v.stack) {
      const holder = resolveActor(v.stack.holder);
      const path = `duelStacks.${v.stack.pair}.${v.stack.key}`;
      if (holder) await holder.setFlag("vedmak", path, (holder.getFlag("vedmak", path) ?? 0) + 1);
    }
    const data = { ...v, applied: true, report };
    const content = await renderTemplate("systems/vedmak/templates/chat/verbal-outcome.hbs", data);
    await message.update({ content, "flags.vedmak.verbal.applied": true, "flags.vedmak.verbal.report": report });
  } finally {
    applyingOutcomes.delete(messageId);
  }
});

/** Новая дуэль: полная Решительность и никаких накоплений. */
export async function resetDuel(actor) {
  await actor.unsetFlag("vedmak", "duelResolve");
  await actor.unsetFlag("vedmak", "duelStacks");
}

registerChatAction("verbalDefend", async (message, button, event) => {
  const row = button.closest(".target-row");
  const target = { tokenUuid: row?.dataset.targetToken || null, actorUuid: row?.dataset.targetActor || null };
  return verbalDefend(message, target, button.dataset.defense, { skipDialog: event.shiftKey });
});

registerChatAction("verbalApply", async message => {
  const v = message.flags.vedmak?.verbal;
  if (v?.kind !== "outcome" || !v.loss) return null;
  if (v.applied) return ui.notifications.info("Исход уже применён.");
  return asGM("verbalApply", { messageId: message.id });
});

/** Кнопка старых карточек: урон Решительности выбранной цели (цель или выделенный токен). */
registerChatAction("verbalDamage", async message => {
  const v = message.flags.vedmak?.verbal;
  if (!v?.damage) return null;
  const target = [...game.user.targets][0];
  const info = target ? { tokenUuid: target.document.uuid, actorUuid: target.actor?.uuid } : fallbackDefender();
  const uuid = info?.tokenUuid ?? info?.actorUuid;
  const actor = resolveActor(uuid);
  if (!actor) return ui.notifications.warn("Выберите цель или выделите токен того, кто проиграл обмен.");
  const { value } = currentResolve(actor);
  const next = Math.max(0, value - v.damage);
  await asGM("applyResolve", { uuid, amount: v.damage, messageId: message.id });
  ui.notifications.info(`${actor.name}: Решительность ${value} → ${next}${next <= 0 ? " — проигрывает дуэль" : ""}.`);
  return null;
});
