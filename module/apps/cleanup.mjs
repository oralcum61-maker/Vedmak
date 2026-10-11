// Меню ведущего «Чистка зависших эффектов»: эффекты и флаги, застывшие в мирах от прежних версий системы или от
// прерванных сценариев (бессрочные регенерации, поддержание без заклинателя, сроки, которые некому отсчитать,
// «Решимость» словесной дуэли). Окно ищет по всем акторам мира и по несвязанным токенам сцен, показывает находки
// с галочками и снимает только отмеченное.

import { timeIsUp } from "../magic/timed.mjs";
import { deleteEffectsClamped } from "../magic/buffs.mjs";
import { endMaintained } from "../magic/effects.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Виды находок: подпись в окне и отмечены ли по умолчанию. */
export const STUCK_KINDS = {
  orphanRegen: { label: "Регенерация без срока и без заклинания", checked: true },
  lostMaintain: { label: "Заклинание больше никто не поддерживает", checked: true },
  maintainNoSpell: { label: "Поддержание заклинания, которого у заклинателя нет", checked: true },
  expired: { label: "Срок вышел, а эффект висит", checked: true },
  roundsNoCombat: { label: "Срок в раундах вне боя — отсчитать некому", checked: true },
  duelResolve: { label: "«Решимость» словесной дуэли (сбросится и кнопкой «Новая дуэль»)", checked: false }
};

/** Все акторы, которых касается чистка: мира и несвязанных токенов на сценах. */
function allActors() {
  const out = [...game.actors];
  for (const scene of game.scenes) {
    for (const token of scene.tokens) if (!token.actorLink && token.actor) out.push(token.actor);
  }
  return out;
}

/** Участвует ли актор в каком-нибудь бою (тогда сроки в раундах отсчитывает начало хода). */
const inAnyCombat = actor => game.combats.some(c => c.combatants.some(cb => cb.actor?.uuid === actor.uuid || cb.actorId === actor.id));

/** Поддерживает ли заклинатель заклинание из связи эффекта. */
function stillMaintained(link) {
  const caster = fromUuidSync(link.casterUuid);
  return !!caster?.effects?.some(e => e.flags?.vedmak?.maintain?.itemId === link.itemId);
}

/**
 * Найти зависшее.
 * @returns {{id: string, kind: string, actor: Actor, effectId: string|null, label: string, where: string}[]}
 */
export function scanStuck() {
  const found = [];
  for (const actor of allActors()) {
    const where = actor.isToken ? `${actor.name} (токен на сцене «${actor.token?.parent?.name ?? "?"}»)` : actor.name;
    const fighting = inAnyCombat(actor);
    for (const e of actor.effects) {
      const f = e.flags?.vedmak ?? {};
      const link = f.spellLink?.maintain ? f.spellLink : f.spellBuff?.maintain ? f.spellBuff : null;
      let kind = null;
      if (link && link.casterUuid && link.itemId && !stillMaintained(link)) kind = "lostMaintain";
      else if (f.maintain?.itemId && !actor.items.has(f.maintain.itemId)) kind = "maintainNoSpell";
      else if (f.regen && !f.spellLink && !e.isTemporary && !(f.timed?.rounds > 0)) kind = "orphanRegen";
      else if (e.isTemporary && !fighting && timeIsUp(e)) kind = "expired";
      else if (!fighting && !e.isTemporary && (f.timed?.rounds > 0 || f.statusRounds > 0) && !f.toxicPoison) kind = "roundsNoCombat";
      if (kind) found.push({ id: `${actor.uuid}|${e.id}`, kind, actor, effectId: e.id, label: e.name, where });
    }
    if (actor.getFlag?.("vedmak", "duelResolve") !== undefined) {
      found.push({ id: `${actor.uuid}|duelResolve`, kind: "duelResolve", actor, effectId: null,
        label: `Решимость ${actor.getFlag("vedmak", "duelResolve")}`, where });
    }
  }
  return found;
}

/**
 * Снять выбранное.
 * @param {ReturnType<typeof scanStuck>} items
 * @returns {Promise<number>} сколько снято
 */
export async function clearStuck(items) {
  let n = 0;
  const byActor = new Map();
  for (const it of items) {
    if (!byActor.has(it.actor)) byActor.set(it.actor, []);
    byActor.get(it.actor).push(it);
  }
  for (const [actor, list] of byActor) {
    // Поддержание со щитом обнуляет щит — через общую функцию; прочие эффекты — одной пачкой, с урезанием ПЗ бонусов
    const plain = [];
    for (const it of list) {
      if (it.kind === "duelResolve") { await actor.unsetFlag("vedmak", "duelResolve"); n++; continue; }
      if (!actor.effects.has(it.effectId)) continue;
      if (actor.effects.get(it.effectId).flags?.vedmak?.maintain) { await endMaintained(actor, it.effectId); n++; }
      else plain.push(it.effectId);
    }
    if (plain.length) { await deleteEffectsClamped(actor, plain); n += plain.length; }
  }
  return n;
}

export class CleanupApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "vedmak-cleanup",
    tag: "form",
    classes: ["vedmak", "vedmak-dialog", "cleanup-app"],
    window: { title: "Чистка зависших эффектов", resizable: true },
    position: { width: 640, height: 600 },
    form: { handler: CleanupApp.#onSubmit, closeOnSubmit: false },
    actions: { rescan: CleanupApp.#onRescan }
  };

  static PARTS = {
    form: { template: "systems/vedmak/templates/apps/cleanup.hbs", scrollable: [".cleanup-list"] },
    footer: { template: "systems/vedmak/templates/apps/cleanup-footer.hbs" }
  };

  found = [];

  async _prepareContext() {
    this.found = scanStuck();
    const groups = Object.entries(STUCK_KINDS).map(([kind, k]) => ({
      kind, label: k.label,
      rows: this.found.filter(f => f.kind === kind).map(f => ({ id: f.id, label: f.label, where: f.where, checked: k.checked }))
    })).filter(g => g.rows.length);
    return { groups, total: this.found.length };
  }

  static #onRescan() { this.render(); }

  static async #onSubmit(event, form) {
    const picked = new Set([...form.querySelectorAll("input[type=checkbox][data-id]:checked")].map(i => i.dataset.id));
    const items = this.found.filter(f => picked.has(f.id));
    if (!items.length) return ui.notifications.info("Ничего не отмечено.");
    const n = await clearStuck(items);
    ui.notifications.info(`Снято: ${n}.`);
    this.render();
  }
}
