/**
 * Answers shaped like the Studio server's, trimmed from what it answered for this Workspace:
 * Issues 0.8.8 behind 0.9.1 with an accepted, empty change report; Admin never published, its
 * change report failed; Admin against Shell 0.1.0 and 0.1.1 incompatible; Kernel not found.
 */

import type { SchemaRevision } from '@shared/contracts/schema'
import type {
  ChangeReport,
  CompatibilityMatrix,
  CompatibilityVerdict,
  DependencyCompatibility,
  DependencyStanding,
  DomainDependencies,
  DomainLocal,
  DomainStanding,
  PublicationRelation,
  PublicationSummary,
  Remote,
  RemoteFailure,
  RegistryIndex,
  UnsatisfiedAssessment,
} from '@shared/contracts/versions'
import type { DomainSummary } from '@shared/contracts/workspace'

import { type DomainFacts, type Fact, IDLE, ready } from './facts'

export const READ_AT = '2026-11-26T22:40:35.471Z'

export const REVISION = {
  admin: 'sha256:efb0570a78249391145e7337db0da90637131746650a852bf8c3e0a172922f74',
  issues: 'sha256:ce5f0919740ac0000000000000000000000000000000000000000000000000000',
  issues091: 'sha256:9a1e0000000000000000000000000000000000000000000000000000000000000',
  kernel: 'sha256:29b082a70720f000000000000000000000000000000000000000000000000000',
  shell030: 'sha256:a51bf60f644dc000000000000000000000000000000000000000000000000000',
  shell040: 'sha256:0653e4616f1a1cc0d07c2d5d37f10fe5525b5406efb2da266b1343faf0b61377',
  shell020: 'sha256:bb248b2700000000000000000000000000000000000000000000000000000000',
  shell011: 'sha256:f5d54443198ec07089c757f45085b2c958d913f37686bb66905967bf84d63cbe',
  shell010: 'sha256:edf9e03800000000000000000000000000000000000000000000000000000000',
} as const satisfies Record<string, SchemaRevision>

export function ok<T>(value: T): Remote<T> {
  return { status: 'ok', value, readAt: READ_AT }
}

export function failure(
  status: RemoteFailure['status'],
  message = `${status} answer`,
  code?: string,
): RemoteFailure {
  return { status, message, readAt: READ_AT, ...(code ? { code } : {}) }
}

/** The value of a remote answer the test built as `ok`. */
export function okValue<T>(remote: Remote<T>): T {
  if (remote.status !== 'ok') throw new Error(`expected an ok answer, got ${remote.status}`)
  return remote.value
}

/** The value of a fact the test built as `ready`. */
export function readyValue<T>(fact: Fact<T>): T {
  if (fact.status !== 'ready') throw new Error(`expected a ready fact, got ${fact.status}`)
  return fact.value
}

export const NOT_FOUND = failure(
  'not-found',
  'No Domain kernel.astrale.ai is readable by this caller: it is absent, or the caller holds neither domain_installer nor domain_admin on it.',
  'REGISTRY_DOMAIN_NOT_FOUND',
)

export function summary(
  id: string,
  origin: string,
  overrides: Partial<DomainSummary> = {},
): DomainSummary {
  return {
    id,
    origin,
    path: `/workspace/${origin.split('.')[0]}`,
    schemaDir: 'schema',
    depsInstalled: true,
    hasGit: false,
    configFile: 'astrale.config.ts',
    ...overrides,
  }
}

export function publication(
  version: string,
  schemaRevision: SchemaRevision,
  overrides: Partial<PublicationSummary> = {},
): PublicationSummary {
  return {
    version,
    url: `https://example.test/${version}`,
    releaseDigest: `sha256:release-${version}`,
    buildDigest: `sha256:build-${version}`,
    schemaRevision,
    dependencies: [],
    dirty: false,
    yanked: false,
    publishedAt: '2026-11-26T15:00:00.000Z',
    ...overrides,
  }
}

