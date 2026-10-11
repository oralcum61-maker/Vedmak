// Чистка зависших эффектов (PLAN 4.146): зависшее находится и снимается, нормальное — не трогается.
const CL = await import("/systems/vedmak/module/apps/cleanup.mjs");
const a = await Actor.create({ name: "Прогон: зависшее", type: "character", folder: folder.id });
const caster = await Actor.create({ name: "Прогон: заклинатель", type: "character", folder: folder.id });
const [spell] = await caster.createEmbeddedDocuments("Item", [{ name: "Проба поддержания", type: "spell" }]);
const fx = (name, flags, extra = {}) => ({ name, img: "icons/svg/aura.svg", flags: { vedmak: flags }, ...extra });
await a.createEmbeddedDocuments("ActiveEffect", [
  fx("ЗАВИС: регенерация без срока", { regen: 3 }),
  fx("ЗАВИС: поддержание пропало", { spellLink: { maintain: true, casterUuid: caster.uuid, itemId: "nonexistent000" } }),
  fx("ЗАВИС: срок вышел", {}, { duration: { value: 6, units: "seconds" }, start: { time: game.time.worldTime - 600 } }),
  fx("ЗАВИС: раунды вне боя", { timed: { key: "buff:x", rounds: 3 } }),
  fx("НОРМА: бафф на 10 минут", { spellBuff: { name: "x" } }, { duration: { value: 10, units: "minutes" }, start: { time: game.time.worldTime } }),
  fx("НОРМА: поддерживается", { spellLink: { maintain: true, casterUuid: caster.uuid, itemId: spell.id } }),
  fx("НОРМА: обычный эффект", {})
]);
await caster.createEmbeddedDocuments("ActiveEffect", [
  fx("НОРМА: Поддержание: Проба", { maintain: { itemId: spell.id, cost: 1 } }),
  fx("ЗАВИС: поддержание без заклинания", { maintain: { itemId: "nospell0000000", cost: 1 } })
]);
await a.setFlag("vedmak", "duelResolve", 4);
const found = CL.scanStuck().filter(f => f.actor.id === a.id || f.actor.id === caster.id);
const kinds = new Set(found.map(f => f.kind));
for (const k of Object.keys(CL.STUCK_KINDS)) ok(kinds.has(k), `найдено: ${CL.STUCK_KINDS[k].label}`);
ok(!found.some(f => /НОРМА/.test(f.label)), "нормальные эффекты не попали в находки");
const app = new CL.CleanupApp(); await app.render({ force: true }); await wait(600);
ok(app.element.querySelectorAll("input[data-id]").length >= found.length, "окно показывает находки с галочками");
await app.close();
const n = await CL.clearStuck(found.filter(f => f.kind !== "duelResolve"));
ok(n === 5, `снято ${n} из 5`);
ok(a.effects.every(e => /НОРМА/.test(e.name)) && caster.effects.every(e => /НОРМА/.test(e.name)), "остались только нормальные эффекты");
ok(a.getFlag("vedmak", "duelResolve") === 4, "«Решимость» без галочки не тронута");
