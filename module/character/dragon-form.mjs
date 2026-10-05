// Драконья форма Золотого дракона («Офир и Зеррикания», стр. 36–38): Метаморфоза против СЛ 12. В форме —
// поправки параметров и навыков, Укус, Когти и Хвост, невосприимчивость к горению, пассивная телепатия; драконья
// магия (стр. 120–122) творится только в ней. Способность «Чем они больше, тем… опаснее!» усиливает форму по уровням
// и даёт −1 к Скрытности за уровень. Выход — по желанию, оружие формы убирается.

import { postCard } from "../util.mjs";

const SYS = "vedmak";
export const GOLDEN_DRAGON = "goldenDragon";
const DC = 12;

/** Поправки формы (таблица «В Драконьей форме»). */
const STAT_MODS = { ref: 4, dex: 6, body: 6, emp: -2, will: 2, spd: 4 };
const SKILL_MODS = { wilderness: 5, brawling: 4, melee: 5, stealth: -4, resistMagic: 5 };

/** Оружие формы: урон, эффекты, СА. Уровни «Чем они больше…» добавляют кости и эффекты. */
function formWeapons(level) {
  const lv = n => level >= n;
  const biteDice = 6 + (lv(2) ? 1 : 0) + (lv(9) ? 1 : 0);
  const clawDice = 4 + (lv(1) ? 1 : 0) + (lv(7) ? 1 : 0);
  const bite = [{ key: "armorPiercing", value: "" }];
  if (lv(4)) bite.push({ key: "bleeding", value: "10%" });
  if (lv(8)) bite.push({ key: "ablating", value: "" });
  return [
    { name: "Укус (Драконья форма)", img: "icons/creatures/abilities/mouth-teeth-fire-orange.webp", damage: `${biteDice}d6`,
      types: ["piercing"], effects: bite, speed: 1, text: "Укус дракона: пробивает броню." },
    { name: "Когти (Драконья форма)", img: "icons/creatures/claws/claw-talons-glowing-orange.webp", damage: `${clawDice}d6`,
      types: ["slashing"], effects: [{ key: "bleeding", value: `${25 + (lv(6) ? 15 : 0)}%` }], speed: 2, text: "Когти дракона: две атаки за действие." },
    { name: "Хвост (Драконья форма)", img: "icons/creatures/abilities/tail-strike-bone-orange.webp", damage: "6d6",
      types: ["bludgeoning"], effects: [], speed: 1, text: "Удар хвостом: дезориентирует с вероятностью 40% (бросок ведущего)." }
  ];
}

/** Поправки формы с учётом уровня «Чем они больше…»: Тел +1 с 5-го, Реа и Лвк +1 с 10-го, Скрытность −1 за уровень. */
function formMods(level) {
  const statMods = { ...STAT_MODS };
  if (level >= 5) statMods.body += 1;
  if (level >= 10) { statMods.ref += 1; statMods.dex += 1; }
  return { statMods, skillMods: { ...SKILL_MODS, stealth: SKILL_MODS.stealth - level } };
}

const signed = v => (v < 0 ? `−${-v}` : `+${v}`);
function modsText(level) {
  const { statMods: s, skillMods: k } = formMods(level);
  return `Реа ${signed(s.ref)}, Лвк ${signed(s.dex)}, Тел ${signed(s.body)}, Эмп ${signed(s.emp)}, Воля ${signed(s.will)}, Скор ${signed(s.spd)}; `
    + `Выживание ${signed(k.wilderness)}, Борьба ${signed(k.brawling)}, Ближний бой ${signed(k.melee)}, Скрытность ${signed(k.stealth)}, `
    + `Сопротивление магии ${signed(k.resistMagic)}`;
}
const weaponsText = level => formWeapons(level).map(w => `${w.name.replace(/ \(.+\)$/, "")} ${w.damage}`).join(", ");

/** Уровень способности «Чем они больше, тем… опаснее!» в древе профессии. */
function biggerLevel(actor) {
  const prof = actor.system.profession?.system;
  for (const b of prof?.branches ?? []) {
    for (const a of b.abilities ?? []) if (/^Чем они больше/i.test(a.name)) return Number(a.value) || 0;
  }
  return 0;
}

export const isGoldenDragon = actor => actor?.type === "character" && actor.system.raceKey === GOLDEN_DRAGON;
export const dragonFormEffect = actor => actor?.effects.find(e => e.flags?.[SYS]?.dragonForm);

/** Данные блока на вкладке «Навыки» → «Профессия». */
export function dragonFormContext(actor) {
  if (!isGoldenDragon(actor)) return null;
  const level = biggerLevel(actor);
  return {
    active: !!dragonFormEffect(actor), level, dc: DC, mods: modsText(level), weapons: weaponsText(level)
  };
}

/** Превращение: Метаморфоза (определяющий навык) против СЛ 12. */
export async function transformDragon(actor) {
  if (!isGoldenDragon(actor) || dragonFormEffect(actor)) return null;
  const result = await actor.rollDefining({ subtitle: "Превращение в дракона", dc: DC });
  if (!result?.success) return result;
  const level = biggerLevel(actor);
  const changes = [];
  const { statMods, skillMods } = formMods(level);
  for (const [k, v] of Object.entries(statMods)) changes.push({ key: `system.stats.${k}.mod`, type: "add", value: String(v), phase: "initial" });
  for (const [k, v] of Object.entries(skillMods)) changes.push({ key: `system.skills.${k}.mod`, type: "add", value: String(v), phase: "initial" });
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: "Драконья форма", img: "icons/creatures/reptiles/dragon-horned-blue.webp",
    system: { changes },
    description: "Поправки формы, невосприимчивость к горению, пассивная телепатия. Драконья магия — только в этой форме.",
    flags: { [SYS]: { dragonForm: { level }, immune: ["burning"] } }
  }]);
  const weapons = formWeapons(level).map(w => ({
    name: w.name, type: "weapon", img: w.img,
    system: {
      description: `<p>${w.text}</p>`, category: "natural", skill: "brawling", damage: w.damage, damageTypes: w.types,
      effects: w.effects.map(e => ({ ...e, source: "" })), attackSpeed: w.speed, equipped: true, hands: 0,
      reliability: { value: 0, max: 0 }, source: { book: "Офир и Зеррикания", page: "38" }
    },
    flags: { [SYS]: { dragonForm: true } }
  }));
  await actor.createEmbeddedDocuments("Item", weapons);
  return postCard(actor, "Драконья форма", `<p>${actor.name} принимает облик золотого дракона.</p>`
    + `<p>${modsText(level)}.</p><p>${weaponsText(level)}. Невосприимчивость к горению; пассивная телепатия.</p>`,
  { icon: "fa-solid fa-dragon" });
}

/** Вернуть прежний облик: эффект и оружие формы снимаются. */
export async function revertDragon(actor) {
  const eff = dragonFormEffect(actor);
  if (!eff) return null;
  const items = actor.items.filter(i => i.flags?.[SYS]?.dragonForm).map(i => i.id);
  if (items.length) await actor.deleteEmbeddedDocuments("Item", items);
  await eff.delete();
  return postCard(actor, "Прежний облик", `<p>${actor.name} возвращает человеческий облик.</p>`, { icon: "fa-solid fa-user" });
}
