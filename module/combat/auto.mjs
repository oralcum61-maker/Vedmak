// Автоматизация боя: защита НИП, бросок урона после попадания, применение урона и эффектов.
// Каждый шаг включается своей настройкой мира. Шаг выполняет один клиент — тот, кто отвечает
// за актора, — поэтому карточки не дублируются, даже если у всех открыт чат.

import { defend, bestDefense } from "./defense.mjs";
import { damageFromDefense } from "./damage.mjs";
import { resolveActor, asGM } from "./common.mjs";
import { requestSpellEffects } from "../magic/effects.mjs";

const setting = key => game.settings.get("vedmak", key);

/** Кто бросает за актора: его игрок в сети, иначе ведущий. */
function responsibleUser(actor) {
  if (!actor) return game.users.activeGM;
  const players = game.users.filter(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  return players.find(u => u.character?.id === actor.id) ?? players[0] ?? game.users.activeGM;
}

const isMine = actor => responsibleUser(actor)?.isSelf ?? false;
const actorOf = ref => resolveActor(ref?.tokenUuid) ?? resolveActor(ref?.actorUuid);

/** Карточка атаки: цели без игрока защищаются сами, магия без защиты срабатывает на всех. */
async function onAttack(message, attack) {
  if (!game.users.activeGM?.isSelf) return;
  if (attack.spell && !attack.spell.works) return;
  const onlyAuto = attack.spell?.defenses?.length === 1 && attack.spell.defenses[0] === "auto";
  for (const target of attack.targets ?? []) {
    const actor = actorOf(target);
    if (!actor) continue;
    if (onlyAuto) {
      await defend(message, target, "auto", { skipDialog: true });
      continue;
    }
    if (!setting("autoDefense") || actor.hasPlayerOwner) continue;
    await defend(message, target, bestDefense(actor, attack), { skipDialog: true });
  }
}

/** Карточка защиты: попадание — урон без окна; магия без урона — эффекты; статус от приёма. */
async function onDefense(message, def) {
  const attacker = actorOf(def.attack.attacker);
  if (def.canDamage && setting("autoDamage") && isMine(attacker)) {
    await damageFromDefense(message, { skipDialog: true });
  }
  if (!setting("autoApply")) return;
  if (def.canApplyEffects && isMine(attacker)) await requestSpellEffects(message);
  if (def.hit && def.attack.hitStatus && game.users.activeGM?.isSelf) {
    await asGM("setStatus", { uuid: def.defender.tokenUuid ?? def.defender.actorUuid, status: def.attack.hitStatus, active: true });
  }
}

/** Карточка урона: ведущий применяет сразу. */
async function onDamage(message, dmg) {
  if (dmg.applied || !setting("autoApply") || !game.users.activeGM?.isSelf) return;
  await asGM("applyDamage", { messageId: message.id });
}

export function registerCombatAutomation() {
  Hooks.on("createChatMessage", async message => {
    const flags = message.flags?.vedmak;
    if (!flags) return;
    try {
      if (flags.attack?.kind === "attack") await onAttack(message, flags.attack);
      else if (flags.defense?.kind === "defense") await onDefense(message, flags.defense);
      else if (flags.damage?.kind === "damage") await onDamage(message, flags.damage);
    } catch (err) {
      console.error("vedmak | автоматизация боя", err);
    }
  });
}
