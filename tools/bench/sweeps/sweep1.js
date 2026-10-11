const log = (...a) => window.__log.push(a.join(" "));
const stepName = s => { window.__step = s; };
// Окна подтверждения и выбора — нажимаются сами (кнопка по умолчанию)
Hooks.on("renderDialogV2", app => setTimeout(() => {
  const b = app.element?.querySelector("footer button[autofocus], footer button.default, .form-footer button[autofocus]")
    ?? app.element?.querySelector("footer button, .form-footer button");
  b?.click();
}, 80));
const tabsOf = sheet => {
  const out = [];
  const T = sheet.constructor.TABS ?? {};
  for (const [group, cfg] of Object.entries(T)) for (const t of cfg.tabs ?? []) out.push([t.id, group]);
  return out;
};
async function sweepSheet(doc, label) {
  stepName(`лист: ${label}`);
  try {
    const sheet = doc.sheet;
    await sheet.render({ force: true });
    await wait(60);
    for (const [tab, group] of tabsOf(sheet)) {
      stepName(`лист: ${label} → ${group}/${tab}`);
      try { sheet.changeTab(tab, group, { force: true }); } catch (e) { log("ERR changeTab", label, tab, e.message); }
      await wait(40);
    }
    await sheet.close({ animate: false });
  } catch (e) { log("ERR sheet", label, e.message); }
}

// 1. Акторы мира
for (const a of game.actors.contents) await sweepSheet(a, `актор ${a.name} (${a.type})`);
log("акторов мира:", game.actors.size);

// 2. Предметы мира
for (const i of game.items.contents) await sweepSheet(i, `предмет мира ${i.name}`);

// 3. Компендиумы
for (const pack of game.packs.filter(p => p.metadata.packageName === "vedmak")) {
  stepName(`пакет ${pack.collection}`);
  let docs = [];
  try { docs = await pack.getDocuments(); } catch (e) { log("ERR pack", pack.collection, e.message); continue; }
  log("пакет", pack.collection, docs.length);
  if (pack.documentName === "Item") {
    for (const d of docs) await sweepSheet(d, `${pack.metadata.name}: ${d.name}`);
  } else if (pack.documentName === "Actor") {
    for (const d of docs) await sweepSheet(d, `${pack.metadata.name}: ${d.name}`);
  } else if (pack.documentName === "JournalEntry") {
    for (const d of docs) {
      stepName(`журнал ${d.name}`);
      try { await d.sheet.render({ force: true }); await wait(80); await d.sheet.close({ animate: false }); } catch (e) { log("ERR journal", d.name, e.message); }
    }
  } else if (pack.documentName === "RollTable") {
    for (const d of docs) {
      stepName(`таблица ${pack.metadata.name}: ${d.name}`);
      try { await d.roll(); } catch (e) { log("ERR table", d.name, e.message); }
    }
  }
}
stepName("готово");
log("конец части 1");
