import { ResponseError } from '@astrale-os/sdk/client'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ConnectionContext } from '../../connection'

import { callCommand, materializeCallResult } from '../call'
import { captureProcess, ExitError, human } from './fixtures/process'

describe('call command target and dry run', () => {
  /** Run `call` with a dry-run connection that resolves @self to alice and never dispatches. */
  async function call(target: string, params: string[], opts: Record<string, unknown>) {
    const run = { connections: 0, credential: undefined as unknown, rendered: undefined as unknown }
    const context = {
      self: async () => ({ id: 'alice' }),
      target: {},
      session: {
        async dispatch() {
          throw new Error('dry run must not dispatch')
        },
      },
    } as unknown as ConnectionContext
    await callCommand(target, params, opts, {
      async runKernelCommand(input) {
        run.connections += 1
        run.credential = input.credential
        if (opts.dryRun !== true) return
        await input.format?.(await input.fn(context), input.opts, true)
      },
      output: (value) => void (run.rendered = plainCall(value)),
    })
    return run
  }

  test('a dry run admits --data verbatim without a Kernel connection, @self included', async () => {
    const target = '/:shipment.example:function.dispatch'
    for (const data of ['{"reference":"SHIP-1"}', '{"owner":"@self"}']) {
      const run = await call(target, [], { dryRun: true, data, json: true })
      expect(run).toMatchObject({ connections: 0, rendered: { target, input: JSON.parse(data) } })
    }
  })

  test('a dry run resolves @self in key=value params inside the command session', async () => {
    const target = '/:shipment.example:function.dispatch'
    const run = await call(target, ['owner=@self'], { dryRun: true, json: true })
    expect(run).toEqual({
      connections: 1,
      credential: { principal: 'caller' },
      rendered: { target, input: { owner: '@alice' } },
    })
  })

  test('an ordinary call selects credentials for its executable Domain', async () => {
    const run = await call('@worker::services.example:class.Worker.method.logs', ['tail=1'], {
      json: true,
    })
    expect(run.credential).toMatchObject({ principal: 'callable' })
  })
})

function plainCall(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('target' in value) || !('input' in value)) {
    return value
  }
  const target = value.target
  return {
    target: typeof target === 'object' && target !== null && 'raw' in target ? target.raw : target,
    input: value.input,
  }
}

describe('call command result lifetime', () => {
  /** @evidence TEST-CLI-CALL-DRAINS-STREAM-IN-CONNECTION-ACTION */
  test('drains a session-backed stream before returning it for presentation', async () => {
    let sessionOpen = true
    async function* stream() {
      for (const value of ['first', 'second']) {
        if (!sessionOpen) throw new Error('session closed before stream consumption')
        yield value
      }
    }

    const sessionStream = Object.assign(stream(), { async cancel() {} })
    const materialized = await materializeCallResult({
      kind: 'stream',
      invocation: { source: 'https://kernel.test' as never, id: 'test-stream' },
      stream: sessionStream,
    })
    sessionOpen = false

    expect(materialized).toEqual({ kind: 'stream', values: ['first', 'second'] })
    expect(Object.isFrozen(materialized)).toBe(true)
    if (materialized.kind !== 'stream') throw new Error('expected a materialized stream')
    expect(Object.isFrozen(materialized.values)).toBe(true)
  })

  test('drains streaming binary bytes before the command session closes', async () => {
    let sessionOpen = true
    async function* body() {
      for (const chunk of [new Uint8Array([1, 2]), new Uint8Array([3])]) {
        if (!sessionOpen) throw new Error('session closed before binary consumption')
        yield chunk
      }
    }

    const materialized = await materializeCallResult({
      kind: 'binary',
      invocation: { source: 'https://kernel.test' as never, id: 'test-binary' },
      value: {
        body: body(),
        mediaType: 'application/octet-stream',
        status: 206,
        headers: { 'content-range': 'bytes 0-2/3' },
      },
    })
    sessionOpen = false

    expect(materialized).toMatchObject({
      kind: 'binary',
      value: {
        mediaType: 'application/octet-stream',
        status: 206,
        headers: { 'content-range': 'bytes 0-2/3' },
      },
    })
    if (materialized.kind !== 'binary') throw new Error('expected materialized binary')
    expect([...materialized.value.body]).toEqual([1, 2, 3])
    expect(Object.isFrozen(materialized.value)).toBe(true)
  })
})

