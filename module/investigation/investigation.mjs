// Расследование («Журнал ведьмака», стр. 145–151) — логика. Окно — module/apps/investigation-app.mjs,
// справочники — config/investigation.mjs.
//
// Тайны лежат в настройке мира `mysteries` (пишет только ведущий). Игрок проверяет улику своим персонажем:
// бросок навыка — у себя (окно с модификаторами и Удачей), итог — ведущему по сокету; ведущий сверяет его со СЛ
// улики, бросает урон Сложности или урон Фокусу и пишет карточку в чат. Фокус персонаж восстанавливает сном сам.

import { CLUE_TYPES, MYSTERY_DIFFICULTY, DEDUCTION_HINT } from "../config/investigation.mjs";
import { SKILLS } from "../config/skills.mjs";
import { asGM, registerGMHandler, resolveActor, userOwnsAny } from "../combat/common.mjs";
import { postCard } from "../util.mjs";

const SYS = "vedmak";
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/** Включено ли правило расследования (настройка мира). */
export const investigationOn = () => !!game.settings.get(SYS, "investigation");

/** Тайны мира (копия — правится и сохраняется целиком). */
export function mysteries() {
  try { return foundry.utils.deepClone(game.settings.get(SYS, "mysteries")?.list ?? []); } catch { return []; }
}

/** Сохранить тайны (только ведущий). */
export async function saveMysteries(list) {
  if (!game.user.isGM) return;
  await game.settings.set(SYS, "mysteries", { list });
}

/** Новая тайна по сложности. */
export function newMystery(difficulty = "average") {
  const c = MYSTERY_DIFFICULTY[difficulty]?.complexity ?? 50;
  return {
    id: foundry.utils.randomID(), goal: "Новая тайна", difficulty, complexity: { value: c, max: c },
    clues: [], participants: [], deadline: "", notes: "", visible: false, solved: false
  };
}

/** Новая улика. */
export function newClue() {
  return { id: foundry.utils.randomID(), name: "Улика", type: "scene", dc: 14, obf: 0, revealed: false, found: false, damaged: false };
}

/** Фокус персонажа: {value, max}. У чудовищ Фокуса нет. */
export function focusOf(actor) {
  const f = actor?.system?.focus;
  return f ? { value: f.value ?? 0, max: f.max ?? 0, lost: f.lost ?? 0 } : null;
}

/** Изменить Фокус: delta < 0 — урон, > 0 — восстановление (в пределах 0…максимум). */
async function changeFocus(actor, delta) {
  const f = focusOf(actor);
  if (!f) return null;
  const lost = Math.max(0, Math.min(f.max, f.lost - delta));
  await actor.update({ "system.focus.lost": lost });
  return Math.max(0, f.max - lost);
}

/** Персонаж, которым действует пользователь: назначенный, иначе выделенный свой токен. */
export function actingActor() {
  const own = game.user.character;
  if (own) return own;
  const token = canvas?.tokens?.controlled?.find(t => t.actor?.isOwner && t.actor.type === "character");
  return token?.actor ?? null;
}

/** Навыки улики для выбора: ключ → подпись. Определяющий навык профессии — всегда можно (стр. 148). */
export function clueSkills(actor, typeKey) {
  const type = CLUE_TYPES[typeKey];
  const out = [];
  for (const key of type?.skills ?? []) {
    if (key === "defining") continue;
    if (SKILLS[key]) out.push({ key, label: SKILLS[key].label });
  }
  const ds = actor?.system?.profession?.system.definingSkill;
  if (ds?.name) out.push({ key: "defining", label: `${ds.name} (определяющий навык)` });
  return out;
}

/* ---------------------------- Проверка улики ---------------------------- */

/**
 * Проверка улики персонажем: окно выбора навыка и лишнего времени, бросок у себя, итог — ведущему.
 */
