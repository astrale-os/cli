import type {
  Installation,
  InstalledRelease,
  InstallRequest,
  InstallResult,
} from '@astrale-os/sdk/client/schema'

import { ResponseError } from '@astrale-os/sdk/client'
import { createSchema } from '@astrale-os/sdk/client/schema'
import { defineSchema, schema } from '@astrale-os/sdk/schema'
import { describe, expect, test } from 'bun:test'
import { Command } from 'commander'

import type { ServedDeployment } from '../../../lib/deployment/release'
import type { ReferenceInstallDependencies } from '../release-install'

import { deploymentReleaseFor } from '../../../__tests__/fixtures/publication'
import { connectAdminRegistry } from '../../../admin/registry'
import {
  fakeAdmin,
  publication,
  release,
  type FakeDomain,
  type FakeRelease,
} from '../../../admin/registry/__tests__/fake-admin'
import { transportFailure } from '../../../connection/__tests__/failure-fixtures'
import { DeploymentReadError } from '../../../lib/deployment/release'
import { registerCommand } from '../../../program/registry'
import { captureProcess, ExitError, human } from '../../__tests__/fixtures/process'
import { admitIssuerChanges, issuerChangeConsent, issuerChangeLine } from '../issuer-consent'
import { installByReference } from '../release-install'

const GENERATED = '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8'
const RETRY = '139137b5-af47-47ce-92b2-b64a2b0c63d7'
const INVOCATION = {
  source: 'https://kernel.test',
  id: 'domain-install',
} as ConstructorParameters<typeof ResponseError>[2]
const AGENCIES = 'agencies.test'
const REVISION = schema.revision(defineSchema(AGENCIES, { name: 'Test Domain' }))
const digest = (seed: string) => `sha256:${seed.repeat(64)}` as const
const JSON_OUTPUT = { json: true } as const

const A = 'https://agencies-production-0123456789abcdef.deployments.test'
const B = 'https://employees-production-fedcba9876543210.deployments.test'
/** Immutable deployments of one line, of another line, and a pre-line issuer of the same origin. */
const LINE = 'agencies-aaaaaaaaaaaaaaaa'
const A1 = `https://${LINE}-bbbbbbbbbbbbbbbb.deployments.test`
const A2 = `https://${LINE}-cccccccccccccccc.deployments.test`
const A_OTHER_LINE = 'https://agencies-dddddddddddddddd-bbbbbbbbbbbbbbbb.deployments.test'
const A_UNLINED = 'https://agencies-v3.unlined.test'

const io = captureProcess()

function served(origin: string, url: string, seed: string): ServedDeployment {
  return {
    origin,
    issuer: url,
    revision: REVISION,
    pin: { kind: 'release', release: digest(seed), build: digest('b') },
    release: deploymentReleaseFor(defineSchema(origin, { name: 'Test Domain' }), url).document,
  }
}

/** What a published fake release serves at its deployment URL. */
function servedRelease(source: FakeRelease, origin = AGENCIES): ServedDeployment {
  return {
    ...served(origin, source.url, '0'),
    pin: { kind: 'release', release: source.releaseDigest, build: source.buildDigest },
  }
}

function installedFrom(deployment: ServedDeployment, url = deployment.issuer): InstalledRelease {
  return {
    origin: deployment.origin,
    revision: deployment.revision,
    issuer: deployment.issuer,
    url: new URL(url).origin,
    pin: deployment.pin,
    inFlight: [],
  } as unknown as InstalledRelease
}

const EXECUTION = 'execution-install-1'

/** An install that ended without a result, in `state` with `outcome` when terminal. */
function unsettled(state: string, outcome?: unknown): Installation {
  return {
    execution: EXECUTION,
    status: { id: EXECUTION, state, ...(outcome === undefined ? {} : { outcome }) },
  } as unknown as Installation
}

function committed(
  origins: readonly string[],
  replaced: readonly string[] = [],
  operation = GENERATED,
): InstallResult {
  return {
    changed: true,
    receipt: {
      operation,
      transitions: origins.map((origin, index) => ({
        intent: {
          transition: `transition-${index}`,
          operation,
          origin,
          previous: replaced.includes(origin)
            ? { origin, revision: REVISION, generation: digest('f') }
            : null,
          generation: { origin, revision: REVISION, generation: digest(String(index)) },
        },
        phase: 'cutover',
        state: 'committed',
      })),
    },
  } as unknown as InstallResult
}

/** The Kernel's refusal of its own failed read of a deployment: empty details, like a backend failure. */
const backendUnavailable = () =>
  new ResponseError(5001 as never, 'Schema backend is unavailable.', INVOCATION, {
    code: 'SCHEMA_BACKEND_FAILED',
    details: {},
  })

const releases = {
  v150: release('agencies-v150'),
  v151: release('agencies-v151'),
  v152: release('agencies-v152'),
  v160rc: release('agencies-v160rc'),
  v200rc: release('agencies-v200rc'),
  v300: release('agencies-v300'),
}

/** 1.5.2 is yanked; 1.6.x and 2.0.x have pre-releases only; 3.0.0 is the only (yanked) 3.0.x. */
function agenciesRegistry(): FakeDomain {
  return {
    id: 'domain-agencies',
    origin: AGENCIES,
    admins: new Set(['publisher']),
    installers: new Set(['installer']),
    publications: [
      publication('150', '1.5.0', releases.v150),
      publication('151', '1.5.1', releases.v151),
      publication('152', '1.5.2', releases.v152, { yankedAt: '2026-10-04T11:00:00.000Z' }),
      publication('160', '1.6.0-rc.1', releases.v160rc),
      publication('200', '2.0.0-rc.1', releases.v200rc),
      publication('300', '3.0.0', releases.v300, { yankedAt: '2026-10-04T11:30:00.000Z' }),
    ],
  }
}

const everyRelease = Object.fromEntries(
  Object.values(releases).map((entry) => [entry.url, servedRelease(entry)]),
)

/**
 * One install against a fake instance Kernel session and a fake Admin registry. `served` is what
 * each deployment URL serves (absent: unreadable); `listing` answers each installed-releases read.
 */
