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

// Окно модификаторов: окна этого сценария нажимаем сами — автонажатие помощника выключено
window.__noAutoDialog = true;
const { dialogCheck } = await import("/systems/vedmak/module/dice/check.mjs");
await a.update({ "system.luck.value": 3 });
const parts = [{ label: "Рем", value: 6, always: true }, { label: "Изготовление", value: 4, always: true }];
const seenDlg = new Set();
const findDialog = async (tries = 50) => { for (let i = 0; i < tries; i++) { const d = [...foundry.applications.instances.values()].find(x => x.options?.classes?.includes("check-dialog") && x.rendered && !seenDlg.has(x)); if (d) seenDlg.add(d); if (d) return d; await wait(100); } return null; };
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

// Пояснение и Сложность в окне модификаторов (intro, editDc): починка — одно окно вместо двух
pending = dialogCheck({ actor: a, title: "Правка СЛ", parts, dc: 18, intro: "<p class=\"vd-intro-probe\">что тратится</p>", editDc: true });
dlg = await findDialog();
ok(!!dlg?.element.querySelector(".dlg-intro .vd-intro-probe"), "пояснение над полями окна");
const dcInput = dlg?.element.querySelector('[name="dc"]');
ok(dcInput?.value === "18", `поле Сложности с предложенной: ${dcInput?.value}`);
if (dcInput) { dcInput.value = "3"; dcInput.dispatchEvent(new Event("input", { bubbles: true })); }
ok(dlg?.element.querySelector(".dlg-note")?.textContent === "Нужно больше 3", `подпись Сложности в шапке следует за полем: «${dlg?.element.querySelector(".dlg-note")?.textContent}»`);
dlg?.element.querySelector('[data-action="roll"]').click();
const edited = await pending;
ok(edited?.dc === 3, `Сложность из окна: ${edited?.dc} (ждём 3)`);

// Починка протеза: одно окно (Сложность в нём же), отмена ничего не меняет, успех — Надёжность до максимума
const gear = game.packs.get("vedmak.gear");
const gIdx = await gear.getIndex();
const sideritId = gIdx.find(e => e.name === "Протез из сидерита")?._id;
ok(!!sideritId, "протез из сидерита в компендиуме");
if (sideritId) {
  const [pros] = await a.createEmbeddedDocuments("Item", [(await gear.getDocument(sideritId)).toObject()]);
  await pros.update({ "system.equipped": true });
  await pros.setFlag("vedmak", "reliability", 5);
  const { repair } = await import("/systems/vedmak/module/crafting/craft.mjs");
  const before = foundry.applications.instances.size;
  // До окна repair ищет чертёж по компендиуму рецептов — в свежем браузере это несколько секунд
  let p = repair(a, pros);
  dlg = await findDialog(200);
  await wait(300);
  const opened = [...foundry.applications.instances.values()].filter(x => x.rendered && x.options?.classes?.includes("vedmak-dialog")).length;
  ok(opened === 1, `у починки протеза одно окно: ${opened}`);
  ok(dlg?.element.querySelector('[name="dc"]')?.value === "18", `Сложность протеза по книге — 18: ${dlg?.element.querySelector('[name="dc"]')?.value}`);
  dlg?.element.querySelector('[data-action="cancel"]').click();
  const cancelRes = await p;
  log(`отмена починки вернула: ${cancelRes === null ? "null" : JSON.stringify(cancelRes)?.slice(0, 160)}`);
  ok(cancelRes === null && pros.getFlag("vedmak", "reliability") === 5, `отмена — Надёжность не тронута: ${pros.getFlag("vedmak", "reliability")}`);
  p = repair(a, pros);
  dlg = await findDialog(200);
  dlg.element.querySelector('[name="dc"]').value = "0";
  dlg.element.querySelector('[data-action="roll"]').click();
  const fixed = await p;
  log(`починка: СЛ ${fixed?.dc}, итог ${fixed?.total}, успех ${fixed?.success}, d10 ${JSON.stringify(fixed?.dice)}`);
  // Критический провал d10 возможен и при СЛ 0 — тогда Надёжность не меняется
  const relNow = pros.getFlag("vedmak", "reliability");
  ok(fixed?.dc === 0 && relNow === (fixed.success ? 15 : 5), `починка со СЛ 0: ${fixed?.success ? "успех" : "провал"}, Надёжность ${relNow}`);
}
window.__noAutoDialog = false;
