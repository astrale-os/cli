#!/usr/bin/env bun
/**
 * Bundle the CLI into a single self-contained, Node-runnable file at
 * `dist/astrale.js`. This is the artifact published to npm (Windows + any Node
 * user); the Linux/macOS standalone binary is produced separately by
 * `bun build --compile` in CI.
 *
 * Why bundle: the runtime deps `@astrale-os/kernel-client` / `@astrale-os/sdk` live
 * on a PRIVATE registry (GitHub Packages). Inlining them makes the published
 * package self-contained, so `npm i -g @astrale-os/cli` needs no access to
 * any private registry.
 */
import { existsSync } from 'node:fs'
import { chmod, readFile, rm, writeFile } from 'node:fs/promises'

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

// Build the `astrale view` viewer page (package.json `files`: viewer/dist) —
// the static page the view-session server serves. It bundles @astrale-os/shell
// (dev dependency), so the published CLI needs no registry access at runtime.
{
  const viewerDir = new URL('../viewer', import.meta.url).pathname
  const r = await Bun.build({
    entrypoints: [`${viewerDir}/main.ts`],
    outdir: `${viewerDir}/dist`,
    target: 'browser',
    format: 'esm',
    minify: true,
  })
  if (!r.success) {
    for (const message of r.logs) console.error(message)
    console.error('viewer build FAILED')
    process.exit(1)
  }
  await Bun.write(`${viewerDir}/dist/index.html`, Bun.file(`${viewerDir}/index.html`))
  console.log('built viewer/dist')
}

// Also build the Domain Studio client so the prebuilt SPA ships in the package
// (package.json `files`: studio/client/dist) — that's what `astrale studio` serves
// on a published/global install (prod-static). Best-effort: NEVER fail the CLI
// build if the studio or its Vite toolchain is absent (e.g. a slim CI checkout).
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
