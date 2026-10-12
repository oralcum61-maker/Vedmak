// События месяца поселений (PLAN 4.206): бросок события в конце месяца (ход недели), решение правителя на листе поселения
// (цена, проверка d10 + основа против СЛ, последствия сразу и надолго), решение по умолчанию, если правитель не успел до
// следующего хода, событие по выбору ведущего. Справочник — config/settlement-events.mjs.

import { SETTLEMENT_EVENTS, CHECK_BASES, EVENT_CHANCE, rollEvent, effectLabel } from "../config/settlement-events.mjs";
import { APPROVAL_MAX } from "../config/settlement.mjs";
import { rollFormula, costLabel, WEALTH } from "./rules.mjs";
import { postCard } from "../combat/common.mjs";
import { playSound } from "../fx/sounds.mjs";

const rand = () => (CONFIG.Dice.randomUniform ?? Math.random)();
const r1 = n => Math.round(n * 10) / 10;
const r3 = n => Math.round(n * 1000) / 1000;

/** Шанс события в конце месяца (настройка мира; 0 — событий нет). */
export const eventChance = () => {
  try { return Number(game.settings.get("vedmak", "settlementEvents")); } catch { return EVENT_CHANCE; }
};

/** Состояние поселения для условий событий и проверок. */
export function eventState(actor) {
  const sys = actor.system;
  const sum = sys.summary;
  return {
    month: sys.month, season: sys.calendar.season, siege: sys.siege.units.length > 0, approval: sys.approval,
    families: sys.families, militia: sys.militia, trade: sum.trade, control: sum.control, defense: sum.defense,
    keys: new Set(sys.buildings.filter(b => b.level >= 1).map(b => b.key))
  };
}

/** Основа проверки: guard — Контроль + укрепления + Ополчение / 10; order — Контроль + одобрение / 2; luck — 0. */
export function checkBase(s, check) {
  const base = check.base === "guard" ? s.control + s.defense + Math.floor(s.militia / 10)
    : check.base === "order" ? s.control + Math.floor(s.approval / 2) : 0;
  const bonus = Object.entries(check.bonus ?? {}).reduce((n, [k, v]) => n + (s.keys.has(k) ? v : 0), 0);
  return { base, bonus, total: base + bonus };
}

/** Можно ли выбрать: цена по складу и казне, требование выбора. */
export function canChoose(actor, choice) {
  const why = choice.requires?.(eventState(actor));
  if (why) return { ok: false, why };
  const stock = actor.system.stockMap;
  const miss = (choice.cost ?? []).filter(c => (c.resource === WEALTH ? actor.system.wealth : stock[c.resource] ?? 0) < c.qty);
  return miss.length ? { ok: false, why: `Не хватает: ${miss.map(c => c.resource.toLowerCase()).join(", ")}.` } : { ok: true };
}

/** Решение на листе: событие, выборы с ценой, проверкой и последствиями подписью. */
export function decisionView(actor, d) {
  const ev = SETTLEMENT_EVENTS[d.key];
  if (!ev) return null;
  const s = eventState(actor);
  const def = defaultChoice(actor, d);
  return {
    id: d.id, key: d.key, label: ev.label, img: ev.img, text: ev.text,
    choices: ev.choices.map((c, i) => {
      const can = canChoose(actor, c);
      const chk = c.check ? checkBase(s, c.check) : null;
      return {
        index: i, label: c.label, hint: c.hint ?? "", ok: can.ok, why: can.why ?? "", isDefault: i === def,
        cost: c.cost?.length ? costLabel(c.cost) : "",
        check: chk ? `${CHECK_BASES[c.check.base]?.label ?? ""}: d10 + ${chk.total} против ${c.check.dc}` : "",
        effects: (c.effects ?? []).map(effectLabel).filter(Boolean).join("; "),
        success: (c.success ?? []).map(effectLabel).filter(Boolean).join("; ") || (c.check ? "обошлось" : ""),
        fail: (c.fail ?? []).map(effectLabel).filter(Boolean).join("; ")
      };
    })
  };
}

/** Выбор по умолчанию: указанный в событии, если доступен, иначе первый доступный с конца. */
function defaultChoice(actor, d) {
  const ev = SETTLEMENT_EVENTS[d.key];
  if (!ev) return -1;
  if (canChoose(actor, ev.choices[ev.default ?? ev.choices.length - 1] ?? {}).ok) return ev.default ?? ev.choices.length - 1;
  for (let i = ev.choices.length - 1; i >= 0; i--) if (canChoose(actor, ev.choices[i]).ok) return i;
  return -1;
}

/**
 * Последствия списком → обновление поселения и строки отчёта. Формулы бросаются (rand); склад и казна не уходят ниже нуля.
 */
