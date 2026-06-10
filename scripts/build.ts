#!/usr/bin/env bun
/**
 * Bundle the CLI into a single self-contained, Node-runnable file at
 * `dist/astrale.js`. This is the artifact published to npm (Windows + any Node
 * user); the Linux/macOS standalone binary is produced separately by
 * `bun build --compile` in CI.
 *
 * Why bundle: the runtime deps `@astrale-os/kernel-client` / `kernel-core` live
 * on a PRIVATE registry (GitHub Packages). Inlining them makes the published
 * package self-contained, so `npm i -g @astrale-os/astrale` needs no access to
 * any private registry.
 */
import { chmod, readFile, rm, writeFile } from 'node:fs/promises'

const OUT = 'dist/astrale.js'
const NODE_SHEBANG = '#!/usr/bin/env node\n'

await rm('dist', { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: ['bin/astrale.ts'],
  outdir: 'dist',
  target: 'node',
  format: 'esm',
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
