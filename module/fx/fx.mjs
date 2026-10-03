// Анимации и звуки (PLAN 4.66). Всё запускается из хуков, которые срабатывают у каждого клиента: создание карточки
// чата (атака, защита, сотворение, алхимия, испытание), убыль ПЗ, состояние «при смерти», смена хода, трата Удачи.
// Поэтому эффекты не рассылаются — каждый рисует и играет у себя, со своими настройками. Карточки, скрытые от
// игрока, и спрятанные токены у него ничего не показывают и не озвучивают.

import { SYSTEM_ID } from "../util.mjs";
import { playSound, preloadSounds } from "./sounds.mjs";
import { playJB2A, jb2aReady } from "./jb2a.mjs";
import * as S from "./scene.mjs";

const ELEMENT_COLORS = { fire: 0xff7a2a, air: 0xdcecff, water: 0x6ab0ff, earth: 0xc29a5a, mixed: 0xc9bdf0 };
/** Цвет пузырьков зелья: мутагены — по своему цвету, эликсиры — фиалка, отвары — киноварь. */
const POTION_COLORS = { red: 0xd8341a, green: 0x8fd27a, blue: 0x6ab0ff, violet: 0xb48cff };

const setting = (key, fallback) => {
  try { return game.settings.get(SYSTEM_ID, key); } catch { return fallback; }
};
const sceneOn = () => setting("fxScene", true) && !!canvas?.ready;

/** Токен на открытой сцене по {tokenUuid, actorUuid}; спрятанный — только ведущему. */
function tokenOf(ref) {
  if (!ref || !canvas?.ready) return null;
  let token = ref.tokenUuid ? fromUuidSync(ref.tokenUuid)?.object ?? null : null;
  if (!token && ref.actorUuid) token = fromUuidSync(ref.actorUuid)?.getActiveTokens?.(true)?.[0] ?? null;
  if (!token || token.document?.parent?.id !== canvas.scene?.id) return null;
  if (token.document.hidden && !game.user.isGM) return null;
  return token;
}

const tokenOfActor = actor => (actor ? tokenOf({ tokenUuid: actor.token?.uuid, actorUuid: actor.uuid }) : null);

/** Эффект: JB2A, если есть, иначе свой. */
function show(kind, jb, own) {
  if (!sceneOn()) return;
  if (jb && playJB2A(kind, jb)) return;
  own?.();
}

/* ---------------------------------------------------------------- Атака */

function onAttack(f) {
  const a = f.attack;
  const attacker = tokenOf(a.attacker);
  const targets = (a.targets ?? []).map(tokenOf).filter(Boolean);
  const from = S.pointOf(attacker);
  if (a.roll?.fumble) {
    playSound("fumble", { delay: 250 });
    if (sceneOn() && from) { S.fizzle(from); S.floatText(from, a.fumbleLabel || "Провал", 0xe0937f); }
    return;
  }
  if (a.source?.kind === "ram") {
    playSound("swing-heavy");
    return;
  }
  if (a.isRanged) {
    const bolt = a.skill === "crossbow";
    const thrown = a.skill === "athletics";
    playSound(bolt ? "crossbow" : thrown ? "swing" : "bow");
    if (!from) return;
    for (const t of targets) show(bolt ? "bolt" : "arrow", { at: attacker, to: t }, () => S.projectile(from, S.pointOf(t)));
    return;
  }
  playSound(a.attackType === "strong" || a.attackType === "charge" ? "swing-heavy" : "swing");
}

/* ---------------------------------------------------------------- Защита: попал или нет */

function onDefense(d) {
  const at = tokenOf(d.defender);
  const attacker = tokenOf(d.attack?.attacker);
  const to = S.pointOf(at);
  const from = S.pointOf(attacker);
  const spell = d.attack?.spell;
  if (d.roll?.fumble && !d.hit) playSound("fumble", { delay: 200 });
  if (d.hit) {
    const crit = !!d.critLevel;
    if (spell) {
      const color = ELEMENT_COLORS[spell.element] ?? ELEMENT_COLORS.mixed;
      if (!d.attack.noDamage) playSound(crit ? "hit-crit" : "hit", { volume: 0.8 });
      show("arcaneBurst", { at, scaleToObject: 1.4 }, () => S.impact(to, { color, scale: crit ? 1.4 : 1 }));
    } else if (d.attack?.isRanged) {
      playSound(crit ? "hit-crit" : "hit");
      show("impact", { at, scaleToObject: 1.3 }, () => S.impact(to, { scale: crit ? 1.4 : 1 }));
    } else {
      playSound(crit ? "hit-crit" : "hit");
      const heavy = d.attack?.attackType === "strong" || d.attack?.attackType === "charge";
      show(heavy || crit ? "slashHeavy" : "slash", { at, rotateTowards: attacker ?? undefined, scaleToObject: 1.6 },
        () => S.slash(to, from, { heavy: heavy || crit }));
    }
    if (crit && sceneOn() && to) S.floatText(to, d.critLabel || "Критическое!", 0xff9a7a);
    return;
  }
  const kind = d.defense;
  if (kind === "block" || kind === "parry" || kind === "brawlBlock") {
    playSound(kind === "parry" ? "parry" : "block");
    show("sparks", { at, scaleToObject: 1 }, () => S.sparks(to, from));
    if (sceneOn() && to) S.floatText(to, kind === "parry" ? "Парирование" : "Блок", 0xe8c97a);
    return;
  }
  playSound("miss");
  if (sceneOn() && to) {
    S.whoosh(to, from);
    S.floatText(to, kind === "dodge" ? "Уклонение" : "Промах", 0xdcecff);
  }
}

