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
import { existsSync } from 'node:fs'
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
    console.log(
      r.exitCode === 0
        ? 'built studio/client/dist'
        : 'studio client build FAILED — `astrale studio` will need a manual build',
    )
  }
}
