import type { InstalledRelease } from '@astrale-os/sdk/client/schema'

import { deploymentName } from '@astrale-os/sdk/versioning'
import { describe, expect, test } from 'bun:test'

import type { AdminRegistryApi } from '../../admin/registry'
import type { InstalledListDependencies } from '../domain/installed-list'

import { deploymentFixture, recordServer } from '../../__tests__/fixtures/deployment-record'
import { connectAdminRegistry, RegistryError } from '../../admin/registry'
import {
  fakeAdmin,
  publication,
  type FakeDomain,
  type FakeRelease,
} from '../../admin/registry/__tests__/fake-admin'
import { AstraleError } from '../../errors'
import { readDeploymentRecord } from '../../lib/deployment-record'
import { stripAnsi } from '../../lib/format'
import {
  describeInstalled,
  installedRows,
  listInstalled,
  renderInstalled,
} from '../domain/installed-list'
import { misplacedCatalogFlags } from '../domain/list'

const KERNEL = 'https://acme-stg.instances.astrale.test/kernel'
const REVISION = `sha256:${'5'.repeat(64)}`
const digest = (seed: string) =>
  `sha256:${Buffer.from(seed).toString('hex').padEnd(64, '0').slice(0, 64)}` as `sha256:${string}`
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

/** What a Publication stores of its release (Admin keeps no bundle copy). */
type PublishedRelease = Pick<FakeRelease, 'url' | 'releaseDigest' | 'buildDigest'>

/** A Publication's release, as Admin stores it: its deployment URL is its issuer. */
function served(url: string, release: string, build: string): PublishedRelease {
  return {
    url,
    releaseDigest: digest(`release:${release}`),
    buildDigest: digest(`build:${build}`),
  }
}

function installed(
  origin: string,
  url: string,
  pin: InstalledRelease['pin'],
  issuer = url,
): InstalledRelease {
  return {
    origin,
    revision: REVISION,
    issuer,
    url,
    pin,
    inFlight: [],
  } as unknown as InstalledRelease
}

// shell.astrale.ai: the instance runs exactly the release published as 0.9.1.
const shell091 = served('https://shell-production-aaaa.platform.test', 'shell-0.9.1', 'shell-b1')
const shell092 = served('https://shell-production-bbbb.platform.test', 'shell-0.9.2', 'shell-b2')
const shell093 = served('https://shell-production-cccc.platform.test', 'shell-0.9.3', 'shell-b3')
const shellRc = served(
  'https://shell-production-dddd.platform.test',
  'shell-1.0.0-rc.1',
  'shell-b4',
)

// employees.example.com: a staging deployment of the build published as 1.5.0 from production, a
// build named elsewhere: another issuer, so the build digest alone never names it (AM-73).
const employeesBuild = digest('build:employees-1.5.0')
const employeesProduction = {
  url: 'https://employees-production-eeee.deployments.records-proof.test',
  releaseDigest: digest('release:employees-1.5.0-production'),
  buildDigest: employeesBuild,
} satisfies PublishedRelease
const employeesStaging = deploymentFixture({
  origin: 'employees.example.com',
  environment: 'staging',
  release: digest('release:employees-1.5.0-staging'),
  build: employeesBuild,
  commit: { sha: SHA, dirty: false, base: { version: '1.5.0', distance: 0 } },
})

// agencies.example.com: a preview on a tenant (opaque) line whose owner is someone else. No
// Publication names it; its public record names it, read without any Services access.
const agenciesPreview = deploymentFixture({
  origin: 'agencies.example.com',
  environment: 'staging',
  addressing: 'opaque',
  release: digest('release:agencies-preview'),
  build: digest('build:agencies-preview'),
  commit: { sha: SHA, dirty: false, base: { version: '1.4.2', distance: 7 } },
})
const agencies150 = served(
  'https://agencies-production-ffff.platform.test',
  'agencies-1.5.0',
  'agencies-b',
)

// stories.example.com: a stable Worker (one URL, redeployed in place) runs the build published as
// 2.0.0 from that same URL under other variables: same origin, same issuer, so it is named.
const storiesUrl = 'https://stories-legacy.services.test'
const stories200 = served(storiesUrl, 'stories-2.0.0', 'stories-b')
const stories210 = served(
  'https://stories-legacy-next.services.test',
  'stories-2.1.0',
  'stories-b2',
)

// integrations.example.com: registered nowhere; its host serves the record of another release.
const integrations = deploymentFixture({
  origin: 'integrations.example.com',
  environment: 'production',
  release: digest('release:integrations-served'),
  build: digest('build:integrations'),
})

