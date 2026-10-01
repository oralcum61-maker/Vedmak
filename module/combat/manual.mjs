// Урон без атаки (падение, бомба, ловушка, огонь) и отдых/лечение (стр. 154, 165, 171, 173–174).

import { LOCATIONS_HUMANOID, LOCATIONS_MONSTER, HEALING_DAYS } from "../config/combat.mjs";
import { bindDialog, commonFields } from "../dice/dialog-ui.mjs";
import { renderTemplate } from "../util.mjs";
import { postCard, rollFormula, asGM, registerGMHandler, resolveActor, userOwnsAny, doneKey } from "./common.mjs";
import { applyDamageToActor } from "./damage.mjs";
import { STATUS_EFFECTS } from "./statuses.mjs";

const DAMAGE_STATUSES = ["burning", "poisoned", "bleeding", "frozen", "disoriented", "blind", "prone", "suffocating", "nauseated", "intoxicated", "hallucinating"];

/**
 * Нанести урон актёрам без броска атаки.
 * @param {Actor[]} actors
 * @param {object} [preset] — начальные значения окна: formula, reason, damageType, where, status, statusChance,
 *   statusRounds, ignoreArmor, nonLethal (бомбы и ловушки подставляют свои)
 */
export async function manualDamage(actors, preset = {}) {
  actors = actors.filter(Boolean);
  if (!actors.length) return ui.notifications.warn("Выберите, кому нанести урон.");
  const content = await renderTemplate("systems/vedmak/templates/dialog/manual-damage.hbs", {
    preset: { formula: "2d6", reason: "", damageType: "bludgeoning", where: "torso", status: "", statusChance: 100,
      statusRounds: "", ignoreArmor: false, nonLethal: false, ...preset },
    names: actors.map(a => a.name).join(", "),
    head: {
      title: "Урон без атаки", noBase: true,
      subtitle: `Кому: ${actors.map(a => a.name).join(", ")}`
    },
    damageTypes: CONFIG.VEDMAK.DAMAGE_TYPES,
    locations: LOCATIONS_HUMANOID,
    statuses: STATUS_EFFECTS.filter(s => DAMAGE_STATUSES.includes(s.id)),
    ...commonFields()
  });
  const cfg = await foundry.applications.api.DialogV2.wait({
    window: { title: "Урон без атаки", icon: "fa-solid fa-burst" },
    classes: ["vedmak", "vedmak-dialog", "check-dialog", "damage-dialog"],
    position: { width: 520 },
    content,
    buttons: [{
      action: "apply", label: "Нанести", icon: "fa-solid fa-burst", default: true,
      callback: (event, button) => {
        const f = button.form.elements;
        return {
          formula: f.formula.value.trim(), reason: f.reason.value.trim(), damageType: f.damageType.value,
          where: f.where.value, ignoreArmor: f.ignoreArmor.checked, nonLethal: f.nonLethal.checked,
          status: f.status.value, statusChance: Math.max(0, Math.min(100, Number(f.statusChance.value) || 100)),
          statusRounds: f.statusRounds.value.trim(), messageMode: f.messageMode?.value || "public"
        };
      }
    }, { action: "cancel", label: "Отмена", icon: "fa-solid fa-xmark" }],
    rejectClose: false
  });
  if (!cfg || cfg === "cancel" || (!cfg.formula && !cfg.status)) return null;

  // Один бросок на всех: бомба или ловушка бьёт всех в зоне одинаково
  const { roll, total } = await rollFormula(cfg.formula);
  const results = [];
  const applies = [];
  for (const actor of actors) {
    const data = await computeManual(actor, { ...cfg, total });
    results.push(data);
    applies.push({ uuid: actor.token?.uuid ?? actor.uuid, data });
  }
  // Сначала карточка, потом применение: по карточке ведущий проверяет, что игрок вправе бить именно эти цели
  // (бомбу бросает игрок, а цели — чужие токены). Автор карточки — настоящий отправитель, от сервера Foundry
  const card = await postCard({
    template: "systems/vedmak/templates/chat/manual-damage.hbs",
    data: { ...cfg, total, results, statusLabel: CONFIG.statusEffects[cfg.status]?.name ?? "" },
    // «Себе» у игрока спрятало бы карточку и от ведущего, а он по ней проверяет запрос: игроку — «Ведущему»
    actor: null, rolls: roll ? [roll] : [], messageMode: !game.user.isGM && cfg.messageMode === "self" ? "gm" : cfg.messageMode,
    flags: { manualDamage: { total, targets: applies.map(a => a.uuid) } }
  });
  if (!card) return null;
  for (const a of applies) await asGM("applyManualDamage", { ...a, messageId: card.id });
  return card;
}

