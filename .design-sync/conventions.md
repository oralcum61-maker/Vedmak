# «Ведьмак: НРИ» — облик «Гравюра»

Это не библиотека React-компонентов, а **облик** фанатской системы «Ведьмак: НРИ» для Foundry VTT: токены `--vd-*`,
шрифты и настоящие стили системы (`_ds_bundle.css`). Компонентов в `window.VedmakGravure` нет — экраны собираются
из обычной разметки на классах системы и токенах. Весь текст интерфейса — по-русски.

## Обёртка (без неё стили не включаются)

Все правила системы висят на классе `.vedmak`, поля ввода — на `.vedmak.sheet`, фон-кожа — на `.window-content`.
Повторяй каркас окна Foundry:

```html
<link rel="stylesheet" href="styles.css">
<body class="system-vedmak">
  <div class="application vedmak sheet">
    <section class="window-content"> … экран … </section>
  </div>
</body>
```

Без `.sheet` поля ввода останутся белыми; без `.window-content` не будет кожаного фона; без `.vedmak` не будет ничего.
Для элемента поверх карты (худ, всплывающее окно) хватит `<div class="vedmak">` и своего фона `var(--vd-bg)`.

## Токены — главный язык

| Смысл | Токены |
|---|---|
| Фон, пластина, колодец | `--vd-bg` `#17181b`, `--vd-bg-2`, `--vd-panel`, `--vd-plate` `#1f2024`, `--vd-well`, `--vd-input`, `--vd-edge` |
| Текст | `--vd-text` `#e2ddd0`, `--vd-text-dim`, `--vd-silver` `#f1ece0` (акцент — светлотой), `--vd-ash`, `--vd-steel` |
| Линии | `--vd-line`, `--vd-line-soft`, `--vd-groove`, `--vd-engrave` (text-shadow гравировки) |
| Цвет по смыслу | `--vd-blood` `#b8432c` / `--vd-blood-lite` — атака, урон, опасность; `--vd-green` — Выносливость, успех; `--vd-brass` / `--vd-brass-lite` — **только Удача** |
| Объём | `--vd-lift`, `--vd-lift-sm` (выпуклое: кнопки, пластины, клейма — их нажимают); `--vd-sink`, `--vd-sink-sm` (утопленное: поля, шкалы — в них вводят или читают) |
| Металл цифр | `--vd-metal`, `--vd-metal-blood`, `--vd-metal-green`, `--vd-metal-brass` — через `background-clip: text`, число отдельным элементом |
| Блик, монета | `--vd-gloss` (на кнопки), `--vd-coin` (монета Удачи) |
| Фактуры (data:) | `--vd-s-window`, `--vd-s-header`, `--vd-s-plate`, `--vd-s-btn`, `--vd-s-chat`; серые плитки `--vd-t-plate`, `--vd-t-brushed`, `--vd-t-leather` и зерно `--vd-grain` — только с `background-blend-mode: overlay` |
| Шрифты | `--vd-font-head` (Vedmak Display / Forum — имена, разделы, числа), `--vd-font-body` (Vedmak Sans / IBM Plex Sans — текст, подписи, кнопки) |

## Готовые классы системы (внутри обёртки)

- `.vd-panel` + `<h3>` — выпуклая пластина раздела с гравированным заголовком; в заголовке `span.stat-val` — число справа.
- `fieldset.vd-fieldset` + `<legend>` — группа полей; внутри `.vd-grid.g2` / `.g3` / `.g4` — сетка подписей с полями.
- `table.vd-table` — таблица без рамок.
- `.go-btn` — главная кнопка действия (киноварь); `.go-btn.arcane` — магия (фиолет), `.go-btn.blood` — явная атака.
  Работает внутри контейнера `.wizard` (или `.tavern`, `.magic-tab`, `.craft-tab`, `.bio-tab`, `.investigation`).

Остальные классы `_ds_bundle.css` привязаны к разметке листов Foundry — для нового экрана бери токены, а не их.

## Правила облика

- Кромок слева у карточек нет; исход — нитью по верху, состояние — цветом клейма.
- Значок — только там, где он сам кнопка; рядом с подписью значков нет.
- Кнопки действий — Vedmak Sans 600, заглавные, разрядка `.16em`; цифры моноширинные.
- Свет сверху: у выпуклого светлая кромка сверху и тень снизу (`--vd-lift`), у утопленного наоборот (`--vd-sink`).

## Где правда

`styles.css` → `fonts/fonts.css` и `_ds_bundle.css` (стили системы целиком, картинки встроены). Перед стилизацией
читай токены в начале `_ds_bundle.css` и слой «Гравюра» (ищи `Гравюра`). Принципы и брифы — в `guidelines/`.

## Пример

```html
<body class="system-vedmak">
  <div class="application vedmak sheet"><section class="window-content" style="padding:20px">
    <div class="vd-panel"><h3>Параметры <span class="stat-val">54</span></h3>
      <p style="margin:0;color:var(--vd-text-dim)">Сумма параметров героя.</p></div>
    <fieldset class="vd-fieldset"><legend>Снаряжение</legend>
      <div class="vd-grid g3"><label>Меч <input value="Волк"></label><label>Крон <input value="300"></label></div></fieldset>
    <div class="wizard" style="display:flex;gap:10px">
      <button class="go-btn">Атаковать</button><button class="go-btn arcane">Колдовать</button></div>
    <b style="font:400 44px var(--vd-font-head);background:var(--vd-metal);-webkit-background-clip:text;background-clip:text;color:transparent">27</b>
  </section></div>
</body>
```
