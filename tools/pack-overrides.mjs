// Правки компендиумов поверх генераторов автора. `packs-src` целиком перегенерируют скрипты
// D:\Witcher\_tools, поэтому править его руками бесполезно, а в облаке генераторов нет.
// Правки применяются в памяти: build-packs.mjs — перед сборкой LevelDB, check.mjs — перед проверкой.
// Сам packs-src остаётся выводом генераторов. Каждая правка повторяема: если её уже внесли
// в генератор, она просто пропускается.
//
// Виды правок:
//   rename — {pack, from, to}: новое имя документа; то же имя меняется всюду в компендиумах —
//            в чертежах, бестиарии, генераторах, снаряжении профессий (мастер ищет предметы по имени)
//   set    — {pack, name, set: {"путь.к.полю": значение}}: и в документе, и в копиях с тем же именем
//            в инвентаре существ бестиария
//   remove — {pack, name}: удалить документ и чертёж, который его делает
//   copy   — {pack, from, name, set}: новый документ по образцу (id — из имени, как у build-packs)
//   each   — {pack, set}: одно и то же поле всем документам пакета

const W = "systems/vedmak/assets/fan/weapons/";
const A = "systems/vedmak/assets/fan/armor/";
const H = "icons/equipment/head/";
const p = text => `<p>${text}</p>`;

