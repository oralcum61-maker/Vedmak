// Верховая езда и транспорт: проверка управления и потеря управления (стр. 169–171).

import { MOUNTS, MANEUVERS, LOSS_VEHICLE, LOSS_MOUNT } from "../config/combat.mjs";
import { SKILLS } from "../config/skills.mjs";
import { performCheck } from "../dice/check.mjs";
import { bindDialog, commonFields, readCommon } from "../dice/dialog-ui.mjs";
import { renderTemplate } from "../util.mjs";
import { postCard } from "./common.mjs";

const rowFor = (table, n) => table.find(([a, b]) => n >= a && n <= b);

/** Основа управления: Реа + навык + модификатор скакуна. */
function controlBase(actor, mountKey) {
  const m = MOUNTS[mountKey] ?? MOUNTS.horse;
  const skill = actor.system.skills[m.skill];
  // Отрицательная основа допустима: книга (стр. 157) обрезает только вычитание критического провала
  return actor.system.stats.ref.effective + skill.total + m.mod + (skill.penalty || 0);
}

/** Проверка управления: Реа + Верховая езда (Мореходство) + модификатор скакуна + 1d10 против СЛ манёвра. */
export async function controlCheck(actor, { mount = "horse" } = {}) {
  const mounts = Object.entries(MOUNTS).map(([key, m]) => ({
    key, label: m.label, mod: m.mod, skillLabel: SKILLS[m.skill].label,
    base: controlBase(actor, key), selected: key === mount
  }));
  const maneuvers = Object.entries(MANEUVERS).map(([key, m]) => ({
    key, ...m, short: m.label.split(" (")[0], selected: key === "simple"
  }));
  const base = controlBase(actor, mount);
  const content = await renderTemplate("systems/vedmak/templates/dialog/control.hbs", {
    mounts, maneuvers,
    head: {
      title: "Управление", base, baseHint: "Реа + навык + скакун",
      subtitle: `${actor.name} · ${MOUNTS[mount]?.label ?? ""}`
    },
    total: { base, hint: `Нужно больше ${MANEUVERS.simple.dc}` },
    ...commonFields({ luckMax: actor.system.luck?.value ?? 0 })
  });
  const cfg = await foundry.applications.api.DialogV2.wait({
    window: { title: `Управление: ${actor.name}` },
    classes: ["vedmak", "vedmak-dialog", "check-dialog"],
    position: { width: 520 },
    content,
    render: (event, dialog) => {
      bindDialog(dialog);
      // «Без седла» — не для транспорта, «Таран упряжкой» — только упряжке: как в броске (rollControl), иначе
      // итог окна расходился бы с броском
      const form = dialog.element.querySelector("form") ?? dialog.element;
      const sync = () => {
        const m = MOUNTS[form.querySelector("input[name=mount]:checked")?.value] ?? {};
        for (const [name, off] of [["noSaddle", !!m.vehicle], ["ramDrawn", !m.drawn]]) {
          const box = form.querySelector(`input[name=${name}]`);
          if (!box) continue;
          box.disabled = off;
          if (off && box.checked) { box.checked = false; box.dispatchEvent(new Event("change", { bubbles: true })); }
        }
      };
      form.addEventListener("change", event => { if (event.target.name === "mount") sync(); });
      sync();
    },
    buttons: [{
      action: "roll", label: "Бросить", default: true,
      callback: (event, button) => {
        const f = button.form.elements;
        return {
          ...readCommon(f, actor.system.luck?.value ?? 0),
          mount: f.mount.value, maneuver: f.maneuver.value, dcCustom: "",
          noSaddle: f.noSaddle.checked, reins: f.reins.checked, ramDrawn: f.ramDrawn.checked
        };
      }
    }, { action: "cancel", label: "Отмена" }],
    rejectClose: false
  });
  if (!cfg || cfg === "cancel") return null;
  return rollControl(actor, cfg);
}

export async function rollControl(actor, cfg) {
  const m = MOUNTS[cfg.mount] ?? MOUNTS.horse;
  const skillKey = m.skill;
  const skill = actor.system.skills[skillKey];
  const stat = actor.system.stats.ref;
  const parts = [
    { label: stat.label, value: stat.effective, always: true },
    { label: SKILLS[skillKey].label, value: skill.total, always: true },
    { label: m.label, value: m.mod, always: true }
  ];
  if (skill.penalty) parts.push({ label: "Ранения", value: skill.penalty });
  if (cfg.noSaddle && !m.vehicle) parts.push({ label: "Без седла", value: -2 });
  if (cfg.reins) parts.push({ label: "Выронил поводья", value: -1 });
  if (cfg.ramDrawn && m.drawn) parts.push({ label: "Таран упряжкой", value: -10 });
  if (cfg.mod) parts.push({ label: "Модификатор", value: cfg.mod });

  const dc = cfg.dcCustom !== "" && cfg.dcCustom !== undefined ? Number(cfg.dcCustom) : (MANEUVERS[cfg.maneuver]?.dc ?? 15);
  const roll = await performCheck({ actor, title: `Управление: ${m.label}`, parts, dc, luck: cfg.luck, toChat: false });
  const loss = [];
  const rolls = [...(roll.rolls ?? [])];
  if (!roll.success) {
    if (m.vehicle) {
      const r = await new Roll("1d6").evaluate();
      rolls.push(r);
      loss.push({ who: "Транспорт", roll: r.total, text: rowFor(LOSS_VEHICLE, r.total)?.[2] ?? "" });
    } else {
      const rider = await new Roll("1d10").evaluate();
      const beast = await new Roll("1d10").evaluate();
      rolls.push(rider, beast);
      loss.push({ who: "Наездник", roll: rider.total, text: rowFor(LOSS_MOUNT, rider.total)?.[2] ?? "" });
      loss.push({ who: "Скакун", roll: beast.total, text: rowFor(LOSS_MOUNT, beast.total)?.[3] ?? "" });
    }
  }
  return postCard({
    template: "systems/vedmak/templates/chat/control.hbs",
    data: { ...roll, title: `Управление: ${m.label}`, maneuver: MANEUVERS[cfg.maneuver]?.label ?? "", loss },
    actor, rolls, messageMode: cfg.messageMode, flags: { control: { mount: cfg.mount, success: roll.success } }
  });
}
