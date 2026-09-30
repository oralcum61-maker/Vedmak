// Документ актора: проверки параметров и навыков, атаки, испытания, синхронизация «при смерти».

import { SKILLS } from "../config/skills.mjs";
import { STATS } from "../config/stats.mjs";
import { performCheck } from "../dice/check.mjs";
import { rollDialog } from "../dice/roll-dialog.mjs";
import { statusRollMods } from "../combat/statuses.mjs";
import { attack } from "../combat/attack.mjs";
import { rollStunSave, deathSaveDialog } from "../combat/saves.mjs";
import { castSpell } from "../magic/cast.mjs";
import { socialModifier } from "../config/character.mjs";
import { postCard } from "../util.mjs";

export class VedmakActor extends Actor {

  /** Доступная Удача (у чудовищ нет). */
  get luckAvailable() {
    return this.type === "character" ? (this.system.luck?.value ?? 0) : 0;
  }

  /**
   * Проверка навыка. Нетренированный навык — только параметр (стр. 57).
   * @param {string} key
   * @param {object} [opts] — {dc, mod, skipDialog, extraParts, subtitle}
   */
  async rollSkill(key, opts = {}) {
    const def = SKILLS[key];
    const skill = this.system.skills?.[key];
    if (!def || !skill) return null;
    const stat = this.system.stats[def.stat];
    const parts = [
      { label: STATS[def.stat].label, value: stat.effective, always: true },
      { label: def.label, value: skill.total, always: true }
    ];
    const sum = stat.effective + skill.total + skill.penalty;
    if (skill.penalty) parts.push({ label: "Ранения и СД", value: skill.penalty });
    if (skill.base !== Math.max(0, sum)) parts.push({ label: "Ранения (множитель)", value: skill.base - sum });
    parts.push(...statusRollMods(this, "skill", { skill: key }), ...(opts.extraParts ?? []));
    return this.#check({ title: def.label, subtitle: this.#stateNote(), parts, optional: this.socialParts(key), ...opts });
  }

  /**
   * Необязательные слагаемые социальных навыков: социальный статус на территории (стр. 21)
   * и «Доверие» людей при общении с людьми (стр. 24). В окне броска — галочками.
   */
  socialParts(skill) {
    if (this.type !== "character") return [];
    const out = [];
    const status = this.system.derived?.social;
    if (status) {
      const value = socialModifier(status, skill);
      if (value) out.push({ label: `Статус: ${status.label} (${status.regionLabel})`, value, checked: true,
        hint: "Не действует при общении со своими — для них всегда равенство." });
    }
    if (this.system.raceKey === "human" && ["charisma", "seduction", "persuasion"].includes(skill)) {
      out.push({ label: "Доверие (против людей)", value: 1, checked: false });
    }
    return out;
  }

  /** Проверка определяющего навыка профессии. */
  async rollDefining(opts = {}) {
    const prof = this.system.profession;
    if (!prof) return null;
    const ds = prof.system.definingSkill;
    const stat = this.system.stats[ds.stat];
    const parts = [
      { label: STATS[ds.stat]?.label ?? ds.stat, value: stat?.effective ?? 0, always: true },
      { label: ds.name, value: ds.value, always: true }
    ];
    if (this.system.derived?.actionMod) parts.push({ label: "Ранения: ко всем действиям", value: this.system.derived.actionMod });
    parts.push(...statusRollMods(this, "skill"));
    return this.#check({ title: ds.name, subtitle: `Определяющий навык · ${prof.name}`, parts, ...opts });
  }

  /** Проверка способности древа профессии (параметр + значение способности). */
  async rollAbility(branch, index, opts = {}) {
    const prof = this.system.profession;
    const ab = prof?.system.ability(branch, index);
    if (!ab) return null;
    if (!ab.stat) return ui.notifications.info(`«${ab.name}» — пассивная способность, проверка не нужна.`);
    const stat = this.system.stats[ab.stat];
    const parts = [
      { label: STATS[ab.stat].label, value: stat.effective, always: true },
      { label: ab.name, value: ab.value, always: true }
    ];
    if (this.system.derived?.actionMod) parts.push({ label: "Ранения: ко всем действиям", value: this.system.derived.actionMod });
    parts.push(...statusRollMods(this, "skill"));
    return this.#check({ title: ab.name, subtitle: `${prof.system.branches[branch].name} · ${prof.name}`, parts, ...opts });
  }