function harness(
  options: {
    readonly served?: Readonly<Record<string, ServedDeployment | (() => Promise<ServedDeployment>)>>
    readonly listing?: (call: number) => Promise<readonly InstalledRelease[]>
    readonly lifecycle?: (request: InstallRequest) => Promise<Installation>
    readonly installation?: Installation
    /** What `installation.status` answers for each Execution id. */
    readonly executions?: Readonly<Record<string, unknown>>
    readonly install?: (request: InstallRequest) => Promise<InstallResult>
    readonly inspect?: (origin: string) => Promise<unknown>
    readonly now?: () => number
    readonly caller?: string
    readonly registry?: 'down'
    readonly domain?: FakeDomain
  } = {},
) {
  const admin = fakeAdmin({
    caller: options.caller ?? 'installer',
    domains: [options.domain ?? agenciesRegistry()],
  })
  const run = {
    requests: [] as InstallRequest[],
    credentials: [] as unknown[],
    reads: [] as string[],
    sleeps: [] as number[],
    registries: 0,
    queries: () => admin.queries.length,
    deps: {} as Partial<ReferenceInstallDependencies>,
  }
  let listings = 0
  const session = {
    schema: {
      installed: async () => options.listing?.(listings++) ?? (listings++, []),
      install: async (request: InstallRequest) => {
        run.requests.push(request)
        if (options.lifecycle !== undefined) return options.lifecycle(request)
        if (options.installation !== undefined) return options.installation
        const result = await (options.install ?? (async () => committed([AGENCIES])))(request)
        return completedInstallation(result)
      },
      inspect: async (origin: string) =>
        options.inspect?.(origin) ?? { origin, revision: REVISION, generation: digest('e') },
      installation: {
        status: async (execution: string) => {
          run.reads.push(`status ${execution}`)
          const status = options.executions?.[execution]
          if (status === undefined) throw new Error(`No Execution ${execution}`)
          return status
        },
      },
    },
  }
  run.deps = {
    createOperationId: () => GENERATED,
    withClientSession: (async (
      _opts: unknown,
      action: (context: never) => Promise<unknown>,
      credential: unknown,
    ) => {
      run.credentials.push(credential)
      return action({ session } as never)
    }) as unknown as ReferenceInstallDependencies['withClientSession'],
    // The fake Kernel answers the whole install at once: the Execution it names was started.
    lifecycle: ((fake: typeof session, started: (execution: string) => void) => ({
      install: async (request: InstallRequest) => {
        const answer = await fake.schema.install(request)
        started(answer.execution)
        return answer
      },
    })) as unknown as ReferenceInstallDependencies['lifecycle'],
    openRegistry: async (_opts, work) => {
      run.registries += 1
      if (options.registry === 'down') {
        throw transportFailure('Admin is unreachable.', 'connect', {
          kind: 'invocation',
          delivery: 'not-sent',
        })
      }
      return work(connectAdminRegistry(admin.context))
    },
    readDeployment: async (url: string) => {
      run.reads.push(url)
      const answer = options.served?.[url]
      if (answer === undefined) throw new DeploymentReadError(`GET ${url} failed.`)
      return typeof answer === 'function' ? answer() : answer
    },
    // Offline, the advisory pre-check reads every bundle as unreachable.
    readBundle: async (_release, url) => {
      throw new DeploymentReadError(`GET ${url} bundle failed.`)
    },
    now: options.now ?? (() => 0),
    sleep: async (ms: number) => void run.sleeps.push(ms),
  }
  return run
}

/** agencies.test installed from `from` until an install commits it from `to`. */
function moving(from: string, to: string) {
  const target = served(AGENCIES, to, '2')
  let moved = false
  return harness({
    served: { [to]: target },
    listing: async () => [installedFrom(moved ? target : served(AGENCIES, from, '1'))],
    install: async () => {
      moved = true
      return committed([AGENCIES], [AGENCIES])
    },
  })
}

async function refused(
  references: readonly [string, ...string[]],
  opts: Parameters<typeof installByReference>[1],
  run: ReturnType<typeof harness>,
): Promise<ReturnType<typeof io.failure>> {
  await expect(installByReference(references, opts, run.deps)).rejects.toBeInstanceOf(ExitError)
  return io.failure()
}

