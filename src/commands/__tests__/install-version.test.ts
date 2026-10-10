import type { InstalledRelease, InstallRequest, InstallResult } from '@astrale-os/sdk/client/schema'

import { ResponseError } from '@astrale-os/sdk/client'
import { defineSchema, schema } from '@astrale-os/sdk/schema'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { stripVTControlCharacters } from 'node:util'

import type { withAdminClientSession } from '../../connection'
import type { ServedDeployment } from '../../lib/domain-release'
import type { ReferenceInstallDependencies } from '../domain/release-install'

import { deploymentReleaseFor } from '../../__tests__/fixtures/publication'
import { connectAdminRegistry } from '../../admin/registry'
import {
  fakeAdmin,
  publication,
  release,
  type FakeDomain,
  type FakePublication,
  type FakeRelease,
} from '../../admin/registry/__tests__/fake-admin'
import { transportFailure } from '../../connection/__tests__/failure-fixtures'
import { DeploymentReadError } from '../../lib/domain-release'
import { installByReference, openInstallRegistry } from '../domain/release-install'
import { isVersionReference } from '../domain/version-reference'

/**
 * Résolution (V2): `install <origin>@<version>` reads the Domain's Publications in Admin with the
 * caller's credential, picks one, and installs its deployment URL guarded by its release digest.
 * Admin is the fake registry of src/admin/registry/__tests__ (Admin's read rules: an unreadable
 * Domain reads as absent); the instance Kernel is a fake session that records every request.
 */

const GENERATED = '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8'
const ORIGIN = 'agencies.test'
const INSTALLER = 'installer'
const OUTSIDER = 'outsider'
const REVISION = schema.revision(defineSchema(ORIGIN, { name: 'Test Domain' }))
const INVOCATION = {
  source: 'https://kernel.test',
  id: 'install-version',
} as ConstructorParameters<typeof ResponseError>[2]

const releases = {
  v140: release('agencies-v140'),
  v150: release('agencies-v150'),
  v151: release('agencies-v151'),
  v152: release('agencies-v152'),
  v160rc: release('agencies-v160rc'),
  v200rc: release('agencies-v200rc'),
  v300: release('agencies-v300'),
}

/** 1.5.2 is yanked; 1.6.x and 2.0.x have pre-releases only; 3.0.0 is the only (yanked) 3.0.x. */
function publications(): FakePublication[] {
  return [
    publication('140', '1.4.0', releases.v140),
    publication('150', '1.5.0', releases.v150),
    publication('151', '1.5.1', releases.v151),
    publication('152', '1.5.2', releases.v152, { yankedAt: '2026-10-04T11:00:00.000Z' }),
    publication('160', '1.6.0-rc.1', releases.v160rc),
    publication('200', '2.0.0-rc.1', releases.v200rc),
    publication('300', '3.0.0', releases.v300, { yankedAt: '2026-10-04T11:30:00.000Z' }),
  ]
}

function domain(publicationsOf: FakePublication[] = publications()): FakeDomain {
  // The installer holds domain_installer, here directly; a Group expands the same way in Admin.
  return {
    id: 'domain-agencies',
    origin: ORIGIN,
    admins: new Set(['publisher']),
    installers: new Set([INSTALLER]),
    publications: publicationsOf,
  }
}

function served(source: FakeRelease, origin = ORIGIN): ServedDeployment {
  return {
    origin,
    issuer: source.url,
    revision: REVISION,
    pin: { kind: 'release', release: source.releaseDigest, build: source.buildDigest },
    release: deploymentReleaseFor(defineSchema(origin, { name: 'Test Domain' }), source.url)
      .document,
  }
}

function installedFrom(deployment: ServedDeployment, url: string): InstalledRelease {
  return {
    origin: deployment.origin,
    revision: deployment.revision,
    issuer: deployment.issuer,
    url: new URL(url).origin,
    pin: deployment.pin,
    inFlight: [],
  } as unknown as InstalledRelease
}

