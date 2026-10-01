// Окна проверок: общие части (Удача, «кому видно», модификаторы) и их живое поведение.
//
// Разметка окон держится на трёх соглашениях, которые читает bindDialog():
//   • data-base    — основа броска; на переключателе (вид атаки) переопределяет основу окна;
//   • data-mod     — правка к броску от отмеченного переключателя или жетона;
//   • data-dmult   — множитель урона от выбранного вида атаки (сильный удар — ×2).
// Итог внизу окна пересчитывается на каждый ввод, поэтому игрок видит бросок до нажатия кнопки.

/** Режимы видимости сообщения — по-русски, вместо английских подписей ядра. */
const MODES = {
  public: { label: "Всем" },
  gm: { label: "Ведущему" },
  blind: { label: "Втёмную" },
  self: { label: "Себе" }
};

/** Кнопки «кому видно»; «Втёмную» — только ведущему. */
export function visibilityModes() {
  const current = game.settings.get("core", "messageMode");
  const keys = ["public", "gm", "self"];
  if (game.user.isGM) keys.splice(2, 0, "blind");
  const modes = keys.filter(key => CONFIG.ChatMessage.modes[key]).map(key => ({ key, ...MODES[key], selected: key === current }));
  if (modes.length && !modes.some(m => m.selected)) modes[0].selected = true;
  return modes;
}

/** Раскрыт ли сворачиваемый блок окна: выбор игрока запоминается в его флагах. */
export function foldState(key, fallback = true) {
  return game.user.getFlag("vedmak", `folds.${key}`) ?? fallback;
}

/** Жетоны Удачи: 1…max, закрашены до выбранного. */
export function luckDots(max, spent = 0) {
  return Array.from({ length: max }, (_, i) => ({ value: i + 1, selected: i + 1 === spent, on: i + 1 <= spent }));
}

/** Подпись под жетонами Удачи. */
export function luckNote(spent, max) {
  return spent ? `потрачено ${spent} из ${max}` : "не тратим";
}

/**
 * Общий низ окна: модификаторы, Удача, видимость.
 * @param {object} cfg
 * @param {number} [cfg.luckMax]  — сколько Удачи есть у актора
 * @param {number} [cfg.luck]     — сколько уже выбрано
 * @param {number} [cfg.mod]      — модификатор к броску
 * @param {string} [cfg.damage]   — формула урона (пусто — поля правки урона не будет)
 * @param {number} [cfg.damageMod] — модификатор к урону
 */
export function commonFields({ luckMax = 0, luck = 0, mod = 0, damage = "", damageMod = 0 } = {}) {
  return {
    mod, damage, damageMod, hasDamage: !!damage,
    luckMax, luckSpent: luck, luckDots: luckDots(luckMax, luck), luckNote: luckNote(luck, luckMax),
    modes: visibilityModes()
  };
}

/** Чтение общих полей в callback кнопки окна. */
export function readCommon(elements, luckMax = 0) {
  return {
    mod: Number(elements.mod?.value) || 0,
    damageMod: Number(elements.damageMod?.value) || 0,
    luck: Math.max(0, Math.min(luckMax, Number(elements.luck?.value) || 0)),
    messageMode: elements.messageMode?.value || "public"
  };
}

/**
 * Живое поведение окна: степперы, жетоны Удачи и итоговые формулы внизу.
 * @param {Application} dialog
 * @param {object} [opts]
 * @param {(form: HTMLFormElement) => void} [opts.extra] — доп. пересчёт окна (энергия сотворения)
 * @param {(form: HTMLFormElement) => number} [opts.base] — своя основа, когда её не описать data-base
 * @param {(form: HTMLFormElement) => number} [opts.mods] — правки, которых нет в data-mod (числовые поля)
 * @param {(form: HTMLFormElement) => string} [opts.damageExtra] — добавка к урону после множителя (разбег)
 */
