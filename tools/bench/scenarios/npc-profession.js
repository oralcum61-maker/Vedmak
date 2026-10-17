// Профессии у НИП (PLAN 4.259): профессия перетаскивается на лист НИП — подвкладка «Профессия» на «Навыках» с
// определяющим навыком и древом (общий блок с персонажем), бросок, правка значения, замена второй профессией.
const until = async (test, ms = 4000) => { for (let t = 0; t < ms && !(await test()); t += 100) await wait(100); return test(); };
const docsOf = async type => {
  const out = [];
  for (const pack of game.packs.filter(p => p.documentName === "Item" && p.metadata.packageName === "vedmak")) {
    const idx = await pack.getIndex({ fields: ["type"] });
    if (idx.some(e => e.type === type)) out.push(...await pack.getDocuments({ type }));
  }
  return out;
};
const profs = await docsOf("profession");
const bard = profs.find(p => p.system.key === "bard"), mage = profs.find(p => p.system.key === "mage");
const npc = await Actor.create({ name: "Прогон: НИП-бард", type: "monster", folder: folder.id, system: { monsterClass: "humanoid" } });
const hero = await Actor.create({ name: "Прогон: герой с профессией", type: "character", folder: folder.id });
window.__noAutoDialog = true;
try {
  stepName("профессия на листе НИП");
  const sheet = npc.sheet; await sheet.render({ force: true }); await wait(800);
  sheet.changeTab("skills", "primary"); await wait(500);
  ok(!!sheet.element.querySelector(".npc-prof-hint"), "без профессии — подсказка «перетащите профессию»");
  await sheet._onDropItem(new DragEvent("drop"), bard); await wait(800);
  ok(npc.system.profession?.name === bard.name, `профессия у НИП: «${npc.system.profession?.name}»`);
  sheet.changeTab("skills", "primary"); await wait(400);
  sheet.element.querySelector('[data-group="skills"][data-tab="profession"]')?.click(); await wait(600);
  const pane = sheet.element.querySelector('.pane[data-tab="profession"]');
  ok(pane?.classList.contains("active") && pane.querySelector(".vp-def-name")?.textContent.trim() === bard.system.definingSkill.name
    && pane.querySelectorAll(".vp-branch").length === bard.system.branches.length,
    `подвкладка «Профессия»: определяющий «${pane?.querySelector(".vp-def-name")?.textContent.trim()}», ветвей ${pane?.querySelectorAll(".vp-branch").length}`);

  stepName("бросок и правка");
  const n0 = game.messages.size;
  pane.querySelector("[data-action=rollDefining]")?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); await wait(1200);
  ok(game.messages.size > n0 && game.messages.contents.at(-1)?.content.includes(bard.system.definingSkill.name), "бросок определяющего навыка НИП — в чат");
  const inp = sheet.element.querySelector('.pane[data-tab="profession"] input.defining-value');
  inp.value = "6"; inp.dispatchEvent(new Event("change", { bubbles: true })); await wait(900);
  ok(npc.system.profession?.system.definingSkill.value === 6, "значение определяющего навыка сохранено в профессии");

  stepName("замена профессии");
  const hook = Hooks.on("renderDialogV2", app => { setTimeout(() => app.element?.querySelector("footer [data-action=yes]")?.click(), 200); });
  await sheet._onDropItem(new DragEvent("drop"), mage); await wait(1200);
  Hooks.off("renderDialogV2", hook);
  ok(npc.itemTypes.profession.length === 1 && npc.system.profession?.name === mage.name, `вторая профессия заменила первую (${npc.itemTypes.profession.map(i => i.name).join(", ")})`);
  await sheet.close();

  stepName("персонаж — как раньше");
  await hero.createEmbeddedDocuments("Item", [bard.toObject()]);
  const hs = hero.sheet; await hs.render({ force: true }); await wait(800);
  hs.changeTab("skills", "primary"); await wait(400);
  hs.element.querySelector('[data-group="skills"][data-tab="profession"]')?.click(); await wait(600);
  ok(hs.element.querySelector('.pane[data-tab="profession"] .vp-def-name')?.textContent.trim() === bard.system.definingSkill.name,
    "у персонажа блок профессии — тот же, что был");
  await hs.close();
} finally {
  window.__noAutoDialog = false;
  for (const a of [npc, hero]) if (game.actors.get(a.id)) await a.delete();
}
