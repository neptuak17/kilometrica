# Design system notes (Kilometrica UI kit → Claude Design System artifact)

Artifact: "Kilometrica", https://claude.ai/artifact/NegAN39kYR2QysXFPk8GWt, an artifact of the Design System type. The repo is its source (D53): change the kit here, rebuild, publish.

## Retired: the standalone Claude Design project

- From 2026-10-18 the kit synced to the standalone project https://claude.ai/design/p/268ea801-e5a3-402e-bdd9-59f0e43c786e through `/design-sync` (the DesignSync tool), and Claude Design's "Migrate again" copied it into Claude. On 2026-10-18 the copy in Claude was converted to the Design System format, so "Migrate again" now skips it, and the standalone site closes on 2026-12-14. **Don't run `/design-sync` or upload to the standalone project.**
- The DesignSync tool (Claude Code 2.1.302) can only write standalone projects. If a newer `/design-sync` writes Design System artifacts, compare its output with this route before switching: the artifact has changes of its own (dark mode on `data-theme`, the README, the cover) that a fresh sync could overwrite.

## The kit

- The kit is the workspace package `@dpg/ui` in `packages/ui` (D53): shadcn/ui on React Aria with the owner's shadcn/create preset `b7DMvgbTc`, Kilometrica's own components (`src/components/km`) and purpose-named tokens (`src/styles/kilometrica.css`).
- Its build (`npm run build -w @dpg/ui`): tsc + tsc-alias for `dist/` JS and `.d.ts`, the Tailwind CLI on `src/styles/kit.css` for `dist/styles.css`, `scripts/copy-fonts.mjs` for the Inter woff2 files, and `scripts/split-tokens.mjs`, which moves the `:root` and `.dark` colour blocks of `theme.css` and `kilometrica.css` into `dist/tokens.css`.
- `dist/styles.css` is built from `kit.css`, not `theme.css`: it adds a safelist of layout, type and colour utilities for the design agent, and `@source`s `.design-sync/previews` so the preview cards' classes are compiled. After editing a preview, rebuild the kit (the full command does).
- Internal kit imports use the package's own name (`@dpg/ui/components/ui/button`), never `@/`: the web app compiles the kit's source with its own tsconfig, where `@/` would point elsewhere. tsc-alias rewrites them to relative paths in `dist/`.
- `Icons` (a curated Lucide set, `src/icons.ts`) is exported for designs but has no card: `componentSrcMap: {"Icons": null}` in `config.json`.
- New shadcn components: `npx shadcn@latest add <name> -c packages/ui`. After `shadcn apply` (a preset change), check `src/styles/theme.css` still has `@import "./kilometrica.css";` and `@source "../";`, and still declares its colours in plain `:root` and `.dark` blocks (custom properties only), or `split-tokens.mjs` stops the build.
- Card layout overrides in `config.json`: overlays (Dialog, Popover, Tooltip) render one open cell; preview exports are ordered alphabetically, so Dialog needs `primaryStory: "Open"`. Wide pieces (Table, ChangeBar, DayRow, StretchCard) use column cards.
- The web dev server needs a restart after a new workspace package is linked (it cached a failed `@dpg/ui` lookup once).

## Building: `npm run design-system`

- On a fresh clone, once: `npm install`, then `npm run design-system:setup` (the converter's own esbuild and ts-morph, in `.ds-sync/node_modules`; npm 11 holds back esbuild's install script with an "install-scripts" warning, and esbuild works without it).
- The command runs the kit build, then the converter, `.ds-sync/package-build.mjs` (the old `/design-sync` converter, committed so the route survives the tool; driven by `config.json`) into `ds-bundle/`, then `.design-sync/build-artifact.mjs`, which writes the artifact's files to `ds-artifact/project/` and their hashes to `ds-artifact/build.json`. Both folders are ignored by git.
- It takes about 10 minutes on this laptop, mostly the five previews that import `lucide-react` icons (about 2 minutes each through the converter's esbuild plugins, with esbuild busy the whole time: slow, not stuck). Run it in the background. After editing only `.design-sync/` inputs (notes, README text), `node .design-sync/build-artifact.mjs` alone is enough.
- What `build-artifact.mjs` makes from what:
  - `components/bundle.js`, `components/lib/react.js` and `react-dom.js` (a stub; React and ReactDOM are one file): the converter's, unchanged.
  - `components/bundle.css`: the converter's `_ds_bundle.css`, with `:is(.dark *)` extended to `:is(.dark *, [data-theme="dark"] *)`, font urls changed to `../fonts/`, and `--font-sans`, `--font-mono` and `--spacing` moved out to `tokens.css` (as `tokens.json`'s font families and spacing).
  - `components/<Name>/<Name>.d.ts` as is; `README.md` from `<Name>.prompt.md` with the bundle's path; `preview.html` from the card (`<Name>.html`) with its `_preview/<Name>.js` inlined, the frame-provided tags dropped, colours from the tokens, and a height on the marker: the card's viewport, else 200 for a written preview and 160 for a "not yet authored" card. `components/index.d.ts` joins the types in the bundle's order.
  - `tokens.json`: colour values from `packages/ui/dist/tokens.css` (light from `:root`, dark from `.dark`, `var(--x)` as the alias `{x}`), the radius from there too, spacing, font families and text sizes from the bundle's Tailwind theme, fonts from `fonts.css`. Everything hand-written (usage notes, the colour note, text samples) comes from `.design-sync/tokens.json`.
  - `tokens.css`: compiled from `tokens.json` the way the Design System page does (all colours on `:root, [data-theme="light"]`, the dark values that differ on `[data-theme="dark"]`, then lengths, font families, a `.type-*` class per text style and the `@font-face` rules). The type's instructions leave this file to the page, but a publish from outside doesn't regenerate it, so the build writes it in the same format.
  - `fonts/`, `styles.css`, and `README.md`: `conventions.md`, the converter's generated part with the artifact's paths, then `readme-footer.md` (the React version filled in).
