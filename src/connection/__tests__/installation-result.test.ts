import { ResponseError } from '@astrale-os/sdk/client'
import { describe, expect, test } from 'bun:test'
import { stripVTControlCharacters } from 'node:util'

import type { LifecycleContext } from '../installation-result'

import { formatKernelError } from '../errors'
import {
  announcingLifecycle,
  failureExitCode,
  IncompleteInstallation,
  renderIncompleteInstallation,
} from '../installation-result'
import { transportFailure } from './failure-fixtures'

function installation(state: string, outcome?: unknown, createdAt = '2026-10-11T21:55:37.000Z') {
  return {
    execution: 'execution-1',
    status: { id: 'execution-1', state, createdAt, ...(outcome === undefined ? {} : { outcome }) },
  } as never
}

const REFUSED = {
  kind: 'failed',
  error: { code: 'DATA_MIGRATION_REQUIRED', message: 'Repair stored data.' },
}

const CONTEXT: LifecycleContext = {
  lifecycle: 'install',
  recovery: {
    operation: 'eb306c1d-b42e-47cd-a9ff-c771344c65f5',
    fresh: 'astrale domain install https://a.test -i app',
    target: ['-i', 'app'],
  },
}

/** Everything a human reads, without styling, and the one JSON document a machine reads. */
async function shown(render: (machine: boolean) => unknown) {
  const lines: string[] = []
  const writes: string[] = []
  const original = { log: console.log, error: console.error, write: process.stderr.write }
  console.log = console.error = (...values: unknown[]) => void lines.push(values.join(' '))
  process.stderr.write = ((chunk: string) => {
    writes.push(chunk)
    return true
  }) as typeof process.stderr.write
  try {
    await render(false)
    await render(true)
  } finally {
    Object.assign(console, { log: original.log, error: original.error })
    process.stderr.write = original.write
  }
  return {
    text: stripVTControlCharacters(lines.join('\n')),
    json: JSON.parse(writes.join('')) as Record<string, unknown>,
  }
}

test('an installation that ended failed exits 2, the PRD exit of a rejected install', () => {
  expect(failureExitCode(new IncompleteInstallation(installation('failed', REFUSED)))).toBe(2)
  expect(
    failureExitCode(new IncompleteInstallation(installation('failed', REFUSED), 'uninstall')),
  ).toBe(2)
})

test('an unfinished, cancelled or non-installation failure keeps exit 1', () => {
  expect(failureExitCode(new IncompleteInstallation(installation('running')))).toBe(1)
  expect(
    failureExitCode(new IncompleteInstallation(installation('cancelled', { kind: 'cancelled' }))),
  ).toBe(1)
  expect(failureExitCode(new Error('transport failed'))).toBe(1)
})

test('the lifecycle names the Execution the Kernel answered before the Client waits for it', async () => {
  const started: string[] = []
  let finish = (_: unknown) => {}
  const outcome = new Promise((resolve) => (finish = resolve))
  const lifecycle = announcingLifecycle(
    {
      dispatch: async (call: { readonly target: unknown }) => {
        const target = String(call.target)
        if (target.includes('function.install'))
          return { kind: 'execution', execution: 'execution-1' }
        // The outcome arrives only once the test has seen the Execution announced.
        if (target.endsWith('.result')) return { kind: 'value', value: await outcome }
        return {
          kind: 'value',
          value: {
            id: 'execution-1',
            function: 'install-function',
            version: `sha256:${'a'.repeat(64)}`,
            state: 'failed',
            createdAt: '2026-10-11T21:55:37.000Z',
            outcome: REFUSED,
          },
        }
      },
    } as never,
    (execution) => started.push(execution),
  )
  const answer = lifecycle.install({ operation: CONTEXT.recovery.operation, domains: [] } as never)
  while (started.length === 0) await new Promise((resolve) => setTimeout(resolve, 1))
  expect(started).toEqual(['execution-1'])
  finish(REFUSED)
  expect((await answer).status).toMatchObject({ state: 'failed' })
})

