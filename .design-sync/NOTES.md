# Design sync notes (Kilometrica UI kit → Claude Design)

Project: "Kilometrica", https://claude.ai/design/p/268ea801-e5a3-402e-bdd9-59f0e43c786e (first sync 2026-10-18).

## How this repo syncs

- The kit is the workspace package `@dpg/ui` in `packages/ui` (D53): shadcn/ui on React Aria with the owner's shadcn/create preset `b7DMvgbTc`, Kilometrica's own components (`src/components/km`) and purpose-named tokens (`src/styles/kilometrica.css`).
- Build the kit before the converter: `npm run build -w @dpg/ui` (tsc + tsc-alias for `dist/` JS and `.d.ts`, the Tailwind CLI on `src/styles/kit.css` for `dist/styles.css`, then `scripts/copy-fonts.mjs` copies the Inter woff2 files next to it).
- Converter: `node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./node_modules --entry ./packages/ui/dist/index.js --out ./ds-bundle`; validate with `node .ds-sync/package-validate.mjs ./ds-bundle`.
- `dist/styles.css` is built from `kit.css`, not `theme.css`: it adds a safelist of layout, type and colour utilities for the design agent, and `@source`s `.design-sync/previews` so the preview cards' classes are compiled. **After editing a preview, rebuild the kit before the converter**, or new classes are missing from the cards.
- Internal kit imports use the package's own name (`@dpg/ui/components/ui/button`), never `@/`: the web app compiles the kit's source with its own tsconfig, where `@/` would point elsewhere. tsc-alias rewrites them to relative paths in `dist/`.
- The colours ship as `tokens/tokens.css`: the kit build's last step, `scripts/split-tokens.mjs`, moves the `:root` and `.dark` blocks (the preset's and `kilometrica.css`'s) out of `dist/styles.css` into `dist/tokens.css`, and the config's `tokensPkg: "@dpg/ui"` + `tokensGlob: "dist/tokens.css"` copy it into the bundle, where `styles.css` imports it first. Why: Claude Design's token reader stops partway through the compiled Tailwind CSS (the last token it read sat just before shadcn Card's arbitrary-property class `[--card-spacing:…]`, around line 2,600 of 5,700), so after the first sync the token panel listed Tailwind's theme variables but none of the colours, which come near the end.
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
- `split-tokens.mjs` stops the kit build if it finds no `.dark` colour block. After `shadcn apply`, check `theme.css` still declares its colours in plain `:root` and `.dark` blocks (custom properties only), or the colours drop out of `tokens.css` and the token panel.
- After a re-sync, the project's `_ds_manifest.json` (rebuilt only when someone opens the project; the in-app browser isn't signed in to claude.ai, so the owner opens it) should list `--primary`, `--headsup` and the other colours with `definedIn: "tokens/tokens.css"`, and `themes` should hold `.dark`. Checked 2026-10-18: 42 colours plus `--radius` in light, the 42 colours again under `.dark`, and a "Dark" theme.