- **Usage notes.** `.design-sync/tokens.json` is the last-built `tokens.json` and the home of every note. A token keeps its note while its light and dark values are unchanged. When a colour changes, the build drops its note and lists it; write a new note there (with the contrast ratios recomputed, in both themes, against the grounds the old note named) and run `build-artifact.mjs` again before publishing. Tokens no longer in the CSS are left out and listed.
- **Files the build never writes** (they belong to the artifact): `design-system.json` (the index; see step 5 below), `components/Cover/preview.html` (the cover), `assets/` and `archived/` (the pre-conversion layout; remove after 2026-12-14, with the owner's OK).

## Publishing (Claude, with the Artifact tool)

There is no token in the repo: Claude publishes with the Artifact tool, as the owner. The Design System type's rules: write only under `project/`, send only changed files, the index last. The artifact's settings (url, repo, by) are in `.design-sync/artifact.json`: the converter refuses keys it doesn't know in `config.json`.

1. Commit the repo changes, then build.
2. Read the artifact back: Artifact `read` with `url` = the artifact, `paths` = every key of `ds-artifact/build.json`'s `files` (233 today, one call; `node -e "console.log(JSON.stringify(Object.keys(require('./ds-artifact/build.json').files)))"`), and `out_dir` = a new folder in the scratchpad.
3. `node .design-sync/artifact-diff.mjs <that folder>` lists the files to send (written to `ds-artifact/send.json`), files **edited on the page** since the last publish (their hash no longer matches `.design-sync/published.json`: stop, show the owner, bring the edit into the repo or replace it), and files published before but no longer built (remove with `null` only with the owner's OK). Nothing to send: stop there. An unchanged build publishes nothing.
4. Read the artifact with `url` alone (no `paths`): the Artifact tool refuses a publish ("You haven't viewed the latest version") until that plain read has seen the current version, and reads by path don't count. Then one publish: `url` = the artifact, `root` = `ds-artifact`, `file_path` = one of the files to send (its full path), `files` = the rest of `send.json` (255 paths a call at most). No `capabilities`, `contract` or `icon`. The Artifact tool doesn't serve `.ts`: send every `.d.ts` (each component's and `components/index.d.ts`) as `{"from": <path>, "contentType": "text/plain"}`, which is how the artifact holds them; a `.d.ts` named as a plain path refuses the whole publish.
5. The index: the Artifact tool sends `design-system.json` only when one of its own keys changes (title, libraries, an asset record). Read it again and run `node .design-sync/artifact-index.mjs <that copy> "<one-line note>"`. When the build's React matches the index's `libraries` it says so and writes nothing: don't send the index. Otherwise it writes `ds-artifact/project/design-system.json` with the new `libraries` and `lastChange` (by Cliff, `via` "neptuak17/kilometrica@<commit>"); publish it alone, last.
6. Read every path back again into a new folder and run `node .design-sync/artifact-diff.mjs <folder> --record`: it checks every built file now matches and rewrites `published.json`. Commit it.

A publish refused because someone saved meanwhile: read those files again, redo the change once; refused again, tell the owner and stop.

## Verification

- The owner declined the Playwright Chromium download, so the converter's render check and grading never ran. On the first sync every card was loaded in the app's built-in browser: all 72 load the bundle with no errors; the 24 written previews render every cell. No grades are recorded.
- 2026-10-18, the route's first run: `npm run design-system` (about 10 minutes) built 233 files, and all 233 matched the artifact byte for byte (artifact version 1792360462-c06f), so there was nothing to send. To test the publish call, `project/styles.css` was sent unchanged (version 1792366063-61fc, "Route test: styles.css unchanged"); every file read back unchanged, and `published.json` was recorded from that read. The index was not sent.

- 2026-10-19: `EffortChart` and `ElevationProfile` joined the kit (74 components, 239 files). Ten files were sent (artifact version 12, 1792451372-ece2); the read-back matched all 239 and `published.json` was recorded. The index was not sent.
- **Checking a card without the artifact page** (the built-in browser isn't signed in to claude.ai): copy `ds-artifact/project/components/<Name>/preview.html` to a `check.html` beside it with `<link rel="stylesheet" href="../../styles.css">`, `../../components/lib/react.js` and `../../components/bundle.js` added to its `<head>` (what the artifact page preloads), and open it through the site's dev server (`npm run site:dev`, port 5174) at `/@fs/<absolute path>`. Not the web server on 5173: its React plugin rewrites `react.js` and the page fails. Delete the `check.html` files after.

## Risks

- Nothing has been machine-graded. If Playwright gets installed, run the converter's render check and grade the 24 written previews.
- `conventions.md` names classes from the `kit.css` safelist, the colour tokens and the `Icons` list: if any of those change, check it against the fresh build.
- Partner theming (D29) relies on the purpose-named tokens; renaming one breaks designs already built with it.
- `build-artifact.mjs` stops when the converter's output stops matching what it reshapes (a README line, the card template, the theme block). Fix the script against the new output rather than editing the artifact by hand.