describe('call command input', () => {
  const captured = captureProcess()

  test.each([
    ['{"body":"before\\u0000after"}', 'Portable strings must not contain U+0000 at /body'],
    ['{"note":{"text":"\\ud800"}}', 'Expected a Unicode-scalar string at /note/text'],
  ])('refuses %s as caller input naming its path, before any connection', async (data, why) => {
    let connections = 0
    await expect(
      callCommand(
        '/:notes.example:function.save',
        [],
        { data, json: true },
        { runKernelCommand: async () => void (connections += 1), output: () => {} },
      ),
    ).rejects.toBeInstanceOf(ExitError)
    expect(captured.failure()).toEqual({
      error: 'INVALID_INPUT',
      message: `Call input cannot be sent: ${why}.`,
    })
    expect(connections).toBe(0)
  })
})

describe('call command durable answer', () => {
  const invocation = { source: 'https://kernel.example', id: 'call-1' }

  /** The outcome `call` hands to presentation for one Kernel answer. */
  async function outcome(answer: unknown) {
    const context = {
      target: { kernelIssuer: 'https://kernel.example' },
      credentialPrincipal: () => 'domain',
      session: { dispatch: async () => answer },
    } as unknown as ConnectionContext
    let result: unknown
    await callCommand(
      '/:jobs.example:function.hold',
      ['invoice=inv-1'],
      { json: true },
      {
        async runKernelCommand(input) {
          result = await input.fn(context)
        },
        output: () => {},
      },
    )
    return result
  }

  test('prints the receipt of the Execution a durable callable started', async () => {
    expect(await outcome({ kind: 'execution', invocation, execution: 'run-1' })).toEqual({
      kind: 'execution',
      receipt: {
        kind: 'astrale.execution',
        version: 2,
        id: 'run-1',
        kernel: 'https://kernel.example',
        origin: 'jobs.example',
        principal: 'domain',
      },
      replayed: false,
    })
  })

  test('a durable answer the Kernel marks a replay says so once; the receipt is unchanged', async () => {
    const answer = { kind: 'execution', invocation, execution: 'run-1', replayed: true }
    const replayed = (await outcome(answer)) as { readonly receipt: unknown }
    expect(replayed).toMatchObject({ replayed: true })
    expect(replayed.receipt).not.toHaveProperty('replayed')
    const context = {
      target: { kernelIssuer: 'https://kernel.example' },
      credentialPrincipal: () => 'domain',
      session: { dispatch: async () => answer },
    } as unknown as ConnectionContext
    const shown = await human(() =>
      callCommand(
        '/:jobs.example:function.hold',
        ['invoice=inv-1'],
        {},
        {
          async runKernelCommand(input) {
            await input.format!(await input.fn(context), {}, false)
          },
          output: () => {},
        },
      ),
    )
    expect(shown.lines).toContain(
      'This call already ran as run-1: the receipt names its recorded Execution; nothing ran again.',
    )
  })

  /** What `call --wait` hands to presentation, and the waits it asked of the Execution. */
  async function waited(ended: () => Promise<unknown>, opts: Record<string, unknown> = {}) {
    const waits: unknown[][] = []
    const context = {
      target: { kernelIssuer: 'https://kernel.example' },
      credentialPrincipal: () => 'domain',
      session: {
        dispatch: async () => ({ kind: 'execution', invocation, execution: 'run-1' }),
        execution: {
          result: async (...args: unknown[]) => {
            waits.push(args)
            return ended()
          },
        },
      },
    } as unknown as ConnectionContext
    let result: unknown
    await callCommand(
      '/:jobs.example:function.hold',
      ['invoice=inv-1'],
      { json: true, wait: true, ...opts },
      {
        async runKernelCommand(input) {
          result = await input.fn(context)
        },
        output: () => {},
      },
    )
    return { result, waits }
  }

  test('--wait answers a completed Execution with its value, waiting 110 s without --timeout', async () => {
    const { result, waits } = await waited(async () => ({ kind: 'completed', value: { held: 1 } }))
    expect(result).toEqual({ kind: 'value', value: { held: 1 } })
    expect(waits).toEqual([['run-1', { waitMs: 110_000 }, undefined]])
  })

  test('--timeout bounds the call and its wait together', async () => {
    const { waits } = await waited(async () => ({ kind: 'completed', value: 1 }), {
      timeout: '5000',
    })
    const [[, wait, options]] = waits as [[string, { waitMs: number }, { timeoutMs: number }]]
    expect(wait.waitMs).toBeGreaterThan(4_000)
    expect(wait.waitMs).toBeLessThanOrEqual(5_000)
    expect(options).toEqual({ timeoutMs: wait.waitMs })
  })

  test('--wait fails like a plain call once the Execution failed or was cancelled', async () => {
    const error = { code: 'INVOICE_LOCKED', message: 'Invoice inv-1 is locked.' }
    await expect(waited(async () => ({ kind: 'failed', error }))).rejects.toMatchObject(error)
    await expect(waited(async () => ({ kind: 'cancelled' }))).rejects.toMatchObject({
      code: 'EXECUTION_CANCELLED',
    })
  })

  test('a wait that ends first keeps the receipt: the Execution still runs', async () => {
    const { result } = await waited(async () => {
      throw new ResponseError(4001 as never, 'Pending.', 'call-1' as never, {
        code: 'EXECUTION_PENDING',
        details: {},
      })
    })
    expect(result).toMatchObject({
      kind: 'execution',
      receipt: { kind: 'astrale.execution', id: 'run-1' },
      running: true,
    })
  })

  test('keeps an id-shaped value a value', async () => {
    expect(await outcome({ kind: 'value', invocation, value: { id: 'run-1' } })).toEqual({
      kind: 'value',
      invocation,
      value: { id: 'run-1' },
    })
  })
})

