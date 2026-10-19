// Writes the artifact's index, project/design-system.json, for the last call of a publish (D53), when the build's
// React libraries differ from the index's: the copy just read back from the artifact, with its libraries and
// lastChange set. Every other key is kept as the page left it. See NOTES.md.
//
//   node .design-sync/artifact-index.mjs <design-system.json as read> "<one-line note>"
import { readFileSync, writeFileSync } from "node:fs"

const [indexPath, note] = process.argv.slice(2)
if (!indexPath || !note) {
  console.error('usage: node .design-sync/artifact-index.mjs <design-system.json as read> "<one-line note>"')
  process.exit(1)
}

const artifact = JSON.parse(readFileSync(".design-sync/artifact.json", "utf8"))
const { commit, libraries } = JSON.parse(readFileSync("ds-artifact/build.json", "utf8"))
const index = JSON.parse(readFileSync(indexPath, "utf8"))
if (!index.createdOnFiles && !index.convertedFrom) {
  console.error(`${indexPath} has no createdOnFiles or convertedFrom marker: not a Design System index`)
  process.exit(1)
}

// The Artifact tool sends the index only when one of its own keys changes (title, libraries, an asset record): a
// publish of other files leaves it, and its lastChange, as the page has them.
if (JSON.stringify(index.libraries) === JSON.stringify(libraries)) {
  console.log("the index's libraries already match the build: don't send the index")
  process.exit(0)
}
index.libraries = libraries
index.lastChange = {
  by: artifact.by,
  at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  via: `${artifact.repo}@${commit}`,
  note,
}
writeFileSync("ds-artifact/project/design-system.json", JSON.stringify(index, null, 2) + "\n")
console.log(`wrote ds-artifact/project/design-system.json (via ${index.lastChange.via})`)
