/**
 * The Workspace level's one service: where each workspace Domain stands, what changed since its
 * last Publication, its dependencies and their compatibility, the registry, and Publish. Every
 * part shares one registry reader, so one index read serves every question asked of it.
 */
import type {
  DependencyStanding,
  DomainDependencies,
  DomainLocal,
  DomainStanding,
  LocalCopy,
} from '../../../shared/contracts/versions'
import type { DomainHandle } from '../../domain/registry'

import { createChangeJudge, type ChangeJudge } from './changes'
import { defaultVersionsContext, type VersionsContext } from './context'
import { createCompatibilityJudge, type CompatibilityJudge } from './judge'
import { findWorkspaceDomain, readLocal, readSources } from './local'
import { createPublisher, type Publisher } from './publish'
import { createPublishedViewer, type PublishedViewer } from './published'
import { createRegistryReader, type RegistryReader } from './registry'
import { carriersOf, relationOf } from './relation'

export interface Versions {
  registry: RegistryReader
  changes: ChangeJudge
  compatibility: CompatibilityJudge
  published: PublishedViewer
  publisher: Publisher
  /** Every workspace Domain on disk; never reads the network. */
  locals(): Promise<DomainLocal[]>
  standing(handle: DomainHandle, options?: { fresh?: boolean }): Promise<DomainStanding>
  dependencies(handle: DomainHandle, options?: { fresh?: boolean }): Promise<DomainDependencies>
}

export function createVersions(context: VersionsContext): Versions {
  const registry = createRegistryReader(context)
  const changes = createChangeJudge(context, registry)
  const readAt = () => new Date(context.now()).toISOString()

  async function localCopy(origin: string, builtAgainst: string): Promise<LocalCopy | null> {
    const handle = await findWorkspaceDomain(context, origin)
    if (!handle) return null
    const sources = await readSources(context, handle)
    return {
      domainId: handle.id,
      revision: sources.revision,
      atBuiltAgainst: sources.revision === null ? null : sources.revision === builtAgainst,
      ...(sources.revisionError === undefined ? {} : { revisionError: sources.revisionError }),
    }
  }

  return {
    registry,
    changes,
    compatibility: createCompatibilityJudge(context, registry),
    published: createPublishedViewer(context, registry),
    publisher: createPublisher(context, registry, changes),

    locals: () => Promise.all(context.domains().map((handle) => readLocal(context, handle))),

    async standing(handle, options = {}) {
      const local = await readLocal(context, handle)
      const index =
        local.origin === null
          ? {
              status: 'failed' as const,
              message: `The Schema's origin is unknown: ${local.revisionError ?? 'it could not be read.'}`,
              readAt: readAt(),
            }
          : await registry.index(local.origin, { fresh: options.fresh === true })
      const latest = index.status === 'ok' ? index.value.publications[0] : undefined
      return {
        local,
        index,
        ...(latest === undefined ? {} : { latest }),
        relation: relationOf(local, index),
        carriedBy: index.status === 'ok' ? carriersOf(index.value, local.revision) : [],
      }
    },

    async dependencies(handle, options = {}) {
      const sources = await readSources(context, handle)
      if (sources.revision === null) {
        return {
          domainId: handle.id,
          origin: sources.origin,
          revision: null,
          error: sources.revisionError ?? 'The local Schema revision is unknown.',
          dependencies: [],
        }
      }
      const dependencies: DependencyStanding[] = await Promise.all(
        sources.dependencies.map(async ({ alias, origin, revision }) => {
          const [index, local] = await Promise.all([
            registry.index(origin, { fresh: options.fresh === true }),
            localCopy(origin, revision),
          ])
          return {
            alias,
            origin,
            builtAgainst: revision,
            local,
            index,
            carriedBy: index.status === 'ok' ? carriersOf(index.value, revision) : [],
          }
        }),
      )
      return {
        domainId: handle.id,
        origin: sources.origin,
        revision: sources.revision,
        dependencies,
      }
    },
  }
}

let shared: Versions | undefined

/** The process's service, over the real CLI, the workspace registry and the bundle cache. */
export function versions(): Versions {
  return (shared ??= createVersions(defaultVersionsContext))
}
