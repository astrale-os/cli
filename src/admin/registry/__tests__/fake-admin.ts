import type { Call } from '@astrale-os/sdk/client'
import type { Node } from '@astrale-os/sdk/graph/node'
import type { QueryAST } from '@astrale-os/sdk/query'

import { ResponseError } from '@astrale-os/sdk/client'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { normalizeProperties } from '@astrale-os/sdk/graph/properties'
import { createHash } from 'node:crypto'

import type { AdminRegistryContext } from '../client'

import { AdminContract } from '../../contract'

/**
 * A fake Admin registry with the read and change rules A2-A5 ship (CT26/CT27): a Registered
 * Domain is read by its admins and installers (ObserveRegisteredDomain), a Publication by the
 * readers of its Domain (ReadPublication), `publish` and `yank`/`unyank` are domain_admin only,
 * a version is written once (same digest: created false; another digest: conflict).
 */
export interface FakePublication {
  readonly id: string
  readonly version: string
  readonly deploymentUrl: string
  readonly releaseDigest: string
  readonly buildDigest: string
  readonly schemaRevision: string
  readonly dependencies: readonly { readonly origin: string; readonly revision: string }[]
  readonly commit?: string
  readonly dirty?: true
  readonly bytes: Uint8Array
  readonly createdAt: string
  yankedAt?: string
  /** A field a later Admin release adds; the CLI must ignore it. */
  readonly verifiedAt?: string
}

export interface FakeDomain {
  readonly id: string
  readonly origin: string
  readonly admins: ReadonlySet<string>
  readonly installers: ReadonlySet<string>
  readonly publications: FakePublication[]
}

export interface FakeRelease {
  readonly url: string
  readonly releaseDigest: `sha256:${string}`
  readonly buildDigest: `sha256:${string}`
  readonly bytes: Uint8Array
}

export const BUNDLE_MEDIA_TYPE = 'application/vnd.astrale.domain-bundle+json;v=1'
export const REVISION = `sha256:${'5'.repeat(64)}`

