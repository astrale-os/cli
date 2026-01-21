const p = require('path')
const f = require('fs')
if (f.existsSync(p.join(process.env.INIT_CWD, '.astrale-workspace'))) process.exit(0)
if (process.env.STANDALONE) process.exit(0)
console.error(`
⚠️  WARNING: Running pnpm install directly in this package will use PUBLISHED packages.

   Run from workspace root instead:
   cd <workspace-root> && pnpm install

   To bypass: STANDALONE=true pnpm install
`)
process.exit(1)
