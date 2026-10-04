import type { InstalledRelease, InstallRequest, InstallResult } from '@astrale-os/sdk/client/schema'

import { ResponseError } from '@astrale-os/sdk/client'
import { defineSchema, schema } from '@astrale-os/sdk/schema'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { stripVTControlCharacters } from 'node:util'

import type { ServedDeployment } from '../../lib/domain-release'
import type { UrlInstallDependencies } from '../domain/release-install'

import { releaseFor } from '../../__tests__/fixtures/publication'
import { transportFailure } from '../../connection/__tests__/failure-fixtures'
import { DeploymentReadError } from '../../lib/domain-release'
import { installByUrl, NOT_YET_ACTIVE_WINDOW_MS, rootStatus } from '../domain/release-install'

const GENERATED = '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8'
const RETRY = '139137b5-af47-47ce-92b2-b64a2b0c63d7'
const INVOCATION = {
  source: 'https://kernel.test',
  id: 'domain-install-url',
} as ConstructorParameters<typeof ResponseError>[2]

const A = 'https://agencies-production-0123456789abcdef.deployments.test'
const B = 'https://employees-production-fedcba9876543210.deployments.test'
const REVISION = schema.revision(defineSchema('agencies.test', {}))
const digest = (seed: string) => `sha256:${seed.repeat(64)}` as const

function servedRelease(origin: string, url: string, seed: string): ServedDeployment {
  return {
    origin,
    issuer: url,
    revision: REVISION,
    pin: { kind: 'release', release: digest(seed), build: digest('b') },
  }
}

function servedLegacy(origin: string, url: string, seed = '6'): ServedDeployment {
  return {
    origin,
    issuer: url,
    revision: REVISION,
    pin: { kind: 'legacy', document: 3, etag: digest(seed) },
  }
}

/** Run a command for humans: a terminal on stdout, console output captured. */
async function human(run: () => Promise<void>): Promise<{ lines: string; warnings: string }> {
  const lines: string[] = []
  const warnings: string[] = []
  const originalLog = console.log
  const originalError = console.error
  const tty = process.stdout.isTTY
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  }
  console.error = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  }
  process.stdout.isTTY = true
  try {
    await run()
  } finally {
    console.log = originalLog
    console.error = originalError
    process.stdout.isTTY = tty
  }
  return {
    lines: stripVTControlCharacters(lines.join('\n')),
    warnings: stripVTControlCharacters(warnings.join('\n')),
  }
}

function installedFrom(served: ServedDeployment, url: string): InstalledRelease {
  return {
    origin: served.origin,
    revision: served.revision,
    issuer: served.issuer,
    url: new URL(url).origin,
    pin: served.pin,
    inFlight: [],
  } as unknown as InstalledRelease
}

function committed(
  origins: readonly string[],
  operation = GENERATED,
  replaced: readonly string[] = [],
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

function current(origins: readonly string[]): InstallResult {
  return {
    changed: false,
    domains: origins.map((origin) => ({ origin, revision: REVISION })),
  } as unknown as InstallResult
}

const unsupportedListing = () =>
  new ResponseError(1003, 'Function input is invalid.', INVOCATION, {
    code: 'FUNCTION_INPUT_INVALID',
    details: { issues: [{ code: 'invalid_union', path: '/kind', message: 'Invalid input' }] },
  })

/**
 * The Kernel's refusal when its own read of a deployment fails, a 503 included: the shape a Host
 * built from Kernel main + K10/K11a/K14 answered in the C1 F4 proof (step III.03). Its public
 * details are empty, as for a backend failure, so the CLI cannot tell a 503 from it.
 */
const backendUnavailable = () =>
  new ResponseError(5001 as never, 'Schema backend is unavailable.', INVOCATION, {
    code: 'SCHEMA_BACKEND_FAILED',
    details: {},
  })

/**
 * Machine output. A deployment that serves a release needs no identity-override consent: the
 * explicit reference authorizes its first install (AM-19).
 */
const JSON_OUTPUT = { json: true } as const

class ExitError extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`process.exit(${String(code)})`)
  }
}

interface Harness {
  readonly requests: InstallRequest[]
  readonly credentials: unknown[]
  readonly listings: number
  readonly sleeps: number[]
  readonly deps: Partial<UrlInstallDependencies>
}