export function bindDialog(dialog, { extra, base: baseFn, mods: modsFn, damageExtra } = {}) {
  const root = dialog.element;
  const form = root.querySelector("form") ?? root;
  if (!form) return;

  const baseBox = root.querySelector("[data-base]");
  const rollOut = root.querySelector("[data-total-roll]");
  const dmgOut = root.querySelector("[data-total-damage]");
  const luckOut = root.querySelector("[data-luck-note]");
  const baseDefault = Number(baseBox?.dataset.base) || 0;

  const update = () => {
    const checked = [...form.querySelectorAll("input:checked")];
    const picked = checked.find(i => i.dataset.base !== undefined);
    // Основа может быть отрицательной: ниже 0 её не пускает только вычитание критического провала (стр. 157)
    const base = baseFn ? baseFn(form) : picked ? Number(picked.dataset.base) || 0 : baseDefault;
    const luck = Number(form.elements.luck?.value) || 0;
    const mods = checked.reduce((sum, i) => sum + (Number(i.dataset.mod) || 0), 0)
      + (Number(form.elements.mod?.value) || 0) + luck + (modsFn ? modsFn(form) : 0);

    if (baseBox) {
      const value = baseBox.querySelector("b");
      if (value) value.textContent = String(base);
    }
    if (rollOut) rollOut.textContent = `d10 ${base < 0 ? "−" : "+"} ${Math.abs(base)}${mods ? ` ${mods > 0 ? "+" : "−"} ${Math.abs(mods)}` : ""}`;
    if (dmgOut) {
      // Порядок как в броске урона: формула × множитель, затем разбег и правка урона
      const picked2 = checked.find(i => i.dataset.damage !== undefined);
      const formula = picked2 ? picked2.dataset.damage : dmgOut.dataset.damage ?? "";
      const mult = picked ? Number(picked.dataset.dmult) || 1 : 1;
      const dmg = Number(form.elements.damageMod?.value) || 0;
      const multText = mult === 0.5 ? " ×½" : mult !== 1 ? ` ×${mult}` : "";
      dmgOut.textContent = formula
        ? `${formula}${multText}${damageExtra?.(form) ?? ""}${dmg ? ` ${dmg > 0 ? "+" : "−"} ${Math.abs(dmg)}` : ""}`
        : "—";
    }
    // Порог успеха выбранного действия (манёвр верхом), если он объявлен через data-dc
    const hintOut = root.querySelector("[data-total-hint]");
    const dcSource = checked.find(i => i.dataset.dc !== undefined);
    if (hintOut && dcSource) hintOut.textContent = `Нужно больше ${dcSource.dataset.dc}`;
    if (luckOut) luckOut.textContent = luckNote(luck, Number(luckOut.dataset.luckNote) || 0);
    for (const dot of form.querySelectorAll(".luck-row .dot")) {
      dot.classList.toggle("on", (Number(dot.dataset.dot) || 0) <= luck);
    }
    // Полоски вложенной Выносливости в окне сотворения
    const bars = Number(form.elements.cost?.value) || 0;
    for (const bar of form.querySelectorAll("[data-bar]")) {
      bar.classList.toggle("on", (Number(bar.dataset.bar) || 0) <= bars);
    }
    extra?.(form);
  };

  // Свёрнутые блоки: запомнить выбор и держать в заголовке сводку отмеченного,
  // чтобы закрытый блок не прятал правки, уже влияющие на бросок
  const folds = [...root.querySelectorAll("details[data-fold]")];
  const foldNotes = () => {
    for (const d of folds) {
      const note = d.querySelector("[data-fold-note]");
      if (!note) continue;
      const picked = [...d.querySelectorAll("input:checked")]
        .map(i => i.closest("label")?.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
      note.textContent = picked.length ? `· ${picked.join(", ")}` : "· ничего не выбрано";
    }
  };
  for (const d of folds) {
    d.addEventListener("toggle", () => game.user.setFlag("vedmak", `folds.${d.dataset.fold}`, d.open));
  }
  form.addEventListener("change", foldNotes);
  foldNotes();

  // Кнопки «меньше/больше» у числовых полей
  form.addEventListener("click", event => {
    const step = event.target.closest("[data-step]");
    if (!step) return;
    event.preventDefault();
    const field = form.elements[step.dataset.field];
    if (!field) return;
    field.value = String((Number(field.value) || 0) + (Number(step.dataset.step) || 0));
    update();
  });
  form.addEventListener("input", update);
  form.addEventListener("change", update);
  update();
}
