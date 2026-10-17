// Экран ведущего (PLAN 4.250): одно окно на всю игру. Герои игроков — ПЗ, Вын, Удача, состояния, крит. ранения,
// кошелёк; тайная проверка навыка для отмеченных героев одной карточкой ведущему. Справочник — Сложности и типовые
// поправки (стр. 58), критические таблицы, памятки по правилам. Генераторы — заказы, монстры, лут, таверны: бросок
// с вложенными таблицами, итог — ведущему. Заметки ведущего — в настройке мира. Открывается кнопкой на панели сцены
// (инструменты токенов) и клавишами Shift+G.

import { SKILLS, DIFFICULTIES, SITUATIONAL_MODS } from "../config/skills.mjs";
import { STATS } from "../config/stats.mjs";
import { toCrowns, worldCurrency } from "../config/money.mjs";
import { renderTemplate, once, refuse } from "../util.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const SYS = "vedmak";
const SUB = "Подтаблицы";
const compareRu = (a, b) => a.localeCompare(b, "ru");
const pct = (v, m) => (m > 0 ? Math.round(100 * Math.max(0, Math.min(1, v / m))) : 0);

/** Герои игроков: персонажи, которыми владеет хоть один игрок. */
export const partyActors = () => game.actors.filter(a => a.type === "character" && a.hasPlayerOwner)
  .sort((a, b) => compareRu(a.name, b.name));

