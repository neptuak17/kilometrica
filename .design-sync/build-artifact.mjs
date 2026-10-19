// Builds the files of Kilometrica's Design System artifact (D53) from the kit build and the converter's output, in
// the layout the artifact keeps under project/. `npm run design-system` runs the kit build, the converter (into
// ds-bundle/) and then this script, which writes ds-artifact/project/ and ds-artifact/build.json (each file's hash).
// Publishing those files is a separate, Claude-driven step: see .design-sync/NOTES.md.
//
// Inputs besides ds-bundle/: packages/ui/dist/tokens.css (the colours of theme.css and kilometrica.css), and in
// .design-sync/ the README's header (conventions.md) and footer (readme-footer.md) and tokens.json, which holds the
// hand-written usage notes. A note is kept while its token's values are unchanged; this script rewrites tokens.json
// with the new values and drops the notes of changed tokens, so they can be rewritten before publishing.
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const BUNDLE = "ds-bundle"
const OUT = "ds-artifact"
const TOKENS = ".design-sync/tokens.json"

const read = (path) => readFileSync(path, "utf8")
const fail = (message) => {
  console.error(`build-artifact: ${message}`)
  process.exit(1)
}

// Replaces exactly one occurrence, so a change in the converter's output stops the build instead of slipping through.
function replaceOnce(text, from, to, where) {
  const at = text.indexOf(from)
  if (at < 0 || text.indexOf(from, at + 1) >= 0) fail(`expected one ${JSON.stringify(from)} in ${where}`)
  return text.slice(0, at) + to + text.slice(at + from.length)
}

function replaceAll(text, from, to, where) {
  if (!text.includes(from)) fail(`expected ${JSON.stringify(from)} in ${where}`)
  return text.split(from).join(to)
}

const declarations = (body) =>
  body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const colon = d.indexOf(":")
      return [d.slice(0, colon).trim(), d.slice(colon + 1).trim().replace(/\s+/g, " ")]
    })

const files = new Map()
const put = (path, content) => files.set(path, content)

// --- Components: the bundle, its stylesheet, types and one folder per component -------------------------------