export function index(origin: string, publications: PublicationSummary[]): Remote<RegistryIndex> {
  return ok({ origin, publications })
}

export const ISSUES_LOCAL: DomainLocal = {
  domainId: 'issues',
  origin: 'issues.astrale.ai',
  packageName: '@astrale-domains/issues',
  declared: '0.8.8',
  revision: REVISION.issues,
  git: null,
  environments: {
    declared: true,
    environments: [{ name: 'development' }, { name: 'production' }],
    complete: true,
  },
  dependencies: [
    { alias: 'kernel', origin: 'kernel.astrale.ai', revision: REVISION.kernel },
    { alias: 'shell', origin: 'shell.astrale.ai', revision: REVISION.shell030 },
  ],
}

export const ADMIN_LOCAL: DomainLocal = {
  domainId: 'admin',
  origin: 'admin.astrale.ai',
  packageName: '@astrale-os/admin',
  declared: '0.1.0-beta.63',
  revision: REVISION.admin,
  git: null,
  environments: { declared: false, environments: [], complete: true },
  dependencies: [
    { alias: 'issues', origin: 'issues.astrale.ai', revision: REVISION.issues },
    { alias: 'kernel', origin: 'kernel.astrale.ai', revision: REVISION.kernel },
    { alias: 'shell', origin: 'shell.astrale.ai', revision: REVISION.shell030 },
  ],
}

export const ISSUES_INDEX = index('issues.astrale.ai', [
  publication('0.9.1', REVISION.issues091),
  publication('0.9.0', REVISION.issues091),
  publication('0.8.9', REVISION.issues091),
])

export const SHELL_INDEX = index('shell.astrale.ai', [
  publication('0.4.0', REVISION.shell040),
  publication('0.3.0', REVISION.shell030),
  publication('0.2.1', REVISION.shell020),
  publication('0.2.0', REVISION.shell020),
  publication('0.1.1', REVISION.shell011),
  publication('0.1.0', REVISION.shell010),
])

export function standing(
  local: DomainLocal,
  relation: PublicationRelation,
  idx: Remote<RegistryIndex>,
): DomainStanding {
  const latest = idx.status === 'ok' ? idx.value.publications[0] : undefined
  return {
    local,
    index: idx,
    ...(latest ? { latest } : {}),
    relation,
    carriedBy:
      idx.status === 'ok'
        ? idx.value.publications
            .filter((entry) => entry.schemaRevision === local.revision)
            .map((entry) => entry.version)
        : [],
  }
}

export function dependencyStanding(
  alias: string,
  origin: string,
  builtAgainst: SchemaRevision,
  idx: Remote<RegistryIndex>,
  local: DependencyStanding['local'] = null,
): DependencyStanding {
  return {
    alias,
    origin,
    builtAgainst,
    local,
    index: idx,
    carriedBy:
      idx.status === 'ok'
        ? idx.value.publications
            .filter((entry) => entry.schemaRevision === builtAgainst)
            .map((entry) => entry.version)
        : [],
  }
}

export function dependencies(
  local: DomainLocal,
  entries: DependencyStanding[],
): DomainDependencies {
  return {
    domainId: local.domainId,
    origin: local.origin,
    revision: local.revision,
    dependencies: entries,
  }
}

export function report(overrides: Partial<ChangeReport> = {}): ChangeReport {
  return {
    look: 'look-1',
    origin: 'issues.astrale.ai',
    declared: '0.8.8',
    published: false,
    registry: 'read',
    accepted: true,
    changes: [],
    revision: REVISION.issues,
    judgedAt: READ_AT,
    notes: ['nothing to compare'],
    ...overrides,
  }
}

