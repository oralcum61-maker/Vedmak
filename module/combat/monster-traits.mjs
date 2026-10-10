// Свойства чудовищ, записанные в книгах способностями (PLAN 5): регенерация, бесплотность, полёт.
// Числа берутся из текста способности («восстанавливает 5 ПЗ за раунд», «сбить, нанеся более 10 урона одной атакой»),
// поэтому работают и у бестиария BS & Tobi, и у существ из книг, и у существ, которых ведущий завёл сам.

import { plainText } from "../util.mjs";

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
 *   flight: {threshold: number|null, dc: number, text: string}|null}}
 */
export function monsterTraits(actor) {
  const list = actor?.type === "monster" ? actor.system.abilities : null;
  if (!list) return { regen: null, incorporeal: false, flight: null };
  let out = CACHE.get(list);
  if (out) return out;
  out = { regen: null, incorporeal: false, flight: null };
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
  return [`${target.name} сбит в полёте (${why}): падает${from} и сбит с ног. Атлетика СЛ ${dc}, иначе урон от падения.`];
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
  if (t.flight) {
    const thr = t.flight.threshold;
    out.push(`полёт по высоте токена — сбивает ${thr === null ? "только дезориентация" : thr ? `урон больше ${thr}` : "любой урон"}, Атлетика СЛ ${t.flight.dc}`);
  }
  return out;
}
