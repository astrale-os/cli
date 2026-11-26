import type { InstalledRelease } from '@astrale-os/sdk/client/schema'
import type { ClientSession } from '@astrale-os/sdk/client/session'
import type { DomainRelease } from '@astrale-os/sdk/release'

import { ResponseError } from '@astrale-os/sdk/client'
import { capabilityKeys } from '@astrale-os/sdk/release'
import { Key, schema, type bundle, type Revision } from '@astrale-os/sdk/schema'
import { acceptVersion, compatibleDependentVersion } from '@astrale-os/sdk/versioning'

import type { AdminRegistryApi } from '../../admin/registry'

import { registryFailure } from '../../admin/registry/failure'
import { reasonCode } from '../../connection/reasons'
import { mapBounded } from '../../lib/concurrency'

/**
 * The install pre-check (Résolution [.78239], Installation [.69634]): before the install is sent,
 * the CLI evaluates both directions the Kernel checks at install ([.96185]) with the same engine,
 * `schema.compatibility.compareStructure` judged with the declared capabilities. Downward, each
 * root's dependencies, as the install leaves them active, must still hold what the root uses;
 * upward, each installed Domain the install does not name must still find, in every dependency the
 * install upgrades, what it uses. A finding has the shape of the Kernel refusal it predicts
 * (SCHEMA_DEPENDENCY_INCOMPATIBLE, SCHEMA_DEPENDENTS_INCOMPATIBLE). It is a pre-check, not a
 * decision: the install is sent either way and the Kernel checks everything again.
 *
 * The engine is the Kernel's own (`@astrale-os/kernel-dsl`, through the SDK), so its known limits
 * are the Kernel's too. The admission rules around the engine are mirrored, because the Kernel
 * exports no derivation of them; each mirror names its source in astrale-os/kernel:
 * - downward: `declaredBy`, `dependencyMeaning` and `transitiveCapabilities` in
 *   `runtime/schema/installation/dependencies.ts`;
 * - upward: `carriedDependents` and `carriedChanges` in `runtime/schema/cutover/plan/plan.ts`,
 *   over the closure bindings `runtime/schema/installation/introspection.ts` lists;
 * - the root's Schema Bundle: `runtime/schema/installation/source/retrieval.ts`, which
 *   `readReleaseBundle` follows.
 * A Kernel change to these rules is not seen here until it is mirrored. The pre-check stays
 * advisory, so such a drift costs a wrong warning, never an install.
 */

/** One meaning change the engine found, as the Kernel lists it in `changes`. */
interface PrecheckChange {
  readonly key: string
  readonly kind: 'missing' | 'changed' | 'added'
}

/**
 * A root whose dependency, at the revision the install leaves active, no longer holds the meaning
 * the root was built against: the details of the Kernel's SCHEMA_DEPENDENCY_INCOMPATIBLE.
 */
interface BrokenDependency {
  readonly origin: string
  readonly dependency: string
  /** The revision of `dependency` the root was built against. */
  readonly expected: string
  /** The revision of `dependency` the install leaves active. */
  readonly actual: string
  readonly changes: readonly PrecheckChange[]
}

/**
 * An installed Domain the install does not name, whose dependency the install upgrades to a
 * revision that changes what it uses: one entry of the Kernel's SCHEMA_DEPENDENTS_INCOMPATIBLE.
 */
interface BrokenDependent {
  readonly domain: { readonly origin: string; readonly revision: string }
  readonly dependency: string
  /** The revision of `dependency` the installed Domain was built against. */
  readonly expected: string
  /** The revision of `dependency` the install installs. */
  readonly actual: string
  readonly changes: readonly PrecheckChange[]
}

/**
 * What the registry offers for one broken dependent ([.69634]): the highest stable non-yanked
 * Publication built against every upgraded revision it breaks on (`compatibleDependentVersion`),
 * none, no answer the registry can give for it, or no answer from the registry.
 */