describe('install by URL', () => {
  test('reports an install that ended without a result by its reason or its Execution', async () => {
    const refusal = { code: 'SCHEMA_MIGRATION_REQUIRED', message: 'A migration is required.' }
    for (const [answer, expected] of [
      [
        unsettled('failed', { kind: 'failed', error: refusal }),
        { error: refusal.code, message: refusal.message },
      ],
      [
        unsettled('running'),
        {
          error: 'INSTALLATION_PENDING',
          message: `Installation ${EXECUTION} is running.`,
          execution: EXECUTION,
          status: { state: 'running' },
        },
      ],
      [unsettled('cancelled', { kind: 'cancelled' }), { error: 'INSTALLATION_CANCELLED' }],
    ] as const) {
      const run = harness({
        served: { [A]: served(AGENCIES, A, '1') },
        installation: answer,
      })
      expect(await refused([A], JSON_OUTPUT, run)).toMatchObject(expected)
    }
  })

  test('guards each URL by the digest it serves and installs all of them atomically, in order', async () => {
    const a = served(AGENCIES, A, '1')
    const b = served('employees.test', B, '2')
    const previousB = { ...installedFrom(b), pin: { ...b.pin, release: digest('9') } }
    const run = harness({
      served: { [A]: a, [B]: b },
      listing: async (call) => (call === 0 ? [previousB] : [installedFrom(a), installedFrom(b)]),
      install: async () => committed(['employees.test', AGENCIES]),
    })

    await installByReference([B, A], JSON_OUTPUT, run.deps)

    expect(run.credentials).toEqual([{ principal: 'caller' }])
    expect(run.requests).toEqual([
      {
        operation: GENERATED,
        domains: [
          { release: { url: B, digest: digest('2') } },
          { release: { url: A, digest: digest('1') } },
        ],
      } as never,
    ])
    const report = JSON.parse(io.stdout)
    expect(report.references).toEqual([
      {
        reference: B,
        origin: 'employees.test',
        url: B,
        pin: b.pin,
        previous: { revision: REVISION, pin: previousB.pin, issuer: B },
        installed: { revision: REVISION, pin: b.pin, issuer: B },
      },
      {
        reference: A,
        origin: AGENCIES,
        url: A,
        pin: a.pin,
        previous: null,
        installed: { revision: REVISION, pin: a.pin, issuer: A },
      },
    ])
    expect(report.precheck.skipped).toEqual([
      { reference: B, reason: 'bundle-unread' },
      { reference: A, reason: 'bundle-unread' },
    ])
    expect(report).not.toHaveProperty('recovered')
    expect(report.precheck).not.toHaveProperty('command')
  })

  test('prints one line per root, its status read from the Kernel receipt', async () => {
    const a = served(AGENCIES, A, '1')
    const b = served('employees.test', B, '2')
    const previousB = { ...installedFrom(b), pin: { ...b.pin, release: digest('9') } }
    const run = harness({
      served: { [A]: a, [B]: b },
      listing: async (call) =>
        call === 0 ? [installedFrom(a), previousB] : [installedFrom(a), installedFrom(b)],
      install: async () => committed(['employees.test'], ['employees.test']),
    })

    const { lines } = await human(() => installByReference([A, B], {}, run.deps))

    expect(lines).toContain(`Domains installed (operation ${GENERATED})`)
    expect(lines).toContain('  agencies.test   unchanged  release sha256:111111111111\n')
    expect(lines).toContain(
      '  employees.test  replaced   release sha256:222222222222 (was release sha256:999999999999)',
    )
  })

  test('refuses two references to one origin before anything is sent', async () => {
    const twoDeployments = harness({
      served: { [A]: served(AGENCIES, A, '1'), [B]: served(AGENCIES, B, '2') },
    })
    expect(await refused([A, B], JSON_OUTPUT, twoDeployments)).toMatchObject({
      error: 'DUPLICATE_ORIGIN',
    })
    expect(twoDeployments.requests).toEqual([])

    const sameUrl = harness()
    expect(await refused([A, `${A}/`], JSON_OUTPUT, sameUrl)).toMatchObject({
      error: 'DUPLICATE_ORIGIN',
    })
    expect(sameUrl.credentials).toEqual([])
  })

  test.each([
    [['https://CRM.example.test'], {}, 'INVALID_DOMAIN_URL'],
    [[A], { operation: 'guessable-operation' }, 'INVALID_FLAG'],
    [[A, B], { token: 'secret' }, 'INVALID_FLAG'],
    [[`${AGENCIES}@1.5`], { token: 'secret' }, 'INVALID_FLAG'],
  ] as const)('refuses %j %j before any install (%s)', async (references, opts, error) => {
    const run = harness()
    expect(await refused(references, { ...JSON_OUTPUT, ...opts }, run)).toMatchObject({ error })
    expect(run.requests).toEqual([])
    expect(run.registries).toBe(0)
  })

  test('installs an unreadable deployment with its token, without a digest, and reports the Kernel pin', async () => {
    const a = served(AGENCIES, A, '1')
    const run = harness({ listing: async (call) => (call === 0 ? [] : [installedFrom(a)]) })

    // An unreadable deployment names no origin, so an origin-scoped consent is not refused.
    await installByReference(
      [A],
      { ...JSON_OUTPUT, token: 'secret', allowIssuerChange: ['crm.test'] },
      run.deps,
    )

    expect(run.requests[0]!.domains).toEqual([{ release: { url: A, token: 'secret' } }])
    expect(JSON.parse(io.stdout).references[0]).toMatchObject({
      origin: AGENCIES,
      pin: null,
      installed: { pin: a.pin },
    })
  })

  test('reads a deployment that is not serving yet again, then installs it once', async () => {
    const a = served(AGENCIES, A, '1')
    let reads = 0
    const run = harness({
      served: {
        [A]: async () => {
          if (++reads < 3) throw new DeploymentReadError('503', { status: 503, retryAfter: '2' })
          return a
        },
      },
    })

    await installByReference([A], JSON_OUTPUT, run.deps)

    expect(run.sleeps).toEqual([2_000, 2_000])
    expect(run.requests).toEqual([
      { operation: GENERATED, domains: [{ release: { url: A, digest: digest('1') } }] } as never,
    ])
  })

  test('never sends again an install the Kernel refused', async () => {
    const run = harness({
      served: { [A]: served(AGENCIES, A, '1') },
      install: async () => {
        throw backendUnavailable()
      },
    })

    expect(await refused([A], JSON_OUTPUT, run)).toMatchObject({
      error: 'RESPONSE_ERROR',
      code: 5001,
      reason: { code: 'SCHEMA_BACKEND_FAILED' },
    })
    expect(run.requests).toHaveLength(1)
    expect(run.sleeps).toEqual([])
  })

  test('exits with a refused installed-list read and installs nothing', async () => {
    const run = harness({
      served: { [A]: served(AGENCIES, A, '1') },
      listing: async () => {
        throw new ResponseError(1003 as never, 'Function input is invalid.', INVOCATION, {
          code: 'FUNCTION_INPUT_INVALID',
          details: {},
        })
      },
    })

    expect(await refused([A], JSON_OUTPUT, run)).toMatchObject({
      error: 'RESPONSE_ERROR',
      code: 1003,
      reason: { code: 'FUNCTION_INPUT_INVALID' },
    })
    expect(run.reads).toEqual([])
    expect(run.requests).toEqual([])
  })

  test('tells a human that a URL claims an origin it does not host (AM-19)', async () => {
    const run = harness({ served: { [A]: served(AGENCIES, A, '1') } })

    const { warnings } = await human(() => installByReference([A], {}, run.deps))

    expect(warnings).toContain(`origin ${AGENCIES} claimed by unverified deployment ${A}`)
    expect(run.requests).toHaveLength(1)
  })

  test('fails when the Kernel reports another pin than the one read before the install', async () => {
    const a = served(AGENCIES, A, '1')
    const run = harness({
      served: { [A]: a },
      listing: async (call) =>
        call === 0 ? [] : [{ ...installedFrom(a), pin: { ...a.pin, release: digest('7') } }],
    })

    expect(await refused([A], JSON_OUTPUT, run)).toMatchObject({ error: 'INSTALLED_PIN_MISMATCH' })
    expect(JSON.parse(io.stdout).references[0].installed.pin.release).toBe(digest('7'))
  })
})

