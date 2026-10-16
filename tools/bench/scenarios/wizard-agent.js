// Мастер создания: тайный агент с Легендой (PLAN 4.224). По книге агент берёт у профессии прикрытия 4 навыка из её
// навыков, её определяющий навык как свой, 4 предмета её снаряжения и её капитал.
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
const human = (await docsOf("race")).find(r => r.system.key === "human");
const profs = await docsOf("profession");
const agent = profs.find(p => p.system.key === "secret-agent-leo");
const bard = profs.find(p => p.system.key === "bard");
ok(!!agent && !!bard, "в компендиуме есть Тайный агент и Бард");

const actor = await Actor.create({ name: "Прогон: агент", type: "character", folder: folder.id });
const wiz = new CharacterWizard({ actor });
await wiz.render({ force: true }); await wait(400);
const s = wiz.wiz;
const go = async step => { s.step = step; await wiz.render({ force: true }); await wait(250); };
const click = sel => { const b = wiz.element?.querySelector(sel); b?.click(); return !!b; };

stepName("Легенда");
click(`[data-action='pickRace'][data-uuid='${human.uuid}']`); await wait(300);
await go("origin"); click("[data-action='rollOrigin']"); await wait(300);
await go("lifepath"); click("[data-action='lpRest']"); await wait(800);
await go("profession");
click(`[data-action='pickProfession'][data-uuid='${agent.uuid}']`); await wait(400);
const select = wiz.element.querySelector("select[data-field='cover']");
const coverNames = [...(select?.options ?? [])].map(o => o.textContent.trim());
ok(!!select && coverNames.includes(bard.name) && !coverNames.some(n => /Ведьмак|Маг\b|Тайный агент/.test(n)),
  `выбор Легенды: ${coverNames.length - 1} профессий, без ведьмака, магов и самого агента`);
// Выбор — как игрок: значение в списке и событие change
select.value = bard.uuid; select.dispatchEvent(new Event("change", { bubbles: true })); await wait(500);
const kit = wiz.kit;
const bardSkills = new Set([...bard.system.skills, ...bard.system.skillChoices.flatMap(c => c.options)]);
ok(kit.cover?.uuid === bard.uuid && kit.skillChoices.length === 1 && kit.skillChoices[0].count === 4
  && kit.skillChoices[0].options.every(k => bardSkills.has(k) && !agent.system.skills.includes(k)),
  `навыки Легенды — из навыков барда, без навыков агента (${kit.skillChoices[0]?.options.length})`);
ok(kit.definingSkill.name === bard.system.definingSkill.name && kit.definingSkill.stat === bard.system.definingSkill.stat,
  `определяющий навык — барда: «${kit.definingSkill.name}»`);
ok(kit.startingMoney === bard.system.startingMoney, `капитал — барда: ${kit.startingMoney} × 2d6`);
ok(!!wiz.element.querySelector(".prof-info")?.textContent.includes(`Легенда «${bard.name}»`), "на панели профессии — «Легенда «Бард»»");
// Навыки Легенды — щелчками по флажкам
for (const k of kit.skillChoices[0].options.slice(0, 4)) {
  const box = wiz.element.querySelector(`input[data-field='skillChoice.0.${k}']`);
  if (box) { box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); await wait(200); }
}
ok((s.skillChoices[0] ?? []).length === 4, `выбрано 4 навыка Легенды: ${(s.skillChoices[0] ?? []).map(k => SKILLS[k]?.label).join(", ")}`);

stepName("параметры и навыки");
s.statMode = "points";
const budget = STAT_POINT_BUY[s.level]?.points ?? 60;
const keys = Object.keys(s.stats); for (const k of keys) s.stats[k] = 1;
let sum = keys.length;
for (let i = 0; sum < budget && i < 2000; i++) { const k = keys[i % keys.length]; if (s.stats[k] < 10) { s.stats[k]++; sum++; } }
const pkeys = [...agent.system.skills, ...s.skillChoices[0]];
const cost = (v, k) => CH.creationSkillCost(v, SKILLS[k]?.difficult);
s.profSkills = Object.fromEntries(pkeys.map(k => [k, 1])); s.defining = 1;
const spent = () => pkeys.reduce((n, k) => n + cost(s.profSkills[k], k), 0) + s.defining;
for (let i = 0; spent() < BUDGET && i < 2000; i++) {
  const left = BUDGET - spent();
  const k = pkeys.filter(x => s.profSkills[x] < 6 && cost(1, x) <= left)[i % pkeys.length];
  if (k) s.profSkills[k]++; else if (s.defining < 6) s.defining++; else break;
}
ok(spent() === BUDGET, `очки навыков профессии: ${spent()} из ${BUDGET} (6 навыков агента + 4 Легенды)`);

stepName("снаряжение Легенды");
await go("gear");
const gearHead = [...wiz.element.querySelectorAll(".group-head .bronze-tag")].map(e => e.textContent).find(t => t.startsWith("Снаряжение")) ?? "";
ok(gearHead.includes(`Легенды «${bard.name}»`), `заголовок снаряжения: «${gearHead.trim()}»`);
const bardGear = new Set([...bard.system.gearFixed, ...bard.system.gearChoice.options]);
ok(kit.gearChoice.count === Math.min(4, bardGear.size) && kit.gearChoice.options.every(n => bardGear.has(n)), `снаряжение — из списка барда: ${kit.gearChoice.count} из ${kit.gearChoice.options.length}`);
s.gear = kit.gearChoice.options.slice(0, kit.gearChoice.count);
click("[data-action='rollMoney']"); await wait(500);
ok(s.money?.total === s.money?.sum * bard.system.startingMoney, `капитал: ${bard.system.startingMoney} × ${s.money?.sum} = ${s.money?.total}`);

stepName("готовый агент");
await go("summary");
click("[data-action='apply']"); await wait(2500);
const prof = actor.system.profession;
ok(prof?.name === agent.name, "на листе — профессия «Тайный агент»");
ok(prof?.system.definingSkill.name === bard.system.definingSkill.name && prof?.getFlag("vedmak", "cover")?.name === bard.name,
  `определяющий навык на листе — Легенды: «${prof?.system.definingSkill.name}» ${prof?.system.definingSkill.value}`);
const owned = new Set(actor.items.map(i => i.name));
const got = s.gear.filter(n => [...owned].some(o => n.includes(o) || o.includes(n.split(" ×")[0])));
ok(got.length >= Math.min(1, s.gear.length), `снаряжение Легенды на листе: ${got.join(", ") || "—"}`);
for (const k of s.skillChoices[0]) ok(actor.system.skills[k]?.profession === true, `«${SKILLS[k]?.label}» — навык профессии`);
if (wiz.rendered) await wiz.close();
await actor.delete();