export type DependentProposal =
  | {
      readonly origin: string
      readonly kind: 'version'
      readonly version: string
      /**
       * Present when that version is served by another deployment than the installed one, whose
       * URL is its issuer ([.60662]): installing it changes the dependent's issuer, which needs
       * the operator's consent. The proposed command does not give that consent.
       */
      readonly issuer?: { readonly from: string; readonly to: string }
    }
  | { readonly origin: string; readonly kind: 'none' }
  | {
      readonly origin: string
      /**
       * It breaks on an upgraded dependency it reaches only through another Domain. A Publication
       * lists its direct dependencies only, so the registry cannot tell which version holds.
       */
      readonly kind: 'indirect'
      readonly dependencies: readonly string[]
    }
  | { readonly origin: string; readonly kind: 'unread'; readonly code: string }

/** Why one root of the install was not compared. */
type SkippedReason =
  /** The CLI could not read what the reference's deployment serves. */
  | 'release-unread'
  /** The release's Schema Bundle could not be read, or is not the one the release names. */
  | 'bundle-unread'
  /** The pre-check itself failed; the install is still sent and the Kernel decides. */
  | 'failed'

/** `--json` of the pre-check: the `precheck` member of an install report or refusal. */
export interface InstallPrecheck {
  /** Dependency bindings the engine compared; a binding at its exact revision needs none. */
  readonly compared: number
  readonly dependencies: readonly BrokenDependency[]
  readonly dependents: readonly BrokenDependent[]
  /** One per broken dependent, in the order the dependents are listed. */
  readonly proposals: readonly DependentProposal[]
  /**
   * The grouped install that adds a compatible version of every broken dependent, present only
   * when the registry offers one for each of them.
   */
  readonly command?: string
  /** Roots the pre-check did not compare, by the reference as written. */
  readonly skipped: readonly { readonly reference: string; readonly reason: SkippedReason }[]
  /**
   * Domains the pre-check could not evaluate: the Kernel did not show this caller their installed
   * schema or bindings, or the engine refused to compare one of their bindings. The comparisons
   * that needed them were not made; the Kernel still makes them.
   */
  readonly unevaluated: readonly string[]
  /**
   * For each root that declares a schedule before or after the install, what its triggers
   * become (ADR-10). Absent from a pre-check that could not run.
   */
  readonly schedules?: readonly ScheduleListing[]
}

/** The engine's verdict before the registry is read for proposals. */
export type PrecheckVerdict = Omit<InstallPrecheck, 'proposals' | 'command' | 'schedules'> & {
  /**
   * For each broken dependent, the upgraded dependencies it breaks on but reaches only through
   * another Domain (outside its direct dependencies). Not part of `--json`.
   */
  readonly indirect: ReadonlyMap<string, readonly string[]>
}

/** One root of the install as the pre-check sees it. */
export type PrecheckRoot =
  | {
      readonly kind: 'release'
      readonly reference: string
      readonly origin: string
      readonly release: DomainRelease
      readonly bundle: bundle.Bundle
    }
  | {
      readonly kind: 'skipped'
      readonly reference: string
      /** Known when the reference names it (a version) or its deployment declared it. */
      readonly origin?: string
      /** The revision the root installs, when the CLI read it. */
      readonly revision?: string
      readonly reason: SkippedReason
    }

/** The Kernel reads the pre-check makes, all under the caller's own authority. */
export type PrecheckKernel = Pick<ClientSession['schema'], 'bundle' | 'dependencies' | 'inspect'>

/**
 * At most this many installed Domains are introspected at once for the upward check, the bound
 * Admin keeps when it reads a fleet: Host execution admission is wait-bounded, so an unbounded
 * burst on a busy Host would be refused and leave Domains unevaluated.
 */
const INTROSPECTION_READS_AT_ONCE = 6

/**
 * Evaluate both directions with the engine the Kernel uses, from what the caller can read:
 * the installed listing taken before the install, the Kernel's introspection of the installed
 * Domains, and each root's own release bundle. Never throws for a Domain it cannot read: the
 * Domain is reported unevaluated and the comparisons that needed it are not made.
 */
