/**
 * Start the real Studio server against the canonical browser fixture.
 *
 * The production command normally passes this descriptor. The test launcher
 * recreates that exact boundary so server-side CLI calls never depend on PATH.
 */
import { join } from 'node:path'

import { e2eDist, e2ePort as port, studioRoot } from './dist'

const executable = process.execPath
// The real CLI, but for the registry reads of the origins a spec serves (see `registry.ts`).
const cliEntry = join(import.meta.dir, 'registry-cli.ts')
const serverEntry = join(studioRoot, 'server', 'index.ts')
const fixture = join(import.meta.dir, 'fixture')
const astraleHome = join(studioRoot, 'test-results', 'astrale-home')

const child = Bun.spawn([executable, serverEntry, fixture, '--port', port, '--no-open'], {
  cwd: studioRoot,
  env: {
    ...process.env,
    // Machine-global Studio state must never make an E2E run read or write the user's home.
    ASTRALE_HOME: astraleHome,
    // A browser test must never reach a real Publish: the server refuses every one.
    ASTRALE_STUDIO_PUBLISH: 'off',
    // The build this run made for itself (see `e2e/build.ts`), never the shared `client/dist`.
    DOMAIN_STUDIO_DIST: e2eDist,
    // The model picker probes every agent, which would download Studio's pinned
    // builds (~200 MB) into that fresh home on every run. Browser tests drive no
    // real agent, so they keep whatever the PATH has, as before the pin.
    DOMAIN_STUDIO_CLAUDE_BIN: process.env.DOMAIN_STUDIO_CLAUDE_BIN ?? 'claude',
    DOMAIN_STUDIO_CODEX_BIN: process.env.DOMAIN_STUDIO_CODEX_BIN ?? 'codex',
    DOMAIN_STUDIO_CLI_DESCRIPTOR: JSON.stringify({
      version: 1,
      executable,
      args: [cliEntry],
    }),
  },
  stdin: 'ignore',
  stdout: 'inherit',
  stderr: 'inherit',
})

const stop = (): void => child.kill('SIGTERM')
process.once('SIGINT', stop)
process.once('SIGTERM', stop)

process.exit(await child.exited)