function harness(options: {
  readonly listing?: (call: number) => Promise<readonly InstalledRelease[]>
  readonly install?: (request: InstallRequest, call: number) => Promise<InstallResult>
  readonly served?: Readonly<Record<string, () => Promise<ServedDeployment>>>
  readonly now?: () => number
}): Harness {
  const requests: InstallRequest[] = []
  const credentials: unknown[] = []
  const sleeps: number[] = []
  let listings = 0
  const session = {
    schema: {
      installed: async () => options.listing?.(listings++) ?? (listings++, []),
      install: async (request: InstallRequest) => {
        requests.push(request)
        return (options.install ?? (async () => committed(['agencies.test'])))(
          request,
          requests.length,
        )
      },
      inspect: async (origin: string) => ({ origin, revision: REVISION, generation: digest('e') }),
    },
  }
  const state = {
    requests,
    credentials,
    sleeps,
    get listings() {
      return listings
    },
    deps: {
      createOperationId: () => GENERATED,
      withClientSession: (async (
        _opts: unknown,
        action: (context: never) => Promise<unknown>,
        credential: unknown,
      ) => {
        credentials.push(credential)
        return action({ session } as never)
      }) as unknown as UrlInstallDependencies['withClientSession'],
      readDeployment: async (url: string) => {
        const read = options.served?.[url]
        if (read === undefined) throw new DeploymentReadError(`GET ${url} failed.`)
        return read()
      },
      now: options.now ?? (() => 0),
      sleep: async (ms: number) => {
        sleeps.push(ms)
      },
    } satisfies Partial<UrlInstallDependencies>,
  }
  return state
}

let stdout = ''
let stderr = ''
let originalExit: typeof process.exit
let originalStdout: typeof process.stdout.write
let originalStderr: typeof process.stderr.write
const originalFetch = globalThis.fetch

beforeEach(() => {
  stdout = ''
  stderr = ''
  originalExit = process.exit
  originalStdout = process.stdout.write.bind(process.stdout)
  originalStderr = process.stderr.write.bind(process.stderr)
  process.exit = ((code?: number | string | null) => {
    throw new ExitError(code)
  }) as typeof process.exit
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    return true
  }) as typeof process.stderr.write
})

afterEach(() => {
  process.exit = originalExit
  process.stdout.write = originalStdout
  process.stderr.write = originalStderr
  globalThis.fetch = originalFetch
})