function domains(): FakeDomain[] {
  const domain = (origin: string, publications: FakeDomain['publications']): FakeDomain => ({
    id: `domain-${origin}`,
    origin,
    admins: new Set(),
    installers: new Set(['operator']),
    publications,
  })
  return [
    domain('shell.astrale.ai', [
      publication('s091', '0.9.1', shell091),
      publication('s092', '0.9.2', shell092),
      publication('s093', '0.9.3', shell093, { yankedAt: '2026-10-02T00:00:00.000Z' }),
      publication('src', '1.0.0-rc.1', shellRc),
    ]),
    domain('employees.example.com', [publication('e150', '1.5.0', employeesProduction)]),
    domain('agencies.example.com', [publication('a150', '1.5.0', agencies150)]),
    domain('stories.example.com', [
      publication('st200', '2.0.0', stories200),
      publication('st210', '2.1.0', stories210),
    ]),
  ]
}

const listing: InstalledRelease[] = [
  installed('agencies.example.com', agenciesPreview.url, {
    kind: 'release',
    release: agenciesPreview.record.releaseDigest,
    build: agenciesPreview.record.buildDigest,
  }),
  installed('employees.example.com', employeesStaging.url, {
    kind: 'release',
    release: employeesStaging.record.releaseDigest,
    build: employeesBuild,
  }),
  installed('integrations.example.com', integrations.url, {
    kind: 'release',
    release: digest('release:integrations-installed'),
    build: digest('build:integrations'),
  }),
  installed('issues.astrale.ai', 'https://issues.astrale.ai', {
    kind: 'legacy',
    document: 3,
    etag: digest('etag:issues'),
  }),
  installed('shell.astrale.ai', shell091.url, {
    kind: 'release',
    release: shell091.releaseDigest,
    build: shell091.buildDigest,
  }),
  installed('stories.example.com', storiesUrl, {
    kind: 'release',
    release: digest('release:stories-in-place'),
    build: stories200.buildDigest,
  }),
]

function fixture(overrides: Partial<InstalledListDependencies> = {}) {
  const admin = fakeAdmin({ caller: 'operator', domains: domains() })
  const records = recordServer([
    employeesStaging,
    agenciesPreview,
    {
      url: integrations.url,
      record: deploymentFixture({
        origin: 'integrations.example.com',
        environment: 'production',
        release: digest('release:other'),
        build: digest('build:integrations'),
      }).record,
    },
  ])
  const opened: unknown[] = []
  const dependencies: InstalledListDependencies = {
    installed: async () => ({ kernel: KERNEL, releases: listing }),
    registry: async <Value>(
      opts: unknown,
      work: (registry: AdminRegistryApi) => Promise<Value>,
    ) => {
      opened.push(opts)
      return work(connectAdminRegistry(admin.context))
    },
    record: (installation) => readDeploymentRecord(installation, records.fetchImpl),
    ...overrides,
  }
  return { admin, records, opened, dependencies }
}

