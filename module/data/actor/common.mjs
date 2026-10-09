// Общая часть персонажей и чудовищ: параметры, навыки, производные, броня, ранения.
// Правила расчёта — корник стр. 47–48, 154–162.

import { STATS, bodyTable } from "../../config/stats.mjs";
import { SKILLS } from "../../config/skills.mjs";
import { LOCATIONS_HUMANOID, LOCATIONS_MONSTER, MAGIC_SKILLS, layerBonus } from "../../config/combat.mjs";
import { int, track } from "../fields.mjs";
import { coinWeightKg, coinWeightEnabled } from "../../config/money.mjs";
import { prostheticPart } from "../../config/items.mjs";

const { SchemaField, BooleanField } = foundry.data.fields;

/** Параметр: базовое значение (распределённое) и модификатор (эффекты, раса, мутации). */
function statField(initial) {
  return new SchemaField({ base: int(initial, { min: 0 }), mod: int(0) });
}

export function statsSchema(initial = 5) {
  const fields = {};
  for (const key of Object.keys(STATS)) fields[key] = statField(initial);
  return new SchemaField(fields);
}

/** Навык: вложенные очки, модификатор и отметка «из профессии». */
export function skillsSchema() {
  const fields = {};
  for (const key of Object.keys(SKILLS)) {
    fields[key] = new SchemaField({
      value: int(0, { min: 0 }),
      mod: int(0),
      profession: new BooleanField({ initial: false })
    });
  }
  return new SchemaField(fields);
}

export function resourcesSchema() {
  return {
    hp: track(25, 25),
    sta: track(25, 25),
    // Бонусы к максимумам (мутагены, реликвии, древа) — складываются с формулой.
    bonus: new SchemaField({
      hp: int(0), sta: int(0), vigor: int(0), stun: int(0), rec: int(0), enc: int(0), run: int(0)
    }),
    // Накопленный штраф испытаний против смерти (стр. 162)
    deathSaves: new SchemaField({ penalty: int(0, { min: 0 }) }),
    // Магический щит (Квен, Активный щит): поглощает урон, прошедший через броню (стр. 114–115)
    shield: new SchemaField({ value: int(0, { min: 0 }), max: int(0, { min: 0 }) }),
    // Цели активных эффектов эликсиров и отваров. В формах не редактируются, чтобы сохранение листа
    // не записало временный бонус в данные.
    fx: new SchemaField({
      hp: int(0), sta: int(0), vigor: int(0), stun: int(0), rec: int(0), run: int(0), enc: int(0),
      damage: int(0), meleeDamage: int(0),
      // ПБ всех частей тела (отвары главоглаза и грифона): как врождённая броня, не разрушается
      sp: int(0),
      // Больше 0 — штрафов порога ранения нет («Зелье живучести»)
      ignoreWound: int(0),
      // +% к шансу поджечь, заморозить, сбить с ног своими атаками и заклинаниями («Буря»)
      statusChance: int(0),
      // + к броску места критического ранения (отвар катакана)
      critLocation: int(0),
      // Обезболивание: штрафы критических ранений и «при смерти» мягче на столько (травы — 2, BS — 4; тип upgrade)
      pain: int(0)
    })
  };
}

/* -------------------------------------------------------------------------- */

/** Смягчить штрафы критических ранений на n (обезболивающее): каждый отрицательный — к нулю, не дальше. */
function easeCritPenalties(crit, n) {
  const ease = v => (v < 0 ? Math.min(0, v + n) : v);
  for (const group of [crit.stats, crit.skills, crit.derived, crit.armBy]) {
    for (const k of Object.keys(group ?? {})) group[k] = ease(group[k]);
  }
  for (const k of ["action", "magic", "duel", "empathicDuel", "sight", "arm"]) crit[k] = ease(crit[k] ?? 0);
}

/** Сложить модификаторы всех критических ранений актора в их текущем состоянии. */
export function collectCritMods(actor) {
  const out = {
    stats: {}, skills: {}, derived: {}, mult: {},
    action: 0, magic: 0, duel: 0, empathicDuel: 0, sight: 0, arm: 0,
    headMult: 3, bleedExtra: 0, acid: 0, bleeding: false, poisoned: false, suffocating: false,
    armDisabled: false, death: false, wounds: [],
    // Штрафы ран руки по рукам: действуют только на действия той рукой, поэтому две руки не складываются
    armBy: {}
  };
  for (const item of actor?.itemTypes?.critWound ?? []) {
    const m = item.system.mods;
    out.wounds.push(item);
    for (const group of ["stats", "skills", "derived"]) {
      for (const [k, v] of Object.entries(m[group] ?? {})) out[group][k] = (out[group][k] ?? 0) + v;
    }
    // Множители не складываются: берём самый суровый
    for (const [k, v] of Object.entries(m.mult ?? {})) out.mult[k] = Math.min(out.mult[k] ?? 1, v);
    for (const k of ["action", "magic", "duel", "empathicDuel", "sight", "arm", "bleedExtra"]) out[k] += m[k] ?? 0;
    // Кислоту «Раны в живот» гасит щелочной порошок (флаг раны vedmak.acidNeutralized)
    if (!item.flags?.vedmak?.acidNeutralized) out.acid += m.acid ?? 0;
    if (m.arm) {
      const loc = item.system.location || "arm";
      out.armBy[loc] = (out.armBy[loc] ?? 0) + m.arm;
    }
    if (m.headMult) out.headMult = Math.max(out.headMult, m.headMult);
    for (const k of ["bleeding", "poisoned", "suffocating", "armDisabled", "death"]) out[k] ||= !!m[k];
  }
  return out;
}

