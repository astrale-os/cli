import { issuer } from '@astrale-os/sdk/auth'
import { ClientSession } from '@astrale-os/sdk/client/session'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ConnectionContext } from '../../connection'

import { executionCommand, executionCommands } from '../execution'

const kernel = issuer.accept('https://kernel.example')
const receipt = {
  kind: 'astrale.execution',
  version: 2,
  id: 'execution-1',
  kernel,
  origin: 'jobs.example',
  principal: 'domain',
}
let directory: string
let file: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'astrale-observation-'))
  file = join(directory, 'receipt.json')
  await writeFile(file, JSON.stringify(receipt))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

const status = {
  id: 'execution-1',
  function: 'function-1',
  version: `sha256:${'e'.repeat(64)}`,
  state: 'completed',
  createdAt: '2026-10-12T00:00:00Z',
  outcome: { kind: 'completed', value: 42 },
}

/** A real Client session whose transport answers each Execution Method as the Kernel does. */
function executionSession(wire: unknown[]) {
  return new ClientSession({
    kernel,
    policy: { maximumRouteAgeMs: 60000 },
    envelopeTransport: 'http',
    routeStore: { read: () => undefined, write: () => undefined },
    fetch: async (url, init) => {
      expect(String(url)).toBe(`${kernel}/invoke`)
      const body = JSON.parse(await new Response(init?.body).text())
      wire.push(body.call)
      const target: string =
        typeof body.call.target === 'string' ? body.call.target : body.call.target.callable
      const method = target.slice(target.lastIndexOf('.') + 1)
      const result =
        method === 'result' ? { kind: 'completed', value: 42 } : method === 'signal' ? {} : status
      const response = new Response(
        JSON.stringify({
          requestId: body.requestId,
          invocation: { source: kernel, id: 'read-1' },
          result,
        }),
        {
          headers: {
            'cache-control': 'no-store',
            'content-type': new Headers(init?.headers).get('accept')!,
          },
        },
      )
      Object.defineProperty(response, 'url', { value: String(url) })
      return response
    },
  })
}

const method = (name: string) => `@execution-1::kernel.astrale.ai:class.Execution.method.${name}`

test('a receipt file is read in the context it records, and each Method is sent once', async () => {
  const wire: unknown[] = []
  const session = executionSession(wire)
  const results: unknown[] = []
  const send = async (...args: Parameters<typeof executionCommand>) => {
    const command = await executionCommand(...args)
    expect(command.credential).toMatchObject({ principal: 'execution', receipt })
    // No identity is inferred from the receipt. The normal connection layer selects the default.
    expect(command.opts).not.toHaveProperty('as')
    results.push(await command.fn({ session } as ConnectionContext))
  }
  try {
    await send('status', file, { url: kernel, json: true })
    await send('result', file, { url: kernel, json: true })
    await send('result', file, { url: kernel, json: true, waitMs: '1000' })
    await send('cancel', file, { url: kernel })
    await send('resume', file, { url: kernel })
    await send('signal', file, { url: kernel, value: '{"by":"billing"}' }, 'approval')
    await send('signal', file, { url: kernel }, 'consent')
    expect(wire).toEqual([
      { target: method('status'), input: {} },
      // Without --wait-ms a result read answers at once: a wait of 0.
      { target: method('result'), input: { waitMs: 0 } },
      // The time left of the 1000 ms wait when the request is sent.
      { target: method('result'), input: { waitMs: expect.any(Number) } },
      { target: method('cancel'), input: {} },
      { target: method('resume'), input: {} },
      { target: method('signal'), input: { name: 'approval', value: { by: 'billing' } } },
      // Without --value the promise resolves with null.
      { target: method('signal'), input: { name: 'consent', value: null } },
    ])
    expect((wire[2] as { input: { waitMs: number } }).input.waitMs).toBeLessThanOrEqual(1000)
    expect(results.slice(0, 5)).toMatchObject([
      { id: 'execution-1', state: 'completed' },
      { kind: 'completed', value: 42 },
      { kind: 'completed', value: 42 },
      { id: 'execution-1', state: 'completed' },
      { id: 'execution-1', state: 'completed' },
    ])
    expect(results.slice(5)).toEqual([
      { execution: 'execution-1', signal: 'approval', accepted: true },
      { execution: 'execution-1', signal: 'consent', accepted: true },
    ])
  } finally {
    session.close()
  }
})

test('an Execution ID is reached as the caller itself, explicit credentials included', async () => {
  for (const opts of [{ instance: 'app' }, { creds: 'opaque' }, { anonymous: true }]) {
    const command = await executionCommand('cancel', 'execution-1', opts)
    expect(command.credential).toEqual({ principal: 'caller' })
    expect(command.label).toBe('Execution cancel: execution-1')
  }
})