/** One unsatisfied requirement, as Admin's against Shell 0.1.1 reads. */
export const GROUP_PROPERTIES: UnsatisfiedAssessment = {
  subject: { key: 'shell.astrale.ai:class.Group', kind: 'class' },
  facet: 'class.properties',
  requirement: 'class.properties',
  state: 'changed',
  differences: [
    {
      path: '/properties/kernel.astrale.ai:class.Iconable.property.icon',
      required: { value: true },
    },
    {
      path: '/properties/shell.astrale.ai:class.Group.property.directory',
      required: { value: true },
    },
  ],
  differencesOmitted: 0,
  usages: [
    {
      origin: 'admin.astrale.ai',
      key: 'admin.astrale.ai:class.Domain.method.grantAccess',
      relation: 'value',
    },
    {
      origin: 'admin.astrale.ai',
      key: 'admin.astrale.ai:class.Domain.method.revokeAccess',
      relation: 'value',
    },
    { origin: 'admin.astrale.ai', key: 'admin.astrale.ai:class.Fleet', relation: 'endpoint' },
  ],
}

export const ROLE_MISSING: UnsatisfiedAssessment = {
  subject: { key: 'shell.astrale.ai:class.Role', kind: 'class' },
  facet: 'class.reference',
  requirement: 'class.reference',
  state: 'missing',
  differences: [],
  differencesOmitted: 0,
  usages: [
    {
      origin: 'admin.astrale.ai',
      key: 'admin.astrale.ai:class.Domain.method.grantAccess',
      relation: 'value',
    },
  ],
}

export function verdict(
  version: string,
  revision: SchemaRevision,
  overrides: Partial<CompatibilityVerdict> = {},
): CompatibilityVerdict {
  return {
    dependent: { domainId: 'admin', origin: 'admin.astrale.ai', revision: REVISION.admin },
    target: { kind: 'publication', origin: 'shell.astrale.ai', version, revision },
    sameRevisionAs: [],
    compatible: true,
    equivalent: false,
    unsatisfied: [],
    evidence: { structure: 'sha256:structure', meaning: 'sha256:meaning' },
    scope: { capabilities: 'not-judged', held: false },
    judgedBy: { sdk: '0.6.0-beta.62' },
    judgedAt: READ_AT,
    ...overrides,
  }
}

/** Admin against Shell: 4 of 6 hold, 0.2.1 and 0.2.0 share a revision, 0.1.1 and 0.1.0 break. */
export const ADMIN_ON_SHELL: DependencyCompatibility = {
  origin: 'shell.astrale.ai',
  builtAgainst: REVISION.shell030,
  publications: ok([
    { version: '0.4.0', yanked: false, verdict: ok(verdict('0.4.0', REVISION.shell040)) },
    {
      version: '0.3.0',
      yanked: false,
      verdict: ok(verdict('0.3.0', REVISION.shell030, { equivalent: true })),
    },
    {
      version: '0.2.1',
      yanked: false,
      verdict: ok(verdict('0.2.1', REVISION.shell020, { sameRevisionAs: ['0.2.0'] })),
    },
    {
      version: '0.2.0',
      yanked: true,
      verdict: ok(verdict('0.2.0', REVISION.shell020, { sameRevisionAs: ['0.2.1'] })),
    },
    {
      version: '0.1.1',
      yanked: false,
      verdict: ok(
        verdict('0.1.1', REVISION.shell011, {
          compatible: false,
          unsatisfied: [GROUP_PROPERTIES, ROLE_MISSING],
        }),
      ),
    },
    {
      version: '0.1.0',
      yanked: false,
      verdict: ok(
        verdict('0.1.0', REVISION.shell010, { compatible: false, unsatisfied: [GROUP_PROPERTIES] }),
      ),
    },
  ]),
  local: null,
}

export const ADMIN_ON_KERNEL: DependencyCompatibility = {
  origin: 'kernel.astrale.ai',
  builtAgainst: REVISION.kernel,
  publications: NOT_FOUND,
  local: null,
}

