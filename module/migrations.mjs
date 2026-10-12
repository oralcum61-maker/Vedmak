// Разовые правки данных мира (PLAN 4.67). Запускаются у ведущего при загрузке; каждая — один раз на мир
// (отметка в скрытой настройке мира), повторный запуск ничего не меняет.

import { SYSTEM_ID } from "./util.mjs";
import { convertMigratedLoot } from "./character/storage.mjs";

/**
 * Энергия НИП из бестиария. Генератор брал её не из того поля, и маги с ведьмаками пришли с Энергией 0.
 * Компендиум исправлен; уже вынесенные в мир берут Энергию из своего источника в компендиуме — только если
 * у них самих 0, то есть ведущий её не задавал.
 */
async function bestiaryVigor() {
  const updates = [];
  for (const actor of game.actors) {
    if (actor.type !== "monster" || (actor._source.system?.vigor ?? 0) !== 0) continue;
    const source = actor._stats?.compendiumSource ?? actor.flags?.core?.sourceId;
    if (!source?.startsWith("Compendium.vedmak.bestiary.")) continue;
    const original = await fromUuid(source).catch(() => null);
    const vigor = original?._source?.system?.vigor ?? 0;
    if (vigor > 0) updates.push({ _id: actor.id, "system.vigor": vigor });
  }
  if (updates.length) {
    await Actor.updateDocuments(updates);
    ui.notifications.info(`Ведьмак: Энергия возвращена НИП из бестиария (${updates.length}).`);
  }
}

/**
 * Токены существ из бестиария можно вращать: генератор запрещал вращение. Снимается у прототипов НИП из
 * бестиария в мире и у их токенов на всех сценах; токены, где запрет ставил ведущий у своих актёров, не трогаются.
 */
async function bestiaryRotation() {
  const fromBestiary = a => (a?._stats?.compendiumSource ?? a?.flags?.core?.sourceId ?? "").startsWith("Compendium.vedmak.bestiary.");
  const actors = game.actors.filter(a => fromBestiary(a) && a.prototypeToken?.lockRotation)
    .map(a => ({ _id: a.id, "prototypeToken.lockRotation": false }));
  if (actors.length) await Actor.updateDocuments(actors);
  let tokens = 0;
  for (const scene of game.scenes) {
    const updates = scene.tokens.filter(t => t.lockRotation && fromBestiary(t.actor ?? game.actors.get(t.actorId)))
      .map(t => ({ _id: t.id, lockRotation: false }));
    if (updates.length) { await scene.updateEmbeddedDocuments("Token", updates); tokens += updates.length; }
  }
  if (actors.length || tokens) ui.notifications.info(`Ведьмак: токены существ из бестиария можно вращать (${actors.length} НИП, ${tokens} токенов на сценах).`);
}

/**
 * «Добыча» из TheWitcherTRPG (сундуки, повозки, лавки) была перенесена персонажами — своего хранилища не было
 * (PLAN 4.108). Теперь это хранилища: вещи на листе одним списком, игроки берут и покупают (PLAN 4.115).
 */
async function storagesFromMigratedLoot() {
  const n = await convertMigratedLoot();
  if (n) ui.notifications.info(`Ведьмак: перенесённая «добыча» стала хранилищами — сундуки, повозки, лавки (${n}).`);
}

/**
 * Высший вампир — третья редакция (PLAN 4.132): у вампиров мира раса лежит копией со старыми навыками (бросок без Воли,
 * СЛ второй редакции, прежние названия). Навыки и черты берутся из компендиума, уровни, роли и ОК — свои; когти — 4d6+3.
 */
async function vampireThirdEdition() {
  const pack = game.packs.get("vedmak.races");
  const entry = (await pack?.getIndex({ fields: ["system.key"] }))?.find(e => e.system?.key === "highVampire");
  const source = entry ? (await pack.getDocument(entry._id)).toObject() : null;
  if (!source) return;
  const byKey = new Map(source.system.powers.map(p => [p.key, p]));
  let n = 0;
  for (const actor of game.actors) {
    const race = actor.items.find(i => i.type === "race" && i.system.key === "highVampire");
    if (!race) continue;
    const powers = race.system.toObject().powers.map(p => (byKey.has(p.key) ? { ...byKey.get(p.key), value: p.value } : p));
    await race.update({ "system.powers": powers, "system.traits": source.system.traits, "system.description": source.system.description });
    const claws = actor.items.filter(i => i.type === "weapon" && i.name === "Когти высшего вампира" && i.system.damage === "5d6+3");
    if (claws.length) await actor.updateEmbeddedDocuments("Item", claws.map(i => ({ _id: i.id, "system.damage": "4d6+3" })));
    n++;
  }
  if (n) ui.notifications.info(`Ведьмак: высшие вампиры мира переведены на третью редакцию (${n}).`);
}

