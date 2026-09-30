# «Ведьмак: НРИ» — система для Foundry VTT v14

Неофициальная фанатская система для настольной ролевой игры «Ведьмак» (R. Talsorian Games).
Пишется с нуля и только на русском. Главный документ проекта — **`docs/PLAN.md`**: там этапы,
что сделано, почему так решено и что перенесено на потом. Права на ассеты описаны в `README.md`.

## Где что лежит на компьютере автора

Репозиторий живёт в рабочей папке `D:\Witcher\vedmak`: корень репозитория — это корень системы.

| Путь | Что там | В репозитории? |
|---|---|---|
| `D:\Witcher\vedmak` | рабочие исходники системы | да, весь репозиторий |
| `D:\Witcher\vedmak\packs-src\*.json` | источники компендиумов | да |
| `D:\FoundryVTT-WindowsPortable-14.365\Data\systems\vedmak` | копия для игры, её делает `tools\sync-to-foundry.ps1` (robocopy `/MIR` без `.git`, `node_modules`, `packs-src`). Git там нет и быть не должно | — |
| `D:\Witcher\_notes\kornik.md` | конспект корника; «стр. N» в коде — страница русского корника | нет |
| `D:\Witcher\_tools\*.py` | генераторы `packs-src`: извлечение из PDF, значки, папки | нет |
| `D:\Witcher\_ref\` | чужие системы для сверки: TheWitcherTRPG (GPL-3.0 — **код не копировать**), Deathmarch | нет |
| `D:\Witcher\_foundry_test` | тестовый Foundry: порт 30014, мир `test-vedmak`, система подключена junction'ом | нет |

Сборка компендиумов:
1. `gen_*.py` — корник;
2. `dlc_*.py` — дополнения;
3. `fix_icons.py` — значки;
4. `restructure_folders.py` — папки;
5. `node tools/build-packs.mjs` — Foundry при этом должен быть остановлен.

**LevelDB в `packs/` руками не править**: меняется `packs-src`, потом пакеты пересобираются.
Пересобранные `packs/` коммитятся вместе с `packs-src`.

Правки из облачной сессии доходят до игры так: коммит → `git pull` в `D:\Witcher\vedmak` →
`tools\sync-to-foundry.ps1`. Пакеты пересобираются только на компьютере автора: `build-packs.mjs`
берёт `classic-level` из установленного Foundry.

## Принципы (из PLAN.md)
- Правила как в книге (RAW). Необязательные правила включаются переключателями в настройках.
- Всё считается автоматически, но у Мастера всегда есть ручная правка.
- Никаких зависимостей и сборки: ES-модули `.mjs`, Handlebars, CSS. Модели данных на `TypeDataModel`
  (без `template.json`), листы на `ApplicationV2`.
- Интерфейс, комментарии и коммиты — по-русски.
- Ассеты по играм принадлежат CD Projekt RED, их правила описаны в `assets/fan/О-ПРАВАХ.txt`.
  Жетоны в `assets/tokens/` раздавать нельзя. Репозиторий приватный: так и должно оставаться.

## Карта кода
- `vedmak.mjs` — точка входа: `CONFIG.VEDMAK`, `game.vedmak`, регистрация листов и хуков.
- `module/config/` — справочники: параметры, навыки, бой, магия, персонаж, ремесло, эффекты, таблицы жизненного пути.
- `module/data/` — модели данных (`TypeDataModel`); `module/documents/` — классы Actor и Item.
- `module/sheets/` — листы: персонаж, чудовище, предмет, активный эффект.
- `module/dice/` — проверка d10 и окна бросков. Общая часть окон — `dialog-ui.mjs`: живой пересчёт по `data-base`/`data-mod`/`data-dc`.
- `module/combat/` — атака, защита, урон, испытания, состояния, ход, словесная дуэль, верховой бой.
- `module/magic/`, `module/character/` (развитие, жизненный путь, мастер создания), `module/crafting/`, `module/apps/combat-hud.mjs`.
- `templates/` — Handlebars; `styles/vedmak.css` — все стили; `lang/ru.json`.

## Дизайн
Лист оформлен в стиле «кожа и железо» (PLAN 4.9, 4.15):
- **Шрифты:** Forum — заголовки и числа, PT Serif — текст. Оба лежат локально в `fonts/`.
- **Палитра:** переменные `--vd-*` в начале `styles/vedmak.css`: зола `#16120d`, кость `#ded3bb`, золото `#b4914e`, кровь `#8e2b22`.
- **Фактуры:** 14 штук в `assets/textures/`, накладываются режимом `overlay`. У каждой вкладки свой материал — переменные `--vd-material` и `--vd-panel`.
- **Цвет по смыслу** (`--vd-accent`, `--vd-btn-*`): золото — проверка, кровь — атака, фиолет — магия.

Макеты с холстов claude.ai лежат в `design/`. Всё по ним **уже сделано** в коде:

| Папка | Холст | Где в PLAN |
|---|---|---|
| `design/01-params-tab` | [Вкладка «Параметры»](https://claude.ai/artifact/HVcgTx9znhgiJZPwRcWAYK) | 4.7, 4.9 — позже заменено 4.18 |
| `design/02-roll-dialogs` | [Окно проверки — Ведьмак](https://claude.ai/artifact/4uWVPXr3warkVtZi6iEoR7) | 4.17 |
| `design/03-params-and-rail` | [Параметры и колонка листа](https://claude.ai/artifact/PSGQjMb9bbnqwcoMCjvkD6) | 4.18 |
| `design/04-combat-tab` | [Вкладка «Бой»](https://claude.ai/artifact/639jmEa5tfgT32WAjFasGA) | 4.19 |

В каждой папке `canvas.json` хранит раскладку холста и заметки «что было — что стало».
Файлы `*.dc.html` — артборды в формате холста: сами по себе они не открываются, им нужен `support.js` холста.
Текстуры макетов подключены как `/_blob/<id>`, их копии лежат в `design/textures/`:
`leather`, `steel`, `bronze`, `stone`.
