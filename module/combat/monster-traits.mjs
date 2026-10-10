// Свойства чудовищ, записанные в книгах способностями (PLAN 5): регенерация, бесплотность, полёт.
// Числа берутся из текста способности («восстанавливает 5 ПЗ за раунд», «сбить, нанеся более 10 урона одной атакой»),
// поэтому работают и у бестиария BS & Tobi, и у существ из книг, и у существ, которых ведущий завёл сам.

import { plainText } from "../util.mjs";
import { performCheck } from "../dice/check.mjs";
import { rollFormula } from "./common.mjs";
import { computeManual } from "./manual.mjs";
import { applyDamageToActor, serialByActor } from "./damage.mjs";

const SYS = "vedmak";

/** Условная регенерация («находясь под водой») автоматически не идёт — только напоминание. */
const CONDITIONAL = /находясь|только|если|пока|в воде|под водой|в болот|ночью|днём|при свете/i;

/** «5 ПЗ», «20 пунктов полученного урона», «10 пунктов здоровья». */
const HEAL_AMOUNT = /(\d+)\s*(?:пз|пункт[а-яё]*\s+(?:полученного\s+)?(?:урона|здоровья))/i;

/** Статус временной бесплотности: «Ускользание» призрака, дымная форма Скрытого, хим во тьме — ставит ведущий. */
export const INCORPOREAL = "incorporeal";

/** Статус «В полёте» — кого из летающих сбивают урон и дезориентация. */
export const FLYING = "flying";

/** Состояния, от которых летящий падает: дезориентация (способность «Полёт»), сбит с ног («Сметающий Аард»), без сознания. */
const FALL_STATUSES = ["disoriented", "prone", "unconscious"];

const CACHE = new WeakMap();

/** Предложение текста, в котором нашлось совпадение, — условие ищется только в нём. */
function sentenceOf(text, re) {
  return text.split(/(?<=[.!?])\s+/).find(s => re.test(s)) ?? "";
}

/**
 * Свойства чудовища из его способностей (с запоминанием до правки списка способностей).
 * Регенерация — из «Регенерации» и из «Бессмертия» высших вампиров и рыцарей смерти (берётся бóльшая).
 * Порог полёта: число — сбивает урон больше него, 0 — любой урон (птицы), null — урон не сбивает (Наблюдатель).
 * @param {Actor} actor
 * @returns {{regen: {amount: number, conditional: boolean, crits: boolean, text: string}|null, incorporeal: boolean,
 *   flight: {threshold: number|null, dc: number, text: string}|null, invisibility: "superior"|"basic"|null}}
 */
export function monsterTraits(actor) {
  const list = actor?.type === "monster" ? actor.system.abilities : null;
  if (!list) return { regen: null, incorporeal: false, flight: null, invisibility: null };
  let out = CACHE.get(list);
  if (out) return out;
  out = { regen: null, incorporeal: false, flight: null, invisibility: null };
  for (const a of list) {
    const name = String(a.name ?? "").trim().toLowerCase();
    const text = plainText(a.description);
    // «Бессмертный» высшего демона — про возвращение после смерти, не про лечение: нужен глагол исцеления
    const immortal = name.startsWith("бессмерт") && /исцел|восстанавл|регенер/i.test(text);
    if (name.startsWith("регенерац") || immortal) {
      const m = text.match(HEAL_AMOUNT) ?? (immortal ? null : text.match(/(\d+)/));
      const regen = {
        amount: m ? Number(m[1]) : 0,
        // У «Бессмертия» без числа («исцеляет ПЗ») — только напоминание
        conditional: !m || CONDITIONAL.test(sentenceOf(text, m ? new RegExp(m[0]) : /./)),
        crits: immortal, text
      };
      const better = !out.regen || (out.regen.conditional && !regen.conditional)
        || (regen.conditional === out.regen.conditional && regen.amount > out.regen.amount);
      if (better) out.regen = { ...regen, crits: regen.crits || !!out.regen?.crits };
      else if (immortal) out.regen.crits = true;
    }
    if (name.startsWith("бесплотн")) out.incorporeal = true;
    // «Превосходная невидимость» (брукса, высший вампир) — как «Покров»; «Невидимость», «Постоянная невидимость»
    // (катакан, носферат, амарок) — обычная. «Невидимость для магии» — другое (медальон не чует)
    const inv = name.match(/^(превосходная |постоянная )?невидимость$/);
    if (inv && out.invisibility !== "superior") out.invisibility = inv[1]?.startsWith("превосход") ? "superior" : "basic";
    if (!out.flight && /^пол[её]т/.test(name)) {
      // «более 10 урона одной атакой», «более 5 пунктов урона» — порог; «нанеся ей урон» — любой урон;
      // ни того ни другого («только дезориентировав или заставив потерять сознание») — урон не сбивает
      const m = text.match(/более\s+(\d+)\s+(?:пункт[а-яё]*\s+)?урона/i);
      const threshold = m ? Number(m[1]) : (/нанеся[^.]*урон/i.test(text) ? 0 : null);
      const dc = Number(text.match(/СЛ\s*(\d+)/i)?.[1]) || 16;
      out.flight = { threshold, dc, text };
    }
  }
  CACHE.set(list, out);
  return out;
}

