// Часть 6: мастер создания до конца — каждая раса с подходящей профессией и каждая профессия с подходящей расой.
// Шаги заполняются по правилам #validate, затем «Применить»; готовый лист — все вкладки.
const { CharacterWizard } = await import("/systems/vedmak/module/character/wizard.mjs");
const { SKILLS } = await import("/systems/vedmak/module/config/skills.mjs");
const { STAT_POINT_BUY } = await import("/systems/vedmak/module/config/stats.mjs");
const CH = await import("/systems/vedmak/module/config/character.mjs");
const BUDGET = CH.CREATION?.professionSkillPoints ?? 44;
const cost = (v, k) => (CH.creationSkillCost ? CH.creationSkillCost(v, SKILLS[k]?.difficult) : v * (SKILLS[k]?.difficult ? 2 : 1));

const docsOf = async type => {
  const out = [];
  for (const pack of game.packs.filter(p => p.documentName === "Item" && p.metadata.packageName === "vedmak")) {
    const idx = await pack.getIndex({ fields: ["type"] });
    if (idx.some(e => e.type === type)) out.push(...await pack.getDocuments({ type }));
  }
  return out;
};
const races = await docsOf("race");
const profs = await docsOf("profession");
log("рас", races.length, "профессий", profs.length);
const fits = (race, prof) => {
  const rk = race.system.key, pk = prof.system.key;
  if (rk === "witcher" || pk === "witcher") return rk === "witcher" && pk === "witcher";
  const allowed = prof.system.allowedRaces ?? [];
  return !allowed.length || allowed.includes(rk);
};
const human = races.find(r => r.system.key === "human") ?? races[0];
const pairs = [];
races.forEach((r, i) => {
  const ok = profs.filter(p => fits(r, p));
  if (ok.length) pairs.push([r, ok[i % ok.length]]); else log("нет профессии для расы", r.name);
});
for (const p of profs) {
  if (pairs.some(([, q]) => q === p)) continue;
  const r = fits(human, p) ? human : races.find(x => fits(x, p));
  if (r) pairs.push([r, p]); else log("нет расы для профессии", p.name);
}
if (window.__onlyProf) pairs.splice(0, pairs.length, ...pairs.filter(([, q]) => q.name === window.__onlyProf));
log("пар раса/профессия:", pairs.length);

const results = { ok: 0, fail: [] };
for (const [race, prof] of pairs.slice(Number(window.__from ?? 0), Number(window.__to ?? 999))) {
  const label = `${race.name} / ${prof.name}`;
  let actor;
  try {
    actor = await Actor.create({ name: `Прогон: ${label}`, type: "character", folder: folder.id });
    const wiz = new CharacterWizard({ actor });
    await wiz.render({ force: true });
    await wait(400);
    const s = wiz.wiz;
    const go = async step => { s.step = step; await wiz.render({ force: true }); await wait(250); };
    const click = sel => { const b = wiz.element?.querySelector(sel); b?.click(); return !!b; };
    stepName(`мастер ${label}: раса`);
    if (!click(`[data-action='pickRace'][data-uuid='${race.uuid}']`)) log("нет кнопки расы", race.name);
    await wait(400);
    stepName(`мастер ${label}: происхождение`);
    await go("origin"); click("[data-action='rollOrigin']"); await wait(400);
    stepName(`мастер ${label}: жизненный путь`);
    await go("lifepath"); click("[data-action='lpRest']"); await wait(900);
    stepName(`мастер ${label}: профессия`);
    await go("profession");
    if (!click(`[data-action='pickProfession'][data-uuid='${prof.uuid}']`)) log("нет кнопки профессии", prof.name);
    await wait(400);
    prof.system.skillChoices.forEach((c, i) => { s.skillChoices[i] = c.options.slice(0, c.count); });
    // Параметры: ровно бюджет очков, каждый 1–10
    stepName(`мастер ${label}: параметры`);
    s.statMode = "points";
    const budget = STAT_POINT_BUY[s.level]?.points ?? 60;
    const keys = Object.keys(s.stats);
    for (const k of keys) s.stats[k] = 1;
    let sum = keys.length;
    for (let i = 0; sum < budget && i < 2000; i++) { const k = keys[i % keys.length]; if (s.stats[k] < 10) { s.stats[k]++; sum++; } }
    // Навыки профессии: каждый ≥ 1, ровно бюджет вместе с определяющим
    stepName(`мастер ${label}: навыки`);
    const pkeys = [...prof.system.skills];
    prof.system.skillChoices.forEach((c, i) => { for (const k of s.skillChoices[i] ?? []) if (!pkeys.includes(k)) pkeys.push(k); });
    s.profSkills = Object.fromEntries(pkeys.map(k => [k, 1]));
    s.defining = 1;
    const spent = () => pkeys.reduce((n, k) => n + cost(s.profSkills[k], k), 0) + s.defining;
    for (let i = 0; spent() < BUDGET && i < 2000; i++) {
      const left = BUDGET - spent();
      const k = pkeys.filter(x => s.profSkills[x] < 6 && cost(1, x) <= left)[i % Math.max(1, pkeys.length)];
      if (k) s.profSkills[k]++; else if (s.defining < 6) s.defining++; else break;
    }
    // Магия: в каждой группе — сколько просят
    await go("magic");
    stepName(`мастер ${label}: магия`);
    const magic = [];
    for (const panel of wiz.element.querySelectorAll(".vd-panel")) {
      const need = Number(panel.querySelector(".budget")?.textContent.match(/из\s+(\d+)/)?.[1] ?? 0);
      const boxes = [...panel.querySelectorAll("input[data-field='magic']:not([disabled])")];
      magic.push(...boxes.slice(0, need).map(b => b.dataset.uuid));
    }
    s.magic = magic;
    // Снаряжение и деньги
    stepName(`мастер ${label}: снаряжение`);
    await go("gear");
    click("[data-action='rollMoney']"); await wait(500);
    s.gear = (prof.system.gearChoice?.options ?? []).slice(0, prof.system.gearChoice?.count ?? 0);
    stepName(`мастер ${label}: применить`);
    await go("summary");
    const problem = wiz.element.querySelector(".summary .warning, .problem, [data-problem]")?.textContent?.trim();
    click("[data-action='apply']");
    await wait(2500);
    const okRace = actor.system.race?.name, okProf = actor.system.profession?.name;
    if (okRace && okProf) {
      results.ok++;
      // Готовый лист — все вкладки
      stepName(`лист ${label}`);
      const sheet = actor.sheet;
      await sheet.render({ force: true }); await wait(300);
      for (const [group, cfg] of Object.entries(sheet.constructor.TABS ?? {})) for (const t of cfg.tabs ?? []) {
        try { sheet.changeTab(t.id, group, { force: true }); } catch {}
        await wait(60);
      }
      await sheet.close({ animate: false });
      const items = actor.items.size, hp = actor.system.hp.max, money = actor.system.money?.crowns;
      if (!items || !hp) log("СТРАННО", label, "предметов", items, "ПЗ", hp, "крон", money);
    } else {
      results.fail.push(`${label}: не применилось${problem ? ` (${problem})` : ""}`);
    }
    if (wiz.rendered) await wiz.close();
  } catch (e) { log("ERR мастер", label, e.message, (e.stack ?? "").split("\n").slice(1, 3).join(" ")); }
  try { if (actor) await actor.delete(); } catch {}
  await clearChat(); seen = new Set();
}
log("мастер: создано", results.ok, "из", pairs.length);
for (const f of results.fail) log("НЕ СОЗДАН", f);
stepName("готово");
log("конец части 6");