function applyEffects(actor, effects, update, lines, modifiers) {
  const sys = actor.system;
  const get = (path, fallback) => update[path] ?? fallback;
  for (const e of effects ?? []) {
    if (e.mod) {
      modifiers.push({ ...foundry.utils.deepClone(e.mod), id: foundry.utils.randomID() });
      lines.push(effectLabel(e));
      continue;
    }
    const roll = v => rollFormula(String(v), rand).total;
    if (e.stock) {
      const path = `system.stock.${e.stock}`;
      const was = get(path, sys.stockMap[e.stock] ?? 0);
      const now = r1(Math.max(0, was + roll(e.delta)));
      update[path] = now;
      lines.push(`${e.stock} ${now >= was ? "+" : "−"}${r1(Math.abs(now - was))}`);
    } else if (e.wealth != null) {
      const was = get("system.wealth", sys.wealth);
      const now = r3(Math.max(0, was + roll(e.wealth)));
      update["system.wealth"] = now;
      lines.push(`Богатство ${now >= was ? "+" : "−"}${r3(Math.abs(now - was))}`);
    } else {
      for (const k of ["approval", "families", "militia", "control"]) {
        if (e[k] == null) continue;
        const path = `system.${k}`;
        const was = get(path, sys[k]);
        let now = Math.max(0, Math.round(was + roll(e[k])));
        if (k === "approval") now = Math.min(APPROVAL_MAX, now);
        update[path] = now;
        const label = { approval: "одобрение", families: "семьи", militia: "Ополчение", control: "Контроль" }[k];
        lines.push(`${label} ${now >= was ? "+" : "−"}${Math.abs(now - was)}`);
      }
    }
  }
}

/**
 * Решить событие: index — выбор (auto — решение по умолчанию при ходе недели). Цена списывается, проверка бросается,
 * последствия ложатся в поселение; карточка в чат.
 */
export async function decide(actor, decisionId, index, { auto = false } = {}) {
  const d = actor.system.decisions.find(x => x.id === decisionId);
  const ev = d ? SETTLEMENT_EVENTS[d.key] : null;
  if (!ev) return null;
  if (!actor.isOwner) return ui.notifications.warn("Решает правитель — владелец поселения.");
  if (auto) index = defaultChoice(actor, d);
  const choice = ev.choices[index];
  const update = {};
  const lines = [];
  const modifiers = [...(actor.system.modifiers ?? [])];
  let check = null;
  if (choice) {
    const can = canChoose(actor, choice);
    if (!can.ok) return ui.notifications.warn(can.why);
    for (const c of choice.cost ?? []) {
      if (c.resource === WEALTH) update["system.wealth"] = r3((update["system.wealth"] ?? actor.system.wealth) - c.qty);
      else update[`system.stock.${c.resource}`] = r1((update[`system.stock.${c.resource}`] ?? actor.system.stockMap[c.resource] ?? 0) - c.qty);
    }
    if (choice.cost?.length) lines.push(`Потрачено: ${costLabel(choice.cost)}`);
    applyEffects(actor, choice.effects, update, lines, modifiers);
    if (choice.check) {
      const s = eventState(actor);
      const b = checkBase(s, choice.check);
      const d10 = rollFormula("1d10", rand).total;
      check = { d10, base: b.total, total: d10 + b.total, dc: choice.check.dc, ok: d10 + b.total >= choice.check.dc,
        label: CHECK_BASES[choice.check.base]?.label ?? "" };
      applyEffects(actor, check.ok ? choice.success : choice.fail, update, lines, modifiers);
    }
  }
  update["system.decisions"] = actor.system.toObject().decisions.filter(x => x.id !== decisionId);
  if (modifiers.length !== (actor.system.modifiers ?? []).length) update["system.modifiers"] = modifiers;
  await actor.update(update);
  // Звук, как у проверок: успех или провал; без проверки, но с ценой — монеты
  if (!auto) {
    if (check) playSound(check.ok ? "ui-success" : "ui-fail", { delay: 300 });
    else if (choice?.cost?.length) playSound("ui-coin");
  }
  await postCard({
    template: "systems/vedmak/templates/chat/settlement-event.hbs",
    data: { name: actor.name, label: ev.label, img: ev.img, text: ev.text, choice: choice?.label ?? "ничего не сделали", auto, check,
      lines },
    actor, speaker: ChatMessage.getSpeaker({ alias: actor.name })
  });
  return { choice: index, check, lines };
}

/** Ход недели: нерешённые события прошлых недель — решение по умолчанию. Возвращает строки для отчёта. */
export async function autoResolve(actor) {
  const out = [];
  for (const d of [...actor.system.decisions]) {
    const ev = SETTLEMENT_EVENTS[d.key];
    const res = await decide(actor, d.id, 0, { auto: true });
    if (ev) out.push({ kind: "event", text: `Решение не принято — «${ev.label}»: ${ev.choices[res?.choice]?.label?.toLowerCase() ?? "ничего не сделали"}.` });
  }
  return out;
}

/** Событие месяца: бросок шанса и выбор события; есть — в решения поселения. Возвращает строку отчёта или null. */
export function rollMonthEvent(actor, cal) {
  const key = rollEvent(eventState(actor), eventChance(), rand);
  return key ? makeDecision(key, cal) : null;
}

