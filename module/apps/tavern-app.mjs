// Игры в таверне («Игры в таверне», Elsewhere & Beyond; PLAN 4.100): список игр, участники с поправкой «±»
// (допинг, приёмы, шулерские кости, поддельные карты — по решению ведущего), броски идут сами, итог хода —
// карточкой в чат. Кулачный бой — обычный бой системы, в окне только подсказка. Состояние игры живёт в окне.
// Ставки: у каждого участника своя (в «Драконьем кладе» — 10 крон, они и есть куча); с первым ходом кроны
// уходят в банк, исход игры отдаёт банк победителю, ничья или «Заново» до конца — возвращает ставки.

import { SKILLS } from "../config/skills.mjs";
import { STATS } from "../config/stats.mjs";
import { performCheck, rollD10 } from "../dice/check.mjs";
import { resolveActor } from "../combat/common.mjs";
import { postCard } from "../util.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

export const TAVERN_GAMES = {
  armwrestle: { label: "Борьба на руках", min: 2, max: 2, icon: "fa-solid fa-hand-fist",
    hint: "Встречные проверки Силы; победа — два выигранных раунда подряд. Каждый раунд оба теряют 5 Вын; кто опустился до порога ранения — проиграл." },
  poker: { label: "Покер на костях", min: 2, max: 2, icon: "fa-solid fa-dice",
    hint: "Каждый бросает пять d6 и один раз перебрасывает любые свои кости (щёлкните по ним), затем вскрываются." },
  drinking: { label: "Соревнование по выпивке", min: 2, max: 8, icon: "fa-solid fa-beer-mug-empty",
    hint: "Стойкость СЛ 10, с каждой порцией СЛ +2. Первый провал — опьянение, второй — тошнота и выбывание." },
  hoard: { label: "Драконий клад", min: 2, max: 4, icon: "fa-solid fa-coins",
    hint: "Змея делает Внимание (12 + d10). Перебил его Ловкостью рук — 5 монет из кучи; нет — Уклонение против укуса (10 + d10), иначе яд." },
  fillet: { label: "Филе из пяти пальцев", min: 1, max: 1, icon: "fa-solid fa-hand",
    hint: "Владение лёгкими клинками СЛ 12, каждое ускорение СЛ +3. После двух ускорений предел ставок вдвое; закончить можно после двух ускорений." },
  gwent: { label: "Гвинт", min: 2, max: 2, icon: "fa-solid fa-layer-group",
    hint: "До трёх раундов, побеждает выигравший два. В начале раунда d10 по таблице, поправка — к Азартным играм или Тактике. Колода даёт ±." },
  brawl: { label: "Кулачный бой", min: 0, max: 0, icon: "fa-solid fa-hand-back-fist",
    hint: "Обычный бой системы: по пояс, без доспехов, кастетов и спрятанного оружия. Побеждает оставшийся в сознании или тот, кому сдались." }
};
const GWENT_TABLE = [null,
  { label: "Карта героя", mod: 3 }, { label: "Плохая рука", mod: -3 }, { label: "Карта лидера", mod: 2 },
  { label: "Плохая тасовка", mod: -2 }, { label: "Карта погоды", mod: 1 }, { label: "Карта погоды", mod: 1 },
  { label: "Вражеский шпион", mod: -1 }, { label: "Вражеский шпион", mod: -1 },
  { label: "Вынужденная жертва", mod: -2, next: 3 }, { label: "Путь к победе", reroll: true }];
/** Игры с банком: филе ставят зрители (предел — их Азартные игры), кулачный бой — обычный бой. */
const BANK_GAMES = ["armwrestle", "poker", "drinking", "hoard", "gwent"];
const HOARD_STAKE = 10;
const POKER_RANKS = ["ничего", "пара", "две пары", "сет", "малый стрит", "большой стрит", "фулл-хаус", "каре", "покер"];

