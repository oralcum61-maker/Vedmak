// Разовые правки данных мира (PLAN 4.67). Запускаются у ведущего при загрузке; каждая — один раз на мир
// (отметка в скрытой настройке мира), повторный запуск ничего не меняет.

import { SYSTEM_ID } from "./util.mjs";

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

const MIGRATIONS = [{ key: "bestiaryVigor", run: bestiaryVigor }];

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