  /** Узнают ли персонажа: d10 не больше репутации (стр. 60). */
  async rollReputation() {
    const rep = this.system.reputation?.value ?? 0;
    const roll = await new Roll("1d10").evaluate();
    const known = roll.total <= rep;
    const fame = this.system.reputation.fame;
    return postCard(this, "Репутация", `<p>Бросок d10: <b>${roll.total}</b> против репутации <b>${rep}</b>.</p>
      <div class="outcome ${known ? "success" : "failure"}">${known ? "О персонаже наслышаны" : "Персонажа не узнали"}</div>
      ${fame ? `<p class="hint">Слава: ${foundry.utils.escapeHTML(fame)}</p>` : ""}`,
      { icon: "fa-solid fa-bullhorn", rolls: [roll] });
  }

  /**
   * Зависимость (стр. 32): без дозы — бросок d10 ниже Воли, уменьшенной на число дней без дозы.
   * При провале — «Ломка»: −5 ко всему, что не связано с получением дозы.
   */
  async rollAddiction(index) {
    const addiction = this.system.addictions?.[index];
    if (!addiction) return null;
    const will = this.system.stats.will.effective;
    const target = will - addiction.days;
    const roll = await new Roll("1d10").evaluate();
    const ok = roll.total < target;
    await postCard(this, `Зависимость: ${foundry.utils.escapeHTML(addiction.name || "без названия")}`,
      `<p>Бросок d10: <b>${roll.total}</b>, нужно меньше ${target} (Воля ${will} − ${addiction.days} дн. без дозы).</p>
       <div class="outcome ${ok ? "success" : "failure"}">${ok ? "Держится" : "Ломка: −5 ко всему, не связанному с получением дозы"}</div>`,
      { icon: "fa-solid fa-wine-bottle", rolls: [roll] });
    if (!ok && !this.statuses.has("withdrawal")) await this.toggleStatusEffect("withdrawal", { active: true });
    return ok;
  }

  /** Проверка чистого параметра (Параметр ×1 + d10). */
  async rollStat(key, opts = {}) {
    const stat = this.system.stats?.[key];
    if (!stat) return null;
    const parts = [{ label: STATS[key].label, value: stat.effective, always: true }];
    const action = this.system.derived?.actionMod;
    if (action) parts.push({ label: "Ранения: ко всем действиям", value: action });
    parts.push(...(opts.extraParts ?? []));
    return this.#check({ title: STATS[key].label, subtitle: this.#stateNote(), parts, ...opts });
  }

  /** Атака оружием, щитом или без оружия. */
  attack(source, opts) {
    return attack(this, source, opts);
  }

  /** Сотворить заклинание, инвокацию, знак, провести ритуал или навести порчу. */
  cast(item, opts) {
    return castSpell(this, item, opts);
  }

  rollStunSave(opts) {
    return rollStunSave(this, opts);
  }

  rollDeathSave() {
    return deathSaveDialog(this);
  }

  async #check({ title, subtitle, parts, dc = null, mod = 0, skipDialog = false, flags, optional = [] }) {
    let luck = 0, messageMode;
    if (!skipDialog) {
      const choice = await rollDialog({ title, parts, luckMax: this.luckAvailable, dc, optional });
      if (!choice) return null;
      ({ dc, luck, messageMode } = choice);
      mod += choice.mod;
      parts.push(...choice.optional);
    } else {
      parts.push(...optional.filter(o => o.checked));
    }
    if (mod) parts.push({ label: "Модификатор", value: mod });
    return performCheck({ actor: this, title, subtitle, parts, dc, luck, messageMode, flags });
  }

  /** Пометка о состоянии, влияющем на параметры. */
  #stateNote() {
    const d = this.system.derived;
    if (d?.dying) return "При смерти: параметры ×⅓";
    if (d?.wounded) return "Ниже порога ранения: Реа, Лвк, Инт, Воля ×½";
    return "";
  }

  /* -------------------------------------------------------------------------- */

  async _preUpdate(changed, options, user) {
    const hp = foundry.utils.getProperty(changed, "system.hp.value");
    // Вышел из «при смерти» — накопленный штраф испытаний сбрасывается
    if (hp !== undefined && hp >= 0 && this.system.hp.value < 0) {
      foundry.utils.setProperty(changed, "system.deathSaves.penalty", 0);
    }
    return super._preUpdate(changed, options, user);
  }

  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    if (userId !== game.user.id) return;
    if (foundry.utils.getProperty(changed, "system.hp.value") === undefined) return;
    const dying = this.system.hp.value < 0 && !this.statuses.has("dead");
    if (dying !== this.statuses.has("dying")) {
      // Статус мог уже снять кто-то другой в том же тике — это не ошибка
      this.toggleStatusEffect("dying", { active: dying }).catch(err => console.debug("vedmak | dying sync:", err.message));
    }
  }
}
