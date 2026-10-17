// Мастер создания: выбор профессии по книге (PLAN 4.251) — традиция ведьмы (определяющий навык со своим параметром),
// предмет Высшего образования учёного; «Простые навыки» марида — сложные навыки при создании стоят как простые.
const { CharacterWizard } = await import("/systems/vedmak/module/character/wizard.mjs");
const { SKILLS } = await import("/systems/vedmak/module/config/skills.mjs");
const { STAT_POINT_BUY } = await import("/systems/vedmak/module/config/stats.mjs");
const CH = await import("/systems/vedmak/module/config/character.mjs");
const BUDGET = CH.CREATION.professionSkillPoints;
const docsOf = async type => {
  const out = [];
  for (const pack of game.packs.filter(p => p.documentName === "Item" && p.metadata.packageName === "vedmak")) {
    const idx = await pack.getIndex({ fields: ["type"] });
    if (idx.some(e => e.type === type)) out.push(...await pack.getDocuments({ type }));
  }
  return out;
};
const races = await docsOf("race"), profs = await docsOf("profession");
const human = races.find(r => r.system.key === "human"), marid = races.find(r => r.system.key === "marid");
const witch = profs.find(p => p.system.key === "witch-leo"), scholar = profs.find(p => p.system.key === "scholar");
const warrior = profs.find(p => p.system.key === "warrior");
ok(!!human && !!marid && !!witch && !!scholar && !!warrior, "в компендиуме есть человек, марид, ведьма, учёный, воин");