export const OVERRIDES = [
  /* ---------------------------- Оружие (30.09) ---------------------------- */
  { op: "set", pack: "weapons", name: "Красная алебарда", set: { img: `${W}t2-halberd.webp` } },
  { op: "remove", pack: "weapons", name: "Партизан" },
  // Картинка кистеня — боевой молот: её получает молот горца, а он становится «Боевым молотом»
  { op: "rename", pack: "weapons", from: "Молот горца", to: "Боевой молот" },
  { op: "set", pack: "weapons", name: "Боевой молот", set: {
    img: `${W}t3-mace-knight2.webp`,
    "system.description": p("Одноручный молот с тяжёлым бойком и клювом на обухе. Бойком ломают кости сквозь доспех, клювом его пробивают.")
  } },
  { op: "set", pack: "weapons", name: "Кистень из метеоритной стали", set: { img: "icons/weapons/maces/flail-studded-grey.webp" } },
  // Кавалерийский молот и клевец — одно и то же оружие
  { op: "remove", pack: "weapons", name: "Кавалерийский молот" },
  // Кинжал и стилет меняются картинками
  { op: "set", pack: "weapons", name: "Кинжал", set: { img: `${W}t3-knife-ritual.webp` } },
  { op: "set", pack: "weapons", name: "Стилет", set: { img: `${W}t3-knife-assassin.webp` } },
  // Эльфский зефар (стр. 83) — лук на 350 м, а генератор записал его посохом: атака шла бы без Лвк и без дистанций
  { op: "set", pack: "weapons", name: "Эльфский зефар", set: { "system.category": "bow", "system.skill": "archery" } },
  // Орион — метательная звезда, а не меч
  { op: "set", pack: "weapons", name: "Орион", set: { img: "icons/weapons/thrown/throwing-star-quad-steel.webp" } },
  // Ловушки и бомбы в «Оружии» были копиями алхимических из-за ошибки bs_items.py — исправлено в генераторе,
  // теперь они только в «Алхимии»
  { op: "copy", pack: "weapons", from: "Корд", name: "Сабля", set: {
    img: "icons/weapons/swords/scimitar-guard.webp",
    "system.description": p("Изогнутый однолезвийный клинок. Хорош для рубящих ударов с оттягом, особенно верхом.")
  } },

  /* ------------------------------ Броня: голова ------------------------------ */
  { op: "rename", pack: "armor", from: "Темерский армет", to: "Бацинет" },
  { op: "set", pack: "armor", name: "Бацинет", set: {
    img: `${H}helm-bassinet-steel.webp`,
    "system.description": p("Стальной шлем, плотно облегающий голову и спускающийся на виски и затылок. К нему крепится кольчужная бармица, прикрывающая шею и плечи. Обзор и дыхание остаются свободными.")
  } },
  { op: "rename", pack: "armor", from: "Капюшон вердэнского лучника", to: "Лёгкий подшлемник" },
  { op: "set", pack: "armor", name: "Лёгкий подшлемник", set: {
    img: `${H}cap-simple-leather-tan.webp`,
    "system.description": p("Стёганая шапочка из льна и войлока. Её носят под шлемом, чтобы смягчить удар, а когда шлема нет — как единственную защиту головы.")
  } },
  { op: "rename", pack: "armor", from: "Двуслойный капюшон", to: "Стёганый капюшон" },
  { op: "set", pack: "armor", name: "Стёганый капюшон", set: {
    img: `${H}hood-cloth-brown.webp`,
    "system.description": p("Капюшон с оплечьем из нескольких слоёв простёганной ткани. Держит скользящий удар и не стесняет движений.")
  } },
  { op: "rename", pack: "armor", from: "Каркасный шлем с полумаской", to: "Шапель" },
  { op: "set", pack: "armor", name: "Шапель", set: {
    img: `${H}helm-kettle-worn.webp`,
    "system.description": p("Железная шляпа с широкими полями. Поля отводят удары сверху, а лицо остаётся открытым — любимый шлем пехоты и городской стражи.")
  } },
  { op: "rename", pack: "armor", from: "Усиленный капюшон", to: "Салад" },
  { op: "set", pack: "armor", name: "Салад", set: {
    img: `${H}helm-sallet-steel.webp`,
    "system.description": p("Стальной шлем с вытянутым назад назатыльником, закрывающим шею. Лицо прикрывает смотровая щель или откидное забрало.")
  } },
  { op: "rename", pack: "armor", from: "Топфхельм", to: "Салад с бувигером" },
  { op: "set", pack: "armor", name: "Салад с бувигером", set: {
    img: `${H}helm-sallet-grey.webp`,
    "system.description": p("Салад вместе с бувигером — стальной пластиной, закрывающей подбородок, горло и нижнюю часть лица. Вдвоём они почти целиком заключают голову в сталь.")
  } },

  /* ------------------------------ Броня: тело ------------------------------ */
  { op: "rename", pack: "armor", from: "Аэдирнский гамбезон", to: "Укреплённый гамбезон" },
  { op: "set", pack: "armor", name: "Укреплённый гамбезон", set: {
    "system.description": p("Толстая стёганая куртка из многих слоёв ткани, простроченная плотнее обычного гамбезона и усиленная на плечах и груди. Хорошо гасит удары и не звенит на ходу.")
  } },
  { op: "rename", pack: "armor", from: "Двуслойный гамбезон", to: "Кольчужная рубаха" },
  { op: "set", pack: "armor", name: "Кольчужная рубаха", set: {
    "system.description": p("Хауберг — длинная рубаха с рукавами из тысяч склёпанных колец. Её надевают поверх стёганой поддоспешной куртки.")
  } },
  { op: "rename", pack: "armor", from: "Кожаная куртка из Лирии", to: "Полулаты" },
  { op: "set", pack: "armor", name: "Полулаты", set: {
    img: `${A}c-hv-ab-lvl2-1.webp`,
    "system.description": p("Стальная кираса с наплечниками и защитой рук поверх кольчуги. Ноги остаются в стёганых штанах, поэтому полулаты заметно легче полного доспеха.")
  } },
  { op: "set", pack: "armor", name: "Хиндарсфьяльский тяжёлый доспех", set: { img: `${A}c-hv-ab-lvl4.webp` } },
  // Туссентские латы — сине-золотые
  { op: "set", pack: "armor", name: "Латный доспех", set: { img: "icons/equipment/chest/breastplate-layered-steel-blue-gold.webp" } },

  /* ------------------------------ Броня: ноги ------------------------------ */
  { op: "rename", pack: "armor", from: "Кожаные штаны из Лирии", to: "Шинные поножи" },
  // Латы Туссента — сине-стальные набедренники и наколенники; реданские — кожа со сталью в красном цвете Редании
  { op: "set", pack: "armor", name: "Латные поножи", set: { img: "icons/equipment/leg/cuisses-plate-reticulated-steel-blue.webp" } },
  { op: "set", pack: "armor", name: "Реданские поножи", set: { img: "icons/equipment/leg/pants-tasset-leather-steel-red.webp" } },
  { op: "set", pack: "armor", name: "Шинные поножи", set: {
    "system.description": p("Поножи из продольных стальных полос-шин, нашитых на кожаную или стёганую основу. Прикрывают голени и бёдра, не сковывая шага.")
  } },

  /* ------------------------- Бестиарий: Энергия НИП (03.10) ------------------------- */
  // В исходном компендиуме BS & Tobi Энергия у магов и ведьмаков лежит в derivedStats.vigor.value, а max пуст —
  // генератор брал max и ставил 0: знаки и заклинания шли с перегрузкой. Генератор исправлен (bs_bestiary.py),
  // правки ниже — для уже собранного packs-src; после пересборки генератором они пропускаются как внесённые.
  { op: "set", pack: "bestiary", name: "Адепт из Бан-Арда", set: { "system.vigor": 25 } },
  { op: "set", pack: "bestiary", name: "Ведьмак школы Волка", set: { "system.vigor": 7 } },
  { op: "set", pack: "bestiary", name: "Ведьмак школы Грифона", set: { "system.vigor": 9 } },
  { op: "set", pack: "bestiary", name: "Ведьмак школы Змеи", set: { "system.vigor": 7 } },
  { op: "set", pack: "bestiary", name: "Ведьмак школы Кота", set: { "system.vigor": 7 } },
  { op: "set", pack: "bestiary", name: "Ведьмак школы Мантикоры", set: { "system.vigor": 7 } },
  { op: "set", pack: "bestiary", name: "Ведьмак школы Медведя", set: { "system.vigor": 7 } },
  { op: "set", pack: "bestiary", name: "Имлерих", set: { "system.vigor": 25 } },
  { op: "set", pack: "bestiary", name: "Карантир", set: { "system.vigor": 25 } },
  { op: "set", pack: "bestiary", name: "Мастер Пиромант", set: { "system.vigor": 25 } },
  { op: "set", pack: "bestiary", name: "Навигатор дикой охоты", set: { "system.vigor": 25 } },
  { op: "set", pack: "bestiary", name: "Наемник - Ведьмак школы Волка", set: { "system.vigor": 7 } },
  { op: "set", pack: "bestiary", name: "Наемник - Ведьмак школы Грифона", set: { "system.vigor": 9 } },
  { op: "set", pack: "bestiary", name: "Наемник - Ведьмак школы Змеи", set: { "system.vigor": 7 } },
  { op: "set", pack: "bestiary", name: "Наемник - Ведьмак школы Кота", set: { "system.vigor": 7 } },
  { op: "set", pack: "bestiary", name: "Наемник - Ведьмак школы Мантикоры", set: { "system.vigor": 7 } },
  { op: "set", pack: "bestiary", name: "Наемник - Ведьмак школы Медведя", set: { "system.vigor": 7 } },
  { op: "set", pack: "bestiary", name: "Некромант", set: { "system.vigor": 25 } },
  { op: "set", pack: "bestiary", name: "Нитраль", set: { "system.vigor": 25 } },
  { op: "set", pack: "bestiary", name: "Ученица из аретузы", set: { "system.vigor": 10 } },
  { op: "set", pack: "bestiary", name: "Чародей", set: { "system.vigor": 25 } },
  { op: "set", pack: "bestiary", name: "Эредин Бреакк Глас", set: { "system.vigor": 25 } },

  /* ------------------------- Бестиарий: токены можно вращать (03.10) ------------------------- */
  // Генератор ставил всем существам «запретить вращение» — жетоны сверху тогда не повернуть; исправлен и он
  { op: "each", pack: "bestiary", set: { "prototypeToken.lockRotation": false } },
];