/**
 * Броня по частям тела. Надетые предметы брони складываются по правилу слоёв (стр. 155):
 * не больше трёх слоёв; более лёгкий слой даёт бонус к более тяжёлому по разности ПБ.
 * У чудовищ естественная броня (`natural`) действует на все части тела как ещё один слой.
 * Врождённая прочность (`innate`, «Закалённый» краснолюдов) просто прибавляется и не разрушается (стр. 23).
 */
export function computeArmor(actor, { natural = 0, innate = 0, bodyType = "humanoid", wornOff = false } = {}) {
  const locations = bodyType === "monster" ? LOCATIONS_MONSTER : LOCATIONS_HUMANOID;
  // wornOff — надетое не учитывается (Истинная форма высшего вампира: только органическая броня)
  const armors = wornOff ? [] : (actor?.itemTypes?.armor ?? []).filter(i => i.system.equipped);
  const pieces = armors.filter(i => !i.system.isShield);
  const shields = armors.filter(i => i.system.isShield);
  const slotFor = CONFIG.VEDMAK?.ARMOR_SLOT_FOR ?? {};

  const result = {};
  for (const [loc, cfg] of Object.entries(locations)) {
    const slot = slotFor[loc] ?? loc;
    const layers = pieces
      .filter(i => i.system.sp[slot]?.max > 0)
      .map(i => ({ id: i.id, name: i.name, value: i.system.sp[slot].value, max: i.system.sp[slot].max, item: i }));
    if (natural > 0) layers.push({ id: null, name: "Естественная броня", value: natural, max: natural });
    const active = layers.filter(l => l.value > 0).sort((a, b) => a.value - b.value).slice(-3);
    let sp = 0;
    for (const layer of active) {
      if (!sp) { sp = layer.value; continue; }
      const hi = Math.max(sp, layer.value), lo = Math.min(sp, layer.value);
      sp = hi + layerBonus(hi - lo);
    }
    // Сопротивление дают только слои, что ещё держат удар: разбитый слой (ПБ 0) не защищает и от типа урона
    const resist = new Set();
    for (const l of active) {
      if (!l.item) continue;
      for (const k of l.item.system.allResistances ?? []) resist.add(k);
    }
    if (innate > 0) sp += innate;
    result[loc] = {
      key: loc, label: cfg.label, mult: cfg.mult, penalty: cfg.penalty, slot,
      sp, layers, resist: [...resist], innate,
      // Самый тяжёлый целый слой — он первым теряет ПБ при пробивании
      outer: active.at(-1) ?? null
    };
  }
  const encumbrance = armors.reduce((s, i) => s + (i.system.encumbrance || 0), 0);
  return { locations: result, encumbrance, shields };
}

/** Сколько килограммов персонаж тащит на себе: всё имущество с весом, с учётом количества (стр. 48). */
export function carriedWeight(actor) {
  let total = 0;
  for (const item of actor?.items ?? []) {
    const w = Number(item.system?.weight);
    if (!Number.isFinite(w) || w <= 0 || item.system?.stored) continue;
    total += w * (item.system.quantity ?? 1);
  }
  // Монеты (настройка мира «Вес монет»)
  if (actor?.system?.money && coinWeightEnabled()) total += coinWeightKg(actor.system.money);
  return Math.round(total * 10) / 10;
}

