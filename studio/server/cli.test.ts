import { afterEach, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  decodeJsonObject,
  runStudioCliJson,
  runStudioCliText,
  STUDIO_CLI_DESCRIPTOR_ENV,
  studioCliCommand,
} from './cli'

const priorDescriptor = process.env[STUDIO_CLI_DESCRIPTOR_ENV]
const roots: string[] = []

afterEach(() => {
  if (priorDescriptor === undefined) delete process.env[STUDIO_CLI_DESCRIPTOR_ENV]
  else process.env[STUDIO_CLI_DESCRIPTOR_ENV] = priorDescriptor
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('exact command rejects missing and incompatible descriptors instead of using PATH', () => {
  delete process.env[STUDIO_CLI_DESCRIPTOR_ENV]
  expect(() => studioCliCommand(['instance', 'active'])).toThrow(
    'launch Studio through this Astrale CLI',
  )
  expect(() =>
    studioCliCommand(
      ['instance', 'active'],
      JSON.stringify({ version: 2, executable: '/usr/bin/astrale', args: [] }),
    ),
  ).toThrow('launch Studio through this Astrale CLI')
})

test('machine runner uses the exact descriptor, appends json mode, and versions decoded output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-cli-runner-'))
  roots.push(root)
  mkdirSync(root, { recursive: true })
  const entry = join(root, 'fake-cli.ts')
  writeFileSync(entry, `process.stdout.write(JSON.stringify({ command: process.argv.slice(2) }))\n`)
  process.env[STUDIO_CLI_DESCRIPTOR_ENV] = JSON.stringify({
    version: 1,
    executable: process.execPath,
    args: [realpathSync(entry)],
  })

  const result = await runStudioCliJson(
    ['query', '--class', '/:example.dev:class.Issue'],
    decodeJsonObject,
  )

  expect(result).toMatchObject({
    version: 1,
    ok: true,
    exitCode: 0,
    timedOut: false,
    data: {
      command: ['query', '--class', '/:example.dev:class.Issue', '--json'],
    },
  })
})

test('machine runner decodes structured CLI errors without treating them as success', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-cli-error-'))
  roots.push(root)
  const entry = join(root, 'fake-cli.ts')
  writeFileSync(
    entry,
    `process.stderr.write(JSON.stringify({ error: 'NOT_FOUND', message: 'Missing instance.' }))
process.exit(7)
`,
  )
  process.env[STUDIO_CLI_DESCRIPTOR_ENV] = JSON.stringify({
    version: 1,
    executable: process.execPath,
    args: [realpathSync(entry)],
  })

  const result = await runStudioCliJson(['instance', 'active'], decodeJsonObject)

  expect(result).toMatchObject({
    version: 1,
    ok: false,
    exitCode: 7,
    detail: 'Missing instance.',
    data: { error: 'NOT_FOUND', message: 'Missing instance.' },
  })
})

function installCli(source: (root: string) => string): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-cli-deadline-'))
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
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('a CLI ignoring SIGTERM is reaped at its deadline with partial output preserved', async () => {
  const root = installCli(
    (root) => `
    import { writeFileSync } from 'node:fs'
    process.on('SIGTERM', () => {})
    writeFileSync(${JSON.stringify(join(root, 'pids.json'))}, JSON.stringify([process.pid]))
    process.stdout.write('started\\n')
    process.stderr.write('diagnostic\\n')
    setInterval(() => {}, 1_000)
  `,
  )
  const pending = runStudioCliText(['--version'], { timeoutMs: 300 })
  const started = Date.now()
  const result = await Promise.race([
    pending,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1_500)),
  ])
  try {
    expect(result).toBeDefined()
    expect(result).toMatchObject({
      ok: false,
      timedOut: true,
      stdout: 'started\n',
      stderr: 'diagnostic\n',
    })
    expect(result?.detail).toBe('Astrale CLI timed out after 300ms')
    expect(Date.now() - started).toBeLessThan(1_500)
    expect(processIds(root)).toHaveLength(1)
    for (const pid of processIds(root)) await expectStopped(pid)
  } finally {
    // Baseline failures must not leave the deliberately uncooperative fixture alive.
    for (const pid of processIds(root)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {}
    }
    await pending
  }
})

test('a timed-out CLI cannot leave an attached child holding its output pipes', async () => {
  const root = installCli(
    (root) => `
    import { spawn } from 'node:child_process'
    import { writeFileSync } from 'node:fs'
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'inherit' })
    writeFileSync(${JSON.stringify(join(root, 'pids.json'))}, JSON.stringify([process.pid, child.pid]))
    process.on('SIGTERM', () => {})
    setInterval(() => {}, 1_000)
  `,
  )
  const pending = runStudioCliText(['--version'], { timeoutMs: 400 })
  try {
    const result = await Promise.race([
      pending,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1_500)),
    ])
    expect(result).toMatchObject({ ok: false, timedOut: true })
    expect(processIds(root)).toHaveLength(2)
    for (const pid of processIds(root)) await expectStopped(pid)
  } finally {
    for (const pid of processIds(root)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {}
    }
    await pending
  }
})

test('child environment overrides are confined to the exact delegated CLI', async () => {
  installCli(() => `process.stdout.write(process.env.ASTRALE_PROBE_TEST ?? 'missing')`)
  const before = process.env.ASTRALE_PROBE_TEST
  const result = await runStudioCliText(['--version'], {
    timeoutMs: 1_000,
    env: { ASTRALE_PROBE_TEST: 'child-only' },
  })
  expect(result).toMatchObject({ ok: true, stdout: 'child-only', timedOut: false })
  expect(process.env.ASTRALE_PROBE_TEST).toBe(before)
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
  try {
    const deadline = Date.now() + 500
    while (!existsSync(join(root, 'port')) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const port = readFileSync(join(root, 'port'), 'utf8')
    expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe('alive')
    await expectStopped(processIds(root)[0]!)
    const result = await Promise.race([
      pending,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1_500)),
    ])
    expect(result).toMatchObject({ ok: false, timedOut: true, stdout: 'parent done\n' })
    for (const pid of processIds(root)) await expectStopped(pid)
    await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow()
  } finally {
    for (const pid of processIds(root)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {}
    }
    await pending
  }
})

test('the delegated CLI cannot access the capture leader private status descriptor', async () => {
  installCli(
    () => `
    import { writeSync } from 'node:fs'
    try { writeSync(3, '99\\n'); console.log('inherited') }
    catch { console.log('unavailable') }
  `,
  )
  expect(await runStudioCliText(['--version'], { timeoutMs: 1_000 })).toMatchObject({
    ok: true,
    exitCode: 0,
    stdout: 'unavailable\n',
    timedOut: false,
  })
})

test('delegated arguments retain shell metacharacters and newlines verbatim', async () => {
  const root = installCli(() => `console.log(JSON.stringify({ args: process.argv.slice(2) }))`)
  const args = ['quoted \' "', '`touch marker`', '$(touch marker)', '$HOME', 'line\nnext', root]
  const result = await runStudioCliJson(args, decodeJsonObject, { cwd: root, timeoutMs: 1_000 })
  expect(result).toMatchObject({ ok: true, data: { args: [...args, '--json'] } })
  expect(existsSync(join(root, 'marker'))).toBe(false)
})
