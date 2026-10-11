// Отпечаток вычисленных стилей: лист персонажа (все вкладки), окно настроек ядра и худ. Сохраняется в
// results/style-snapshot.json. Запуск: node tools/bench/run.mjs tools/bench/style-snapshot.js; сравнение до и после
// правки CSS — node tools/bench/style-diff.mjs <до.json> <после.json>.
// Нужен, когда селекторы переписываются ради скорости (PLAN 4.167): внешне не должно меняться ничего.
const PROPS = ["cursor", "scrollbar-color", "scrollbar-width", "color", "background-color", "background-image", "font-family", "font-size",
  "font-weight", "padding", "margin", "border", "box-shadow", "text-shadow", "display", "opacity"];
const snap = {};
const take = (label, root) => {
  if (!root) return;
  const els = [root, ...root.querySelectorAll("*")];
  els.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const key = `${label} ${i} ${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : ""}`;
    snap[key] = PROPS.map(p => cs.getPropertyValue(p)).join("|");
  });
};
const a = await Actor.create({ name: "Прогон: отпечаток", type: "character", folder: folder.id });
await a.sheet.render({ force: true }); await wait(1200);
for (const tab of [...a.sheet.element.querySelectorAll("nav.sheet-tabs a[data-tab]")].map(t => t.dataset.tab)) {
  a.sheet.changeTab(tab, "primary", { force: true }); await wait(500);
  take(`лист:${tab}`, a.sheet.element);
}
await a.sheet.close();
const settings = new foundry.applications.settings.SettingsConfig(); await settings.render({ force: true }); await wait(1000);
take("настройки", settings.element); await settings.close();
const tok = await placeToken(a, 1200, 1000); tok.object.control({ releaseOthers: true }); await wait(1200);
take("худ", document.getElementById("vedmak-combat-hud"));
take("тело", document.body.querySelector("#ui-left"));
window.__styleSnap = snap;
log(`отпечаток: ${Object.keys(snap).length} элементов`);
ok(Object.keys(snap).length > 200, "отпечаток снят");
log("SNAP:" + JSON.stringify(snap));