export async function precheckInstall(
  roots: readonly PrecheckRoot[],
  installed: readonly InstalledRelease[],
  kernel: PrecheckKernel,
): Promise<PrecheckVerdict> {
  const reads = kernelReads(kernel)
  const listed = new Map(installed.map((entry) => [entry.origin, entry] as const))
  const requested = new Map(
    roots.flatMap((root) => (root.origin === undefined ? [] : [[root.origin, root] as const])),
  )
  const skipped = roots.flatMap((root) =>
    root.kind === 'skipped' ? [{ reference: root.reference, reason: root.reason }] : [],
  )
  let compared = 0
  const dependencies: BrokenDependency[] = []
  const dependents: BrokenDependent[] = []
  const indirect = new Map<string, string[]>()

  /**
   * The revision of `origin` installed before the install. The Kernel reads every registration;
   * the listing omits builtin and local installations, which introspection still shows.
   */
  const installedRevision = async (origin: string): Promise<string | undefined> =>
    listed.get(origin)?.revision ?? (await reads.inspect(origin))?.revision
  /** The revision of `origin` the install leaves active: the requested root's, else the installed one. */
  const activeRevisionAfter = async (origin: string): Promise<string | undefined> => {
    const root = requested.get(origin)
    if (root !== undefined)
      return root.kind === 'release' ? root.release.schema.revision : root.revision
    return installedRevision(origin)
  }
  /** The schema of `origin` the install leaves active. */
  const activeSchemaAfter = async (
    origin: string,
  ): Promise<{ revision: string; schema: schema.DomainSchema } | undefined> => {
    const root = requested.get(origin)
    if (root !== undefined) {
      return root.kind === 'release'
        ? { revision: root.release.schema.revision, schema: root.bundle.root }
        : undefined
    }
    const installedBundle = await reads.bundle(origin)
    return installedBundle === undefined
      ? undefined
      : { revision: installedBundle.domain.revision, schema: installedBundle.bundle.root }
  }

  // Downward (Kernel `dependencyMeaning` and `transitiveCapabilities`).
  for (const root of [...roots].sort(byOrigin)) {
    if (root.kind !== 'release') continue
    const declared = declaredBy(root, listed, reads, installedRevision)
    const direct = Object.values(root.bundle.root.dependencies).sort(byOrigin)
    // A capability of an origin reached only through the exact closure is judged like a direct
    // one; such an origin is compared only for the capabilities the root declares on it.
    const bindings = [
      ...direct.map(({ origin, revision }) => ({ origin, revision, direct: true })),
      ...root.bundle.closure
        .filter(({ origin }) => origin !== root.origin && !direct.some((d) => d.origin === origin))
        .map((entry) => ({
          origin: entry.origin,
          revision: schema.revision(entry),
          direct: false,
        })),
    ]
    for (const binding of bindings) {
      const actual = await activeRevisionAfter(binding.origin)
      if (actual === undefined || actual === binding.revision) continue
      const closure = binding.direct ? undefined : await declared(binding.origin, actual)
      if (closure?.length === 0) continue
      const active = await activeSchemaAfter(binding.origin)
      if (active === undefined) continue
      const capabilities = closure ?? (await declared(binding.origin, active.revision))
      const changes = compareDependency(root.bundle.root, active.schema, capabilities, false)
      if (changes === undefined) {
        reads.unevaluated.add(root.origin)
        continue
      }
      compared += 1
      if (changes.length > 0) {
        dependencies.push({
          origin: root.origin,
          dependency: binding.origin,
          expected: binding.revision,
          actual: active.revision,
          changes,
        })
      }
    }
  }

  // Upward (Kernel `carriedDependents`): only a root that replaces an installed revision can
  // change what a dependent uses.
  const upgraded = new Map<string, Extract<PrecheckRoot, { kind: 'release' }>>()
  for (const root of roots) {
    const active = root.origin === undefined ? undefined : listed.get(root.origin)
    if (active === undefined) continue
    const revision = root.kind === 'release' ? root.release.schema.revision : root.revision
    if (revision === active.revision) continue
    if (root.kind === 'release') upgraded.set(root.origin, root)
  }
  if (upgraded.size > 0) {
    const others = [...installed]
      .filter((entry) => !requested.has(entry.origin))
      .sort((left, right) => compareText(left.origin, right.origin))
    const bindings = await mapBounded(
      others,
      INTROSPECTION_READS_AT_ONCE,
      async (entry) => [entry, await reads.dependencies(entry.origin)] as const,
    )
    for (const [entry, bound] of bindings) {
      if (bound === undefined) continue
      for (const binding of bound.dependencies) {
        const root = upgraded.get(binding.origin)
        if (root === undefined || binding.pinned === root.release.schema.revision) continue
        const dependent = await reads.bundle(entry.origin)
        if (dependent === undefined) break
        const keys = capabilityKeys(dependent.domain.capabilities.requested)
        const changes = compareDependency(dependent.bundle.root, root.bundle.root, keys, true)
        if (changes === undefined) {
          reads.unevaluated.add(entry.origin)
          continue
        }
        compared += 1
        if (changes.length === 0) continue
        dependents.push({
          domain: { origin: entry.origin, revision: dependent.domain.revision },
          dependency: binding.origin,
          expected: binding.pinned,
          actual: root.release.schema.revision,
          changes,
        })
        const direct = Object.values(dependent.bundle.root.dependencies).some(
          ({ origin }) => origin === binding.origin,
        )
        if (!direct)
          indirect.set(entry.origin, [...(indirect.get(entry.origin) ?? []), binding.origin])
      }
    }
  }

  return {
    compared,
    dependencies,
    dependents,
    skipped,
    unevaluated: [...reads.unevaluated].sort(compareText),
    indirect,
  }
}

