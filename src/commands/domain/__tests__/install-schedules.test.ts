import type {
  DomainBundle,
  InstalledRelease,
  InstallRequest,
  InstallResult,
} from '@astrale-os/sdk/client/schema'

import { ResponseError } from '@astrale-os/sdk/client'
import { compile } from '@astrale-os/sdk/deployment/build'
import { assemble } from '@astrale-os/sdk/deployment/release'
import { defineDomain } from '@astrale-os/sdk/domain'
import { defineRuntime } from '@astrale-os/sdk/runtime'
import { bundle, classIcon, defineSchema, nodeClass, schema } from '@astrale-os/sdk/schema'
import { describe, expect, test } from 'bun:test'
import { stripVTControlCharacters } from 'node:util'

import type { ServedDeployment } from '../../../lib/deployment/release'
import type { PrecheckRoot, ScheduleListing } from '../install-precheck'
import type { ReferenceInstallDependencies } from '../release-install'

import { captureProcess, human } from '../../__tests__/fixtures/process'
import { precheckSchedules, renderCron } from '../install-precheck'
import { scheduleLines } from '../install-schedules'
import { installByReference } from '../release-install'

/**
 * The schedules of an install (ADR-10): before it is sent, the CLI lists what each root declares
 * on the instance, compared with the active Bundle, and asks once at a terminal when one is new
 * or changed. The Kernel records no consent, so nothing refuses an install nobody can confirm.
 */

const ORIGIN = 'jobs.example.test'
const URL_R1 = 'https://jobs-r1.svc.schedules.test'
const URL_R2 = 'https://jobs-r2.svc.schedules.test'
const GENERATED = '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8'
const INVOCATION = {
  source: 'https://kernel.test',
  id: 'install-schedules',
} as ConstructorParameters<typeof ResponseError>[2]
const INTERACTIVE = { tty: true, env: {}, argv: [] }

const Jobs = defineSchema(ORIGIN, {
  name: 'Jobs',
  classes: { Ledger: nodeClass({ icon: classIcon.neutral, policies: { read: true } }) },
})

/** A trigger as an accepted Schema keeps it: canonical calendar, explicit name and zone. */
function trigger(
  name: string,
  calendar: Record<string, readonly number[]>,
  options: Record<string, unknown> = {},
) {
  return { kind: 'schedule', name, calendar, timezone: 'UTC', ...options }
}

/**
 * The Jobs Bundle with these triggers on its Functions and on the static Method `Ledger.sweep`.
 * The SDK this repository builds against cannot author a trigger yet, so the accepted shape is
 * written onto a sealed Bundle: the pre-check reads nothing else of these callables.
 */
function jobsBundle(
  functions: Readonly<Record<string, readonly unknown[]>>,
  sweep: readonly unknown[] = [],
): bundle.Bundle {
  const sealed = built(URL_R1).bundle
  const ledger = sealed.root.classes.Ledger!
  return {
    ...sealed,
    root: {
      ...sealed.root,
      functions: Object.fromEntries(
        Object.entries(functions).map(([name, triggers]) => [name, { trigger: triggers }]),
      ),
      classes: {
        Ledger: {
          ...ledger,
          methods: sweep.length === 0 ? {} : { sweep: { static: true, trigger: sweep } },
        },
      },
    },
  } as unknown as bundle.Bundle
}

interface Built {
  readonly url: string
  readonly bundle: bundle.Bundle
  readonly served: ServedDeployment
}

function built(url: string): Built {
  const runtime = defineRuntime<typeof Jobs>()({
    integrations: {},
    initialize: () => ({ providers: {} }),
    functions: [],
  })
  const build = compile(defineDomain({ schema: Jobs, runtime }))
  const document = assemble(build, `sha256:${'b'.repeat(64)}`, url).document
  return {
    url,
    bundle: bundle.decode(build.schema.bundle.bytes()),
    served: {
      origin: document.origin,
      issuer: document.identity.issuer,
      revision: document.schema.revision,
      pin: { kind: 'release', release: document.digest, build: document.build.digest },
      release: document,
    },
  }
}

const R1 = built(URL_R1)
const R2 = built(URL_R2)

/** Jobs installed from R1 at another revision than the candidate's, so its Bundle is read. */
const installedR1 = {
  origin: ORIGIN,
  revision: `sha256:${'c'.repeat(64)}`,
  issuer: URL_R1,
  url: URL_R1,
  pin: R1.served.pin,
  inFlight: [],
} as unknown as InstalledRelease

