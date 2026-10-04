import type { DomainBundle, InstalledRelease } from '@astrale-os/sdk/client/schema'
import type { ClientSession } from '@astrale-os/sdk/client/session'
import type { DomainRelease } from '@astrale-os/sdk/release'

import { capabilityKeys } from '@astrale-os/sdk/release'
import { Key, schema, type bundle, type Revision } from '@astrale-os/sdk/schema'
import { acceptVersion, compatibleDependentVersion } from '@astrale-os/sdk/versioning'

import type { AdminRegistryApi } from '../../admin/registry'

import { registryFailure } from '../../admin/registry/failure'

/**
 * The install pre-check (Résolution [.78239], Installation [.69634]): before the install is sent,
 * the CLI evaluates both directions the Kernel checks at install ([.96185]) with the same engine
 * (`schema.compatibility.compareStructure`, capabilities included, CT13). Downward, each root's
 * dependencies, as the install leaves them active, must still hold what the root uses; upward,
 * each installed Domain the install does not name must still find, in every dependency the install
 * upgrades, what it uses. A finding has the shape of the Kernel refusal it predicts
 * (SCHEMA_DEPENDENCY_INCOMPATIBLE, SCHEMA_DEPENDENTS_INCOMPATIBLE). It is a pre-check, not a
 * decision: the install is sent either way and the Kernel checks everything again.
 */

/** One meaning change the engine found, as the Kernel lists it in `changes`. */
export interface PrecheckChange {
  readonly key: string
  readonly kind: 'missing' | 'changed' | 'added'
}

/**
 * A root whose dependency, at the revision the install leaves active, no longer holds the meaning
 * the root was built against: the details of the Kernel's SCHEMA_DEPENDENCY_INCOMPATIBLE.
 */
export interface BrokenDependency {
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
export interface BrokenDependent {
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
 * Publication built against every upgraded revision it breaks on (`compatibleDependentVersion`,
 * CT28), none, or no answer from the registry.
 */
export type DependentProposal =
  | { readonly origin: string; readonly kind: 'version'; readonly version: string }
  | { readonly origin: string; readonly kind: 'none' }
  | { readonly origin: string; readonly kind: 'unread'; readonly code: string }

/** Why one root of the install was not compared. */
export type SkippedReason =
  /** The CLI could not read what the reference's deployment serves. */
  | 'release-unread'
  /** The deployment serves a legacy v2/v3 document, which the pre-check does not evaluate. */
  | 'legacy'
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
}

/** The engine's verdict before the registry is read for proposals. */
export type PrecheckVerdict = Omit<InstallPrecheck, 'proposals' | 'command'>

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

interface Generation {
  readonly revision: string
  readonly schema: schema.DomainSchema
}

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
  const reads = new KernelReads(kernel)
  const listed = new Map(installed.map((entry) => [entry.origin, entry] as const))
  const requested = new Map<string, PrecheckRoot>()
  for (const root of roots) {
    if (root.origin !== undefined) requested.set(root.origin, root)
  }
  const skipped = roots.flatMap((root) =>
    root.kind === 'skipped'
      ? [Object.freeze({ reference: root.reference, reason: root.reason })]
      : [],
  )
  let compared = 0
  const dependencies: BrokenDependency[] = []
  const dependents: BrokenDependent[] = []