test('a result read names the commands that follow its Execution while it still runs', async () => {
  const read = await executionCommand('result', file, { instance: 'app', waitMs: '0' })
  expect(read.pending).toEqual<unknown>({
    execution: 'execution-1',
    follow: `astrale execution result ${file} --wait-ms 20000 -i app`,
    observe: `astrale execution status ${file} -i app`,
    waited: false,
  })
  expect(
    (await executionCommand('result', 'execution-1', { instance: 'app', waitMs: '50' })).pending,
  ).toEqual<unknown>({
    execution: 'execution-1',
    follow: 'astrale execution result execution-1 --wait-ms 20000 -i app',
    observe: 'astrale execution status execution-1 -i app',
    waited: true,
  })
  for (const method of ['status', 'cancel', 'resume'] as const) {
    expect(await executionCommand(method, file, { instance: 'app' })).not.toHaveProperty('pending')
  }
})

test('invalid waits, values, addresses, files and receipt credential overrides fail before connection', async () => {
  for (const waitMs of ['-1', 'NaN', '1.5', '9007199254740992']) {
    await expect(executionCommand('result', file, { waitMs })).rejects.toThrow(
      '--wait-ms must be a nonnegative safe integer.',
    )
  }
  await expect(executionCommand('signal', file, { value: '{by:' }, 'approval')).rejects.toThrow(
    '--value must be a JSON value.',
  )
  await expect(executionCommand('status', join(directory, 'absent'), {})).rejects.toThrow(
    'Expected an Execution ID or the file of an execution receipt.',
  )
  // `receipt.json` is a valid Node ID: a missing receipt is still a missing file.
  await expect(executionCommand('status', 'receipt.json', {})).rejects.toThrow(
    'No receipt file at receipt.json.',
  )
  await writeFile(file, 'private malformed value')
  await expect(executionCommand('status', file, {})).rejects.toThrow(
    'The execution receipt file must contain valid JSON.',
  )
  await writeFile(file, JSON.stringify(receipt))
  for (const opts of [{ creds: 'opaque' }, { anonymous: true }]) {
    await expect(executionCommand('status', file, opts)).rejects.toMatchObject({
      code: 'EXECUTION_IDENTITY_REQUIRED',
    })
  }
})

test('the execution group offers status, result, cancel, resume and signal, never force or delete', () => {
  expect(executionCommands.map(({ name }) => name)).toEqual([
    'status',
    'result',
    'cancel',
    'resume',
    'signal',
  ])
  expect(
    executionCommands
      .flatMap(({ options }) => options ?? [])
      .some(({ flags }) => flags.includes('--force')),
  ).toBe(false)
})

