// Moves the colour tokens (the `:root` and `.dark` blocks of theme.css and kilometrica.css) out of dist/styles.css
// into dist/tokens.css, which the Claude Design sync ships as its tokens file (D53). Claude Design stops reading
// the compiled stylesheet partway through Tailwind's utilities, so tokens left at the end of it never reach its
// token panel. Both blocks stay unlayered, so moving them changes nothing in the cascade.
import { readFileSync, writeFileSync } from "node:fs"

const css = readFileSync("dist/styles.css", "utf8")

// Top-level rules only: walk the braces, ignoring comments.
const rules = []
let depth = 0
let start = 0
for (let i = 0; i < css.length; i++) {
  if (css.startsWith("/*", i)) {
    i = css.indexOf("*/", i + 2) + 1
    if (depth === 0) start = i + 1
  } else if (css[i] === "{") {
    depth++
  } else if (css[i] === "}") {
    if (--depth === 0) {
      rules.push({ start, end: i + 1 })
      start = i + 1
    }
  } else if (css[i] === ";" && depth === 0) {
    start = i + 1
  }
}

const isTokenBlock = ({ start, end }) => {
  const text = css.slice(start, end)
  const open = text.indexOf("{")
  const selector = text.slice(0, open).trim()
  const body = text.slice(open + 1, -1)
  const decls = body.split(";").map((d) => d.trim()).filter(Boolean)
  return (selector === ":root" || selector === ".dark") && !body.includes("{") && decls.every((d) => d.startsWith("--"))
}

const blocks = rules.filter(isTokenBlock)
if (!blocks.some((b) => css.slice(b.start, b.end).trim().startsWith(".dark"))) {
  throw new Error("split-tokens: no :root and .dark colour blocks in dist/styles.css. Did `shadcn apply` change theme.css?")
}

// Light (`:root`) first, then dark; each `.dark` still follows the `:root` it overrides.
const text = blocks.map((b) => css.slice(b.start, b.end).trim())
const tokens = [...text.filter((t) => t.startsWith(":root")), ...text.filter((t) => t.startsWith(".dark"))].join("\n")
let rest = css
for (const b of [...blocks].reverse()) rest = rest.slice(0, b.start) + rest.slice(b.end)

writeFileSync(
  "dist/tokens.css",
  "/* Kilometrica's colour tokens (D53): the preset's and kilometrica.css, light (:root) then dark (.dark). Load before styles.css. */\n" +
    tokens +
    "\n",
)
writeFileSync("dist/styles.css", rest)
console.log(`moved ${blocks.length} token blocks to dist/tokens.css`)