/* -------------------------------------------------------------------------- */

const ACTOR_PACKS = ["bestiary"];

function setPath(obj, key, value) {
  const parts = key.split(".");
  let o = obj;
  for (const k of parts.slice(0, -1)) o = (o[k] ??= {});
  o[parts.at(-1)] = value;
}

/** Заменить подстроку во всех строках документа (рекурсивно). */
function replaceStrings(value, from, to) {
  if (typeof value === "string") return value.includes(from) ? value.split(from).join(to) : value;
  if (Array.isArray(value)) return value.map(v => replaceStrings(v, from, to));
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) value[k] = replaceStrings(value[k], from, to);
  }
  return value;
}

/** Копии предмета с тем же именем в инвентаре существ. */
function embeddedCopies(packs, name) {
  return ACTOR_PACKS.flatMap(pk => (packs[pk] ?? []).flatMap(actor => (actor.items ?? []).filter(i => i.name === name)));
}

/**
 * Применить правки к загруженным источникам компендиумов.
 * @param {Record<string, object[]>} packs — имя пакета → массив документов (меняется на месте)
 * @returns {{applied: number, skipped: string[]}}
 */
export function applyOverrides(packs) {
  let applied = 0;
  const skipped = [];
  const find = (pack, name) => (packs[pack] ?? []).find(d => d.name === name);

  for (const o of OVERRIDES) {
    const docs = packs[o.pack];
    if (!docs) { skipped.push(`${o.op} ${o.pack}: пакета нет`); continue; }

    if (o.op === "rename") {
      const doc = find(o.pack, o.from);
      if (!doc) {
        if (!find(o.pack, o.to)) skipped.push(`rename ${o.pack}: нет «${o.from}»`);
        continue;
      }
      for (const list of Object.values(packs)) for (const d of list) replaceStrings(d, o.from, o.to);
      applied++;
    } else if (o.op === "set") {
      const doc = find(o.pack, o.name);
      if (!doc) { skipped.push(`set ${o.pack}: нет «${o.name}»`); continue; }
      for (const target of [doc, ...embeddedCopies(packs, o.name)]) {
        for (const [key, value] of Object.entries(o.set)) {
          if (key === "folder" && target !== doc) continue;
          setPath(target, key, structuredClone(value));
        }
      }
      applied++;
    } else if (o.op === "each") {
      for (const doc of packs[o.pack] ?? []) for (const [key, value] of Object.entries(o.set)) setPath(doc, key, structuredClone(value));
      applied++;
    } else if (o.op === "remove") {
      const i = docs.findIndex(d => d.name === o.name);
      if (i < 0) continue;
      docs.splice(i, 1);
      // Чертёж, который делает удалённый предмет
      const recipes = packs.recipes ?? [];
      for (let j = recipes.length - 1; j >= 0; j--) if (recipes[j].system?.result?.name === o.name) recipes.splice(j, 1);
      applied++;
    } else if (o.op === "copy") {
      if (find(o.pack, o.name)) continue;
      const src = find(o.pack, o.from);
      if (!src) { skipped.push(`copy ${o.pack}: нет «${o.from}»`); continue; }
      const doc = structuredClone(src);
      delete doc._id;
      doc.name = o.name;
      for (const [key, value] of Object.entries(o.set ?? {})) setPath(doc, key, structuredClone(value));
      docs.splice(docs.indexOf(src) + 1, 0, doc);
      applied++;
    }
  }
  return { applied, skipped };
}
