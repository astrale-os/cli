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
  version: 1,
  id: 'execution-1',
  kernel,
  caller: 'alice',
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
