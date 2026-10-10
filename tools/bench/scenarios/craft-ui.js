// Вкладка «Ремесло»: текст и кнопки карточек алхимии не выходят за края (узкий лист, длинные названия),
// и проверки ремесла идут через окно модификаторов (dialogCheck): правка и Удача доходят до броска, отмена — null.
const pack = game.packs.get("vedmak.alchemy");
const docs = (await pack.getDocuments()).filter(d => d.type === "alchemical");
const pick = action => docs.filter(d => d.system.use?.action === action).sort((x, y) => (y.system.toxicity || 0) - (x.system.toxicity || 0))[0];
const chosen = ["trap", "oil", "throw", "drink", "mutagen"].map(pick).filter(Boolean);
ok(chosen.length >= 4, `предметы алхимии разных действий: ${chosen.map(d => d.name).join(", ")}`);
const a = await Actor.create({ name: "Прогон: ремесло", type: "character", folder: folder.id });
const long = chosen[0].toObject();
long.name = "Невероятнодлиннаяалхимическаясмесьбезединогопробеладлятестапереносастроки";
long.system.effect = "Оченьдлинноеописаниедействиябезпробелов".repeat(4) + " и обычный текст после него.";
await a.createEmbeddedDocuments("Item", [...chosen.map(d => d.toObject()), long]);

// Узкий лист: карточка в одну колонку
const sheet = a.sheet;
await sheet.render({ force: true, position: { width: 560, height: 700 } });
await wait(700);
sheet.changeTab?.("craft", "primary");
await wait(500);
const cards = [...sheet.element.querySelectorAll(".alch-card")];
ok(cards.length === chosen.length + 1, `карточек алхимии: ${cards.length}`);
const overflow = [];
for (const card of cards) {
  const box = card.getBoundingClientRect();
  for (const el of card.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    if (r.right > box.right + 1 || r.left < box.left - 1) overflow.push(`${card.querySelector(".item-name")?.textContent.slice(0, 24)} → ${el.className || el.tagName} (${Math.round(r.right - box.right)} px)`);
  }
}
ok(!overflow.length, `ничего не вылезает за карточки${overflow.length ? ": " + overflow.slice(0, 5).join("; ") : ""}`);
for (const w of [760, 980]) {
  sheet.setPosition({ width: w }); await wait(400);
  const bad = [...sheet.element.querySelectorAll(".alch-card")].filter(c => c.scrollWidth > c.clientWidth + 1).length;
  ok(!bad, `ширина листа ${w}: карточек с вылезанием ${bad}`);
}
await sheet.close();

// Окно модификаторов
const { dialogCheck } = await import("/systems/vedmak/module/dice/check.mjs");
await a.update({ "system.luck.value": 3 });
const parts = [{ label: "Рем", value: 6, always: true }, { label: "Изготовление", value: 4, always: true }];
const seenDlg = new Set();
const findDialog = async () => { for (let i = 0; i < 50; i++) { const d = [...foundry.applications.instances.values()].find(x => x.options?.classes?.includes("check-dialog") && x.rendered && !seenDlg.has(x)); if (d) seenDlg.add(d); if (d) return d; await wait(100); } return null; };
let pending = dialogCheck({ actor: a, title: "Проба правки", parts, dc: 15 });
let dlg = await findDialog();
ok(!!dlg, "окно модификаторов открылось");
if (dlg) {
  const f = dlg.element.querySelector("form") ?? dlg.element;
  f.querySelector('[name="mod"]').value = "3";
  const luck2 = f.querySelector('[name="luck"][value="2"]'); if (luck2) luck2.checked = true;
  dlg.element.querySelector('[data-action="roll"]').click();
}
const res = await pending;
ok(res?.parts?.some(p => p.label === "Модификатор" && p.value === 3), `правка +3 в слагаемых: ${res?.parts?.map(p => `${p.label} ${p.value}`).join(", ")}`);
ok(res?.base === 6 + 4 + 3 + 2, `основа с правкой и Удачей 2: ${res?.base} (ждём 15)`);
ok(a.system.luck.value === 1, `Удача списана: ${a.system.luck.value} (ждём 1)`);
pending = dialogCheck({ actor: a, title: "Проба отмены", parts, dc: 15 });
dlg = await findDialog();
dlg?.element.querySelector('[data-action="cancel"]').click();
const cancelled = await pending;
ok(cancelled === null, `отмена окна — null, броска нет: ${JSON.stringify(cancelled)?.slice(0, 120)} | окно «${dlg?.options?.window?.title}»`);
pending = dialogCheck({ actor: a, title: "Вынужденная", parts, dc: 15, forced: true });
dlg = await findDialog();
dlg?.element.querySelector('[data-action="cancel"]').click();
const forced = await pending;
ok(forced?.base === 10, `вынужденная проверка при отмене — без правок: ${forced?.base}`);
ok((await dialogCheck({ actor: a, title: "Без окна", parts, skipDialog: true }))?.base === 10, "skipDialog — сразу, без окна");