describe('install by version', () => {
  test('@1.5 installs the highest stable 1.5.x that is not yanked, guarded by its release digest', async () => {
    const v151 = servedRelease(releases.v151)
    const run = harness({
      served: everyRelease,
      listing: async (call) => (call === 0 ? [] : [installedFrom(v151)]),
    })

    await installByReference([`${AGENCIES}@1.5`], JSON_OUTPUT, run.deps)

    // One index read: the Publications in one Query.
    expect(run.registries).toBe(1)
    expect(run.queries()).toBe(1)
    expect(run.reads).toEqual([releases.v151.url])
    expect(run.requests[0]!.domains).toEqual([
      { release: { url: releases.v151.url, digest: releases.v151.releaseDigest } },
    ] as never)
    expect(JSON.parse(io.stdout).references).toEqual([
      {
        reference: `${AGENCIES}@1.5`,
        origin: AGENCIES,
        url: releases.v151.url,
        version: '1.5.1',
        pin: v151.pin,
        previous: null,
        installed: { revision: REVISION, pin: v151.pin, issuer: releases.v151.url },
      },
    ])
  })

  test.each([
    ['@2.0.0-rc.1', { version: '2.0.0-rc.1' }],
    ['@1.5.2', { version: '1.5.2', yanked: true }],
  ] as const)('an exact version %s installs that version', async (selector, reference) => {
    const run = harness({ served: everyRelease })
    await installByReference([`${AGENCIES}${selector}`], JSON_OUTPUT, run.deps)
    expect(JSON.parse(io.stdout).references[0]).toEqual(expect.objectContaining(reference))
    if (!('yanked' in reference)) {
      expect(JSON.parse(io.stdout).references[0]).not.toHaveProperty('yanked')
    }
  })

  test.each([
    ['@1.6', 'no-stable-match'],
    ['@3.0', 'yanked-only'],
    ['@1.5.9', 'unknown-version'],
  ] as const)('%s resolves to nothing: VERSION_UNRESOLVED (%s)', async (selector, reason) => {
    const run = harness()
    expect(await refused([`${AGENCIES}${selector}`], JSON_OUTPUT, run)).toMatchObject({
      error: 'VERSION_UNRESOLVED',
      details: { origin: AGENCIES, reference: `${AGENCIES}${selector}`, reason },
    })
    expect(run.credentials).toEqual([])
  })

  test.each([
    [[`${AGENCIES}@1`], 'PUBLICATION_VERSION_INVALID'],
    [[`${AGENCIES}@^1.5`], 'PUBLICATION_VERSION_INVALID'],
    [['agencies@1.5.0'], 'INVALID_ARGUMENT'],
    [['HTTPS://agencies.test@1.5'], 'INVALID_ARGUMENT'],
    [[`${AGENCIES}@1.5`, `${AGENCIES}@1.5.0`], 'DUPLICATE_ORIGIN'],
  ] as const)('refuses %j before Admin is opened (%s)', async (references, error) => {
    const run = harness()
    expect(await refused(references, JSON_OUTPUT, run)).toMatchObject({ error })
    expect(run.registries).toBe(0)
    expect(run.credentials).toEqual([])
  })

  test('versions and URLs mix in one atomic install, in the order written', async () => {
    const employees = release('employees-url')
    const run = harness({
      served: { ...everyRelease, [employees.url]: servedRelease(employees, 'employees.test') },
      install: async () => committed(['employees.test', AGENCIES]),
    })

    await installByReference([employees.url, `${AGENCIES}@1.5`], JSON_OUTPUT, run.deps)

    expect(run.requests[0]!.domains).toEqual([
      { release: { url: employees.url, digest: employees.releaseDigest } },
      { release: { url: releases.v151.url, digest: releases.v151.releaseDigest } },
    ] as never)
    const references = JSON.parse(io.stdout).references as Record<string, unknown>[]
    expect(references.map(({ reference }) => reference)).toEqual([employees.url, `${AGENCIES}@1.5`])
    expect(references[0]).not.toHaveProperty('version')
  })

  test('an Admin that cannot answer or show the Domain fails version references only, before any Kernel call', async () => {
    // A caller without domain_installer reads the Domain as absent.
    const outsider = harness({ caller: 'outsider' })
    expect(await refused([`${AGENCIES}@1.5`], JSON_OUTPUT, outsider)).toMatchObject({
      error: 'REGISTRY_DOMAIN_NOT_FOUND',
      details: { origin: AGENCIES },
    })
    expect(outsider.credentials).toEqual([])

    const versions = harness({ registry: 'down' })
    expect(await refused([`${AGENCIES}@1.5`], JSON_OUTPUT, versions)).toMatchObject({
      error: 'REGISTRY_UNAVAILABLE',
      details: { reason: 'transport' },
    })
    expect(versions.credentials).toEqual([])

    const urls = harness({ registry: 'down', served: everyRelease })
    await installByReference([releases.v151.url], JSON_OUTPUT, urls.deps)
    expect(urls.registries).toBe(0)
    expect(urls.requests).toHaveLength(1)
  })

  test('a version and a URL naming one deployment are refused after the registry read', async () => {
    const run = harness({ served: everyRelease })
    expect(await refused([releases.v151.url, `${AGENCIES}@1.5`], JSON_OUTPUT, run)).toMatchObject({
      error: 'DUPLICATE_ORIGIN',
    })
    expect(run.registries).toBe(1)
    expect(run.credentials).toEqual([])
  })

  test('a Publication that names no installable deployment is refused, never installed', async () => {
    const queried = { ...releases.v151, url: `${releases.v151.url}/?preview=1` }
    const run = harness({
      domain: { ...agenciesRegistry(), publications: [publication('151', '1.5.1', queried)] },
    })

    expect(await refused([`${AGENCIES}@1.5`], JSON_OUTPUT, run)).toMatchObject({
      error: 'REGISTRY_UNAVAILABLE',
      details: { reason: 'response-invalid', reference: `${AGENCIES}@1.5`, version: '1.5.1' },
    })
    expect(run.credentials).toEqual([])
  })

  test('refuses a deployment that no longer serves the release its Publication names', async () => {
    const run = harness({ served: { [releases.v151.url]: servedRelease(releases.v150) } })

    expect(await refused([`${AGENCIES}@1.5`], JSON_OUTPUT, run)).toMatchObject({
      error: 'PUBLICATION_RELEASE_MISMATCH',
      details: {
        version: '1.5.1',
        expected: releases.v151.releaseDigest,
        served: releases.v150.releaseDigest,
      },
    })
    expect(run.requests).toEqual([])
  })

  test('an unknown outcome names the operation, and a fresh run of the exact version, consents and targets', async () => {
    const run = harness({
      served: everyRelease,
      listing: async () => [installedFrom(servedRelease(releases.v150))],
      install: async () => {
        throw transportFailure('Invocation outcome is unknown.', 'unknown', {
          kind: 'invocation',
          delivery: 'unknown',
        })
      },
    })

    const failure = await refused(
      [`${AGENCIES}@1.5`],
      {
        ...JSON_OUTPUT,
        operation: RETRY,
        allowIssuerChange: [AGENCIES],
        revokePrevious: true,
        instance: 'acme-prod',
        adminUrl: 'https://admin.test/api',
      },
      run,
    )
    expect(String(run.requests[0]!.operation)).toBe(RETRY)
    expect(failure).toMatchObject({
      operation: RETRY,
      fresh:
        `astrale domain install ${AGENCIES}@1.5.1 ` +
        `--allow-issuer-change=${AGENCIES} --revoke-previous -i acme-prod --admin-url https://admin.test/api`,
    })
    expect(failure).not.toHaveProperty('replay')
  })
})

