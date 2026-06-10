const p = require('path')
const f = require('fs')

// Guard against developers running `pnpm install` directly inside this submodule
// (which would resolve PUBLISHED packages instead of the workspace ones).
//
// IMPORTANT: this runs as a `preinstall` script, so it ALSO fires for end users
// who `npm i -g @astrale-os/astrale`. It must pass for them. The discriminator
// is the `.astrale-workspace` marker at the monorepo root: we only fail when the
// install originates from *inside* the monorepo but not at its root.
if (process.env.STANDALONE) process.exit(0)

const start = process.env.INIT_CWD || process.cwd()

let dir = start
let workspaceRoot = null
for (;;) {
  if (f.existsSync(p.join(dir, '.astrale-workspace'))) {
    workspaceRoot = dir
    break
  }
  const parent = p.dirname(dir)
  if (parent === dir) break
  dir = parent
}

// Not inside the Astrale monorepo (e.g. an end user): allow.
if (!workspaceRoot) process.exit(0)
// Installing from the workspace root itself: correct.
if (workspaceRoot === start) process.exit(0)

console.error(`
⚠️  WARNING: Running pnpm install directly in this package will use PUBLISHED packages.

   Run from workspace root instead:
   cd <workspace-root> && pnpm install

   To bypass: STANDALONE=true pnpm install
`)
process.exit(1)
