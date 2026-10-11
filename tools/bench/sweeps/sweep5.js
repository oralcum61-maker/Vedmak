// Часть 5: кнопки листов (копии всех персонажей мира и чудовище) и мастер создания — каждая кнопка каждой вкладки.
const SKIP_ACTIONS = new Set(["tab", "setTab", "close", "configureSheet", "configurePrototypeToken", "configureToken", "copyUuid",
  "showPortraitArtwork", "showTokenArtwork", "editImage", "toggleControls", "openWizard", "investigation", "profileSheet"]);
const closeOthers = async keep => {
  for (const app of [...foundry.applications.instances.values()]) {
    if (app === keep || !app.rendered || !app.hasFrame) continue;
    if (app instanceof foundry.applications.sidebar.AbstractSidebarTab) continue;
    if (app.id === "vedmak-combat-hud") continue;
    try { await app.close({ animate: false }); } catch {}
  }
};
/** Нажать в окне каждую кнопку действия по разу (по виду действия и его data-атрибутам), заново находя их после перерисовки. */
async function clickAll(app, label, { perAction = 1, budget = 60, perKind = {} } = {}) {
  const done = new Set();
  for (let k = 0; k < budget; k++) {
    if (!app.rendered) break;
    const b = [...app.element.querySelectorAll("[data-action]")].find(x => {
      const a = x.dataset.action;
      if (SKIP_ACTIONS.has(a) || x.disabled || x.closest("[hidden]")) return false;
      if ((perKind[a] ?? 0) >= perAction) return false;
      return !done.has(a + "|" + JSON.stringify(x.dataset));
    });
    if (!b) break;
    const a = b.dataset.action;
    done.add(a + "|" + JSON.stringify(b.dataset));
    perKind[a] = (perKind[a] ?? 0) + 1;
    counts[a] = (counts[a] ?? 0) + 1;
    stepName(`${label} → ${a} ${JSON.stringify(b.dataset).slice(0, 80)}`);
    try { b.click(); } catch (e) { log("ERR click", label, a, e.message); }
    await wait(200);
    if (game.messages.contents.some(m => !seen.has(m.id) && mine(m))) await crawl(`${label} ${a}`, 1);
    await closeOthers(app);
  }
  return done.size;
}

const chars = game.actors.filter(a => a.type === "character" && !a.folder?.name?.startsWith("Прогон"));
const monsters = await game.packs.get("vedmak.bestiary").getDocuments();
const sources = [...chars, monsters.find(m => m.items.some(i => i.type === "spell")) ?? monsters[0]];
if (window.__only) sources.splice(0, sources.length, ...sources.filter(a => window.__only.includes(a.name)));
if (window.__noWizard) window.__limitRaces = 0;
for (const src of sources) {
  let actor;
  try {
    actor = await Actor.create({ ...src.toObject(), _id: undefined, name: `Прогон: ${src.name}`, folder: folder.id });
    const tok = await placeToken(actor, 1000, 1000);
    const keep = snapshot(actor);
    const sheet = actor.sheet;
    await sheet.render({ force: true });
    await wait(300);
    const tabs = [];
    for (const [group, cfg] of Object.entries(sheet.constructor.TABS ?? {})) for (const t of cfg.tabs ?? []) tabs.push([t.id, group]);
    let pressed = 0;
    const perKind = {};
    for (const [tab, group] of tabs) {
      stepName(`лист ${src.name}: вкладка ${group}/${tab}`);
      try { sheet.changeTab(tab, group, { force: true }); } catch { continue; }
      await wait(150);
      pressed += await clickAll(sheet, `лист ${src.name} [${tab}]`, { perKind });
      if (!sheet.rendered) await sheet.render({ force: true });
      await reset(actor, keep);
    }
    // Режим прокачки — те же кнопки «+»
    if (actor.type === "character" && sheet.rendered) {
      stepName(`лист ${src.name}: прокачка`);
      await actor.update({ "system.improvementPoints.value": 200 }).catch(() => {});
      sheet.element.querySelector("[data-action='toggleAdvance']")?.click();
      await wait(300);
      pressed += await clickAll(sheet, `лист ${src.name} [прокачка]`, { perAction: 2, budget: 40, perKind: {} });
    }
    log("лист", src.name, "нажато", pressed);
    await sheet.close({ animate: false });
    await tok.delete();
  } catch (e) { log("ERR лист", src.name, e.message, (e.stack ?? "").split("\n").slice(1, 3).join(" ")); }
  await clearChat(); seen = new Set();
}

// --- Мастер создания: каждая раса, по кнопкам ---
const { CharacterWizard } = await import("/systems/vedmak/module/character/wizard.mjs");
const raceIdx = [];
for (const pack of game.packs.filter(p => p.documentName === "Item" && p.metadata.packageName === "vedmak")) {
  const idx = await pack.getIndex({ fields: ["type"] });
  for (const e of idx) if (e.type === "race") raceIdx.push(e);
}
log("рас:", raceIdx.length);
for (const r of raceIdx.slice(0, Number(window.__limitRaces ?? 999))) {
  let actor;
  try {
    actor = await Actor.create({ name: `Прогон: мастер ${r.name}`, type: "character", folder: folder.id });
    const wiz = new CharacterWizard({ actor });
    await wiz.render({ force: true });
    await wait(500);
    // Раса — эта
    stepName(`мастер ${r.name}: раса`);
    const pick = [...wiz.element.querySelectorAll("[data-action='pickRace']")].find(b => b.dataset.uuid === r.uuid || b.textContent.includes(r.name));
    if (pick) { pick.click(); await wait(500); } else log("мастер: нет кнопки расы", r.name);
    // По шагам: на каждом — все кнопки, кроме выбора расы и «Применить»
    for (let s = 0; s < 10 && wiz.rendered; s++) {
      stepName(`мастер ${r.name}: шаг ${wiz.wiz.step}`);
      SKIP_ACTIONS.add("pickRace"); SKIP_ACTIONS.add("apply"); SKIP_ACTIONS.add("step"); SKIP_ACTIONS.add("prev"); SKIP_ACTIONS.add("next");
      await clickAll(wiz, `мастер ${r.name} [${wiz.wiz.step}]`, { perAction: 2, budget: 30 });
      const before = wiz.wiz.step;
      wiz.element.querySelector("[data-action='next']")?.click();
      await wait(500);
      if (wiz.wiz.step === before) break;
    }
    stepName(`мастер ${r.name}: применить`);
    wiz.element?.querySelector("[data-action='apply']")?.click();
    await wait(1500);
    log("мастер", r.name, "→ шаг", wiz.wiz.step, "раса", actor.system.race?.name ?? "—", "профессия", actor.system.profession?.name ?? "—");
    await closeOthers(null);
  } catch (e) { log("ERR мастер", r.name, e.message, (e.stack ?? "").split("\n").slice(1, 3).join(" ")); }
  try { if (actor) await actor.delete(); } catch {}
  await clearChat(); seen = new Set();
}
stepName("готово");
log("нажатия:", JSON.stringify(counts));
log("конец части 5");