/** Стоит в круге Ирдена или облаке лунной пыли: эффект ауры зоны с `reveals` (magic/zone-effects.mjs). */
export const isRevealed = actor => (actor?.effects ?? []).some(e => e.active && e.flags?.[SYS]?.reveals);

/** Бесплотен сейчас: всегда (полуденница) или статусом (ускользание), если Ирден или лунная пыль не проявили. */
export function isIncorporeal(actor) {
  if (!actor) return false;
  const always = actor.type === "monster" && monsterTraits(actor).incorporeal;
  return (always || actor.statuses?.has(INCORPOREAL)) && !isRevealed(actor);
}

/**
 * Невидимость чудовища сейчас: статус «Невидимость» у существа с такой способностью. Ирден и лунная пыль
 * проявляют: превосходная — лишь частично, обычная — полностью.
 * @returns {{kind: "superior"|"basic", revealed: boolean}|null}
 */
export function monsterInvisibility(actor) {
  if (actor?.type !== "monster" || !actor.statuses?.has("invisible")) return null;
  const kind = monsterTraits(actor).invisibility;
  return kind ? { kind, revealed: isRevealed(actor) } : null;
}

/**
 * Поправки к броскам невидимого чудовища: превосходная — +5 к атаке и защите, +10 к Скрытности (проявлена или
 * замечена — +3 и +5); обычная — +5 к атаке и +10 к Скрытности, проявленная — ничего.
 * @param {Actor} actor
 * @param {"attack"|"defense"|"skill"} kind
 * @param {string} [skill]
 */
export function invisibilityParts(actor, kind, skill) {
  const inv = monsterInvisibility(actor);
  if (!inv || (inv.kind === "basic" && inv.revealed)) return [];
  const partial = inv.kind === "superior" && inv.revealed;
  const label = inv.kind === "superior" ? (partial ? "Превосходная невидимость: частично видим" : "Превосходная невидимость") : "Невидимость";
  const value = kind === "attack" ? (partial ? 3 : 5)
    : kind === "defense" ? (inv.kind === "superior" ? (partial ? 3 : 5) : 0)
    : skill === "stealth" ? (partial ? 5 : 10) : 0;
  return value ? [{ label, value }] : [];
}

/** Против обычной невидимости даже заметившему: −3 к атаке по существу и к защите от его атак. */
export function invisibleOpponentPart(opponent) {
  const inv = monsterInvisibility(opponent);
  return inv?.kind === "basic" && !inv.revealed ? [{ label: `${opponent.name}: невидим`, value: -3 }] : [];
}