describe('astrale domain list -i (Résolution [.79716] [.80228])', () => {
  test('a published version, a build named elsewhere and a preview owned by another line owner', async () => {
    const run = fixture()
    const list = await listInstalled(
      { instance: 'acme-stg', admin: 'admin-local', as: 'operator', json: true },
      run.dependencies,
    )
    expect(list.format).toBe('astrale.installed-list')
    expect(list.version).toBe(1)
    expect(list.kernel).toBe(KERNEL)
    // The Kernel listing carries no completeness marker (AM-84): it is partial by nature.
    expect(list.partial).toBe(true)
    const byOrigin = Object.fromEntries(list.domains.map((domain) => [domain.origin, domain]))

    // The digest comes from the Kernel pin, the version from the registry.
    expect(byOrigin['shell.astrale.ai']).toMatchObject({
      version: '0.9.1',
      name: '0.9.1',
      // 0.9.3 is yanked and 1.0.0-rc.1 a pre-release: neither is offered.
      available: '0.9.2',
      pin: { kind: 'release', release: shell091.releaseDigest },
    })

    // Same build as 1.5.0, but published from production: no version from the build alone.
    expect(byOrigin['employees.example.com']?.version).toBeUndefined()
    expect(byOrigin['employees.example.com']?.name).toBe(`1.5.0 · ${SHA.slice(0, 7)} · staging`)
    expect(byOrigin['employees.example.com']?.available).toBeUndefined()

    // The preview's name is its CT28 deploymentName, printed verbatim, environment included.
    expect(byOrigin['agencies.example.com']?.version).toBeUndefined()
    expect(byOrigin['agencies.example.com']?.name).toBe(deploymentName(agenciesPreview.record, []))
    expect(byOrigin['agencies.example.com']?.name).toBe('1.4.2 + 7 commits · a1b2c3d · staging')
    expect(byOrigin['agencies.example.com']?.available).toBe('1.5.0')

    // Same build, same origin, same issuer (a Worker redeployed in place): named, environment unknown.
    expect(byOrigin['stories.example.com']).toMatchObject({
      version: '2.0.0 · ?',
      name: '2.0.0 · ?',
      available: '2.1.0',
    })

    // A legacy v2/v3 pin names no release; nothing names a release no record backs.
    expect(byOrigin['issues.astrale.ai']).toMatchObject({ name: 'legacy' })
    expect(byOrigin['issues.astrale.ai']?.version).toBeUndefined()
    expect(byOrigin['integrations.example.com']).toMatchObject({ name: 'unknown' })
    expect(byOrigin['integrations.example.com']?.version).toBeUndefined()

    // Rows keep the Kernel's order and fields; inFlight stays the Kernel's.
    expect(list.domains.map((domain) => domain.origin)).toEqual(
      listing.map((entry) => entry.origin),
    )
    expect(Object.keys(list.domains[0]!).sort()).toEqual(
      ['available', 'issuer', 'name', 'origin', 'pin', 'revision', 'url'].sort(),
    )
  })

  test('Admin is opened once, under --admin, never under -i/--url; records are read anonymously', async () => {
    const run = fixture()
    await listInstalled(
      { instance: 'acme-stg', url: undefined, admin: 'admin-local', as: 'operator' },
      run.dependencies,
    )
    expect(run.opened).toEqual([{ admin: 'admin-local', as: 'operator' }])
    // Reads only: index Queries for the origins with a release pin, no Admin Method call.
    expect(run.admin.calls).toEqual([])
    expect(JSON.stringify(run.admin.queries)).not.toContain('issues.astrale.ai')
    expect(JSON.stringify(run.admin.queries)).toContain('shell.astrale.ai')
    const recorded = run.records.requests.map((request) => new URL(request.url).hostname)
    expect(recorded.sort()).toEqual(
      [agenciesPreview.url, employeesStaging.url, integrations.url]
        .map((url) => new URL(url).hostname)
        .sort(),
    )
    for (const request of run.records.requests)
      expect(request.headers.get('authorization')).toBeNull()
  })

  test('--creds and --anonymous authenticate the instance only: Admin is opened as the caller', async () => {
    const withCreds = fixture()
    await listInstalled(
      {
        url: KERNEL,
        creds: 'INSTANCE-TOKEN',
        admin: 'admin-local',
        timeout: '10s',
        ci: true,
        json: true,
      },
      withCreds.dependencies,
    )
    expect(withCreds.opened).toEqual([{ admin: 'admin-local', timeout: '10s', ci: true }])
    expect(JSON.stringify(withCreds.opened)).not.toContain('INSTANCE-TOKEN')

    const anonymous = fixture()
    await listInstalled(
      { instance: 'acme-stg', anonymous: true, adminUrl: 'https://admin.example/api' },
      anonymous.dependencies,
    )
    expect(anonymous.opened).toEqual([{ adminUrl: 'https://admin.example/api' }])
    for (const opts of [...withCreds.opened, ...anonymous.opened]) {
      expect(opts).not.toHaveProperty('creds')
      expect(opts).not.toHaveProperty('anonymous')
      expect(opts).not.toHaveProperty('instance')
      expect(opts).not.toHaveProperty('url')
    }
  })

  test('a Kernel without the installed listing is refused before Admin or any deployment', async () => {
    let registry = 0
    let records = 0
    const error = await listInstalled(
      { instance: 'legacy-117' },
      {
        installed: async () => ({ kernel: KERNEL, releases: undefined }),
        registry: async () => {
          registry += 1
          throw new Error('unexpected')
        },
        record: async () => {
          records += 1
          return undefined
        },
      },
    ).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(AstraleError)
    expect((error as AstraleError).code).toBe('KERNEL_RELEASE_UNSUPPORTED')
    expect(registry + records).toBe(0)
  })

  test('only legacy pins: Admin is never opened', async () => {
    const run = fixture({
      installed: async () => ({
        kernel: KERNEL,
        releases: listing.filter((entry) => entry.pin.kind === 'legacy'),
      }),
    })
    const list = await listInstalled({ instance: 'acme-stg' }, run.dependencies)
    expect(run.opened).toEqual([])
    expect(list.domains.map((domain) => domain.name)).toEqual(['legacy'])
  })

  test('a registry that cannot be read fails the listing; versions are never dropped silently', async () => {
    const run = fixture({
      registry: async () => {
        throw new RegistryError('REGISTRY_UNAVAILABLE', 'Admin did not answer.', {
          reason: 'transport',
        })
      },
    })
    const error = await listInstalled({ instance: 'acme-stg' }, run.dependencies).catch(
      (cause: unknown) => cause,
    )
    expect((error as AstraleError).code).toBe('REGISTRY_UNAVAILABLE')
  })

  test('an empty listing is a list, still partial', async () => {
    const run = fixture({ installed: async () => ({ kernel: KERNEL, releases: [] }) })
    const list = await listInstalled({ instance: 'acme-stg' }, run.dependencies)
    expect(list).toEqual({
      format: 'astrale.installed-list',
      version: 1,
      kernel: KERNEL,
      partial: true,
      domains: [],
    })
    expect(renderInstalled(list)).toContain('No installed Domain is readable by this caller.')
  })

  test('the human table follows Résolution [.79737]', async () => {
    const run = fixture()
    const list = await listInstalled({ instance: 'acme-stg' }, run.dependencies)
    const rows = installedRows(list)
    expect(rows.find((row) => row.origin === 'shell.astrale.ai')).toEqual({
      origin: 'shell.astrale.ai',
      version: '0.9.1',
      digest: `${shell091.releaseDigest.slice(0, 19)}…`,
      available: '0.9.2',
    })
    expect(rows.find((row) => row.origin === 'agencies.example.com')).toMatchObject({
      version: '1.4.2 + 7 commits · a1b2c3d · staging',
      available: '1.5.0',
    })
    expect(rows.find((row) => row.origin === 'issues.astrale.ai')).toMatchObject({
      version: 'legacy',
      available: '—',
    })
    const plain = stripAnsi(renderInstalled(list))
    expect(plain.split('\n')[0]).toMatch(/^\s+ORIGIN\s+VERSION\s+DIGEST\s+AVAILABLE$/u)
    expect(plain).toContain('built-in and local Domains never are')
  })

  test('the catalog options are refused beside -i/--url', () => {
    expect(misplacedCatalogFlags({ instance: 'acme-stg', check: true, quiet: true })).toEqual([
      '--check',
      '-q/--quiet',
    ])
    expect(misplacedCatalogFlags({ instance: 'acme-stg', fleet: '@fleet' })).toEqual(['--fleet'])
    expect(misplacedCatalogFlags({ instance: 'acme-stg', json: true })).toEqual([])
  })
})