/* ---------------------------------------------------------------- Магия */

/** Знак по названию; прочее — по стихии. */
function signOf(label = "") {
  const n = label.toLowerCase();
  if (n.includes("аард")) return "aard";
  if (n.includes("игни")) return "igni";
  if (n.includes("квен")) return "quen";
  if (n.includes("акси")) return "axii";
  if (n.includes("ирден")) return "yrden";
  return null;
}

function onCast(f) {
  const a = f.attack;
  const caster = tokenOf(a.attacker);
  const from = S.pointOf(caster);
  if (!f.cast?.works) {
    playSound("ui-fail");
    if (sceneOn() && from) S.fizzle(from, 0x9a8ac0);
    return;
  }
  const targets = (a.targets ?? []).map(tokenOf).filter(Boolean);
  const target = targets[0] ?? null;
  const zone = a.config?.zone ?? null;
  const s = canvas?.grid?.size ?? 100;
  // Направление конуса: зона, иначе первая цель, иначе взгляд токена
  const origin = zone ? { x: zone.x, y: zone.y } : from;
  let dir = 0;
  if (zone?.type === "cone") dir = Math.toRadians(zone.rotation ?? 0);
  else if (target && from) dir = Math.atan2(S.pointOf(target).y - from.y, S.pointOf(target).x - from.x);
  else if (caster) dir = Math.toRadians((caster.document.rotation ?? 0) + 90);
  const length = zone ? (zone.radius ?? 4 * s) / s : 4;
  const width = zone?.type === "cone" ? Math.toRadians(zone.angle ?? 53) : 0.9;
  const sign = signOf(a.label);
  const element = a.spell?.element;
  const color = ELEMENT_COLORS[element] ?? ELEMENT_COLORS.mixed;
  const toward = target ?? (origin ? { x: origin.x + Math.cos(dir) * length * s, y: origin.y + Math.sin(dir) * length * s } : null);

  switch (sign) {
    case "aard":
      playSound("aard");
      show("aard", { at: caster ?? origin, to: toward }, () => S.aard(origin, dir, length, width));
      return;
    case "igni":
      playSound("igni");
      show("igni", { at: caster ?? origin, to: toward }, () => S.igni(origin, dir, length, width));
      return;
    case "quen":
      playSound("quen");
      show("quen", { at: caster, scaleToObject: 1.8 }, () => S.quen(from));
      return;
    case "axii":
      playSound("axii");
      for (const t of targets.length ? targets : [caster]) show("axii", { at: t, scaleToObject: 1.5 }, () => S.axii(S.pointOf(t)));
      return;
    case "yrden": {
      playSound("yrden");
      const center = zone && zone.type !== "cone" ? { x: zone.x, y: zone.y } : from;
      show("yrden", { at: center, size: Math.max(2, length * 2) }, () => S.yrden(center, zone ? length : 1.3));
      return;
    }
  }
  playSound(element === "fire" ? "igni" : element === "air" ? "aard" : "spell", { volume: 0.8 });
  if (zone?.type === "cone") {
    if (element === "fire") show("igni", { at: caster ?? origin, to: toward }, () => S.igni(origin, dir, length, width));
    else show("aard", { at: caster ?? origin, to: toward }, () => S.aard(origin, dir, length, width));
    return;
  }
  if (zone) {
    show("explosion", { at: { x: zone.x, y: zone.y }, size: length * 2 }, () => S.explosion({ x: zone.x, y: zone.y }, length, color));
    return;
  }
  if (!targets.length) {
    show("arcaneBurst", { at: caster, scaleToObject: 1.6 }, () => S.arcane(from, null, color));
    return;
  }
  for (const t of targets) {
    show(element === "fire" ? "fire" : "arcane", { at: caster, to: t }, () => S.arcane(from, S.pointOf(t), color));
  }
}