const actor = await Actor.create({ name: "Прогон: ведьма", type: "character", folder: folder.id });
const wiz = new CharacterWizard({ actor });
await wiz.render({ force: true }); await wait(400);
const s = wiz.wiz;
const go = async step => { s.step = step; await wiz.render({ force: true }); await wait(250); };
const click = sel => { const b = wiz.element?.querySelector(sel); b?.click(); return !!b; };
const pickSelect = async (field, value) => {
  const el = wiz.element.querySelector(`select[data-field='${field}']`);
  if (!el) return false;
  el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); await wait(400); return true;
};
try {
  stepName("традиция ведьмы");
  click(`[data-action='pickRace'][data-uuid='${human.uuid}']`); await wait(300);
  await go("origin"); click("[data-action='rollOrigin']"); await wait(300);
  await go("lifepath"); click("[data-action='lpRest']"); await wait(800);
  await go("profession");
  click(`[data-action='pickProfession'][data-uuid='${witch.uuid}']`); await wait(400);
  const opts = [...(wiz.element.querySelector("select[data-field='variant']")?.options ?? [])].map(o => o.textContent.trim());
  ok(opts.length === 4 && opts.some(o => o.startsWith("Старые уклады (Рем)")) && opts.some(o => o.startsWith("Смена облика (Воля)")) && opts.some(o => o.startsWith("Тёмные искусства (Инт)")),
    `выбор традиции: ${opts.slice(1).join(", ")}`);
  ok(wiz.element.innerHTML.includes("Языческая традиция: выберите"), "без традиции — шаг «Профессия» не завершён");
  await pickSelect("variant", "shapeshift");
  ok(wiz.kit.definingSkill.name === "Смена облика" && wiz.kit.definingSkill.stat === "will",
    `определяющий навык — «${wiz.kit.definingSkill.name}» (${wiz.kit.definingSkill.stat})`);
  ok(wiz.element.querySelector(".prof-info .defining")?.textContent.includes("Смена облика"), "на панели профессии — «Смена облика»");

  stepName("параметры, навыки, магия");
  s.statMode = "points";
  const budget = STAT_POINT_BUY[s.level]?.points ?? 60;
  const keys = Object.keys(s.stats); for (const k of keys) s.stats[k] = 1;
  let sum = keys.length;
  for (let i = 0; sum < budget && i < 2000; i++) { const k = keys[i % keys.length]; if (s.stats[k] < 10) { s.stats[k]++; sum++; } }
  const pkeys = [...witch.system.skills];
  const cost = (v, k) => CH.creationSkillCost(v, SKILLS[k]?.difficult);
  s.profSkills = Object.fromEntries(pkeys.map(k => [k, 1])); s.defining = 1;
  const spent = () => pkeys.reduce((n, k) => n + cost(s.profSkills[k], k), 0) + s.defining;
  for (let i = 0; spent() < BUDGET && i < 2000; i++) {
    const left = BUDGET - spent();
    const k = pkeys.filter(x => s.profSkills[x] < 6 && cost(s.profSkills[x] + 1, x) - cost(s.profSkills[x], x) <= left)[i % pkeys.length];
    if (k) s.profSkills[k]++; else if (s.defining < 6) s.defining++; else break;
  }
  await go("magic");
  { // Фильтр магии (PLAN 4.252): путь инвокаций, книга, поиск; отмеченное видно всегда
    const panel = [...wiz.element.querySelectorAll("[data-magic-group]")].find(p => p.querySelector("[data-mf=branch]"));
    const visible = () => [...panel.querySelectorAll(".magic-pick")].filter(el => !el.hidden);
    ok(!!panel && !!panel.querySelector("[data-mf=book]"), "инвокации: плашки пути и книги, поиск");
    const all = visible().length;
    panel.querySelector("[data-mf=branch][data-value=druid]").click(); await wait(150);
    ok(visible().length > 0 && visible().length < all && visible().every(el => el.dataset.branch === "druid"), `путь «Друид»: ${visible().length} из ${all}`);
    const box = visible()[0].querySelector("input"); box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); await wait(500);
    const panel2 = [...wiz.element.querySelectorAll("[data-magic-group]")].find(p => p.querySelector("[data-mf=branch]"));
    ok(panel2.querySelector("[data-mf=branch][data-value=druid]")?.classList.contains("on"), "фильтр пережил перерисовку после выбора");
    panel2.querySelector("[data-mf=branch][data-value='']").click();
    const find = panel2.querySelector("[data-magic-find]"); find.value = "благослов"; find.dispatchEvent(new Event("input", { bubbles: true })); await wait(150);
    const vis2 = [...panel2.querySelectorAll(".magic-pick")].filter(el => !el.hidden);
    ok(vis2.length > 0 && vis2.every(el => el.dataset.name.includes("благослов") || el.querySelector("input").checked), `поиск «благослов»: ${vis2.length}, отмеченное не спрятано`);
    s.magic = [];
  }
  // Магия: по квоте каждой группы — первые в списке
  const ctx = await wiz._prepareContext({});
  s.magic = (ctx.magicGroups ?? []).filter(g => !g.auto).flatMap(g => g.items.slice(0, g.count).map(i => i.uuid));
  await go("gear");
  s.gear = wiz.kit.gearChoice.options.slice(0, wiz.kit.gearChoice.count);
  click("[data-action='rollMoney']"); await wait(500);

  stepName("готовая ведьма");
  await go("summary");
  ok(!wiz.element.querySelector("[data-action='apply'][disabled]"), "итог: всё заполнено, можно создать");
  click("[data-action='apply']"); await wait(2500);
  const prof = actor.system.profession;
  ok(prof?.system.definingSkill.name === "Смена облика" && prof.system.definingSkill.stat === "will" && prof.getFlag("vedmak", "variant")?.key === "shapeshift",
    `на листе: определяющий «${prof?.system.definingSkill.name}» (${prof?.system.definingSkill.stat}), выбор во флаге`);
  ok(/Смена облика/.test(prof?.system.definingSkill.effect ?? "") && /зверя/.test(prof?.system.definingSkill.effect ?? ""), "описание навыка — про традицию");
  if (wiz.rendered) await wiz.close();

  stepName("предмет учёного");
  const w2 = new CharacterWizard({ actor });
  await w2.render({ force: true }); await wait(400);
  w2.wiz.raceUuid = human.uuid; w2.wiz.professionUuid = scholar.uuid; w2.wiz.step = "profession";
  await w2.render({ force: true }); await wait(400);
  const sel = w2.element.querySelector("select[data-field='variant']");
  ok(sel?.options.length === 6, `учёный: предметов на выбор ${(sel?.options.length ?? 1) - 1}`);
  sel.value = "history"; sel.dispatchEvent(new Event("change", { bubbles: true })); await wait(400);
  ok(w2.kit.definingSkill.name === "Высшее образование (История)" && w2.kit.definingSkill.stat === scholar.system.definingSkill.stat
    && /\+3/.test(w2.kit.definingSkill.effect), `учёный: «${w2.kit.definingSkill.name}», +3 по предмету`);
  w2.wiz.professionUuid = warrior.uuid; w2.wiz.variant = "history"; await w2.render({ force: true }); await wait(300);
  ok(!w2.element.querySelector("select[data-field='variant']") && w2.kit.definingSkill.name === warrior.system.definingSkill.name,
    "у воина выбора нет — определяющий навык свой");

  stepName("простые навыки марида");
  w2.wiz.raceUuid = marid.uuid; w2.wiz.professionUuid = warrior.uuid; w2.wiz.step = "skills";
  await w2.render({ force: true }); await wait(400);
  const hard = Object.keys(SKILLS).find(k => SKILLS[k].difficult);
  ok(w2.easySkills && !w2.hardAtCreation(hard), `марид: «${SKILLS[hard].label}» при создании — простой`);
  ok(/сложные навыки стоят как простые/.test(w2.element.textContent), "на шаге навыков — подсказка о простых навыках");
  w2.wiz.raceUuid = human.uuid; await w2.render({ force: true }); await wait(300);
  ok(!w2.easySkills && w2.hardAtCreation(hard), "человек: сложный навык — сложный");
  const dragon = profs.find(p => p.system.key === "goldenDragonProf");
  if (dragon) {
    w2.wiz.raceUuid = races.find(r => r.system.key === "goldenDragon")?.uuid ?? human.uuid; w2.wiz.professionUuid = dragon.uuid; w2.wiz.step = "magic";
    await w2.render({ force: true }); await wait(400);
    const picks = [...w2.element.querySelectorAll("[data-magic-group] .magic-pick")];
    ok(picks.length > 0 && picks.every(el => el.dataset.element === "fire") && /огонь/.test(w2.element.querySelector("[data-magic-group] .bronze-tag")?.textContent ?? ""),
      `золотой дракон: заклинания только огня (${picks.length})`);
    ok(picks.some(el => (el.dataset.tooltip ?? "").length > 20), "у заклинаний — описание подсказкой");
  }
  stepName("аристократ по книге");
  const noble = profs.find(p => p.system.key === "aristocrat");
  w2.wiz.raceUuid = human.uuid; w2.wiz.professionUuid = noble?.uuid ?? ""; w2.wiz.step = "profession";
  await w2.render({ force: true }); await wait(400);
  const nk = w2.kit;
  ok(noble?.system.skills.length === 9 && nk.skillChoices[0]?.count === 1 && nk.skillChoices[0].options.includes("swordsmanship")
    && nk.gearChoice.count === 5 && nk.gearChoice.options.length === 9 && nk.startingMoney === 200,
    `аристократ: навыков ${noble?.system.skills.length} + 1 боевой, снаряжение ${nk.gearChoice.count} из ${nk.gearChoice.options.length}, ${nk.startingMoney} × 2d6`);
  const names = new Set();
  for (const pack of game.packs.filter(p => p.documentName === "Item" && p.metadata.packageName === "vedmak")) for (const e of await pack.getIndex()) names.add(e.name);
  const missing = nk.gearChoice.options.filter(n => !names.has(n));
  ok(!missing.length, `снаряжение аристократа есть в компендиумах${missing.length ? ": нет " + missing.join(", ") : ""}`);
  ok(!/не указаны/.test(noble?.system.description ?? "") && /200 крон/.test(noble?.system.description ?? ""), "в описании — навыки, снаряжение и деньги по книге");
  await w2.close();
} finally {
  if (wiz.rendered) await wiz.close();
  await actor.delete();
}
