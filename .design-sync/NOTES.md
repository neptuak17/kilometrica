# Design sync notes (Kilometrica UI kit → Claude Design)

Project: "Kilometrica", https://claude.ai/design/p/268ea801-e5a3-402e-bdd9-59f0e43c786e (first sync 2026-10-18).

## How this repo syncs

- The kit is the workspace package `@dpg/ui` in `packages/ui` (D53): shadcn/ui on React Aria with the owner's shadcn/create preset `b7DMvgbTc`, Kilometrica's own components (`src/components/km`) and purpose-named tokens (`src/styles/kilometrica.css`).
- Build the kit before the converter: `npm run build -w @dpg/ui` (tsc + tsc-alias for `dist/` JS and `.d.ts`, the Tailwind CLI on `src/styles/kit.css` for `dist/styles.css`, then `scripts/copy-fonts.mjs` copies the Inter woff2 files next to it).
- Converter: `node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./node_modules --entry ./packages/ui/dist/index.js --out ./ds-bundle`; validate with `node .ds-sync/package-validate.mjs ./ds-bundle`.
- `dist/styles.css` is built from `kit.css`, not `theme.css`: it adds a safelist of layout, type and colour utilities for the design agent, and `@source`s `.design-sync/previews` so the preview cards' classes are compiled. **After editing a preview, rebuild the kit before the converter**, or new classes are missing from the cards.
- Internal kit imports use the package's own name (`@dpg/ui/components/ui/button`), never `@/`: the web app compiles the kit's source with its own tsconfig, where `@/` would point elsewhere. tsc-alias rewrites them to relative paths in `dist/`.
- `Icons` (a curated Lucide set, `src/icons.ts`) is exported for designs but has no card: `componentSrcMap: {"Icons": null}`.
- New shadcn components: `npx shadcn@latest add <name> -c packages/ui`. After `shadcn apply` (a preset change), check `src/styles/theme.css` still has `@import "./kilometrica.css";` and `@source "../";`.
- Card layout overrides: overlays (Dialog, Popover, Tooltip) render one open cell; preview exports are ordered alphabetically, so Dialog needs `primaryStory: "Open"`. Wide pieces (Table, ChangeBar, DayRow, StretchCard) use column cards.
- npm 11 holds back esbuild's install script in `.ds-sync/` ("install-scripts" warning); esbuild works without it.
- The web dev server needs a restart after a new workspace package is linked (it cached a failed `@dpg/ui` lookup once).

## Verification on the first sync

- The owner declined the Playwright Chromium download, so the converter's render check and grading never ran (`--no-render-check`; the driver's capture stage fails with "playwright not installed").
- Instead, every card was loaded in the app's built-in browser: all 72 load the bundle with no errors; the 24 authored cards render every cell; the Dialog and StretchCard cards were screenshotted and looked right. No grades are recorded.
- Known render warns: none recorded (the render check never ran).

## Re-sync risks

- Nothing has been machine-graded. If Playwright gets installed, run the full render check and grade the 24 authored previews.
- `.design-sync/conventions.md` names classes from the `kit.css` safelist, the colour tokens and the `Icons` list: if any of those change, re-run its validation against the fresh build.
- The owner plans to tweak the colours (the preset's and `kilometrica.css`): after a change, rebuild the kit and re-sync; the conventions' colour names stay valid as long as the token names do.
- Partner theming (D29) relies on the purpose-named tokens; renaming one breaks designs already built with it.
