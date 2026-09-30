// Черты расы, которые требуют действий, когда раса появляется у персонажа или уходит с него:
// естественное оружие (`grants`: клыки врана, зубы-бритвы боболака) и выбор навыков гнома.
// Работает одинаково для мастера создания и для расы, перетащенной на готовый лист.

import { SKILLS } from "../config/skills.mjs";
import { itemsForLabel } from "./wizard.mjs";

const { DialogV2 } = foundry.applications.api;

/** Флаг эффектов, созданных чертами расы: они снимаются вместе с расой. */
const TRAIT_FLAG = "raceTrait";

/** Навыки Ремесла — из них гном выбирает три для «Внимания к деталям». */
const CRAFT_SKILLS = Object.entries(SKILLS).filter(([, s]) => s.stat === "cra");
const DETAIL_COUNT = 3;

/** Выдать естественное оружие расы, которого у персонажа ещё нет. */
export async function grantRaceItems(actor, race) {
  const have = new Set(actor.items.map(i => i.name.toLowerCase()));
  const items = [];
  for (const name of race?.system.grants ?? []) {
    if (!have.has(name.toLowerCase())) items.push(...await itemsForLabel(name));
  }
  if (items.length) await actor.createEmbeddedDocuments("Item", items);
}

/**
 * Убрать то, что давала прежняя раса: её естественное оружие (только категории «естественное»
 * с именем из выдачи расы — своё оружие персонажа не трогаем) и эффекты черт.
 */
export async function removeRaceExtras(actor, race) {
  const granted = new Set((race?.system.grants ?? []).map(n => n.toLowerCase()));
  const items = actor.itemTypes.weapon
    .filter(i => i.system.category === "natural" && granted.has(i.name.toLowerCase()))
    .map(i => i.id);
  if (items.length) await actor.deleteEmbeddedDocuments("Item", items);
  const effects = actor.effects.filter(e => e.getFlag("vedmak", TRAIT_FLAG)).map(e => e.id);
  if (effects.length) await actor.deleteEmbeddedDocuments("ActiveEffect", effects);
}

/** Всё, что раса требует при появлении у персонажа, кроме того, что мастер делает сам. */
export async function applyRaceExtras(actor, race) {
  await grantRaceItems(actor, race);
  if (race?.system.key === "gnome") await chooseDetailSkills(actor, race);
}

/**
 * «Внимание к деталям» гнома («Книга сказаний», стр. 4): +2 к трём навыкам Ремесла на выбор.
 * Бонус ложится эффектом черты — так же, как поправки жизненного пути: его видно и можно снять.
 * @returns {Promise<string[]|null>} выбранные навыки или null, если окно закрыли
 */
export async function chooseDetailSkills(actor, race) {
  const rows = CRAFT_SKILLS.map(([key, s]) =>
    `<label class="check"><input type="checkbox" name="skill" value="${key}"> ${s.label}${s.difficult ? " *" : ""}</label>`
  ).join("");
  const picked = await DialogV2.wait({
    window: { title: "Внимание к деталям", icon: "fa-solid fa-magnifying-glass" },
    classes: ["vedmak", "vedmak-dialog"],
    content: `<p>Гном получает +2 к трём навыкам Ремесла на выбор. Бонус не учитывает удвоенную цену сложного навыка (*).</p>`
      + `<div class="detail-skills">${rows}</div>`,
    // Больше трёх не отметить: остальные галочки гаснут
    render: (event, dialog) => {
      const boxes = [...dialog.element.querySelectorAll('input[name="skill"]')];
      const sync = () => {
        const n = boxes.filter(b => b.checked).length;
        for (const b of boxes) b.disabled = !b.checked && n >= DETAIL_COUNT;
      };
      for (const b of boxes) b.addEventListener("change", sync);
    },
    buttons: [{
      action: "ok", label: "Выбрать", icon: "fa-solid fa-check", default: true,
      callback: (event, button) => [...button.form.querySelectorAll('input[name="skill"]:checked')].map(b => b.value)
    }],
    rejectClose: false
  });
  if (!Array.isArray(picked)) return null;
  if (picked.length !== DETAIL_COUNT) {
    ui.notifications.warn(`«Внимание к деталям»: нужно выбрать ровно ${DETAIL_COUNT} навыка.`);
    return chooseDetailSkills(actor, race);
  }

  const old = actor.effects.filter(e => e.getFlag("vedmak", TRAIT_FLAG) === "detail").map(e => e.id);
  if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old);
  const changes = picked.map(k => ({ key: `system.skills.${k}.mod`, type: "add", value: 2, phase: "initial" }));
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: "Внимание к деталям", img: race?.img || "icons/sundries/scrolls/scroll-worn-tan.webp",
    system: { changes }, flags: { vedmak: { [TRAIT_FLAG]: "detail" } }
  }]);
  return picked;
}