describe('an Execution that ended used its operation', () => {
  test('a failure says so, with the command that reads it and the one that tries again', async () => {
    const error = new IncompleteInstallation(installation('failed', REFUSED))
    const { text, json } = await shown((machine) =>
      renderIncompleteInstallation(error, machine, CONTEXT),
    )
    expect(text).toContain('The install ran and was refused: nothing was installed.')
    expect(text).toContain(
      `operation: ${CONTEXT.recovery.operation} is used: this failure is its final outcome.`,
    )
    expect(text).toContain('Read this run: astrale domain installation status execution-1 -i app')
    expect(text).toContain(
      'Try again with a fresh operation: astrale domain install https://a.test -i app',
    )
    // Followed by its Execution, or tried again fresh: never the same operation again.
    expect(json).toMatchObject({
      error: 'DATA_MIGRATION_REQUIRED',
      execution: 'execution-1',
      operation: CONTEXT.recovery.operation,
      fresh: CONTEXT.recovery.fresh,
      observe: 'astrale domain installation status execution-1 -i app',
    })
    expect(json).not.toHaveProperty('target')
    expect(json).not.toHaveProperty('replay')
  })

  test('an unfinished Execution is followed by its id, never by its operation', async () => {
    const error = new IncompleteInstallation(installation('running'), 'uninstall')
    const { text, json } = await shown((machine) =>
      renderIncompleteInstallation(error, machine, { ...CONTEXT, lifecycle: 'uninstall' }),
    )
    expect(text).toContain(
      'Read this run: astrale domain installation status execution-1 --uninstall -i app',
    )
    expect(text).not.toContain('--operation')
    expect(json).not.toHaveProperty('fresh')
  })
})

describe('a failure before any outcome says whether an Execution exists', () => {
  const active = () =>
    new ResponseError(
      4001 as never,
      'A session or another install or uninstall is changing the schema; retry after it ends.',
      { source: 'https://kernel.test', id: 'install' } as never,
      { code: 'SCHEMA_CHANGE_ACTIVE', details: {} } as never,
    )

  test('a refusal at dispatch started nothing and left the operation unused', async () => {
    const { text, json } = await shown((machine) =>
      formatKernelError(active(), machine, undefined, false, { lifecycle: CONTEXT }),
    )
    expect(text).toContain('reason: SCHEMA_CHANGE_ACTIVE')
    expect(text).toContain(
      `Not started: the Kernel refused this install before creating an Execution, so operation ${CONTEXT.recovery.operation} was not used.`,
    )
    expect(text).toContain(`Run it again once that is resolved: ${CONTEXT.recovery.fresh}`)
    // Another schema change holds the Instance: the client spec's conflict code.
    expect(failureExitCode(active())).toBe(5)
    expect(json).toMatchObject({
      error: 'RESPONSE_ERROR',
      reason: { code: 'SCHEMA_CHANGE_ACTIVE' },
      execution: null,
      operation: CONTEXT.recovery.operation,
      fresh: CONTEXT.recovery.fresh,
    })
  })

  test('a conflict over the operation is never called an unused operation', async () => {
    const conflict = new ResponseError(
      4001 as never,
      'Function execution conflicts with current state.',
      { source: 'https://kernel.test', id: 'install' } as never,
      { code: 'IDEMPOTENCY_KEY_CONFLICT', details: {} } as never,
    )
    const { text, json } = await shown((machine) =>
      formatKernelError(conflict, machine, undefined, false, { lifecycle: CONTEXT }),
    )
    expect(text).not.toContain('not used')
    expect(json).not.toHaveProperty('execution')
  })

  test('an Execution that started and could not be read continues on the Kernel', async () => {
    const lost = transportFailure('Timed out.', 'timeout', {
      kind: 'invocation',
      delivery: 'unknown',
    })
    const started = { ...CONTEXT, started: 'execution-1' as never }
    const { text, json } = await shown((machine) =>
      formatKernelError(lost, machine, undefined, false, { lifecycle: started }),
    )
    expect(text).toContain(
      'The install started as execution-1 and continues on the Kernel; this command could not read how it ends.',
    )
    expect(text).toContain('Read this run: astrale domain installation status execution-1 -i app')
    expect(text).toContain(
      'Wait for it: astrale domain installation result execution-1 --wait-ms 20000 -i app',
    )
    expect(text).not.toContain('Delivery is unknown')
    expect(json).toMatchObject({
      error: 'TIMEOUT',
      execution: 'execution-1',
      operation: CONTEXT.recovery.operation,
      observe: 'astrale domain installation status execution-1 -i app',
      follow: 'astrale domain installation result execution-1 --wait-ms 20000 -i app',
    })
  })
})
