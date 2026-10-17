// Дополнительное действие атаки у НИП (PLAN 4.264): по настройке мира «НИП: дополнительное действие атаки» в окне атаки
// НИП появляется та же галочка, что у персонажа; атака с ней — 3 Вын и −3.
const was = game.settings.get("vedmak", "monsterExtraAction");
const npc = await Actor.create({ name: "Прогон: НИП-боец", type: "monster", folder: folder.id,
  system: { sta: { value: 20, max: 20 }, skills: { brawling: { value: 5 } } } });
window.__noAutoDialog = true;
const dialogHasExtra = async () => {
  const seen = new Promise(res => {
    const id = Hooks.on("renderDialogV2", app => { Hooks.off("renderDialogV2", id); setTimeout(() => res(app), 300); });
  });
  const run = A.attack(npc, { kind: "unarmed" }, { targets: [] });
  const app = await Promise.race([seen, wait(5000).then(() => null)]);
  const has = !!app?.element?.querySelector('input[name="extraAction"]');
  await app?.close(); await run;
  return has;
};
try {
  stepName("настройка выключена");
  await game.settings.set("vedmak", "monsterExtraAction", false);
  ok(!(await dialogHasExtra()), "без настройки — у НИП в окне атаки нет доп. действия");

  stepName("настройка включена");
  await game.settings.set("vedmak", "monsterExtraAction", true);
  ok(await dialogHasExtra(), "с настройкой — у НИП в окне атаки есть «Дополнительное действие атаки»");
  const sta0 = npc.system.sta.value;
  const card = await A.attack(npc, { kind: "unarmed" }, { skipDialog: true, extraAction: true, targets: [] });
  const parts = card?.flags.vedmak?.attack?.roll?.parts ?? [];
  ok(npc.system.sta.value === sta0 - 3 && parts.some(p => p.label === "Доп. действие" && p.value === -3),
    `атака доп. действием: Вын ${sta0} → ${npc.system.sta.value}, −3 в броске`);
} finally {
  window.__noAutoDialog = false;
  await game.settings.set("vedmak", "monsterExtraAction", was);
  await npc.delete();
}