export class GmScreen extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "vedmak-gm-screen",
    classes: ["vedmak", "vedmak-dialog", "gm-screen"],
    window: { title: "Экран ведущего", icon: "fa-solid fa-book-open-reader", resizable: true },
    position: { width: 1120, height: 760 },
    actions: {
      openActor: GmScreen.#onOpenActor,
      groupCheck: GmScreen.#onGroupCheck,
      rollTable: GmScreen.#onRollTable,
      openRule: GmScreen.#onOpenRule,
      launch: GmScreen.#onLaunch,
      pickAll: GmScreen.#onPickAll
    }
  };

  // Части окна: при изменении героев перерисовывается только их столбец — заметки и поиск не сбрасываются
  static PARTS = {
    head: { template: "systems/vedmak/templates/apps/gm-screen/head.hbs" },
    party: { template: "systems/vedmak/templates/apps/gm-screen/party.hbs", scrollable: [".gs-scroll"] },
    ref: { template: "systems/vedmak/templates/apps/gm-screen/ref.hbs", scrollable: [".gs-scroll"] },
    gen: { template: "systems/vedmak/templates/apps/gm-screen/gen.hbs", scrollable: [".gs-scroll"] }
  };

  /** Отмеченные для проверки герои (id); пусто — все. Переживает перерисовку. */
  picked = null;
  /** Последний навык и Сложность группы. */
  check = { skill: "awareness", dc: "" };

  static open() {
    if (!game.user.isGM) return refuse("Экран ведущего — только для ведущего.");
    const app = foundry.applications.instances.get("vedmak-gm-screen") ?? new GmScreen();
    app.render({ force: true });
    return app;
  }

  static toggle() {
    const app = foundry.applications.instances.get("vedmak-gm-screen");
    if (app?.rendered) return app.close();
    return GmScreen.open();
  }

  async _prepareContext() {
    const cur = worldCurrency();
    const party = partyActors();
    this.picked ??= new Set(party.map(a => a.id));
    const heroes = party.map(a => this.#hero(a, cur));
    const skills = Object.entries(SKILLS).map(([key, s]) => ({ key, label: s.label, stat: STATS[s.stat]?.abbr ?? "", selected: key === this.check.skill }))
      .sort((x, y) => compareRu(x.label, y.label));
    return {
      heroes, empty: !heroes.length, skills, dc: this.check.dc,
      difficulties: DIFFICULTIES, mods: SITUATIONAL_MODS,
      crit: await this.#tables("vedmak.tables"), generators: await this.#generators(),
      rules: await this.#rules(),
      notes: game.settings.get(SYS, "gmNotes") ?? "",
      towns: game.actors.some(a => a.type === "settlement")
    };
  }

  #hero(a, cur) {
    const s = a.system, d = s.derived ?? {};
    const players = game.users.filter(u => !u.isGM && a.testUserPermission(u, "OWNER")).map(u => u.name);
    const statuses = [...a.statuses].map(id => CONFIG.statusEffects.find(e => e.id === id)).filter(Boolean)
      .map(e => ({ img: e.img ?? e.icon, name: game.i18n.localize(e.name ?? e.label ?? e.id) }));
    const crits = a.itemTypes.critWound ?? [];
    return {
      id: a.id, uuid: a.uuid, name: a.name, img: a.img, players: players.join(", "), picked: this.picked.has(a.id),
      hp: { value: s.hp.value, max: s.hp.max, pct: pct(s.hp.value, s.hp.max), low: s.hp.value <= (d.woundThreshold ?? 0), dying: s.hp.value <= 0 },
      sta: { value: s.sta.value, max: s.sta.max, pct: pct(s.sta.value, s.sta.max) },
      luck: s.luck ? `${s.luck.value}/${s.luck.max ?? 0}` : "",
      statuses, crits: crits.map(c => c.name).join(", "), critCount: crits.length,
      money: `${Math.floor(toCrowns(s.money) / (cur.rate || 1)).toLocaleString("ru-RU")} ${cur.abbr}`,
      awareness: s.skills?.awareness?.base ?? "", resist: s.skills?.resistMagic?.base ?? ""
    };
  }

  /** Таблицы пакета: [{ uuid, name, folder }]. */
  async #index(packId) {
    const pack = game.packs.get(packId);
    if (!pack) return [];
    const index = await pack.getIndex({ fields: ["folder"] });
    const path = id => {
      const out = [];
      for (let f = pack.folders.get(id); f; f = f.folder) out.unshift(f.name);
      return out;
    };
    return index.map(e => ({ uuid: e.uuid, name: e.name, path: e.folder ? path(e.folder) : [] }));
  }

  async #tables(packId) {
    return (await this.#index(packId)).sort((a, b) => compareRu(a.name, b.name));
  }

  /** Генераторы верхнего уровня по папкам; подтаблицы бросаются изнутри. */
  async #generators() {
    const groups = new Map();
    for (const t of await this.#index("vedmak.generators")) {
      if (t.path.includes(SUB)) continue;
      const name = t.path[0] ?? "Разное";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(t);
    }
    return [...groups].sort(([a], [b]) => compareRu(a, b))
      .map(([name, list]) => ({ name, list: list.sort((a, b) => compareRu(a.name, b.name)) }));
  }

  async #rules() {
    const pack = game.packs.get("vedmak.rules");
    if (!pack) return [];
    return [...await pack.getIndex()].map(e => ({ uuid: e.uuid, name: e.name })).sort((a, b) => compareRu(a.name, b.name));
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    // Части перерисовываются по отдельности: слушатель вешается на элемент один раз
    const on = (el, type, fn) => {
      if (!el || el.dataset[`vd${type}`]) return;
      el.dataset[`vd${type}`] = "1";
      el.addEventListener(type, fn);
    };
    const notes = root.querySelector("textarea[name=gmNotes]");
    let timer = null;
    on(notes, "input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => game.settings.set(SYS, "gmNotes", notes.value), 600);
    });
    on(notes, "change", () => { clearTimeout(timer); game.settings.set(SYS, "gmNotes", notes.value); });
    on(root.querySelector("select[name=skill]"), "change", e => { this.check.skill = e.target.value; });
    on(root.querySelector("input[name=dc]"), "input", e => { this.check.dc = e.target.value; });
    for (const box of root.querySelectorAll("input[data-pick]")) on(box, "change", () => {
      if (box.checked) this.picked.add(box.dataset.pick); else this.picked.delete(box.dataset.pick);
    });
    // Поиск по генераторам: прячет кнопки и пустые группы
    const find = root.querySelector("input[name=genFind]");
    on(find, "input", () => {
      const q = find.value.trim().toLowerCase();
      for (const g of root.querySelectorAll(".gs-gen")) {
        let any = false;
        for (const b of g.querySelectorAll("[data-action=rollTable]")) { const on = !q || b.textContent.toLowerCase().includes(q); b.hidden = !on; any ||= on; }
        g.hidden = !any;
      }
    });
  }

  static async #onOpenActor(event, target) { (await fromUuid(target.closest("[data-uuid]").dataset.uuid))?.sheet.render(true); }

  static #onPickAll() {
    const party = partyActors();
    this.picked = this.picked.size === party.length ? new Set() : new Set(party.map(a => a.id));
    this.render({ parts: ["party"] });
  }

  /** Тайная проверка: отмеченные герои бросают навык без окна и без карточек, ведущему — одна сводная карточка. */
  static async #onGroupCheck() {
    const root = this.element;
    const skill = root.querySelector("select[name=skill]")?.value || this.check.skill;
    const dcRaw = root.querySelector("input[name=dc]")?.value ?? "";
    const dc = dcRaw === "" ? null : Number(dcRaw);
    Object.assign(this.check, { skill, dc: dcRaw });
    const heroes = partyActors().filter(a => this.picked.has(a.id));
    if (!heroes.length) return refuse("Отметьте героев для проверки.");
    await once(this, "groupCheck", () => groupCheck(heroes, skill, dc));
  }

  static async #onRollTable(event, target) {
    await once(this, `table:${target.dataset.uuid}`, () => rollToGm(target.dataset.uuid));
  }

  static async #onOpenRule(event, target) { (await fromUuid(target.dataset.uuid))?.sheet.render(true); }

  static #onLaunch(event, target) {
    const v = game.vedmak;
    ({ council: () => v.council.open(), check: () => v.worldCheck.askWorldCheck(), tavern: () => v.tavern.open(),
      investigation: () => v.investigation.open(), nexus: () => v.nexus?.open?.() })[target.dataset.app]?.();
  }
}