describe('naming one installation (AM-41, AM-57, AM-73)', () => {
  const pin = {
    kind: 'release' as const,
    release: shell091.releaseDigest,
    build: shell091.buildDigest,
  }
  const summary = (version: string, source: PublishedRelease, yanked = false) => ({
    version,
    url: source.url,
    releaseDigest: source.releaseDigest,
    buildDigest: source.buildDigest,
    schemaRevision: REVISION,
    dependencies: [],
    dirty: false,
    yanked,
    publishedAt: '2026-10-04T00:00:00.000Z',
  })

  test('several Publications of one release: the highest not yanked, else the highest yanked', () => {
    const entry = installed('shell.astrale.ai', shell091.url, pin)
    expect(
      describeInstalled(
        entry,
        [summary('0.9.1', shell091), summary('0.9.5', shell091, true)],
        undefined,
      ).version,
    ).toBe('0.9.1')
    expect(
      describeInstalled(
        entry,
        [summary('0.9.1', shell091, true), summary('0.9.5', shell091, true)],
        undefined,
      ).version,
    ).toBe('0.9.5')
  })

  test('a build digest from another issuer never names the release, whatever the record says', () => {
    const elsewhere = served('https://elsewhere.deployments.test', 'other', 'shell-b1')
    const entry = installed('shell.astrale.ai', shell091.url, {
      kind: 'release',
      release: digest('release:not-published'),
      build: elsewhere.buildDigest,
    })
    const described = describeInstalled(entry, [summary('9.9.9', elsewhere)], undefined)
    expect(described.version).toBeUndefined()
    expect(described.name).toBe('unknown')
    expect(described.available).toBeUndefined()
  })
})
