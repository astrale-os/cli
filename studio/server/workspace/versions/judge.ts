/**
 * Compatibility of a workspace Domain with other versions of its dependencies, judged by the DSL's
 * dependency-scoped `compare` with the Domain's own installed SDK, in the versions island.
 *
 * A verdict reads exactly three things: the judging SDK, the dependent's Schema revision and the
 * target's Schema revision. It is kept by those three for the life of the process, so every
 * version that carries a revision shares one verdict, and a matrix computes only what it lacks:
 * one island run judges every missing target of one Domain at once.
 */
import type { SchemaRevision } from '../../../shared/contracts/schema'
import type {
  CompatibilityMatrix,
  CompatibilityTarget,
  CompatibilityVerdict,
  DependencyCompatibility,
  Remote,
  RemoteFailure,
} from '../../../shared/contracts/versions'
import type { DomainHandle } from '../../domain/registry'
import type { VersionsContext } from './context'
import type { CompareTarget, IslandDocument, IslandJudgement } from './island'
import type { RegistryReader } from './registry'

import { isSchemaRevision } from '../../../shared/contracts/schema'
import { REGISTRY_STEP_LIMITS_MS } from '../../../shared/contracts/versions'
import { introspectionScheduler } from '../../introspect/scheduler'
import { asJsonArray, asJsonRecord } from '../../json'
import { dependenciesOf, findWorkspaceDomain } from './local'
import { carriersOf } from './relation'
import { installedSdkVersion } from './sdk'

const ISLAND_TIMEOUT_MS = REGISTRY_STEP_LIMITS_MS.judgement
const BUNDLE_FETCHES = 3

/** A workspace Domain's admitted Schema, ready to be judged or judged against. */
interface Admitted {
  domainId: string
  origin: string
  revision: SchemaRevision
  document: IslandDocument
  dependencies: ReturnType<typeof dependenciesOf>
  projectRoot: string
}

interface Judged extends IslandJudgement {
  judgedAt: string
}

/** One target to judge: its revision, and how to obtain its Schema when no verdict is kept. */
interface Wanted {
  origin: string
  revision: SchemaRevision
  source(): Promise<Remote<CompareTarget['source']>>
}

export type VerdictTarget = { origin: string; version: string } | { origin: string; local: true }

export interface CompatibilityJudge {
  verdict(handle: DomainHandle, target: VerdictTarget): Promise<Remote<CompatibilityVerdict>>
  /** Every readable version of every dependency, and each dependency's workspace copy. */
  matrix(handle: DomainHandle, options?: { fresh?: boolean }): Promise<CompatibilityMatrix>
}