/**
 * The capability Keys a root's declaration judges one binding with, as the Kernel derives them
 * (`declaredBy`, `runtime/schema/installation/dependencies.ts`): a root already installed at the
 * same revision with the same declaration of a dependency that the install does not replace keeps
 * the answer its installation got, so its declaration judges nothing there. The Kernel compares
 * the dependency's installed registration with the revision the install leaves active, so the
 * installed revision is read for builtin and local installations too, which the listing omits. It
 * reads the held declaration from its catalog record; the CLI reads the one introspection shows.
 */
function declaredBy(
  root: Extract<PrecheckRoot, { kind: 'release' }>,
  listed: ReadonlyMap<string, InstalledRelease>,
  reads: KernelReads,
  installedRevision: (origin: string) => Promise<string | undefined>,
): (origin: string, active: string) => Promise<readonly Key[]> {
  const keys = capabilityKeys(root.release.requirements.capabilities)
  const installedRoot = listed.get(root.origin)
  const held =
    installedRoot !== undefined && installedRoot.revision === root.release.schema.revision
      ? reads.inspect(root.origin)
      : Promise.resolve(undefined)
  return async (origin, active) => {
    const judged = keys.filter((key) => Key.origin(key) === origin)
    if (judged.length === 0) return judged
    const holding = await held
    if (holding === undefined || (await installedRevision(origin)) !== active) return judged
    const kept = capabilityKeys(holding.capabilities.requested).filter(
      (key) => Key.origin(key) === origin,
    )
    return kept.length === judged.length && kept.every((key, index) => key === judged[index])
      ? []
      : judged
  }
}

/**
 * The meaning changes that make `dependent` incompatible with `target`, as the Kernel lists them
 * (`carriedChanges`, `runtime/schema/cutover/plan/plan.ts`). A declared capability the dependent's
 * own retained source does not define is a missing Key, which is how the Kernel names a carried
 * dependent holding one.
 */