/** Комбинация покера на костях: 0 — ничего … 8 — покер. */
function pokerRank(dice) {
  const counts = Object.values(dice.reduce((m, d) => ((m[d] = (m[d] ?? 0) + 1), m), {})).sort((a, b) => b - a);
  const line = [...dice].sort().join("");
  if (counts[0] === 5) return 8;
  if (counts[0] === 4) return 7;
  if (counts[0] === 3 && counts[1] === 2) return 6;
  if (line === "23456") return 5;
  if (line === "12345") return 4;
  if (counts[0] === 3) return 3;
  if (counts[0] === 2 && counts[1] === 2) return 2;
  if (counts[0] === 2) return 1;
  return 0;
}

/** Проверка навыка участника без окна: параметр + навык + поправка «±». */
function skillCheck(actor, key, mod, title, dc = null) {
  const def = SKILLS[key];
  const skill = actor.system.skills?.[key];
  const parts = [
    { label: STATS[def.stat]?.label ?? def.stat, value: actor.system.stats?.[def.stat]?.effective ?? 0, always: true },
    { label: def.label, value: skill?.total ?? 0, always: true }
  ];
  if (skill?.penalty) parts.push({ label: "Ранения", value: skill.penalty });
  if (mod) parts.push({ label: "Поправка «±»", value: mod });
  return performCheck({ actor, title, parts, dc, toChat: false });
}

/** Бросок без актора (змея, укус): основа + d10 по правилам системы. */
async function plainRoll(base) {
  const d = await rollD10();
  return { total: d.fumble ? base - d.fumbleValue : base + d.rollValue, rolls: d.rolls };
}

