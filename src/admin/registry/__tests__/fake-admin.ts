import type { Call } from '@astrale-os/sdk/client'
import type { Node } from '@astrale-os/sdk/graph/node'
import type { QueryAST } from '@astrale-os/sdk/query'

import { ResponseError } from '@astrale-os/sdk/client'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { normalizeProperties } from '@astrale-os/sdk/graph/properties'
import {
  BUNDLE_MEDIA_TYPE,
  seal,
  url as releaseUrl,
  type DomainRelease,
} from '@astrale-os/sdk/release'
import { createHash } from 'node:crypto'

import type { AdminRegistryContext } from '../client'

import { AdminContract } from '../../contract'

/**
 * A fake Admin registry with the read and change rules of Admin's one `Domain` registry
 * (CT26/CT27): a Domain is read by its admins and installers and by the members of a Fleet whose
 * catalog lists it (ObserveDomain), a Publication by the Domain's admins and installers only
 * (ReadPublication), `publish` and `yank`/`unyank` are domain_admin only, a version is written
 * once (same digest: created false; another digest: conflict). Admin keeps no bundle: the fake
 * deployments serve each release and its bundle, as a published deployment does.
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
  /** Members of a Fleet whose catalog lists the Domain: they read it, not its Publications. */
  readonly catalogReaders?: ReadonlySet<string>
  readonly publications: FakePublication[]
}

/** One immutable deployment: the `DomainRelease` v4 it serves and its Schema Bundle. */
export interface FakeRelease {
  readonly url: string
  readonly releaseDigest: `sha256:${string}`
  readonly buildDigest: `sha256:${string}`
  readonly document: DomainRelease
  readonly bytes: Uint8Array
}

export { BUNDLE_MEDIA_TYPE }
export const REVISION = `sha256:${'5'.repeat(64)}`

export function digestOf(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

export function release(name: string): FakeRelease {
  const origin = 'issues.astrale.ai'
  const bytes = new TextEncoder().encode(JSON.stringify({ bundle: name }))
  const url = `https://${name}.svc.registry-proof.test`
  const buildDigest = digestOf(new TextEncoder().encode(`build:${name}`))
  const bundle = digestOf(bytes)
  const document = seal({
    format: 'astrale.domain.release',
    version: 4,
    origin,
    identity: { issuer: url, subject: origin },
    build: { digest: buildDigest },
    schema: {
      revision: REVISION,
      bundle: {
        href: `${url}/.well-known/astrale/bundle/${bundle.slice('sha256:'.length)}.json`,
        ref: { digest: bundle, mediaType: BUNDLE_MEDIA_TYPE, size: bytes.length },
      },
    },
    requirements: { capabilities: {} },
    bindings: { callables: [], views: [] },
    routes: [],
  } as never)
  return { url, releaseDigest: document.digest, buildDigest, document, bytes }
}

export function publication(
  id: string,
  version: string,
  source: Pick<FakeRelease, 'url' | 'releaseDigest' | 'buildDigest'>,
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
    createdAt: '2026-10-04T10:00:00.000Z',
    ...extra,
  }
}

export interface FakeAdminOptions {
  readonly caller: string
  readonly domains: FakeDomain[]
  /** Deployments: what Admin finds when it publishes, and what `bundle` reads. */
  readonly releases?: readonly FakeRelease[]
  /** A refusal `publish` answers instead of reading the deployment. */
  readonly publishRefusal?: () => unknown
  /** What Admin's Services answered the retention mark of a publish. */
  readonly retention?: 'marked' | 'failed' | 'not-applicable'
  /** Bundle bytes the deployments serve instead of the ones their release describes. */
  readonly servedBytes?: Uint8Array
  /** A release document the deployments serve instead of their own. */
  readonly servedRelease?: unknown
  /** An HTTP status every deployment GET answers instead of its document. */
  readonly deploymentStatus?: number
}

