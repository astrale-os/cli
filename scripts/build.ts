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
import { existsSync } from 'node:fs'
import { chmod, readFile, rm, writeFile } from 'node:fs/promises'

import { buildViewer } from './build-viewer'

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

const result = await Bun.build({
  entrypoints: ['bin/astrale.ts'],
  outdir: 'dist',
  target: 'node',
  format: 'esm',
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

// Public programmatic subpaths must be Node-loadable from an installed
// package. Ship bundled JavaScript instead of exposing TypeScript source under
// node_modules (which Node deliberately refuses to type-strip).
{
  const r = await Bun.build({
    entrypoints: ['src/connect-core.ts', 'src/keys/index.ts', 'src/paths/index.ts'],
    outdir: 'dist/public',
    root: 'src',
    target: 'node',
    format: 'esm',
    plugins: [preferJsoncParserEsm],
  })
  if (!r.success) {
    for (const message of r.logs) console.error(message)
    console.error('public subpath build FAILED')
    process.exit(1)
  }

  const tsgo = ['node_modules/.bin/tsgo', '../../node_modules/.bin/tsgo'].find(existsSync)
  if (!tsgo) {
    console.error('tsgo is required to emit public subpath declarations')
    process.exit(1)
  }
  const declarations = Bun.spawnSync([tsgo, '-p', 'tsconfig.public.json'], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (declarations.exitCode !== 0) {
    console.error('public subpath declaration build FAILED')
    process.exit(1)
  }
  console.log('built public subpaths')
}

// Build the `astrale view` viewer page used by the embedded-asset generator.
await buildViewer()

// Also build the Domain Studio client for the embedded-asset generator.
const studioDir = new URL('../studio', import.meta.url).pathname
if (existsSync(`${studioDir}/vite.config.ts`)) {
  const viteBin = [
    `${studioDir}/node_modules/.bin/vite`,
    `${studioDir}/../../node_modules/.bin/vite`,
  ].find(existsSync)
  if (!viteBin) {
    console.warn(
      'studio present but Vite not installed — skipping studio client build (run `pnpm install`)',
    )
  } else {
    console.log('building studio client (vite build)…')
    const r = Bun.spawnSync([viteBin, 'build'], {
      cwd: studioDir,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    if (r.exitCode === 0) {
      console.log('built studio/client/dist')
    } else {
      // We HAD the toolchain and tried — a failure here would otherwise ship an
      // empty/stale studio inside the package. Fail loudly (this also fails the
      // prepack during `npm/pnpm pack`, so a broken studio never gets published).
      console.error('studio client build FAILED')
      process.exit(1)
    }
  }
}