export function digestOf(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

export function release(name: string): FakeRelease {
  const bytes = new TextEncoder().encode(JSON.stringify({ bundle: name }))
  return {
    url: `https://${name}.svc.registry-proof.test`,
    releaseDigest: digestOf(new TextEncoder().encode(`release:${name}`)),
    buildDigest: digestOf(new TextEncoder().encode(`build:${name}`)),
    bytes,
  }
}

export function publication(
  id: string,
  version: string,
  source: FakeRelease,
  extra: Partial<FakePublication> = {},
): FakePublication {
  return {
    id,
    version,
    deploymentUrl: source.url,
    releaseDigest: source.releaseDigest,
    buildDigest: source.buildDigest,
    schemaRevision: REVISION,
    dependencies: [{ origin: 'shell.astrale.ai', revision: REVISION }],
    bytes: source.bytes,
    createdAt: '2026-10-04T10:00:00.000Z',
    ...extra,
  }
}

export interface FakeAdminOptions {
  readonly caller: string
  readonly domains: FakeDomain[]
  /** Releases Admin finds at their deployment URLs when it publishes. */
  readonly releases?: readonly FakeRelease[]
  /** Whether the caller holds the Kernel `download` grant (Shell Members do not today). */
  readonly download?: boolean
  /** A refusal `publish` answers instead of reading the deployment. */
  readonly publishRefusal?: () => unknown
  /** Bytes the download serves instead of the stored ones. */
  readonly servedBytes?: Uint8Array
}

export function fakeAdmin(options: FakeAdminOptions) {
  const queries: QueryAST[] = []
  const calls: Array<{ readonly target: string; readonly input: unknown }> = []
  const downloads: Array<{ readonly node: string; readonly property: string }> = []
  let caller = options.caller
  let nextPublication = 1_000

  const readable = (domain: FakeDomain) =>
    domain.admins.has(caller) || domain.installers.has(caller)

  const query = async (ast: QueryAST) => {
    queries.push(ast)
    const origin = propertyEqual(ast, AdminContract.properties.registeredDomain.origin)
    const domains = options.domains.filter((domain) => domain.origin === origin && readable(domain))
    const expands = ast.steps.some((step) => step.op === 'expand')
    const version = propertyEqual(ast, AdminContract.properties.publication.version)
    const nodes: Node[] = expands
      ? domains.flatMap((domain) =>
          domain.publications
            .filter((entry) => version === undefined || entry.version === version)
            .map(publicationNode),
        )
      : domains.map(domainNode)
    return {
      result: {
        kind: 'nodes' as const,
        nodes: nodes.map((value) => ({ kind: 'value' as const, value })),
      },
      page: {},
    }
  }

  const call = async (request: Call) => {
    const target = String(request.target)
    calls.push({ target, input: request.input })
    const [receiver, method] = target.split('::')
    const id = receiver!.slice(1)
    if (method === String(methodKey('RegisteredDomain', 'publish'))) {
      const domain = options.domains.find((entry) => entry.id === id)
      if (domain === undefined || !readable(domain)) throw refusal(3002, 'NOT_FOUND')
      if (!domain.admins.has(caller)) throw refusal(2004, 'ACCESS_DENIED')
      const input = request.input as {
        version: string
        deploymentUrl: string
        releaseDigest: string
        commit?: string
        dirty?: boolean
      }
      const existing = domain.publications.find((entry) => entry.version === input.version)
      if (existing !== undefined) {
        if (existing.releaseDigest === input.releaseDigest)
          return { publication: summaryOf(existing), created: false }
        throw declared(4001, 'PUBLICATION_VERSION_CONFLICT', { existing: summaryOf(existing) })
      }
      if (options.publishRefusal !== undefined) throw options.publishRefusal()
      const served = options.releases?.find((entry) => entry.url === input.deploymentUrl)
      if (served === undefined)
        throw declared(1003, 'RELEASE_INVALID', { reason: 'release-absent' })
      if (served.releaseDigest !== input.releaseDigest)
        throw declared(4001, 'RELEASE_DIGEST_MISMATCH', {
          expected: input.releaseDigest,
          served: served.releaseDigest,
        })
      const created = publication(String((nextPublication += 1)), input.version, served, {
        ...(input.commit === undefined ? {} : { commit: input.commit.toLowerCase() }),
        ...(input.dirty === true ? { dirty: true as const } : {}),
      })
      domain.publications.push(created)
      return { publication: summaryOf(created), created: true }
    }
    for (const name of ['yank', 'unyank'] as const) {
      if (method !== String(methodKey('Publication', name))) continue
      const domain = options.domains.find((entry) =>
        entry.publications.some((candidate) => candidate.id === id),
      )
      const entry = domain?.publications.find((candidate) => candidate.id === id)
      if (domain === undefined || entry === undefined || !readable(domain))
        throw refusal(3002, 'NOT_FOUND')
      if (!domain.admins.has(caller)) throw refusal(2004, 'ACCESS_DENIED')
      if (name === 'yank') entry.yankedAt ??= '2026-10-04T12:00:00.000Z'
      else delete entry.yankedAt
      return summaryOf(entry)
    }
    throw refusal(3001, 'METHOD_NOT_FOUND')
  }

  const download = async (location: { readonly node: string; readonly property: string }) => {
    downloads.push(location)
    if (options.download !== true) throw refusal(2004, 'ACCESS_DENIED')
    const entry = options.domains
      .filter(readable)
      .flatMap((domain) => domain.publications)
      .find((candidate) => candidate.id === location.node)
    if (entry === undefined || location.property !== AdminContract.properties.publication.bundle)
      throw refusal(3002, 'NOT_FOUND')
    const bytes = options.servedBytes ?? entry.bytes
    return {
      body: (async function* () {
        yield bytes.subarray(0, Math.floor(bytes.length / 2))
        yield bytes.subarray(Math.floor(bytes.length / 2))
      })(),
      length: bytes.length,
      mediaType: BUNDLE_MEDIA_TYPE,
    }
  }

  const context = {
    session: { call, content: { download } },
    graph: { query },
  } as unknown as AdminRegistryContext

  return {
    context,
    queries,
    calls,
    downloads,
    as(principal: string) {
      caller = principal
    },
  }
}

function methodKey(className: 'RegisteredDomain' | 'Publication', name: string): string {
  return `admin.astrale.ai:class.${className}.method.${name}`
}

function domainNode(domain: FakeDomain): Node {
  return {
    id: NodeId(domain.id),
    class: 'admin.astrale.ai:RegisteredDomain' as Node['class'],
    props: normalizeProperties({
      [AdminContract.properties.registeredDomain.origin]: domain.origin,
    }),
  }
}

function publicationNode(entry: FakePublication): Node {
  const keys = AdminContract.properties.publication
  return {
    id: NodeId(entry.id),
    class: 'admin.astrale.ai:Publication' as Node['class'],
    props: normalizeProperties({
      [keys.version]: entry.version,
      [keys.deploymentUrl]: entry.deploymentUrl,
      [keys.releaseDigest]: entry.releaseDigest,
      [keys.buildDigest]: entry.buildDigest,
      [keys.schemaRevision]: entry.schemaRevision,
      [keys.dependencies]: entry.dependencies.map((dependency) => ({ ...dependency })),
      ...(entry.commit === undefined ? {} : { [keys.commit]: entry.commit }),
      ...(entry.dirty === undefined ? {} : { [keys.dirty]: entry.dirty }),
      [keys.bundle]: {
        digest: digestOf(entry.bytes),
        mediaType: BUNDLE_MEDIA_TYPE,
        size: entry.bytes.length,
      },
      ...(entry.yankedAt === undefined ? {} : { [keys.yankedAt]: entry.yankedAt }),
      [keys.createdAt]: entry.createdAt,
      'kernel.astrale.ai:class.Timestamped.property.updatedAt': entry.createdAt,
    }),
  }
}

/** The `PublicationSummary` Admin's Methods answer (CT27 as A4/A5 ship it). */
export function summaryOf(entry: FakePublication): Record<string, unknown> {
  return {
    id: `@${entry.id}`,
    version: entry.version,
    deploymentUrl: entry.deploymentUrl,
    releaseDigest: entry.releaseDigest,
    buildDigest: entry.buildDigest,
    schemaRevision: entry.schemaRevision,
    dependencies: entry.dependencies.map((dependency) => ({ ...dependency })),
    ...(entry.commit === undefined ? {} : { commit: entry.commit }),
    ...(entry.dirty === undefined ? {} : { dirty: entry.dirty }),
    bundle: {
      digest: digestOf(entry.bytes),
      mediaType: BUNDLE_MEDIA_TYPE,
      size: entry.bytes.length,
    },
    createdAt: entry.createdAt,
    ...(entry.yankedAt === undefined ? {} : { yankedAt: entry.yankedAt }),
    ...(entry.verifiedAt === undefined ? {} : { verifiedAt: entry.verifiedAt }),
  }
}

export function refusal(code: number, name: string): ResponseError {
  return new ResponseError(code as never, name, 'inv-test' as never)
}

export function declared(
  code: number,
  name: string,
  details: Record<string, unknown>,
): ResponseError {
  return new ResponseError(
    code as never,
    name,
    'inv-test' as never,
    { code: name, details } as never,
  )
}

function propertyEqual(ast: QueryAST, property: string): string | undefined {
  for (const step of ast.steps) {
    if (step.op !== 'filter') continue
    const predicate = (
      step as { readonly predicate?: { kind?: string; property?: string; value?: unknown } }
    ).predicate
    if (predicate?.kind === 'property.equal' && predicate.property === property)
      return String(predicate.value)
  }
  return undefined
}