/* ---------------------------------------------------------------- Алхимия */

function onAlchemy(al) {
  const fx = al.fx;
  if (!fx) return;
  const actor = fromUuidSync(al.actorUuid);
  const token = tokenOfActor(actor);
  const at = S.pointOf(token);
  switch (fx.kind) {
    case "drink":
    case "apply": {
      playSound(fx.kind === "drink" ? "drink" : "oil", { volume: fx.kind === "drink" ? 1 : 0.6 });
      const color = POTION_COLORS[fx.color] ?? (fx.kind === "apply" ? 0xe8c97a : 0x8fd27a);
      show("drink", { at: token, scaleToObject: 1.4 }, () => S.drink(at, color));
      return;
    }
    case "oil":
      playSound("oil");
      show("glint", { at: token, scaleToObject: 1.2 }, () => S.glint(at));
      return;
    case "bomb": {
      const z = fx.zone;
      const center = z ? { x: z.x, y: z.y } : at;
      const s = canvas?.grid?.size ?? 100;
      const radius = z?.radius ? z.radius / s : 1;
      const color = ELEMENT_COLORS[fx.element] ?? 0xff8a3a;
      playSound("bomb", { delay: 150 });
      if (at && center && sceneOn()) S.projectile(at, center, { color: 0xc9bdf0 });
      setTimeout(() => show("explosion", { at: center, size: radius * 2 }, () => S.explosion(center, radius, color)), 260);
      return;
    }
  }
}

/* ---------------------------------------------------------------- Карточки */

function onChatMessage(message) {
  if (!message.visible) return;
  const f = message.flags?.vedmak;
  if (!f) return;
  // Старые сообщения при загрузке чата сюда не попадают — только что созданные
  if (Date.now() - (message.timestamp ?? 0) > 15000) return;
  try {
    if (f.cast) return onCast(f);
    if (f.attack) return onAttack(f);
    if (f.defense) return onDefense(f.defense);
    if (f.alchemy) return onAlchemy(f.alchemy);
    if (f.save) return playSound(f.save.success ? "ui-success" : "ui-fail");
    // Проверки навыков: итог слышит только бросивший
    if (f.check && message.isAuthor) {
      const c = f.check;
      if (c.fumble) playSound("ui-fail", { delay: 500 });
      else if (c.crit) playSound("ui-crit", { delay: 500 });
      else if (c.success === true) playSound("ui-success", { delay: 500 });
      else if (c.success === false) playSound("ui-fail", { delay: 500 });
    }
  } catch (err) {
    console.warn("vedmak | эффект карточки", err);
  }
}

/* ---------------------------------------------------------------- ПЗ, Удача, смерть, ход */

// Значение до изменения уходит в опциях запроса — их получают все клиенты; запасной путь — свой кеш
const lastHp = new Map();

function onPreUpdateActor(actor, changes, options) {
  const hp = foundry.utils.getProperty(changes, "system.hp.value");
  if (hp !== undefined) options.vedmakHpBefore = actor.system.hp?.value;
  const luck = foundry.utils.getProperty(changes, "system.luck.value");
  if (luck !== undefined) options.vedmakLuckBefore = actor.system.luck?.value;
}

function onUpdateActor(actor, changes, options) {
  const hp = foundry.utils.getProperty(changes, "system.hp.value");
  if (hp !== undefined) {
    const before = options.vedmakHpBefore ?? lastHp.get(actor.uuid);
    lastHp.set(actor.uuid, hp);
    if (typeof before === "number" && hp < before) {
      const token = tokenOfActor(actor);
      if (token && sceneOn()) {
        const lost = before - hp;
        const scale = Math.min(1.8, 0.7 + lost / Math.max(10, actor.system.hp.max ?? 30));
        show("blood", { at: token, scaleToObject: 1.2 }, () => S.blood(S.pointOf(token), null, { scale }));
      }
    }
  }
  const luck = foundry.utils.getProperty(changes, "system.luck.value");
  if (luck !== undefined && actor.isOwner && typeof options.vedmakLuckBefore === "number" && luck < options.vedmakLuckBefore) {
    playSound("ui-coin");
  }
}

// «При смерти» приходит пачкой эффектов (состояние и его спутники) — колокол один раз на персонажа за 3 с
const lastDeath = new Map();