function absent(): ResponseError {
  return new ResponseError(3002 as never, 'Domain not found.', INVOCATION, {
    code: 'SCHEMA_NOT_FOUND',
    details: { origin: ORIGIN },
  })
}

function root(candidate: bundle.Bundle): Extract<PrecheckRoot, { kind: 'release' }> {
  return {
    kind: 'release',
    reference: URL_R2,
    origin: ORIGIN,
    release: R2.served.release,
    bundle: candidate,
  }
}

function activeKernel(active: bundle.Bundle | 'absent' | 'hidden') {
  const reads: string[] = []
  return {
    reads,
    bundle: async (origin: string) => {
      reads.push(origin)
      if (active === 'absent') throw absent()
      if (active === 'hidden') throw new Error('not readable')
      return { domain: { origin }, bundle: active } as unknown as DomainBundle
    },
  }
}

const DIGEST = { minute: [0], hour: [7], weekday: [1, 2, 3, 4, 5] }
const QUARTER = { minute: [0, 15, 30, 45] }

describe('renderCron: the Kernel text of a canonical calendar', () => {
  test('renders the vectors of kernel-dsl', () => {
    expect(renderCron({})).toBe('* * * * *')
    expect(renderCron({ minute: [0, 15, 30, 45] })).toBe('*/15 * * * *')
    expect(
      renderCron({ minute: [5, 10, 15, 20], hour: range(9, 1, 17), weekday: range(1, 1, 5) }),
    ).toBe('5-20/5 9-17 * * 1-5')
    expect(renderCron({ minute: [0], hour: [0, 12], day: [1, 2, 3, 15], month: [2] })).toBe(
      '0 0,12 1-3,15 2 *',
    )
    expect(renderCron({ day: range(1, 2, 31) })).toBe('* * */2 * *')
  })
})

describe('precheckSchedules: what each root runs after the install', () => {
  test('compares the candidate with the active Bundle: new, changed, unchanged and removed', async () => {
    const active = jobsBundle(
      {
        digest: [trigger('default', DIGEST)],
        prove: [trigger('default', { minute: range(0, 5, 55) })],
        retired: [trigger('default', { minute: [0], hour: [3] })],
      },
      [trigger('nightly', { minute: [30], hour: [2] }, { timezone: 'Europe/Paris' })],
    )
    const candidate = jobsBundle(
      {
        digest: [trigger('default', DIGEST)],
        prove: [trigger('default', { minute: range(0, 5, 55) }, { input: { depth: 'full' } })],
        recover: [trigger('default', QUARTER, { overlap: 'allow', maxDelay: 3600 })],
      },
      [trigger('nightly', { minute: [30], hour: [3] }, { timezone: 'UTC' })],
    )
    const kernel = activeKernel(active)

    const [listing] = await precheckSchedules([root(candidate)], [installedR1], kernel)

    expect(kernel.reads).toEqual([ORIGIN])
    expect(listing).toEqual({
      origin: ORIGIN,
      active: 'read',
      schedules: [
        {
          callable: 'Ledger.sweep',
          name: 'nightly',
          change: 'changed',
          declared: { cron: '30 3 * * *', timezone: 'UTC', overlap: 'skip', input: {} },
          previous: { cron: '30 2 * * *', timezone: 'Europe/Paris', overlap: 'skip', input: {} },
          changed: ['cron', 'timezone'],
        },
        {
          callable: 'digest',
          name: 'default',
          change: 'unchanged',
          declared: { cron: '0 7 * * 1-5', timezone: 'UTC', overlap: 'skip', input: {} },
        },
        expect.objectContaining({ callable: 'prove', change: 'changed', changed: ['input'] }),
        {
          callable: 'recover',
          name: 'default',
          change: 'added',
          declared: {
            cron: '*/15 * * * *',
            timezone: 'UTC',
            overlap: 'allow',
            maxDelay: 3600,
            input: {},
          },
        },
        {
          callable: 'retired',
          name: 'default',
          change: 'removed',
          previous: { cron: '0 3 * * *', timezone: 'UTC', overlap: 'skip', input: {} },
        },
      ],
    })
  })

  test('a first install lists every schedule as new; an unreadable Bundle says so', async () => {
    const candidate = jobsBundle({ digest: [trigger('default', DIGEST)] })
    const [first] = await precheckSchedules([root(candidate)], [], activeKernel('absent'))
    expect(first).toMatchObject({ active: 'absent', schedules: [{ change: 'added' }] })

    // Listed but not readable by this caller: the comparison is not made.
    const [hidden] = await precheckSchedules(
      [root(candidate)],
      [installedR1],
      activeKernel('hidden'),
    )
    expect(hidden).toMatchObject({ active: 'unread', schedules: [{ change: 'added' }] })
  })

  test('the active revision declares the same triggers: nothing is read, nothing is new', async () => {
    const candidate = jobsBundle({ digest: [trigger('default', DIGEST)] })
    const kernel = activeKernel('hidden')
    const current = { ...installedR1, revision: R2.served.release.schema.revision }

    const [listing] = await precheckSchedules([root(candidate)], [current], kernel)

    expect(kernel.reads).toEqual([])
    expect(listing).toMatchObject({ active: 'read', schedules: [{ change: 'unchanged' }] })
  })

  test('a root declaring no schedule before or after is not listed', async () => {
    const skipped: PrecheckRoot = { kind: 'skipped', reference: URL_R2, reason: 'bundle-unread' }
    expect(
      await precheckSchedules(
        [root(jobsBundle({})), skipped],
        [installedR1],
        activeKernel(jobsBundle({})),
      ),
    ).toEqual([])
  })
})