function compareDependency(
  dependent: schema.DomainSchema,
  target: schema.DomainSchema,
  capabilities: readonly Key[],
  alwaysDeclare: boolean,
): readonly PrecheckChange[] | undefined {
  let comparison: schema.compatibility.StructureComparison
  try {
    comparison = schema.compatibility.compareStructure({
      scope: {
        kind: 'dependency',
        dependent,
        ...(capabilities.length === 0 && !alwaysDeclare ? {} : { capabilities }),
      },
      target,
    })
  } catch (cause) {
    if (!(cause instanceof schema.Error)) throw cause
    const key = cause.diagnostics.find(({ code }) => code === 'DM_CAPABILITY_INVALID')?.ref
    // Any other refusal of the engine (a binding its retained context does not hold) is not a
    // verdict: the caller reports the Domain unevaluated.
    if (key === undefined) return undefined
    return [{ key, kind: 'missing' }]
  }
  if (comparison.compatible) return []
  return comparison.assessments
    .filter((assessment) => !assessment.satisfied)
    .map(({ subject, observation }) => ({
      key: subject.key as string,
      kind: observation.state as PrecheckChange['kind'],
    }))
}

/**
 * The Kernel's introspection of the installed Domains, one read per origin and kind. A refused or
 * failed read marks the origin unevaluated instead of failing the pre-check.
 */
function kernelReads(kernel: PrecheckKernel) {
  const unevaluated = new Set<string>()
  const once = <Value>(load: (origin: Key.Origin) => Promise<Value>) => {
    const reads = new Map<string, Promise<Value | undefined>>()
    return (origin: string): Promise<Value | undefined> => {
      let read = reads.get(origin)
      if (read === undefined) {
        read = load(origin as Key.Origin).catch(() => {
          unevaluated.add(origin)
          return undefined
        })
        reads.set(origin, read)
      }
      return read
    }
  }
  return {
    unevaluated,
    bundle: once((origin) => kernel.bundle(origin)),
    inspect: once((origin) => kernel.inspect(origin)),
    dependencies: once((origin) => kernel.dependencies(origin)),
  }
}

type KernelReads = ReturnType<typeof kernelReads>

/**
 * For each broken dependent, read its Publications in the registry and pick the highest stable
 * non-yanked version built against every upgraded revision it breaks on ([.69634]). The selection
 * stays in `@astrale-os/sdk/versioning`, and an index entry whose version the SDK does not accept
 * is never a compatible dependent. A Domain the caller cannot read in the registry has no published
 * version for it; any other registry failure leaves that dependent without a proposal. Every
 * dependent given here reaches what it breaks on directly: a Publication lists its direct
 * dependencies only, so the caller answers the others as `indirect`.
 */
export async function proposeDependentVersions(
  dependents: readonly BrokenDependent[],
  installed: readonly InstalledRelease[],
  registry: Pick<AdminRegistryApi, 'index'>,
): Promise<readonly DependentProposal[]> {
  const targets = new Map<string, { origin: string; revision: Revision }[]>()
  for (const dependent of dependents) {
    const list = targets.get(dependent.domain.origin) ?? []
    if (!list.some(({ origin }) => origin === dependent.dependency)) {
      list.push({ origin: dependent.dependency, revision: dependent.actual as Revision })
    }
    targets.set(dependent.domain.origin, list)
  }
  return Promise.all(
    [...targets].map(async ([origin, upgraded]): Promise<DependentProposal> => {
      let publications
      try {
        publications = (await registry.index(origin)).publications
      } catch (error) {
        const { code } = registryFailure(error, 'read')
        return code === 'REGISTRY_DOMAIN_NOT_FOUND'
          ? { origin, kind: 'none' }
          : { origin, kind: 'unread', code }
      }
      const candidates = publications.flatMap((entry) => {
        try {
          // The registry names revisions as text; the selection compares them exactly.
          const dependencies = entry.dependencies as readonly {
            readonly origin: string
            readonly revision: Revision
          }[]
          return [{ ...entry, version: acceptVersion(entry.version), dependencies }]
        } catch {
          return []
        }
      })
      const [first, ...rest] = upgraded
      const holding = candidates.filter((candidate) =>
        rest.every((target) =>
          candidate.dependencies.some(
            (dependency) =>
              dependency.origin === target.origin && dependency.revision === target.revision,
          ),
        ),
      )
      // Every dependent listed here has at least one upgraded dependency.
      const version = compatibleDependentVersion(holding, first!)
      if (version === undefined) return { origin, kind: 'none' }
      const issuer = issuerChange(
        installed.find((entry) => entry.origin === origin),
        holding.find((candidate) => candidate.version === version)?.url,
      )
      return { origin, kind: 'version', version, ...(issuer === undefined ? {} : { issuer }) }
    }),
  )
}

