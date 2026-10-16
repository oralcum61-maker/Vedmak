// Свои ресурсы ведущего (PLAN 4.201): предметы «Ресурс» мира — в реестр CUSTOM_RESOURCES (значок и цена по имени
// переопределяют библиотеку); добавить ресурс на склад поселения.

import { CUSTOM_RESOURCES } from "../config/resources.mjs";
import { refuse } from "../util.mjs";

/** Пересобрать реестр своих ресурсов и перерисовать открытые листы поселений. */
export function refreshCustomResources() {
  CUSTOM_RESOURCES.clear();
  for (const i of game.items?.filter(i => i.type === "resource") ?? []) {
    CUSTOM_RESOURCES.set(i.name.trim(), { name: i.name.trim(), img: i.img, price: i.system.price, cat: i.system.category,
      hint: String(i.system.description ?? "").replace(/<[^>]+>/g, " ").trim(), uuid: i.uuid, custom: true });
  }
  for (const a of game.actors ?? []) if (a.type === "settlement" && a.sheet?.rendered) a.sheet.render();
}

/** Начать учитывать ресурс на складе поселения (с нуля); уже учтённый — как есть. */
export async function addResource(settlement, name) {
  name = String(name ?? "").trim();
  if (!name || name.includes(".")) return refuse("Название ресурса — без точек.");
  if (!settlement.isOwner) return null;
  if (name in (settlement.system.stock ?? {})) { ui.notifications.info(`«${name}» уже на складе «${settlement.name}».`); return false; }
  await settlement.update({ [`system.stock.${name}`]: 0 });
  return true;
}

export function registerResourceHooks() {
  Hooks.once("ready", refreshCustomResources);
  for (const op of ["create", "update", "delete"]) Hooks.on(`${op}Item`, item => { if (item.type === "resource") refreshCustomResources(); });
}