export const ADMIN_ON_ISSUES: DependencyCompatibility = {
  origin: 'issues.astrale.ai',
  builtAgainst: REVISION.issues,
  publications: ok([
    { version: '0.9.1', yanked: false, verdict: ok(verdict('0.9.1', REVISION.issues091)) },
    { version: '0.9.0', yanked: false, verdict: ok(verdict('0.9.0', REVISION.issues091)) },
    { version: '0.8.9', yanked: false, verdict: ok(verdict('0.8.9', REVISION.issues091)) },
  ]),
  local: {
    domainId: 'issues',
    verdict: ok(
      verdict('local', REVISION.issues, {
        target: {
          kind: 'local',
          origin: 'issues.astrale.ai',
          domainId: 'issues',
          revision: REVISION.issues,
        },
        equivalent: true,
      }),
    ),
  },
}

/** Issues against Shell: every Publication holds. */
export const ISSUES_ON_SHELL: DependencyCompatibility = {
  origin: 'shell.astrale.ai',
  builtAgainst: REVISION.shell030,
  publications: ok(
    ['0.4.0', '0.3.0', '0.2.1', '0.2.0', '0.1.1', '0.1.0'].map((version) => ({
      version,
      yanked: false,
      verdict: ok(verdict(version, REVISION.shell030)),
    })),
  ),
  local: null,
}

export function matrix(
  local: DomainLocal,
  entries: DependencyCompatibility[],
): CompatibilityMatrix {
  return {
    domainId: local.domainId,
    origin: local.origin,
    revision: local.revision,
    dependencies: entries,
  }
}

export const ADMIN_FAILED_REPORT = failure(
  'failed',
  'Project definition may contain only domain, environments, entrypoints, and tests.',
)

/** Issues as the Workspace reads it: behind 0.9.1, accepted, no changes, Shell holding. */
export function issuesFacts(overrides: Partial<DomainFacts> = {}): DomainFacts {
  return {
    summary: summary('issues', 'issues.astrale.ai'),
    local: ready(ISSUES_LOCAL),
    standing: ready(standing(ISSUES_LOCAL, { kind: 'behind', latest: '0.9.1' }, ISSUES_INDEX)),
    dependencies: ready(
      dependencies(ISSUES_LOCAL, [
        dependencyStanding('kernel', 'kernel.astrale.ai', REVISION.kernel, NOT_FOUND),
        dependencyStanding('shell', 'shell.astrale.ai', REVISION.shell030, SHELL_INDEX),
      ]),
    ),
    changes: ready(ok(report())),
    compatibility: ready(matrix(ISSUES_LOCAL, [ADMIN_ON_KERNEL, ISSUES_ON_SHELL])),
    ...overrides,
  }
}

/** Admin as the Workspace reads it: never published, its change report failed, Shell 0.1.x breaking. */
export function adminFacts(overrides: Partial<DomainFacts> = {}): DomainFacts {
  return {
    summary: summary('admin', 'admin.astrale.ai'),
    local: ready(ADMIN_LOCAL),
    standing: ready(
      standing(
        ADMIN_LOCAL,
        { kind: 'never-published', registered: true },
        index('admin.astrale.ai', []),
      ),
    ),
    dependencies: ready(
      dependencies(ADMIN_LOCAL, [
        dependencyStanding('issues', 'issues.astrale.ai', REVISION.issues, ISSUES_INDEX, {
          domainId: 'issues',
          revision: REVISION.issues,
          atBuiltAgainst: true,
        }),
        dependencyStanding('kernel', 'kernel.astrale.ai', REVISION.kernel, NOT_FOUND),
        dependencyStanding('shell', 'shell.astrale.ai', REVISION.shell030, SHELL_INDEX),
      ]),
    ),
    changes: ready(ADMIN_FAILED_REPORT),
    compatibility: ready(matrix(ADMIN_LOCAL, [ADMIN_ON_ISSUES, ADMIN_ON_KERNEL, ADMIN_ON_SHELL])),
    ...overrides,
  }
}

/** A Domain whose remote facts were never asked for: the cost guard left it unjudged. */
export function unjudged(facts: DomainFacts): DomainFacts {
  return { ...facts, changes: IDLE, compatibility: IDLE }
}