/**
 * The issuer change installing a Publication served at `url` makes: each deployment is its own
 * issuer, its URL ([.60662]), so another deployment than the installed issuer's changes it.
 */
function issuerChange(
  current: InstalledRelease | undefined,
  url: string | undefined,
): { readonly from: string; readonly to: string } | undefined {
  if (current === undefined || url === undefined) return undefined
  const to = urlOrigin(url)
  if (to === undefined || to === urlOrigin(current.issuer)) return undefined
  return { from: current.issuer, to }
}

function urlOrigin(input: string): string | undefined {
  try {
    return new URL(input).origin
  } catch {
    return undefined
  }
}

/**
 * What one declared schedule makes the Kernel do, as the pre-check shows it: the calendar as one
 * cron text, the zone it is read in, and the options a tick follows. `overlap` and `input` are
 * spelled out with the defaults an accepted Schema omits (`skip`, `{}`).
 */
export interface ScheduleDeclaration {
  readonly cron: string
  readonly timezone: string
  readonly overlap: 'skip' | 'allow'
  /** Seconds a tick may still start late; absent means no limit. */
  readonly maxDelay?: number
  readonly input: unknown
}

/** One schedule of a root, and what the install does to it. */
export interface ScheduleEntry {
  /** The callable it starts: a Function's name, or `Class.method` for a static Method. */
  readonly callable: string
  /** Its stable name within the callable (`default` when the declaration names none). */
  readonly name: string
  /**
   * `added` when the active Bundle declares no schedule of that callable and name, or could not
   * be read (the listing says so); `removed` when only the active Bundle declares it.
   */
  readonly change: 'added' | 'changed' | 'removed' | 'unchanged'
  /** What the install leaves declared; absent for a removed schedule. */
  readonly declared?: ScheduleDeclaration
  /** What the active Bundle declares; present for a changed or removed schedule. */
  readonly previous?: ScheduleDeclaration
  /** What a changed schedule changes, in declaration order. */
  readonly changed?: readonly (keyof ScheduleDeclaration)[]
}

/** The schedules one root declares before and after the install, each acting as that root. */
export interface ScheduleListing {
  readonly origin: string
  /**
   * `read`: compared with the active Bundle; `absent`: a first install, so every schedule is new;
   * `unread`: the caller could not read the active Bundle, so every schedule is listed as added.
   */
  readonly active: 'read' | 'absent' | 'unread'
  readonly schedules: readonly ScheduleEntry[]
}

/**
 * The schedules each root of the install declares, compared with its active Bundle: what is new,
 * changed or removed. A trigger enters the Domain revision, so a root installed again at its
 * active revision changes none and its active Bundle is not read. The Kernel neither asks for nor
 * records a consent to schedules (ADR-10, decision 5): this only informs the operator. A root
 * whose own Bundle could not be read is not listed: its schedules are unknown.
 */