/** Урон по одной или всем частям тела с бронёй, сопротивлениями и множителями. */
async function computeManual(actor, { total, damageType, where, ignoreArmor, nonLethal, status, statusChance = 100, statusRounds = "" }) {
  const sys = actor.system;
  const d = sys.derived;
  const table = d.bodyType === "monster" ? LOCATIONS_MONSTER : LOCATIONS_HUMANOID;
  let keys;
  if (where === "all") keys = Object.keys(table);
  else if (where === "roll" || !table[where]) {
    const r = Math.ceil(Math.random() * 10);
    keys = [Object.entries(table).find(([, l]) => r >= l.roll[0] && r <= l.roll[1])[0]];
  } else keys = [where];

  const rows = [];
  const wear = [];
  let final = 0;
  for (const key of keys) {
    const loc = d.armor?.[key] ?? { sp: 0, resist: [] };
    const sp = ignoreArmor ? 0 : loc.sp;
    const after = Math.max(0, total - sp);
    let mult = 1;
    if ((!ignoreArmor && loc.resist?.includes(damageType)) || sys.resistances?.includes?.(damageType)) mult *= 0.5;
    if (sys.susceptibilities?.includes?.(damageType)) mult *= 2;
    if (sys.immunities?.includes?.(damageType)) mult = 0;
    const locMult = key === "head" ? Math.max(table[key].mult, d.headMult ?? 3) : table[key].mult;
    const value = Math.floor(after * mult * locMult);
    final += value;
    if (after > 0 && loc.sp > 0 && !ignoreArmor) wear.push({ location: key, amount: 1 });
    rows.push({ label: table[key].label, sp, locMult, mult, value });
  }
  const effects = [];
  if (status) {
    const label = CONFIG.statusEffects[status]?.name ?? status;
    if (statusChance >= 100) effects.push({ success: true, status, label, rounds: statusRounds });
    else {
      const r = await new Roll("1d100").evaluate();
      effects.push({ success: r.total <= statusChance, status, rounds: statusRounds,
        label: `${label}: ${r.total} ${r.total <= statusChance ? "≤" : ">"} ${statusChance}%` });
    }
  }
  return { name: actor.name, rows, final, nonLethal, wear, effects, crit: null, stunSave: null };
}

/** Применения, которые идут прямо сейчас (по карточке и цели): второй такой же запрос не должен ударить ещё раз. */
const applyingManual = new Set();

registerGMHandler("applyManualDamage", async ({ uuid, data, messageId }, userId) => {
  const actor = resolveActor(uuid);
  if (!actor || !data || typeof data !== "object") return;
  let key = null;
  if (!userOwnsAny(userId, actor)) {
    // Чужая цель (бомба, ловушка): только по карточке, которую создал сам отправитель, с этой целью в списке,
    // и один раз на цель
    const card = game.messages.get(messageId);
    const flag = card?.flags.vedmak?.manualDamage;
    key = `${messageId}|${uuid}`;
    if (!flag?.targets?.includes(uuid) || card.author?.id !== userId
      || flag.applied?.[doneKey(uuid)] || applyingManual.has(key)) {
      return console.warn(`vedmak | отклонён урон без атаки от ${game.users.get(userId)?.name ?? userId}`);
    }
    applyingManual.add(key);
    try {
      await card.update({ [`flags.vedmak.manualDamage.applied.${doneKey(uuid)}`]: true });
    } catch (err) {
      applyingManual.delete(key);
      throw err;
    }
  }
  try {
    await applyDamageToActor(actor, data);
  } finally {
    if (key) applyingManual.delete(key);
  }
});

/* -------------------------------------------------------------------------- */
/*  Отдых и лечение                                                           */
/* -------------------------------------------------------------------------- */