describe('the schedules an install shows', () => {
  test('one line per schedule: mark, callable, cron, zone and what changed', () => {
    const listing: ScheduleListing = {
      origin: ORIGIN,
      active: 'read',
      schedules: [
        {
          callable: 'proveBackups',
          name: 'default',
          change: 'changed',
          declared: { cron: '*/5 * * * *', timezone: 'UTC', overlap: 'allow', input: {} },
          previous: {
            cron: '*/10 * * * *',
            timezone: 'UTC',
            overlap: 'skip',
            maxDelay: 600,
            input: {},
          },
          changed: ['cron', 'overlap', 'maxDelay'],
        },
        {
          callable: 'reconcileDeletions',
          name: 'default',
          change: 'unchanged',
          declared: { cron: '*/5 * * * *', timezone: 'UTC', overlap: 'skip', input: {} },
        },
        {
          callable: 'recoverWorkOSEvents',
          name: 'default',
          change: 'added',
          declared: { cron: '*/15 * * * *', timezone: 'UTC', overlap: 'skip', input: {} },
        },
        {
          callable: 'Ledger.sweep',
          name: 'full',
          change: 'removed',
          previous: { cron: '30 3 * * 0', timezone: 'Europe/Paris', overlap: 'skip', input: {} },
        },
      ],
    }

    expect(scheduleLines(listing, 'prod').map(stripVTControlCharacters)).toEqual([
      `Schedules on prod, running as ${ORIGIN}:`,
      '  ~ proveBackups          */5 * * * *    UTC            was */10 * * * *; overlap allow, was skip; maxDelay none, was 10m',
      '    reconcileDeletions    */5 * * * *    UTC',
      '  + recoverWorkOSEvents   */15 * * * *   UTC            new',
      '  - Ledger.sweep/full     30 3 * * 0     Europe/Paris   removed',
    ])
  })
})

const io = captureProcess()

function completed(): InstallResult {
  return {
    changed: true,
    receipt: {
      operation: GENERATED,
      transitions: [
        {
          intent: {
            transition: 'transition-0',
            operation: GENERATED,
            origin: ORIGIN,
            previous: { origin: ORIGIN, revision: installedR1.revision, generation: 'g1' },
            generation: { origin: ORIGIN, revision: R2.served.revision, generation: 'g2' },
          },
          phase: 'cutover',
          state: 'committed',
        },
      ],
    },
  } as unknown as InstallResult
}

