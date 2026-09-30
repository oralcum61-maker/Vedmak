// Настройки мира «Ведьмачьи школы»: свои школы — из дополнений или домашние. Школы корника встроены
// (WITCHER_SCHOOLS), здесь — только свои: название, описание и механика — Энергия, скованность движений,
// виды атаки без штрафа и поправки к параметрам и навыкам, как у расы.

import { WITCHER_SCHOOLS, SCHOOL_WAIVABLE, schoolMechanics, modTargets } from "../config/character.mjs";
import { STATS } from "../config/stats.mjs";
import { SKILLS } from "../config/skills.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const FormDataExtended = foundry.applications.ux.FormDataExtended;

/** Сохранённые свои школы. */
export function customSchools() {
  try { return foundry.utils.deepClone(game.settings.get("vedmak", "witcherSchools")?.list ?? []); } catch { return []; }
}

/** Записи формы с номерами строк («0», «1»…) — обратно в массив. */
const toArray = obj => (Array.isArray(obj) ? obj : Object.keys(obj ?? {}).sort((a, b) => a - b).map(k => obj[k]));

export class SchoolConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "vedmak-schools",
    tag: "form",
    classes: ["vedmak", "vedmak-dialog", "school-config"],
    window: { title: "Ведьмачьи школы", icon: "fa-solid fa-shield-cat", resizable: true },
    position: { width: 720, height: 760 },
    form: { handler: SchoolConfig.#onSubmit, closeOnSubmit: true },
    actions: {
      addSchool: SchoolConfig.#onAddSchool,
      deleteSchool: SchoolConfig.#onDeleteSchool,
      addMod: SchoolConfig.#onAddMod,
      deleteMod: SchoolConfig.#onDeleteMod
    }
  };

  // Часть шаблона в v14 — ровно один корневой элемент, поэтому кнопки — отдельной частью
  static PARTS = {
    form: { template: "systems/vedmak/templates/apps/schools.hbs", scrollable: [".school-list"] },
    footer: { template: "systems/vedmak/templates/apps/schools-footer.hbs" }
  };

  /** Правка до сохранения: живёт в окне, в настройку уходит по «Сохранить». */
  schools = customSchools();

  async _prepareContext() {
    const targets = modTargets(STATS, SKILLS);
    return {
      builtin: Object.entries(WITCHER_SCHOOLS).filter(([k]) => k).map(([, s]) => ({ label: s.label, hint: s.hint })),
      schools: this.schools.map((s, i) => ({
        ...s, index: i,
        waiveOptions: Object.entries(SCHOOL_WAIVABLE).map(([key, label]) => ({ key, label, checked: s.waive?.includes(key) })),
        mods: (s.mods ?? []).map((m, j) => ({ ...m, index: j })),
        summary: schoolMechanics(s, targets)
      })),
      targets
    };
  }

  /** Прочитать форму в `this.schools`, чтобы добавление и удаление строк не теряли набранное. */
  #readForm() {
    const data = foundry.utils.expandObject(new FormDataExtended(this.element).object);
    this.schools = toArray(data.schools).map((row, i) => {
      const prev = this.schools[i] ?? {};
      return {
        key: row.key || prev.key || `custom-${foundry.utils.randomID(8)}`,
        label: String(row.label ?? "").trim(),
        hint: String(row.hint ?? "").trim(),
        vigor: Number(row.vigor) || 0,
        ev: Number(row.ev) || 0,
        waive: Object.keys(SCHOOL_WAIVABLE).filter(k => row.waive?.[k]),
        mods: toArray(row.mods).map(m => ({ target: String(m.target ?? ""), value: Number(m.value) || 0 }))
      };
    });
  }

  static #onAddSchool() {
    this.#readForm();
    this.schools.push({ key: `custom-${foundry.utils.randomID(8)}`, label: "Новая школа", hint: "", vigor: 0, ev: 0, waive: [], mods: [] });
    this.render();
  }

  static async #onDeleteSchool(event, target) {
    this.#readForm();
    const i = Number(target.closest("[data-school]").dataset.school);
    const s = this.schools[i];
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Ведьмачьи школы" },
      content: `<p>Убрать «${foundry.utils.escapeHTML(s?.label ?? "")}»? У ведьмаков этой школы поле школы станет пустым после сохранения.</p>`
    });
    if (!ok) return;
    this.schools.splice(i, 1);
    this.render();
  }

  static #onAddMod(event, target) {
    this.#readForm();
    const s = this.schools[Number(target.closest("[data-school]").dataset.school)];
    s.mods.push({ target: "skills.awareness", value: 1 });
    this.render();
  }

  static #onDeleteMod(event, target) {
    this.#readForm();
    const s = this.schools[Number(target.closest("[data-school]").dataset.school)];
    s.mods.splice(Number(target.closest("[data-mod]").dataset.mod), 1);
    this.render();
  }

  static async #onSubmit() {
    this.#readForm();
    const list = this.schools.filter(s => s.label);
    await game.settings.set("vedmak", "witcherSchools", { list });
    ui.notifications.info(`Своих ведьмачьих школ: ${list.length}.`);
  }
}