  /** The revision of `origin` the install leaves active: the requested root's, else the installed one. */
  const activeAfter = async (origin: string): Promise<string | undefined> => {
    const root = requested.get(origin)
    if (root !== undefined)
      return root.kind === 'release' ? root.release.schema.revision : root.revision
    return listed.get(origin)?.revision ?? (await reads.inspect(origin))?.revision
  }
  /** The schema of `origin` the install leaves active. */
  const generationAfter = async (origin: string): Promise<Generation | undefined> => {
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

  for (const root of [...roots].sort(byOrigin)) {
    if (root.kind !== 'release') continue
    const declared = await declaredBy(root, listed, reads)
    const direct = Object.values(root.bundle.root.dependencies).sort(byOrigin)
    for (const dependency of direct) {
      const actual = await activeAfter(dependency.origin)
      if (actual === undefined || actual === dependency.revision) continue
      const generation = await generationAfter(dependency.origin)
      if (generation === undefined) continue
      const capabilities = declared(dependency.origin, generation.revision)
      const changes = compareDependency(root.bundle.root, generation.schema, capabilities, false)
      if (changes === undefined) {
        reads.unevaluated.add(root.origin)
        continue
      }
      compared += 1
      if (changes.length > 0) {
        dependencies.push(broken(root.origin, dependency, generation.revision, changes))
      }
    }
    // A capability of an origin reached only through the exact closure is judged like a direct one.
    const directOrigins = new Set(direct.map(({ origin }) => origin))
    for (const entry of root.bundle.closure) {
      const revision = schema.revision(entry)
      if (entry.origin === root.origin || directOrigins.has(entry.origin)) continue
      const actual = await activeAfter(entry.origin)
      if (actual === undefined || actual === revision) continue
      const capabilities = declared(entry.origin, actual)
      if (capabilities.length === 0) continue
      const generation = await generationAfter(entry.origin)
      if (generation === undefined) continue
      const changes = compareDependency(root.bundle.root, generation.schema, capabilities, false)
      if (changes === undefined) {
        reads.unevaluated.add(root.origin)
        continue
      }
      compared += 1
      if (changes.length > 0) {
        dependencies.push(
          broken(root.origin, { origin: entry.origin, revision }, generation.revision, changes),
        )
      }
    }
  }

  // Upward: only a root that replaces an installed revision can change what a dependent uses.
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
    const bindings = await Promise.all(
      others.map(async (entry) => [entry, await reads.dependencies(entry.origin)] as const),
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
        if (changes.length > 0) {
          dependents.push(
            Object.freeze({
              domain: Object.freeze({ origin: entry.origin, revision: dependent.domain.revision }),
              dependency: binding.origin,
              expected: binding.pinned,
              actual: root.release.schema.revision,
              changes,
            }),
          )
        }
      }
    }
  }

  return Object.freeze({
    compared,
    dependencies: Object.freeze(dependencies),
    dependents: Object.freeze(dependents),
    skipped: Object.freeze(skipped),
    unevaluated: Object.freeze([...reads.unevaluated].sort(compareText)),
  })
}

/**
 * The capability Keys a root's declaration judges one binding with, as the Kernel derives them: a
 * root already installed at the same revision with the same declaration of a dependency that the
 * install does not replace keeps the answer its installation got, so its declaration judges
 * nothing there.
 */
async function declaredBy(
  root: Extract<PrecheckRoot, { kind: 'release' }>,
  listed: ReadonlyMap<string, InstalledRelease>,
  reads: KernelReads,
): Promise<(origin: string, revision: string) => readonly Key[]> {
  const keys = capabilityKeys(root.release.requirements.capabilities)
  const active = listed.get(root.origin)
  const held =
    active !== undefined && active.revision === root.release.schema.revision
      ? await reads.inspect(root.origin)
      : undefined
  const heldKeys = held === undefined ? undefined : capabilityKeys(held.capabilities.requested)
  return (origin, revision) => {
    const judged = keys.filter((key) => Key.origin(key) === origin)
    if (
      judged.length === 0 ||
      heldKeys === undefined ||
      listed.get(origin)?.revision !== revision
    ) {
      return judged
    }
    const kept = heldKeys.filter((key) => Key.origin(key) === origin)
    return kept.length === judged.length && kept.every((key, index) => key === judged[index])
      ? []
      : judged
  }
}