export class TavernApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "vedmak-tavern",
    classes: ["vedmak", "vedmak-dialog", "tavern-app"],
    window: { title: "Игры в таверне", icon: "fa-solid fa-beer-mug-empty", resizable: true },
    position: { width: 820, height: 620 },
    actions: {
      pickGame: TavernApp.#onPickGame,
      addSelected: TavernApp.#onAddSelected,
      addPlayers: TavernApp.#onAddPlayers,
      removePlayer: TavernApp.#onRemovePlayer,
      reset: TavernApp.#onReset,
      turn: TavernApp.#onTurn,
      pokerDie: TavernApp.#onPokerDie,
      pokerReroll: TavernApp.#onPokerReroll,
      pokerShow: TavernApp.#onPokerShow,
      filletSpeed: TavernApp.#onFilletSpeed
    }
  };

  static PARTS = { body: { template: "systems/vedmak/templates/apps/tavern.hbs", scrollable: [".tv-log"] } };

  static open() {
    const app = foundry.applications.instances.get("vedmak-tavern") ?? new TavernApp();
    return app.render(true);
  }

  game = "armwrestle";
  players = [];
  state = {};
  log = [];

  get cfg() { return TAVERN_GAMES[this.game]; }
  get active() { return this.players.filter(p => !p.out); }

  #fresh(p) { return { uuid: p.uuid, name: p.name, img: p.img, mod: p.mod ?? 0, bet: p.bet ?? 0 }; }
  get bank() { return BANK_GAMES.includes(this.game); }
  #stake(p) { return this.game === "hoard" ? HOARD_STAKE : Math.max(0, Number(p.bet) || 0); }

  async #resetGame() {
    // Игра брошена до конца — ставки возвращаются
    if (this.state.pot && !this.state.settled) await this.#refund("Игра прервана — ставки вернулись.");
    this.state = {};
    this.log = [];
    this.players = this.players.slice(0, this.cfg.max || this.players.length).map(p => this.#fresh(p));
  }

  async _prepareContext() {
    const cfg = this.cfg;
    const st = this.state;
    const ready = this.players.length >= cfg.min && (!cfg.max || this.players.length <= cfg.max);
    return {
      games: Object.entries(TAVERN_GAMES).map(([key, g]) => ({ key, ...g, active: key === this.game,
        size: g.max ? (g.min === g.max ? `${g.min}` : `${g.min}–${g.max}`) : "бой" })),
      game: { key: this.game, ...cfg }, brawl: this.game === "brawl",
      bank: this.bank, started: !!st.started, hoard: this.game === "hoard", stake: HOARD_STAKE,
      players: this.players.map(p => ({
        ...p, dice: (p.dice ?? []).map((v, i) => ({ v, i, sel: p.sel?.includes(i) })), canReroll: !!p.dice && !p.rerolled && !st.shown,
        rank: p.dice ? POKER_RANKS[pokerRank(p.dice)] : "",
        status: [p.out ? "выбыл" : "", p.streak ? `подряд ${p.streak}` : "", p.fails ? `провалов ${p.fails}` : "",
          p.coins !== undefined ? `монет ${p.coins}` : "", p.wins !== undefined ? `раундов ${p.wins}` : "",
          p.carry ? `в след. раунде +${p.carry}` : ""].filter(Boolean).join(" · "),
        gwent: this.game === "gwent", skill: p.skill ?? ""
      })),
      need: cfg.min === cfg.max ? `${cfg.min}` : `${cfg.min}–${cfg.max}`, ready, done: !!st.done,
      poker: this.game === "poker", rolled: !!st.rolled, shown: !!st.shown,
      board: this.#board(), turnLabel: this.#turnLabel(), log: this.log.slice(-14).reverse()
    };
  }

  /** Поле игры: что сейчас на кону. */
  #board() {
    const st = this.state;
    const pot = st.pot ? ` · банк ${st.pot} крон${st.settled ? " (роздан)" : ""}` : "";
    return this.#boardText(st) + pot;
  }

  #boardText(st) {
    switch (this.game) {
      case "drinking": return `Порция ${st.round ?? 0} · следующая — Стойкость СЛ ${10 + 2 * (st.round ?? 0)}`;
      case "hoard": return st.pile === undefined ? `В куче будет ${HOARD_STAKE * this.players.length} крон` : `В куче ${st.pile} крон`;
      case "fillet": return `Ускорений ${st.speed ?? 0} · СЛ ${12 + 3 * (st.speed ?? 0)}${(st.speed ?? 0) >= 2 ? " · предел ставок ×2" : ""}`;
      case "gwent": return `Раунд ${Math.min(3, (st.round ?? 0) + (st.done ? 0 : 1))} из 3`;
      case "armwrestle": return "Победа — два выигранных раунда подряд";
      default: return "";
    }
  }

  #turnLabel() {
    return { armwrestle: "Раунд", drinking: "Порция", hoard: "Раунд со змеёй", fillet: "Удар ножом", gwent: "Раунд", poker: "Бросить кости" }[this.game] ?? "";
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const el of this.element.querySelectorAll("input[data-mod]")) {
      el.addEventListener("change", () => {
        const p = this.players.find(x => x.uuid === el.dataset.mod);
        if (p) p.mod = Number(el.value) || 0;
      });
    }
    for (const el of this.element.querySelectorAll("input[data-bet]")) {
      el.addEventListener("change", () => {
        const p = this.players.find(x => x.uuid === el.dataset.bet);
        if (p) p.bet = Math.max(0, Number(el.value) || 0);
      });
    }
    for (const el of this.element.querySelectorAll("select[data-gwent-skill]")) {
      el.addEventListener("change", () => {
        const p = this.players.find(x => x.uuid === el.dataset.gwentSkill);
        if (p) p.skill = el.value;
      });
    }
  }

  /* ------------------------------ Участники ------------------------------ */

  #add(entries) {
    const max = this.cfg.max || 0;
    for (const e of entries) {
      if (max && this.players.length >= max) break;
      if (!this.players.some(p => p.uuid === e.uuid)) this.players.push(this.#fresh(e));
    }
  }

  static async #onPickGame(event, target) {
    await this.#resetGame();
    this.game = target.dataset.game;
    this.players = this.players.slice(0, this.cfg.max || this.players.length);
    this.render();
  }

  static #onAddSelected() {
    const tokens = canvas?.tokens?.controlled ?? [];
    if (!tokens.length) return ui.notifications.info("Выделите токены участников на сцене.");
    this.#add(tokens.filter(t => t.actor).map(t => ({ uuid: t.document.uuid, name: t.document.name, img: t.document.texture?.src ?? t.actor.img })));
    this.render();
  }

  static #onAddPlayers() {
    this.#add(game.actors.filter(a => a.type === "character" && a.hasPlayerOwner).map(a => ({ uuid: a.uuid, name: a.name, img: a.img })));
    this.render();
  }

  static #onRemovePlayer(event, target) {
    if (this.state.started && !this.state.done) return ui.notifications.warn("Игра идёт — участника не убрать, пока не нажмёте «Заново».");
    this.players = this.players.filter(p => p.uuid !== target.dataset.uuid);
    this.render();
  }

  static async #onReset() {
    await this.#resetGame();
    this.render();
  }

  /* -------------------------------- Банк -------------------------------- */

  /** Изменить кроны участника; false — у актора нет кошелька или нет прав (тогда расчёт вручную). */
  async #pay(p, delta) {
    const X = resolveActor(p.uuid);
    if (!delta || !X?.system?.money || !X.isOwner) return false;
    await X.update({ "system.money.crowns": (X.system.money.crowns ?? 0) + delta });
    return true;
  }

  /** Первый ход: ставки уходят в банк. null — кому-то не хватает крон. */
  async #collect() {
    const st = this.state;
    if (!this.bank) return [];
    for (const p of this.players) {
      const X = resolveActor(p.uuid);
      const stake = this.#stake(p);
      if (stake && X?.system?.money && X.isOwner && (X.system.money.crowns ?? 0) < stake) {
        ui.notifications.warn(`У ${p.name} нет ${stake} крон на ставку.`);
        return null;
      }
    }
    const lines = [];
    const manual = [];
    st.pot = 0;
    for (const p of this.players) {
      p.paid = this.#stake(p);
      if (!p.paid) continue;
      st.pot += p.paid;
      if (!(await this.#pay(p, -p.paid))) manual.push(p.name);
    }
    if (st.pot) lines.push(`Ставки в банке: <b>${st.pot} крон</b> (${this.players.filter(p => p.paid).map(p => `${esc(p.name)} ${p.paid}`).join(", ")}).`);
    if (manual.length) lines.push(`Без кошелька на листе — списать вручную: ${manual.map(esc).join(", ")}.`);
    return lines;
  }

  /** Раздать банк: победителю всё, при ничьей — вернуть ставки. Драконий клад — каждому его монеты. */
  async #settle(winner) {
    const st = this.state;
    if (!st.pot || st.settled) return [];
    st.settled = true;
    const manual = [];
    if (this.game === "hoard") {
      const lines = [];
      for (const p of this.players) {
        if (!p.coins) continue;
        if (!(await this.#pay(p, p.coins))) manual.push(`${p.name} ${p.coins}`);
        lines.push(`${esc(p.name)} уносит ${p.coins} крон.`);
      }
      if (manual.length) lines.push(`Вручную: ${manual.map(esc).join(", ")}.`);
      return lines;
    }
    if (!winner) return this.#refund("Ничья — ставки вернулись.", true);
    if (!(await this.#pay(winner, st.pot))) manual.push(winner.name);
    return [`Банк — <b>${st.pot} крон</b> — забирает ${esc(winner.name)}.${manual.length ? " Выдать вручную." : ""}`];
  }

  async #refund(note, quiet = false) {
    this.state.settled = true;
    const manual = [];
    for (const p of this.players) {
      if (p.paid && !(await this.#pay(p, p.paid))) manual.push(p.name);
    }
    const lines = [note + (manual.length ? ` Вернуть вручную: ${manual.map(esc).join(", ")}.` : "")];
    if (!quiet) await this.#post(lines);
    return lines;
  }

  /* -------------------------------- Ходы -------------------------------- */

  async #post(lines, rolls = []) {
    // Игра закончилась этим ходом — раздать банк
    if (this.state.done && this.state.pot && !this.state.settled) {
      lines.push(...(await this.#settle(this.players.find(p => p.uuid === this.state.winner) ?? null)));
    }
    this.log.push(...lines);
    const actor = resolveActor(this.players[0]?.uuid);
    await postCard(actor, `Таверна: ${this.cfg.label}`, lines.map(l => `<p>${l}</p>`).join(""),
      { icon: this.cfg.icon, rolls: rolls.length ? rolls : undefined });
    this.render();
  }

  async #status(actor, status) {
    if (!actor?.isOwner || actor.statuses?.has(status)) return;
    await actor.toggleStatusEffect(status, { active: true });
  }

  static async #onTurn() {
    if (this.state.done) return;
    const need = this.cfg;
    if (this.players.length < need.min) return ui.notifications.warn(`Нужно участников: ${need.min === need.max ? need.min : `${need.min}–${need.max}`}.`);
    const run = { armwrestle: this.#armwrestle, drinking: this.#drinking, hoard: this.#hoard, fillet: this.#fillet,
      gwent: this.#gwent, poker: this.#pokerRoll }[this.game];
    if (!run) return;
    let opening = [];
    if (!this.state.started) {
      opening = await this.#collect();
      if (!opening) return;
      this.state.started = true;
    }
    this.opening = opening;
    await run.call(this);
  }

  /** Строки ставок первого хода — в начало карточки хода. */
  #lead(lines) {
    if (this.opening?.length) lines.unshift(...this.opening);
    this.opening = null;
    return lines;
  }

  async #armwrestle() {
    const [a, b] = this.players;
    const [A, B] = [resolveActor(a.uuid), resolveActor(b.uuid)];
    if (!A || !B) return ui.notifications.warn("Участник не найден.");
    const ra = await skillCheck(A, "physique", a.mod, "Борьба на руках");
    const rb = await skillCheck(B, "physique", b.mod, "Борьба на руках");
    const lines = [`Сила: ${esc(a.name)} <b>${ra.total}</b> · ${esc(b.name)} <b>${rb.total}</b>.`];
    const win = ra.total > rb.total ? a : rb.total > ra.total ? b : null;
    for (const p of [a, b]) p.streak = p === win ? (p.streak ?? 0) + 1 : 0;
    lines.push(win ? `Раунд за ${esc(win.name)} (подряд ${win.streak}).` : "Ничья — серия сбрасывается.");
    // −5 Вын обоим; до порога ранения — проиграл
    for (const [p, X] of [[a, A], [b, B]]) {
      if (!X.isOwner) continue;
      const sta = Math.max(0, (X.system.sta?.value ?? 0) - 5);
      await X.update({ "system.sta.value": sta });
      if (sta <= (X.system.derived?.woundThreshold ?? 0)) { p.out = true; lines.push(`${esc(p.name)} выдохся: Вын ${sta} — проиграл.`); }
    }
    const left = [a, b].filter(p => !p.out);
    const champ = win?.streak >= 2 ? win : left.length === 1 ? left[0] : null;
    if (champ) { this.state.done = true; this.state.winner = champ.uuid; lines.push(`<b>Победа: ${esc(champ.name)}.</b>`); }
    else if (!left.length) { this.state.done = true; lines.push("<b>Выдохлись оба — ничья.</b>"); }
    await this.#post(this.#lead(lines), [...ra.rolls, ...rb.rolls]);
  }

  async #drinking() {
    const st = this.state;
    st.round = (st.round ?? 0) + 1;
    const dc = 10 + 2 * (st.round - 1);
    const lines = [`Порция ${st.round}: Стойкость СЛ ${dc}.`];
    const rolls = [];
    for (const p of this.active) {
      const X = resolveActor(p.uuid);
      if (!X) continue;
      const r = await skillCheck(X, "endurance", p.mod, "Соревнование по выпивке", dc);
      rolls.push(...r.rolls);
      if (r.success) { lines.push(`${esc(p.name)}: ${r.total} — держится.`); continue; }
      p.fails = (p.fails ?? 0) + 1;
      if (p.fails === 1) { await this.#status(X, "intoxicated"); lines.push(`${esc(p.name)}: ${r.total} — опьянение.`); }
      else { p.out = true; await this.#status(X, "nauseated"); lines.push(`${esc(p.name)}: ${r.total} — тошнота, выбывает.`); }
    }
    const left = this.active;
    if (left.length <= 1) {
      st.done = true;
      st.winner = left[0]?.uuid ?? null;
      lines.push(left.length ? `<b>Победа: ${esc(left[0].name)}.</b>` : "<b>Выбыли все — ничья.</b>");
    }
    await this.#post(this.#lead(lines), rolls);
  }

  async #hoard() {
    const st = this.state;
    if (st.pile === undefined) { st.pile = HOARD_STAKE * this.players.length; for (const p of this.players) p.coins = 0; }
    const snake = await plainRoll(12);
    const lines = [`Змея следит: Внимание <b>${snake.total}</b>.`];
    const rolls = [...snake.rolls];
    for (const p of this.active) {
      const X = resolveActor(p.uuid);
      if (!X || st.pile <= 0) continue;
      const r = await skillCheck(X, "sleight", p.mod, "Драконий клад");
      rolls.push(...r.rolls);
      if (r.total > snake.total) {
        const take = Math.min(5, st.pile);
        st.pile -= take; p.coins += take;
        lines.push(`${esc(p.name)}: ${r.total} — стащил ${take} крон.`);
        continue;
      }
      const bite = await plainRoll(10);
      const dodge = await skillCheck(X, "dodge", 0, "Укус змеи");
      rolls.push(...bite.rolls, ...dodge.rolls);
      if (bite.total > dodge.total) { await this.#status(X, "poisoned"); lines.push(`${esc(p.name)}: ${r.total} — змея кусает (${bite.total} против ${dodge.total}): яд.`); }
      else lines.push(`${esc(p.name)}: ${r.total} — змея бросается, но мимо (${bite.total} против ${dodge.total}).`);
    }
    if (st.pile <= 0) {
      st.done = true;
      const best = Math.max(...this.players.map(p => p.coins ?? 0));
      lines.push(`<b>Куча пуста. Больше всех: ${this.players.filter(p => p.coins === best).map(p => esc(p.name)).join(", ")} (${best}).</b>`);
    }
    await this.#post(this.#lead(lines), rolls);
  }

  async #fillet() {
    const st = this.state;
    const [p] = this.players;
    const X = resolveActor(p.uuid);
    if (!X) return;
    const dc = 12 + 3 * (st.speed ?? 0);
    const r = await skillCheck(X, "smallBlades", p.mod, "Филе из пяти пальцев", dc);
    const lines = [r.success ? `${esc(p.name)}: ${r.total} против СЛ ${dc} — нож мелькает между пальцами.`
      : `${esc(p.name)}: ${r.total} против СЛ ${dc} — нож задел руку, ставки проиграны.`];
    if (!r.success) st.done = true;
    await this.#post(this.#lead(lines), r.rolls);
  }

  static async #onFilletSpeed() {
    this.state.speed = (this.state.speed ?? 0) + 1;
    await this.#post([`Ускорение: СЛ ${12 + 3 * this.state.speed}${this.state.speed === 2 ? "; предел ставок удваивается, закончить уже можно" : ""}.`]);
  }

  async #gwent() {
    const st = this.state;
    st.round = (st.round ?? 0) + 1;
    const lines = [`Раунд ${st.round}.`];
    const rolls = [];
    const totals = [];
    for (const p of this.players) {
      const X = resolveActor(p.uuid);
      if (!X) continue;
      p.wins ??= 0;
      let t = await new Roll("1d10").evaluate();
      rolls.push(t);
      let entry = GWENT_TABLE[t.total];
      let note = entry.label;
      if (entry.reroll) {
        if (st.round === 1) entry = { mod: 0 };
        else { t = await new Roll("1d10").evaluate(); rolls.push(t); entry = GWENT_TABLE[t.total].reroll ? { mod: 0 } : GWENT_TABLE[t.total]; note += ` → ${entry.label ?? "ничего"}`; }
      }
      const tableMod = (entry.mod ?? 0) + (p.carry ?? 0);
      p.carry = entry.next && st.round < 3 ? entry.next : 0;
      const skill = p.skill || ((X.system.skills?.gambling?.base ?? 0) >= (X.system.skills?.tactics?.base ?? 0) ? "gambling" : "tactics");
      const r = await skillCheck(X, skill, (p.mod ?? 0) + tableMod, "Гвинт");
      rolls.push(...r.rolls);
      totals.push([p, r.total]);
      lines.push(`${esc(p.name)}: ${note} (${tableMod >= 0 ? "+" : ""}${tableMod}), ${SKILLS[skill].label} — <b>${r.total}</b>.`);
    }
    const [[a, ta], [b, tb]] = totals;
    const win = ta > tb ? a : tb > ta ? b : null;
    if (win) win.wins += 1;
    lines.push(win ? `Раунд за ${esc(win.name)}.` : "Ничья в раунде.");
    const champ = [a, b].find(p => p.wins >= 2) ?? (st.round >= 3 ? (a.wins > b.wins ? a : b.wins > a.wins ? b : null) : null);
    if (champ || st.round >= 3) {
      st.done = true;
      st.winner = champ?.uuid ?? null;
      lines.push(champ ? `<b>Партия за ${esc(champ.name)}.</b>` : "<b>Партия вничью.</b>");
    }
    await this.#post(this.#lead(lines), rolls);
  }

  async #pokerRoll() {
    const rolls = [];
    const lines = [];
    for (const p of this.players) {
      const r = await new Roll("5d6").evaluate();
      rolls.push(r);
      p.dice = r.dice[0].results.map(x => x.result);
      p.sel = []; p.rerolled = false;
      lines.push(`${esc(p.name)}: ${p.dice.join(" ")} — ${POKER_RANKS[pokerRank(p.dice)]}.`);
    }
    this.state.rolled = true;
    this.state.shown = false;
    await this.#post(this.#lead(lines), rolls);
  }

  static #onPokerDie(event, target) {
    const p = this.players.find(x => x.uuid === target.dataset.uuid);
    if (!p?.dice || p.rerolled || this.state.shown) return;
    const i = Number(target.dataset.i);
    p.sel = p.sel.includes(i) ? p.sel.filter(x => x !== i) : [...p.sel, i];
    this.render();
  }

  static async #onPokerReroll(event, target) {
    const p = this.players.find(x => x.uuid === target.dataset.uuid);
    if (!p?.dice || p.rerolled || !p.sel.length) return;
    const r = await new Roll(`${p.sel.length}d6`).evaluate();
    const fresh = r.dice[0].results.map(x => x.result);
    p.sel.forEach((i, k) => { p.dice[i] = fresh[k]; });
    p.sel = []; p.rerolled = true;
    await this.#post([`${esc(p.name)} перебрасывает: ${p.dice.join(" ")} — ${POKER_RANKS[pokerRank(p.dice)]}.`], [r]);
  }

  static async #onPokerShow() {
    if (!this.state.rolled || this.state.shown) return;
    const score = p => [pokerRank(p.dice), p.dice.reduce((s, x) => s + x, 0)];
    const [a, b] = this.players;
    const [sa, sb] = [score(a), score(b)];
    const cmp = sa[0] - sb[0] || sa[1] - sb[1];
    const win = cmp > 0 ? a : cmp < 0 ? b : null;
    this.state.shown = true;
    this.state.done = true;
    this.state.winner = win?.uuid ?? null;
    await this.#post([
      `${esc(a.name)}: ${a.dice.join(" ")} — ${POKER_RANKS[sa[0]]} (сумма ${sa[1]}).`,
      `${esc(b.name)}: ${b.dice.join(" ")} — ${POKER_RANKS[sb[0]]} (сумма ${sb[1]}).`,
      win ? `<b>Победа: ${esc(win.name)}.</b>` : "<b>Ничья.</b>"
    ]);
  }
}

/** Кнопка «Игры в таверне» в разделе журналов (рядом с «Расследованиями»); `game.vedmak.tavern.open()`. */
export function registerTavernUi() {
  Hooks.on("renderJournalDirectory", (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    const header = root?.querySelector(".directory-header .header-actions") ?? root?.querySelector(".directory-header");
    if (!header || header.querySelector(".vd-tavern")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vd-tavern";
    btn.innerHTML = '<i class="fa-solid fa-beer-mug-empty"></i> Игры в таверне';
    btn.addEventListener("click", () => TavernApp.open());
    header.append(btn);
  });
}
