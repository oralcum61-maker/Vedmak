// Кошелёк: обмен у менялы и монеты из добычи чудовищ.

import { CURRENCY_KEYS, moneySetting, exchangeQuote, formatRate } from "../config/money.mjs";
import { postCard } from "../util.mjs";

const { DialogV2 } = foundry.applications.api;

/**
 * Окно обмена: отдаю одну валюту, получаю другую по курсу к кроне, меняла берёт комиссию.
 * Дробные монеты не выдаются: остаток идёт меняле.
 */
export async function exchangeDialog(actor) {
  const { fee, list } = moneySetting();
  const money = actor.system.money ?? {};
  const from0 = CURRENCY_KEYS.find(k => k !== "crowns" && (money[k] ?? 0) > 0) ?? "crowns";
  const to0 = from0 === "crowns" ? "florens" : "crowns";
  const options = sel => CURRENCY_KEYS.map(k =>
    `<option value="${k}" ${k === sel ? "selected" : ""}>${list[k].label} — есть ${money[k] ?? 0}</option>`).join("");

  const content = `<div class="vedmak-roll-dialog exchange-dialog">
    <div class="dlg-row">
      <label class="grow"><span class="cap">Отдаю</span><select name="from">${options(from0)}</select></label>
      <label class="num"><span class="cap">Сколько</span><input type="number" name="amount" value="${money[from0] ?? 0}" min="0" step="1"></label>
    </div>
    <div class="dlg-row">
      <label class="grow"><span class="cap">Получаю</span><select name="to">${options(to0)}</select></label>
      <label class="num"><span class="cap">Комиссия, %</span><input type="number" name="fee" value="${fee}" min="0" max="100" step="1"></label>
    </div>
    <p class="exchange-quote" data-quote></p>
    <p class="hint">Курс — сколько крон стоит монета (меню «Валюты и обмен» в настройках). Дробные монеты меняла оставляет себе.</p>
  </div>`;

  const read = form => ({
    from: form.elements.from.value, to: form.elements.to.value,
    amount: Math.max(0, Math.floor(Number(form.elements.amount.value) || 0)),
    fee: Math.max(0, Math.min(100, Number(form.elements.fee.value) || 0))
  });

  const result = await DialogV2.wait({
    window: { title: `Обмен: ${actor.name}`, icon: "fa-solid fa-scale-balanced" },
    classes: ["vedmak", "vedmak-dialog"],
    position: { width: 460 },
    content,
    render: (event, dialog) => {
      const form = dialog.element.querySelector("form") ?? dialog.element;
      const out = dialog.element.querySelector("[data-quote]");
      const update = () => {
        const r = read(form);
        const q = exchangeQuote(r.from, r.to, r.amount, r.fee);
        const have = money[r.from] ?? 0;
        const bits = [];
        if (r.from === r.to) bits.push("Выберите другую валюту.");
        else if (r.amount > have) bits.push(`Столько нет: ${have} ${list[r.from].abbr}`);
        else {
          bits.push(`<b>${q.get} ${list[r.to].abbr}</b> за ${r.amount} ${list[r.from].abbr}`);
          bits.push(`1 ${list[r.from].abbr} = ${formatRate(list[r.from].rate / list[r.to].rate)} ${list[r.to].abbr}`);
          if (q.feeCrowns) bits.push(`меняле ${formatRate(q.feeCrowns)} кр.`);
        }
        out.innerHTML = bits.join(" · ");
      };
      form.addEventListener("input", update);
      form.addEventListener("change", update);
      update();
    },
    buttons: [{ action: "ok", label: "Обменять", icon: "fa-solid fa-scale-balanced", default: true, callback: (e, b) => read(b.form) },
      { action: "cancel", label: "Отмена", icon: "fa-solid fa-xmark" }],
    rejectClose: false
  });
  if (!result || result === "cancel") return null;

  const { from, to, amount } = result;
  const have = actor.system.money?.[from] ?? 0;
  if (from === to || !amount) return null;
  if (amount > have) return ui.notifications.warn(`Столько нет: ${have} ${list[from].abbr}`);
  const q = exchangeQuote(from, to, amount, result.fee);
  if (q.get <= 0) return ui.notifications.warn("На такую сумму меняла не даст ни монеты.");
  await actor.update({
    [`system.money.${from}`]: have - amount,
    [`system.money.${to}`]: (actor.system.money?.[to] ?? 0) + q.get
  });
  return postCard(actor, "Обмен у менялы",
    `<p>${amount} ${list[from].label.toLowerCase()} → <b>${q.get} ${list[to].label.toLowerCase()}</b>.</p>`
    + `<p class="note dim">Курс: 1 ${list[from].abbr} = ${formatRate(list[from].rate / list[to].rate)} ${list[to].abbr}`
    + `${q.feeCrowns ? ` · комиссия ${result.fee}% (${formatRate(q.feeCrowns)} кр.)` : ""}.</p>`,
    { icon: "fa-solid fa-coins", subtitle: actor.name });
}

/** Валюта по названию строки добычи: «Орены (Темерия)», «Кроны», «Флорены (Нильфгаард)». */
export function currencyForName(name) {
  const n = String(name ?? "").trim().toLowerCase();
  if (!n) return null;
  const { list } = moneySetting();
  // По основе слова: «Крон» подходит и к «Кроны», и к «Крона»
  return CURRENCY_KEYS.find(k => {
    const stem = list[k].label.toLowerCase().slice(0, -1);
    return stem.length >= 3 && n.startsWith(stem);
  }) ?? null;
}

/**
 * Монеты из добычи: бросить количество и положить в кошелёк персонажа пользователя
 * (или выделенного токена-персонажа).
 */
export async function lootCoins(monster, row) {
  const key = currencyForName(row?.name);
  if (!key) return null;
  const token = canvas?.tokens?.controlled?.find(t => t.actor?.type === "character" && t.actor !== monster);
  const hero = token?.actor ?? game.user.character;
  if (!hero) return ui.notifications.warn("Выделите токен персонажа или назначьте себе персонажа — ему достанутся монеты.");
  if (!hero.isOwner) return ui.notifications.warn(`Класть монеты в кошелёк «${hero.name}» может его владелец или ведущий.`);
  let roll;
  try {
    roll = await new Roll(String(row.quantity || "1")).evaluate();
  } catch (err) {
    return ui.notifications.warn(`Не удалось бросить «${row.quantity}»: ${err.message}`);
  }
  const n = Math.max(0, roll.total);
  const { list } = moneySetting();
  await hero.update({ [`system.money.${key}`]: (hero.system.money?.[key] ?? 0) + n });
  return postCard(hero, "Добыча",
    `<p>${monster.name}: <b>${n} ${list[key].label.toLowerCase()}</b> (${row.quantity}) → ${hero.name}.</p>`,
    { icon: "fa-solid fa-coins", rolls: [roll] });
}