/**
 * «Вампирская регенерация» стала одной на все степени критических ранений (правка автора 12.10, PLAN 4.218): у рас
 * на персонажах и в мире — вид «открывается раз» за 30 ОК; у кого была открыта хоть одна стадия — регенерация открыта.
 */
/** Текст «Вампирской регенерации» (PLAN 4.221) — тот же, что в компендиуме рас (tools/pack-overrides.mjs). */
const CRIT_HEALING_TEXT = "Залечивает критические ранения любой степени. Открывается один раз за 30 ОК — больше ничего докупать не нужно. В начале каждого хода заживает одно ранение, начиная с самого лёгкого: оно сразу стабилизируется и затягивается за 1 раунд (лёгкое), 2 (среднее), 3 (тяжёлое) или 4 (смертельное). Вне боя ранения заживают сразу. Ранения, полученные в Истинной форме, остаются и после выхода из неё и продолжают заживать; полученные до превращения в форму не переходят.";

async function vampireCritHealingOnce() {
  const fix = race => {
    const powers = race.system.toObject().powers ?? [];
    const p = powers.find(x => x.key === "critHealing");
    if (!p || p.kind === "once") return null;
    Object.assign(p, { kind: "once", max: 1, unlockCost: 30, levelCost: 0, stageCosts: [], value: p.value > 0 ? 1 : 0,
      description: CRIT_HEALING_TEXT });
    return { _id: race.id, "system.powers": powers };
  };
  let n = 0;
  for (const actor of game.actors) {
    const updates = actor.items.filter(i => i.type === "race").map(fix).filter(Boolean);
    if (updates.length) { await actor.updateEmbeddedDocuments("Item", updates); n += updates.length; }
  }
  const world = game.items.filter(i => i.type === "race").map(fix).filter(Boolean);
  if (world.length) { await Item.updateDocuments(world); n += world.length; }
  if (n) ui.notifications.info(`Ведьмак: «Вампирская регенерация» — одна на все ранения, 30 ОК (${n}).`);
}

/** Новый текст «Вампирской регенерации» у рас, уже переведённых на одну покупку (PLAN 4.221). */
async function vampireCritHealingText() {
  const fix = race => {
    const powers = race.system.toObject().powers ?? [];
    const p = powers.find(x => x.key === "critHealing");
    if (!p || p.description === CRIT_HEALING_TEXT) return null;
    p.description = CRIT_HEALING_TEXT;
    return { _id: race.id, "system.powers": powers };
  };
  for (const actor of game.actors) {
    const updates = actor.items.filter(i => i.type === "race").map(fix).filter(Boolean);
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  }
  const world = game.items.filter(i => i.type === "race").map(fix).filter(Boolean);
  if (world.length) await Item.updateDocuments(world);
}

const MIGRATIONS = [{ key: "bestiaryVigor", run: bestiaryVigor }, { key: "bestiaryRotation", run: bestiaryRotation },
  { key: "storagesFromMigratedLoot", run: storagesFromMigratedLoot }, { key: "vampireThirdEdition", run: vampireThirdEdition },
  { key: "vampireCritHealingOnce", run: vampireCritHealingOnce },
  { key: "vampireCritHealingText", run: vampireCritHealingText }];

export function registerMigrationSettings() {
  game.settings.register(SYSTEM_ID, "migrationsDone", { scope: "world", config: false, type: Array, default: [] });
}

export async function runMigrations() {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  const done = new Set(game.settings.get(SYSTEM_ID, "migrationsDone") ?? []);
  for (const m of MIGRATIONS) {
    if (done.has(m.key)) continue;
    try {
      await m.run();
      done.add(m.key);
      await game.settings.set(SYSTEM_ID, "migrationsDone", [...done]);
    } catch (err) {
      console.error(`vedmak | правка данных «${m.key}»`, err);
    }
  }
}
