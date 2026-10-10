// Часть 4: ход боя со всеми состояниями, худ «Медальон» (все вкладки и кнопки), ремесло по всем рецептам,
// усиления, починка и разбор, расследование и таверна.
const CR = await import("/systems/vedmak/module/crafting/craft.mjs");
const EN = await import("/systems/vedmak/module/crafting/enhancements.mjs");
const chars = game.actors.filter(a => a.type === "character" && !a.folder?.name?.startsWith("Прогон"));
const fighter = await cloneActor(chars.sort((a, b) => b.items.size - a.items.size)[0], "Прогон: боец");
const mage = await cloneActor(chars.sort((a, b) => (b.system.derived?.vigor ?? 0) - (a.system.derived?.vigor ?? 0))[0], "Прогон: маг");
const monsterDocs = await game.packs.get("vedmak.bestiary").getDocuments();
const dummySrc = monsterDocs.find(m => /бандит|разбойник|солдат/i.test(m.name)) ?? monsterDocs[0];
const dummy = await Actor.create({ ...dummySrc.toObject(), _id: undefined, name: "Прогон: чучело", folder: folder.id });
const beast = await Actor.create({ ...monsterDocs[Math.floor(monsterDocs.length / 2)].toObject(), _id: undefined, folder: folder.id });
const fTok = await placeToken(fighter, 1000, 1000);
const mTok = await placeToken(mage, 900, 1000);
const dTok = await placeToken(dummy, 1100, 1000);
const bTok = await placeToken(beast, 1100, 1100);
const keep = new Map([fighter, mage, dummy, beast].map(a => [a, snapshot(a)]));
const resetAll = async () => { for (const [a, k] of keep) await reset(a, k); };

if (!window.__skipFight) {
// --- 1. Ход боя со всеми состояниями ---
stepName("бой: создание");
const combat = await Combat.create({ scene: sc.id, active: true });
await combat.createEmbeddedDocuments("Combatant", [fTok, mTok, dTok, bTok].map(t => ({ tokenId: t.id, sceneId: sc.id, actorId: t.actorId })));
await combat.rollAll();
await combat.startCombat();
const statuses = CONFIG.statusEffects.map(s => s.id).filter(Boolean);
log("состояний:", statuses.length);
for (const [i, sid] of statuses.entries()) {
  const actor = [fighter, dummy, beast, mage][i % 4];
  stepName(`бой: состояние ${sid} на ${actor.name}`);
  try { await actor.toggleStatusEffect(sid, { active: true }); } catch (e) { log("ERR состояние", sid, e.message); }
}
for (let t = 0; t < 16; t++) {
  stepName(`бой: ход ${t + 1} (раунд ${combat.round}, ${combat.combatant?.name})`);
  try { await combat.nextTurn(); } catch (e) { log("ERR nextTurn", e.message); }
  await wait(400);
  await crawl(`бой: ход ${t + 1}`, 2);
}
// Состояния снимаются
for (const a of [fighter, dummy, beast, mage]) for (const sid of statuses) {
  if (!a.statuses.has(sid)) continue;
  stepName(`бой: снять ${sid} с ${a.name}`);
  try { await a.toggleStatusEffect(sid, { active: false }); } catch (e) { log("ERR снять", sid, e.message); }
}
await clearChat(); seen = new Set();

// --- 2. Худ «Медальон»: каждая вкладка и каждая кнопка ---
const hudSkip = new Set(["nextTurn", "toggleCollapse", "flipToken", "openSheet"]);
for (const tok of [fTok, mTok, bTok]) {
  stepName(`худ: ${tok.name}`);
  try {
    tok.object.control({ releaseOthers: true });
    await wait(600);
    const hud = foundry.applications.instances.get("vedmak-combat-hud");
    if (!hud?.rendered) { log("худ не открылся для", tok.name); continue; }
    const tabs = [...hud.element.querySelectorAll("[data-action='setTab']")].map(b => b.dataset.tab);
    log("худ", tok.name, "вкладки:", tabs.join(","));
    for (const tab of tabs) {
      stepName(`худ: ${tok.name} → вкладка ${tab}`);
      hud.element.querySelector(`[data-action='setTab'][data-tab='${tab}']`)?.click();
      await wait(300);
      const done = new Set();
      for (let k = 0; k < 30; k++) {
        const b = [...hud.element.querySelectorAll("[data-action]")]
          .find(x => !hudSkip.has(x.dataset.action) && x.dataset.action !== "setTab" && !done.has(x.dataset.action + "|" + (x.dataset.status ?? "")));
        if (!b) break;
        done.add(b.dataset.action + "|" + (b.dataset.status ?? ""));
        stepName(`худ: ${tok.name} → ${tab} → ${b.dataset.action}`);
        b.click();
        await wait(700);
        await crawl(`худ ${tok.name} ${b.dataset.action}`, 2);
        // Открытые листы и окна после кнопки — закрыть
        for (const app of foundry.applications.instances.values()) {
          if (app.id !== "vedmak-combat-hud" && app.rendered && app.hasFrame && !(app instanceof foundry.applications.sidebar.AbstractSidebarTab)) {
            try { await app.close({ animate: false }); } catch {}
          }
        }
      }
    }
  } catch (e) { log("ERR худ", tok.name, e.message, (e.stack ?? "").split("\n").slice(1, 3).join(" ")); }
  await resetAll();
}
await combat.delete();
await clearChat(); seen = new Set();
}