const bundleJs = readFileSync(join(BUNDLE, "_ds_bundle.js"))
const header = JSON.parse(/^\/\* @ds-bundle: (.*?) \*\//.exec(bundleJs.toString("utf8"))?.[1] ?? fail("no @ds-bundle header"))
const components = header.components.map(({ name, sourcePath }) => {
  const group = /^components\/([^/]+)\//.exec(sourcePath)?.[1] ?? fail(`no group in ${sourcePath}`)
  return { name, group, dir: join(BUNDLE, "components", group, name) }
})
put("components/bundle.js", bundleJs)
put("components/lib/react.js", readFileSync(join(BUNDLE, "_vendor/react.js")))
put("components/lib/react-dom.js", readFileSync(join(BUNDLE, "_vendor/react-dom.js")))

// bundle.css is the converter's _ds_bundle.css with three changes: the theme variables below move to tokens.css (as
// tokens.json's font families and spacing), the components' dark styles also apply under data-theme="dark" (the
// attribute the artifact's tokens.css switches the colours on), and the font urls point at project/fonts/.
const MOVED = ["--font-sans", "--font-mono", "--spacing"]
let bundleCss = read(join(BUNDLE, "_ds_bundle.css"))
const themeAt = bundleCss.indexOf("@layer theme {\n  :root, :host {\n")
if (themeAt < 0) fail("no Tailwind theme block in _ds_bundle.css")
const theme = Object.fromEntries(
  declarations(bundleCss.slice(bundleCss.indexOf("{", themeAt + 15) + 1, bundleCss.indexOf("}", themeAt))),
)
for (const name of MOVED) {
  const match = new RegExp(`\\n    ${name}:[^;]*;`).exec(bundleCss.slice(themeAt, bundleCss.indexOf("}", themeAt)))
  if (!match) fail(`no ${name} in the theme block of _ds_bundle.css`)
  const at = themeAt + match.index
  bundleCss = bundleCss.slice(0, at) + bundleCss.slice(at + match[0].length)
}
bundleCss = replaceAll(bundleCss, ":is(.dark *)", ':is(.dark *, [data-theme="dark"] *)', "_ds_bundle.css")
bundleCss = replaceAll(bundleCss, "url(./fonts/", "url(../fonts/", "_ds_bundle.css")
put("components/bundle.css", bundleCss)

const IMPORT_REACT = "import * as React from 'react';\n\n"
const types = components.map(({ name, dir }) => {
  const dts = read(join(dir, `${name}.d.ts`))
  if (!dts.startsWith(IMPORT_REACT)) fail(`${name}.d.ts does not start with the React import`)
  put(`components/${name}/${name}.d.ts`, dts)
  return dts.slice(IMPORT_REACT.length)
})
put("components/index.d.ts", IMPORT_REACT + types.join("\n"))

for (const { name, dir } of components) {
  const prompt = read(join(dir, `${name}.prompt.md`))
  put(
    `components/${name}/README.md`,
    replaceOnce(prompt, "(bundle loaded from the root `_ds_bundle.js`)", "(bundle loaded from `components/bundle.js`)", `${name}.prompt.md`),
  )
}

// preview.html: the converter's card made into the artifact's preview contract. The frame preloads the styles,
// React and the bundle, so their tags go; a written preview's script (_preview/<Name>.js) is inlined; colours come
// from the tokens; the card marker gains a height (the card's viewport, else 200 for a written preview and 160
// for the "not yet authored" floor card).
const GRID_STYLE = `<style>
  body{margin:0;padding:24px;background:var(--background);color:var(--foreground);font-family:var(--font-sans)}
  .ds-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;align-items:start}
  .ds-grid.ds-col{grid-template-columns:1fr}
  .ds-cell{border:1px solid var(--border);border-radius:8px;padding:12px;min-width:0;overflow:hidden;transform:translateZ(0)}
  .ds-cell>h4{margin:0 0 8px;font:600 12px var(--font-sans);color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.04em}
  .ds-single{transform:translateZ(0)}
</style>`
const BODY_STYLE =
  "<style>body{margin:0;padding:24px;background:var(--background);color:var(--foreground);font-family:var(--font-sans)}</style>"
// The floor card's text keeps its em dash as a JSON escape, as the artifact has it.
const EM_DASH_ESCAPE = String.fromCharCode(92) + "u2014"

const lastScript = (html) => html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>")).trim()

function preview(name, card, previewJs) {
  const marker = /^<!-- @dsCard group="([^"]*)"(?: viewport="(\d+)x(\d+)")? -->\n/.exec(card)
  if (!marker) fail(`unexpected card marker in ${name}.html`)
  const [, group, width, height] = marker
  const size = width ? `height=${height} width=${width}` : `height=${previewJs != null ? 200 : 160}`
  const head = `<!-- @dsCard group="${group}" ${size} -->\n<!doctype html>\n<html>\n<head><meta charset="utf-8"><title>${name} — preview</title>\n`
  if (previewJs != null) {
    return `${head}${GRID_STYLE}\n</head>\n<body>\n<div class="ds-grid" id="g"></div>\n<script>\n${previewJs.trim()}\n;\n${lastScript(card)}\n</script>\n</body>\n</html>\n`
  }
  const script = lastScript(card)
  const render = /ReactDOM\.createRoot\(r\)\.render\((.*)\);/.exec(script)?.[1] ?? fail(`no render call in ${name}.html`)
  const echo = /if \(t === (".*?") \|\|/.exec(script)?.[1] ?? fail(`no echo check in ${name}.html`)
  const fallback = JSON.stringify(
    `<div data-ds-fallback="" style="border:1px solid var(--border);border-radius:12px;padding:28px 24px;max-width:520px">` +
      `<div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground)">${group}</div>` +
      `<div style="font-size:20px;font-weight:600;margin-top:6px">${name}</div>` +
      `<div style="font-size:12px;color:var(--muted-foreground);margin-top:14px;line-height:1.5">Preview not yet authored. ` +
      `The component is fully importable — its API is in <code>${name}.d.ts</code> and usage in <code>README.md</code>.</div></div>`,
  )
    .split("—")
    .join(EM_DASH_ESCAPE)
  return `${head}${BODY_STYLE}
</head>
<body>
<div id="root"></div>
<script>
  var h=React.createElement, C=window.KilometricaUI.${name};
  var r=document.getElementById('root');
  var FALLBACK=${fallback};
  function dsFallback(){ r.innerHTML=FALLBACK; }
  try {
    ReactDOM.createRoot(r).render(${render});
  } catch (e) { dsFallback(); }
  setTimeout(function(){
    var t=(r.textContent||'').trim();
    if (!r.childElementCount && !t) return dsFallback();
    if (t === ${echo} || r.getBoundingClientRect().height < 2) dsFallback();
  }, 350);
</script>
</body>
</html>
`
}

for (const { name, dir } of components) {
  const card = read(join(dir, `${name}.html`))
  const previewJs = card.includes(`_preview/${name}.js`) ? read(join(BUNDLE, "_preview", `${name}.js`)) : null
  put(`components/${name}/preview.html`, preview(name, card, previewJs))
}

// --- Fonts --------------------------------------------------------------------------------------------------