test.each(['caller', 'domain'])(
  'real CLI stdout receipt roundtrip uses production credential selection (%s)',
  async (mode) => {
    const observed = join(directory, 'observed.jsonl')
    const invoke = async (args: string[]) => {
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, 'fixtures/execution-cli.ts'), ...args],
        {
          env: {
            ...process.env,
            ASTRALE_HOME: directory,
            EXECUTION_FIXTURE_MODE: mode,
            EXECUTION_FIXTURE_OBSERVED: observed,
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(code, stderr + stdout).toBe(0)
      return stdout
    }
    const flags = ['--url', kernel, '--as', 'alice', '--json']
    const stdout = await invoke(['call', '/:jobs.example:function.durable', ...flags])
    expect(JSON.parse(stdout)).toMatchObject({
      kind: 'astrale.execution',
      id: 'execution-1',
      principal: mode,
    })
    // Use the exact command stdout bytes, not JSON.stringify of the in-memory value.
    await writeFile(file, stdout)
    const startEvents = (await Bun.file(observed).text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(startEvents.some((event) => event.kind === 'exchange')).toBe(mode === 'domain')
    await writeFile(observed, '')
    expect(JSON.parse(await invoke(['execution', 'status', file, ...flags]))).toMatchObject({
      id: 'execution-1',
      state: 'completed',
      outcome: { kind: 'completed', value: 42 },
    })
    expect(
      JSON.parse(await invoke(['execution', 'result', file, '--wait-ms', '0', ...flags])),
    ).toEqual({ kind: 'completed', value: 42 })
    const events = (await Bun.file(observed).text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const observations = events.filter(
      (event) => typeof event.target === 'string' && event.target.includes('class.Execution'),
    )
    expect(observations.map((event) => event.principal)).toEqual([mode, mode])
    if (mode === 'caller') {
      // A caller receipt reconstructs its context locally: only the two observations reach a server.
      expect(events).toEqual(observations)
    } else {
      expect(events.filter((event) => event.input?.kind === 'inspect')).toHaveLength(2)
    }
  },
)

test('real CLI operates an Execution by its ID as the caller, with no Domain exchange', async () => {
  const observed = join(directory, 'observed.jsonl')
  const invoke = async (args: string[]) => {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, 'fixtures/execution-cli.ts'), ...args],
      {
        env: { ...process.env, ASTRALE_HOME: directory, EXECUTION_FIXTURE_OBSERVED: observed },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(code, stderr + stdout).toBe(0)
    return JSON.parse(stdout)
  }
  const flags = ['--url', kernel, '--as', 'alice', '--json']
  expect(await invoke(['execution', 'cancel', 'execution-1', ...flags])).toMatchObject({
    id: 'execution-1',
    state: 'completed',
  })
  expect(
    await invoke([
      'execution',
      'signal',
      'execution-1',
      'approval',
      '--value',
      '{"by":"billing"}',
      ...flags,
    ]),
  ).toEqual({ execution: 'execution-1', signal: 'approval', accepted: true })
  const events = (await Bun.file(observed).text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  // An ID needs no receipt context: only the two Methods reach a server, as the caller.
  expect(events).toEqual([
    {
      kind: 'invoke',
      target: '@execution-1::kernel.astrale.ai:class.Execution.method.cancel',
      input: {},
      principal: 'caller',
    },
    {
      kind: 'invoke',
      target: '@execution-1::kernel.astrale.ai:class.Execution.method.signal',
      input: { name: 'approval', value: { by: 'billing' } },
      principal: 'caller',
    },
  ])
})

test('a result read before the Execution ended is still running: exit 75 and what follows it', async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, 'fixtures/execution-cli.ts'),
      'execution',
      'result',
      file,
      '--wait-ms',
      '0',
      '--url',
      kernel,
      '--as',
      'alice',
    ],
    {
      env: {
        ...process.env,
        ASTRALE_HOME: directory,
        EXECUTION_FIXTURE_MODE: 'domain',
        EXECUTION_FIXTURE_PENDING: '1',
        EXECUTION_FIXTURE_OBSERVED: join(directory, 'observed.jsonl'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  // A redirected stdout is machine output: one JSON document on stderr.
  expect(code, stderr + stdout).toBe(75)
  expect(JSON.parse(stderr)).toMatchObject({
    execution: 'execution-1',
    follow: `astrale execution result ${file} --wait-ms 20000 --url ${kernel} --as alice`,
    observe: `astrale execution status ${file} --url ${kernel} --as alice`,
    reason: { code: 'EXECUTION_PENDING' },
  })
})

test('production openConnection accessor follows stale remote issuer recovery to caller', async () => {
  const observed = join(directory, 'observed.jsonl')
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, 'fixtures/execution-cli.ts'), 'probe-stale'],
    {
      env: {
        ...process.env,
        ASTRALE_HOME: directory,
        EXECUTION_FIXTURE_MODE: 'stale',
        EXECUTION_FIXTURE_OBSERVED: observed,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(code, stderr + stdout).toBe(0)
  expect(JSON.parse(stdout)).toEqual({ unavailable: true, principal: 'caller' })
  const events = (await Bun.file(observed).text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(events.some((event) => event.kind === 'discovery')).toBe(true)
  expect(events.some((event) => event.input?.kind === 'inspect')).toBe(true)
  expect(events.at(-1)).toMatchObject({ principal: 'caller' })
})

test('production SessionAuth propagates observation principal refusal before Execution dispatch', async () => {
  const observed = join(directory, 'observed.jsonl')
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, 'fixtures/execution-cli.ts'),
      'execution',
      'status',
      file,
      '--url',
      kernel,
      '--as',
      'alice',
      '--json',
    ],
    {
      env: {
        ...process.env,
        ASTRALE_HOME: directory,
        EXECUTION_FIXTURE_MODE: 'changed',
        EXECUTION_FIXTURE_OBSERVED: observed,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(code, stderr + stdout).toBe(1)
  expect(stdout).toBe('')
  expect(JSON.parse(stderr)).toMatchObject({ error: 'EXECUTION_PRINCIPAL_CHANGED' })
  const events = (await Bun.file(observed).text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(events.filter((event) => event.input?.kind === 'inspect')).toHaveLength(2)
  expect(
    events.some(
      (event) =>
        typeof event.target === 'object' && event.target.callable?.includes('class.Execution'),
    ),
  ).toBe(false)
})
