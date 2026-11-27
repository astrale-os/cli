/**
 * Shared contracts of the Workspace level: where each workspace Domain stands against its
 * Publications, what changed since the last one and the bump it requires, its dependencies and
 * their compatibility, the registry's Domains, and Publish.
 *
 * The vocabulary is the platform's: a build is env-free; a release is a build bound to its
 * address; a Publication is the version number given to a release; `publish` deploys or reuses a
 * release, verifies it and tags it. Every judgement carried here is the platform's own
 * (`astrale-domain diff`, the DSL's `compare`), never a Studio approximation.
 */

import type { SchemaRevision, StudioSchemaBundle } from './schema'

// ─── Remote facts ────────────────────────────────────────────────────────────

/**
 * How a remote fact was read, always through the `astrale` CLI and the caller's own session.
 *
 * - `signed-out`: the CLI holds no usable session (no identity, an expired or refused login).
 * - `offline`: the registry, Admin or the identity provider could not be reached.
 * - `not-found`: no such Domain or Publication is readable by the caller (absent, or unreadable).
 * - `refused`: the registry answered and refused this read.
 * - `failed`: no usable answer: the command could not run, timed out locally, or answered
 *   something unreadable; for a platform command run on the Domain, its own refusal.
 */
export type RemoteStatus = 'ok' | 'signed-out' | 'offline' | 'not-found' | 'refused' | 'failed'

export interface RemoteValue<T> {
  status: 'ok'
  value: T
  /** When the fact was read (ISO 8601); a cached fact keeps the time of its read. */
  readAt: string
}

export interface RemoteFailure {
  status: Exclude<RemoteStatus, 'ok'>
  /** The CLI's error code, when it answered with one (`REGISTRY_DOMAIN_NOT_FOUND`, …). */
  code?: string
  /** The CLI's own message, from its machine error document; never its raw diagnostics. */
  message: string
  readAt: string
}

/** A remote fact: its value, or why it is not known. Never silently absent. */
export type Remote<T> = RemoteValue<T> | RemoteFailure

/**
 * How long each step of a registry-backed read runs before it answers `failed`: one registry
 * index or listing page, one bundle download, one judgement (a compare or projection island, or
 * the platform's diff).
 */
export const REGISTRY_STEP_LIMITS_MS = {
  index: 60_000,
  bundle: 120_000,
  judgement: 180_000,
} as const

/**
 * How long a page waits on a registry-backed read: one index read, one bundle download and one
 * judgement in turn. Past it the page says the read hit this limit and offers it again; an
 * answer that comes later still lands.
 */
export const REGISTRY_READ_LIMIT_MS =
  REGISTRY_STEP_LIMITS_MS.index + REGISTRY_STEP_LIMITS_MS.bundle + REGISTRY_STEP_LIMITS_MS.judgement

// ─── Registry ────────────────────────────────────────────────────────────────

export interface PublishedDependency {
  origin: string
  revision: SchemaRevision
}

/** One Publication as the registry index lists it (`astrale domain versions --json`). */
export interface PublicationSummary {
  version: string
  /** The deployment's URL, which is also the release's issuer. */
  url: string
  releaseDigest: string
  buildDigest: string
  schemaRevision: SchemaRevision
  /** The revision of each dependency the release was built against. */
  dependencies: PublishedDependency[]
  /** The 40-hex commit the release was built from, when the publisher recorded it. */
  commit?: string
  dirty: boolean
  /** A yanked version is never chosen by a line reference; it still names the same release. */
  yanked: boolean
  publishedAt: string
}

/** Every Publication of one origin the caller may read, pre-releases and yanked ones included. */
export interface RegistryIndex {
  origin: string
  /** SemVer precedence, highest first. */
  publications: PublicationSummary[]
}

/** One Domain registered on Admin. */
export interface RegistryDomain {
  origin: string
  name?: string
  description?: string
  discoveryUrl?: string
  createdAt?: string
  updatedAt?: string
}

/**
 * The registry's Domains as the caller's own Query of Admin's `Domain` Nodes lists them. No CLI
 * command lists registry Domains, and the registry's own reads run under Admin's Domain
 * credential: a Domain listed here may still answer `not-found` to `domain versions`, and a
 * Domain `domain versions` reads may be missing here.
 */
export interface RegistryDomains {
  domains: RegistryDomain[]
  source: 'admin-graph-query'
  /** The Admin target the Query ran on, by its CLI name. */
  admin: string
  /** False when the page bound stopped the read: `domains` is then a prefix of the listing. */
  complete: boolean
}