function committed(origins: readonly string[]): InstallResult {
  return {
    changed: true,
    receipt: {
      operation: GENERATED,
      transitions: origins.map((origin, index) => ({
        intent: {
          transition: `transition-${index}`,
          operation: GENERATED,
          origin,
          previous: null,
          generation: { origin, revision: REVISION, generation: `sha256:${'e'.repeat(64)}` },
        },
        phase: 'cutover',
        state: 'committed',
      })),
    },
  } as unknown as InstallResult
}

class ExitError extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`process.exit(${String(code)})`)
  }
}

interface Run {
  readonly requests: InstallRequest[]
  readonly sessions: number
  readonly registries: number
  readonly reads: string[]
  readonly queries: number
  readonly deps: Partial<ReferenceInstallDependencies>
}

function run(options: {
  readonly caller?: string
  readonly domains?: FakeDomain[]
  readonly served?: Readonly<Record<string, () => Promise<ServedDeployment>>>
  readonly listing?: (call: number) => Promise<readonly InstalledRelease[]>
  readonly install?: (request: InstallRequest) => Promise<InstallResult>
  readonly registry?: 'down'
}): Run {
  const admin = fakeAdmin({
    caller: options.caller ?? INSTALLER,
    domains: options.domains ?? [domain()],
  })
  const requests: InstallRequest[] = []
  const reads: string[] = []
  let sessions = 0
  let registries = 0
  let listings = 0
  const session = {
    schema: {
      installed: async () => options.listing?.(listings++) ?? (listings++, []),
      install: async (request: InstallRequest) => {
        requests.push(request)
        return (options.install ?? (async () => committed([ORIGIN])))(request)
      },
      inspect: async (origin: string) => ({ origin, revision: REVISION }),
    },
  }
  return {
    requests,
    reads,
    get sessions() {
      return sessions
    },
    get registries() {
      return registries
    },
    get queries() {
      return admin.queries.length
    },
    deps: {
      createOperationId: () => GENERATED,
      withClientSession: (async (_opts: unknown, action: (context: never) => Promise<unknown>) => {
        sessions += 1
        return action({ session } as never)
      }) as unknown as ReferenceInstallDependencies['withClientSession'],
      openRegistry: async (_opts, work) => {
        registries += 1
        if (options.registry === 'down') {
          throw transportFailure('Admin is unreachable.', 'connect', {
            kind: 'invocation',
            delivery: 'not-sent',
          })
        }
        return work(connectAdminRegistry(admin.context))
      },
      readDeployment: async (url: string) => {
        reads.push(url)
        const read = options.served?.[url]
        if (read === undefined) throw new DeploymentReadError(`GET ${url} failed.`)
        return read()
      },
      // The advisory pre-check reads each root's bundle; offline, it reads as unreachable
      // ('bundle-unread'). A real fetch put a DNS lookup of a *.test host inside the test timeout.
      readBundle: async (_release, url) => {
        throw new DeploymentReadError(`GET ${url} bundle failed.`)
      },
      now: () => 0,
      sleep: async () => {},
    },
  }
}

let stdout = ''
let stderr = ''
let originalExit: typeof process.exit
let originalStdout: typeof process.stdout.write
let originalStderr: typeof process.stderr.write

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
})

const JSON_OUTPUT = { json: true } as const

