// Copies the font files dist/styles.css refers to (Inter, from @fontsource-variable/inter) next to it, so its
// @font-face urls resolve and the Claude Design sync can pick the fonts up (D53).
import { copyFileSync, mkdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const css = readFileSync("dist/styles.css", "utf8")
const files = [...new Set([...css.matchAll(/url\(\.\/files\/([^)]+\.woff2)\)/g)].map((m) => m[1]))]
const fontsource = dirname(createRequire(import.meta.url).resolve("@fontsource-variable/inter/package.json"))
mkdirSync("dist/files", { recursive: true })
for (const f of files) copyFileSync(join(fontsource, "files", f), join("dist/files", f))
console.log(`copied ${files.length} font files to dist/files`)
