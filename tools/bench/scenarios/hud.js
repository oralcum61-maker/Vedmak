// Худ «Медальон на цепи» (PLAN 4.163): появляется у выделенного токена, медальон с числами, гнёзда, ярлыки и списки;
// двойной щелчок по портрету — лист; урон и лечение доходят до чисел; состояние — камешком; гримуар ищет и помнит
// избранное; заклинание встаёт в гнездо; свёрнутый — только медальон; в бою свой ход — латунное кольцо и «Конец хода».
const { CombatHud } = await import("/systems/vedmak/module/apps/combat-hud.mjs");
const pack = game.packs.get("vedmak.pregens");
const docs = await pack.getDocuments();
const src = name => docs.find(d => d.name.startsWith(name));
const geralt = await Actor.create({ ...src("Геральт").toObject(), folder: folder.id });
const yen = await Actor.create({ ...src("Йеннифэр").toObject(), folder: folder.id });
const tG = await placeToken(geralt, 1000, 1000);
const tY = await placeToken(yen, 1300, 1000);
await game.settings.set("vedmak", "combatHudCollapsed", false);
const hudEl = () => document.querySelector("#vedmak-combat-hud .hm");
const settle = async (ms = 400) => { await wait(ms); for (let i = 0; i < 20 && CombatHud.instance.rendering; i++) await wait(50); };
const click = el => el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

// Худ у выделенного токена
tG.object.control({ releaseOthers: true });
await settle(700);
const hm = hudEl();
ok(!!hm, "худ появился у выделенного токена");
ok(hm?.querySelectorAll(".hm-sock").length === 2, `гнёзд на цепи: ${hm?.querySelectorAll(".hm-sock").length}`);
ok(hm?.querySelectorAll(".hm-sock:not(.empty)").length === 2, "оба гнезда заняты ударами");
ok(hm?.querySelector(".hm-num.hp b")?.textContent === String(geralt.system.hp.value), `ПЗ на подставке: ${hm?.querySelector(".hm-num.hp b")?.textContent}`);
ok(hm?.querySelector(".hm-num.sta b")?.textContent === String(geralt.system.sta.value), "Вын на подставке");
ok(!!hm?.querySelector(".hm-arc.hp") && !!hm?.querySelector(".hm-trail"), "дуга ПЗ и след");
const chips = [...(hm?.querySelectorAll(".hm-chip") ?? [])].map(c => c.textContent.trim().replace(/\d+$/, ""));
ok(["Действия", "Защита", "Магия", "Алхимия"].every(n => chips.includes(n)), `ярлыки: ${chips.join(", ")}`);
ok(hm?.querySelector(".hm-coins") !== null, "монеты Удачи");
const rect = hm?.getBoundingClientRect();
ok(rect && rect.width < 900 && rect.height < 260, `размер худа ${Math.round(rect?.width)}×${Math.round(rect?.height)} — меньше прежней плиты`);

// Двойной щелчок по портрету — лист
hm.querySelector(".hm-face").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
await wait(700);
ok(geralt.sheet.rendered, "двойной щелчок по портрету открыл лист");
await geralt.sheet.close();
await wait(300);

// Списки: открыть, закрыть щелчком мимо
const open = async id => { click(hudEl().querySelector(`[data-action="togglePop"][data-pop="${id}"]`)); await settle(400); return hudEl().querySelector(`.hm-pop.${id}`); };
let pop = await open("def");
ok(pop?.querySelectorAll(".hm-dt").length === 4, `защит в списке: ${pop?.querySelectorAll(".hm-dt").length}`);
ok(pop?.querySelectorAll(".hm-save").length === 2, "печати испытаний");
document.getElementById("board")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
await settle(400);
ok(!hudEl().querySelector(".hm-pop"), "щелчок мимо закрыл список");
pop = await open("act");
ok(pop?.querySelectorAll(".hm-stc").length > 10, `состояний в «Действиях»: ${pop?.querySelectorAll(".hm-stc").length}`);
ok(pop?.querySelectorAll('[data-action="verbal"]').length === 6, "словесная дуэль");
ok(!!pop?.querySelector("input.hm-skill"), "поиск навыка");
// Состояние щелчком — камешком на ободе
click(pop.querySelector('[data-status="bleeding"]'));
await settle(700);
ok(geralt.statuses.has("bleeding"), "кровотечение наложено из списка");
ok(!!hudEl().querySelector('.hm-stone.k-bad'), "камешек кровотечения на ободе");
ok(hudEl().querySelector(".hm-pop.act"), "список остался открытым после перерисовки");
await geralt.toggleStatusEffect("bleeding", { active: false });
await settle();