describe('install by URL on a Kernel that lists installed releases', () => {
  test('sends one release request guarded by the digest each URL serves', async () => {
    const a = servedRelease('agencies.test', A, '1')
    const run = harness({
      served: { [A]: async () => a },
      listing: async (call) => (call === 0 ? [] : [installedFrom(a, A)]),
    })

    await installByUrl([A], JSON_OUTPUT, run.deps)

    expect(run.credentials).toEqual([{ principal: 'caller' }])
    expect(run.requests).toEqual([
      { operation: GENERATED, domains: [{ release: { url: A, digest: digest('1') } }] } as never,
    ])
    expect(JSON.parse(stdout)).toEqual({
      ...JSON.parse(JSON.stringify(committed(['agencies.test']))),
      references: [
        {
          reference: A,
          origin: 'agencies.test',
          url: A,
          pin: a.pin,
          previous: null,
          installed: { revision: REVISION, pin: a.pin, issuer: A },
        },
      ],
    })
  })

  test('groups several URLs in one atomic install, in the order written', async () => {
    const a = servedRelease('agencies.test', A, '1')
    const b = servedRelease('employees.test', B, '2')
    const previousB = { ...installedFrom(b, B), pin: { ...b.pin, release: digest('9') } }
    const run = harness({
      served: { [A]: async () => a, [B]: async () => b },
      listing: async (call) =>
        call === 0 ? [previousB] : [installedFrom(a, A), installedFrom(b, B)],
      install: async () => committed(['agencies.test', 'employees.test']),
    })

    await installByUrl([B, A], JSON_OUTPUT, run.deps)

    expect(run.requests).toHaveLength(1)
    expect(run.requests[0]!.domains).toEqual([
      { release: { url: B, digest: digest('2') } },
      { release: { url: A, digest: digest('1') } },
    ])
    const report = JSON.parse(stdout) as { references: { origin: string; previous: unknown }[] }
    expect(report.references.map(({ origin }) => origin)).toEqual([
      'employees.test',
      'agencies.test',
    ])
    expect(report.references[0]!.previous).toEqual({
      revision: REVISION,
      pin: previousB.pin,
      issuer: B,
    })
    expect(report.references[1]!.previous).toBeNull()
  })

  test('refuses two references to one origin before any install is sent', async () => {
    const run = harness({
      served: {
        [A]: async () => servedRelease('agencies.test', A, '1'),
        [B]: async () => servedRelease('agencies.test', B, '2'),
      },
    })

    await expect(installByUrl([A, B], JSON_OUTPUT, run.deps)).rejects.toBeInstanceOf(ExitError)
    expect(run.requests).toEqual([])
    expect(JSON.parse(stderr)).toMatchObject({ error: 'DUPLICATE_ORIGIN' })
  })

  test('refuses the same deployment named twice before connecting', async () => {
    const run = harness({})
    await expect(installByUrl([A, `${A}/`], JSON_OUTPUT, run.deps)).rejects.toBeInstanceOf(
      ExitError,
    )
    expect(run.credentials).toEqual([])
    expect(JSON.parse(stderr)).toMatchObject({ error: 'DUPLICATE_ORIGIN' })
  })

  test('prints one line per root Domain for humans', async () => {
    const a = servedRelease('agencies.test', A, '1')
    const b = servedRelease('employees.test', B, '2')
    const previousB = { ...installedFrom(b, B), pin: { ...b.pin, release: digest('9') } }
    const run = harness({
      served: { [A]: async () => a, [B]: async () => b },
      listing: async (call) =>
        call === 0 ? [installedFrom(a, A), previousB] : [installedFrom(a, A), installedFrom(b, B)],
      install: async () => committed(['employees.test'], GENERATED, ['employees.test']),
    })
    const lines: string[] = []
    const original = console.log
    const tty = process.stdout.isTTY
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    }
    // A terminal on stdout is what makes the output human (no --json).
    process.stdout.isTTY = true
    try {
      await installByUrl([A, B], {}, run.deps)
    } finally {
      console.log = original
      process.stdout.isTTY = tty
    }

    const text = stripVTControlCharacters(lines.join('\n'))
    expect(text).toContain(`Domains installed (operation ${GENERATED})`)
    expect(text).toContain('  agencies.test   unchanged  release sha256:111111111111\n')
    expect(text).toContain(
      '  employees.test  replaced   release sha256:222222222222 (was release sha256:999999999999)',
    )
  })

  test('takes each root status from the Kernel receipt when the listing is not readable', async () => {
    const a = servedRelease('agencies.test', A, '1')
    const b = servedRelease('employees.test', B, '2')
    const run = harness({
      served: { [A]: async () => a, [B]: async () => b },
      // A caller who cannot read the Domain directory lists nothing, before and after.
      listing: async () => [],
      install: async () =>
        committed(['agencies.test', 'employees.test'], GENERATED, ['employees.test']),
    })
    const lines: string[] = []
    const original = console.log
    const tty = process.stdout.isTTY
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    }
    process.stdout.isTTY = true
    try {
      await installByUrl([A, B], {}, run.deps)
    } finally {
      console.log = original
      process.stdout.isTTY = tty
    }

    const text = stripVTControlCharacters(lines.join('\n'))
    expect(text).toContain('  agencies.test   installed  release sha256:111111111111\n')
    expect(text).toContain('  employees.test  replaced   release sha256:222222222222')
    expect(text).not.toContain('(was')
  })

  test('installs a legacy source by URL without a digest and verifies its legacy pin', async () => {
    const deployed = releaseFor(defineSchema('crm.test', {}), 'https://crm.test').publication
    const served: ServedDeployment = {
      origin: 'crm.test',
      issuer: 'https://crm.test',
      revision: deployed.schema.revision,
      pin: { kind: 'legacy', document: deployed.version, etag: deployed.etag },
    }
    const run = harness({
      served: { 'https://crm.test': async () => served },
      listing: async (call) => (call === 0 ? [] : [installedFrom(served, 'https://crm.test')]),
      install: async () => committed(['crm.test']),
    })

    await installByUrl(['https://crm.test'], JSON_OUTPUT, run.deps)

    expect(run.requests[0]!.domains).toEqual([{ release: { url: 'https://crm.test' } }])
    expect(JSON.parse(stdout).references[0].installed.pin).toEqual(served.pin)
  })

  test('installs an unreadable deployment without a digest and reports the Kernel pin', async () => {
    const a = servedRelease('agencies.test', A, '1')
    const run = harness({
      listing: async (call) => (call === 0 ? [] : [installedFrom(a, A)]),
    })

    await installByUrl([A], JSON_OUTPUT, run.deps)

    expect(run.requests[0]!.domains).toEqual([{ release: { url: A } }])
    expect(JSON.parse(stdout).references[0]).toMatchObject({
      origin: 'agencies.test',
      pin: null,
      installed: { pin: a.pin },
    })
  })

  test('reads a deployment that is not serving yet again, then installs it once', async () => {
    const a = servedRelease('agencies.test', A, '1')
    let reads = 0
    const run = harness({
      served: {
        [A]: async () => {
          reads += 1
          if (reads < 3) {
            throw new DeploymentReadError('GET → 503', { status: 503, retryAfter: '2' })
          }
          return a
        },
      },
      listing: async (call) => (call === 0 ? [] : [installedFrom(a, A)]),
    })

    await installByUrl([A], JSON_OUTPUT, run.deps)

    expect(reads).toBe(3)
    expect(run.sleeps).toEqual([2_000, 2_000])
    expect(run.requests).toEqual([
      { operation: GENERATED, domains: [{ release: { url: A, digest: digest('1') } }] } as never,
    ])
  })

  test('stops reading once the window is spent and installs without a digest', async () => {
    const a = servedRelease('agencies.test', A, '1')
    let clock = 0
    const run = harness({
      served: {
        [A]: async () => {
          clock += NOT_YET_ACTIVE_WINDOW_MS / 2
          throw new DeploymentReadError('GET → 503', { status: 503 })
        },
      },
      now: () => clock,
      listing: async (call) => (call === 0 ? [] : [installedFrom(a, A)]),
    })

    await installByUrl([A], JSON_OUTPUT, run.deps)

    expect(run.sleeps.length).toBeGreaterThan(0)
    expect(run.sleeps.length).toBeLessThanOrEqual(2)
    expect(run.requests[0]!.domains).toEqual([{ release: { url: A } }])
    expect(JSON.parse(stdout).references[0]).toMatchObject({ pin: null, installed: { pin: a.pin } })
  })

  test('never sends again an install the Kernel refused, a failed read of its own included', async () => {
    const run = harness({
      served: { [A]: async () => servedRelease('agencies.test', A, '1') },
      install: async () => {
        throw backendUnavailable()
      },
    })

    await expect(installByUrl([A], JSON_OUTPUT, run.deps)).rejects.toBeInstanceOf(ExitError)
    expect(run.requests).toHaveLength(1)
    expect(run.sleeps).toEqual([])
    expect(JSON.parse(stderr.trim().split('\n').at(-1)!)).toMatchObject({
      error: 'RESPONSE_ERROR',
      code: 5001,
      reason: { code: 'SCHEMA_BACKEND_FAILED', details: {} },
    })
  })

  test('fails when the Kernel reports another pin than the one read before the install', async () => {
    const a = servedRelease('agencies.test', A, '1')
    const run = harness({
      served: { [A]: async () => a },
      listing: async (call) =>
        call === 0 ? [] : [{ ...installedFrom(a, A), pin: { ...a.pin, release: digest('7') } }],
    })

    await expect(installByUrl([A], JSON_OUTPUT, run.deps)).rejects.toBeInstanceOf(ExitError)
    expect(JSON.parse(stdout).references[0].installed.pin.release).toBe(digest('7'))
    expect(JSON.parse(stderr)).toMatchObject({ error: 'INSTALLED_PIN_MISMATCH' })
  })

  test('installs a release that claims another origin than its host without the identity-override gate', async () => {
    const a = servedRelease('agencies.test', A, '1')
    const run = harness({
      served: { [A]: async () => a },
      listing: async (call) => (call === 0 ? [] : [installedFrom(a, A)]),
    })

    await installByUrl([A], JSON_OUTPUT, run.deps)

    expect(run.requests).toEqual([
      { operation: GENERATED, domains: [{ release: { url: A, digest: digest('1') } }] } as never,
    ])
    expect(JSON.parse(stdout).references[0]).not.toHaveProperty('consent')
  })

  test('notes for humans that a first install trusts the deployment claim, without asking', async () => {
    const a = servedRelease('agencies.test', A, '1')
    const run = harness({
      served: { [A]: async () => a },
      listing: async (call) => (call === 0 ? [] : [installedFrom(a, A)]),
    })
    const { warnings } = await human(() => installByUrl([A], {}, run.deps))

    expect(warnings).toContain(`origin agencies.test claimed by unverified deployment ${A}`)
    expect(run.requests).toHaveLength(1)
  })

  test('keeps the identity-override gate for a legacy domain.json source that serves another origin', async () => {
    const run = harness({ served: { [A]: async () => servedLegacy('agencies.test', A) } })

    await expect(installByUrl([A], JSON_OUTPUT, run.deps)).rejects.toBeInstanceOf(ExitError)
    expect(run.requests).toEqual([])
    expect(JSON.parse(stderr)).toMatchObject({ error: 'IDENTITY_OVERRIDE_REJECTED' })
  })

  test('refuses a URL not written as the Kernel reads it before any install', async () => {
    const run = harness({})
    await expect(
      installByUrl(['https://CRM.example.test'], JSON_OUTPUT, run.deps),
    ).rejects.toBeInstanceOf(ExitError)
    expect(run.requests).toEqual([])
    expect(JSON.parse(stderr)).toMatchObject({ error: 'INVALID_DOMAIN_URL' })
  })

  test('keeps an explicit operation as the exact retry identity', async () => {
    const a = servedRelease('agencies.test', A, '1')
    const create = mock(() => GENERATED)
    const accepted: unknown[] = []
    const run = harness({
      served: { [A]: async () => a },
      install: async () => committed(['agencies.test'], RETRY),
    })

    await installByUrl(
      [A],
      { ...JSON_OUTPUT, operation: RETRY, instance: 'staging' },
      {
        ...run.deps,
        createOperationId: create,
        acceptOperationId: (input) => {
          accepted.push(input)
          return RETRY
        },
      },
    )

    expect(create).not.toHaveBeenCalled()
    expect(accepted).toEqual([RETRY])
    expect(String(run.requests[0]!.operation)).toBe(RETRY)
  })
})

