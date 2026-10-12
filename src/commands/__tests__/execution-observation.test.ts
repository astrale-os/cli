import { issuer } from '@astrale-os/sdk/auth'
import { ClientSession } from '@astrale-os/sdk/client/session'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ConnectionContext, runKernelCommand } from '../../connection'

import { observeExecution } from '../execution'

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

test('status/result actions read the file, retain default identity selection, and send real SDK execution references', async () => {
  const wire: { target: unknown; input: unknown }[] = []
  const results: unknown[] = []
  const session = new ClientSession({
    kernel,
    policy: { maximumRouteAgeMs: 60000 },
    envelopeTransport: 'http',
    routeStore: { read: () => undefined, write: () => undefined },
    fetch: async (url, init) => {
      expect(String(url)).toBe(`${kernel}/invoke`)
      const body = JSON.parse(await new Response(init?.body).text())
      wire.push(body.call)
      const response = new Response(
        JSON.stringify({
          requestId: body.requestId,
          invocation: { source: kernel, id: 'read-1' },
          result: { kind: 'completed', value: 42 },
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
  const run: typeof runKernelCommand = async (input) => {
    expect(input.credential).toMatchObject({ principal: 'execution', receipt })
    expect(input.opts.url).toBe(kernel)
    // No identity is inferred from the receipt. The normal connection layer selects the default.
    expect(input.opts).not.toHaveProperty('as')
    results.push(await input.fn({ session } as ConnectionContext))
  }
  try {
    await observeExecution('status', file, { url: kernel, json: true }, run)
    await observeExecution('result', file, { url: kernel, json: true }, run)
    await observeExecution('result', file, { url: kernel, json: true, waitMs: '0' }, run)
    await observeExecution('result', file, { url: kernel, json: true, waitMs: '1000' }, run)
    expect(wire).toEqual([
      {
        target: {
          callable: 'kernel.astrale.ai:class.Execution.method.status',
          instance: '@execution-1',
        },
        input: {},
      },
      {
        target: {
          callable: 'kernel.astrale.ai:class.Execution.method.result',
          instance: '@execution-1',
        },
        input: {},
      },
      {
        target: {
          callable: 'kernel.astrale.ai:class.Execution.method.result',
          instance: '@execution-1',
        },
        input: { waitMs: 0 },
      },
      {
        target: {
          callable: 'kernel.astrale.ai:class.Execution.method.result',
          instance: '@execution-1',
        },
        input: { waitMs: 1000 },
      },
    ])
    expect(results).toEqual(Array(4).fill({ kind: 'completed', value: 42 }))
  } finally {
    session.close()
  }
})

test('a result read names the commands that follow its Execution while it still runs', async () => {
  const inputs: { readonly pending?: unknown }[] = []
  const run: typeof runKernelCommand = async (input) => void inputs.push(input)
  await observeExecution('result', file, { instance: 'app', waitMs: '0' }, run)
  await observeExecution('status', file, { instance: 'app' }, run)
  expect(inputs[0]!.pending).toEqual({
    execution: 'execution-1',
    follow: `astrale execution result ${file} --wait-ms 20000 -i app`,
    observe: `astrale execution status ${file} -i app`,
    waited: false,
  })
  expect(inputs[1]).not.toHaveProperty('pending')
})

test('invalid waits, absent/malformed files and explicit credential overrides fail before connection', async () => {
  let connections = 0
  const run: typeof runKernelCommand = async () => {
    connections++
  }
  for (const waitMs of ['-1', 'NaN', '1.5', '9007199254740992']) {
    await expect(observeExecution('result', file, { waitMs }, run)).rejects.toThrow(
      '--wait-ms must be a nonnegative safe integer.',
    )
  }
  await expect(observeExecution('status', join(directory, 'absent'), {}, run)).rejects.toThrow()
  await writeFile(file, 'private malformed value')
  await expect(observeExecution('status', file, {}, run)).rejects.toThrow(
    'The execution receipt file must contain valid JSON.',
  )
  for (const opts of [{ creds: 'opaque' }, { anonymous: true }]) {
    await expect(observeExecution('status', file, opts, run)).rejects.toMatchObject({
      code: 'EXECUTION_IDENTITY_REQUIRED',
    })
  }
  expect(connections).toBe(0)
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
    expect(JSON.parse(await invoke(['execution', 'status', file, ...flags]))).toEqual({
      state: 'completed',
    })
    expect(
      JSON.parse(await invoke(['execution', 'result', file, '--wait-ms', '0', ...flags])),
    ).toEqual({ kind: 'completed', value: 42 })
    const events = (await Bun.file(observed).text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const observations = events.filter(
      (event) =>
        typeof event.target === 'object' && event.target.callable?.includes('class.Execution'),
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
