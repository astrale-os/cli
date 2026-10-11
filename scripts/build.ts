#!/usr/bin/env bun
/**
 * Bundle the CLI into a Node-runnable development artifact at
 * `dist/astrale.js`. Releases use only the Bun 1.4 standalone executable built
 * by `bun build --compile` in CI.
 *
 * Why bundle: the CLI is distributed as one self-contained executable. Its
 * SDK and Shell implementation dependencies remain build-time inputs, so a
 * global install does not expose their package graph at runtime.
 */
import { chmod, readFile, rm, writeFile } from 'node:fs/promises'

import { buildEmbeddedAssets } from './build-embedded-assets'

const preferJsoncParserEsm: Bun.BunPlugin = {
  name: 'prefer-jsonc-parser-esm',
  target: 'node',
  setup(build) {
    build.onResolve({ filter: /^jsonc-parser$/ }, (args) => {
      const resolved = Bun.resolveSync(args.path, args.resolveDir)
      return { path: resolved.replace('/lib/umd/main.js', '/lib/esm/main.js') }
    })
  },
}

const OUT = 'dist/astrale.js'
const NODE_SHEBANG = '#!/usr/bin/env node\n'

await rm('dist', { recursive: true, force: true })

// The executable imports the local generated archive. Ensure its exact inputs
// are current before bundling; cache hits avoid rebuilding Studio and Viewer.
await buildEmbeddedAssets()

const result = await Bun.build({
  entrypoints: ['bin/astrale.ts'],
  outdir: 'dist',
  target: 'node',
  format: 'esm',
  define: { __ASTRALE_BUNDLED__: 'true' },
  plugins: [preferJsoncParserEsm],
  // Bundle everything (no externals) so the artifact carries its own deps.
})

if (!result.success) {
  for (const message of result.logs) console.error(message)
  process.exit(1)
}

// Replace the source `#!/usr/bin/env bun` shebang with a Node one (or add it).
const code = await readFile(OUT, 'utf8')
const withShebang = code.startsWith('#!')
  ? code.replace(/^#![^\n]*\n/, NODE_SHEBANG)
  : NODE_SHEBANG + code
await writeFile(OUT, withShebang)
await chmod(OUT, 0o755)

console.log(`built ${OUT}`)