/**
 * The meaning changes that make `dependent` incompatible with `target`, as the Kernel lists them.
 * A declared capability the dependent's own retained source does not define is a missing Key,
 * which is how the Kernel names a carried dependent holding one.
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
    const key = invalidCapability(cause)
    // Any other refusal of the engine (a binding its retained context does not hold) is not a
    // verdict: the caller reports the Domain unevaluated.
    if (key === undefined) return undefined
    return Object.freeze([Object.freeze({ key, kind: 'missing' as const })])
  }
  if (comparison.compatible) return Object.freeze([])
  return Object.freeze(
    comparison.assessments
      .filter((assessment) => !assessment.satisfied)
      .map(({ subject, observation }) =>
        Object.freeze({
          key: subject.key as string,
          kind: observation.state as PrecheckChange['kind'],
        }),
      ),
  )
}

function invalidCapability(cause: schema.Error): string | undefined {
  return cause.diagnostics.find(({ code }) => code === 'DM_CAPABILITY_INVALID')?.ref
}

function broken(
  origin: string,
  dependency: { readonly origin: string; readonly revision: string },
  actual: string,
  changes: readonly PrecheckChange[],
): BrokenDependency {
  return Object.freeze({
    origin,
    dependency: dependency.origin,
    expected: dependency.revision,
    actual,
    changes,
  })
}

/**
 * The Kernel's introspection of the installed Domains, one read per origin and kind. A refused or
 * failed read marks the origin unevaluated instead of failing the pre-check.
 */
class KernelReads {
  readonly unevaluated = new Set<string>()
  private readonly bundles = new Map<string, Promise<DomainBundle | undefined>>()
  private readonly infos = new Map<
    string,
    Promise<Awaited<ReturnType<PrecheckKernel['inspect']>> | undefined>
  >()
  private readonly bindings = new Map<
    string,
    Promise<Awaited<ReturnType<PrecheckKernel['dependencies']>> | undefined>
  >()

  constructor(private readonly kernel: PrecheckKernel) {}

  bundle(origin: string): Promise<DomainBundle | undefined> {
    return this.read(this.bundles, origin, () => this.kernel.bundle(origin as Key.Origin))
  }

  inspect(origin: string) {
    return this.read(this.infos, origin, () => this.kernel.inspect(origin as Key.Origin))
  }

  dependencies(origin: string) {
    return this.read(this.bindings, origin, () => this.kernel.dependencies(origin as Key.Origin))
  }

  private read<Value>(
    cache: Map<string, Promise<Value | undefined>>,
    origin: string,
    load: () => Promise<Value>,
  ): Promise<Value | undefined> {
    let read = cache.get(origin)
    if (read === undefined) {
      read = load().catch(() => {
        this.unevaluated.add(origin)
        return undefined
      })
      cache.set(origin, read)
    }
    return read
  }
}

/**
 * For each broken dependent, read its Publications in the registry and pick the highest stable
 * non-yanked version built against every upgraded revision it breaks on ([.69634], R-F07). The
 * selection stays in `@astrale-os/sdk/versioning` (AM-18); a non-canonical index entry is never a
 * compatible dependent (AM-56). A Domain the caller cannot read in the registry has no published
 * version for it; any other registry failure leaves that dependent without a proposal.
 */
export async function proposeDependentVersions(
  dependents: readonly BrokenDependent[],
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
  return Object.freeze(
    await Promise.all(
      [...targets].map(async ([origin, upgraded]): Promise<DependentProposal> => {
        let publications
        try {
          publications = (await registry.index(origin)).publications
        } catch (error) {
          const { code } = registryFailure(error, 'read')
          return code === 'REGISTRY_DOMAIN_NOT_FOUND'
            ? Object.freeze({ origin, kind: 'none' as const })
            : Object.freeze({ origin, kind: 'unread' as const, code })
        }
        const candidates = publications.flatMap((entry) => {
          try {
            return [
              {
                version: acceptVersion(entry.version),
                yanked: entry.yanked,
                // The registry names revisions as text; the selection compares them exactly.
                dependencies: entry.dependencies as readonly {
                  readonly origin: string
                  readonly revision: Revision
                }[],
              },
            ]
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
        return version === undefined
          ? Object.freeze({ origin, kind: 'none' as const })
          : Object.freeze({ origin, kind: 'version' as const, version })
      }),
    ),
  )
}

function byOrigin(left: { readonly origin?: string }, right: { readonly origin?: string }): number {
  return compareText(left.origin ?? '', right.origin ?? '')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