/** Действие «Отдых» (полный ход): восстановить Вын, равную Отдыху (стр. 151). */
export async function restTurn(actor) {
  const sys = actor.system;
  const value = Math.min(sys.sta.max, sys.sta.value + sys.derived.rec);
  await actor.update({ "system.sta.value": value });
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="vedmak-card turn"><header class="card-head"><span class="card-glyph"><i class="fa-solid fa-lungs"></i></span>`
      + `<div class="card-ident"><span class="card-name">Отдых</span><span class="card-sub">полный ход</span></div>`
      + `<div class="card-value"><b>+${value - sys.sta.value}</b><span class="cap">Вын</span></div></header>`
      + `<div class="card-body"><p class="note">${actor.name} переводит дух: Вын ${sys.sta.value} → ${value}.</p></div></div>`
  });
}

/**
 * Дни отдыха (стр. 173–174): с уходом (Первая помощь или Лечащее прикосновение СЛ 14) — Отдых ПЗ в день,
 * при нагрузке ½; Лечащее прикосновение +3 ПЗ в день. Вылеченные ранения отсчитывают дни до снятия штрафов.
 */
export async function restDays(actor) {
  const content = `<div class="vedmak-roll-dialog rest">
    <header class="dlg-head">
      <div class="dlg-ident">
        <span class="dlg-title">Дни отдыха</span>
        <span class="dlg-sub">${actor.name} · Отдых ${actor.system.derived.rec} ПЗ в день</span>
      </div>
      <div class="dlg-base"><span class="cap">ДНЕЙ</span><b data-rest-days>1</b></div>
    </header>
    <div class="dlg-body">
      <div class="dlg-row">
        <label class="num"><span class="cap">дней</span><input type="number" name="days" value="1" min="1"></label>
        <span class="hint grow">Без ухода ПЗ естественным путём не восстанавливаются. Вын восстанавливается полностью.</span>
      </div>
      <label class="plate"><input type="checkbox" name="care" checked>
        <span class="plate-text">Уход: Первая помощь или Лечащее прикосновение</span><b class="plate-value">СЛ 14</b></label>
      <label class="plate"><input type="checkbox" name="touch">
        <span class="plate-text">Лечащее прикосновение</span><b class="plate-value">+3 ПЗ в день</b></label>
      <label class="plate"><input type="checkbox" name="exertion">
        <span class="plate-text">Нагрузка: бег, работа, бой</span><b class="plate-value">½ Отдыха</b></label>
    </div></div>`;
  const cfg = await foundry.applications.api.DialogV2.wait({
    window: { title: `Отдых: ${actor.name}`, icon: "fa-solid fa-bed" },
    classes: ["vedmak", "vedmak-dialog", "check-dialog"],
    position: { width: 460 },
    content,
    render: (event, dialog) => bindDialog(dialog, {
      extra: form => {
        const out = dialog.element.querySelector("[data-rest-days]");
        if (out) out.textContent = String(Math.max(1, Number(form.elements.days.value) || 1));
      }
    }),
    buttons: [{ action: "ok", label: "Отдохнуть", icon: "fa-solid fa-bed", default: true,
      callback: (e, b) => {
        const f = b.form.elements;
        return { days: Math.max(1, Number(f.days.value) || 1), care: f.care.checked, touch: f.touch.checked, exertion: f.exertion.checked };
      } },
    { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  if (!cfg || cfg === "cancel") return null;

  const sys = actor.system;
  const lines = [];
  let perDay = 0;
  if (cfg.care) {
    perDay = cfg.exertion ? Math.floor(sys.derived.rec / 2) : sys.derived.rec;
    if (cfg.touch) perDay += 3;
  }
  const hp = Math.min(sys.hp.max, sys.hp.value + perDay * cfg.days);
  await actor.update({ "system.hp.value": hp, "system.sta.value": sys.sta.max });
  lines.push(cfg.care ? `ПЗ ${sys.hp.value} → ${hp} (${perDay} в день × ${cfg.days}).` : "Без ухода ПЗ не восстановились.");
  lines.push(`Вын восстановлена: ${sys.sta.max}.`);

  // Вылеченные ранения: дни до снятия штрафов (смертельные — навсегда)
  const done = [];
  for (const wound of actor.itemTypes.critWound ?? []) {
    if (wound.system.state !== "treated" || wound.system.level === "deadly") continue;
    let days = wound.system.healingDays;
    if (!days) {
      const body = Math.max(3, Math.min(13, sys.stats.body.raw));
      days = HEALING_DAYS[body][["simple", "complex", "difficult"].indexOf(wound.system.level)] ?? 0;
    }
    const left = days - cfg.days;
    if (left <= 0) done.push(wound);
    else {
      await wound.update({ "system.healingDays": left });
      lines.push(`${wound.name}: штрафы пройдут через ${left} дн.`);
    }
  }
  if (done.length) {
    await actor.deleteEmbeddedDocuments("Item", done.map(w => w.id));
    lines.push(`Зажили: ${done.map(w => w.name).join(", ")}.`);
  }
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="vedmak-card turn"><header class="card-head"><span class="card-glyph"><i class="fa-solid fa-bed"></i></span>`
      + `<div class="card-ident"><span class="card-name">Отдых: ${cfg.days} дн.</span><span class="card-sub">${actor.name}</span></div></header>`
      + `<div class="card-body"><div class="applied-report">${lines.map(l => `<p>${l}</p>`).join("")}</div></div></div>`
  });
}
