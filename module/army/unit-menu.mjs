// Меню отряда по правой кнопке (просьба автора 16.10): лист, картинка, жетон, роспуск и удаление — в списке войска
// поселения и в окне битвы. Строка отряда — элемент с data-id актёра «Отряд».

import { disband, removeUnit } from "./army.mjs";
import { realmConfirm } from "../apps/realm-dialog.mjs";

const unitOf = target => game.actors.get(target.closest("[data-id]")?.dataset.id);
const own = target => !!unitOf(target)?.isOwner;

/** Новая картинка отряда; жетон меняется вместе с ней, если был той же картинкой (иначе его настроили отдельно). */
async function pickImage(unit) {
  const fp = new foundry.applications.apps.FilePicker.implementation({
    type: "image", current: unit.img,
    callback: async path => {
      const sameToken = unit.prototypeToken.texture.src === unit.img;
      await unit.update({ img: path, ...(sameToken ? { "prototypeToken.texture.src": path } : {}) });
    }
  });
  return fp.browse();
}

function tokenConfig(unit) {
  new CONFIG.Token.prototypeSheetClass({ prototype: unit.prototypeToken }).render({ force: true });
}

async function remove(unit) {
  const ok = await realmConfirm("delete", { title: `Удалить: ${unit.name}`,
    text: "Отряд исчезнет вместе с бойцами — они не вернутся ни в Ополчение, ни в семьи.", hint: "Вернуть бойцов — «Распустить»." });
  // Игроку удалять актёров Foundry не даёт — removeUnit отдаёт это ведущему
  if (ok) await removeUnit(unit);
}

/**
 * Меню на строках отрядов внутри окна. Создаётся один раз на окно (в _onFirstRender): оно слушает сам элемент окна,
 * а строки находит по селектору при щелчке — перерисовки ему не мешают.
 */
export function bindUnitMenu(element, selector) {
  return new foundry.applications.ux.ContextMenu(element, selector, [
    { label: "Лист отряда", icon: '<i class="fa-solid fa-scroll"></i>', onClick: (ev, t) => unitOf(t)?.sheet.render(true) },
    { label: "Сменить картинку", icon: '<i class="fa-solid fa-image"></i>', visible: own, onClick: (ev, t) => { const u = unitOf(t); if (u) pickImage(u); } },
    { label: "Настроить жетон", icon: '<i class="fa-solid fa-user-gear"></i>', visible: own, onClick: (ev, t) => { const u = unitOf(t); if (u) tokenConfig(u); } },
    { label: "Распустить", icon: '<i class="fa-solid fa-person-walking-arrow-right"></i>', visible: own, onClick: (ev, t) => { const u = unitOf(t); if (u) disband(u); } },
    { label: "Удалить", icon: '<i class="fa-solid fa-trash"></i>', visible: own, onClick: (ev, t) => { const u = unitOf(t); if (u) remove(u); } }
  ], { jQuery: false, fixed: true });
}