describe('issuer changes need consent, planned from readable installations', () => {
  test('one refusal names every unconsented change of an install, before anything is sent', async () => {
    const B1 = 'https://employees-eeeeeeeeeeeeeeee-bbbbbbbbbbbbbbbb.deployments.test'
    const B_OTHER = 'https://employees-ffffffffffffffff-cccccccccccccccc.deployments.test'
    const run = harness({
      served: {
        [A2]: served(AGENCIES, A2, '2'),
        [B_OTHER]: served('employees.test', B_OTHER, '3'),
      },
      listing: async () => [
        installedFrom(served(AGENCIES, A1, '1')),
        installedFrom(served('employees.test', B1, '4')),
      ],
    })

    expect(await refused([A2, B_OTHER], JSON_OUTPUT, run)).toMatchObject({
      error: 'ISSUER_CHANGE_NOT_CONSENTED',
      details: {
        origins: [
          { origin: AGENCIES, installed: A1, replacement: A2, line: 'same' },
          { origin: 'employees.test', installed: B1, replacement: B_OTHER, line: 'cross' },
        ],
      },
    })
    // The bare flag consents to the same-line change only.
    io.stderr = ''
    const partial = await refused([A2, B_OTHER], { ...JSON_OUTPUT, allowIssuerChange: [''] }, run)
    expect(partial.details.origins).toEqual([
      { origin: 'employees.test', installed: B1, replacement: B_OTHER, line: 'cross' },
    ])
    expect(run.requests).toEqual([])
  })

  test('a bare flag consents to a same-line change; another line needs the origin and may revoke', async () => {
    const run = moving(A1, A2)
    await installByReference([A2], { ...JSON_OUTPUT, allowIssuerChange: [''] }, run.deps)
    expect(run.requests[0]!.domains).toEqual([
      { release: { url: A2, digest: digest('2') }, consent: { issuer: { from: A1, to: A2 } } },
    ] as never)
    expect(JSON.parse(io.stdout).references[0]).toMatchObject({
      previous: { issuer: A1 },
      installed: { issuer: A2 },
      consent: { from: A1, to: A2, previous: 'drain' },
    })

    const bare = moving(A1, A_OTHER_LINE)
    expect(
      await refused([A_OTHER_LINE], { ...JSON_OUTPUT, allowIssuerChange: [''] }, bare),
    ).toMatchObject({ details: { origins: [{ origin: AGENCIES, line: 'cross' }] } })

    io.stdout = ''
    const scoped = moving(A1, A_OTHER_LINE)
    await installByReference(
      [A_OTHER_LINE],
      { ...JSON_OUTPUT, allowIssuerChange: [AGENCIES], revokePrevious: true },
      scoped.deps,
    )
    expect(scoped.requests[0]!.domains[0]).toMatchObject({
      consent: { issuer: { from: A1, to: A_OTHER_LINE }, previous: 'revoke' },
    })
    expect(JSON.parse(io.stdout).references[0].consent).toEqual({
      from: A1,
      to: A_OTHER_LINE,
      previous: 'revoke',
    })
  })

  test('an installation the listing omits is read by its origin before consent is planned', async () => {
    const run = harness({
      served: { [A1]: served(AGENCIES, A1, '2') },
      inspect: async (origin) => ({ origin, release: { identity: { issuer: A_UNLINED } } }),
    })
    await installByReference([A1], { ...JSON_OUTPUT, allowIssuerChange: [AGENCIES] }, run.deps)
    expect(run.requests[0]!.domains[0]).toEqual({
      release: { url: A1, digest: digest('2') },
      consent: { issuer: { from: A_UNLINED, to: A1 } },
    })
  })

  test.each([
    ['not found', new ResponseError(3002, 'Not found.', INVOCATION), 'first install'],
    [
      'SCHEMA_NOT_FOUND',
      new ResponseError(1003, 'Not installed.', INVOCATION, {
        code: 'SCHEMA_NOT_FOUND',
        details: {},
      }),
      'first install',
    ],
    [
      'SCHEMA_NOT_READY',
      new ResponseError(1003, 'Not ready.', INVOCATION, { code: 'SCHEMA_NOT_READY', details: {} }),
      'refused',
    ],
    ['an unavailable backend', backendUnavailable(), 'refused'],
  ] as const)('reading the origin answers %s: %s', async (_name, answer, outcome) => {
    const run = harness({
      served: { [A1]: served(AGENCIES, A1, '2') },
      inspect: async () => {
        throw answer
      },
    })
    if (outcome === 'refused') {
      await refused([A1], JSON_OUTPUT, run)
      expect(run.requests).toEqual([])
    } else {
      await installByReference([A1], JSON_OUTPUT, run.deps)
      expect(run.requests[0]!.domains[0]).not.toHaveProperty('consent')
    }
  })

  test('refuses an origin-scoped consent that names no Domain of the install', async () => {
    const run = moving(A1, A2)
    expect(
      await refused([A2], { ...JSON_OUTPUT, allowIssuerChange: ['crm.test'] }, run),
    ).toMatchObject({ error: 'INVALID_FLAG' })
    expect(run.requests).toEqual([])
  })

  test('a refusal stays a refusal, even when the installed state already matches', async () => {
    const a2 = served(AGENCIES, A2, '2')
    const run = harness({
      served: { [A2]: a2 },
      // The listing read before the install is stale: another run committed the move since.
      listing: async (call) =>
        call === 0 ? [installedFrom(served(AGENCIES, A1, '1'))] : [installedFrom(a2)],
      install: async () => {
        throw new ResponseError(1003, 'Function input is invalid.', INVOCATION, {
          code: 'SCHEMA_INPUT_INVALID',
          details: { phase: 'input', path: '/domains/0/consent', issue: 'invalid' },
        })
      },
    })
    expect(await refused([A2], { ...JSON_OUTPUT, allowIssuerChange: [''] }, run)).toMatchObject({
      error: 'RESPONSE_ERROR',
      reason: { code: 'SCHEMA_INPUT_INVALID' },
    })
    expect(io.stdout).toBe('')
  })
})