export async function precheckSchedules(
  roots: readonly PrecheckRoot[],
  installed: readonly InstalledRelease[],
  kernel: Pick<PrecheckKernel, 'bundle'>,
): Promise<readonly ScheduleListing[]> {
  const listings = await Promise.all(
    roots.map(async (root): Promise<ScheduleListing | undefined> => {
      if (root.kind !== 'release') return undefined
      const candidate = declaredSchedules(root.bundle.root)
      const listed = installed.find((entry) => entry.origin === root.origin)
      if (listed?.revision === root.release.schema.revision) {
        return scheduleListing(root.origin, 'read', candidate, candidate)
      }
      let active: readonly DeclaredSchedule[]
      try {
        active = declaredSchedules((await kernel.bundle(root.origin as Key.Origin)).bundle.root)
      } catch (error) {
        // The listing omits builtin and local installations: only the Kernel says none is there.
        const absent = listed === undefined && isAbsentDomain(error)
        return scheduleListing(root.origin, absent ? 'absent' : 'unread', candidate, [])
      }
      return scheduleListing(root.origin, 'read', candidate, active)
    }),
  )
  return listings.filter(
    (listing): listing is ScheduleListing => listing !== undefined && listing.schedules.length > 0,
  )
}

/**
 * Whether reading an origin found no installed Domain: the Kernel answers an origin that is not
 * installed with 1003 and reason SCHEMA_NOT_FOUND. An exact 3002 says the same.
 */
export function isAbsentDomain(error: unknown): boolean {
  if (!(error instanceof ResponseError)) return false
  return (
    error.code === 3002 || (error.code === 1003 && reasonCode(error.reason) === 'SCHEMA_NOT_FOUND')
  )
}

/** One declared schedule, keyed by its callable and name. */
interface DeclaredSchedule {
  readonly callable: string
  readonly name: string
  readonly declaration: ScheduleDeclaration
}

/**
 * A trigger as an accepted Schema keeps it on a Function or static Method (kernel-dsl
 * `ScheduleTrigger`): a canonical calendar, never cron text; `timezone` and `name` explicit;
 * `overlap` only as `allow`; `input` and `maxDelay` only when declared.
 */
interface ScheduleTrigger {
  readonly kind: 'schedule'
  readonly name: string
  readonly calendar: Calendar
  readonly timezone: string
  readonly input?: unknown
  readonly overlap?: 'allow'
  readonly maxDelay?: number
}

/** The canonical calendar of a trigger (kernel-dsl `Calendar`): absent fields match every value. */
interface Calendar {
  readonly minute?: readonly number[]
  readonly hour?: readonly number[]
  readonly day?: readonly number[]
  readonly month?: readonly number[]
  readonly weekday?: readonly number[]
}

/**
 * Every schedule a Schema declares: each trigger of a Function and of a static Method of one of
 * its Classes. The accepted Schema keeps them in Unicode order of their names.
 */
function declaredSchedules(root: schema.DomainSchema): readonly DeclaredSchedule[] {
  const callables = [
    ...Object.entries(root.functions).map(([name, definition]) => [name, definition] as const),
    ...Object.entries(root.classes).flatMap(([owner, definition]) =>
      Object.entries('methods' in definition ? definition.methods : {})
        .filter(([, method]) => method.static)
        .map(([name, method]) => [`${owner}.${name}`, method] as const),
    ),
  ].sort(([left], [right]) => compareText(left, right))
  return callables.flatMap(([callable, definition]) =>
    triggersOf(definition).map((trigger) => ({
      callable,
      name: trigger.name,
      declaration: {
        cron: renderCron(trigger.calendar),
        timezone: trigger.timezone,
        overlap: trigger.overlap ?? 'skip',
        ...(trigger.maxDelay === undefined ? {} : { maxDelay: trigger.maxDelay }),
        input: trigger.input ?? {},
      },
    })),
  )
}

/**
 * The triggers a callable declares. `trigger` is part of the accepted Schema from the
 * kernel-dsl release that introduces scheduled callables; it is read through this one view so the
 * pre-check also builds against an SDK whose Schema types predate it, where no Bundle carries one.
 */
function triggersOf(definition: object): readonly ScheduleTrigger[] {
  if (!('trigger' in definition) || definition.trigger === undefined) return []
  return (definition.trigger as readonly ScheduleTrigger[]).filter(
    (trigger) => trigger.kind === 'schedule',
  )
}