const fontsCss = read(join(BUNDLE, "fonts/fonts.css"))
put("fonts/fonts.css", fontsCss)
const fonts = [...fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => {
  const d = Object.fromEntries(declarations(body))
  const file = /url\(\.\/([^)]+)\)/.exec(d.src)?.[1] ?? fail(`no font url in ${d.src}`)
  put(`fonts/${file}`, readFileSync(join(BUNDLE, "fonts", file)))
  return { family: d["font-family"].replace(/^['"]|['"]$/g, ""), file: `fonts/${file}`, weight: d["font-weight"], style: d["font-style"] }
})

// --- Tokens -------------------------------------------------------------------------------------------------

// The kit's tokens.css holds the :root (light) and .dark blocks of theme.css and kilometrica.css: colours, and the
// radius. A colour that is var(--other) becomes the alias {other}.
const kitTokens = read("packages/ui/dist/tokens.css")
const light = new Map()
const dark = new Map()
for (const [, selector, body] of kitTokens.matchAll(/(:root|\.dark)\s*\{([^}]*)\}/g)) {
  for (const [property, value] of declarations(body)) (selector === ":root" ? light : dark).set(property.slice(2), value)
}
if (!dark.size) fail("no .dark block in packages/ui/dist/tokens.css")
const COLOUR = /^(#|oklch\(|oklab\(|rgba?\(|hsla?\(|lab\(|lch\(|color\(|var\(--)/
const alias = (value) => value.replace(/^var\(--([A-Za-z0-9_-]+)\)$/, "{$1}")

const base = JSON.parse(read(TOKENS))
const report = { changed: [], added: [], removed: [] }

// A token keeps its note only while its value is the one the note was written for.
function noted(name, value, oldTokens) {
  const old = oldTokens.find((t) => t.name === name)
  const token = { name, value }
  if (!old) report.added.push(name)
  else if (JSON.stringify(old.value) !== JSON.stringify(value)) report.changed.push(name)
  else if (old.usage != null) token.usage = old.usage
  return token
}

const colourTokens = []
const radiusTokens = []
for (const [name, value] of light) {
  if (/radius/.test(name)) radiusTokens.push(noted(name, value, base.radius.tokens))
  else if (COLOUR.test(value)) {
    const values = { light: alias(value) }
    if (dark.has(name)) values.dark = alias(dark.get(name))
    colourTokens.push(noted(name, values, base.color.tokens))
  } else fail(`--${name}: ${value} is neither a colour nor a radius`)
}
for (const name of dark.keys()) if (!light.has(name)) fail(`--${name} has a dark value but no light one`)
const spacingTokens = ["spacing"].map((name) => noted(name, theme[`--${name}`], base.spacing.tokens))
for (const [family, tokens] of [
  [base.color.tokens, colourTokens],
  [base.radius.tokens, radiusTokens],
  [base.spacing.tokens, spacingTokens],
]) {
  for (const { name } of family) if (!tokens.some((t) => t.name === name)) report.removed.push(name)
}

// Text styles: Tailwind's --text-<step> sizes, with the line height (calc(<rem> / <size>)) written in rem.
function lineHeight(fontSize, value) {
  const calc = /^calc\(([\d.]+) \/ ([\d.]+)\)$/.exec(value)
  if (calc && Number(calc[2]) === parseFloat(fontSize)) return `${calc[1]}rem`
  const ratio = calc ? Number(calc[1]) / Number(calc[2]) : Number(value)
  if (!Number.isFinite(ratio)) fail(`cannot read the line height ${value}`)
  return `${Number((ratio * parseFloat(fontSize)).toFixed(4))}rem`
}
const groups = base.type.groups.map((group) => ({
  ...group,
  styles: group.styles.map((style) => {
    const step = style.name.replace(/^type-/, "")
    const fontSize = theme[`--text-${step}`] ?? fail(`no --text-${step} in _ds_bundle.css`)
    return { ...style, fontSize, lineHeight: lineHeight(fontSize, theme[`--text-${step}--line-height`]) }
  }),
}))
const families = Object.fromEntries(
  MOVED.filter((name) => name.startsWith("--font-")).map((name) => [name.slice(7), theme[name] ?? fail(`no ${name}`)]),
)

const tokens = {
  ...base,
  color: { ...base.color, tokens: colourTokens },
  type: { ...base.type, fonts, families, groups },
  spacing: { ...base.spacing, tokens: spacingTokens },
  radius: { ...base.radius, tokens: radiusTokens },
}
const tokensJson = JSON.stringify(tokens, null, 2) + "\n"
put("tokens.json", tokensJson)

// tokens.css, compiled from tokens.json the way the Design System page compiles it: every colour under light, the
// dark values that differ under [data-theme="dark"], then lengths, font families, a class per text style and the fonts.
const css = (value) => value.replace(/^\{(.+)\}$/, "var(--$1)")
const lines = [`/* ${tokens.name} — generated from tokens.json */`, `:root, [data-theme="${tokens.color.themes[0].id}"] {`]
for (const { name, value } of tokens.color.tokens) lines.push(`  --${name}: ${css(value.light)};`)
lines.push("}")
for (const { id } of tokens.color.themes.slice(1)) {
  lines.push(`[data-theme="${id}"] {`)
  for (const { name, value } of tokens.color.tokens) {
    if (value[id] != null && (value[id] !== value.light || value[id].startsWith("{"))) lines.push(`  --${name}: ${css(value[id])};`)
  }
  lines.push("}")
}
lines.push(":root {")
for (const { name, value } of [...tokens.spacing.tokens, ...tokens.radius.tokens]) lines.push(`  --${name}: ${value};`)
for (const [key, stack] of Object.entries(tokens.type.families)) lines.push(`  --font-${key}: ${stack};`)
lines.push("}")
for (const group of tokens.type.groups) {
  for (const style of group.styles) {
    lines.push(
      `.${style.name} { font-family: var(--font-${style.family ?? group.family}); font-size: ${style.fontSize}; line-height: ${style.lineHeight}; font-weight: ${style.fontWeight}; }`,
    )
  }
}
for (const font of tokens.type.fonts) {
  const format = font.file.split(".").pop()
  lines.push(
    `@font-face { font-family: "${font.family}"; src: url("${font.file}") format("${format}"); font-weight: ${font.weight}; font-style: ${font.style}; font-display: swap; }`,
  )
}
put("tokens.css", lines.join("\n") + "\n")

put("styles.css", '@import "./tokens.css";\n@import "./fonts/fonts.css";\n@import "./components/bundle.css";\n')

// --- README: conventions.md, the converter's generated part with the artifact's paths, then readme-footer.md --------

const conventions = read(".design-sync/conventions.md").trimEnd()
const converterReadme = read(join(BUNDLE, "README.md"))
if (!converterReadme.startsWith(conventions + "\n\n")) fail("ds-bundle/README.md does not start with conventions.md: re-run the converter")
let generated = converterReadme.slice(conventions.length + 2)
for (const [from, to] of [
  ["- `_ds_bundle.js` — the whole-DS bundle at the project root; loads", "- `components/bundle.js` — the whole-DS bundle; loads"],
  ["component styles (`_ds_bundle.css`)", "component styles (`components/bundle.css`)"],
  [
    "- `components/<group>/<Name>/<Name>.prompt.md` (example JSX + variants), `<Name>.d.ts` (types), `<Name>.html` (variant grid).",
    "- `components/<Name>/README.md` (example JSX + variants), `<Name>.d.ts` (types), `preview.html` (variant grid).",
  ],
  ["- `tokens/*.css` — CSS custom properties", "- `tokens.css` — CSS custom properties"],
  ['read_file("components/<group>/<Name>/<Name>.prompt.md")', 'read_file("components/<Name>/README.md")'],
  ['<script src="_ds_bundle.js"></script>', '<script src="components/bundle.js"></script>'],
  ["See `tokens/` for the full list.", "See `tokens.json` for the full list."],
]) {
  generated = replaceOnce(generated, from, to, "ds-bundle/README.md")
}
const reactVersion = JSON.parse(read("node_modules/react/package.json")).version
const footer = replaceAll(read(".design-sync/readme-footer.md"), "{{reactVersion}}", reactVersion, "readme-footer.md")
put("README.md", `${conventions}\n\n${generated}\n${footer}`)

// --- Write ----------------------------------------------------------------------------------------------------

rmSync(OUT, { recursive: true, force: true })
const hashes = {}
for (const [path, content] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const target = join(OUT, "project", path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
  hashes[`project/${path}`] = createHash("sha256").update(content).digest("hex")
}
let commit = "unknown"
try {
  commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim()
} catch {}
const libraries = [
  { name: "react", version: reactVersion, global: "React", file: "components/lib/react.js" },
  { name: "react-dom", version: reactVersion, global: "ReactDOM", file: "components/lib/react-dom.js" },
]
writeFileSync(join(OUT, "build.json"), JSON.stringify({ commit, libraries, tokens: report, files: hashes }, null, 2) + "\n")
writeFileSync(TOKENS, tokensJson)

const unnoted = tokens.color.tokens.filter((t) => t.usage == null).map((t) => t.name)
console.log(`wrote ${files.size} files to ${OUT}/project (${components.length} components, React ${reactVersion})`)
if (report.changed.length) console.log(`tokens with new values (their notes were dropped): ${report.changed.join(", ")}`)
if (report.added.length) console.log(`new tokens: ${report.added.join(", ")}`)
if (report.removed.length) console.log(`tokens no longer in the CSS (left out): ${report.removed.join(", ")}`)
if (unnoted.length) console.log(`colours without a usage note, to write in ${TOKENS} before publishing: ${unnoted.join(", ")}`)