/** Обычная невидимость спадает, когда существо атакует; превосходная — когда по нему попали. */
export async function dropInvisibility(actor, reason) {
  const inv = monsterInvisibility(actor);
  if (!inv || (reason === "attack" ? inv.kind !== "basic" : inv.kind !== "superior")) return [];
  await actor.toggleStatusEffect("invisible", { active: false });
  return [reason === "attack" ? `${actor.name} атакует и становится видимым.` : `По ${actor.name} попали — невидимость спала.`];
}

/** Лунная пыль не даёт регенерировать (котолак, чёрт, териантроп…): аура облака или эффект с флагом noRegen. */
export const regenBlocked = actor => (actor?.effects ?? []).some(e => e.active
  && (e.flags?.[SYS]?.noRegen || (e.flags?.[SYS]?.zoneAura && /лунн/i.test(e.name))));

/**
 * Регенерация в начале хода чудовища: ПЗ до максимума, пока жив. Возвращает строки для карточки хода.
 * @param {Actor} actor
 */
export async function regenStartOfTurn(actor) {
  const regen = monsterTraits(actor).regen;
  if (!regen || actor.statuses.has("dead")) return [];
  const crits = regen.crits && actor.items.some(i => i.type === "critWound")
    ? ["Бессмертие: заживает одно критическое ранение, начиная с лёгких (1/2/4/6 раундов) — отметьте вручную."] : [];
  if (regen.conditional) return [`Регенерация (по условию — проверьте): ${regen.text}`, ...crits];
  if (regenBlocked(actor)) return ["Регенерация: не действует — лунная пыль."];
  const hp = actor.system.hp;
  if (hp.value >= hp.max) return crits;
  const heal = Math.min(regen.amount, hp.max - hp.value);
  await actor.update({ "system.hp.value": hp.value + heal });
  return [`Регенерация: +${heal} ПЗ (${hp.value + heal}/${hp.max}).`, ...crits];
}

/** Высота токена — по данным документа: поле `elevation` в v14 анимируется и до конца перемещения отстаёт. */
const elevationOf = t => Number(t._source?.elevation ?? t.elevation) || 0;

/**
 * После урона: летящее существо сбито, если урон одной атакой больше порога из способности «Полёт»
 * (у птиц — любой) либо если оно дезориентировано или без сознания. Токен опускается на землю.
 * Возвращает строки для карточки урона.
 * @param {Actor} target
 * @param {number} dealt — урон, снятый этой атакой
 */
export async function flightAfterDamage(target, dealt) {
  if (!target?.statuses?.has(FLYING)) return [];
  const flight = monsterTraits(target).flight;
  // Статус поставлен руками существу без «Полёта» — порог как у большинства крылатых
  const threshold = flight ? flight.threshold : 10;
  const dc = flight?.dc ?? 16;
  const status = FALL_STATUSES.find(s => target.statuses.has(s));
  const byDamage = threshold !== null && dealt > threshold;
  if (!byDamage && !status) return [];
  await target.toggleStatusEffect(FLYING, { active: false });
  if (!target.statuses.has("prone")) await target.toggleStatusEffect("prone", { active: true });
  const tokens = target.getActiveTokens(false, true);
  const height = Math.max(0, ...tokens.map(elevationOf));
  if (height > 0) await Promise.all(tokens.filter(t => elevationOf(t) > 0).map(t => t.update({ elevation: 0 })));
  const why = byDamage ? `урон ${dealt} > ${threshold}` : CONFIG.statusEffects.find(s => s.id === status)?.name?.toLowerCase();
  const from = height > 0 ? ` с высоты ${height} м` : "";
  return [`${target.name} сбит в полёте (${why}): падает${from} и сбит с ног.`, ...await fallDamage(target, height, dc)];
}

/**
 * Падение сбитого летуна: Атлетика против СЛ из «Полёта» (без сознания — не проходит), при провале — урон
 * от падения по корнику: высота в метрах / 2 костей d6 по туловищу, броня поглощает.
 * @param {Actor} actor
 * @param {number} height — высота в метрах
 * @param {number} dc
 * @returns {Promise<string[]>} строки для карточки
 */