const LINE = 'agencies-aaaaaaaaaaaaaaaa'
/** Immutable deployments of one line, of another line, and a legacy issuer of the same origin. */
const A1 = `https://${LINE}-bbbbbbbbbbbbbbbb.deployments.test`
const A2 = `https://${LINE}-cccccccccccccccc.deployments.test`
const A_OTHER_LINE = 'https://agencies-dddddddddddddddd-bbbbbbbbbbbbbbbb.deployments.test'
const A_LEGACY = 'https://agencies-v3.legacy.test'

/** The Kernel refusal of a consent whose Domain no longer changes issuer (AM-81). */
const consentOnUnchangedRoot = () =>
  new ResponseError(1003, 'Function input is invalid.', INVOCATION, {
    code: 'SCHEMA_INPUT_INVALID',
    details: { phase: 'input', path: '/domains/0/consent', issue: 'invalid' },
  })

describe('issuer changes (D7): consent planned from the installed listing', () => {
  /** agencies.test installed from `from` until an install commits, the install reading `to`. */
  function moving(from: string, to: string, served = servedRelease('agencies.test', to, '2')) {
    const installed = installedFrom(servedRelease('agencies.test', from, '1'), from)
    let moved = false
    return harness({
      served: { [to]: async () => served },
      listing: async () => (moved ? [installedFrom(served, to)] : [installed]),
      install: async () => {
        moved = true
        return committed(['agencies.test'], GENERATED, ['agencies.test'])
      },
    })
  }

  test('refuses a same-line change without consent before any install is sent', async () => {
    const run = moving(A1, A2)

    await expect(installByUrl([A2], JSON_OUTPUT, run.deps)).rejects.toBeInstanceOf(ExitError)
    expect(run.requests).toEqual([])
    expect(JSON.parse(stderr)).toMatchObject({
      error: 'ISSUER_CHANGE_NOT_CONSENTED',
      details: {
        origin: 'agencies.test',
        line: 'same',
        installedIssuer: A1,
        replacementIssuer: A2,
      },
    })
  })

  test('sends the consent of a same-line change with --allow-issuer-change and reports it', async () => {
    const run = moving(A1, A2)

    await installByUrl([A2], { ...JSON_OUTPUT, allowIssuerChange: [''] }, run.deps)

    expect(run.requests).toEqual([
      {
        operation: GENERATED,
        domains: [
          { release: { url: A2, digest: digest('2') }, consent: { issuer: { from: A1, to: A2 } } },
        ],
      } as never,
    ])
    expect(JSON.parse(stdout).references[0]).toMatchObject({
      origin: 'agencies.test',
      previous: { issuer: A1 },
      installed: { issuer: A2 },
      consent: { issuer: { from: A1, to: A2 }, previous: 'drain', line: 'same' },
    })
  })

  test('--allow-issuer-change alone does not cover another line', async () => {
    const run = moving(A1, A_OTHER_LINE)

    await expect(
      installByUrl([A_OTHER_LINE], { ...JSON_OUTPUT, allowIssuerChange: [''] }, run.deps),
    ).rejects.toBeInstanceOf(ExitError)
    expect(run.requests).toEqual([])
    expect(JSON.parse(stderr)).toMatchObject({
      error: 'ISSUER_CHANGE_NOT_CONSENTED',
      details: { line: 'cross' },
    })
  })

  test('the origin-scoped flag consents to another line, and --revoke-previous revokes', async () => {
    const run = moving(A1, A_OTHER_LINE)

    await installByUrl(
      [A_OTHER_LINE],
      { ...JSON_OUTPUT, allowIssuerChange: ['agencies.test'], revokePrevious: true },
      run.deps,
    )

    expect(run.requests[0]!.domains).toEqual([
      {
        release: { url: A_OTHER_LINE, digest: digest('2') },
        consent: { issuer: { from: A1, to: A_OTHER_LINE }, previous: 'revoke' },
      },
    ] as never)
    expect(JSON.parse(stdout).references[0].consent).toEqual({
      issuer: { from: A1, to: A_OTHER_LINE },
      previous: 'revoke',
      line: 'cross',
    })
  })

  test('moving a legacy issuer to its first deployment is a cross-line change', async () => {
    const run = moving(A_LEGACY, A1)

    await expect(
      installByUrl([A1], { ...JSON_OUTPUT, allowIssuerChange: [''] }, run.deps),
    ).rejects.toBeInstanceOf(ExitError)
    expect(JSON.parse(stderr)).toMatchObject({ details: { line: 'cross' } })

    stderr = ''
    await installByUrl([A1], { ...JSON_OUTPUT, allowIssuerChange: ['agencies.test'] }, run.deps)
    expect(run.requests[0]!.domains[0]).toMatchObject({
      consent: { issuer: { from: A_LEGACY, to: A1 } },
    })
  })

  test('rolling back to a legacy domain.json source needs the consent and the identity-override gate', async () => {
    const run = moving(A1, A_LEGACY, servedLegacy('agencies.test', A_LEGACY))

    await expect(
      installByUrl([A_LEGACY], { ...JSON_OUTPUT, allowIssuerChange: ['agencies.test'] }, run.deps),
    ).rejects.toBeInstanceOf(ExitError)
    expect(JSON.parse(stderr)).toMatchObject({ error: 'IDENTITY_OVERRIDE_REJECTED' })

    stderr = ''
    await expect(
      installByUrl([A_LEGACY], { ...JSON_OUTPUT, allowIdentityOverride: true }, run.deps),
    ).rejects.toBeInstanceOf(ExitError)
    expect(JSON.parse(stderr)).toMatchObject({ error: 'ISSUER_CHANGE_NOT_CONSENTED' })
    expect(run.requests).toEqual([])

    await installByUrl(
      [A_LEGACY],
      { ...JSON_OUTPUT, allowIdentityOverride: true, allowIssuerChange: ['agencies.test'] },
      run.deps,
    )
    expect(run.requests[0]!.domains).toEqual([
      { release: { url: A_LEGACY }, consent: { issuer: { from: A1, to: A_LEGACY } } },
    ] as never)
  })

  test('moves grouped Domains to new deployments with one consent per changed root', async () => {
    const B1 = `https://employees-eeeeeeeeeeeeeeee-bbbbbbbbbbbbbbbb.deployments.test`
    const B2 = `https://employees-eeeeeeeeeeeeeeee-cccccccccccccccc.deployments.test`
    const a = servedRelease('agencies.test', A2, '2')
    const b = servedRelease('employees.test', B2, '3')
    const run = harness({
      served: { [A2]: async () => a, [B2]: async () => b },
      listing: async (call) =>
        call === 0
          ? [
              installedFrom(servedRelease('agencies.test', A1, '1'), A1),
              installedFrom(servedRelease('employees.test', B1, '4'), B1),
            ]
          : [installedFrom(a, A2), installedFrom(b, B2)],
      install: async () =>
        committed(['agencies.test', 'employees.test'], GENERATED, [
          'agencies.test',
          'employees.test',
        ]),
    })

    await installByUrl([A2, B2], { ...JSON_OUTPUT, allowIssuerChange: [''] }, run.deps)

    expect(run.requests).toHaveLength(1)
    expect(
      run.requests[0]!.domains.map((domain) => (domain as { consent?: unknown }).consent),
    ).toEqual([{ issuer: { from: A1, to: A2 } }, { issuer: { from: B1, to: B2 } }])
  })

  test('sends no consent when the issuer does not change, whatever the flags', async () => {
    const run = moving(A2, A2)

    await installByUrl(
      [A2],
      { ...JSON_OUTPUT, allowIssuerChange: ['', 'agencies.test'], revokePrevious: true },
      run.deps,
    )

    expect(run.requests[0]!.domains).toEqual([
      { release: { url: A2, digest: digest('2') } },
    ] as never)
    expect(JSON.parse(stdout).references[0]).not.toHaveProperty('consent')
  })

  test('refuses an origin-scoped consent that names no Domain of the install', async () => {
    const run = moving(A1, A2)

    await expect(
      installByUrl([A2], { ...JSON_OUTPUT, allowIssuerChange: ['crm.test'] }, run.deps),
    ).rejects.toBeInstanceOf(ExitError)
    expect(run.requests).toEqual([])
    expect(JSON.parse(stderr)).toMatchObject({ error: 'INVALID_FLAG' })
  })

  test('the retry command of an outcome-unknown install repeats its consents', async () => {
    const unknown = harness({
      served: { [A_OTHER_LINE]: async () => servedRelease('agencies.test', A_OTHER_LINE, '2') },
      listing: async () => [installedFrom(servedRelease('agencies.test', A1, '1'), A1)],
      install: async () => {
        throw transportFailure('Invocation outcome is unknown.', 'unknown', {
          kind: 'invocation',
          delivery: 'unknown',
        })
      },
    })

    await expect(
      installByUrl(
        [A_OTHER_LINE],
        {
          ...JSON_OUTPUT,
          allowIssuerChange: ['agencies.test'],
          revokePrevious: true,
          instance: 'staging',
        },
        unknown.deps,
      ),
    ).rejects.toBeInstanceOf(ExitError)
    expect(JSON.parse(stderr)).toMatchObject({
      operation: GENERATED,
      retry: `astrale domain install ${A_OTHER_LINE} --operation ${GENERATED} --allow-issuer-change=agencies.test --revoke-previous -i staging`,
    })
  })

  test('a consent refused because its install already committed is reported as already current (AM-81)', async () => {
    const a2 = servedRelease('agencies.test', A2, '2')
    const run = harness({
      served: { [A2]: async () => a2 },
      // The listing read before the install is stale: another run committed the move since.
      listing: async (call) =>
        call === 0
          ? [installedFrom(servedRelease('agencies.test', A1, '1'), A1)]
          : [installedFrom(a2, A2)],
      install: async () => {
        throw consentOnUnchangedRoot()
      },
    })

    await installByUrl([A2], { ...JSON_OUTPUT, allowIssuerChange: [''] }, run.deps)

    expect(run.requests).toHaveLength(1)
    const report = JSON.parse(stdout)
    expect(report).toMatchObject({
      changed: false,
      domains: [{ origin: 'agencies.test' }],
      references: [{ origin: 'agencies.test', installed: { issuer: A2, pin: a2.pin } }],
    })
    expect(report.references[0]).not.toHaveProperty('consent')
  })

  test('a retry under the same operation that conflicts is checked against the installations too', async () => {
    const a2 = servedRelease('agencies.test', A2, '2')
    const run = harness({
      served: { [A2]: async () => a2 },
      listing: async () => [installedFrom(a2, A2)],
      install: async () => {
        throw new ResponseError(4009 as never, 'Operation conflict.', INVOCATION, {
          code: 'SCHEMA_OPERATION_CONFLICT',
          details: { operation: RETRY },
        })
      },
    })

    await installByUrl(
      [A2],
      { ...JSON_OUTPUT, operation: RETRY },
      { ...run.deps, acceptOperationId: () => RETRY },
    )
    expect(JSON.parse(stdout)).toMatchObject({ changed: false })
  })

  test('reports the refusal when the installations do not hold what was asked', async () => {
    const run = harness({
      served: { [A2]: async () => servedRelease('agencies.test', A2, '2') },
      listing: async () => [installedFrom(servedRelease('agencies.test', A1, '1'), A1)],
      install: async () => {
        throw consentOnUnchangedRoot()
      },
    })

    await expect(
      installByUrl([A2], { ...JSON_OUTPUT, allowIssuerChange: [''] }, run.deps),
    ).rejects.toBeInstanceOf(ExitError)
    expect(JSON.parse(stderr)).toMatchObject({
      error: 'RESPONSE_ERROR',
      reason: { code: 'SCHEMA_INPUT_INVALID', details: { path: '/domains/0/consent' } },
    })
  })

  test('prints the consent beside the root line for humans', async () => {
    const run = moving(A1, A2)
    const { lines, warnings } = await human(() =>
      installByUrl([A2], { allowIssuerChange: [''] }, run.deps),
    )

    expect(warnings).toContain(
      `Issuer change consented via --allow-issuer-change: agencies.test ${A1} -> ${A2}`,
    )
    expect(lines).toContain('agencies.test  replaced')
    expect(lines).toContain(
      `agencies.test: issuer ${A1} -> ${A2} (same line; the previous issuer drains)`,
    )
  })
})