/**
 * Тайная групповая проверка навыка: броски героев без окна и карточек; одна карточка ведущему — от лучшего к худшему,
 * с Сложностью — успех или провал и на сколько.
 * @returns {Promise<object[]>} строки карточки
 */
export async function groupCheck(heroes, skill, dc = null) {
  const rows = [];
  for (const a of heroes) {
    const r = await a.rollSkill(skill, { skipDialog: true, toChat: false, dc });
    if (!r) continue;
    const margin = r.margin === null || r.margin === undefined ? "" : `${r.margin > 0 ? "+" : ""}${r.margin}`;
    rows.push({ name: a.name, img: a.img, total: r.total, success: r.success,
      state: r.success === true ? "up" : r.success === false ? "down" : "",
      note: [r.crit ? "крит" : r.fumble ? "провал" : "", margin].filter(Boolean).join(" ") });
  }
  rows.sort((x, y) => y.total - x.total);
  const content = await renderTemplate("systems/vedmak/templates/chat/gm-check.hbs",
    { skill: SKILLS[skill]?.label ?? skill, dc, rows, passed: rows.filter(r => r.success).length });
  await ChatMessage.create({ content, whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    speaker: { alias: "Экран ведущего" }, flags: { [SYS]: { gmCheck: { skill, dc } } } });
  return rows;
}

/**
 * Бросок таблицы с вложенными: результат-таблица бросается внутри (до 4 уровней), строки — деревом.
 * @returns {Promise<{name, total, lines}>}
 */
