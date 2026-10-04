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

/** URL installs below consent to the identity override every deployment URL carries. */
const CONSENTED = { json: true, allowIdentityOverride: true } as const

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

    await installByUrl([A], CONSENTED, run.deps)

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

    await installByUrl([B, A], CONSENTED, run.deps)

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

    await expect(installByUrl([A, B], CONSENTED, run.deps)).rejects.toBeInstanceOf(ExitError)
    expect(run.requests).toEqual([])
    expect(JSON.parse(stderr)).toMatchObject({ error: 'DUPLICATE_ORIGIN' })
  })

  test('refuses the same deployment named twice before connecting', async () => {
    const run = harness({})
    await expect(installByUrl([A, `${A}/`], CONSENTED, run.deps)).rejects.toBeInstanceOf(ExitError)
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
      await installByUrl([A, B], { allowIdentityOverride: true }, run.deps)
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
      await installByUrl([A, B], { allowIdentityOverride: true }, run.deps)
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

    await installByUrl(['https://crm.test'], CONSENTED, run.deps)

    expect(run.requests[0]!.domains).toEqual([{ release: { url: 'https://crm.test' } }])
    expect(JSON.parse(stdout).references[0].installed.pin).toEqual(served.pin)
  })

  test('installs an unreadable deployment without a digest and reports the Kernel pin', async () => {
    const a = servedRelease('agencies.test', A, '1')
    const run = harness({
      listing: async (call) => (call === 0 ? [] : [installedFrom(a, A)]),
    })

    await installByUrl([A], CONSENTED, run.deps)

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

    await installByUrl([A], CONSENTED, run.deps)

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

    await installByUrl([A], CONSENTED, run.deps)

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

    await expect(installByUrl([A], CONSENTED, run.deps)).rejects.toBeInstanceOf(ExitError)
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

    await expect(installByUrl([A], CONSENTED, run.deps)).rejects.toBeInstanceOf(ExitError)
    expect(JSON.parse(stdout).references[0].installed.pin.release).toBe(digest('7'))
    expect(JSON.parse(stderr)).toMatchObject({ error: 'INSTALLED_PIN_MISMATCH' })
  })

  test('keeps the identity-override gate for a deployment URL that serves another origin', async () => {
    const run = harness({ served: { [A]: async () => servedRelease('agencies.test', A, '1') } })

    await expect(installByUrl([A], { json: true }, run.deps)).rejects.toBeInstanceOf(ExitError)
    expect(run.requests).toEqual([])
    expect(JSON.parse(stderr)).toMatchObject({ error: 'IDENTITY_OVERRIDE_REJECTED' })
  })

  test('refuses a URL not written as the Kernel reads it before any install', async () => {
    const run = harness({})
    await expect(
      installByUrl(['https://CRM.example.test'], CONSENTED, run.deps),
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
      { ...CONSENTED, operation: RETRY, instance: 'staging' },
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
