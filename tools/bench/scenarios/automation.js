// Автоматизация 4.148: «Удар сверху» и способности облика человека у берсерка, «Школа Улитки», ставки зрителей в «Филе».
const BF = await import("/systems/vedmak/module/character/bear-form.mjs");
const CR = await import("/systems/vedmak/module/crafting/craft.mjs");
const SN = await import("/systems/vedmak/module/character/snail-school.mjs");
const MAN = await import("/systems/vedmak/module/combat/manual.mjs");
const docOf = async (pack, name) => { const p = game.packs.get(`vedmak.${pack}`); const e = (await p.getIndex()).find(x => x.name === name); return e ? p.getDocument(e._id) : null; };
const setAbility = async (actor, values) => {
  const prof = actor.system.profession;
  await prof.update({ "system.branches": prof.toObject().system.branches.map(b => ({ ...b, abilities: b.abilities.map(a => ({ ...a, value: values[a.name] ?? a.value })) })) });
};
// Способности берсерка — проверки против СЛ самоконтроля (≈ 23) при основе ≈ 15: случайные попытки подряд проваливались
// примерно в каждом четвёртом прогоне. Кости заданы: d10 = ceil((1 − u)·10) — 10 со взрывом и 5 (итог основа + 15)
const surely = async fn => {
  const orig = CONFIG.Dice.randomUniform, q = [0.05, 0.55];
  CONFIG.Dice.randomUniform = () => q.length ? q.shift() : orig();
  try { return await fn(); } finally { CONFIG.Dice.randomUniform = orig; }
};
const abilityIndex = (actor, name) => {
  const br = actor.system.profession.system.branches;
  for (let b = 0; b < br.length; b++) for (let i = 0; i < br[b].abilities.length; i++) if (br[b].abilities[i].name === name) return [b, i];
  return null;
};

stepName("берсерк: облик человека");
const bear = await Actor.create({ name: "Прогон: берсерк", type: "character", folder: folder.id, "system.stats.body.base": 8, "system.stats.ref.base": 8 });
const bTok = await placeToken(bear, 1000, 1000);
await bear.createEmbeddedDocuments("Item", [{ ...(await docOf("professions", "Берсерк")).toObject(), _id: undefined }]);
await bear.system.profession.update({ "system.definingSkill.value": 4 });
await setAbility(bear, { "Медвежья шкура": 10, "Спячка": 10, "Медвежьи чувства": 10, "Удар сверху": 6, "Большой медведь": 5 });
const sp0 = bear.system.derived.armor?.torso?.sp ?? 0;
let res = null;
res = await surely(() => bear.rollAbility(...abilityIndex(bear, "Медвежья шкура"), { skipDialog: true }));
const hide = bear.effects.find(e => e.flags?.vedmak?.bearHide);
ok(!!hide, `«Медвежья шкура»: проверка против СЛ самоконтроля ${BF.controlDc(bear)}+, успех — эффект`);
ok((bear.system.derived.armor?.torso?.sp ?? 0) === sp0 + 10, `ПБ +10 (${sp0} → ${bear.system.derived.armor?.torso?.sp})`);
ok(bear.system.derived.hideResist.includes("bludgeoning"), "на 10-м уровне — сопротивление дробящему");
await surely(() => bear.rollAbility(...abilityIndex(bear, "Спячка"), { skipDialog: true }));
ok(bear.effects.some(e => e.flags?.vedmak?.bearHibernate), "«Спячка»: успех — эффект на день");
await bear.update({ "system.hp.value": 1 });
const rec = bear.system.derived.rec;
const hooksBefore = Hooks.on("renderDialogV2", app => setTimeout(() => { const f = app.element?.querySelector("form"); f?.querySelector("button[type=submit], footer button")?.click(); }, 50));
await MAN.restDays(bear);
Hooks.off("renderDialogV2", hooksBefore);
await wait(500);
ok(bear.system.hp.value >= Math.min(bear.system.hp.max, 1 + 2 * rec) && !bear.effects.some(e => e.flags?.vedmak?.bearHibernate),
  `отдых после спячки: ПЗ 1 → ${bear.system.hp.value} (вдвое: ≥ ${1 + 2 * rec}), спячка потрачена`);