// --- 3. Ремесло: каждый рецепт с материалами и инструментами ---
const recipes = [];
for (const pack of game.packs.filter(p => p.documentName === "Item" && p.metadata.packageName === "vedmak")) {
  const idx = await pack.getIndex({ fields: ["type"] });
  if (!idx.some(e => e.type === "recipe")) continue;
  for (const d of await pack.getDocuments({ type: "recipe" })) recipes.push(d);
}
log("рецептов:", recipes.length);
const crafter = fighter;
// Инструменты: по предмету каждого вида
const toolItems = [];
for (const pack of game.packs.filter(p => p.documentName === "Item" && p.metadata.packageName === "vedmak")) {
  for (const d of await pack.getDocuments({ type: "gear" })) if (d.system.tool && !toolItems.some(t => t.system.tool === d.system.tool)) toolItems.push(d);
}
log("инструменты:", toolItems.map(t => `${t.name}=${t.system.tool}`).join(", "));
await crafter.createEmbeddedDocuments("Item", toolItems.map(t => { const o = t.toObject(); delete o._id; return o; }));
const componentsBySubstance = {};
for (const pack of game.packs.filter(p => p.documentName === "Item" && p.metadata.packageName === "vedmak")) {
  const idx = await pack.getIndex({ fields: ["type", "system.substance"] });
  for (const e of idx) if (e.type === "component" && e.system?.substance && !componentsBySubstance[e.system.substance]) componentsBySubstance[e.system.substance] = await pack.getDocument(e._id);
}
await crafter.update({ "system.money.crowns": 100000 });
const cKeepItems = new Set(crafter.items.map(i => i.id));
let ri = Number(window.__fromR ?? 0), crafted = 0;
const fails = {};
for (const rd of recipes.slice(Number(window.__fromR ?? 0))) {
  ri++;
  stepName(`ремесло ${ri}/${recipes.length}: ${rd.name}`);
  let recipe;
  try {
    const data = rd.toObject(); delete data._id;
    [recipe] = await crafter.createEmbeddedDocuments("Item", [data]);
    // Окно — раз в 15 рецептов (проверка шаблона), иначе сразу
    if (ri % 15 === 1) { await CR.craft(crafter, recipe); await wait(200); }
    for (const c of recipe.system.components) {
      const have = CR.countNamed(crafter, c.name);
      if (have < c.quantity) await CR.giveItem(crafter, await CR.findItemData(c.name), c.quantity - have);
    }
    for (const [key, need] of recipe.system.substanceList) {
      const src = componentsBySubstance[key];
      if (!src) { log("нет ингредиента с субстанцией", key, "для", rd.name); continue; }
      await CR.giveItem(crafter, src.toObject(), need);
    }
    const before = crafter.items.size;
    await CR.craft(crafter, recipe, { skipDialog: true });
    await wait(100);
    await crawl(`ремесло ${rd.name}`, 2);
    const req = CR.requirements(crafter, recipe);
    if (crafter.items.size !== before || game.messages.size) crafted++;
    else fails[rd.name] = JSON.stringify({ mat: req.materialsOk, tools: req.toolsOk });
  } catch (e) { log("ERR ремесло", rd.name, e.message, (e.stack ?? "").split("\n").slice(1, 3).join(" ")); }
  // Всё созданное — убрать, инструменты оставить
  const extra = crafter.items.filter(i => !cKeepItems.has(i.id)).map(i => i.id);
  if (extra.length) await crafter.deleteEmbeddedDocuments("Item", extra);
  if (ri % 10 === 0) { await clearChat(); seen = new Set(); }
}
log("ремесло: прошло", crafted, "из", recipes.length, "; без результата:", Object.keys(fails).length, JSON.stringify(fails).slice(0, 1500));
await clearChat(); seen = new Set();