function scheduleListing(
  origin: string,
  active: ScheduleListing['active'],
  candidate: readonly DeclaredSchedule[],
  current: readonly DeclaredSchedule[],
): ScheduleListing {
  const key = ({ callable, name }: DeclaredSchedule) => `${callable}\u0000${name}`
  const before = new Map(current.map((schedule) => [key(schedule), schedule] as const))
  const after = new Set(candidate.map(key))
  const schedules: ScheduleEntry[] = candidate.map((schedule): ScheduleEntry => {
    const previous = before.get(key(schedule))
    const base = {
      callable: schedule.callable,
      name: schedule.name,
      declared: schedule.declaration,
    }
    if (previous === undefined) return { ...base, change: 'added' }
    const changed = changedMembers(previous.declaration, schedule.declaration)
    return changed.length === 0
      ? { ...base, change: 'unchanged' }
      : { ...base, change: 'changed', previous: previous.declaration, changed }
  })
  for (const schedule of current) {
    if (after.has(key(schedule))) continue
    schedules.push({
      callable: schedule.callable,
      name: schedule.name,
      change: 'removed',
      previous: schedule.declaration,
    })
  }
  schedules.sort(
    (left, right) =>
      compareText(left.callable, right.callable) || compareText(left.name, right.name),
  )
  return { origin, active, schedules }
}

function changedMembers(
  before: ScheduleDeclaration,
  after: ScheduleDeclaration,
): readonly (keyof ScheduleDeclaration)[] {
  return (['cron', 'timezone', 'overlap', 'maxDelay', 'input'] as const).filter(
    (member) => !sameValue(before[member], after[member]),
  )
}

/** Structural equality of two portable values, whatever the order of their object members. */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index]))
    )
  }
  const leftKeys = Object.keys(left)
  const rightRecord = right as Record<string, unknown>
  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every(
      (member) =>
        Object.hasOwn(rightRecord, member) &&
        sameValue((left as Record<string, unknown>)[member], rightRecord[member]),
    )
  )
}

const CALENDAR_FIELDS = Object.freeze({
  minute: { minimum: 0, maximum: 59 },
  hour: { minimum: 0, maximum: 23 },
  day: { minimum: 1, maximum: 31 },
  month: { minimum: 1, maximum: 12 },
  weekday: { minimum: 0, maximum: 6 },
} as const)

/**
 * The cron text of a canonical calendar, as the Kernel renders it in `Schedule.status`: `*` for
 * an absent field, `*\/n` or `a-b/n` for an arithmetic progression of three values or more, else
 * a comma list in which three consecutive values or more read `a-b`. A mirror of `renderCron` in
 * astrale-os/kernel `dsl/v1/language/schedule/cron.ts`, which the SDK does not re-export.
 */
export function renderCron(calendar: Calendar): string {
  return (Object.keys(CALENDAR_FIELDS) as (keyof Calendar)[])
    .map((field) => renderCronField(field, calendar[field]))
    .join(' ')
}

function renderCronField(field: keyof Calendar, values: readonly number[] | undefined): string {
  if (values === undefined) return '*'
  const first = values[0]!
  const last = values.at(-1)!
  const stride = values.length >= 3 ? values[1]! - first : 0
  if (stride >= 2 && values.every((value, index) => value === first + index * stride)) {
    const { minimum, maximum } = CALENDAR_FIELDS[field]
    return first === minimum && last + stride > maximum
      ? `*/${stride}`
      : `${first}-${last}/${stride}`
  }
  const items: string[] = []
  for (let start = 0; start < values.length;) {
    let end = start
    while (values[end + 1] === values[end]! + 1) end++
    if (end - start >= 2) items.push(`${values[start]}-${values[end]}`)
    else items.push(...values.slice(start, end + 1).map(String))
    start = end + 1
  }
  return items.join(',')
}

function byOrigin(left: { readonly origin?: string }, right: { readonly origin?: string }): number {
  return compareText(left.origin ?? '', right.origin ?? '')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
