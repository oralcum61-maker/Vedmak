// Шаблоны поселений (PLAN 4.246): ведущий сохраняет настроенное поселение — семьи, одобрение, Контроль, Ополчение, казну,
// налоги, склад, описание и постройки с уровнями, работниками и готовым обустройством — и создаёт из шаблона новое.
// Стройки, исследования, заказы, управляющие, летопись, караваны и войско в шаблон не входят: это жизнь, не чертёж.
// Шаблоны — настройка мира settlementTemplates { id: шаблон }.

import { createBuildings, buildingSource } from "./settlement.mjs";
import { realmPrompt, realmConfirm } from "../apps/realm-dialog.mjs";
import { refuse } from "../util.mjs";

const SYS = "vedmak";
const KEY = "settlementTemplates";
const TOWN_FIELDS = ["families", "approval", "control", "militia", "wealth", "taxes", "stock", "description"];

export function registerTemplateSetting() {
  game.settings.register(SYS, KEY, { scope: "world", config: false, type: Object, default: {} });
}

/** Шаблоны по имени. */
export function templates() {
  let all = {};
  try { all = game.settings.get(SYS, KEY) ?? {}; } catch { /* настройки ещё нет */ }
  return Object.values(all).filter(t => t?.id).sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

const store = all => game.settings.set(SYS, KEY, Object.fromEntries(all.map(t => [t.id, t])));

/** Шаблон из поселения: чертёж построек (как для стройки) + их уровень, работники и готовое обустройство. */
export async function templateOf(actor, name = actor.name) {
  const sys = actor.system.toObject();
  const buildings = [];
  for (const b of actor.system.buildingActors) {
    const d = await buildingSource(b.toObject());
    if (!d) continue;
    const s = b.system;
    // Недостроенная впервые — в шаблоне как заложенная; улучшение в стройке — прежним уровнем
    Object.assign(d.system, { level: s.level, workers: s.workers, upgrades: [...s.upgrades], constructing: !s.level, progress: 0 });
    delete d.system.manager; delete d.system.managerSkill; delete d.system.orders;
    buildings.push(d);
  }
  return {
    id: foundry.utils.randomID(), name, img: actor.img,
    system: Object.fromEntries(TOWN_FIELDS.map(k => [k, foundry.utils.deepClone(sys[k])])),
    buildings
  };
}

/** Подпись шаблона: семьи, постройки, казна. */
const summaryOf = t => {
  const n = t.buildings?.length ?? 0;
  return `семей ${t.system?.families ?? 0} · построек ${n} · Богатство ${(Number(t.system?.wealth) || 0).toLocaleString("ru-RU")}`;
};

/** Лист поселения → «Сохранить как шаблон». Шаблон с тем же именем заменяется. */
export async function saveTemplate(actor) {
  if (!game.user.isGM) return refuse("Шаблоны сохраняет ведущий.");
  const name = await realmPrompt("template-save", {
    title: `Шаблон: ${actor.name}`, okLabel: "Сохранить шаблон",
    head: { img: actor.img, name: actor.name, sub: ["сохранить как шаблон"] },
    data: { name: actor.name, names: templates().map(t => t.name), buildings: actor.system.buildingActors.length },
    read: form => form.elements.name.value.trim()
  });
  if (!name) return null;
  const tpl = await templateOf(actor, name);
  const all = templates();
  const was = all.find(t => t.name.toLowerCase() === name.toLowerCase());
  if (was) tpl.id = was.id;
  await store([...all.filter(t => t !== was), tpl]);
  ui.notifications.info(`Шаблон «${name}» ${was ? "обновлён" : "сохранён"}: ${summaryOf(tpl)}.`);
  return tpl;
}

/** Удалить шаблон (с подтверждением). */
export async function deleteTemplate(id) {
  const tpl = templates().find(t => t.id === id);
  if (!tpl || !game.user.isGM) return false;
  const ok = await realmConfirm("confirm", {
    title: `Удалить шаблон «${tpl.name}»`, yesLabel: "Удалить шаблон", noLabel: "Оставить",
    head: { img: tpl.img, name: tpl.name, sub: ["удалить шаблон"], danger: true },
    text: `Шаблон «${tpl.name}» пропадёт из списка.`, hint: "Поселения, уже созданные из него, останутся как есть."
  });
  if (!ok) return false;
  await store(templates().filter(t => t.id !== id));
  return true;
}

/**
 * Создать поселение из шаблона (без шаблона — обычное: два дома и лагерь лесорубов). Календарь — как у первого
 * поселения мира, чтобы новое шло в ногу с остальными.
 */
export async function createFromTemplate({ name, id = "", folder = null } = {}) {
  if (!game.user.isGM) return refuse("Поселения создаёт ведущий.");
  const tpl = id ? templates().find(t => t.id === id) : null;
  if (id && !tpl) return refuse("Такого шаблона больше нет.");
  const peer = game.actors.find(a => a.type === "settlement");
  const cal = peer ? { year: peer.system.year, month: peer.system.month, week: peer.system.week } : {};
  const data = { name: name || tpl?.name || "Новое поселение", type: "settlement", folder,
    system: { ...foundry.utils.deepClone(tpl?.system ?? {}), ...cal } };
  if (tpl?.img) data.img = tpl.img;
  const town = await Actor.implementation.create(data, { vedmakStarter: !tpl });
  if (tpl?.buildings?.length) await createBuildings(town, foundry.utils.deepClone(tpl.buildings));
  return town;
}

/** Совет правителя → «Новое поселение…»: имя и шаблон; ✕ у шаблона — удалить его. */
export async function askNewSettlement() {
  if (!game.user.isGM) return refuse("Поселения создаёт ведущий.");
  const list = () => templates().map(t => ({ id: t.id, name: t.name, img: t.img, sub: summaryOf(t) }));
  const picked = await realmPrompt("template-new", {
    title: "Новое поселение", okLabel: "Основать",
    head: { icon: "fa-solid fa-chess-rook", name: "Новое поселение", sub: ["из шаблона или с нуля"] },
    data: { templates: list() },
    read: form => ({ name: form.elements.name.value.trim(), id: form.querySelector("input[name=tpl]:checked")?.value ?? "" }),
    onRender: root => root.addEventListener("click", async event => {
      const x = event.target.closest("[data-tpl-delete]");
      if (!x) return;
      event.preventDefault();
      const card = x.closest(".realm-tpl");
      if (await deleteTemplate(x.dataset.tplDelete)) {
        if (card.querySelector("input:checked")) root.querySelector(".realm-tpl input[value='']").checked = true;
        card.remove();
      }
    })
  });
  if (!picked) return null;
  const town = await createFromTemplate(picked);
  town?.sheet.render(true);
  return town;
}