// --- 4. Починка, разбор, усиления ---
const weapon = fighter.itemTypes.weapon[0];
const armor = fighter.itemTypes.armor.find(a => !a.system.isShield);
for (const [label, fn] of [
  ["починка оружия", () => weapon && CR.repair(fighter, weapon)],
  ["починка брони", () => armor && CR.repair(fighter, armor)],
  ["разбор оружия", () => weapon && CR.disassemble(fighter, weapon)]
]) {
  stepName(label);
  try { await fn(); await wait(300); await crawl(label, 2); } catch (e) { log("ERR", label, e.message); }
}
const enh = [];
for (const d of await game.packs.get("vedmak.enhancements").getDocuments()) enh.push(d);
log("усилений:", enh.length);
for (const ed of enh) {
  stepName(`усиление ${ed.name}`);
  let it;
  try {
    const data = ed.toObject(); delete data._id;
    [it] = await fighter.createEmbeddedDocuments("Item", [data]);
    await EN.attachEnhancement(fighter, it);
    await wait(200);
    await crawl(`усиление ${ed.name}`, 1);
  } catch (e) { log("ERR усиление", ed.name, e.message, (e.stack ?? "").split("\n").slice(1, 3).join(" ")); }
  try { if (it && fighter.items.has(it.id)) await it.delete(); } catch {}
}
await clearChat(); seen = new Set();

// --- 5. Расследование и таверна: окна и все кнопки ---
for (const [label, open, id] of [
  ["расследование", () => game.vedmak.investigation.open(), "vedmak-investigation"],
  ["таверна", () => game.vedmak.tavern.open(), "vedmak-tavern"]
]) {
  stepName(label);
  try {
    await open();
    await wait(800);
    const app = [...foundry.applications.instances.values()].find(a => a.rendered && (a.id?.startsWith(id) || a.constructor.name.toLowerCase().includes(label === "таверна" ? "tavern" : "investigation")));
    if (!app) { log("окно не найдено:", label); continue; }
    const done = new Set();
    for (let k = 0; k < 40; k++) {
      const b = [...app.element.querySelectorAll("[data-action]")].find(x => !done.has(x.dataset.action + "|" + JSON.stringify(x.dataset)) && !["close", "delete", "remove"].some(s => x.dataset.action.toLowerCase().includes(s)));
      if (!b) break;
      done.add(b.dataset.action + "|" + JSON.stringify(b.dataset));
      stepName(`${label} → ${b.dataset.action}`);
      b.click();
      await wait(500);
      await crawl(`${label} ${b.dataset.action}`, 2);
      if (!app.rendered) { await open(); await wait(500); }
    }
    log(label, "кнопок нажато:", done.size);
    await app.close();
  } catch (e) { log("ERR", label, e.message, (e.stack ?? "").split("\n").slice(1, 3).join(" ")); }
}
await clearChat();
stepName("готово");
log("нажатия кнопок карточек:", JSON.stringify(counts));
log("конец части 4");