// Урон и лечение доходят до чисел, всплывает надпись
await geralt.update({ "system.hp.value": geralt.system.hp.max - 8 });
await settle(200);
ok(!!hudEl().querySelector(".hm-float.dmg"), "урон: всплыла надпись");
await wait(700);
ok(hudEl().querySelector(".hm-num.hp b")?.textContent === String(geralt.system.hp.max - 8), `урон: число докатилось до ${hudEl().querySelector(".hm-num.hp b")?.textContent}`);
ok(hudEl().querySelector(".hm-num.hp")?.classList.contains("hurt"), "раненый — ПЗ кровью");
await geralt.update({ "system.hp.value": geralt.system.hp.max });
await settle(900);
ok(hudEl().querySelector(".hm-num.hp b")?.textContent === String(geralt.system.hp.max), "лечение: число вернулось");

// Алхимия
pop = await open("alc");
ok(pop?.querySelectorAll(".hm-flask").length >= 5, `флаконов Геральта: ${pop?.querySelectorAll(".hm-flask").length}`);
ok(!!pop?.querySelector(".hm-tube"), "трубка токсичности");
const flask = pop?.querySelector('.hm-flask[data-tox]:not([data-tox="0"])');
flask?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
ok(!pop?.querySelector(".hm-tube .ghost")?.hidden, "наведение на эликсир показало, сколько добавит");

// Ещё в руках
pop = await open("more");
ok(pop?.querySelectorAll(".hm-orow").length >= 1, `«+N»: ${pop?.querySelectorAll(".hm-orow").length} ударов`);
click(hudEl().querySelector('[data-action="togglePop"][data-pop="more"]'));
await settle();

// Чародейка: гримуар
tY.object.control({ releaseOthers: true });
await settle(700);
ok(hudEl()?.querySelector(".hm-medal") && hudEl().querySelector(".hm-num.hp b")?.textContent === String(yen.system.hp.value), "худ переключился на Йеннифэр");
pop = await open("magic");
const rows = () => [...hudEl().querySelectorAll(".hm-sp")];
const spells = yen.itemTypes.spell.length;
ok(rows().length === spells, `строк гримуара: ${rows().length} из ${spells}`);
ok(document.activeElement?.classList.contains("hm-find"), "открытый гримуар сразу ловит ввод в поиск");
const input = hudEl().querySelector(".hm-find");
input.value = "теле"; input.dispatchEvent(new Event("input"));
const shown = rows().filter(r => !r.hidden).map(r => r.dataset.name);
ok(shown.length >= 1 && shown.every(n => n.toLowerCase().includes("теле")), `поиск «теле»: ${shown.join(", ")}`);
ok(!hudEl().querySelector(".hm-gcard").hidden, "карточка выбранного заклинания");
input.value = ""; input.dispatchEvent(new Event("input"));
// Правый щелчок — в избранное
const first = rows()[0];
first.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
await settle(700);
ok((yen.getFlag("vedmak", "hudFavorites") ?? []).includes(first.dataset.itemId), "правый щелчок добавил в избранное");
ok(hudEl().querySelectorAll(".hm-fav").length === 1, "избранное — гнездо с клавишей 1");
// Заклинание в гнездо (так же пишет перетаскивание)
await yen.setFlag("vedmak", "hudSockets", [null, `spell:${first.dataset.itemId}`]);
await settle(600);
const sock = hudEl().querySelectorAll(".hm-sock")[1];
ok(sock?.classList.contains("spell") && sock.dataset.itemId === first.dataset.itemId, "заклинание встало во второе гнездо");
ok(!!hudEl().querySelector(".hm-arc.en"), "у чародейки — дуга Энергии");

// Свёрнутый — только медальон
click(hudEl().querySelector('.hm-pop.magic') ? hudEl().querySelector('[data-action="togglePop"][data-pop="magic"]') : null);
await settle();
await game.settings.set("vedmak", "combatHudCollapsed", true);
CombatHud.refresh(); await settle(600);
ok(hudEl()?.classList.contains("collapsed") && !hudEl().querySelector(".hm-chip"), "свёрнутый худ — только медальон");
click(hudEl().querySelector('[data-action="toggleCollapse"]'));
await settle(600);
ok(!hudEl()?.classList.contains("collapsed") && hudEl().querySelector(".hm-chip"), "развёрнут обратно");

// Бой: свой ход — латунное кольцо и «Конец хода»
const combat = await Combat.create({ scene: sc.id, active: true });
await combat.createEmbeddedDocuments("Combatant", [{ tokenId: tY.id, sceneId: sc.id, actorId: yen.id, initiative: 20 }, { tokenId: tG.id, sceneId: sc.id, actorId: geralt.id, initiative: 10 }]);
await combat.startCombat();
await settle(800);
ok(hudEl()?.classList.contains("turn"), "свой ход — кольцо");
ok(!!hudEl()?.querySelector(".hm-endturn"), "«Конец хода» на медальоне");
click(hudEl().querySelector(".hm-endturn"));
await settle(800);
ok(game.combat?.combatant?.actor?.id === geralt.id, "«Конец хода» передал ход");
await combat.delete();
await yen.unsetFlag("vedmak", "hudSockets");
await yen.unsetFlag("vedmak", "hudFavorites");
canvas.tokens.releaseAll();
await settle();
ok(!hudEl(), "без выделенного токена вне боя худ убран");
