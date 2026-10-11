# design-sync: заметки

Проект Claude Design «Ведьмак — Гравюра» (`projectId` в `config.json`). Система — Handlebars + CSS, не React, поэтому
переносится **только облик** (tokens-only DS): компонентов нет, `_ds_bundle.js` пустой, вся ценность — в `styles.css`,
памятке (`conventions.md`) и `guidelines/`.

## Как собрать

1. `node .design-sync/prepare.mjs` — собирает `.ds-src/` (в git не входит): `styles/vedmak.css` + `styles/sheet.css`
   одним `gravure.css`, все картинки из `url()` встроены `data:` (фактуры, значки, курсоры — ~40 штук), шрифты рядом,
   пустой `dist/index.js` + `.d.ts` и `package.json` с версией из `system.json`.
2. Скрипты design-sync — в `.ds-sync/` (`cp -r <skill>/... .ds-sync/`), зависимости там же:
   `npm i esbuild ts-morph @types/react react react-dom playwright`.
3. Playwright берёт браузеры из `D:\ms-playwright` — передавать `PLAYWRIGHT_BROWSERS_PATH='D:\ms-playwright'`
   (диск C почти полон). Нужная версия Chromium ставится `npx playwright install chromium` из `.ds-sync`.
4. `node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules .ds-sync/node_modules
   --entry ./.ds-src/dist/index.js --out ./ds-bundle [--remote .design-sync/.cache/remote-sync.json]`.

## Известные предупреждения (не чинить)

- `[TOKENS_MISSING] --cursor-*` — переменные курсоров ставит vedmak.mjs на body при запуске (таблица `CURSORS`).
- `[FONT_MISSING] "IBM Plex Sans", "Forum"` — запасные имена в стеках шрифтов после Vedmak Sans / Vedmak Display.
- `[DTS_REACT]` и `[ZERO_MATCH]` — компонентов нет намеренно.
- В `_ds_bundle.css` конвертер выбрасывает 3 копии `@font-face` (url не в `./fonts/`) — шрифты приходят из `fonts/fonts.css`.

## Проверено вручную

Пробная страница (`.design-sync/.cache/smoke.html`, обёртка `body.system-vedmak > .application.vedmak.sheet >
.window-content`) поверх `ds-bundle/styles.css`: шрифты грузятся, фон-кожа, `.vd-panel`, `.vd-fieldset`, `.vd-table`,
`.go-btn` (в `.wizard`), токены металла, монеты, объёма — рисуются. Без `.sheet` поля белые, без `.window-content`
нет фона.

## Риски при повторном переносе

- Классы в `conventions.md` перечислены руками: после правок стилей проверить, что они есть в `_ds_bundle.css`
  (grep по списку из памятки).
- `guidelines/hud-medallion.md` — бриф худа на 11.10.2026; когда худ будет сделан в системе, обновить или убрать.
- Размер `gravure.css` ~1,3 МБ из-за встроенных картинок; новые большие фактуры его раздуют.