export function createCompatibilityJudge(
  context: VersionsContext,
  registry: RegistryReader,
): CompatibilityJudge {
  const kept = new Map<string, Judged>()
  const pending = new Map<string, Promise<Remote<Judged>>>()
  const readAt = () => new Date(context.now()).toISOString()
  const failed = (message: string): RemoteFailure => ({
    status: 'failed',
    message,
    readAt: readAt(),
  })

  /** The Domain's admitted Schema with its closure; an older cached bundle is read again once. */
  async function admitted(handle: DomainHandle): Promise<Admitted | string> {
    let bundle = await context.bundle(handle.id)
    if (bundle?.schemaMode === 'canonical-admitted' && bundle.schemaClosure === undefined) {
      bundle = await context.bundle(handle.id, true)
    }
    if (!bundle) return 'The Domain is no longer in the workspace.'
    const root = asJsonRecord(bundle.schemaRoot)
    const closure = asJsonArray(bundle.schemaClosure)
    if (
      bundle.schemaMode !== 'canonical-admitted' ||
      !isSchemaRevision(bundle.schemaRevision) ||
      typeof root?.origin !== 'string' ||
      closure === undefined
    ) {
      return (
        bundle.error?.message ?? "The Domain's installed SDK does not admit its current Schema."
      )
    }
    return {
      domainId: handle.id,
      origin: root.origin,
      revision: bundle.schemaRevision,
      document: { root, closure },
      dependencies: dependenciesOf(root.dependencies),
      projectRoot: handle.root,
    }
  }

  /** Every wanted verdict, from what is kept, then one island run for the rest. */
  async function judge(
    dependent: Admitted,
    sdk: string,
    wanted: Wanted[],
  ): Promise<Map<string, Remote<Judged>>> {
    const keyOf = (target: { origin: string; revision: string }) =>
      JSON.stringify([sdk, dependent.revision, target.origin, target.revision])
    const answers = new Map<string, Remote<Judged>>()
    const awaited = new Map<string, Promise<Remote<Judged>>>()
    const missing: Array<{ key: string; target: Wanted; settle(answer: Remote<Judged>): void }> = []
    for (const target of wanted) {
      const key = keyOf(target)
      if (answers.has(key) || awaited.has(key)) continue
      const held = kept.get(key)
      if (held) {
        answers.set(key, { status: 'ok', value: held, readAt: held.judgedAt })
        continue
      }
      const running = pending.get(key)
      if (running) {
        awaited.set(key, running)
        continue
      }
      let settle!: (answer: Remote<Judged>) => void
      const promise = new Promise<Remote<Judged>>((resolve) => (settle = resolve))
      pending.set(key, promise)
      awaited.set(key, promise)
      missing.push({ key, target, settle })
    }

    if (missing.length > 0) {
      try {
        const sources = await mapLimit(missing, BUNDLE_FETCHES, (entry) => entry.target.source())
        const targets: CompareTarget[] = []
        missing.forEach((entry, index) => {
          const source = sources[index]!
          if (source.status !== 'ok') return entry.settle(source)
          targets.push({
            id: entry.key,
            origin: entry.target.origin,
            revision: entry.target.revision,
            source: source.value,
          })
        })
        const results = targets.length === 0 ? new Map() : await compare(dependent, targets)
        for (const entry of missing) {
          const result = results.get(entry.key)
          if (result?.status === 'ok') kept.set(entry.key, result.value)
          if (result !== undefined) entry.settle(result)
        }
      } catch (error) {
        // Settling twice is a no-op, so this answers exactly the targets still waiting.
        const message = error instanceof Error ? error.message : String(error)
        for (const entry of missing) entry.settle(failed(message))
      } finally {
        for (const entry of missing) pending.delete(entry.key)
      }
    }

    for (const [key, promise] of awaited) answers.set(key, await promise)
    return new Map(wanted.map((target) => [keyOf(target), answers.get(keyOf(target))!]))
  }

  async function compare(
    dependent: Admitted,
    targets: CompareTarget[],
  ): Promise<Map<string, Remote<Judged>>> {
    const results = new Map<string, Remote<Judged>>()
    let answer: unknown
    try {
      answer = await introspectionScheduler.schedule(
        `versions:${dependent.domainId}`,
        'reader',
        () =>
          context.island(
            {
              op: 'compare',
              projectRoot: dependent.projectRoot,
              dependent: dependent.document,
              targets,
            },
            ISLAND_TIMEOUT_MS,
          ),
      ).promise
    } catch (error) {
      answer = {
        ok: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      }
    }
    const judgedAt = readAt()
    const document = asJsonRecord(answer)
    const entries =
      document?.ok === true && document.op === 'compare' ? asJsonArray(document.results) : undefined
    if (entries === undefined) {
      const message =
        typeof asJsonRecord(document?.error)?.message === 'string'
          ? `The compatibility island failed: ${String(asJsonRecord(document?.error)?.message)}`
          : 'The compatibility island answered nothing this Studio can read.'
      for (const target of targets)
        results.set(target.id, { status: 'failed', message, readAt: judgedAt })
      return results
    }
    for (const entry of entries) {
      const result = asJsonRecord(entry) as Record<string, any> | undefined
      if (typeof result?.id !== 'string') continue
      results.set(
        result.id,
        result.ok === true
          ? {
              status: 'ok',
              value: {
                compatible: result.compatible === true,
                equivalent: result.equivalent === true,
                unsatisfied: Array.isArray(result.unsatisfied) ? result.unsatisfied : [],
                evidence: {
                  structure: String(result.evidence?.structure ?? ''),
                  meaning: String(result.evidence?.meaning ?? ''),
                },
                judgedAt,
              },
              readAt: judgedAt,
            }
          : {
              status: 'failed',
              message: String(result.message ?? 'The comparison failed.'),
              readAt: judgedAt,
            },
      )
    }
    for (const target of targets) {
      if (!results.has(target.id)) {
        results.set(target.id, {
          status: 'failed',
          message: 'The compatibility island gave no verdict for this version.',
          readAt: judgedAt,
        })
      }
    }
    return results
  }

  function verdictOf(
    dependent: Admitted,
    sdk: string,
    target: CompatibilityTarget,
    sameRevisionAs: string[],
    judged: Remote<Judged>,
  ): Remote<CompatibilityVerdict> {
    if (judged.status !== 'ok') return judged
    const { judgedAt, ...judgement } = judged.value
    return {
      status: 'ok',
      value: {
        dependent: {
          domainId: dependent.domainId,
          origin: dependent.origin,
          revision: dependent.revision,
        },
        target,
        sameRevisionAs,
        ...judgement,
        scope: { capabilities: 'not-judged', held: false },
        judgedBy: { sdk },
        judgedAt,
      },
      readAt: judged.readAt,
    }
  }

  const publicationSource =
    (origin: string, version: string) => async (): Promise<Remote<CompareTarget['source']>> => {
      const file = await registry.bundleFile(origin, version)
      return file.status === 'ok'
        ? { status: 'ok', value: { bundleFile: file.value.file }, readAt: file.readAt }
        : file
    }

  /** The workspace copy of `origin` as a target, or why it cannot be one. */
  async function localTarget(
    origin: string,
  ): Promise<{ domainId: string; target: Remote<Admitted> } | null> {
    const handle = await findWorkspaceDomain(context, origin)
    if (!handle) return null
    const copy = await admitted(handle)
    return {
      domainId: handle.id,
      target:
        typeof copy === 'string' ? failed(copy) : { status: 'ok', value: copy, readAt: readAt() },
    }
  }

  const documentSource =
    (copy: Admitted) => async (): Promise<Remote<CompareTarget['source']>> => ({
      status: 'ok',
      value: { document: copy.document },
      readAt: readAt(),
    })

  async function prepare(
    handle: DomainHandle,
  ): Promise<{ dependent: Admitted; sdk: string } | string> {
    const dependent = await admitted(handle)
    if (typeof dependent === 'string') return dependent
    const sdk = installedSdkVersion(handle.root)
    if (sdk === null) return 'The Domain has no installed @astrale-os/sdk to judge with.'
    return { dependent, sdk }
  }

  return {
    async verdict(handle, request) {
      const prepared = await prepare(handle)
      if (typeof prepared === 'string') return failed(prepared)
      const { dependent, sdk } = prepared
      if (!dependent.dependencies.some((d) => d.origin === request.origin)) {
        return {
          status: 'not-found',
          message: `${dependent.origin} does not depend on ${request.origin}.`,
          readAt: readAt(),
        }
      }
      if ('local' in request) {
        const local = await localTarget(request.origin)
        if (!local) {
          return {
            status: 'not-found',
            message: `The workspace holds no ${request.origin}.`,
            readAt: readAt(),
          }
        }
        if (local.target.status !== 'ok') return local.target
        const copy = local.target.value
        const wanted = {
          origin: copy.origin,
          revision: copy.revision,
          source: documentSource(copy),
        }
        const [judged] = (await judge(dependent, sdk, [wanted])).values()
        return verdictOf(
          dependent,
          sdk,
          { kind: 'local', origin: copy.origin, domainId: copy.domainId, revision: copy.revision },
          [],
          judged!,
        )
      }
      const index = await registry.index(request.origin)
      if (index.status !== 'ok') return index
      const publication = index.value.publications.find(
        (entry) => entry.version === request.version,
      )
      if (!publication) {
        return {
          status: 'not-found',
          message: `${request.origin} has no Publication ${request.version} this caller may read.`,
          readAt: index.readAt,
        }
      }
      const carriers = carriersOf(index.value, publication.schemaRevision)
      const wanted = {
        origin: request.origin,
        revision: publication.schemaRevision,
        source: publicationSource(request.origin, carriers[0] ?? publication.version),
      }
      const [judged] = (await judge(dependent, sdk, [wanted])).values()
      return verdictOf(
        dependent,
        sdk,
        {
          kind: 'publication',
          origin: request.origin,
          version: publication.version,
          revision: publication.schemaRevision,
        },
        carriers.filter((version) => version !== publication.version),
        judged!,
      )
    },

    async matrix(handle, options = {}) {
      const prepared = await prepare(handle)
      if (typeof prepared === 'string') {
        return {
          domainId: handle.id,
          origin: handle.origin ?? null,
          revision: null,
          error: prepared,
          dependencies: [],
        }
      }
      const { dependent, sdk } = prepared
      const dependencies = dependent.dependencies
      const reads = await Promise.all(
        dependencies.map(async (dependency) => ({
          dependency,
          index: await registry.index(dependency.origin, { fresh: options.fresh === true }),
          local: await localTarget(dependency.origin),
        })),
      )
      const wanted: Wanted[] = []
      for (const { dependency, index, local } of reads) {
        if (index.status === 'ok') {
          for (const revision of new Set(
            index.value.publications.map((entry) => entry.schemaRevision),
          )) {
            const carrier = carriersOf(index.value, revision)[0]!
            wanted.push({
              origin: dependency.origin,
              revision,
              source: publicationSource(dependency.origin, carrier),
            })
          }
        }
        if (local?.target.status === 'ok') {
          const copy = local.target.value
          wanted.push({
            origin: copy.origin,
            revision: copy.revision,
            source: documentSource(copy),
          })
        }
      }
      const judged = await judge(dependent, sdk, wanted)
      const judgedOf = (origin: string, revision: string) =>
        judged.get(JSON.stringify([sdk, dependent.revision, origin, revision]))!

      const compatibility: DependencyCompatibility[] = reads.map(
        ({ dependency, index, local }) => ({
          origin: dependency.origin,
          builtAgainst: dependency.revision,
          publications:
            index.status === 'ok'
              ? {
                  status: 'ok',
                  value: index.value.publications.map((publication) => ({
                    version: publication.version,
                    yanked: publication.yanked,
                    verdict: verdictOf(
                      dependent,
                      sdk,
                      {
                        kind: 'publication',
                        origin: dependency.origin,
                        version: publication.version,
                        revision: publication.schemaRevision,
                      },
                      carriersOf(index.value, publication.schemaRevision).filter(
                        (version) => version !== publication.version,
                      ),
                      judgedOf(dependency.origin, publication.schemaRevision),
                    ),
                  })),
                  readAt: index.readAt,
                }
              : index,
          local:
            local === null
              ? null
              : {
                  domainId: local.domainId,
                  verdict:
                    local.target.status === 'ok'
                      ? verdictOf(
                          dependent,
                          sdk,
                          {
                            kind: 'local',
                            origin: local.target.value.origin,
                            domainId: local.domainId,
                            revision: local.target.value.revision,
                          },
                          [],
                          judgedOf(local.target.value.origin, local.target.value.revision),
                        )
                      : local.target,
                },
        }),
      )
      return {
        domainId: handle.id,
        origin: dependent.origin,
        revision: dependent.revision,
        dependencies: compatibility,
      }
    },
  }
}

/** `run` over `items` with at most `limit` in flight, answers in item order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const answers = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      answers[index] = await run(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return answers
}
