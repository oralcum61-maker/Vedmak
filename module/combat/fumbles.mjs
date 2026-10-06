// Последствия критических провалов в бою (стр. 152–153). Таблица — FUMBLES в config/combat.mjs; кнопка «Применить»
// на карточке атаки или защиты делает то, что считается само: состояние, урон надёжности, выбитое оружие,
// испытание Уст, удар по себе (окно урона без атаки — ведущий может поправить). Застрявшее оружие и рикошет
// в союзника остаются текстом: кого задело и сколько раундов — решает ведущий.

import { FUMBLES, fumbleEffect } from "../config/combat.mjs";
import { resolveActor } from "./common.mjs";
import { registerChatAction } from "./chat.mjs";
import { rollStunSave } from "./saves.mjs";
import { manualDamage } from "./manual.mjs";
import { postCard } from "../util.mjs";

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/** Применить последствия провала с карточки атаки или защиты. */
export async function applyFumble(message) {
  const flags = message.flags.vedmak ?? {};
  const data = flags.attack ?? flags.defense;
  const f = data?.fumble;
  const fx = f ? fumbleEffect(f.kind, f.value) : null;
  if (!fx) return null;
  const who = flags.attack ? data.attacker : data.defender;
  const actor = resolveActor(who?.tokenUuid) ?? resolveActor(who?.actorUuid);
  if (!actor) return ui.notifications.warn("Персонаж не найден.");
  if (!actor.isOwner) return ui.notifications.warn("Последствия провала применяет владелец персонажа или ведущий.");
  if (flags.fumbleApplied) {
    const again = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Последствия провала" }, content: "<p>Последствия уже применены. Применить ещё раз?</p>"
    });
    if (!again) return null;
  }
  const item = f.itemId ? actor.items.get(f.itemId) : null;
  const lines = [];
  const rolls = [];
  if (fx.status && !actor.statuses.has(fx.status)) {
    await actor.toggleStatusEffect(fx.status, { active: true });
    lines.push(`${CONFIG.statusEffects[fx.status]?.name ?? fx.status}.`);
  }
  if (fx.reliability) {
    const r = await new Roll(fx.reliability).evaluate();
    rolls.push(r);
    if (item?.system.reliability?.max) {
      // В исходное значение, как блок: в system уже прибавлены модификации
      const src = item._source.system.reliability;
      await item.update({ "system.reliability.value": Math.max(0, src.value - r.total) });
      const rel = item.system.reliability;
      lines.push(`${esc(item.name)}: надёжность −${r.total} → ${rel.value}/${rel.max}${rel.value ? "" : " — сломано"}.`);
    } else lines.push(`Надёжность оружия −${r.total} (оружие не найдено — вычесть вручную).`);
  }
  if (fx.disarm) {
    const r = await new Roll("1d6").evaluate();
    rolls.push(r);
    if (item && "equipped" in item.system) await item.update({ "system.equipped": false });
    lines.push(`Из рук выбито оружие${item ? ` «${esc(item.name)}»` : ""}: отлетает на ${r.total} м${item ? ", на листе — убрано из рук" : ""}.`);
  }
  if (message.isOwner || game.user.isGM) await message.update({ "flags.vedmak.fumbleApplied": true });
  if (lines.length || rolls.length) {
    await postCard(actor, "Критический провал", lines.map(l => `<p>${l}</p>`).join(""),
      { icon: "fa-solid fa-skull-crossbones", subtitle: FUMBLES[f.kind]?.label ?? "", rolls });
  }
  if (fx.stun) await rollStunSave(actor, { reason: "Критический провал" });
  if (fx.head) {
    await manualDamage([actor], { formula: fx.head, where: "head", nonLethal: !!fx.nonLethal, damageType: "bludgeoning",
      reason: "Критический провал: удар головой" });
  }
  if (fx.selfHit) {
    const formula = (flags.attack ? data.damageFormula : item?.system.damage) || item?.system.damage || "1d6";
    await manualDamage([actor], { formula, where: "roll", damageType: item?.system.damageTypes?.[0] ?? "slashing",
      reason: flags.attack ? "Критический провал: ранил сам себя" : "Критический провал: оружие рикошетит" });
  }
  return true;
}

registerChatAction("applyFumble", message => applyFumble(message));
