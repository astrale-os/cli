import { expect, test } from 'bun:test'
import { chmod, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

const entry = join(import.meta.dir, '../../../bin/astrale.ts')
const usageError = {
  error: 'MISSING_ARG',
  message: '`view` needs a ViewPath or target node.',
  hint: 'Run: astrale view @customer --snapshot',
}

async function runView(args: readonly string[], tty = false) {
  const root = await mkdtemp(join(tmpdir(), 'astrale-view-missing-target-'))
  const home = join(root, 'home')
  const bin = join(root, 'bin')
  await mkdir(home)
  await mkdir(bin)
  // Observe browser lookup and launch without replacing the CLI command or Kernel.
  const marker = join(root, 'browser-called')
  for (const command of ['sh', 'agent-browser']) {
    const file = join(bin, command)
    await writeFile(file, '#!/bin/sh\nprintf called > "$ASTRALE_TEST_BROWSER_MARKER"\nexit 90\n')
    await chmod(file, 0o755)
  }
  let connections = 0
  const observer = createServer((socket) => {
    connections += 1
    socket.destroy()
  })
  await new Promise<void>((resolve, reject) => {
    observer.once('error', reject)
    observer.listen(0, '127.0.0.1', resolve)
  })
  const address = observer.address()
  if (!address || typeof address === 'string') throw new Error('Expected an observing TCP port')
  const argv = ['view', ...args, '--url', `http://127.0.0.1:${address.port}`, '--as', 'missing']
  // Set only the output surface; parsing and dispatch still use the real entry point.
  const command = tty
    ? [
        process.execPath,
        '-e',
        `Object.defineProperty(process.stdout, 'isTTY', { value: true });
         process.argv = ${JSON.stringify([process.execPath, entry, ...argv])};
         await import(${JSON.stringify(entry)});`,
      ]
    : [process.execPath, entry, ...argv]
  const child = Bun.spawn(command, {
    env: {
      ...process.env,
      ASTRALE_HOME: home,
      ASTRALE_KEYS_DIR: join(home, 'keys'),
      ASTRALE_DATA_DIR: join(home, 'data'),
      ASTRALE_TEST_BROWSER_MARKER: marker,
      ASTRALE_TELEMETRY: '0',
      ASTRALE_TELEMETRY_NO_TRIGGER: '1',
      ASTRALE_UPDATE_REEXEC: '1',
      NO_UPDATE_NOTIFIER: '1',
      NO_COLOR: '1',
      CI: '1',
      PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timeout = setTimeout(() => child.kill(), 8_000)
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(connections).toBe(0)
    expect(await readdir(home)).toEqual([])
    expect(await Bun.file(marker).exists()).toBe(false)
    return { exitCode, stdout, stderr }
  } finally {
    clearTimeout(timeout)
    await new Promise<void>((resolve) => observer.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
}

for (const { mode, flags, tty } of [
  { mode: 'piped', flags: [], tty: false },
  { mode: 'json on a terminal', flags: ['--json'], tty: true },
  { mode: 'debug', flags: ['--debug'], tty: false },
  { mode: 'json and debug', flags: ['--json', '--debug'], tty: true },
]) {
  test(`snapshot without a target reports usage before browser, auth or effects (${mode})`, async () => {
    const result = await runView(['--snapshot', ...flags], tty)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    const [error, ...debug] = result.stderr.trimEnd().split('\n')
    expect(JSON.parse(error!)).toEqual(usageError)
    if (flags.includes('--debug')) {
      expect(debug.join('\n')).toContain('AstraleError: `view` needs a ViewPath or target node.')
      expect(debug.join('\n')).toContain('view.ts')
    } else {
      expect(debug).toEqual([])
    }
  })
}

test('snapshot without a target gives the same actionable usage error on a terminal', async () => {
  const result = await runView(['--snapshot'], true)
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toBe(`✖ ${usageError.error}: ${usageError.message}\n`)
  expect(result.stdout).toBe(`  ${usageError.hint}\n`)
})

for (const flags of [['--sessions'], ['--list'], ['--close', '--all']]) {
  test(`targetless snapshot preserves the ${flags[0]} management branch`, async () => {
    const result = await runView([...flags, '--snapshot', '--json'])
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual(flags[0] === '--close' ? { closed: [] } : [])
  })
}

test('targetless snapshot preserves the refresh session diagnostic', async () => {
  const result = await runView(['--refresh', 'v-missing', '--snapshot', '--json'])
  expect(result.exitCode).toBe(1)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain('No view session "v-missing".')
  expect(result.stderr).not.toContain('MISSING_ARG')
})