// ─── Local standing ──────────────────────────────────────────────────────────

/** An Environment `astrale.config.ts` declares, read statically, never executed. */
export interface DeclaredEnvironment {
  name: string
  /** The deployment adapter factory and the module it is imported from, when visible. */
  adapter?: { module: string; export: string }
}

export interface DeclaredEnvironments {
  /** False when the Project declares no `environments`; the SDK refuses such a Project. */
  declared: boolean
  environments: DeclaredEnvironment[]
  /** False when some entry is not statically readable: a spread, a computed name, a call. */
  complete: boolean
}

/** The provenance a deploy records (SDK `deploymentCommit`): HEAD and the working tree's state. */
export interface GitState {
  commit: string
  /** Tracked changes or untracked files anywhere in the working tree; ignored files never count. */
  dirty: boolean
}

/** What a workspace Domain is on disk. Reading it never touches the network. */
export interface DomainLocal {
  domainId: string
  /** The Schema's origin, once its Schema has been read. */
  origin: string | null
  /** `package.json` `name`. */
  packageName: string | null
  /** `package.json` `version`: the version Publish gives the release. */
  declared: string | null
  /** The Schema revision of the current sources, as the Domain's installed SDK admits them. */
  revision: SchemaRevision | null
  /** Why `revision` is unknown. */
  revisionError?: string
  /** Null outside a git repository, without git, or before the first commit. */
  git: GitState | null
  environments: DeclaredEnvironments
  /** The revision of each dependency the Schema is built against, under its declared alias. */
  dependencies: Array<PublishedDependency & { alias: string }>
}

/** How the local Domain relates to its Publications. */
export type PublicationRelation =
  /**
   * No Publication is readable. `registered` is false when the caller can read no Domain of the
   * origin at all: absent, or not readable by this caller.
   */
  | { kind: 'never-published'; registered: boolean }
  /** The latest Publication carries the local Schema revision. */
  | { kind: 'same-revision'; latest: string }
  /** The declared version is above the latest Publication, whose revision differs. */
  | { kind: 'ahead'; latest: string }
  /** The declared version is already published, under another Schema revision. */
  | { kind: 'version-taken'; latest: string }
  /** The declared version is below the latest Publication, whose revision differs. */
  | { kind: 'behind'; latest: string }
  /** Not determined: the local revision or version is unknown, or the index could not be read. */
  | { kind: 'undetermined'; reason: string }

/** Where a workspace Domain stands against the registry. */
export interface DomainStanding {
  local: DomainLocal
  index: Remote<RegistryIndex>
  /** The highest-precedence Publication, yanked ones included, when the index lists one. */
  latest?: PublicationSummary
  relation: PublicationRelation
  /** The published versions whose Schema revision is the local one. */
  carriedBy: string[]
}

// ─── Changes since the last Publication ──────────────────────────────────────

export type Bump = 'patch' | 'minor' | 'major'

/**
 * Why a change requires its level, by the platform's rule (`requiredBump`): an unsatisfied
 * requirement is major, an addition minor, any other change patch. `equivalent-schema` is a new
 * Schema revision of equivalent meaning (facet `schema`); `code-only` is new code under the same
 * Schema revision (facet `build`).
 */
export type ChangeReason =
  | 'unsatisfied-requirement'
  | 'addition'
  | 'other-change'
  | 'equivalent-schema'
  | 'code-only'

/** One change since the baseline Publication, with the level it alone requires. */
export interface PublicationChange {
  /** The member's Key, or the Domain's origin for a change of the whole build or Schema. */
  subject: string
  /** The compatibility engine's facet (`method.existence`, …), `schema`, or `build`. */
  facet: string
  state: 'missing' | 'changed' | 'added'
  bump: Bump
  reason: ChangeReason
  /** What differs, such as `optional → required`, when the platform says. */
  detail?: string
}

/**
 * `astrale-domain diff --json`: the declared version judged against the highest published stable
 * version up to it. Publish requires a fresh look: the id of a report taken at the sources it
 * publishes.
 */
