// Анимации JB2A под каждое заклинание (PLAN 4.69). Пути — из бесплатной JB2A 0.9.4, все сверены с её базой
// (выгрузка путей из modules/JB2A_DnD5e/scripts/jb2a_sequencer.js); у платной версии те же пути есть.
// Нет модуля или пути — рисуется свой эффект (scene.mjs).
//
// Как показывать (mode):
//   bolt   — снаряд от заклинателя к каждой цели (нет целей — по направлению зоны или взгляда), затем impact на цели;
//   cone   — конус или струя от точки зоны (или заклинателя) по её направлению на длину зоны;
//   area   — круг в центре зоны (нет зоны — у первой цели или у заклинателя), поперечник — по зоне или size метров;
//   ground — круг под ногами заклинателя (печати ритуалов), под токенами;
//   self   — на заклинателе, scale — во сколько раз больше токена;
//   target — на каждой цели (нет целей — на заклинателе); link — нить от заклинателя к цели перед этим.
// sound — ключ звука системы (assets/sounds); без него — по знаку или стихии, как у своих эффектов.

const bolt = (file, impact, o = {}) => ({ mode: "bolt", file, impact, ...o });
const cone = (file, o = {}) => ({ mode: "cone", file, ...o });
const area = (file, size = 3, o = {}) => ({ mode: "area", file, size, ...o });
const self = (file, scale = 1.6, o = {}) => ({ mode: "self", file, scale, ...o });
const target = (file, scale = 1.4, o = {}) => ({ mode: "target", file, scale, ...o });
const ritual = file => ({ mode: "ground", file, size: 4, below: true, sound: "yrden", cast: "jb2a.cast_generic.02.blue" });
const hex = file => ({ mode: "target", file, scale: 1.1, link: "jb2a.energy_strands.range.standard.purple.01", sound: "axii" });

const HEAL_Y = "jb2a.healing_generic.200px.yellow";
const HEAL_G = "jb2a.healing_generic.200px.green";
const HEAL_B = "jb2a.healing_generic.200px.blue";
const BLESS = "jb2a.bless.200px.intro.yellow";
const CRACK = "jb2a.impact.ground_crack.orange.01";
const FROST = "jb2a.impact.frost.white.01";
const FIRE_HIT = "jb2a.impact.fire.01.orange";
const STRANDS = "jb2a.energy_strands.range.standard.purple.01";
const STUN = "jb2a.markers.stun.purple.01";

// Печати ритуалов по школам (цвета — те, что есть у JB2A)
const R_DIV = "jb2a.magic_signs.circle.02.divination.complete.blue";
const R_DIV_D = "jb2a.magic_signs.circle.02.divination.complete.dark_blue";
const R_ABJ = "jb2a.magic_signs.circle.02.abjuration.complete.blue";
const R_CON = "jb2a.magic_signs.circle.02.conjuration.complete.yellow";
const R_TRA = "jb2a.magic_signs.circle.02.transmutation.complete.yellow";
const R_NEC = "jb2a.magic_signs.circle.02.necromancy.complete.green";
const R_ENC = "jb2a.magic_signs.circle.02.enchantment.complete.pink";
const R_ILL = "jb2a.magic_signs.circle.02.illusion.complete.purple";
const R_EVO = "jb2a.magic_signs.circle.02.evocation.complete.red";