export async function fallDamage(actor, height, dc) {
  const dice = Math.floor(height / 2);
  if (!dice || actor.statuses.has("dead")) return [];
  let saved = false;
  if (!actor.statuses.has("unconscious")) {
    const stat = actor.system.stats.dex;
    const skill = actor.system.skills.athletics;
    const check = await performCheck({ actor, title: "Атлетика: падение", subtitle: `С высоты ${height} м`, dc,
      parts: [{ label: stat.label, value: stat.effective, always: true }, { label: skill.label, value: skill.total, always: true },
        { label: "Штрафы", value: skill.penalty ?? 0 }] });
    saved = !!check.success;
  }
  if (saved) return [`Атлетика СЛ ${dc} — удержался, урона от падения нет.`];
  const { total } = await rollFormula(`${dice}d6`);
  const data = await computeManual(actor, { total, damageType: "bludgeoning", where: "torso" });
  // Через очередь урона актора: удар, пришедший одновременно с падением, не перезапишет ПЗ
  const report = await serialByActor(actor, () => applyDamageToActor(actor, data));
  const why = actor.statuses.has("unconscious") ? "без сознания" : `Атлетика СЛ ${dc} провалена`;
  return [`Падение (${why}): ${dice}d6 = ${total}, по туловищу ${data.final}.`, ...(report?.lines ?? [])];
}

/** Сообщение в чат от имени актора (для сбивания не уроном). */
function post(actor, lines) {
  if (lines.length) return ChatMessage.create({ content: `<p>${lines.join("</p><p>")}</p>`, speaker: ChatMessage.getSpeaker({ actor }) });
}

/**
 * Хуки полёта (делает активный ведущий):
 * — летящего дезориентировали, сбили с ног или лишили сознания не уроном (знак, бомба, руками) — падает;
 * — токен существа с «Полётом» подняли над землёй — оно в полёте, опустили — нет.
 */
export function registerMonsterTraitHooks() {
  Hooks.on("createActiveEffect", effect => {
    const actor = effect.parent;
    if (!game.users.activeGM?.isSelf || actor?.documentName !== "Actor" || !actor.statuses.has(FLYING)) return;
    if (!FALL_STATUSES.some(s => effect.statuses?.has(s))) return;
    flightAfterDamage(actor, 0).then(lines => post(actor, lines)).catch(err => console.error("vedmak | полёт", err));
  });

  Hooks.on("updateToken", (token, changes) => {
    if (!game.users.activeGM?.isSelf || !("elevation" in changes)) return;
    const actor = token.actor;
    if (!actor || !monsterTraits(actor).flight) return;
    const up = (Number(changes.elevation) || 0) > 0;
    if (up === actor.statuses.has(FLYING)) return;
    actor.toggleStatusEffect(FLYING, { active: up }).catch(err => console.error("vedmak | полёт", err));
  });
}

/** Строка «что система делает сама» для листа чудовища. */
export function traitSummary(actor) {
  const t = monsterTraits(actor);
  const out = [];
  if (t.regen) {
    out.push(t.regen.conditional ? "регенерация — напоминание в начале хода (есть условие)"
      : `регенерация ${t.regen.amount} ПЗ в начале хода`);
    if (t.regen.crits) out.push("заживление критов — напоминание");
  }
  if (t.incorporeal) out.push("бесплотен — оружие не ранит вне Ирдена и лунной пыли");
  if (t.invisibility) out.push(t.invisibility === "superior" ? "превосходная невидимость по статусу «Невидимость» (+5 к атаке и защите, спадает от попадания)"
    : "невидимость по статусу «Невидимость» (+5 к атаке, противникам −3, спадает при атаке)");
  if (t.flight) {
    const thr = t.flight.threshold;
    out.push(`полёт по высоте токена — сбивает ${thr === null ? "только дезориентация" : thr ? `урон больше ${thr}` : "любой урон"}, Атлетика СЛ ${t.flight.dc}`);
  }
  return out;
}
