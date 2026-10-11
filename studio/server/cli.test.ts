import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  runStudioCliJson,
  runStudioCliText,
  STUDIO_CLI_DESCRIPTOR_ENV,
  studioCliCommand,
} from './cli'
import { asJsonRecord } from './json'

const priorDescriptor = process.env[STUDIO_CLI_DESCRIPTOR_ENV]
const roots: string[] = []

afterEach(() => {
  if (priorDescriptor === undefined) delete process.env[STUDIO_CLI_DESCRIPTOR_ENV]
  else process.env[STUDIO_CLI_DESCRIPTOR_ENV] = priorDescriptor
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Launch Studio's CLI as `source(root)`, a script in a fresh directory. */
function installCli(source: (root: string) => string): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-cli-'))
  roots.push(root)
  const entry = join(root, 'cli.ts')
  writeFileSync(entry, source(root))
  process.env[STUDIO_CLI_DESCRIPTOR_ENV] = JSON.stringify({
    version: 1,
    executable: process.execPath,
    args: [entry],
  })
  return root
}

function processIds(root: string): number[] {
  const file = join(root, 'pids.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as number[]) : []
}

async function expectStopped(pid: number): Promise<void> {
  const deadline = Date.now() + 1_000
  for (;;) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
      throw error
    }
    if (Date.now() >= deadline) throw new Error(`Owned CLI process ${pid} survived its timeout`)
    await Bun.sleep(10)
  }
}

/** Settle `pending` within 1.5 s, then kill whatever the fixture left behind. */
async function settle<T>(root: string, pending: Promise<T>, check: (result?: T) => Promise<void>) {
  try {
    await check(await Promise.race([pending, Bun.sleep(1_500).then(() => undefined)]))
  } finally {
    // a failed assertion must not leave the deliberately uncooperative fixture alive
    for (const pid of processIds(root))
      try {
        process.kill(pid, 'SIGKILL')
      } catch {}
    await pending
  }
}

test('without this CLI’s exact descriptor, Studio refuses rather than using PATH', () => {
  delete process.env[STUDIO_CLI_DESCRIPTOR_ENV]
  expect(() => studioCliCommand(['instance', 'active'])).toThrow(
    'launch Studio through this Astrale CLI',
  )
  const future = JSON.stringify({ version: 2, executable: '/usr/bin/astrale', args: [] })
  expect(() => studioCliCommand(['instance', 'active'], future)).toThrow(
    'launch Studio through this Astrale CLI',
  )
})

test('json mode is appended, and a structured CLI error is decoded but never a success', async () => {
  installCli(
    () => `const args = process.argv.slice(2)
if (args[0] === 'fail') {
  process.stderr.write(JSON.stringify({ error: 'NOT_FOUND', message: 'Missing instance.' }))
  process.exit(7)
}
process.stdout.write(JSON.stringify({ command: args }))
`,
  )
  expect(await runStudioCliJson(['query', '--class', 'Issue'], asJsonRecord)).toMatchObject({
    ok: true,
    exitCode: 0,
    timedOut: false,
    data: { command: ['query', '--class', 'Issue', '--json'] },
  })
  expect(await runStudioCliJson(['fail'], asJsonRecord)).toMatchObject({
    ok: false,
    exitCode: 7,
    detail: 'Missing instance.',
    data: { error: 'NOT_FOUND', message: 'Missing instance.' },
  })
})

test('a CLI ignoring SIGTERM is reaped at its deadline with its children and partial output', async () => {
  const root = installCli(
    (root) => `
    import { spawn } from 'node:child_process'
    import { writeFileSync } from 'node:fs'
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'inherit' })
    writeFileSync(${JSON.stringify(join(root, 'pids.json'))}, JSON.stringify([process.pid, child.pid]))
    process.on('SIGTERM', () => {})
    process.stdout.write('started\\n')
    process.stderr.write('diagnostic\\n')
    setInterval(() => {}, 1_000)
  `,
  )
  await settle(root, runStudioCliText(['--version'], { timeoutMs: 400 }), async (result) => {
    // an attached child holding the output pipes cannot keep the call open
    expect(result).toMatchObject({
      ok: false,
      timedOut: true,
      detail: 'Astrale CLI timed out after 400ms',
      stdout: 'started\n',
      stderr: 'diagnostic\n',
    })
    expect(processIds(root)).toHaveLength(2)
    for (const pid of processIds(root)) await expectStopped(pid)
  })
})

test('the capture leader reaps an attached HTTP child even after the original CLI exits', async () => {
  const root = installCli((root) => {
    const child = `
      import { writeFileSync } from 'node:fs'
      import { createServer } from 'node:http'
      const server = createServer((_req, res) => res.end('alive'))
      server.listen(0, '127.0.0.1', () => writeFileSync(${JSON.stringify(join(root, 'port'))}, String(server.address().port)))
      process.on('SIGTERM', () => {})
    `
    return `
      import { spawn } from 'node:child_process'
      import { writeFileSync } from 'node:fs'
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'inherit' })
      writeFileSync(${JSON.stringify(join(root, 'pids.json'))}, JSON.stringify([process.pid, child.pid]))
      process.stdout.write('parent done\\n')
      setTimeout(() => process.exit(0), 50)
    `
  })
  const pending = runStudioCliText(['--version'], { timeoutMs: 750 })
  for (let i = 0; i < 50 && !existsSync(join(root, 'port')); i++) await Bun.sleep(10)
  const port = readFileSync(join(root, 'port'), 'utf8')
  expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe('alive')
  await expectStopped(processIds(root)[0]!)
  await settle(root, pending, async (result) => {
    expect(result).toMatchObject({ ok: false, timedOut: true, stdout: 'parent done\n' })
    for (const pid of processIds(root)) await expectStopped(pid)
    await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow()
  })
})

test('the delegated CLI gets verbatim arguments and its own environment, not the leader’s descriptor', async () => {
  const root = installCli(
    () => `
    import { writeSync } from 'node:fs'
    let status = 'unavailable'
    try { writeSync(3, '99\\n'); status = 'inherited' } catch {}
    console.log(JSON.stringify({ args: process.argv.slice(2), env: process.env.ASTRALE_PROBE_TEST, status }))
  `,
  )
  const before = process.env.ASTRALE_PROBE_TEST
  const args = ['quoted \' "', '`touch marker`', '$(touch marker)', '$HOME', 'line\nnext', root]
  const result = await runStudioCliJson(args, asJsonRecord, {
    cwd: root,
    timeoutMs: 1_000,
    env: { ASTRALE_PROBE_TEST: 'child-only' },
  })
  expect(result).toMatchObject({
    ok: true,
    data: { args: [...args, '--json'], env: 'child-only', status: 'unavailable' },
  })
  expect(existsSync(join(root, 'marker'))).toBe(false)
  expect(process.env.ASTRALE_PROBE_TEST).toBe(before)
})