export async function evidenceCheck(actor, mysteryId, clueId) {
  const m = mysteries().find(x => x.id === mysteryId);
  const clue = m?.clues.find(c => c.id === clueId);
  if (!m || !clue || !actor) return null;
  if (clue.found) return ui.notifications.info(`Улика «${clue.name}» уже разгадана.`);
  const focus = focusOf(actor);
  if (!focus) return ui.notifications.warn("Расследуют персонажи — у чудовищ нет Фокуса.");
  if (focus.value <= 0) return ui.notifications.warn(`${actor.name}: Фокус 0 — мысли путаются, проверять улики нельзя, пока не выспится.`);
  const type = CLUE_TYPES[clue.type] ?? CLUE_TYPES.scene;
  const skills = clueSkills(actor, clue.type);
  if (!skills.length) return ui.notifications.warn("Для этой улики у персонажа нет подходящего навыка.");
  const content = `<div class="vedmak-roll-dialog investigation-check">
    <p><b>${esc(clue.name)}</b> — ${esc(type.label)}. ${esc(type.example)}.</p>
    <div class="form-group"><label>Навык</label><select name="skill">${skills.map(s => `<option value="${s.key}">${esc(s.label)}</option>`).join("")}</select></div>
    ${type.time ? `<div class="form-group"><label>Лишнее время</label><select name="time">
      <option value="0">Нет</option><option value="1">+1 отрезок (+1)</option><option value="2">+2 отрезка (+2)</option><option value="3">+3 отрезка (+3)</option>
    </select></div><p class="hint">Каждый лишний отрезок, равный обычному времени проверки, — +1 к проверке и к урону улики (до +3).</p>` : ""}
    ${clue.damaged ? `<p class="hint warn">Улика повреждена: −5 к проверке.</p>` : ""}
  </div>`;
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: `Улика: ${clue.name}` }, classes: ["vedmak", "vedmak-dialog"], content,
    buttons: [{ action: "ok", label: "Проверить", default: true,
      callback: (e, b) => ({ skill: b.form.elements.skill.value, time: Number(b.form.elements.time?.value) || 0 }) },
      { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  if (!choice || choice === "cancel") return null;
  const extraParts = [];
  if (choice.time) extraParts.push({ label: "Лишнее время", value: choice.time });
  if (clue.damaged) extraParts.push({ label: "Улика повреждена", value: -5 });
  const subtitle = `Улика: ${clue.name} · ${type.label}`;
  const result = choice.skill === "defining"
    ? await actor.rollDefining({ subtitle })
    : await actor.rollSkill(choice.skill, { subtitle, extraParts });
  if (!result) return null;
  // Определяющий навык бросается без лишних слагаемых — поправки прибавляем к итогу здесь
  const total = result.total + (choice.skill === "defining" ? extraParts.reduce((s, p) => s + p.value, 0) : 0);
  return asGM("invEvidence", {
    mysteryId, clueId, actorUuid: actor.uuid, total, fumble: !!result.fumble, time: choice.time
  });
}

registerGMHandler("invEvidence", async ({ mysteryId, clueId, actorUuid, total, fumble, time }, userId) => {
  const actor = resolveActor(actorUuid);
  if (!actor || !userOwnsAny(userId, actor)) return console.warn(`vedmak | отклонена проверка улики от ${game.users.get(userId)?.name ?? userId}`);
  const list = mysteries();
  const m = list.find(x => x.id === mysteryId);
  const clue = m?.clues.find(c => c.id === clueId);
  if (!m || !clue || clue.found || m.solved) return;
  const type = CLUE_TYPES[clue.type] ?? CLUE_TYPES.scene;
  const t = type.time ? Math.max(0, Math.min(3, Number(time) || 0)) : 0;
  const lines = [];
  const rolls = [];
  if (Number(total) > clue.dc) {
    // Урон Сложности = бросок улики + параметр (+ лишнее время) − Запутанность, не меньше 1 (стр. 148)
    const statValue = actor.system.stats?.[type.stat]?.total ?? 0;
    const roll = await new Roll(`${type.damage} + ${statValue}${t ? ` + ${t}` : ""}`).evaluate();
    rolls.push(roll);
    const dmg = Math.max(1, roll.total - (Number(clue.obf) || 0));
    m.complexity.value = Math.max(0, m.complexity.value - dmg);
    clue.found = true;
    clue.revealed = true;
    lines.push(`<p><b>Улика разгадана.</b> Сложность −${dmg} (${roll.total}${clue.obf ? ` − Запутанность ${clue.obf}` : ""}): `
      + `<b>${m.complexity.value} / ${m.complexity.max}</b>.</p>`);
    if (!m.complexity.value) lines.push("<p><b>Улик достаточно — тайну можно раскрыть.</b></p>");
  } else {
    const roll = await new Roll(type.focus).evaluate();
    rolls.push(roll);
    const left = await changeFocus(actor, -roll.total);
    lines.push(`<p><b>Улика не далась.</b> Фокус −${roll.total}: ${left} / ${focusOf(actor).max}.${left === 0 ? " Мысли путаются — до сна улики не проверить." : ""}</p>`);
    if (fumble && type.fumble) {
      lines.push(`<p class="bad-inline">Критический провал: ${esc(type.fumble)}</p>`);
      if (clue.type === "analysis" || clue.type === "body") clue.damaged = true;
    }
  }
  await saveMysteries(list);
  await postCard(actor, `${esc(m.goal)}: ${esc(clue.name)}`, lines.join(""),
    { subtitle: `${actor.name} · ${type.label}`, icon: "fa-solid fa-magnifying-glass", rolls, messageMode: "public" });
});

/* ------------------------- Подсказка Дедукцией ------------------------- */

/** Застряли — Дедукция СЛ 15: при успехе ведущий даёт подсказку; Фокус −1d6 в любом случае (стр. 148). */
export async function deductionHint(actor, mysteryId) {
  const m = mysteries().find(x => x.id === mysteryId);
  if (!m || !actor) return null;
  const result = await actor.rollSkill("deduction", { subtitle: `Подсказка: ${m.goal}`, dc: DEDUCTION_HINT.dc });
  if (!result) return null;
  return asGM("invHint", { mysteryId, actorUuid: actor.uuid, success: !!result.success });
}

registerGMHandler("invHint", async ({ mysteryId, actorUuid, success }, userId) => {
  const actor = resolveActor(actorUuid);
  if (!actor || !userOwnsAny(userId, actor)) return;
  const m = mysteries().find(x => x.id === mysteryId);
  if (!m) return;
  const roll = await new Roll(DEDUCTION_HINT.focus).evaluate();
  const left = await changeFocus(actor, -roll.total);
  await postCard(actor, `${esc(m.goal)}: подсказка`,
    `<p>${success ? "<b>Ведущий даёт подсказку</b>, куда двигаться дальше." : "Подсказки нет — мысль ускользнула."} `
    + `Фокус −${roll.total}: ${left} / ${focusOf(actor).max}.</p>`,
    { subtitle: `${actor.name} · Дедукция`, icon: "fa-solid fa-lightbulb", rolls: [roll], messageMode: "public" });
});

/* -------------------------------- Помеха -------------------------------- */

/**
 * Помеха (ведущий): один участник проходит проверку против СЛ; успех — все участники дня −2 Фокуса, провал —
 * −(1d6 + 2), критический провал — бросавший ещё −3 (стр. 150).
 */
export async function obstacle(mysteryId, { actor, skill, dc, kind }) {
  if (!game.user.isGM) return null;
  const m = mysteries().find(x => x.id === mysteryId);
  if (!m || !actor) return null;
  const result = await actor.rollSkill(skill, { subtitle: `Помеха: ${kind}`, dc });
  if (!result) return null;
  const rolls = [];
  let loss = 2;
  if (!result.success) {
    const r = await new Roll("1d6 + 2").evaluate();
    rolls.push(r);
    loss = r.total;
  }
  const rows = [];
  for (const uuid of m.participants) {
    const p = resolveActor(uuid);
    if (!focusOf(p)) continue;
    const extra = p === actor && result.fumble ? 3 : 0;
    const left = await changeFocus(p, -(loss + extra));
    rows.push(`<li>${esc(p.name)}: −${loss + extra} → ${left} / ${focusOf(p).max}</li>`);
  }
  return postCard(null, `${esc(m.goal)}: помеха`,
    `<p><b>${esc(kind)}</b> — ${result.success ? "справились, но время ушло" : "помеха выбила из колеи"}.</p><ul>${rows.join("")}</ul>`,
    { icon: "fa-solid fa-road-barrier", rolls, messageMode: "public" });
}

/* --------------------------------- Сон --------------------------------- */

/** Сон (не меньше 6 часов): Фокус + Воля, ещё +1 при Дедукции 5+, +2 при 8+ (стр. 151). */
export async function restFocus(actor) {
  const f = focusOf(actor);
  if (!f) return null;
  const will = actor.system.stats.will.total;
  const ded = actor.system.skills.deduction?.value ?? 0;
  const gain = will + (ded >= 8 ? 2 : ded >= 5 ? 1 : 0);
  const left = await changeFocus(actor, gain);
  return postCard(actor, "Сон: Фокус восстановлен",
    `<p>+${gain} (Воля ${will}${ded >= 5 ? `, Дедукция ${ded}` : ""}): <b>${left} / ${f.max}</b>.</p>`,
    { icon: "fa-solid fa-bed" });
}

/** Ведущий меняет Фокус вручную. */
export async function setFocus(actor, value) {
  const f = focusOf(actor);
  if (!f || !actor.isOwner) return;
  await actor.update({ "system.focus.lost": Math.max(0, Math.min(f.max, f.max - (Number(value) || 0))) });
}

