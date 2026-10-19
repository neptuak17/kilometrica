// Compares the artifact files built by build-artifact.mjs (ds-artifact/) with the artifact as read back by the
// Artifact tool into a folder (it saves each file at <folder>/project/<path>), using .design-sync/published.json,
// the hash of every file at the last publish, to tell page edits from our own changes (D53). See NOTES.md.
//
//   node .design-sync/artifact-diff.mjs <folder>           what to send; writes ds-artifact/send.json
//   node .design-sync/artifact-diff.mjs <folder> --record  after publishing: checks every file matches, then
//                                                          rewrites published.json
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const PUBLISHED = ".design-sync/published.json"
const [folder, flag] = process.argv.slice(2)
if (!folder) {
  console.error("usage: node .design-sync/artifact-diff.mjs <folder read from the artifact> [--record]")
  process.exit(1)
}

const build = JSON.parse(readFileSync("ds-artifact/build.json", "utf8")).files
const published = existsSync(PUBLISHED) ? JSON.parse(readFileSync(PUBLISHED, "utf8")).files : {}
const hash = (path) => (existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null)

const same = []
const send = []
const edited = []
const unrecorded = []
for (const [path, built] of Object.entries(build)) {
  const live = hash(join(folder, path))
  if (live === built) same.push(path)
  else if (live == null) send.push(path)
  else if (published[path] == null) unrecorded.push(path)
  else if (published[path] !== live) edited.push(path)
  else send.push(path)
}
const gone = Object.keys(published).filter((path) => !(path in build))

if (flag === "--record") {
  if (same.length !== Object.keys(build).length) {
    console.error(`not recorded: ${Object.keys(build).length - same.length} files still differ from the build`)
    process.exit(1)
  }
  writeFileSync(PUBLISHED, JSON.stringify({ files: build }, null, 2) + "\n")
  console.log(`recorded ${same.length} files in ${PUBLISHED}`)
  process.exit(0)
}

const list = (title, paths) => paths.length && console.log(`${title} (${paths.length}):\n${paths.map((p) => `  ${p}`).join("\n")}`)
console.log(`${same.length} of ${Object.keys(build).length} files already match the artifact`)
list("to send: new or changed in the build", send)
list("EDITED ON THE PAGE since the last publish: bring the edit into the repo or replace it, then rebuild", edited)
list("differ from the build with no record of a publish: look before replacing", unrecorded)
list("published before but no longer built: remove only with the owner's OK", gone)
writeFileSync("ds-artifact/send.json", JSON.stringify(Object.fromEntries(send.map((p) => [p, p])), null, 2) + "\n")
process.exit(edited.length || unrecorded.length ? 2 : 0)