export interface ChangeReport {
  /** This look's id, valid for Publish while the sources keep this version and revision. */
  look: string
  origin: string
  declared: string
  /** The declared version already names a Publication: the report is informational. */
  published: boolean
  /** `unregistered`: no Domain of this origin is readable; nothing is compared. */
  registry: 'read' | 'unregistered'
  /** The Publication compared against. */
  baseline?: string
  /** The level the changes since the baseline require. */
  level?: Bump
  /** The level after the 0.x rule. */
  effective?: Bump
  /** The smallest version the changes admit, a pre-release such as `2.0.0-0`. */
  minimum?: string
  /** The stable form of the required version, such as `2.0.0`. */
  next?: string
  /** For a refused pre-release, the first pre-release of the required version on its channel. */
  suggestion?: string
  /** The declared version reaches the minimum, or there is nothing to compare. */
  accepted: boolean
  /** Every change, ordered by subject Key then observation; empty for none. */
  changes: PublicationChange[]
  /** The local Schema revision, unchanged from before the platform judged to after it. */
  revision: SchemaRevision
  /** When the platform judged it; a cached judgement keeps its time. */
  judgedAt: string
  /** The platform's own progress notes and warnings, such as `nothing to compare`. */
  notes: string[]
}

// ─── Dependencies ────────────────────────────────────────────────────────────

/** The workspace Domain of a dependency's origin. */
export interface LocalCopy {
  domainId: string
  revision: SchemaRevision | null
  /** Whether the local copy is at the built-against revision; null when its revision is unknown. */
  atBuiltAgainst: boolean | null
  revisionError?: string
}

export interface DependencyStanding {
  /** The alias the Schema declares the dependency under. */
  alias: string
  origin: string
  /** The revision this Domain's Schema is built against. */
  builtAgainst: SchemaRevision
  /** The workspace Domain of this origin, when the workspace holds one. */
  local: LocalCopy | null
  /** Every Publication of the dependency the caller may read. */
  index: Remote<RegistryIndex>
  /** The published versions whose Schema revision is the built-against one. */
  carriedBy: string[]
}

export interface DomainDependencies {
  domainId: string
  origin: string | null
  revision: SchemaRevision | null
  /** Why the dependencies are unknown: the Schema could not be admitted. */
  error?: string
  dependencies: DependencyStanding[]
}

// ─── Compatibility ───────────────────────────────────────────────────────────

/** A value the comparison observed, or what stands in for one too large to carry. */
export type ObservedValue = { value: unknown } | { elided: true; bytes: number }

/** One requirement of this Domain that the compared version does not satisfy. */
export interface UnsatisfiedAssessment {
  subject: { key: string; kind: string }
  /** The engine facet the requirement is about (`class.properties`, `method.signature`, …). */
  facet: string
  /** The requirement this Domain establishes. */
  requirement: string
  state: 'equal' | 'changed' | 'missing' | 'added'
  /** What this Domain requires: the subject as the built-against revision defines it. */
  required?: ObservedValue
  /** What the compared version provides; absent when it lacks the subject. */
  provided?: ObservedValue
  /** What differs, leaf by leaf in JSON Pointer order, at most a bounded number of them. */
  differences: Array<{ path: string; required?: ObservedValue; provided?: ObservedValue }>
  /** How many differences were not carried. */
  differencesOmitted: number
  /** Why this Domain requires the subject: the members that use it, and how. */
  usages: Array<{ origin: string; key?: string; relation: string }>
}

/** Which version of a dependency was compared. */
export type CompatibilityTarget =
  | { kind: 'publication'; origin: string; version: string; revision: SchemaRevision }
  | { kind: 'local'; origin: string; domainId: string; revision: SchemaRevision }

/**
 * The DSL's dependency-scoped `compare` of this Domain's Schema against one version of a
 * dependency: whether binding this Domain to it would satisfy every structural requirement.
 */
export interface CompatibilityVerdict {
  dependent: { domainId: string; origin: string; revision: SchemaRevision }
  target: CompatibilityTarget
  /** Same origin and revision: the same verdict stands for every version that carries it. */
  sameRevisionAs: string[]
  compatible: boolean
  /** The target means exactly what the built-against revision means to this Domain. */
  equivalent: boolean
  unsatisfied: UnsatisfiedAssessment[]
  /** The comparison's evidence fingerprints. */
  evidence: { structure: string; meaning: string }
  /**
   * What the verdict judges. Capability requirements a Domain declares outside its Schema
   * (`requirements.capabilities`) are not judged, and the binding is judged as a new one, never
   * as one an installation already holds.
   */
  scope: { capabilities: 'not-judged'; held: false }
  /** The engine that judged: the dependent's installed SDK. The Kernel judges installs itself. */
  judgedBy: { sdk: string }
  judgedAt: string
}

