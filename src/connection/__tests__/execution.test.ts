import { issuer } from '@astrale-os/sdk/auth'
import { expect, test } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AstraleConfig } from '../../lib/config'
import type { ConnectionContext, ConnectionFactory } from '../session'

import { InstallationCache } from '../../state/installations'
import { acceptExecutionReceipt } from '../execution'
import { withResolvedClientSession } from '../session'

const kernel = issuer.accept('https://kernel.example')
const target = { kernelIssuer: kernel, url: kernel }
const receipt = acceptExecutionReceipt({
  kind: 'astrale.execution',
  version: 2,
  id: 'execution-1',
  kernel,
  origin: 'jobs.example',
  principal: 'domain',
})

function harness() {
  const opened: { principal: string | undefined; issuer: string | undefined }[] = []
  const calls: {
    principal: string | undefined
    issuer: string | undefined
    method: 'status' | 'result'
    execution: string
    wait?: unknown
  }[] = []
  let installed = 'https://old-domain.example'
  let inspections = 0
  let closes = 0
  let terminal = false
  const open: ConnectionFactory = (selected, _timeout, _options, _config, credential) => {
    const principal = credential?.principal
    opened.push({ principal, issuer: selected.domainIssuer })
    const context = {
      target: selected,
      graph: {},
      session: {
        schema: {
          inspect: async (origin: string) => {
            expect(origin).toBe('jobs.example')
            inspections++
            return { release: { identity: { issuer: installed } } }
          },
        },
        // The backend result is a fixture, not a replacement implementation of Kernel access.
        execution: {
          status: async (execution: string) => {
            calls.push({ principal, issuer: selected.domainIssuer, method: 'status', execution })
            return { state: terminal ? 'completed' : 'pending' }
          },
          result: async (execution: string, wait: unknown) => {
            calls.push({
              principal,
              issuer: selected.domainIssuer,
              method: 'result',
              execution,
              wait,
            })
            if (!terminal) throw new Error('EXECUTION_PENDING')
            return { kind: 'completed', value: 42 }
          },
        },
      },
    } as unknown as ConnectionContext
    return {
      context,
      close: () => {
        closes++
      },
    }
  }
  const observe = (operation: 'status' | 'result', selected = target, recorded = receipt) =>
    withResolvedClientSession(
      selected,
      { as: 'alice' },
      {} as AstraleConfig,
      async ({ session }) =>
        operation === 'status'
          ? session.execution.status(receipt.id)
          : session.execution.result(receipt.id, { waitMs: 100 }),
      open,
      {
        principal: 'execution',
        receipt: acceptExecutionReceipt(JSON.parse(JSON.stringify(recorded))),
      },
      // Poisoned cache must never select an observation issuer.
      Object.assign(new InstallationCache(), {
        get: async () => ({ issuer: issuer.accept('https://untrusted-cache.example') }),
        set: async () => {},
        delete: async () => {},
      }),
    )
  return {
    opened,
    calls,
    observe,
    rotate: (value: string) => {
      installed = value
    },
    complete: () => {
      terminal = true
    },
    counts: () => ({ inspections, closes }),
  }
}

test('portable receipt reconstructs Domain-for-caller status and pending-to-terminal result in separate sessions', async () => {
  const h = harness()
  expect(await h.observe('status')).toMatchObject({ state: 'pending' })
  await expect(h.observe('result')).rejects.toThrow('EXECUTION_PENDING')
  h.complete()
  expect(await h.observe('result')).toEqual({ kind: 'completed', value: 42 })
  expect(h.calls.map(({ principal, issuer }) => ({ principal, issuer }))).toEqual(
    Array(3).fill({ principal: 'domain', issuer: 'https://old-domain.example' }),
  )
  expect(h.calls[0]).toMatchObject({ method: 'status', execution: 'execution-1' })
  expect(h.calls[2]).toMatchObject({ method: 'result', wait: { waitMs: 100 } })
  expect(h.counts()).toEqual({ inspections: 3, closes: 6 })
})

test('another Kernel is refused without connections; a caller receipt opens only its observation session', async () => {
  const h = harness()
  await expect(
    h.observe('status', {
      kernelIssuer: issuer.accept('https://other.example'),
      url: issuer.accept('https://other.example'),
    }),
  ).rejects.toMatchObject({ code: 'EXECUTION_TARGET_MISMATCH' })
  expect(h.opened).toEqual([])
  await h.observe('status', target, { ...receipt, principal: 'caller' })
  expect(h.opened).toEqual([{ principal: 'caller', issuer: undefined }])
  expect(h.counts()).toEqual({ inspections: 0, closes: 1 })
})

test('issuer rotation reads only the current installed pin; transition to caller principal is refused', async () => {
  const h = harness()
  await h.observe('status')
  h.rotate('https://new-domain.example')
  await h.observe('status')
  expect(h.calls.map((call) => call.issuer)).toEqual([
    'https://old-domain.example',
    'https://new-domain.example',
  ])
  h.rotate(kernel)
  await expect(h.observe('status')).rejects.toMatchObject({ code: 'EXECUTION_PRINCIPAL_CHANGED' })
  expect(h.calls).toHaveLength(2)
})

test('receipt observation cannot use raw credentials or anonymous fallback', async () => {
  for (const options of [{ anonymous: true }, { creds: 'opaque' }]) {
    await expect(
      withResolvedClientSession(
        target,
        options,
        {} as AstraleConfig,
        async () => {},
        () => {
          throw new Error('must not open')
        },
        { principal: 'execution', receipt },
      ),
    ).rejects.toMatchObject({ code: 'EXECUTION_IDENTITY_REQUIRED' })
  }
})

test('a new CLI process reconstructs context from the receipt file without retained sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'astrale-execution-'))
  try {
    const file = join(directory, 'receipt.json')
    await writeFile(file, JSON.stringify(receipt))
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, 'fixtures/execution-observe.ts'), file],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      method: 'status',
      execution: 'execution-1',
      principal: 'domain',
      issuer: 'https://rotated.example',
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
