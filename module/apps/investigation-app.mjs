// Окно «Расследования» («Журнал ведьмака», стр. 145–151): тайны мира, улики, участники и их Фокус.
// Ведущий правит тайну прямо в окне (сохраняется в настройку мира при каждом изменении поля); игрок видит
// открытые тайны и открытые улики, проверяет улики своим персонажем, берёт подсказку Дедукцией и спит.

import { CLUE_TYPES, MYSTERY_DIFFICULTY, OBFUSCATION, OBSTACLE_TYPES, OBSTACLES_PER_DAY } from "../config/investigation.mjs";
import { SKILLS } from "../config/skills.mjs";
import {
  mysteries, saveMysteries, newMystery, newClue, focusOf, actingActor, evidenceCheck, deductionHint, obstacle,
  restFocus, setFocus
} from "../investigation/investigation.mjs";
import { resolveActor } from "../combat/common.mjs";
import { compareRu } from "../util.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

export class InvestigationApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "vedmak-investigation",
    classes: ["vedmak", "vedmak-dialog", "investigation-app"],
    window: { title: "Расследования", icon: "fa-solid fa-magnifying-glass", resizable: true },
    position: { width: 880, height: 720 },
    actions: {
      select: InvestigationApp.#onSelect,
      addMystery: InvestigationApp.#onAddMystery,
      deleteMystery: InvestigationApp.#onDeleteMystery,
      addClue: InvestigationApp.#onAddClue,
      deleteClue: InvestigationApp.#onDeleteClue,
      check: InvestigationApp.#onCheck,
      hint: InvestigationApp.#onHint,
      obstacle: InvestigationApp.#onObstacle,
      addPlayers: InvestigationApp.#onAddPlayers,
      removeParticipant: InvestigationApp.#onRemoveParticipant,
      sleep: InvestigationApp.#onSleep
    }
  };

  static PARTS = {
    body: { template: "systems/vedmak/templates/apps/investigation.hbs", scrollable: [".inv-list", ".inv-body"] }
  };

  /** Открыть окно (одно на клиента). */
  static open() {
    const app = foundry.applications.instances.get("vedmak-investigation") ?? new InvestigationApp();
    app.render({ force: true });
    return app;
  }

  /** Перерисовать открытое окно (настройка тайн изменилась, Фокус участника изменился). */
  static refresh() {
    const app = foundry.applications.instances.get("vedmak-investigation");
    if (app?.rendered) app.render();
  }

  selected = null;

  async _prepareContext() {
    const gm = game.user.isGM;
    const all = mysteries().filter(m => gm || m.visible);
    if (!all.some(m => m.id === this.selected)) this.selected = all[0]?.id ?? null;
    const m = all.find(x => x.id === this.selected) ?? null;
    const actor = actingActor();
    const ctx = {
      gm, actorName: actor?.name ?? "",
      list: all.map(x => ({ id: x.id, goal: x.goal, selected: x.id === this.selected, solved: x.solved, hidden: !x.visible,
        pct: x.complexity.max ? Math.round((1 - x.complexity.value / x.complexity.max) * 100) : 0 })),
      mystery: null
    };
    if (!m) return ctx;
    const clues = m.clues.filter(c => gm || c.revealed).map(c => ({
      ...c, typeLabel: CLUE_TYPES[c.type]?.label ?? c.type, example: CLUE_TYPES[c.type]?.example ?? "",
      skillsLabel: (CLUE_TYPES[c.type]?.skills ?? []).map(k => (k === "defining" ? "Магические познания" : SKILLS[k]?.label ?? k)).join(", "),
      canCheck: !c.found && !m.solved && !!actor
    }));
    const participants = m.participants.map(uuid => {
      const a = resolveActor(uuid);
      const f = focusOf(a);
      return a && f ? { uuid, name: a.name, img: a.img, value: f.value, max: f.max, pct: f.max ? Math.round(f.value / f.max * 100) : 0,
        owner: a.isOwner, empty: f.value <= 0 } : null;
    }).filter(Boolean);
    ctx.mystery = {
      ...m, clues, participants,
      complexityPct: m.complexity.max ? Math.round(m.complexity.value / m.complexity.max * 100) : 0,
      difficultyLabel: MYSTERY_DIFFICULTY[m.difficulty]?.label ?? "",
      obstaclesHint: OBSTACLES_PER_DAY[m.difficulty] ?? "",
      found: m.clues.filter(c => c.found).length
    };
    ctx.difficulties = Object.fromEntries(Object.entries(MYSTERY_DIFFICULTY).map(([k, d]) => [k, `${d.label} (${d.complexity})`]));
    ctx.clueTypes = Object.fromEntries(Object.entries(CLUE_TYPES).map(([k, t]) => [k, t.label]));
    ctx.obfuscations = OBFUSCATION;
    return ctx;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (!game.user.isGM) return;
    // Правка ведущего — поле за полем: путь в тайне (data-field) или в улике (data-clue + data-field)
    for (const el of this.element.querySelectorAll("[data-field]")) {
      el.addEventListener("change", () => this.#saveField(el));
    }
    for (const el of this.element.querySelectorAll("input.focus-input")) {
      el.addEventListener("change", () => InvestigationApp.focusInput(el));
    }
  }

  async #saveField(el) {
    const list = mysteries();
    const m = list.find(x => x.id === this.selected);
    if (!m) return;
    const target = el.dataset.clue ? m.clues.find(c => c.id === el.dataset.clue) : m;
    if (!target) return;
    let value = el.type === "checkbox" ? el.checked : el.value;
    if (el.dataset.number !== undefined) value = Math.max(0, Number(value) || 0);
    foundry.utils.setProperty(target, el.dataset.field, value);
    // Смена сложности — новая Сложность (пока тайну не начали разгадывать)
    if (el.dataset.field === "difficulty" && m.complexity.value === m.complexity.max) {
      const c = MYSTERY_DIFFICULTY[value]?.complexity ?? m.complexity.max;
      m.complexity = { value: c, max: c };
    }
    if (el.dataset.field === "complexity.max") m.complexity.value = Math.min(m.complexity.value, m.complexity.max);
    await saveMysteries(list);
  }

  async #mutate(fn) {
    const list = mysteries();
    const m = list.find(x => x.id === this.selected);
    if (!m) return;
    fn(m, list);
    await saveMysteries(list);
  }

  static #onSelect(event, target) {
    this.selected = target.dataset.id;
    this.render();
  }

  static async #onAddMystery() {
    const list = mysteries();
    const m = newMystery();
    list.push(m);
    this.selected = m.id;
    await saveMysteries(list);
  }

  static async #onDeleteMystery() {
    const m = mysteries().find(x => x.id === this.selected);
    if (!m) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Удалить тайну" }, content: `<p>Удалить «${esc(m.goal)}» со всеми уликами?</p>`, rejectClose: false
    });
    if (!ok) return;
    await saveMysteries(mysteries().filter(x => x.id !== m.id));
    this.selected = null;
  }

  static async #onAddClue() { await this.#mutate(m => m.clues.push(newClue())); }

  static async #onDeleteClue(event, target) {
    const id = target.closest("[data-clue-id]")?.dataset.clueId;
    await this.#mutate(m => { m.clues = m.clues.filter(c => c.id !== id); });
  }

  static async #onCheck(event, target) {
    const id = target.closest("[data-clue-id]")?.dataset.clueId;
    const actor = actingActor();
    if (!actor) return ui.notifications.warn("Назначьте себе персонажа или выделите его токен.");
    // Проверяющий — участник расследования: помехи и Фокус считаются на него (участника добавляет ведущий)
    await evidenceCheck(actor, this.selected, id);
  }

  static async #onHint() {
    const actor = actingActor();
    if (!actor) return ui.notifications.warn("Назначьте себе персонажа или выделите его токен.");
    await deductionHint(actor, this.selected);
  }

  static async #onObstacle() {
    const m = mysteries().find(x => x.id === this.selected);
    if (!m?.participants.length) return ui.notifications.warn("Сначала добавьте участников расследования.");
    const people = m.participants.map(u => resolveActor(u)).filter(Boolean);
    const skills = Object.entries(SKILLS).sort((a, b) => compareRu(a[1].label, b[1].label));
    const content = `<div class="vedmak-roll-dialog">
      <div class="form-group"><label>Помеха</label><select name="kind">${Object.values(OBSTACLE_TYPES).map(t => `<option>${esc(t)}</option>`).join("")}</select></div>
      <div class="form-group"><label>Кто справляется</label><select name="actor">${people.map(a => `<option value="${a.uuid}">${esc(a.name)}</option>`).join("")}</select></div>
      <div class="form-group"><label>Навык</label><select name="skill">${skills.map(([k, s]) => `<option value="${k}" ${k === "deduction" ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></div>
      <div class="form-group"><label>СЛ</label><input type="number" name="dc" value="14" min="1"></div>
      <p class="hint">Успех — все участники −2 Фокуса, провал — −(1d6 + 2), критический провал — бросавший ещё −3. За день: ${esc(OBSTACLES_PER_DAY[m.difficulty] ?? "")}.</p>
    </div>`;
    const cfg = await foundry.applications.api.DialogV2.wait({
      window: { title: "Помеха расследованию" }, classes: ["vedmak", "vedmak-dialog"], content,
      buttons: [{ action: "ok", label: "Бросить", default: true, callback: (e, b) => {
        const f = b.form.elements;
        return { kind: f.kind.value.split(":")[0], actor: resolveActor(f.actor.value), skill: f.skill.value, dc: Number(f.dc.value) || 14 };
      } }, { action: "cancel", label: "Отмена" }],
      rejectClose: false
    });
    if (!cfg || cfg === "cancel") return;
    await obstacle(this.selected, cfg);
  }

  static async #onAddPlayers() {
    const chars = game.users.filter(u => !u.isGM && u.character).map(u => u.character.uuid);
    const tokens = (canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(a => a?.type === "character").map(a => a.uuid);
    await this.#mutate(m => { m.participants = [...new Set([...m.participants, ...chars, ...tokens])]; });
  }

  static async #onRemoveParticipant(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    await this.#mutate(m => { m.participants = m.participants.filter(u => u !== uuid); });
  }

  static async #onSleep(event, target) {
    const actor = resolveActor(target.closest("[data-uuid]")?.dataset.uuid);
    if (actor?.isOwner) await restFocus(actor);
  }

  /** Ведущий правит Фокус участника числом. */
  static async focusInput(el) {
    const actor = resolveActor(el.closest("[data-uuid]")?.dataset.uuid);
    if (actor && game.user.isGM) await setFocus(actor, el.value);
  }
}

/** Кнопка «Расследования» в шапке вкладки журналов. */
export function registerInvestigationUi() {
  Hooks.on("renderJournalDirectory", (app, html) => {
    if (!game.settings.get("vedmak", "investigation")) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    const header = root?.querySelector(".directory-header .header-actions") ?? root?.querySelector(".directory-header");
    if (!header || header.querySelector(".vd-investigation")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vd-investigation";
    btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Расследования';
    btn.addEventListener("click", () => InvestigationApp.open());
    header.append(btn);
  });
  // Фокус участников меняется — окно перерисовывается
  Hooks.on("updateActor", actor => { if (actor.type === "character" && actor.system.focus) InvestigationApp.refresh(); });
}