function onCreateEffect(effect) {
  const actor = effect.parent;
  if (actor?.documentName !== "Actor") return;
  if (!effect.statuses?.has?.("dying") && !effect.statuses?.has?.("dead")) return;
  const now = Date.now();
  if (now - (lastDeath.get(actor.uuid) ?? 0) < 3000) return;
  lastDeath.set(actor.uuid, now);
  const token = tokenOfActor(actor);
  if (!token && !actor.isOwner) return;
  playSound("death");
  if (token) show("death", { at: token, scaleToObject: 1.6 }, () => S.death(S.pointOf(token)));
}

function onUpdateCombat(combat, changes) {
  if (!("turn" in changes) && !("round" in changes)) return;
  const c = combat.combatant;
  // Колокол «твой ход» — игроку, чей персонаж ходит (ведущему он звенел бы на каждом ходу чудовищ)
  if (c?.actor?.isOwner && !game.user.isGM) playSound("ui-turn");
}

/* ---------------------------------------------------------------- Интерфейс */

const CLICKABLE = [
  ".vedmak-hud button", ".vedmak-hud a[data-action]",
  ".vedmak-dialog .form-footer button",
  ".application.vedmak nav.tabs a", ".application.vedmak nav.sheet-tabs a",
  ".application.vedmak .vh-switch a", ".application.vedmak [data-action='tab']"
].join(", ");

function onClick(event) {
  if (event.button !== 0 || !setting("fxUi", true)) return;
  if (event.target.closest?.(CLICKABLE)) playSound("ui-click");
}

/** Класс на body: анимации интерфейса выключены (настройка или «меньше движения» в системе). */
function applyUiMotion() {
  const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  document.body.classList.toggle("vd-no-anim", !setting("fxUi", true) || !!reduce);
}

/** Новая карточка — въезжает, кольцо медальона прокручивается. Только у только что созданных. */
function onRenderMessage(message, html) {
  if (!setting("fxUi", true) || !message.flags?.vedmak) return;
  if (Date.now() - (message.timestamp ?? 0) > 4000) return;
  const el = html instanceof HTMLElement ? html : html?.[0];
  if (!el) return;
  el.classList.add("vd-new");
  setTimeout(() => el.classList.remove("vd-new"), 1600);
}

/* ---------------------------------------------------------------- Регистрация */

export function registerFxSettings() {
  game.settings.register(SYSTEM_ID, "fxSound", {
    scope: "client", config: true,
    name: "Звуки", hint: "Удары, блоки, знаки, зелья и взрывы, звон Удачи, колокол «твой ход». Звуки синтезированы для системы.",
    type: Boolean, default: true
  });
  game.settings.register(SYSTEM_ID, "fxVolume", {
    scope: "client", config: true,
    name: "Громкость звуков", hint: "Доля громкости звуков системы (умножается на громкость интерфейса Foundry).",
    type: Number, default: 0.7, range: { min: 0, max: 1, step: 0.05 }
  });
  game.settings.register(SYSTEM_ID, "fxScene", {
    scope: "client", config: true,
    name: "Анимации на сцене", hint: "Взмахи, стрелы, искры блока, кровь, знаки, взрывы бомб. Видит каждый у себя.",
    type: Boolean, default: true
  });
  game.settings.register(SYSTEM_ID, "fxJB2A", {
    scope: "client", config: true,
    name: "Анимации JB2A", hint: "Если включены модули Sequencer и JB2A — брать их анимации; чего у них нет, рисуется своим.",
    type: Boolean, default: true
  });
  game.settings.register(SYSTEM_ID, "fxUi", {
    scope: "client", config: true,
    name: "Оживший интерфейс", hint: "Щелчки кнопок, звуки итога проверки, въезд карточек чата и прокрутка медальона.",
    type: Boolean, default: true, onChange: applyUiMotion
  });
}

export function registerFx() {
  Hooks.on("createChatMessage", onChatMessage);
  Hooks.on("preUpdateActor", onPreUpdateActor);
  Hooks.on("updateActor", onUpdateActor);
  Hooks.on("createActiveEffect", onCreateEffect);
  Hooks.on("updateCombat", onUpdateCombat);
  Hooks.on("renderChatMessageHTML", onRenderMessage);
  Hooks.once("ready", () => {
    applyUiMotion();
    preloadSounds();
    document.addEventListener("click", onClick, true);
    for (const actor of game.actors) if (actor.system?.hp) lastHp.set(actor.uuid, actor.system.hp.value);
    if (game.user.isGM && setting("fxJB2A", true) && game.modules.get("sequencer")?.active && !jb2aReady()) {
      console.info("vedmak | Sequencer включён, но JB2A нет — анимации системы рисуются своими.");
    }
  });
}
