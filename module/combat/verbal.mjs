// Словесная дуэль (корник стр. 176–177): Решительность вместо ПЗ, эмпатические и антагонистические
// атаки, защиты и рычаги давления. Проведение как у боя: у кого результат больше, тот и наносит урон
// Решительности противнику; при успешной защите урон получает атакующий.

import { SKILLS } from "../config/skills.mjs";
import { STATS } from "../config/stats.mjs";
import { performCheck } from "../dice/check.mjs";
import { rollDialog } from "../dice/roll-dialog.mjs";
import { statusRollMods } from "./statuses.mjs";
import { asGM, registerGMHandler, resolveActor, postCard, rollFormula, fallbackDefender } from "./common.mjs";
import { registerChatAction } from "./chat.mjs";

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
        base: Math.max(0, duelParts(actor, a).reduce((sum, p) => sum + (Number(p.value) || 0), 0)),
        damageLabel: damageText(actor, a)
      }))
    }))
  };
}

/**
 * Действие словесной дуэли: окно броска, проверка навыка, урон Решительности, карточка.
 * @param {Actor} actor
 * @param {string} key — ключ действия из VERBAL_GROUPS
 * @param {object} [opts] — {skipDialog}
 */
export async function verbalAction(actor, key, { skipDialog = false } = {}) {
  const def = ACTIONS[key];
  if (!def) return null;
  const parts = duelParts(actor, def);
  const optional = actor.socialParts?.(def.skill) ?? [];
  let choice = { mod: 0, damageMod: 0, luck: 0, messageMode: undefined, optional: optional.filter(o => o.checked) };
  if (!skipDialog) {
    choice = await rollDialog({
      title: `${def.label} · словесная дуэль`, parts, luckMax: actor.luckAvailable ?? 0, optional,
      damage: damageText(actor, def)
    });
    if (!choice) return null;
  }
  parts.push(...choice.optional);
  if (choice.mod) parts.push({ label: "Модификатор", value: choice.mod });
  const roll = await performCheck({ actor, title: def.label, parts, luck: choice.luck, toChat: false });

  let damage = null;
  const rolls = [...(roll.rolls ?? [])];
  if (def.damage) {
    const s = actor.system.stats;
    let formula = def.damage;
    if (choice.damageMod) formula = `${formula} ${choice.damageMod > 0 ? "+" : "-"} ${Math.abs(choice.damageMod)}`;
    const res = await rollFormula(formula, { emp: s.emp.effective, int: s.int.effective, will: s.will.effective });
    if (res.roll) rolls.push(res.roll);
    damage = { total: Math.max(0, res.total), formula: damageText(actor, def) + (choice.damageMod ? ` ${choice.damageMod > 0 ? "+" : "−"} ${Math.abs(choice.damageMod)}` : "") };
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

/** Снять Решительность у актора (от имени ведущего, если актор чужой). */
async function applyResolve({ uuid, amount }) {
  const actor = resolveActor(uuid);
  if (!actor) return null;
  const { value, max } = currentResolve(actor);
  const next = Math.max(0, value - amount);
  await actor.setFlag("vedmak", "duelResolve", next);
  return { name: actor.name, from: value, to: next, max };
}
registerGMHandler("applyResolve", applyResolve);

/** Кнопка карточки: урон Решительности выбранной цели (цель или выделенный токен). */
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
  await asGM("applyResolve", { uuid, amount: v.damage });
  ui.notifications.info(`${actor.name}: Решительность ${value} → ${next}${next <= 0 ? " — проигрывает дуэль" : ""}.`);
  return null;
});