/** Jobs R1 installed with `active` as its Bundle; R2 served with `candidate`. */
function install(options: {
  readonly active: bundle.Bundle
  readonly candidate: bundle.Bundle
  readonly answer?: boolean
}) {
  const requests: InstallRequest[] = []
  const asked: string[] = []
  let listing: readonly InstalledRelease[] = [installedR1]
  const session = {
    schema: {
      installed: async () => listing,
      bundle: async (origin: string) =>
        ({ domain: { origin }, bundle: options.active }) as unknown as DomainBundle,
      inspect: async () => {
        throw absent()
      },
      dependencies: async (origin: string) => ({ domain: { origin }, dependencies: [] }),
      install: async (request: InstallRequest) => {
        requests.push(request)
        listing = [
          {
            ...installedR1,
            revision: R2.served.release.schema.revision,
            url: URL_R2,
            pin: R2.served.pin,
          },
        ]
        const result = completed()
        return {
          execution: 'execution-1',
          status: { state: 'completed', outcome: { kind: 'completed', value: result } },
          result,
        }
      },
    },
  }
  const deps: Partial<ReferenceInstallDependencies> = {
    createOperationId: () => GENERATED,
    withClientSession: (async (_opts: unknown, action: (context: never) => Promise<unknown>) =>
      action({ session } as never)) as unknown as ReferenceInstallDependencies['withClientSession'],
    lifecycle: (() => session.schema) as unknown as ReferenceInstallDependencies['lifecycle'],
    openRegistry: async () => {
      throw new Error('The registry is not read for a URL install the pre-check passes.')
    },
    readDeployment: async () => R2.served,
    readBundle: async () => options.candidate,
    ask: async (message) => {
      asked.push(message)
      return options.answer
    },
    now: () => 0,
    sleep: async () => {},
  }
  return { deps, requests, asked }
}

describe('install: schedules are shown, and confirmed when new or changed', () => {
  const active = jobsBundle({ prove: [trigger('default', { minute: range(0, 10, 50) })] })
  const candidate = jobsBundle({
    prove: [trigger('default', { minute: range(0, 5, 55) })],
    recover: [trigger('default', QUARTER)],
  })
  // The served revision differs from the installed one, so the issuer stays and nothing else asks.
  const opts = { instance: 'prod', allowIssuerChange: [ORIGIN], ...INTERACTIVE } as never

  test('at a terminal, the listing comes before one question; a decline sends nothing', async () => {
    const run = install({ active, candidate, answer: false })

    const output = await human(async () => {
      await expect(installByReference([URL_R2], opts, run.deps)).rejects.toThrow('process.exit(1)')
    })

    expect(output.lines).toContain(`Schedules on prod, running as ${ORIGIN}:`)
    expect(output.lines).toContain('~ prove     */5 * * * *    UTC   was */10 * * * *')
    expect(output.lines).toContain('+ recover   */15 * * * *   UTC   new')
    expect(run.asked).toEqual([`Install ${ORIGIN} with 1 new and 1 changed schedule?`])
    expect(output.all).toContain('SCHEDULES_NOT_CONFIRMED')
    expect(run.requests).toHaveLength(0)
  })

  test('a confirmation, or --yes, sends the install', async () => {
    const confirmed = install({ active, candidate, answer: true })
    await human(() => installByReference([URL_R2], opts, confirmed.deps))
    expect(confirmed.asked).toHaveLength(1)
    expect(confirmed.requests).toHaveLength(1)

    const yes = install({ active, candidate })
    await human(() =>
      installByReference([URL_R2], { ...(opts as object), yes: true } as never, yes.deps),
    )
    expect(yes.asked).toEqual([])
    expect(yes.requests).toHaveLength(1)
  })

  test('nothing is asked for schedules that are only unchanged or removed', async () => {
    const run = install({ active, candidate: jobsBundle({}) })
    const output = await human(() => installByReference([URL_R2], opts, run.deps))
    expect(output.lines).toContain('- prove   */10 * * * *   UTC   removed')
    expect(run.asked).toEqual([])
    expect(run.requests).toHaveLength(1)
  })

  test('--json asks nothing and reports the schedules in the pre-check', async () => {
    const run = install({ active, candidate })

    await installByReference(
      [URL_R2],
      { json: true, instance: 'prod', allowIssuerChange: [ORIGIN] },
      run.deps,
    )

    expect(run.asked).toEqual([])
    expect(run.requests).toHaveLength(1)
    const report = JSON.parse(io.stdout) as { precheck: { schedules: unknown } }
    expect(report.precheck.schedules).toEqual([
      {
        origin: ORIGIN,
        active: 'read',
        schedules: [
          expect.objectContaining({ callable: 'prove', change: 'changed', changed: ['cron'] }),
          expect.objectContaining({ callable: 'recover', change: 'added' }),
        ],
      },
    ])
  })
})

function range(first: number, step: number, last: number): readonly number[] {
  return Array.from(
    { length: Math.floor((last - first) / step) + 1 },
    (_, index) => first + index * step,
  )
}
