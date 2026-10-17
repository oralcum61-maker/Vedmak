// Профессия и её древо для листа (PLAN 4.259): персонаж и НИП — один блок (templates/actor/parts/profession.hbs).

import { STATS } from "../config/stats.mjs";
import { abilityBonus } from "../config/character.mjs";

/**
 * Данные блока профессии или null (профессии нет).
 * @param {Actor} actor
 * @param {{definingOffer?: Function, abilityOffer?: Function}} [offers] — развитие за О.У (у персонажа в режиме развития)
 */
export function professionContext(actor, offers = {}) {
  const system = actor.system;
  const prof = system.profession;
  if (!prof) return null;
  const ps = prof.system;
  const ds = ps.definingSkill;
  const out = {
    id: prof.id, name: prof.name, img: prof.img, vigor: ps.vigor, magicAbilities: ps.magicAbilities,
    defining: {
      name: ds.name, value: ds.value, effect: ds.effect, statLabel: STATS[ds.stat]?.label ?? "",
      statAbbr: STATS[ds.stat]?.abbr ?? "", base: (system.stats[ds.stat]?.effective ?? 0) + ds.value,
      offer: offers.definingOffer?.(actor) ?? null
    },
    branches: ps.branches.map((b, bi) => ({
      name: b.name, index: bi,
      abilities: b.abilities.map((ab, ai) => {
        const bonus = abilityBonus(ab.mechanic, ab.value);
        const unlocked = ps.isUnlocked(bi, ai);
        const prev = ai === 0 ? ds.name : b.abilities[ai - 1].name;
        return {
          ...ab, index: ai, unlocked,
          lockNote: `Нужно 5 очков в «${prev}».`,
          // Застёжка к следующей ступени: открыта, когда вложено 5
          gate: ai < b.abilities.length - 1, gateOpen: ab.value >= 5,
          statAbbr: STATS[ab.stat]?.abbr ?? "",
          base: ab.stat ? (system.stats[ab.stat]?.effective ?? 0) + ab.value : null,
          mechanicNote: bonus.vigor ? `+${bonus.vigor} Эн.` : bonus.toxicity ? `+${bonus.toxicity}%` : "",
          offer: offers.abilityOffer?.(actor, bi, ai) ?? null
        };
      })
    }))
  };
  out.altBranches = (ps.altBranches ?? []).map((a, ai) => ({
    ...a, index: ai,
    abilities: a.abilities.map(x => ({ ...x, statAbbr: STATS[x.stat]?.abbr ?? "" })),
    targets: ps.branches.map((b, bi) => ({ index: bi, name: b.name }))
  }));
  const abilities = out.branches.flatMap(b => b.abilities);
  out.learned = abilities.filter(ab => ab.value > 0).length;
  out.total = abilities.length;
  return out;
}

/** Взять другую ветвь древа вместо ветви bi (прежняя уходит в «Другие ветви» с очками — её можно вернуть). */
export async function swapBranch(actor, ai, bi) {
  const prof = actor.system.profession;
  if (!prof) return;
  const data = prof.system.toObject();
  const alt = data.altBranches[ai], old = data.branches[bi];
  if (!alt || !old) return;
  if (old.abilities.some(a => a.value > 0)) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Сменить ветвь" },
      content: `<p>В ветви «${foundry.utils.escapeHTML(old.name)}» уже вложены очки. Ветвь уйдёт в «Другие ветви» вместе с ними — её можно вернуть. Сменить на «${foundry.utils.escapeHTML(alt.name)}»?</p>`
    });
    if (!ok) return;
  }
  data.branches[bi] = { name: alt.name, extra: alt.extra ?? "", source: alt.source ?? "", abilities: alt.abilities };
  // Своя книга ветви; у основной ветви профессии её нет — книга профессии
  data.altBranches[ai] = { name: old.name, source: old.source || prof.system.source?.book || "", extra: old.extra ?? "", abilities: old.abilities };
  await prof.update({ "system.branches": data.branches, "system.altBranches": data.altBranches });
}