stepName("берсерк: удар сверху");
await CR.giveItem(bear, (await docOf("gear", "Мардрём")).toObject(), 1);
await BF.bearTransform(bear); await wait(800);
const slam = A.attackSources(bear).find(s => s.kind === "bearSlam");
ok(!!slam, "в медвежьей форме есть «Удар сверху»");
const victim = await Actor.create({ name: "Прогон: жертва", type: "character", folder: folder.id });
const vTok = await placeToken(victim, 1100, 1000);
let hitDef = null;
for (let i = 0; i < 8 && !hitDef; i++) {
  const atk = await A.attack(bear, { kind: "bearSlam" }, { skipDialog: true, attackType: "slam", mod: 20, targets: [C.targetInfo(vTok)] });
  if (i === 0) ok(atk.flags.vedmak.attack.roll.parts.some(p => p.label === "Удар сверху" && p.value === 6), "бросок — Реа + уровень «Удара сверху»");
  await D.defend(atk, C.targetInfo(vTok), "dodge", { skipDialog: true });
  if (lastMine().flags.vedmak.defense.hit) hitDef = lastMine();
}
ok(hitDef?.flags.vedmak.defense.attack.weapon.damage === "6d6" || hitDef?.flags.vedmak.defense.attack?.damageFormula === "6d6" || !!hitDef, "попадание «Ударом сверху»");
const el = ui.chat.element?.querySelector(`[data-message-id="${hitDef?.id}"] [data-vedmak="applyHitStatus"]`);
el?.click(); await wait(1500);
ok(victim.statuses.has("prone") && victim.statuses.has("immobilized"), `цель сбита с ног и обездвижена (${[...victim.statuses].join(", ")})`);
// Блок «Удара сверху»: урона нет, встречная Сила решает, упадёт ли блокирующий
const blocker = await Actor.create({ name: "Прогон: блокирующий", type: "character", folder: folder.id });
const knife = (await game.packs.get("vedmak.weapons").getDocuments()).find(w => w.name === "Кинжал").toObject();
await blocker.createEmbeddedDocuments("Item", [{ ...knife, _id: undefined, system: { ...knife.system, equipped: true } }]);
const slamAtk = { label: "Удар сверху", weapon: { name: "Удар сверху", damage: "6d6", bearSlam: true, isRanged: false }, isRanged: false,
  // Итог атаки — заведомо ниже любой защиты: при итоге 1 критический провал блокирующего (d10 = 1, вычет ≥ 5) опускал
  // защиту до 0, удар проходил и заметок о блоке не было — сценарий падал примерно в одном прогоне из трёх
  attackType: "slam", roll: { total: -50, rolls: [] }, attacker: { name: bear.name, actorUuid: bear.uuid } };
const smsg = await ChatMessage.create({ content: "проба", flags: { vedmak: { attack: slamAtk } } });
await D.defend(smsg, { actorUuid: blocker.uuid }, "block", { skipDialog: true });
const bnote = (lastMine().flags.vedmak.defense.notes ?? []).join(" ");
ok(/«Удар сверху» заблокирован/.test(bnote), `блок «Удара сверху»: ${bnote.slice(0, 120)}`);
ok(/отбрасывает берсерка/.test(bnote) ? !blocker.statuses.has("prone") : blocker.statuses.has("prone") && blocker.statuses.has("immobilized"),
  "проиграл встречную Силу — сбит и обездвижен, выиграл — нет");
await smsg.delete();
await BF.bearRevert(bear); await wait(600);
await surely(() => bear.rollAbility(...abilityIndex(bear, "Медвежьи чувства"), { skipDialog: true }));
// Ночное зрение токен получает после применения эффекта — ждать состояния, а не фиксированные 600 мс
for (let i = 0; i < 40 && bTok.sight.visionMode !== "darkvision"; i++) await wait(100);
ok(bear.effects.some(e => e.flags?.vedmak?.bearSenses) && bTok.sight.visionMode === "darkvision", `«Медвежьи чувства»: эффект и ночное зрение токена (${bTok.sight.visionMode})`);