/**
 * Посчитать всё производное. Вызывается из prepareDerivedData модели после
 * применения Active Effects, поэтому модификаторы уже лежат в `mod`.
 * @param {object} system — данные актора (this модели)
 * @param {object} [opts]
 * @param {number} [opts.baseVigor] — Энергия от профессии и древа
 * @param {number} [opts.naturalArmor] — естественная броня чудовища
 * @param {number} [opts.innateArmor] — врождённая прочность, прибавляется к любой броне
 * @param {string} [opts.bodyType] — таблица частей тела
 * @param {object} [opts.extra] — бонусы к максимумам от расы, древа и школы (не хранятся в данных)
 * @param {object} [opts.caps] — пределы итоговых параметров (Эмп ведьмака ≤ 6)
 * @param {object} [opts.floors] — нижние пределы параметров (Эмп ведьмака ≥ 1)
 * @param {number} [opts.evMod] — поправка к скованности движений (Школа Медведя −2)
 * @param {number} [opts.meleeBodyMod] — поправка Тел для урона в рукопашной и захвата (гномы −3)
 */
export function prepareCommonDerived(system, { baseVigor = 0, naturalArmor = 0, innateArmor = 0, bodyType = "humanoid",
  extra = {}, caps = {}, floors = {}, evMod = 0, meleeBodyMod = 0, wornOff = false, hpMult = 1 } = {}) {
  const actor = system.parent;
  const crit = collectCritMods(actor);
  // Обезболивающее: каждый штраф критических ранений мягче на N (до нуля)
  const pain = Math.max(0, system.fx?.pain ?? 0);
  if (pain) easeCritPenalties(crit, pain);
  const armor = computeArmor(actor, { natural: naturalArmor, innate: innateArmor + (system.fx?.sp ?? 0), bodyType, wornOff });
  const ev = Math.max(0, armor.encumbrance + (armor.encumbrance ? evMod : 0));
  const d = system.derived ??= {};
  const bonus = key => (system.bonus[key] ?? 0) + (extra[key] ?? 0) + (system.fx?.[key] ?? 0);

  // «Сырые» параметры (основа + эффекты) — от них считаются ПЗ, Вын, Уст, Отдых:
  // штрафы ранений к Тел не влияют на ПЗ (стр. 158).
  for (const [key, stat] of Object.entries(system.stats)) {
    let value = stat.base + stat.mod;
    if (caps[key] !== undefined) value = Math.min(value, caps[key]);
    if (floors[key] !== undefined) value = Math.max(value, floors[key]);
    stat.raw = Math.max(0, value);
    stat.abbr = STATS[key].abbr;
    stat.label = STATS[key].label;
  }
  const raw = k => system.stats[k].raw;
  const bw = Math.floor((raw("body") + raw("will")) / 2);

  // Переносимый вес и перегруз: сверх предела −1 к Реа, Лвк и Скор за каждые полные 5 кг (стр. 48)
  d.enc = raw("body") * 10 + bonus("enc") + (crit.derived.enc ?? 0);
  d.carried = carriedWeight(actor);
  d.overload = Math.max(0, Math.floor((d.carried - d.enc) / 5));

  // Итоговые параметры: ранения, скованность движений (Реа и Лвк, не ниже 1 — стр. 79), множители ран
  for (const [key, stat] of Object.entries(system.stats)) {
    let total = stat.raw + (crit.stats[key] ?? 0);
    if (ev && ["ref", "dex"].includes(key)) total = Math.max(Math.min(1, total), total - ev);
    if (d.overload && ["ref", "dex", "spd"].includes(key)) total = Math.max(Math.min(1, total), total - d.overload);
    const mult = crit.mult[`stats.${key}`];
    if (mult) total = Math.floor(total * mult);
    stat.total = Math.max(0, total);
    stat.penalty = stat.total - stat.raw;
  }
  const s = k => system.stats[k].total;

  d.stun = Math.min(10, bw) + bonus("stun") + (crit.derived.stun ?? 0);
  d.stunBase = Math.min(10, bw) + bonus("stun");
  d.run = s("spd") * 3 + bonus("run");
  d.leap = Math.floor(d.run / 5);
  d.rec = Math.floor((bw + bonus("rec") + (crit.derived.rec ?? 0)) * (crit.mult.rec ?? 1));
  d.liftMax = raw("body") * 50;
  d.resolve = Math.floor((raw("will") + raw("int")) / 2) * 5;
  // Урон в рукопашной и захват — по Тел, у гномов на 3 ниже («Коротышка», «Книга сказаний»)
  d.meleeBody = Math.max(1, raw("body") + meleeBodyMod);
  Object.assign(d, bodyTable(d.meleeBody));
  // Бонусы урона: эликсиры («Гром»), мутагены, реликвии
  d.damageBonus = (extra.damage ?? 0) + (system.fx?.damage ?? 0);
  d.meleeBonus += (extra.meleeDamage ?? 0) + (system.fx?.meleeDamage ?? 0);

  // hpMult — медвежья форма берсерка: ПЗ вдвое (character/bear-form.mjs)
  system.hp.max = (bw * 5 + bonus("hp")) * hpMult;
  system.sta.max = Math.floor((bw * 5 + bonus("sta") + (crit.derived.sta ?? 0)) * (crit.mult.sta ?? 1));
  d.woundThreshold = Math.floor(system.hp.max / 5);
  // Касание двимерита (стр. 167): Энергия падает до 0, пока длится контакт (magic/dimeritium.mjs)
  // «Устойчивость к двимериту» мага: устоял — половина Энергии
  const dimeritium = actor?.effects?.find(e => e.active && e.flags?.vedmak?.dimeritium);
  // Двимеритовый протез («Лавка Клауса и Нострадамуса»): носитель под двимеритом и творить не может
  const dimLimb = actor?.itemTypes?.gear?.find(i => i.system.equipped && i.system.category === "prosthetic"
    && prostheticPart(i.name)?.dimeritium);
  const fullVigor = Math.max(0, baseVigor + bonus("vigor"));
  d.vigor = dimLimb ? 0 : !dimeritium ? fullVigor : dimeritium.flags.vedmak.dimeritium.resisted ? Math.floor(fullVigor / 2) : 0;
  d.dimeritium = !!dimeritium || !!dimLimb;
  d.dimeritiumLimb = dimLimb?.name ?? "";

  // Фокусирующий предмет в руках: работает только один — берём лучший (стр. 167)
  let focus = 0, focusItem = "";
  for (const w of actor?.itemTypes?.weapon ?? []) {
    const n = w.system.equipped && w.system.effect("focus") ? Math.max(1, w.system.effectNumber("focus")) : 0;
    if (n > focus) { focus = n; focusItem = w.name; }
  }
  for (const g of actor?.itemTypes?.gear ?? []) {
    if (g.system.equipped && g.system.focus > focus) { focus = g.system.focus; focusItem = g.name; }
  }
  d.focus = focus;
  d.focusItem = focusItem;

  // Бой
  d.encumbrance = ev;
  d.armor = armor.locations;
  d.shields = armor.shields;
  d.bodyType = bodyType;
  d.actionMod = crit.action;
  d.duelMod = crit.duel;
  d.empathicDuelMod = crit.empathicDuel;
  d.sightMod = crit.sight;
  // Ранение руки (стр. 158–160): в какой руке оружие, система не знает — берём худшую руку
  const [armLoc, armMod] = Object.entries(crit.armBy).sort((a, b) => a[1] - b[1])[0] ?? ["", 0];
  d.armMod = Math.min(0, armMod);
  d.armLabel = d.armMod ? (LOCATIONS_HUMANOID[armLoc]?.label ?? LOCATIONS_MONSTER[armLoc]?.label ?? "").toLowerCase() : "";
  d.headMult = crit.headMult;
  d.crit = crit;

  // Состояние здоровья: ниже порога ранения Реа/Лвк/Инт/Воля ×½ (стр. 156),
  // при смерти (ПЗ < 0) — все параметры ×⅓ (стр. 162).
  const hp = system.hp.value;
  d.dying = hp < 0;
  d.wounded = !d.dying && hp < d.woundThreshold && !(system.fx?.ignoreWound > 0);
  for (const [key, stat] of Object.entries(system.stats)) {
    let eff = stat.total;
    // При смерти ⅓; обезболивающее возвращает до N, не выше итога
    if (d.dying) eff = Math.min(stat.total, Math.floor(eff / 3) + pain);
    else if (d.wounded && ["ref", "dex", "int", "will"].includes(key)) eff = Math.floor(eff / 2);
    stat.effective = eff;
  }
  // При смерти ⅓ и у дополнительных параметров (стр. 162): Бег и Прыжок посчитаны выше от итоговой Скор.
  // Уст не трогаем — порог испытания против смерти берётся до штрафа
  if (d.dying) {
    d.run = Math.floor(d.run / 3);
    d.leap = Math.floor(d.run / 5);
  }

  // Навыки: основа = параметр + навык (стр. 50) + штрафы ранений; СД вычитается из магических навыков (стр. 79)
  for (const [key, skill] of Object.entries(system.skills)) {
    const def = SKILLS[key];
    skill.stat = def.stat;
    skill.label = def.label;
    skill.difficult = !!def.difficult;
    let bonus = crit.skills[key] ?? 0;
    if (MAGIC_SKILLS.includes(key)) bonus += crit.magic - ev;
    // Врождённый штраф расы (−5 к Силе у гнома, −4 к Вниманию у боболака) действует и без вложенных очков
    skill.total = skill.value + skill.mod;
    skill.penalty = bonus + crit.action;
    let base = system.stats[def.stat].effective + skill.total + skill.penalty;
    const mult = crit.mult[`skills.${key}`];
    if (mult) base = Math.floor(base * mult);
    skill.base = Math.max(0, base);
    skill.trained = skill.total > 0;
  }
}