describe('issuer change lines and consent flags', () => {
  const deployment = (line: string, content: string, domain = 'astrale.app', scheme = 'https') =>
    `${scheme}://${line}-${content}.${domain}`
  const S1 = deployment('shell-aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb')
  const S2 = deployment('shell-aaaaaaaaaaaaaaaa', 'cccccccccccccccc')

  test('a change stays on its line only under the same line, routing domain and scheme', () => {
    expect(issuerChangeLine(S1, S2, S2)).toBe('same')
    // The port is not part of the line: a local Host serves each deployment on its own port.
    const local = (content: string, port: number) =>
      deployment('shell-aaaaaaaaaaaaaaaa', content, `localhost:${port}`, 'http')
    expect(
      issuerChangeLine(
        local('bbbbbbbbbbbbbbbb', 4001),
        local('cccccccccccccccc', 4002),
        local('cccccccccccccccc', 4002),
      ),
    ).toBe('same')
    const otherLine = deployment('shell-dddddddddddddddd', 'bbbbbbbbbbbbbbbb')
    for (const [to, url] of [
      [otherLine, otherLine],
      [deployment('shell-aaaaaaaaaaaaaaaa', 'cccccccccccccccc', 'other.app'), S2],
      [deployment('shell-aaaaaaaaaaaaaaaa', 'cccccccccccccccc', 'astrale.app', 'http'), S2],
      [A_UNLINED, A_UNLINED],
      ['not-a-url', S2],
      // The served issuer decides with the URL: a same-line URL serving another line is cross-line.
      [otherLine, S2],
    ]) {
      expect(issuerChangeLine(S1, to!, url!)).toBe('cross')
    }
    expect(issuerChangeLine(A_UNLINED, S1, S1)).toBe('cross')
  })

  test('the command binds an origin to --allow-issuer-change only after =', async () => {
    const program = new Command().exitOverride()
    let seen: unknown
    registerCommand(program, {
      name: 'install',
      description: 'test',
      arguments: [{ name: 'references', description: 'refs', required: false, variadic: true }],
      options: [{ flags: '--allow-issuer-change [origin]', description: 'test', repeatable: true }],
      action: (async (references: string[], opts: { allowIssuerChange?: string[] }) => {
        seen = { references, values: opts.allowIssuerChange }
      }) as never,
    })
    await program.parseAsync(
      [
        'install',
        '--allow-issuer-change',
        'https://a.test',
        '--allow-issuer-change=a.test',
        '--allow-issuer-change=https://b.test',
      ],
      { from: 'user' },
    )
    expect(seen).toEqual({
      references: ['https://a.test'],
      values: ['', 'a.test', 'https://b.test'],
    })
    expect(() => issuerChangeConsent(['https://b.test'], false)).toThrow()
  })

  test('at a terminal a typed origin consents; a decline refuses it and every change not asked', async () => {
    const change = (origin: string) => ({
      origin,
      reference: A_OTHER_LINE,
      from: A1,
      to: A_OTHER_LINE,
      line: 'cross' as const,
    })
    const asked: string[] = []
    const refusal = admitIssuerChanges(
      [change('one.test'), change('two.test'), change('three.test')],
      issuerChangeConsent([], false),
      false,
      { tty: true, env: {}, argv: [] },
      async (_banner, expected) => {
        asked.push(expected)
        return expected === 'one.test'
      },
    )
    await expect(refusal).rejects.toMatchObject({
      code: 'ISSUER_CHANGE_NOT_CONSENTED',
      details: { origins: [{ origin: 'two.test' }, { origin: 'three.test' }] },
    })
    expect(asked).toEqual(['one.test', 'two.test'])
  })
})

function completedInstallation(result: InstallResult) {
  return {
    execution: 'install-execution' as never,
    status: {
      id: 'install-execution' as never,
      function: 'install-function' as never,
      version: digest('a'),
      state: 'completed',
      createdAt: '2026-10-11T18:00:00.000Z',
      outcome: { kind: 'completed', value: result },
    },
    result,
  } satisfies Installation
}