stepName("школа Улитки");
const snail = await Actor.create({ name: "Прогон: Улитка", type: "character", folder: folder.id, "system.details.school": "snail" });
const sTok = await placeToken(snail, 1000, 1200);
const grabber = await Actor.create({ name: "Прогон: хватающий", type: "character", folder: folder.id });
await placeToken(grabber, 1100, 1200);
const grab = await A.attack(grabber, { kind: "unarmed" }, { skipDialog: true, attackType: "grapple", targets: [C.targetInfo(sTok)] });
ok(grab.flags.vedmak.attack.roll.parts.some(p => /Улитк/.test(p.label) && p.value === -3), "захват Улитки — −3");
const sta0 = snail.system.sta.value;
await SN.applyIgniSlime(snail);
ok(!!SN.igniSlime(snail) && snail.system.sta.value === sta0 - 1, "«Слизь Игни»: эффект, −1 Вын");
const disarm = { label: "Меч", weapon: { name: "Меч", isRanged: false }, isRanged: false, attackType: "disarm", roll: { total: 15, rolls: [] }, attacker: { name: "Проба" } };
const dmsg = await ChatMessage.create({ content: "проба", flags: { vedmak: { attack: disarm } } });
await D.defend(dmsg, { actorUuid: snail.uuid }, "dodge", { skipDialog: true });
ok(lastMine().flags.vedmak.defense.roll.parts.some(p => p.label === "Слизь Игни" && p.value === 3), "защита от разоружения со слизью Игни — +3");
await dmsg.delete();

stepName("филе: ставки зрителей");
const { TavernApp } = await import("/systems/vedmak/module/apps/tavern-app.mjs");
const mkPurse = async (name, crowns, gambling) => {
  const a = await Actor.create({ name, type: "character", folder: folder.id, "system.money.crowns": crowns });
  if (gambling) await a.update({ "system.skills.gambling.value": gambling });
  return a;
};
const playRound = async (playerMod, stop) => {
  const knife = await mkPurse("Прогон: ножик", 100, 0), fan1 = await mkPurse("Прогон: зритель 1", 100, 5), fan2 = await mkPurse("Прогон: зритель 2", 100, 3);
  await TavernApp.open(); await wait(400);
  const app = foundry.applications.instances.get("vedmak-tavern") ?? Object.values(ui.windows).find(w => w instanceof TavernApp);
  app.game = "fillet"; app.state = {}; app.log = [];
  app.players = [{ uuid: knife.uuid, name: knife.name, img: knife.img, mod: playerMod, bet: 0 }];
  app.spectators = [{ uuid: fan1.uuid, name: fan1.name, img: fan1.img, bet: 0 }, { uuid: fan2.uuid, name: fan2.name, img: fan2.img, bet: 0 }];
  await app.render({ force: true }); await wait(300);
  for (const [s, v] of [[fan1, 99], [fan2, 2]]) {
    const inp = app.element.querySelector(`input[data-spectator-bet="${s.uuid}"]`);
    inp.value = v; inp.dispatchEvent(new Event("change")); await wait(300);
  }
  const bets = app.spectators.map(s => s.bet);
  const click = async a => { app.element.querySelector(`[data-action="${a}"]`)?.click(); await wait(900); };
  await click("turn");
  if (stop) { await click("filletSpeed"); await click("turn"); await click("filletSpeed"); await click("turn"); await click("filletStop"); }
  const out = { bets, knife: knife.system.money.crowns, fan1: fan1.system.money.crowns, fan2: fan2.system.money.crowns, done: !!app.state.done };
  await app.close();
  return out;
};
const win = await playRound(50, true);
ok(win.bets[0] === 5 && win.bets[1] === 2, `предел ставки — Азартные игры (99 → ${win.bets[0]}, 2 → ${win.bets[1]})`);
ok(win.knife === 107 && win.fan1 === 95 && win.fan2 === 98, `закончил после двух ускорений — забрал ставки: ${win.knife} / ${win.fan1} / ${win.fan2}`);
const lose = await playRound(-60, false);
ok(lose.done && lose.knife === 93 && lose.fan1 === 105 && lose.fan2 === 102, `порезался — заплатил зрителям: ${lose.knife} / ${lose.fan1} / ${lose.fan2}`);