export async function drawDeep(table, depth = 0) {
  const draw = await table.roll({ recursive: false });
  const lines = [];
  for (const r of draw.results) {
    const uuid = r.documentUuid ?? "";
    if (r.type === "document" && uuid.includes("RollTable") && depth < 4) {
      const sub = await fromUuid(uuid);
      if (sub) { lines.push({ sub: await drawDeep(sub, depth + 1) }); continue; }
    }
    lines.push({ name: r.name || r.text || "", description: r.description ?? "", link: r.type === "document" && uuid ? uuid : "" });
  }
  return { name: table.name, total: draw.roll?.total ?? "", lines };
}

/** Строки броска разметкой: вложенная таблица — подзаголовком и отступом; документ — ссылкой @UUID (чат её раскроет). */
function linesHtml(lines) {
  const esc = foundry.utils.escapeHTML ?? (s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`));
  const li = l => {
    if (l.sub) return `<li class="gmt-sub"><b>${esc(l.sub.name)} <small>${esc(l.sub.total)}</small></b>${linesHtml(l.sub.lines)}</li>`;
    const name = String(l.name ?? "").replace(/<[^>]+>/g, "").trim();
    if (l.link) return `<li>@UUID[${l.link}]{${esc(name)}}</li>`;
    // У строк генераторов описание обычно повторяет название (с разметкой и бросками [[…]]) — тогда только описание
    const key = s => String(s).replace(/<[^>]+>/g, " ").replace(/\[\[[^\]]*\]\]/g, " ").replace(/[^а-яёa-z0-9]+/gi, " ").trim().toLowerCase();
    if (!key(l.description)) return `<li>${esc(name)}</li>`;
    const same = !name || key(l.description).startsWith(key(name).slice(0, 16));
    return same ? `<li>${l.description}</li>` : `<li><b>${esc(name)}</b> — ${l.description}</li>`;
  };
  return `<ul class="gmt-lines">${lines.map(li).join("")}</ul>`;
}

/** Бросить таблицу по uuid и показать итог ведущему. */
export async function rollToGm(uuid) {
  const table = await fromUuid(uuid);
  if (!table) return refuse("Таблица не найдена.");
  const result = await drawDeep(table);
  const content = await renderTemplate("systems/vedmak/templates/chat/gm-table.hbs", { ...result, lines: linesHtml(result.lines) });
  await ChatMessage.create({ content, whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id), speaker: { alias: "Экран ведущего" } });
  return result;
}

/** Настройки, кнопка на панели сцены и клавиши. */
export function registerGmScreen() {
  game.settings.register(SYS, "gmNotes", { scope: "world", config: false, type: String, default: "" });
  game.keybindings.register(SYS, "gmScreen", {
    name: "Экран ведущего",
    hint: "Открыть или закрыть экран ведущего: герои, тайные проверки, справочник, генераторы, заметки.",
    editable: [{ key: "KeyG", modifiers: ["Shift"] }],
    restricted: true,
    onDown: () => { GmScreen.toggle(); return true; }
  });
  Hooks.on("getSceneControlButtons", controls => {
    const tokens = controls.tokens ?? controls.token;
    if (!tokens?.tools || !game.user.isGM) return;
    tokens.tools.vedmakGmScreen = { name: "vedmakGmScreen", title: "Экран ведущего (Shift+G)", icon: "fa-solid fa-book-open-reader",
      order: 99, button: true, visible: true, onChange: () => GmScreen.open() };
  });
  // Герои изменились — открытый экран перерисовать (не чаще раза в кадр)
  let queued = false;
  const again = () => {
    const app = foundry.applications.instances.get("vedmak-gm-screen");
    if (!app?.rendered || queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; app.render({ parts: ["party"] }); });
  };
  for (const hook of ["updateActor", "createActor", "deleteActor"]) Hooks.on(hook, doc => { if (doc.type === "character") again(); });
  for (const hook of ["createItem", "deleteItem", "createActiveEffect", "deleteActiveEffect"]) Hooks.on(hook, doc => { if (doc.parent?.type === "character") again(); });
}
