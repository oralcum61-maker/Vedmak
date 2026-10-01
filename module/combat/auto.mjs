// Автоматизация боя: защита НИП, бросок урона после попадания, применение урона и эффектов.
// Каждый шаг включается своей настройкой мира (по умолчанию все выключены). Шаг выполняет один клиент — тот, кто отвечает
// за актора, — поэтому карточки не дублируются, даже если у всех открыт чат.

import { defend, bestDefense } from "./defense.mjs";
import { damageFromDefense } from "./damage.mjs";
import { resolveActor, asGM, proxyMessageMode, defaultMessageMode } from "./common.mjs";
import { requestSpellEffects } from "../magic/effects.mjs";
import { verbalDefend, bestVerbalDefense } from "./verbal.mjs";

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
  // Карточки защиты создаёт клиент ведущего: его режим чата («Ведущему») спрятал бы их от игрока-атакующего,
  // поэтому берём режим карточки атаки, а для атаки игрока — «всем»
  const messageMode = proxyMessageMode(actorOf(attack.attacker), attack.config?.messageMode);
  for (const target of attack.targets ?? []) {
    const actor = actorOf(target);
    if (!actor) continue;
    if (onlyAuto) {
      if (setting("autoApply")) await defend(message, target, "auto", { skipDialog: true, messageMode });
      continue;
    }
    if (!setting("autoDefense") || actor.hasPlayerOwner) continue;
    await defend(message, target, bestDefense(actor, attack), { skipDialog: true, messageMode });
  }
}

/** Карточка защиты: попадание — урон без окна; магия без урона — эффекты; статус от приёма. */
async function onDefense(message, def) {
  const attacker = actorOf(def.attack.attacker);
  if (def.canDamage && setting("autoDamage") && isMine(attacker)) {
    // Если за атакующего-игрока бросает ведущий (игрока нет в сети), карточка урона не должна стать «Ведущему»
    await damageFromDefense(message, { skipDialog: true, messageMode: game.user.isGM ? proxyMessageMode(attacker, defaultMessageMode()) : undefined });
  }
  if (!setting("autoApply")) return;
  if (def.canApplyEffects && isMine(attacker)) await requestSpellEffects(message);
  if (def.hit && def.attack.hitStatus && game.users.activeGM?.isSelf) {
    await asGM("setStatus", { uuid: def.defender.tokenUuid ?? def.defender.actorUuid, status: def.attack.hitStatus, active: true, messageId: message.id });
  }
}

/** Словесная дуэль: цели ведущего отвечают сами — Игнорировать или Сменой темы, что выше. */
async function onVerbalAttack(message, atk) {
  if (!setting("autoDefense") || !game.users.activeGM?.isSelf) return;
  const messageMode = proxyMessageMode(actorOf(atk.attacker), atk.messageMode);
  for (const target of atk.targets ?? []) {
    const actor = actorOf(target);
    if (!actor || actor.hasPlayerOwner) continue;
    await verbalDefend(message, target, bestVerbalDefense(actor), { skipDialog: true, messageMode });
  }
}

/** Исход обмена в дуэли: ведущий снимает Решительность сразу. */
async function onVerbalOutcome(message, v) {
  if (!v.loss || v.applied || !setting("autoApply") || !game.users.activeGM?.isSelf) return;
  await asGM("verbalApply", { messageId: message.id });
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
      else if (flags.verbal?.kind === "attack") await onVerbalAttack(message, flags.verbal);
      else if (flags.verbal?.kind === "outcome") await onVerbalOutcome(message, flags.verbal);
    } catch (err) {
      console.error("vedmak | автоматизация боя", err);
    }
  });
}