describe('durable installations', () => {
  test('retains execution and terminal status beside the committed JSON result', async () => {
    const run = harness({ served: { [A]: served(AGENCIES, A, '1') } })
    await installByReference([A], JSON_OUTPUT, run.deps)
    expect(JSON.parse(io.stdout)).toMatchObject({
      changed: true,
      execution: 'install-execution',
      status: { state: 'completed' },
    })
  })

  for (const state of ['pending', 'running', 'waiting', 'paused', 'failed', 'cancelled'] as const) {
    test(`${state} never claims success or reads installed pins after the call`, async () => {
      let listings = 0
      const status = {
        ...completedInstallation(committed([AGENCIES])).status,
        state,
        outcome:
          state === 'failed'
            ? {
                kind: 'failed' as const,
                error: {
                  code: 'DATA_MIGRATION_REQUIRED',
                  message: 'Stored data requires repair.',
                  details: { count: 2 },
                },
              }
            : state === 'cancelled'
              ? { kind: 'cancelled' as const }
              : undefined,
        ...(state === 'waiting'
          ? { detail: { phase: 'awaiting' as const, command: 1, mode: 'maintenance' as const } }
          : {}),
      }
      const run = harness({
        served: { [A]: served(AGENCIES, A, '1') },
        listing: async () => {
          listings++
          return []
        },
        installation: { execution: 'install-execution' as never, status },
      })
      const failure = await refused(
        [A],
        {
          ...JSON_OUTPUT,
          operation: RETRY,
          mode: 'maintenance',
          validationScope: 'full',
          validationCounts: 'exact',
          wait: false,
        },
        run,
      )
      expect(io.stdout).toBe('')
      expect(failure).toMatchObject({
        execution: 'install-execution',
        status: { state },
        operation: RETRY,
        error:
          state === 'failed'
            ? 'DATA_MIGRATION_REQUIRED'
            : state === 'cancelled'
              ? 'INSTALLATION_CANCELLED'
              : 'INSTALLATION_PENDING',
      })
      // Followed by its Execution; once it ended, tried again with a fresh operation.
      expect(failure).not.toHaveProperty('replay')
      expect(String(failure.observe)).toContain('installation status install-execution')
      if (state === 'failed' || state === 'cancelled') {
        expect(failure.fresh).toContain(
          '--mode maintenance --validation-scope full --validation-counts exact --no-wait',
        )
        expect(failure.fresh).not.toContain('--operation')
      }
      expect(run.requests).toHaveLength(1)
      expect(run.requests[0]).toMatchObject({
        operation: RETRY,
        mode: 'maintenance',
        validation: { scope: 'full', counts: 'exact' },
        wait: false,
      })
      expect(listings).toBe(1)
    })
  }

  test('a failed install used its operation: it names the fresh command that tries again', async () => {
    const status = {
      ...completedInstallation(committed([AGENCIES])).status,
      state: 'failed' as const,
      outcome: {
        kind: 'failed' as const,
        error: { code: 'DATA_MIGRATION_REQUIRED', message: 'Repair stored data.' },
      },
    }
    const run = harness({
      served: { [A]: served(AGENCIES, A, '1') },
      installation: { execution: 'install-execution' as never, status },
    })
    const failure = await refused(
      [A],
      { ...JSON_OUTPUT, operation: RETRY, instance: 'staging' },
      run,
    )
    expect(failure).toMatchObject({
      execution: 'install-execution',
      operation: RETRY,
      fresh: `astrale domain install ${A} -i staging`,
      observe: 'astrale domain installation status install-execution -i staging',
    })
  })

  test('a refusal before any Execution leaves the operation unused: run it again fresh', async () => {
    const run = harness({
      served: { [A]: served(AGENCIES, A, '1') },
      install: async () => {
        throw new ResponseError(4001 as never, 'A session is changing the schema.', INVOCATION, {
          code: 'SCHEMA_CHANGE_ACTIVE',
          details: {},
        })
      },
    })
    expect(await refused([A], JSON_OUTPUT, run)).toMatchObject({
      reason: { code: 'SCHEMA_CHANGE_ACTIVE' },
      execution: null,
      operation: GENERATED,
      fresh: `astrale domain install ${A}`,
    })
  })

  test('a human sees the failed execution, never already current', async () => {
    const status = {
      ...completedInstallation(committed([AGENCIES])).status,
      state: 'failed' as const,
      outcome: {
        kind: 'failed' as const,
        error: { code: 'DATA_MIGRATION_REQUIRED', message: 'Repair stored data.' },
      },
    }
    const run = harness({
      served: { [A]: served(AGENCIES, A, '1') },
      installation: { execution: 'install-execution' as never, status },
    })
    const shown = await human(async () => {
      await expect(installByReference([A], {}, run.deps)).rejects.toBeInstanceOf(ExitError)
    })
    expect(shown.all).toContain('DATA_MIGRATION_REQUIRED')
    expect(shown.all).toContain('install-execution')
    expect(shown.all).not.toContain('already current')
  })
})

describe('published SDK durable decoder through the install command', () => {
  for (const state of ['completed', 'failed', 'waiting'] as const) {
    test(`${state}: consumes the reference and exact Execution reads before presenting`, async () => {
      const calls: string[] = []
      const result = {
        changed: false as const,
        domains: [{ origin: AGENCIES, revision: REVISION, generation: digest('a') }] as const,
      }
      const outcome =
        state === 'failed'
          ? {
              kind: 'failed' as const,
              error: {
                code: 'DATA_MIGRATION_REQUIRED',
                message: 'Repair required.',
                details: { count: 2 },
              },
            }
          : { kind: 'completed' as const, value: result }
      const status = {
        id: 'install-execution',
        function: 'install-function',
        version: digest('a'),
        state,
        createdAt: '2026-10-11T18:00:00Z',
        ...(state === 'waiting'
          ? { detail: { phase: 'awaiting', command: 1, mode: 'maintenance' } }
          : { outcome }),
      }
      const api = createSchema(
        async (call) => {
          calls.push(typeof call.target === 'string' ? call.target : String(call.target))
          if (calls.length === 1)
            return { kind: 'execution', execution: 'install-execution' } as never
          if (calls.at(-1)!.endsWith('.result')) return { kind: 'value', value: outcome } as never
          return { kind: 'value', value: status } as never
        },
        { maximumReleaseBytes: 1048576, maximumBundleBytes: 1048576, lifecycleTimeoutMs: 2000 },
      )
      let listings = 0
      const run = harness({
        served: { [A]: served(AGENCIES, A, '1') },
        listing: async () => {
          listings++
          return []
        },
        lifecycle: (request) => api.install(request),
      })
      if (state === 'completed') {
        await installByReference([A], JSON_OUTPUT, run.deps)
        expect(JSON.parse(io.stdout)).toMatchObject({
          execution: 'install-execution',
          changed: false,
          status: { state },
        })
        expect(listings).toBe(2)
      } else {
        const failure = await refused(
          [A],
          { ...JSON_OUTPUT, ...(state === 'waiting' ? { mode: 'maintenance' as const } : {}) },
          run,
        )
        expect(failure).toMatchObject({
          execution: 'install-execution',
          status: { state },
          error: state === 'failed' ? 'DATA_MIGRATION_REQUIRED' : 'INSTALLATION_PENDING',
        })
        expect(listings).toBe(1)
      }
      expect(calls[0]).toContain('function.install')
      expect(calls.at(-1)).toContain('Execution.method.status')
      expect(calls).toHaveLength(state === 'waiting' ? 2 : 3)
      expect(run.requests).toHaveLength(1)
    })
  }
})