/** Run for humans: a terminal on stdout, console output captured. */
async function human(action: () => Promise<void>): Promise<{ lines: string; warnings: string }> {
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
    await action()
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

describe('install by version (Résolution [.78020]-[.78492])', () => {
  test('@1.5 installs the highest stable 1.5.x that is not yanked, guarded by its release digest', async () => {
    const v151 = served(releases.v151)
    const install = run({
      served: { [releases.v151.url]: async () => v151 },
      listing: async (call) => (call === 0 ? [] : [installedFrom(v151, releases.v151.url)]),
    })

    await installByReference([`${ORIGIN}@1.5`], JSON_OUTPUT, install.deps)

    // One index read: the Publications in one Query, the Domain itself not asked again.
    expect(install.registries).toBe(1)
    expect(install.queries).toBe(1)
    expect(install.reads).toEqual([releases.v151.url])
    expect(install.requests).toEqual([
      {
        operation: GENERATED,
        domains: [{ release: { url: releases.v151.url, digest: releases.v151.releaseDigest } }],
      } as never,
    ])
    expect(JSON.parse(stdout).references).toEqual([
      {
        reference: `${ORIGIN}@1.5`,
        origin: ORIGIN,
        url: releases.v151.url,
        version: '1.5.1',
        pin: v151.pin,
        previous: null,
        installed: { revision: REVISION, pin: v151.pin, issuer: releases.v151.url },
      },
    ])
  })

  test('an exact version installs that version, a pre-release included', async () => {
    const rc = served(releases.v200rc)
    const install = run({ served: { [releases.v200rc.url]: async () => rc } })

    await installByReference([`${ORIGIN}@2.0.0-rc.1`], JSON_OUTPUT, install.deps)

    expect(install.requests[0]!.domains).toEqual([
      { release: { url: releases.v200rc.url, digest: releases.v200rc.releaseDigest } },
    ] as never)
    const reference = JSON.parse(stdout).references[0]
    expect(reference).toMatchObject({ version: '2.0.0-rc.1' })
    // `yanked` is present only on a yanked version.
    expect(reference).not.toHaveProperty('yanked')
  })

  test('a yanked version installs only when named exactly, with a warning ([.79339])', async () => {
    const v152 = served(releases.v152)
    const machine = run({ served: { [releases.v152.url]: async () => v152 } })
    await installByReference([`${ORIGIN}@1.5.2`], JSON_OUTPUT, machine.deps)
    expect(JSON.parse(stdout).references[0]).toMatchObject({ version: '1.5.2', yanked: true })

    const person = run({
      served: { [releases.v152.url]: async () => v152 },
      listing: async (call) => (call === 0 ? [] : [installedFrom(v152, releases.v152.url)]),
    })
    const { lines, warnings } = await human(() =>
      installByReference([`${ORIGIN}@1.5.2`], {}, person.deps),
    )
    expect(warnings).toContain(
      `${ORIGIN} 1.5.2 is yanked: it is installed only because ${ORIGIN}@1.5.2 names it exactly.`,
    )
    expect(lines).toContain(`  ${ORIGIN}  installed  1.5.2 (yanked) release sha256:`)
  })

  test('prints one line per root with the version it resolved to ([.78492])', async () => {
    const v151 = served(releases.v151)
    const install = run({
      served: { [releases.v151.url]: async () => v151 },
      listing: async (call) => (call === 0 ? [] : [installedFrom(v151, releases.v151.url)]),
    })

    const { lines, warnings } = await human(() =>
      installByReference([`${ORIGIN}@1.5`], {}, install.deps),
    )

    expect(lines).toContain(`Domain installed (operation ${GENERATED})`)
    expect(lines).toContain(
      `  ${ORIGIN}  installed  1.5.1 release ${releases.v151.releaseDigest.slice(0, 19)}`,
    )
    // The registry names the deployment of a version: no unverified-claim notice.
    expect(warnings).not.toContain('claimed by unverified deployment')
  })

  test.each([
    ['@1.6', 'no-stable-match', 'stable 1.6.x'],
    ['@3.0', 'yanked-only', 'Every published 3.0.x version'],
    ['@1.9', 'no-stable-match', 'stable 1.9.x'],
    ['@1.5.9', 'unknown-version', 'no published version 1.5.9'],
  ] as const)(
    '%s resolves to nothing: VERSION_UNRESOLVED (%s), the Kernel never contacted',
    async (selector, reason, message) => {
      const install = run({})

      await expect(
        installByReference([`${ORIGIN}${selector}`], JSON_OUTPUT, install.deps),
      ).rejects.toBeInstanceOf(ExitError)

      expect(install.sessions).toBe(0)
      expect(install.requests).toEqual([])
      const refusal = JSON.parse(stderr)
      expect(refusal).toMatchObject({
        error: 'VERSION_UNRESOLVED',
        details: { origin: ORIGIN, reference: `${ORIGIN}${selector}`, reason },
      })
      expect(refusal.message).toContain(message)
    },
  )

  test('a caller without domain_installer reads the Domain as absent ([.79495])', async () => {
    const install = run({ caller: OUTSIDER })

    await expect(
      installByReference([`${ORIGIN}@1.5`], JSON_OUTPUT, install.deps),
    ).rejects.toBeInstanceOf(ExitError)

    expect(install.sessions).toBe(0)
    expect(JSON.parse(stderr)).toMatchObject({
      error: 'REGISTRY_DOMAIN_NOT_FOUND',
      details: { origin: ORIGIN },
    })
  })

  test.each(['@1', '@^1.5', '@1.5.x', '@1.5.0+build.7', '@v1.5.0'])(
    '%s is refused before Admin is opened (PUBLICATION_VERSION_INVALID)',
    async (selector) => {
      const install = run({})

      await expect(
        installByReference([`${ORIGIN}${selector}`], JSON_OUTPUT, install.deps),
      ).rejects.toBeInstanceOf(ExitError)

      expect(install.registries).toBe(0)
      expect(install.sessions).toBe(0)
      expect(JSON.parse(stderr)).toMatchObject({
        error: 'PUBLICATION_VERSION_INVALID',
        details: { reference: `${ORIGIN}${selector}` },
      })
    },
  )

  test.each([
    'Agencies.test@1.5',
    'agencies@1.5.0',
    '@1.5',
    'agencies_test@1.5',
    'HTTPS://agencies.test@1.5',
  ])(
    '%s: the part before @ is not an origin, refused before Admin is opened (INVALID_ARGUMENT)',
    async (reference) => {
      const install = run({})

      await expect(
        installByReference([reference], JSON_OUTPUT, install.deps),
      ).rejects.toBeInstanceOf(ExitError)

      expect(install.registries).toBe(0)
      expect(install.sessions).toBe(0)
      expect(JSON.parse(stderr)).toMatchObject({ error: 'INVALID_ARGUMENT' })
    },
  )

  test('versions and URLs mix in one atomic install, in the order written ([.79126])', async () => {
    const employees = release('employees-url')
    const v151 = served(releases.v151)
    const e = served(employees, 'employees.test')
    const install = run({
      served: { [releases.v151.url]: async () => v151, [employees.url]: async () => e },
      install: async () => committed(['employees.test', ORIGIN]),
    })

    await installByReference([employees.url, `${ORIGIN}@1.5`], JSON_OUTPUT, install.deps)

    expect(install.requests).toHaveLength(1)
    expect(install.requests[0]!.domains).toEqual([
      { release: { url: employees.url, digest: employees.releaseDigest } },
      { release: { url: releases.v151.url, digest: releases.v151.releaseDigest } },
    ] as never)
    const references = JSON.parse(stdout).references as Record<string, unknown>[]
    expect(references.map(({ reference }) => reference)).toEqual([employees.url, `${ORIGIN}@1.5`])
    expect(references[0]).not.toHaveProperty('version')
    expect(references[0]).not.toHaveProperty('yanked')
  })

  test('Admin down fails the version references only, before any Kernel call', async () => {
    const down = run({ registry: 'down' })
    await expect(
      installByReference([`${ORIGIN}@1.5`], JSON_OUTPUT, down.deps),
    ).rejects.toBeInstanceOf(ExitError)
    expect(down.sessions).toBe(0)
    expect(JSON.parse(stderr)).toMatchObject({
      error: 'REGISTRY_UNAVAILABLE',
      details: { reason: 'transport' },
    })

    stderr = ''
    const v151 = served(releases.v151)
    const urls = run({ registry: 'down', served: { [releases.v151.url]: async () => v151 } })
    await installByReference([releases.v151.url], JSON_OUTPUT, urls.deps)
    expect(urls.registries).toBe(0)
    expect(urls.requests).toHaveLength(1)
  })

  test('the served release is checked first: another release is refused before any install', async () => {
    const install = run({
      served: { [releases.v151.url]: async () => served(releases.v150) },
    })

    await expect(
      installByReference([`${ORIGIN}@1.5`], JSON_OUTPUT, install.deps),
    ).rejects.toBeInstanceOf(ExitError)

    expect(install.requests).toEqual([])
    expect(JSON.parse(stderr)).toMatchObject({
      error: 'PUBLICATION_RELEASE_MISMATCH',
      details: {
        origin: ORIGIN,
        version: '1.5.1',
        url: releases.v151.url,
        expected: releases.v151.releaseDigest,
        served: releases.v150.releaseDigest,
      },
    })
  })
  test('an unreadable deployment is installed with the Publication digest; the Kernel decides', async () => {
    const guard = () =>
      new ResponseError(4001 as never, 'Schema revision conflict.', INVOCATION, {
        code: 'SCHEMA_REVISION_CONFLICT',
        details: {
          phase: 'guard',
          origin: ORIGIN,
          expected: releases.v151.releaseDigest,
          actual: releases.v150.releaseDigest,
        },
      })
    const install = run({
      install: async () => {
        throw guard()
      },
    })

    await expect(
      installByReference([`${ORIGIN}@1.5`], JSON_OUTPUT, install.deps),
    ).rejects.toBeInstanceOf(ExitError)

    expect(install.requests[0]!.domains).toEqual([
      { release: { url: releases.v151.url, digest: releases.v151.releaseDigest } },
    ] as never)
    expect(stderr).toContain('SCHEMA_REVISION_CONFLICT')
  })

  test('the retry command names each version exactly as it resolved, never its line', async () => {
    const v151 = served(releases.v151)
    const install = run({
      served: { [releases.v151.url]: async () => v151 },
      install: async () => {
        throw transportFailure('Invocation outcome is unknown.', 'unknown', {
          kind: 'invocation',
          delivery: 'unknown',
        })
      },
    })

    await expect(
      installByReference(
        [`${ORIGIN}@1.5`],
        { ...JSON_OUTPUT, instance: 'acme-prod', adminUrl: 'https://admin.test/api' },
        install.deps,
      ),
    ).rejects.toBeInstanceOf(ExitError)

    expect(JSON.parse(stderr)).toMatchObject({
      operation: GENERATED,
      retry: `astrale domain install ${ORIGIN}@1.5.1 --operation ${GENERATED} -i acme-prod --admin-url https://admin.test/api`,
    })
  })

  test('an installed-list refusal propagates without downgrading or installing', async () => {
    const install = run({
      listing: async () => {
        throw new ResponseError(1003, 'Function input is invalid.', INVOCATION, {
          code: 'FUNCTION_INPUT_INVALID',
          details: { issues: [{ code: 'invalid_union', path: '/kind', message: 'Invalid input' }] },
        })
      },
    })

    await expect(
      installByReference([`${ORIGIN}@1.5`], JSON_OUTPUT, install.deps),
    ).rejects.toBeInstanceOf(ExitError)

    expect(install.requests).toEqual([])
    expect(install.reads).toEqual([])
    expect(JSON.parse(stderr)).toMatchObject({
      error: 'RESPONSE_ERROR',
      code: 1003,
      reason: { code: 'FUNCTION_INPUT_INVALID' },
    })
  })

  test('two references to one origin are refused: two versions before Admin, a version and a URL after the read', async () => {
    const twice = run({})
    await expect(
      installByReference([`${ORIGIN}@1.5`, `${ORIGIN}@1.4.0`], JSON_OUTPUT, twice.deps),
    ).rejects.toBeInstanceOf(ExitError)
    expect(JSON.parse(stderr)).toMatchObject({ error: 'DUPLICATE_ORIGIN' })
    expect(twice.registries).toBe(0)
    expect(twice.sessions).toBe(0)

    // Admin down does not hide the local refusal: the registry is never opened for it.
    stderr = ''
    const down = run({ registry: 'down' })
    await expect(
      installByReference([`${ORIGIN}@1.5`, `${ORIGIN}@1.4.0`], JSON_OUTPUT, down.deps),
    ).rejects.toBeInstanceOf(ExitError)
    expect(JSON.parse(stderr)).toMatchObject({ error: 'DUPLICATE_ORIGIN' })
    expect(down.registries).toBe(0)

    stderr = ''
    const other = release('agencies-url')
    const mixed = run({
      served: {
        [releases.v151.url]: async () => served(releases.v151),
        [other.url]: async () => served(other),
      },
    })
    await expect(
      installByReference([other.url, `${ORIGIN}@1.5`], JSON_OUTPUT, mixed.deps),
    ).rejects.toBeInstanceOf(ExitError)
    expect(JSON.parse(stderr)).toMatchObject({ error: 'DUPLICATE_ORIGIN' })
    expect(mixed.requests).toEqual([])

    stderr = ''
    const same = run({ served: { [releases.v151.url]: async () => served(releases.v151) } })
    await expect(
      installByReference([releases.v151.url, `${ORIGIN}@1.5`], JSON_OUTPUT, same.deps),
    ).rejects.toBeInstanceOf(ExitError)
    expect(JSON.parse(stderr)).toMatchObject({ error: 'DUPLICATE_ORIGIN' })
    expect(same.sessions).toBe(0)
  })

  test('--token names one URL: a version never carries one', async () => {
    const install = run({})
    await expect(
      installByReference([`${ORIGIN}@1.5`], { ...JSON_OUTPUT, token: 'secret' }, install.deps),
    ).rejects.toBeInstanceOf(ExitError)
    expect(install.registries).toBe(0)
    expect(JSON.parse(stderr)).toMatchObject({ error: 'INVALID_FLAG' })
  })

  test('a Publication whose deployment URL is not a reference is refused, never installed', async () => {
    const queried = { ...releases.v151, url: `${releases.v151.url}/?preview=1` }
    const install = run({
      domains: [domain([publication('151', '1.5.1', queried)])],
    })

    await expect(
      installByReference([`${ORIGIN}@1.5`], JSON_OUTPUT, install.deps),
    ).rejects.toBeInstanceOf(ExitError)

    expect(install.sessions).toBe(0)
    expect(JSON.parse(stderr)).toMatchObject({
      error: 'REGISTRY_UNAVAILABLE',
      details: { reason: 'response-invalid', reference: `${ORIGIN}@1.5`, version: '1.5.1' },
    })
  })

  test('an http:// deployment URL is installed as Admin wrote it', async () => {
    const local = { ...releases.v151, url: 'http://agencies-local-0123456789abcdef.localhost:8787' }
    const deployment = served(local)
    const install = run({
      domains: [domain([publication('151', '1.5.1', local)])],
      served: { [local.url]: async () => deployment },
    })

    await installByReference([`${ORIGIN}@1.5`], JSON_OUTPUT, install.deps)

    expect(install.requests[0]!.domains).toEqual([
      { release: { url: local.url, digest: local.releaseDigest } },
    ] as never)
    expect(JSON.parse(stdout).references[0].url).toBe(local.url)
  })

  test('--allow-issuer-change=<origin> may name the origin of a version reference', async () => {
    const before = installedFrom(served(releases.v150), releases.v150.url)
    const v151 = served(releases.v151)
    const install = run({
      served: { [releases.v151.url]: async () => v151 },
      listing: async (call) => (call === 0 ? [before] : [installedFrom(v151, releases.v151.url)]),
    })

    await installByReference(
      [`${ORIGIN}@1.5`],
      { ...JSON_OUTPUT, allowIssuerChange: [ORIGIN] },
      install.deps,
    )

    expect(install.requests[0]!.domains).toEqual([
      {
        release: { url: releases.v151.url, digest: releases.v151.releaseDigest },
        consent: { issuer: { from: releases.v150.url, to: releases.v151.url } },
      },
    ] as never)
  })
})

describe('the registry is read on the Admin target with the caller identity ([.79495])', () => {
  /** The Admin session seam: records the options it is opened with, then serves the fake Admin. */
  function adminSession(): {
    readonly options: unknown[]
    readonly open: typeof withAdminClientSession
  } {
    const admin = fakeAdmin({ caller: INSTALLER, domains: [domain()] })
    const options: unknown[] = []
    const open = (async (selected: unknown, action: (context: never) => Promise<unknown>) => {
      options.push(selected)
      return action(admin.context as never)
    }) as unknown as typeof withAdminClientSession
    return { options, open }
  }

  test.each([
    {
      name: '-i with --as, --admin-url, --domain-issuer, --timeout and --ci',
      opts: {
        instance: 'acme-prod',
        as: INSTALLER,
        adminUrl: 'https://admin.test/api',
        domainIssuer: 'https://admin.test',
        timeout: '5000',
        ci: true,
      },
      admin: {
        adminUrl: 'https://admin.test/api',
        domainIssuer: 'https://admin.test',
        timeout: '5000',
        as: INSTALLER,
        ci: true,
      },
    },
    {
      name: '--url with --creds and --admin',
      opts: {
        url: 'https://kernel.test',
        creds: 'raw-instance-credential',
        admin: 'staging-admin',
      },
      admin: { admin: 'staging-admin' },
    },
    {
      name: 'the configured Admin target',
      opts: { instance: 'acme-prod', anonymous: true },
      admin: {},
    },
  ])('$name: only the Admin selection reaches the registry session', async ({ opts, admin }) => {
    const session = adminSession()
    const v151 = served(releases.v151)
    const install = run({ served: { [releases.v151.url]: async () => v151 } })

    await installByReference(
      [`${ORIGIN}@1.5`],
      { ...JSON_OUTPUT, ...opts },
      {
        ...install.deps,
        openRegistry: (selected, work) => openInstallRegistry(selected, work, session.open),
      },
    )

    // Never the instance target (-i, --url), its raw credential (--creds) or --anonymous.
    expect(session.options).toEqual([admin])
    expect(install.requests[0]!.domains).toEqual([
      { release: { url: releases.v151.url, digest: releases.v151.releaseDigest } },
    ] as never)
  })

  test('a URL-only install never opens the Admin session', async () => {
    const session = adminSession()
    const v151 = served(releases.v151)
    const install = run({ served: { [releases.v151.url]: async () => v151 } })

    await installByReference([releases.v151.url], JSON_OUTPUT, {
      ...install.deps,
      openRegistry: (selected, work) => openInstallRegistry(selected, work, session.open),
    })

    expect(session.options).toEqual([])
    expect(install.requests).toHaveLength(1)
  })
})

describe('reference routing ([.78896]: the syntax decides)', () => {
  test('a version reference has no scheme and names its origin before @', () => {
    expect(isVersionReference('issues.astrale.ai@1.5')).toBe(true)
    expect(isVersionReference('issues.astrale.ai@2.0.0-rc.1')).toBe(true)
    expect(isVersionReference('issues.astrale.ai')).toBe(false)
    expect(isVersionReference('https://issues.astrale.ai@1.5.0')).toBe(false)
    expect(isVersionReference('http://localhost:8787')).toBe(false)
  })
})