export const SPELL_FX = {
  /* ------------------------------ Ведьмачьи знаки ------------------------------ */
  "Аард": cone("jb2a.gust_of_wind.veryfast", { sound: "aard" }),
  "Сметающий Аард": area("jb2a.thunderwave.center.blue", 8, { sound: "aard", atCaster: true }),
  "Игни": cone("jb2a.burning_hands.01.orange", { sound: "igni" }),
  "Огненный поток": cone("jb2a.fire_jet.orange", { sound: "igni" }),
  "Квен": self("jb2a.markers.shield_rampart.complete.01.orange", 1.7, { sound: "quen" }),
  "Активный щит": self("jb2a.shield.01.complete.01.blue", 1.8, { sound: "quen" }),
  "Аксий": target("jb2a.dizzy_stars.400px.blueorange", 1.2, { link: STRANDS, sound: "axii" }),
  "Марионетка": target("jb2a.markers.chain.spectral_standard.complete.02.blue", 1.4, { link: STRANDS, sound: "axii" }),
  "Ирден": area("jb2a.magic_signs.circle.02.illusion.complete.purple", 6, { below: true, sound: "yrden" }),
  "Магическая ловушка": area("jb2a.magic_signs.circle.02.illusion.complete.dark_purple", 6, { below: true, sound: "yrden", impact: "jb2a.impact.011.blue" }),
  "Сомна": target("jb2a.sleep.symbol.pink", 1.2, { link: STRANDS, sound: "axii" }),
  "Супирре": self("jb2a.particle_burst.01.rune.bluepurple", 1.6, { sound: "spell" }),

  /* ------------------------------ Заклинания магов: смешанные ------------------------------ */
  "Зеркало Афана": target("jb2a.energy_field.01.blue", 1.5),
  "Слепящая пыль": target("jb2a.smoke.puff.ring.01.white", 1.8),
  "Рассеивание": target("jb2a.particle_burst.01.rune.bluepurple", 1.6),
  "Очарование": self("jb2a.markers.heart.pink.01", 1.2),
  "Магический компас": self("jb2a.detect_magic.circle.blue", 3),
  "Управление чувствами": target(STUN, 1.1, { link: STRANDS }),
  "Призыв посоха": self("jb2a.misty_step.02.blue", 1.5),
  "Телепатия": bolt("jb2a.energy_strands.range.standard.purple.02"),
  "Метод Эйльхарт": target("jb2a.markers.stun.purple.02", 1.1, { link: STRANDS }),
  "Иллюзия": target("jb2a.magic_signs.rune.illusion.complete.purple", 1.5),
  "Телепортация": self("jb2a.misty_step.01.blue", 1.6),
  "Мысленный приказ": target("jb2a.markers.stun.purple.03", 1.1, { link: STRANDS }),
  "Магический портал": area("jb2a.portals.vertical.ring.bright_yellow", 3),
  "Алхимическое восстановление": target(HEAL_G),
  "Изъян": target("jb2a.markers.shield_cracked.purple.01", 1.1, { link: STRANDS }),
  "Обнаружение лей-линий": self("jb2a.detect_magic.circle.blue", 4),
  "Погибель Фергуса": target("jb2a.toll_the_dead.green.skull_smoke", 1.4),
  "Удержание языка": target("jb2a.markers.mute.dark_red.01", 1.1, { link: STRANDS }),
  "Магическая проекция": target("jb2a.magic_signs.rune.illusion.complete.purple", 1.5),
  "Переоткрытие портала": area("jb2a.portals.horizontal.ring.bright_yellow", 3),
  "Метод Саволлы": target(HEAL_B),
  "Покров": self("jb2a.energy_field.01.blue", 1.6),
  "Разрыв фокусировки": target(STUN, 1.1, { link: STRANDS }),
  "Камера Дормина": target("jb2a.markers.bubble.complete.blue", 1.6),
  "Усиление": self("jb2a.on_token_buff.001.001.bluepurple", 1.4),
  "Спектральная связь": bolt("jb2a.energy_strands.range.standard.purple.02"),
  "Портал-ловушка": area("jb2a.portals.horizontal.ring.bright_yellow", 3),
  "Тёмное зеркало Беккера": target("jb2a.shield_themed.above.eldritch_web.01.dark_purple", 1.6),
  "Кража заклинания": bolt("jb2a.energy_strands.range.multiple.bluepink.02"),
  "Восстановление трупа": target("jb2a.toll_the_dead.green.complete", 1.5),
  "Буря душ": area("jb2a.toll_the_dead.green.shockwave", 6),
  "Акхан Далл": area("jb2a.thunderwave.center.blue", 4, { sound: "aard" }),
  "Замена Де Клодина": self("jb2a.misty_step.02.blue", 1.6),
  "Процедура Приса": target("jb2a.markers.stun.purple.02", 1.1, { link: STRANDS }),
  "Шторм Ван Аделаиды": area("jb2a.call_lightning.high_res.purple", 6, { sound: "aard" }),

  /* ------------------------------ Земля ------------------------------ */
  "Сенли Грейг": bolt("jb2a.boulder.toss.02.01.stone.brown", CRACK),
  "Коди Бивид": target("jb2a.impact.ground_crack.orange.02", 1.6),
  "Магическое обследование": target("jb2a.detect_magic.circle.blue", 2),
  "Каменный шип": target("jb2a.impact.ground_crack.orange.03", 1.8, { cast: "jb2a.cast_generic.earth.01.browngreen" }),
  "Дыхание Кората": cone("jb2a.gust_of_wind.default"),
  "Перо Лютиэнь": target("jb2a.swirling_feathers.outburst.01.textured", 1.4),
  "Магическое исцеление": target(HEAL_G),
  "Тюрьма Тальфрина": target("jb2a.entangle.brown", 1.6, { cast: "jb2a.cast_generic.earth.01.browngreen" }),
  "Теория Эльгана": target("jb2a.detect_magic.circle.blue", 2),
  "Ристр Грейг": area("jb2a.falling_rocks.top.2x1.grey", 3),
  "Землетрясение Стаммельфорда": area("jb2a.impact.ground_crack.orange.03", 8, { below: true }),
  "Полиморфизм": self("jb2a.smoke.puff.centered.grey", 1.8),
  "Трансмутация": target("jb2a.magic_signs.rune.transmutation.complete.yellow", 1.5),
  "Крифрау": target("jb2a.aura_themed.01.inward.complete.metal.01.grey", 1.6),
  "Земляной столб": target(CRACK, 1.6, { cast: "jb2a.cast_generic.earth.01.browngreen" }),
  "Обострение чувств": self("jb2a.detect_magic.circle.blue", 2),
  "Размягчение земли": area("jb2a.impact.ground_crack.orange.02", 4, { below: true }),
  "Обвал Беккера": area("jb2a.falling_rocks.top.2x1.grey", 3),
  "Бастион Элгана": self("jb2a.aura_themed.01.orbit.complete.metal.01.grey", 1.8),
  "Рой Яведа": target("jb2a.particles.swirl.greenyellow.01.01", 1.6),
  "Кристаллический стазис": target("jb2a.shield_themed.above.ice.01.blue", 1.6),
  "Формование земли": area("jb2a.impact.ground_crack.orange.02", 3, { below: true }),

  /* ------------------------------ Воздух ------------------------------ */
  "Адэнидд": self("jb2a.wind_lines.01.01.white", 1.8),
  "Воздушный пузырь": target("jb2a.bubble.001.001.complete.blue", 1.6),
  "Шквал Бронвина": cone("jb2a.gust_of_wind.veryfast", { sound: "aard" }),
  "Освежение воздуха": area("jb2a.whirlwind.bluegrey", 8),
  "Убежище Уриена": area("jb2a.antilife_shell.blue_with_circle", 8),
  "Статическая буря": area("jb2a.call_lightning.low_res.blue", 10),
  "Телекинез": target("jb2a.markers.chain.spectral_standard.complete.02.blue", 1.4),
  "Зефир": area("jb2a.whirlwind.bluegrey", 4, { sound: "aard" }),
  "Гром Альзура": bolt("jb2a.lightning_bolt.wide.blue", "jb2a.impact.011.blue", { sound: "aard" }),
  "Гвинт Троэлли": area("jb2a.whirlwind.bluegrey", 10, { sound: "aard" }),
  "Удушение": target("jb2a.fumes.steam.white", 1.4, { link: STRANDS }),
  "Дервиш": area("jb2a.whirlwind.bluegrey", 4, { atCaster: true, sound: "aard" }),
  "Гроза": area("jb2a.call_lightning.high_res.blue", 10, { sound: "aard" }),
  "Бронвинский лук": bolt("jb2a.arrow.physical.blue", "jb2a.impact.011.blue"),
  "Пылевое покрытие": area("jb2a.fog_cloud.01.white", 4),
  "Лёгкие ноги": self("jb2a.wind_stream.white", 1.4),
  "Усиление запахов": target("jb2a.fumes.steam.white", 1.4),
  "Шаровая молния": bolt("jb2a.chain_lightning.primary.blue", "jb2a.lightning_strike.blue", { sound: "aard" }),
  "Невидимая лента": bolt("jb2a.energy_strands.range.standard.purple.03"),
  "Прикосновение молнии": target("jb2a.static_electricity.02.blue", 1.4),
  "Гвинтог": area("jb2a.call_lightning.high_res.purple", 10, { sound: "aard" }),
  "Рука бури": bolt("jb2a.lightning_bolt.narrow.blue", "jb2a.impact.011.blue", { sound: "aard" }),

  /* ------------------------------ Огонь ------------------------------ */
  "Энье": bolt("jb2a.fire_bolt.orange", FIRE_HIT, { sound: "igni" }),
  "Айна Версеос": area("jb2a.fire_ring.500px.red", 8, { sound: "igni" }),
  "Огненное клеймо": target(FIRE_HIT, 1.4, { sound: "igni" }),
  "Хватка Кадфана": target("jb2a.flames.04.complete.orange", 1.4, { sound: "igni" }),
  "Магическая вспышка": area("jb2a.explosion.03.blueyellow", 8, { atCaster: true }),
  "Управление пламенем": target("jb2a.flames.02.orange", 1.4, { sound: "igni" }),
  "Танио Ильхар": bolt("jb2a.scorching_ray.01.orange", FIRE_HIT, { sound: "igni" }),
  "Волна огня": cone("jb2a.breath_weapons02.burst.cone.fire.orange.01", { sound: "igni" }),
  "Вспышка Деметии Крест": area("jb2a.explosion.01.orange", 4, { sound: "bomb" }),
  "Пылающий вихрь": area("jb2a.fire_ring.900px.red", 10, { sound: "igni" }),
  "Сейриф Хайль": target("jb2a.flames.04.complete.orange", 1.6, { link: "jb2a.fire_bolt.orange", sound: "igni" }),
  "Огонь Мельгара": area("jb2a.fireball.explosion.orange", 10, { sound: "bomb" }),
  "Зеркальный эффект": bolt("jb2a.fireball.beam.orange", "jb2a.fireball.explosion.orange", { sound: "igni", impactScale: 2.5 }),
  "Дыхание огня": cone("jb2a.breath_weapons.fire.cone.orange.01", { sound: "igni" }),
  "Пламенное покрытие": target("jb2a.flames.orange.01", 1.4, { sound: "igni" }),
  "Безобидное пламя": target("jb2a.dancing_light.yellow", 1.2, { sound: "spell" }),
  "Дым Вахилы": area("jb2a.smoke.plumes.01.grey", 4),
  "Угольная дверь": area("jb2a.fire_ring.500px.red", 2, { sound: "igni" }),
  "Магическая кузница": target(FIRE_HIT, 1.4, { sound: "igni" }),
  "Прикосновение кузнеца": target("jb2a.flames.01.orange", 1.4, { sound: "igni" }),
  "Пламя Кората": area("jb2a.eruption.orange.01", 6, { sound: "bomb" }),
  "Живой огонь": target("jb2a.flaming_sphere.200px.orange.02", 1.4, { sound: "igni" }),

  /* ------------------------------ Вода ------------------------------ */
  "Град Кэрис": bolt("jb2a.spell_projectile.ice_shard.blue", FROST),
  "Управление водой": area("jb2a.water_splash.circle.01.blue", 3),
  "Проклятие Седны": bolt("jb2a.ray_of_frost.blue", FROST),
  "Туман Дормина": area("jb2a.fog_cloud.01.white", 10),
  "Ливень": area("jb2a.sleet_storm.01.blue", 8),
  "Гололёд": area("jb2a.impact.ground_crack.frost.01.white", 4, { below: true }),
  "Пиро Дюр": target("jb2a.water_splash.circle.01.blue", 1.6),
  "Рьеви": bolt("jb2a.ray_of_frost.blue", FROST),
  "Аньяльх": target("jb2a.impact.water.02.blue", 1.6, { link: STRANDS }),
  "Градобитие Меригольд": area("jb2a.sleet_storm.02.blue", 10),
  "Волны Нагльфара": area("jb2a.ice_spikes.radial.burst.white", 6),
  "Расступление вод": area("jb2a.water_splash.circle.01.blue", 6),
  "Трифери Геаф": bolt("jb2a.spell_projectile.ice_shard.blue", "jb2a.ice_spikes.radial.burst.white", { impactScale: 2 }),
  "Дыхание Авроры": self("jb2a.bubble.001.002.complete.blue", 1.6),
  "Скользящий поток": self("jb2a.liquid.splash_side.blue", 1.6),
  "Струя воды": cone("jb2a.water_splash.cone.01.blue"),
  "Паутина льда": target(FROST, 1.6),
  "Инверн": area("jb2a.sleet_storm.blue", 10),
  "Коррозия": cone("jb2a.breath_weapons.acid.line.green"),
  "Эссенция зелья": target("jb2a.healing_generic.200px.purple"),
  "Извлечение Айнфры": bolt("jb2a.energy_strands.range.multiple.purple.01"),
  "Извлечение Айфры": bolt("jb2a.energy_strands.range.multiple.purple.01"),
  "Потоп Ис": area("jb2a.water_splash.circle.01.blue", 10),

  /* ------------------------------ Инвокации жрецов и друидов ------------------------------ */
  "Кипящая кровь": target("jb2a.markers.drop.red.01", 1.1, { link: STRANDS }),
  "Проклятая болезнь": target("jb2a.markers.poison.dark_green.01", 1.1, { link: STRANDS }),
  "Благословение исцеления": target(HEAL_Y),
  "Друг животных": target("jb2a.markers.heart.pink.01", 1.1),
  "Дар природы": target(HEAL_G),
  "Животная сила": target("jb2a.aura_themed.01.outward.complete.nature.01.green", 1.6),
  "Взор природы": self("jb2a.swirling_leaves.complete.01.green", 1.8),
  "Символ скрытого": self("jb2a.markers.runes.orange.01", 1.2),
  "Нити жизни": target(HEAL_G),
  "Управление природой": area("jb2a.vine.complete.nature.group.01.green", 4),
  "Благословение удачи": target(BLESS),
  "Благословение любви": target("jb2a.markers.heart.pink.02", 1.1),
  "Священный свет": self("jb2a.markers.light.complete.blue", 1.6),
  "Хранилище знаний": self("jb2a.ward.rune.yellow.01", 1.6),
  "Песнь небес": area(BLESS, 8),
  "Воды очищения": target(HEAL_B),
  "Паутина лжи": target("jb2a.web.02", 1.6, { link: STRANDS }),
  "Очищающее пламя": target("jb2a.sacred_flame.target.yellow", 1.4, { cast: "jb2a.sacred_flame.source.yellow", sound: "igni" }),
  "Божественный портал": area("jb2a.portals.horizontal.ring.bright_yellow", 3),
  "Святая защита": target("jb2a.shield.01.complete.01.blue", 1.6, { sound: "quen" }),
  "Божественная мудрость": self("jb2a.divine_smite.caster.blueyellow", 1.6),
  "Свет истины": target("jb2a.sacred_flame.target.yellow", 1.4),
  "Благословение смерти": target("jb2a.toll_the_dead.green.bell", 1.4),
  "Вечный суд": target("jb2a.divine_smite.target.blueyellow", 1.6, { sound: "igni" }),
  "Храбрость Фрейи": area("jb2a.spirit_guardians.blueyellow.ring", 10, { atCaster: true }),
  "Целительный покой": target(HEAL_B),
  "Божественная удача": target(BLESS),
  "Белое пламя": area("jb2a.spirit_guardians.blueyellow.ring", 10, { sound: "igni" }),
  "Благословенное оружие": target("jb2a.divine_smite.caster.blueyellow", 1.4),
  "Божественное вдохновение": target(BLESS),
  "Двойственная тьма": target("jb2a.darkness.black", 1.2),
  "Свет покаяния": target("jb2a.sacred_flame.target.yellow", 1.4),
  "Божественное присутствие": self("jb2a.divine_smite.caster.standard.blueyellow", 1.8),
  "Благословение изобилия": self(BLESS, 1.6),
  "Клеймо увядания": target("jb2a.toll_the_dead.green.skull_smoke", 1.4, { link: STRANDS }),
  "Божественное перо": target("jb2a.swirling_feathers.outburst.01.textured", 1.4),
  "Поиск ищущих": self("jb2a.detect_magic.circle.blue", 4),
  "Сагитта Аурея": bolt("jb2a.guiding_bolt.01.blueyellow", "jb2a.sacred_flame.target.yellow"),
  "Благословенный табун": self(BLESS, 1.8),
  "Кровь берсерка": self("jb2a.markers.drop.red.02", 1.2),
  "Чемпион реки": target("jb2a.water_splash.circle.01.blue", 1.6),
  "Праздник изобилия": target(BLESS),
  "Чудо Лебеды": target(HEAL_Y),
  "Предзнаменование несчастья": self("jb2a.markers.fear.dark_purple.01", 1.2),
  "Возмездие ворона": target("jb2a.markers.skull.purple.01", 1.1, { link: "jb2a.energy_strands.range.standard.purple.04" }),
  "Серебряный свет": target("jb2a.markers.light.complete.blue", 1.6),
  "Травничество": target("jb2a.swirling_leaves.complete.02.green", 1.6),
  "Печать щедрости": target("jb2a.ward.star.yellow.01", 1.6),
  "Осквернение Бигелоу": area("jb2a.toll_the_dead.green.shockwave", 4),
  "Голос советника": target("jb2a.markers.music_note.blue.01", 1.1),
  "Паутина корней": target("jb2a.entangle.green", 1.6),
  "Слово призыва": self("jb2a.markers.music_note.blue.02", 1.2),
  "Кровь горы": target("jb2a.aura_themed.01.orbit.complete.metal.01.grey", 1.6),
  "Друидский тотем": area("jb2a.plant_growth.03.round.2x2.complete.greenyellow", 2, { below: true }),
  "Друидический тотем": area("jb2a.plant_growth.03.round.2x2.complete.greenyellow", 2, { below: true }),
  "Печать охоты": target("jb2a.hunters_mark.pulse.01.green", 1.4),
  "Гнев природы": area("jb2a.vine.complete.nature.group.02.green", 6),
  "Тень Блеобхериса": area("jb2a.swirling_leaves.complete.01.green", 8),
  "Ветры тайги": self("jb2a.wind_lines.01.leaves.01.green", 3),
  "Святилище Чёрной рощи": area("jb2a.plant_growth.03.ring.4x4.complete.greenyellow", 4, { below: true, atCaster: true }),
  "Заговор Матери": self("jb2a.wind_lines.01.leaves.02.green", 3),
  "Колодец знаний": self("jb2a.detect_magic.circle.blue", 3),
  "Благословение богатства": self("jb2a.glint.yellow.many", 1.6),

  /* ------------------------------ Ритуалы: печать под ногами по школе ------------------------------ */
  "Ритуал очищения": ritual(R_ABJ),
  "Гидромантия": ritual(R_DIV),
  "Магическое сообщение": ritual(R_DIV),
  "Пиромантия": ritual(R_EVO),
  "Ритуал жизни": ritual(R_CON),
  "Магический ритуал": ritual(R_EVO),
  "Сосуд заклятия": ritual(R_TRA),
  "Освящение": ritual(R_ABJ),
  "Спиритический сеанс": ritual(R_NEC),
  "Магический барьер": ritual(R_ABJ),
  "Телекоммуникация": ritual(R_DIV),
  "Онейромантия": ritual(R_DIV_D),
  "Артефактная компрессия": ritual(R_TRA),
  "Сотворение голема": ritual(R_CON),
  "Интерактивная иллюзия": ritual(R_ILL),
  "Создание хрустального черепа": ritual(R_NEC),
  "Наполнение трофея": ritual(R_TRA),
  "Наполнить трофей": ritual(R_TRA),
  "Тиромантия": ritual(R_DIV),
  "Оживление брони": ritual(R_TRA),
  "Подвеска спорщика": ritual(R_ENC),
  "Спорная подвеска": ritual(R_ENC),
  "Маяк неестественного": ritual(R_DIV_D),
  "Туман прошлого": ritual(R_DIV),
  "Создание места силы": ritual(R_CON),
  "Волшебная гостевая книга": ritual(R_DIV),
  "Зачарование амулета": ritual(R_ENC),
  "Зачарованный амулет": ritual(R_ENC),
  "Синтез Кадфана": ritual(R_TRA),
  "Создание маяка души": ritual(R_NEC),
  "Синий сон Ханмарвина": ritual(R_DIV_D),
  "Оживление трупа": ritual(R_NEC),
  "Неконтролируемый призыв": ritual(R_CON),
  "Контролируемый призыв": ritual(R_CON),
  "Ритуал именования": ritual(R_ENC),
  "Ритуал связывания": ritual(R_ABJ),
  "Ритуал козьей шкуры": ritual(R_ENC),
  "Живой доспех": ritual(R_TRA),

  /* ------------------------------ Порчи: нить к цели и знак на ней ------------------------------ */
  "Теневая порча": hex("jb2a.markers.fear.dark_purple.02"),
  "Вечный зуд": hex("jb2a.markers.poison.dark_green.02"),
  "Дьявольская удача": hex("jb2a.markers.skull.dark_orange.01"),
  "Кошмар": hex("jb2a.markers.horror.purple.01"),
  "Поцелуй Песты": hex("jb2a.markers.poison.dark_green.01"),
  "Звериная порча": hex("jb2a.markers.skull.purple.02"),
  "Проклятие трезвости": hex("jb2a.markers.mute.dark_red.02"),
  "Отвратительная порча": hex("jb2a.markers.poison.dark_green.03"),
  "Дурной сглаз": hex("jb2a.eyes.01.dark_green.single"),
  "Стеклянные кости": hex("jb2a.markers.shield_cracked.purple.02"),
  "Бесконечная потребность": hex("jb2a.markers.drop.red.03"),
  "Порча забвения": hex("jb2a.markers.stun.purple.03"),

  /* ------------------------------ Магические дары ------------------------------ */
  "Успокоить животное": target("jb2a.markers.heart.pink.03", 1.1),
  "Аура страха": self("jb2a.markers.fear.dark_purple.03", 1.4, { sound: "axii" }),
  "Сильные ноги": self("jb2a.wind_stream.white", 1.4),
  "Зелёный росток": area("jb2a.plant_growth.03.round.2x2.complete.greenyellow", 2, { below: true }),
  "Крошечная иллюзия": self("jb2a.magic_signs.rune.illusion.complete.purple", 1.2),
  "Пигмент": self("jb2a.particles.swirl.greenyellow.02.01", 1.4),
  "Аэрокинез": self("jb2a.wind_lines.01.02.white", 1.8, { sound: "aard" }),
  "Криокинез": self("jb2a.markers.snowflake.blue.01", 1.2),
  "Определение яда": self("jb2a.markers.poison.dark_green.01", 1.1),
  "Укрепление": self("jb2a.markers.shield.green.01", 1.2, { sound: "quen" }),
  "Геокинез": self(CRACK, 1.8),
  "Пирокинез": self("jb2a.flames.02.orange", 1.4, { sound: "igni" }),
  "Видение ауры": self("jb2a.detect_magic.circle.blue", 3),
  "Заточка оружия": self("jb2a.glint.yellow.few", 1.4, { sound: "oil" }),

  /* ------------------------------ Вампирская магия («Высший вампир. Вторая редакция») ------------------------------ */
  // Монарх: летучие мыши, страх и давление — лиловые знаки ужаса
  "Мелкие твари": self("jb2a.bats.complete.01.red", 2.4),
  "Живое облако": area("jb2a.bats.loop.01.red", 2),
  "Довление": target("jb2a.markers.stun.purple.02", 1.1, { link: STRANDS, sound: "axii" }),
  "Неприкосновенность": self("jb2a.on_token_buff.001.001.purplered", 1.6, { sound: "quen" }),
  "Аура повиновения": area("jb2a.template_circle.symbol.normal.fear.dark_purple", 6, { atCaster: true, sound: "axii" }),
  "Щит превосходства": self("jb2a.shield_themed.above.eldritch_web.01.dark_purple", 1.7, { sound: "quen" }),
  "Парализующий ужас": target("jb2a.markers.horror.purple.02", 1.3, { link: STRANDS, sound: "axii" }),
  "Полная тишина": area("jb2a.template_circle.symbol.normal.horror.purple", 8, { atCaster: true, sound: "axii" }),
  // Заклинатель крови: брызги, капли, алые цепи и круг
  "Кровавый шип": bolt("jb2a.lasershot.red", "jb2a.liquid.splash02.red"),
  "Иссушение": target("jb2a.markers.drop.red.03", 1.2, { link: STRANDS }),
  "Рваная жила": target("jb2a.liquid.splash_side02.red", 1.3),
  "Струп": target("jb2a.markers.drop.red.01", 1.1),
  "Кровосток": target("jb2a.liquid.splash02.red", 1.6, { link: STRANDS }),
  "Парализующее кровотечение": target("jb2a.markers.chain.standard.complete.02.red", 1.3),
  "Кровавый щит": target("jb2a.magic_signs.circle.02.evocation.complete.dark_red", 1.6, { sound: "quen" }),
  "Казнь": target("jb2a.liquid.splash02.red", 2.2, { sound: "spell" }),
  "Раб крови": target("jb2a.markers.chain.standard.complete.02.red", 1.4, { link: STRANDS, sound: "axii" }),
  "Кровавая печать смерти": target("jb2a.condition.curse.01.012.red", 1.4, { link: STRANDS }),
  // Повелитель Теней: дым, тьма, летучие клинки
  "Теневой рывок": self("jb2a.smoke.puff.centered.grey", 1.5),
  "Мираж": target("jb2a.smoke.puff.ring.01.white", 1.3),
  "Обман": self("jb2a.markers.simple.001.complete.001.red", 1.2),
  "Клинок из-за плеча": target("jb2a.cloud_of_daggers.daggers.red", 1.2),
  "Завеса охотника": self("jb2a.darkness.black", 1.6),
  "Невидимый враг": self("jb2a.darkness.black", 2),
  "Ночь шипов": area("jb2a.arms_of_hadar.dark_purple", 8, { atCaster: true })
};

/** Рецепт анимации заклинания по имени предмета (имена — как в компендиуме «Магия»). */
export function spellFxFor(name) {
  return SPELL_FX[String(name ?? "").trim()] ?? null;
}