/** One dependency's verdicts across every readable version and the workspace copy. */
export interface DependencyCompatibility {
  origin: string
  builtAgainst: SchemaRevision
  /** Each Publication, highest first, with its verdict; the index read's failure otherwise. */
  publications: Remote<
    Array<{ version: string; yanked: boolean; verdict: Remote<CompatibilityVerdict> }>
  >
  /** The workspace copy's verdict, when the workspace holds one. */
  local: { domainId: string; verdict: Remote<CompatibilityVerdict> } | null
}

export interface CompatibilityMatrix {
  domainId: string
  origin: string | null
  revision: SchemaRevision | null
  error?: string
  dependencies: DependencyCompatibility[]
}

// ─── Published versions, opened read-only ────────────────────────────────────

/** A Domain origin: a host name, so never a flag of the command it is passed to. */
export function isOrigin(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(value)
}

/** A canonical SemVer version: no leading `v`, no build metadata. */
export function isVersion(value: string): boolean {
  return /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    value,
  )
}

/** One published version of one Domain: what the registry names a Publication by. */
export interface PublicationAddress {
  origin: string
  version: string
}

/**
 * Prefix of the Domain id of a published version. Workspace ids are `<name>-<hash>` and the
 * Kernel's is `@kernel`, so it addresses no workspace Domain.
 */
export const PUBLISHED_DOMAIN_PREFIX = '@registry:'

export function publishedDomainId(origin: string, version: string): string {
  return `${PUBLISHED_DOMAIN_PREFIX}${origin}@${version}`
}

/** The Publication a Domain id names, or none: a workspace or Kernel id, or a malformed one. */
export function publicationOf(domainId: string): PublicationAddress | undefined {
  if (!domainId.startsWith(PUBLISHED_DOMAIN_PREFIX)) return undefined
  const rest = domainId.slice(PUBLISHED_DOMAIN_PREFIX.length)
  const at = rest.indexOf('@')
  if (at < 0) return undefined
  const origin = rest.slice(0, at)
  const version = rest.slice(at + 1)
  return isOrigin(origin) && isVersion(version) ? { origin, version } : undefined
}

/**
 * A Publication's Schema, rendered from the canonical document its bundle holds: no sources, so
 * no overlay, and never editable.
 */
export interface PublishedSchemaBundle extends StudioSchemaBundle {
  publication: {
    origin: string
    version: string
    schemaRevision: SchemaRevision
    releaseDigest: string
    /** The verified digest of the bundle the deployment served. */
    bundleDigest: string
    publishedAt: string
    yanked: boolean
    /** The installed SDK that decoded and projected it, and the project it is installed in. */
    decodedBy: { sdk: string; domainId?: string }
  }
}

// ─── Publish ─────────────────────────────────────────────────────────────────

export interface PublishRequest {
  environment: string
  /** The id of a fresh change report of this Domain (`ChangeReport.look`). */
  look: string
  /** Passes `--allow-dirty`: publish without a commit, or from a tree the commit does not hold. */
  allowDirty?: boolean
}

/** Why Publish refused to start; nothing ran. */
export interface PublishRefusal {
  error:
    | 'publish-disabled'
    | 'look-missing'
    | 'look-stale'
    | 'look-refused'
    | 'environment-unknown'
    | 'publish-running'
    | 'tooling-missing'
    | 'invalid-request'
  message: string
}

/** `astrale-domain publish --json` on stdout. */
export interface PublishReport {
  origin: string
  environment: string
  publication: { version: string; status: 'created' | 'unchanged' }
  deployment: 'created' | 'reused' | 'none'
  url: string
  releaseDigest: string
  buildDigest: string
  commit: { sha: string; dirty: boolean; base?: string } | null
}

/** One line of the Publish stream (NDJSON), in order; the last one is always a `result`. */
export type PublishEvent =
  | { type: 'started'; domainId: string; environment: string; look: string; command: string[] }
  /** One line the platform marked as progress (`›`), warning (`!`) or refusal (`✗`). */
  | { type: 'progress'; tone: 'step' | 'warning' | 'refusal'; line: string }
  | {
      type: 'result'
      ok: true
      report: PublishReport
      /** Output lines the platform did not mark (adapter or tool output), counted, not relayed. */
      unrelayedLines: number
    }
  | {
      type: 'result'
      ok: false
      message: string
      exitCode: number
      unrelayedLines: number
    }