export function fakeAdmin(options: FakeAdminOptions) {
  const queries: QueryAST[] = []
  const calls: Array<{ readonly target: string; readonly input: unknown }> = []
  const fetches: Array<{ readonly url: string; readonly redirect?: RequestRedirect }> = []
  /** The `accept` header of each deployment GET, in order. */
  const accepts: Array<string | null> = []
  let caller = options.caller
  let nextPublication = 1_000

  const versionsReadable = (domain: FakeDomain) =>
    domain.admins.has(caller) || domain.installers.has(caller)
  const readable = (domain: FakeDomain) =>
    versionsReadable(domain) || domain.catalogReaders?.has(caller) === true

  const query = async (ast: QueryAST) => {
    queries.push(ast)
    const origin = propertyEqual(ast, AdminContract.properties.domain.origin)
    const domains = options.domains.filter((domain) => domain.origin === origin && readable(domain))
    const expands = ast.steps.some((step) => step.op === 'expand')
    const version = propertyEqual(ast, AdminContract.properties.publication.version)
    const nodes: Node[] = expands
      ? domains
          .filter(versionsReadable)
          .flatMap((domain) =>
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
    if (method === String(methodKey('Domain', 'publish'))) {
      const domain = options.domains.find((entry) => entry.id === id)
      if (domain === undefined) throw refusal(3002, 'NOT_FOUND')
      // A caller who cannot read the receiver is refused 2004, as the Kernel answers (#446).
      if (!readable(domain) || !domain.admins.has(caller)) throw refusal(2004, 'ACCESS_DENIED')
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
          return { publication: summaryOf(existing), created: false, retention }
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
      return { publication: summaryOf(created), created: true, retention }
    }
    for (const name of ['yank', 'unyank'] as const) {
      if (method !== String(methodKey('Publication', name))) continue
      const domain = options.domains.find((entry) =>
        entry.publications.some((candidate) => candidate.id === id),
      )
      const entry = domain?.publications.find((candidate) => candidate.id === id)
      if (domain === undefined || entry === undefined) throw refusal(3002, 'NOT_FOUND')
      // A caller who cannot read the receiver is refused 2004, as the Kernel answers (#446).
      if (!versionsReadable(domain) || !domain.admins.has(caller))
        throw refusal(2004, 'ACCESS_DENIED')
      if (name === 'yank') entry.yankedAt ??= '2026-10-04T12:00:00.000Z'
      else delete entry.yankedAt
      return summaryOf(entry)
    }
    throw refusal(3001, 'METHOD_NOT_FOUND')
  }

  const retention = options.retention ?? 'marked'

  /** The deployments, as a published one serves them: anyone may read them, in place. */
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    fetches.push({ url, ...(init.redirect === undefined ? {} : { redirect: init.redirect }) })
    accepts.push(new Headers(init.headers).get('accept'))
    if (options.deploymentStatus !== undefined)
      return new Response('unavailable', { status: options.deploymentStatus })
    for (const served of options.releases ?? []) {
      if (url === releaseUrl(served.url))
        return Response.json(options.servedRelease ?? served.document)
      if (url === served.document.schema.bundle.href) {
        const bytes = options.servedBytes ?? served.bytes
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes.subarray(0, Math.floor(bytes.length / 2)))
              controller.enqueue(bytes.subarray(Math.floor(bytes.length / 2)))
              controller.close()
            },
          }),
          { headers: { 'content-type': BUNDLE_MEDIA_TYPE } },
        )
      }
    }
    return new Response('not found', { status: 404 })
  }

  const context = {
    session: { call },
    graph: { query },
    deployment: { fetch, timeoutMs: 5_000 },
  } as unknown as AdminRegistryContext

  return {
    context,
    queries,
    calls,
    fetches,
    accepts,
    as(principal: string) {
      caller = principal
    },
  }
}

function methodKey(className: 'Domain' | 'Publication', name: string): string {
  return `admin.astrale.ai:class.${className}.method.${name}`
}

function domainNode(domain: FakeDomain): Node {
  return {
    id: NodeId(domain.id),
    class: 'admin.astrale.ai:Domain' as Node['class'],
    props: normalizeProperties({
      [AdminContract.properties.domain.origin]: domain.origin,
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
      ...(entry.yankedAt === undefined ? {} : { [keys.yankedAt]: entry.yankedAt }),
      [keys.createdAt]: entry.createdAt,
      'kernel.astrale.ai:class.Timestamped.property.updatedAt': entry.createdAt,
    }),
  }
}

/** The `PublicationSummary` Admin's Methods answer (CT27). */
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
