import { ResponseError } from '@astrale-os/sdk/client'
import { describe, expect, test } from 'bun:test'
import { stripVTControlCharacters } from 'node:util'

import type { LifecycleContext } from '../installation-result'

import { formatKernelError } from '../errors'
import {
  announcingLifecycle,
  conflictFailure,
  failureExitCode,
  IncompleteInstallation,
  OperationConflict,
  renderIncompleteInstallation,
  renderInterruptedWait,
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
    expect(text).toContain('Nothing ran for this command.')
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

describe('an uninstall refused for its remaining data says so in uninstall terms', () => {
  /** DATA_MIGRATION_REQUIRED as a beta.6 Kernel ends a safe uninstall, with `requirements`. */
  function refusedUninstall(requirements: readonly unknown[]) {
    return new IncompleteInstallation(
      installation('failed', {
        kind: 'failed',
        error: {
          code: 'DATA_MIGRATION_REQUIRED',
          message: 'Existing data requires an explicit migration before schema activation.',
          details: { previous: 'sha256:p', target: 'sha256:t', requirements, report: {} },
        },
      }),
      'uninstall',
    )
  }
  const item = { kind: 'definition', ref: { kind: 'class', name: 'Item', origin: 'qa.test' } }
  const uninstall = { ...CONTEXT, lifecycle: 'uninstall' as const }

  test('data a safe uninstall would delete: how much of which Class, delete it or --destructive', async () => {
    const error = refusedUninstall([
      {
        operation: 'remove-facts',
        reason: 'destructive-change',
        subject: item,
        work: { observedFacts: 1 },
      },
    ])
    const { text, json } = await shown((machine) =>
      renderIncompleteInstallation(error, machine, uninstall),
    )
    expect(text).toContain('DATA_MIGRATION_REQUIRED: Data of the Domains to uninstall remains.')
    expect(text).toContain('Item (qa.test): 1 fact remains.')
    expect(text).toContain(
      'A safe uninstall never deletes data: delete it, or uninstall with --destructive to delete it with the Domains.',
    )
    expect(text).toContain('nothing was uninstalled')
    expect(text).not.toContain('schema activation')
    // The machine document keeps the Kernel's own message and details.
    expect(json.message).toBe(
      'Existing data requires an explicit migration before schema activation.',
    )
  })

  /** The work of a Class above the bound one uninstall deletes: counts stop there. */
  const aboveBound = {
    maximumBytes: 10_000_000,
    maximumFacts: 10_000,
    observedBytes: 2_039_127,
    observedFacts: 10_001,
  }
  const remedy =
    'Delete facts of each such Class until at most 10000 facts and 10000000 bytes of it remain, ' +
    'then uninstall again (with --destructive to delete the rest with the Domains).'

  test('a safe uninstall above the bound: at least that much, and only the remedy that works', async () => {
    const error = refusedUninstall([
      { operation: 'remove-facts', reason: 'destructive-change', subject: item, work: aboveBound },
    ])
    const { text } = await shown((machine) =>
      renderIncompleteInstallation(error, machine, uninstall),
    )
    expect(text).toContain(
      'DATA_MIGRATION_REQUIRED: More data of the Domains to uninstall remains than one uninstall deletes.',
    )
    expect(text).toContain('Item (qa.test): at least 10001 facts remain.')
    expect(text).toContain(remedy)
    // --destructive alone is refused above the bound: never offered as the way out.
    expect(text).not.toContain('or uninstall with --destructive')
  })

  test('a destructive uninstall above the bound: the same count and remedy', async () => {
    const error = refusedUninstall([
      { operation: 'remove-facts', reason: 'budget-exceeded', subject: item, work: aboveBound },
    ])
    const { text } = await shown((machine) =>
      renderIncompleteInstallation(error, machine, uninstall),
    )
    expect(text).toContain('Item (qa.test): at least 10001 facts remain.')
    expect(text).toContain(remedy)
  })

  test('above the byte bound alone: at least that many bytes too', async () => {
    const error = refusedUninstall([
      {
        operation: 'remove-facts',
        reason: 'budget-exceeded',
        subject: item,
        work: { ...aboveBound, observedFacts: 40, observedBytes: 10_000_001 },
      },
    ])
    const { text } = await shown((machine) =>
      renderIncompleteInstallation(error, machine, uninstall),
    )
    expect(text).toContain('Item (qa.test): at least 40 facts (at least 10000001 bytes) remain.')
  })
})

describe('an install refused for its stored data summarizes the migration report', () => {
  const owner = (name: string) => ({ kind: 'class', name, origin: 'qa.test' })
  const facts = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      fact: { id: `0000000${index}-0000-4000-8000-000000000000`, kind: 'node' },
      property: 'qa.test:class.Item.property.category',
    }))
  const refused = new IncompleteInstallation(
    installation('failed', {
      kind: 'failed',
      error: {
        code: 'DATA_MIGRATION_REQUIRED',
        message: 'Existing data requires an explicit migration before schema activation.',
        details: {
          requirements: [
            {
              operation: 'populate-required',
              reason: 'invalid-existing',
              subject: { kind: 'property', key: 'qa.test:class.Item.property.category' },
              work: { observedFacts: 4 },
            },
          ],
          report: {
            complete: true,
            planned: 3,
            held: 1,
            truncated: false,
            rules: [
              {
                class: owner('Item'),
                property: 'qa.test:class.Item.property.category',
                family: 'required',
                reason: 'narrowed',
                verdict: 'refuted',
                count: { bound: 'exact', unit: 'facts', value: 4 },
                offenders: facts(4),
                truncated: false,
              },
              {
                class: owner('Item'),
                property: 'qa.test:class.Item.property.label',
                family: 'value',
                reason: 'narrowed',
                verdict: 'refuted',
                count: { bound: 'atLeast', unit: 'values', value: 2 },
                offenders: [{ observed: 'a label that is far too long' }, { observed: 'durable' }],
                truncated: true,
              },
            ],
          },
        },
      },
    }),
  )

  test('which rules break, how much data breaks each, the first offenders, and --mode maintenance', async () => {
    const { text, json } = await shown((machine) =>
      renderIncompleteInstallation(refused, machine, CONTEXT),
    )
    // The summary is the headline: the Kernel's message says the same, so a human reads it once.
    expect(text).toContain(
      'DATA_MIGRATION_REQUIRED: The stored data breaks 2 rules of the new schema:',
    )
    expect(text).not.toContain('schema activation')
    expect(text).toContain(
      'Item.category (qa.test): required, missing on 4 facts: 00000000-0000-4000-8000-000000000000, ' +
        '00000001-0000-4000-8000-000000000000, 00000002-0000-4000-8000-000000000000 and 1 more',
    )
    expect(text).toContain(
      'Item.label (qa.test): at least 2 values not allowed: "a label that is far too long", "durable" and more',
    )
    expect(text).toContain('Repair that data, then install again with a fresh operation.')
    expect(text).toContain(
      'Or repair it in a Root maintenance session, the Instance closed meanwhile: astrale domain install https://a.test -i app --mode maintenance',
    )
    // The machine document keeps the Kernel's message and the whole report in the status.
    expect(json.message).toBe(
      'Existing data requires an explicit migration before schema activation.',
    )
    expect(json.status).toMatchObject({
      outcome: { error: { details: { report: { planned: 3 } } } },
    })
  })

  test('a maintenance install is never told to open a maintenance session', async () => {
    const maintenance = {
      ...CONTEXT,
      recovery: { ...CONTEXT.recovery, fresh: `${CONTEXT.recovery.fresh} --mode maintenance` },
    }
    const { text } = await shown((machine) =>
      renderIncompleteInstallation(refused, machine, maintenance),
    )
    expect(text).not.toContain('Or repair it in a Root maintenance session')
  })
})

