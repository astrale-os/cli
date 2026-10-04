import type { ClientSession, ContentApi } from '@astrale-os/sdk/client/session'
import type { Node } from '@astrale-os/sdk/graph/node'
import type { FileHandle } from 'node:fs/promises'

import { Path } from '@astrale-os/sdk/graph/path'
import { Property, Query } from '@astrale-os/sdk/query'
import { MethodKey } from '@astrale-os/sdk/schema'
import { createHash, randomUUID } from 'node:crypto'
import { open, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import type { ObservedPublication } from './decode'
import type {
  PublishRequestV1,
  PublishResultV1,
  RegistryBundleV1,
  RegistryIndexV1,
  YankResultV1,
} from './model'

import { AstraleError } from '../../errors'
import { AdminContract, callAdminMethod } from '../contract'
import { readAllNodes, type AdminGraphQueryApi } from '../graph'
import { observedPublication, publicationFromAdmin, publishedFromAdmin } from './decode'
import { registryFailure } from './failure'
import { RegistryError } from './model'
import { byPrecedenceDescending } from './order'

/** Bound of one Domain's index: far above any release cadence, small enough for one command. */
const MAXIMUM_PUBLICATIONS = 10_000
const MAXIMUM_PAGES = Math.ceil(MAXIMUM_PUBLICATIONS / 256) + 1

export interface AdminRegistryContext {
  readonly session: Pick<ClientSession, 'call'> & {
    readonly content: Pick<ContentApi, 'download'>
  }
  readonly graph: AdminGraphQueryApi
}

export interface AdminRegistryApi {
  /** Every Publication of one origin the caller may read, highest precedence first. */
  index(origin: string): Promise<RegistryIndexV1>
  /** Download one Publication's stored bundle to `output`, digest and size verified. */
  bundle(origin: string, version: string, output: string): Promise<RegistryBundleV1>
  /** Ask Admin to name the release with the version (`RegisteredDomain.publish`). */
  publish(request: PublishRequestV1): Promise<PublishResultV1>
  /** Take one version out of resolution, or put it back with `undo`. */
  yank(
    origin: string,
    version: string,
    options?: { readonly undo?: boolean },
  ): Promise<YankResultV1>
}

/**
 * The Domain version registry as the CLI reads and writes it. Reads are the caller's own Queries
 * on Admin's graph, so `ObserveRegisteredDomain` and `ReadPublication` decide what the caller sees
 * (Résolution [.78020] [.79495]); changes are Admin Methods whose Policies decide who may make
 * them. No read lists who holds access (AM-53): a Domain the caller cannot read is reported
 * exactly like an absent one.
 */
export function connectAdminRegistry(context: AdminRegistryContext): AdminRegistryApi {
  const RegisteredDomain = AdminContract.classes.RegisteredDomain
  const Publication = AdminContract.classes.Publication

  const domainOf = async (origin: string): Promise<string> => {
    const nodes = await readAllNodes(
      context.graph,
      Query.from({ nodes: [RegisteredDomain] })
        .filter({ predicate: originEquals(origin) })
        .select({ kind: 'nodes', projection: { kind: 'value' } }),
      { label: 'Admin Registered Domain', maximum: 2, maximumPages: 2 },
    )
    if (nodes.length === 0) throw domainNotFound(origin)
    if (nodes.length > 1) throw responseInvalid('Admin answered several Registered Domains.')
    return String(nodes[0]!.id)
  }

  const publicationsOf = (origin: string, version?: string): Promise<readonly Node[]> => {
    const versions = Query.from({ nodes: [RegisteredDomain] })
      .filter({ predicate: originEquals(origin) })
      .expand({ via: [AdminContract.edges.publicationOfDomain], direction: 'incoming' })
      .filter({ class: Publication })
    const selected =
      version === undefined
        ? versions
        : versions.filter({
            predicate: Property(AdminContract.properties.publication.version).equals(version),
          })
    return readAllNodes(
      context.graph,
      selected.select({ kind: 'nodes', projection: { kind: 'value' } }),
      version === undefined
        ? {
            label: 'Admin Publications',
            maximum: MAXIMUM_PUBLICATIONS,
            maximumPages: MAXIMUM_PAGES,
          }
        : { label: 'Admin Publication', maximum: 2, maximumPages: 2 },
    )
  }

  /** One version's Publication; an empty answer is told apart from an unreadable Domain. */
  const publicationOf = async (origin: string, version: string): Promise<ObservedPublication> => {
    const nodes = await publicationsOf(origin, version)
    if (nodes.length > 1)
      throw responseInvalid(`Admin answered several Publications of ${version}.`)
    if (nodes.length === 0) {
      await domainOf(origin)
      throw new RegistryError(
        'PUBLICATION_NOT_FOUND',
        `${origin} has no published version ${version} readable by this caller.`,
        { origin, version },
      )
    }
    const observed = observedPublication(nodes[0]!)
    if (observed.summary.version !== version)
      throw responseInvalid('Admin answered another version than the one asked.')
    return observed
  }

  return Object.freeze({
    async index(origin: string): Promise<RegistryIndexV1> {
      try {
        const nodes = await publicationsOf(origin)
        // One Query answers the index; only an empty one is checked against the Domain itself.
        if (nodes.length === 0) await domainOf(origin)
        const publications = nodes.map((node) => observedPublication(node).summary)
        if (new Set(publications.map((entry) => entry.version)).size !== publications.length)
          throw responseInvalid('Admin answered one version twice.')
        return Object.freeze({
          format: 'astrale.registry-index',
          version: 1,
          origin,
          publications: Object.freeze([...publications].sort(byPrecedenceDescending)),
        })
      } catch (error) {
        throw registryFailure(error, 'read')
      }
    },

    async bundle(origin: string, version: string, output: string): Promise<RegistryBundleV1> {
      let publication: ObservedPublication
      try {
        publication = await publicationOf(origin, version)
      } catch (error) {
        throw registryFailure(error, 'read')
      }
      const expected = publication.summary.bundle
      const target = resolve(output)
      const partial = join(dirname(target), `.${basename(target)}.${randomUUID()}.partial`)
      // The output is checked and its partial file created before the download starts, so an
      // unwritable --output costs no transfer and is reported as the caller's error.
      const file = await openOutput(target, partial)
      let closed = false
      try {
        const download = await context.session.content.download({
          node: publication.node,
          property: AdminContract.properties.publication.bundle,
        })
        const hash = createHash('sha256')
        let size = 0
        const chunks: AsyncIterable<Uint8Array> | readonly Uint8Array[] =
          download.body instanceof Uint8Array ? [download.body] : download.body
        for await (const chunk of chunks) {
          size += chunk.byteLength
          if (size > expected.size) break
          hash.update(chunk)
          await written(target, file.write(chunk))
        }
        await written(target, file.sync())
        closed = true
        await written(target, file.close())
        const served = `sha256:${hash.digest('hex')}`
        if (size !== expected.size || served !== expected.digest) {
          throw new RegistryError(
            'REGISTRY_UNAVAILABLE',
            'The downloaded bundle does not match its Publication; nothing was written.',
            {
              reason: 'bundle-mismatch',
              expected: { digest: expected.digest, size: expected.size },
              ...(size > expected.size
                ? { oversized: true }
                : { served: { digest: served, size } }),
            },
          )
        }
        await written(target, rename(partial, target))
      } catch (error) {
        if (!closed) await file.close().catch(() => undefined)
        await rm(partial, { force: true })
        throw registryFailure(error, 'read')
      }
      return Object.freeze({
        format: 'astrale.registry-bundle',
        version: 1,
        publication: Object.freeze({ origin, version }),
        bundle: expected,
      })
    },

    async publish(request: PublishRequestV1): Promise<PublishResultV1> {
      const { publication } = request
      try {
        const domain = await domainOf(publication.origin)
        const published = publishedFromAdmin(
          await callAdminMethod(
            context.session,
            Path.parse(`@${domain}`),
            MethodKey.of(RegisteredDomain, 'publish'),
            {
              version: publication.version,
              deploymentUrl: publication.url,
              releaseDigest: publication.releaseDigest,
              ...(publication.commit === undefined ? {} : { commit: publication.commit }),
              ...(publication.dirty ? { dirty: true } : {}),
            },
          ),
        )
        const summary = published.publication.summary
        if (
          summary.version !== publication.version ||
          summary.releaseDigest !== publication.releaseDigest
        ) {
          throw responseInvalid('Admin answered a Publication the request does not name.')
        }
        return Object.freeze({
          format: 'astrale.registry-publish-result',
          version: 1,
          status: published.created ? 'created' : 'unchanged',
          publication: summary,
        })
      } catch (error) {
        throw registryFailure(error, 'change')
      }
    },

    async yank(
      origin: string,
      version: string,
      options: { readonly undo?: boolean } = {},
    ): Promise<YankResultV1> {
      const undo = options.undo === true
      try {
        const before = await publicationOf(origin, version)
        const after = publicationFromAdmin(
          await callAdminMethod(
            context.session,
            Path.parse(`@${before.node}`),
            MethodKey.of(Publication, undo ? 'unyank' : 'yank'),
            {},
          ),
        )
        if (
          after.node !== before.node ||
          after.summary.version !== version ||
          after.summary.yanked === undo
        ) {
          throw responseInvalid('Admin answered a Publication state the request does not name.')
        }
        return Object.freeze({
          format: 'astrale.registry-yank-result',
          version: 1,
          status: before.summary.yanked === after.summary.yanked ? 'unchanged' : 'changed',
          publication: after.summary,
        })
      } catch (error) {
        throw registryFailure(error, 'change')
      }
    },
  })
}

function originEquals(origin: string) {
  return Property(AdminContract.properties.registeredDomain.origin).equals(origin)
}

function domainNotFound(origin: string): RegistryError {
  return new RegistryError(
    'REGISTRY_DOMAIN_NOT_FOUND',
    `No Registered Domain ${origin} is readable by this caller: it is absent, or the caller holds neither domain_installer nor domain_admin on it.`,
    { origin },
  )
}

function responseInvalid(message: string): RegistryError {
  return new RegistryError('REGISTRY_UNAVAILABLE', message, { reason: 'response-invalid' })
}

/** Refuse an output that is a directory, then create the partial file next to it. */
async function openOutput(target: string, partial: string): Promise<FileHandle> {
  let existing
  try {
    existing = await stat(target)
  } catch (error) {
    if (fileErrorCode(error) !== 'ENOENT') throw outputFailure(target, error)
  }
  if (existing?.isDirectory() === true) throw outputFailure(target, undefined, 'EISDIR')
  return written(target, open(partial, 'wx', 0o644))
}

/** One local file operation of the download: its failure is the caller's, not Admin's. */
async function written<Value>(target: string, operation: Promise<Value>): Promise<Value> {
  try {
    return await operation
  } catch (error) {
    throw outputFailure(target, error)
  }
}

function outputFailure(target: string, cause: unknown, code = fileErrorCode(cause)): AstraleError {
  return new AstraleError(
    'FILE_WRITE_FAILED',
    `Cannot write --output ${target}${code === undefined ? '' : ` (${code})`}.`,
    'Name a file in an existing, writable directory; nothing took the output name.',
    cause === undefined ? undefined : { cause },
  )
}

function fileErrorCode(error: unknown): string | undefined {
  const code = (error as { readonly code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}