/** Решение по коду события. */
export function makeDecision(key, cal) {
  return { id: foundry.utils.randomID(), key, year: cal.year, month: cal.month, week: cal.week };
}

/** Ведущий: событие по выбору (или случайное из подходящих) — сразу в решения поселения. */
export async function addEvent(actor, key = "") {
  if (!game.user.isGM) return;
  key ||= rollEvent(eventState(actor), 100, rand);
  if (!SETTLEMENT_EVENTS[key]) return ui.notifications.warn("Подходящих событий нет.");
  const d = makeDecision(key, actor.system.calendar);
  await actor.update({ "system.decisions": [...actor.system.toObject().decisions, d] });
  await postPending(actor, d);
  return d;
}

/**
 * Карточка события, ждущего решения (PLAN 4.210): варианты кнопками — правитель решает прямо в чате; остальные видят
 * варианты. Решено (здесь или на листе) — карточка перерисовывается: «Решено».
 */
export async function postPending(actor, d) {
  const view = decisionView(actor, d);
  if (!view) return null;
  return postCard({
    template: "systems/vedmak/templates/chat/settlement-event.hbs",
    data: { ...view, name: actor.name, pending: true, uuid: actor.uuid, decision: d.id },
    actor, speaker: ChatMessage.getSpeaker({ alias: actor.name }),
    flags: { settlementEvent: { uuid: actor.uuid, decision: d.id } }
  });
}

/** Уведомить владельца (не ведущего) о решениях, что ждут его. */
function notifyPending(actor, list = actor.system.decisions) {
  if (game.user.isGM || !actor.isOwner) return;
  for (const d of list) {
    const ev = SETTLEMENT_EVENTS[d.key];
    if (ev) ui.notifications.info(`«${actor.name}» ждёт решения правителя: «${ev.label}». Варианты — в чате и на листе поселения.`, { permanent: true });
  }
}

/** Карточки событий в чате, кнопки решений, уведомления и метки «ждёт решения» (PLAN 4.210). */
export function registerEventHooks() {
  // Какие решения этот клиент уже видел — чтобы уведомлять только о новых
  const known = new Map();
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const f = message.getFlag("vedmak", "settlementEvent");
    if (!f) return;
    const actor = fromUuidSync(f.uuid);
    const open = actor?.system.decisions.some(x => x.id === f.decision);
    const box = html.querySelector(".se-choices");
    if (!box) return;
    if (!open) { box.outerHTML = `<p class="note se-done">Решено.</p>`; return; }
    for (const b of box.querySelectorAll("button[data-se-choice]")) {
      if (!actor.isOwner) { b.disabled = true; b.dataset.tooltip = "Решает правитель — владелец поселения"; continue; }
      b.addEventListener("click", async ev => {
        ev.preventDefault();
        box.querySelectorAll("button").forEach(x => { x.disabled = true; });
        await decide(actor, f.decision, Number(b.dataset.seChoice));
      });
    }
  });
  // Решение принято (в чате, на листе или по умолчанию) — его карточка перерисовывается; новое — уведомление владельцу
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (actor.type !== "settlement" || !foundry.utils.hasProperty(changes, "system.decisions")) return;
    const ids = new Set(actor.system.decisions.map(d => d.id));
    for (const m of game.messages.contents.slice(-60)) {
      const f = m.getFlag("vedmak", "settlementEvent");
      if (f?.uuid === actor.uuid && !ids.has(f.decision)) ui.chat?.updateMessage(m);
    }
    const seen = known.get(actor.id) ?? new Set();
    if (userId !== game.user.id) notifyPending(actor, actor.system.decisions.filter(d => !seen.has(d.id)));
    known.set(actor.id, ids);
    ui.actors?.render();
  });
  // При входе в игру — что ждёт решения
  Hooks.once("ready", () => {
    for (const a of game.actors) if (a.type === "settlement") {
      known.set(a.id, new Set(a.system.decisions.map(d => d.id)));
      if (a.system.decisions.length) notifyPending(a);
    }
  });
  // Метка в списке актёров: у поселения есть нерешённое событие
  Hooks.on("renderActorDirectory", (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    for (const a of game.actors) {
      if (a.type !== "settlement" || !a.system.decisions?.length) continue;
      const li = root?.querySelector(`[data-entry-id="${a.id}"]`);
      if (!li || li.querySelector(".vd-pending")) continue;
      const mark = document.createElement("i");
      mark.className = "vd-pending fa-solid fa-scroll";
      mark.dataset.tooltip = "Ждёт решения правителя";
      (li.querySelector(".entry-name, .document-name") ?? li).append(mark);
    }
  });
}

/** Снять действующее последствие (ведущий). */
export async function removeModifier(actor, id) {
  if (!game.user.isGM) return;
  await actor.update({ "system.modifiers": (actor.system.modifiers ?? []).filter(m => m.id !== id) });
}

export { SETTLEMENT_EVENTS };