test('an interrupted wait tells a human the Execution continues and how to follow it', async () => {
  const lines: string[] = []
  const original = { log: console.log, error: console.error }
  console.log = console.error = (...values: unknown[]) => void lines.push(values.join(' '))
  try {
    renderInterruptedWait({ ...CONTEXT, started: 'execution-1' as never }, false)
    renderInterruptedWait({ ...CONTEXT, lifecycle: 'uninstall' }, false)
  } finally {
    Object.assign(console, original)
  }
  const text = stripVTControlCharacters(lines.join('\n'))
  expect(text).toContain('Stopped waiting: the install continues on the Kernel as execution-1.')
  expect(text).toContain(
    'Wait for it: astrale domain installation result execution-1 --wait-ms 20000 -i app',
  )
  expect(text).toContain(
    `Interrupted before the Kernel answered: if the uninstall reached it, it runs under operation ${CONTEXT.recovery.operation}.`,
  )
  expect(text).toContain(
    `Run it again with a fresh operation (refused while that uninstall runs): ${CONTEXT.recovery.fresh}`,
  )
  expect(text).not.toContain('--operation')
})

describe('a conflict says what to do next', () => {
  const refusal = (code: string, details: Record<string, string> = {}) =>
    new ResponseError(
      4001 as never,
      'Function execution conflicts with current state.',
      { source: 'https://kernel.test', id: 'conflict' } as never,
      { code, details } as never,
    )
  const uninstall = { ...CONTEXT, lifecycle: 'uninstall' as const }

  test('a conflict refuses this command: the request the operation names, and fresh', async () => {
    const conflict = new OperationConflict(
      refusal('SCHEMA_OPERATION_CONFLICT', {
        operation: CONTEXT.recovery.operation,
        execution: 'execution-9',
        mode: 'online',
      }),
      { execution: 'execution-9', lifecycle: 'install', mode: 'online', state: 'completed' },
    )
    const { text, json } = await shown((machine) =>
      formatKernelError(conflict, machine, undefined, false, { lifecycle: CONTEXT }),
    )
    const message =
      `Operation ${CONTEXT.recovery.operation} already names another request: ` +
      'execution-9 (online install, completed). Nothing ran for this command.'
    expect(text).toContain(`SCHEMA_OPERATION_CONFLICT: ${message}`)
    expect(text).toContain(
      "Read that request's run: astrale domain installation status execution-9 -i app",
    )
    expect(text).toContain(`Run this install with a fresh operation: ${CONTEXT.recovery.fresh}`)
    // Never that request's outcome, never the same operation again.
    expect(text).not.toContain('already ran')
    expect(text).not.toContain('--operation')
    expect(json).toMatchObject({
      reason: { code: 'SCHEMA_OPERATION_CONFLICT' },
      hint: message,
      operation: CONTEXT.recovery.operation,
      conflict: { execution: 'execution-9', mode: 'online', state: 'completed' },
      observe: 'astrale domain installation status execution-9 -i app',
      fresh: CONTEXT.recovery.fresh,
    })
    expect(json).not.toHaveProperty('execution')
    expect(failureExitCode(conflict)).toBe(5)
  })

  test('a conflict reads the request it names: an install by its mode, else an uninstall', async () => {
    const statuses: Record<string, string> = { 'execution-9': 'running' }
    const reads = (accept: 'install' | 'uninstall') => ({
      status: async (execution: string) => {
        if (accept === 'uninstall' && execution === 'execution-install') throw new TypeError()
        return { state: statuses[execution] ?? 'completed' }
      },
    })
    const schema = { installation: reads('install'), uninstallation: reads('uninstall') } as never
    const named = (details: Record<string, string>) =>
      conflictFailure(refusal('SCHEMA_OPERATION_CONFLICT', details), schema)
    expect(await named({ execution: 'execution-9', mode: 'maintenance' })).toMatchObject({
      other: {
        execution: 'execution-9',
        lifecycle: 'install',
        mode: 'maintenance',
        state: 'running',
      },
    })
    expect(await named({ execution: 'execution-u' })).toMatchObject({
      other: { execution: 'execution-u', lifecycle: 'uninstall', state: 'completed' },
    })
    expect(((await named({})) as OperationConflict).other).toBeUndefined()
    const other = refusal('SCHEMA_CHANGE_ACTIVE')
    expect(await conflictFailure(other, schema)).toBe(other)
  })

  test('outside install and uninstall, a key conflict gets no operation advice', async () => {
    const { json } = await shown((machine) =>
      formatKernelError(refusal('IDEMPOTENCY_KEY_CONFLICT'), machine),
    )
    expect(json).not.toHaveProperty('hint')
  })
})