describe('call --file', () => {
  const io = captureProcess()
  const FUNCTION = '/:sextant.so:function.importBalance'

  function file(name: string, content: string): string {
    const path = join(mkdtempSync(join(tmpdir(), 'astrale-call-file-')), name)
    writeFileSync(path, content)
    return path
  }

  /** Run `call` against a fake Kernel; the caller Session uploads and reads the declared input. */
  async function call(params: string[], opts: Record<string, unknown>, declared?: unknown) {
    const run = {
      connections: 0,
      callerSessions: 0,
      uploaded: [] as { bytes: string; mediaType: string }[],
      dispatched: undefined as unknown,
      error: undefined as unknown,
      rendered: undefined as unknown,
    }
    const caller = {
      session: {
        schema: {
          async bundle() {
            if (declared === undefined) throw new Error('no bundle')
            // The shape the Kernel Schema API answers, as `introspect --bundle` prints it.
            return { domain: { origin: 'sextant.so' }, bundle: declared }
          },
        },
        content: {
          async upload(body: Blob, options: { mediaType: string }) {
            run.uploaded.push({ bytes: await body.text(), mediaType: options.mediaType })
            const n = run.uploaded.length
            return {
              receipt: `receipt-${n}`,
              ref: { digest: `sha256:${'0'.repeat(64)}`, mediaType: options.mediaType, size: 1 },
              expiresAt: '2026-11-02T12:15:00.000Z',
            }
          },
        },
      },
    } as unknown as ConnectionContext
    const context = {
      self: async () => ({ id: 'alice' }),
      target: {},
      session: {
        async dispatch(request: { input: unknown }) {
          run.dispatched = request.input
          return { kind: 'value', value: { ok: true } }
        },
      },
    } as unknown as ConnectionContext
    await callCommand(FUNCTION, params, opts, {
      async runKernelCommand(input) {
        run.connections += 1
        try {
          await input.format?.(await input.fn(context), input.opts, true)
        } catch (error) {
          run.error = error
        }
      },
      output: (value) => void (run.rendered = plainCall(value)),
      async withCallerSession(_opts, _admin, action) {
        run.callerSessions += 1
        return action(caller)
      },
    })
    return run
  }

  test('uploads each file as the caller and puts its receipt at its field', async () => {
    const csv = file('tb.csv', 'a,b\n')
    const pdf = file('a.pdf', '%PDF')
    const run = await call(['fiscalYear=2026'], {
      json: true,
      file: [`balance=${csv}`, `/attachments/-=${pdf}`],
    })
    expect(run.error).toBeUndefined()
    expect(run.callerSessions).toBe(1)
    expect(run.uploaded).toEqual([
      { bytes: 'a,b\n', mediaType: 'text/csv' },
      { bytes: '%PDF', mediaType: 'application/pdf' },
    ])
    expect(run.dispatched).toEqual({
      fiscalYear: 2026,
      balance: 'receipt-1',
      attachments: ['receipt-2'],
    })
  })

  test('fills a nested field of --data', async () => {
    const run = await call([], {
      json: true,
      data: '{"operations":[{"props":{}}]}',
      file: [`/operations/0/props/content=${file('n.txt', 'x')}`],
    })
    expect(run.dispatched).toEqual({ operations: [{ props: { content: 'receipt-1' } }] })
  })

  test('a dry run shows a placeholder and uploads nothing', async () => {
    const csv = file('tb.csv', 'a,b\n')
    const run = await call([], { json: true, dryRun: true, data: '{}', file: [`balance=${csv}`] })
    expect(run).toMatchObject({
      connections: 0,
      callerSessions: 0,
      uploaded: [],
      rendered: { target: FUNCTION, input: { balance: `<receipt of ${csv}>` } },
    })
  })

  test('refuses a missing file and a field the params already fill before connecting', async () => {
    await expect(
      call([], { json: true, data: '{}', file: ['balance=./missing.csv'] }),
    ).rejects.toThrow(ExitError)
    expect(io.failure()).toMatchObject({ error: 'FILE_MISSING' })

    const csv = file('tb.csv', 'a')
    await expect(call(['balance=x'], { json: true, file: [`balance=${csv}`] })).rejects.toThrow(
      ExitError,
    )
    expect(io.failure()).toMatchObject({ error: 'FILE_INPUT_CONFLICT' })
  })

  test('checks a declared file field before uploading', async () => {
    const declared = sextantBundle({
      type: 'object',
      properties: {
        balance: {
          type: 'string',
          'x-astrale-value-kind': 'file',
          'x-astrale-file': { maxBytes: 3, mediaTypes: ['text/csv'] },
        },
      },
    })
    const tooLarge = await call(
      [],
      { json: true, data: '{}', file: [`balance=${file('tb.csv', 'abcd')}`] },
      declared,
    )
    expect(tooLarge.error).toMatchObject({ code: 'FILE_TOO_LARGE' })
    expect(tooLarge.uploaded).toEqual([])
    expect(tooLarge.dispatched).toBeUndefined()

    const wrongType = await call(
      [],
      { json: true, data: '{}', file: [`balance=${file('tb.pdf', 'ab')}`] },
      declared,
    )
    expect(wrongType.error).toMatchObject({ code: 'FILE_MEDIA_TYPE_REFUSED' })

    const fits = await call(
      [],
      { json: true, data: '{}', file: [`balance=${file('tb.csv', 'abc')}`] },
      declared,
    )
    expect(fits.error).toBeUndefined()
    expect(fits.dispatched).toEqual({ balance: 'receipt-1' })
  })
})

/** A published bundle as a Kernel that knows file fields serves it, never admitted here. */
function sextantBundle(input: unknown): unknown {
  return {
    format: 'astrale.domain.bundle',
    version: 1,
    root: {
      origin: 'sextant.so',
      functions: { importBalance: { input, output: { mode: 'value', schema: {} } } },
      classes: {},
    },
  }
}