describe('install by URL on a Kernel without the installed listing (pre-release request)', () => {
  test('sends the exact pre-release publication request after the refused probe', async () => {
    const deployed = releaseFor(defineSchema('crm.test', {}), 'https://crm.test').publication
    globalThis.fetch = mock(async () => Response.json(deployed)) as unknown as typeof fetch
    const read = mock(async () => {
      throw new Error('the legacy path reads no release.json')
    })
    const run = harness({
      listing: async () => {
        throw unsupportedListing()
      },
      install: async () => committed(['crm.test']),
    })

    await installByUrl(
      ['https://crm.test'],
      { json: true, direct: true, allowIdentityOverride: true } as never,
      { ...run.deps, readDeployment: read },
    )

    expect(run.listings).toBe(1)
    expect(read).not.toHaveBeenCalled()
    expect(JSON.stringify(run.requests)).toBe(
      `[{"operation":"${GENERATED}","domains":[{"publication":{"url":"https://crm.test"}}]}]`,
    )
    // The pre-release output: the Kernel result alone.
    expect(JSON.parse(stdout)).toEqual(JSON.parse(JSON.stringify(committed(['crm.test']))))
  })

  test('keeps the pre-release recovery command for an outcome-unknown install', async () => {
    globalThis.fetch = mock(async () => new Response('missing', { status: 404 })) as never
    const run = harness({
      listing: async () => {
        throw unsupportedListing()
      },
      install: async () => {
        throw transportFailure('Invocation outcome is unknown.', 'unknown', {
          kind: 'invocation',
          delivery: 'unknown',
        })
      },
    })

    await expect(
      installByUrl(['https://crm.test'], { json: true, instance: 'legacy' }, run.deps),
    ).rejects.toBeInstanceOf(ExitError)
    expect(run.requests).toHaveLength(1)
    expect(JSON.parse(stderr)).toMatchObject({
      operation: GENERATED,
      retry: `astrale domain install https://crm.test --direct --operation ${GENERATED} -i legacy`,
    })
  })

  test('admits any http(s) URL, as before installs were grouped', async () => {
    globalThis.fetch = mock(async () => new Response('missing', { status: 404 })) as never
    const run = harness({
      listing: async () => {
        throw unsupportedListing()
      },
      install: async () => committed(['crm.example.test']),
    })

    await installByUrl(['https://CRM.example.test'], { json: true }, run.deps)
    expect(run.requests[0]!.domains).toEqual([{ publication: { url: 'https://CRM.example.test' } }])
  })

  test('refuses issuer consent before any install: such a Kernel takes none', async () => {
    const run = harness({
      listing: async () => {
        throw unsupportedListing()
      },
    })

    for (const flags of [{ allowIssuerChange: [''] }, { revokePrevious: true }]) {
      stderr = ''
      await expect(
        installByUrl(['https://crm.test'], { json: true, ...flags }, run.deps),
      ).rejects.toBeInstanceOf(ExitError)
      expect(JSON.parse(stderr)).toMatchObject({ error: 'KERNEL_RELEASE_UNSUPPORTED' })
    }
    expect(run.listings).toBe(2)
    expect(run.requests).toEqual([])
  })

  test('propagates any other probe failure without installing', async () => {
    const run = harness({
      listing: async () => {
        throw new ResponseError(2002 as never, 'Authentication is invalid.', INVOCATION, {
          code: 'AUTH_INVALID',
          details: {},
        })
      },
    })

    await expect(installByUrl([A], { json: true }, run.deps)).rejects.toBeInstanceOf(ExitError)
    expect(run.requests).toEqual([])
    expect(JSON.parse(stderr)).toMatchObject({ error: 'RESPONSE_ERROR', code: 2002 })
  })
})

