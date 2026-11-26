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
import {
  bundle,
  classIcon,
  defineSchema,
  func,
  method,
  nodeClass,
  onSchedule,
} from '@astrale-os/sdk/schema'
import { describe, expect, test } from 'bun:test'
import { stripVTControlCharacters } from 'node:util'
import { z } from 'zod'

import type { ServedDeployment } from '../../../lib/deployment/release'
import type { PrecheckRoot, ScheduleListing } from '../install-precheck'
import type { ReferenceInstallDependencies } from '../release-install'

import { captureProcess, human } from '../../__tests__/fixtures/process'
import { precheckSchedules } from '../install-precheck'
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

const durable = {
  auth: 'authorized',
  policy: false,
  input: z.object({ depth: z.enum(['quick', 'full']).optional() }),
  output: z.object({ removed: z.number() }),
  execution: { durable: true },
} as const

type Triggers = NonNullable<Parameters<typeof func>[0]['trigger']>

/**
 * The Jobs Bundle whose Functions and static Method `Ledger.sweep` declare these `onSchedule`
 * triggers, through the Bundle codec a Kernel serves it with.
 */
function jobsBundle(
  functions: Readonly<Record<string, Triggers>>,
  sweep?: Triggers,
): bundle.Bundle {
  const source = defineSchema(ORIGIN, {
    name: 'Jobs',
    classes: {
      Ledger: nodeClass({
        icon: classIcon.neutral,
        policies: { read: true },
        ...(sweep === undefined
          ? {}
          : { methods: { sweep: method({ ...durable, static: true, trigger: sweep }) } }),
      }),
    },
    functions: Object.fromEntries(
      Object.entries(functions).map(([name, trigger]) => [name, func({ ...durable, trigger })]),
    ),
  })
  return bundle.decode(bundle.encode(bundle.create(source)))
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

describe('precheckSchedules: what each root runs after the install', () => {
  test('compares the candidate with the active Bundle: new, changed, unchanged and removed', async () => {
    const active = jobsBundle(
      {
        digest: onSchedule({ cron: '0 7 * * mon-fri' }),
        prove: onSchedule({ cron: '*/5 * * * *' }),
        retired: onSchedule({ cron: '0 3 * * *' }),
      },
      onSchedule({ name: 'nightly', cron: '30 2 * * *', timezone: 'Europe/Paris' }),
    )
    const candidate = jobsBundle(
      {
        digest: onSchedule({ cron: '0 7 * * 1-5' }),
        prove: onSchedule({ cron: '0-59/5 * * * *', input: { depth: 'full' } }),
        recover: onSchedule({ cron: '*/15 * * * *', overlap: 'allow', maxDelay: 3600 }),
      },
      onSchedule({ name: 'nightly', cron: '30 3 * * *' }),
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
        // One calendar has one spelling: only the input of `prove` changed.
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
    const candidate = jobsBundle({ digest: onSchedule({ cron: '0 7 * * 1-5' }) })
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
    const candidate = jobsBundle({ digest: onSchedule({ cron: '0 7 * * 1-5' }) })
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
  const active = jobsBundle({ prove: onSchedule({ cron: '*/10 * * * *' }) })
  const candidate = jobsBundle({
    prove: onSchedule({ cron: '*/5 * * * *' }),
    recover: onSchedule({ cron: '*/15 * * * *' }),
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
