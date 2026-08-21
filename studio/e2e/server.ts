/**
 * Start the real Studio server against the canonical browser fixture.
 *
 * The production command normally passes this descriptor. The test launcher
 * recreates that exact boundary so server-side CLI calls never depend on PATH.
 */
import { join, resolve } from 'node:path'

const studioRoot = resolve(import.meta.dir, '..')
const cliRoot = resolve(studioRoot, '..')
const port = process.env.STUDIO_E2E_PORT ?? '4397'
const executable = process.execPath
const cliEntry = join(cliRoot, 'bin', 'astrale.ts')
const serverEntry = join(studioRoot, 'server', 'index.ts')
const fixture = join(import.meta.dir, 'fixture')

const child = Bun.spawn([executable, serverEntry, fixture, '--port', port, '--no-open'], {
  cwd: studioRoot,
  env: {
    ...process.env,
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