describe('root status from the Kernel result', () => {
  test('reads installed, replaced and unchanged from the receipt, unknown without an origin', () => {
    const result = committed(['agencies.test', 'employees.test'], GENERATED, ['employees.test'])
    expect(rootStatus(result, 'agencies.test')).toBe('installed')
    expect(rootStatus(result, 'employees.test')).toBe('replaced')
    expect(rootStatus(result, 'crm.test')).toBe('unchanged')
    expect(rootStatus(result, null)).toBe('unknown')
    expect(rootStatus(current(['agencies.test']), 'agencies.test')).toBe('unchanged')
    expect(rootStatus(current(['agencies.test']), null)).toBe('unchanged')
  })
})

describe('install by URL argument admission', () => {
  test('rejects a non-UUID operation before metadata or Kernel transport', async () => {
    const run = harness({})
    await expect(
      installByUrl([A], { json: true, operation: 'guessable-operation' }, run.deps),
    ).rejects.toBeInstanceOf(ExitError)
    expect(run.credentials).toEqual([])
    expect(JSON.parse(stderr)).toMatchObject({ error: 'INVALID_FLAG' })
  })

  test('sends a delivery token to one URL reference only', async () => {
    const run = harness({})
    await expect(
      installByUrl([A, B], { json: true, token: 'secret' }, run.deps),
    ).rejects.toBeInstanceOf(ExitError)
    expect(run.credentials).toEqual([])
    expect(JSON.parse(stderr)).toMatchObject({ error: 'INVALID_FLAG' })
  })
})