test('durable dependency refusal retains its advisory precheck and exact Kernel failure', async () => {
  const status = {
    ...completedInstallation(committed([AGENCIES])).status,
    state: 'failed' as const,
    outcome: {
      kind: 'failed' as const,
      error: {
        code: 'SCHEMA_DEPENDENTS_INCOMPATIBLE',
        message: 'Dependent would break.',
        details: { origins: ['consumer.test'] },
      },
    },
  }
  const run = harness({
    served: { [A]: served(AGENCIES, A, '1') },
    installation: { execution: 'install-execution' as never, status },
  })
  const failure = await refused([A], JSON_OUTPUT, run)
  expect(failure).toMatchObject({
    error: 'SCHEMA_DEPENDENTS_INCOMPATIBLE',
    precheck: { skipped: [{ reference: A, reason: 'bundle-unread' }] },
    status: { outcome: { error: { details: { origins: ['consumer.test'] } } } },
  })
})

describe('an operation conflict refuses this install: nothing ran for it', () => {
  const conflict = (details: Record<string, string>, code = 'SCHEMA_OPERATION_CONFLICT') =>
    new ResponseError(4001 as never, 'The operation id was already used.', INVOCATION, {
      code,
      details,
    })
  /** The online install the operation already names, completed: A1 replaced by A2. */
  const online = {
    ...completedInstallation(committed([AGENCIES], [AGENCIES], RETRY)).status,
    id: EXECUTION,
  }
  const usedBy = (mode?: string) =>
    harness({
      served: { [A]: served(AGENCIES, A, '1'), [A2]: served(AGENCIES, A2, '2') },
      listing: async () => [installedFrom(served(AGENCIES, A2, '2'))],
      install: async () => {
        throw conflict({ operation: RETRY, execution: EXECUTION, ...(mode ? { mode } : {}) })
      },
      executions: { [EXECUTION]: online },
    })
  const message =
    `Operation ${RETRY} already names another request: ${EXECUTION} (online install, completed). ` +
    'Nothing ran for this command.'

  test('a maintenance install under the operation of a completed online install', async () => {
    const run = usedBy('online')
    const opts = { operation: RETRY, mode: 'maintenance' as const, instance: 'staging' }
    await expect(installByReference([A2], { ...JSON_OUTPUT, ...opts }, run.deps)).rejects.toEqual(
      new ExitError(5),
    )
    expect(io.stdout).toBe('')
    expect(io.failure()).toMatchObject({
      reason: { code: 'SCHEMA_OPERATION_CONFLICT' },
      hint: message,
      operation: RETRY,
      conflict: { execution: EXECUTION, lifecycle: 'install', mode: 'online', state: 'completed' },
      observe: `astrale domain installation status ${EXECUTION} -i staging`,
      fresh: `astrale domain install ${A2} --mode maintenance -i staging`,
    })
    const shown = await human(async () => {
      await expect(installByReference([A2], opts, run.deps)).rejects.toEqual(new ExitError(5))
    })
    expect(shown.all).toContain(`SCHEMA_OPERATION_CONFLICT: ${message}`)
    expect(shown.all).toContain(
      `Read that request's run: astrale domain installation status ${EXECUTION} -i staging`,
    )
    expect(shown.all).toContain(
      `Run this install with a fresh operation: astrale domain install ${A2} --mode maintenance -i staging`,
    )
    // Never that request's outcome as this command's answer.
    for (const claim of ['Domain installed', 'Maintenance session', 'already ran']) {
      expect(shown.all).not.toContain(claim)
    }
  })

  test('another release under a used operation is refused, never compared with the other result', async () => {
    const run = usedBy('online')
    const shown = await human(async () => {
      await expect(
        installByReference([A], { operation: RETRY, allowIssuerChange: [AGENCIES] }, run.deps),
      ).rejects.toEqual(new ExitError(5))
    })
    expect(shown.all).toContain(`SCHEMA_OPERATION_CONFLICT: ${message}`)
    expect(shown.all).not.toContain('INSTALLED_PIN_MISMATCH')
    expect(shown.all).not.toContain('installed (operation')
    expect(run.requests).toHaveLength(1)
  })

  test('a conflict naming no Execution: nothing ran, and the fresh command', async () => {
    const run = harness({
      served: { [A]: served(AGENCIES, A, '1') },
      install: async () => {
        throw conflict({}, 'IDEMPOTENCY_KEY_CONFLICT')
      },
    })
    await expect(
      installByReference([A], { ...JSON_OUTPUT, operation: RETRY }, run.deps),
    ).rejects.toEqual(new ExitError(5))
    const failure = io.failure()
    expect(failure).toMatchObject({
      hint: `Operation ${RETRY} already names another request. Nothing ran for this command.`,
      fresh: `astrale domain install ${A}`,
    })
    expect(failure).not.toHaveProperty('conflict')
    expect(io.stdout).toBe('')
  })
})
