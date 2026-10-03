import type { ResolvedView as SessionResolvedView } from '@astrale-os/sdk/client/session'
import type { ResolvedView } from '@astrale-os/shell'

import { Path } from '@astrale-os/sdk/graph/path'

import type { ConnectionContext } from '../../connection'

import { AstraleError } from '../../errors'

/**
 * View resolution for `astrale view`.
 *
 * Every View belongs to its Domain: it is opened by its declaration path
 * (`/:<origin>:view.<name>`) or through its Domain (`<origin>` or `/:<origin>`),
 * never for a Class or a node. A View that shows one node selects it through its
 * own internal routing.
 *
 * An explicit ViewPath is selected from the installed Domain bundle without
 * reading the Domain's graph node; installation introspection is already an
 * authenticated, admitted view of the exact active schema and Publication
 * bindings. A Domain is resolved through its per-Domain View catalog.
 */

const VIEW_PATH_RE = /^\/:[^\s/:@]+:view\.[a-z][a-z0-9-]*$/
const DOMAIN_RE = /^(?:\/:)?([a-z0-9][a-z0-9.-]*)$/i

export type ViewSpec = { kind: 'view'; path: string } | { kind: 'domain'; origin: string }

export function parseViewSpec(spec: string): ViewSpec {
  if (VIEW_PATH_RE.test(spec)) return { kind: 'view', path: spec }
  const domain = DOMAIN_RE.exec(spec)
  if (domain) return { kind: 'domain', origin: domain[1]! }
  if (spec.startsWith('/') || spec.startsWith('@')) {
    throw new AstraleError(
      'INVALID_ARGUMENT',
      `"${spec}" is a node path. Views belong to their Domain: pass its origin or a ViewPath (/:origin:view.slug), and let the View route to the node itself.`,
    )
  }
  throw new AstraleError(
    'INVALID_ARGUMENT',
    `"${spec}" is neither a ViewPath (/:origin:view.slug) nor a Domain origin`,
  )
}

/** One exact Shell selection plus stable presentation fields for CLI output. */
export type ViewCandidate = ResolvedView & {
  id: string
  path: string
  url: string
  name?: string
  handshake: 'shell' | 'none'
  issuer: string
  etag: string
  revision: string
}

/** The Views one Domain publishes, all placed on that Domain. */
export interface DomainViews {
  domain: string
  candidates: ViewCandidate[]
  /** The Domain's published entrypoint, when its catalog names one. */
  entrypoint?: ViewCandidate
}

/** Resolve every View of one Domain through its per-Domain catalog. */
export async function resolveDomainViews(
  ctx: ConnectionContext,
  origin: string,
): Promise<DomainViews> {
  const domain = Path.domain(origin).raw
  const catalog = await ctx.session.viewsFor(domain)
  const candidates = catalog.views.map((route) => toCandidate(domain, route))
  const entrypointKey = catalog.entrypoint?.key
  const entrypoint =
    entrypointKey === undefined
      ? undefined
      : candidates.find((candidate) => candidate.route.key === entrypointKey)
  return { domain, candidates, ...(entrypoint === undefined ? {} : { entrypoint }) }
}

/** Resolve one explicitly named Domain view from the exact installed artifact. */
export async function resolveInstalledDomainView(
  ctx: ConnectionContext,
  viewPath: string,
): Promise<ViewCandidate> {
  const path = Path.parse(viewPath)
  const projection = path.ast.steps[0]
  if (
    path.ast.anchor.kind !== 'domain' ||
    path.ast.steps.length !== 1 ||
    projection?.kind !== 'projection' ||
    projection.projection.kind !== 'view'
  ) {
    throw new AstraleError('INVALID_ARGUMENT', `Expected an explicit ViewPath: ${viewPath}`)
  }

  const { origin } = path.ast.anchor
  const { name } = projection.projection
  const installed = await ctx.session.schema.bundle(origin)
  const declaration = installed.bundle.root.views[name]
  if (declaration === undefined) {
    throw new AstraleError('VIEW_NOT_FOUND', `View "${name}" is not installed for ${origin}`)
  }

  const publication = installed.domain.publication
  if (publication === null) {
    throw new AstraleError(
      'VIEW_NOT_PUBLISHED',
      `${viewPath} is installed locally but has no published View binding`,
    )
  }
  const key = `${origin}:view.${name}`
  const binding = installed.domain.bindings.views.find((candidate) => candidate.view === key)
  if (binding === undefined) {
    throw new AstraleError(
      'VIEW_NOT_PUBLISHED',
      `${viewPath} has no active View binding in its installed Publication`,
    )
  }
  assertAllowedInstalledViewEndpoint(ctx, binding.href)

  const { ref: _ref, ...viewDeclaration } = declaration
  const route: SessionResolvedView = Object.freeze({
    key: binding.view,
    declaration: Object.freeze(viewDeclaration),
    href: binding.href,
    handshake: binding.handshake,
    ...(binding.iframe === undefined ? {} : { iframe: binding.iframe }),
    ...(binding.host === undefined ? {} : { host: binding.host }),
    issuer: publication.identity.issuer,
    etag: publication.etag,
    revision: publication.revision,
  })
  return toCandidate(Path.domain(origin).raw, route)
}

/** Mirror the Session policy used by the CLI connection for this admitted binding. */
function assertAllowedInstalledViewEndpoint(ctx: ConnectionContext, href: string): void {
  const protocol = new URL(href).protocol
  if (protocol === 'https:') return
  if (protocol === 'http:' && new URL(ctx.target.url).protocol === 'http:') return
  throw new AstraleError(
    'VIEW_ENDPOINT_DENIED',
    `Installed View endpoint ${href} is not allowed by this secure session`,
  )
}

/** The Domain origin of a View key: `crm.example:view.dashboard` -> `crm.example`. */
export function viewKeyOrigin(key: string): string {
  return key.slice(0, key.lastIndexOf(':view.'))
}

function toCandidate(domain: ResolvedView['target'], route: SessionResolvedView): ViewCandidate {
  const key = String(route.key)
  return Object.freeze({
    target: domain,
    route,
    id: key,
    path: `/:${key}`,
    url: route.href,
    name: key.slice(key.lastIndexOf(':view.') + ':view.'.length),
    handshake: route.handshake,
    issuer: route.issuer,
    etag: route.etag,
    revision: route.revision,
  })
}

/** Strip presentation aliases before crossing the Shell mount boundary. */
export function selectedView(candidate: ViewCandidate): ResolvedView {
  return Object.freeze({ target: candidate.target, route: candidate.route })
}

/** The slug tail of a candidate: `view.dashboard` -> `dashboard`. */
export function candidateSlug(candidate: ViewCandidate): string {
  return candidate.name ?? candidate.id.slice(candidate.id.lastIndexOf(':view.') + ':view.'.length)
}

/**
 * Pick one View of a Domain: the named one, else the Domain's entrypoint, else its only View.
 * Several Views without an entrypoint stay ambiguous for the caller to settle.
 */
export function pickCandidate(views: DomainViews, slug?: string): ViewCandidate | 'ambiguous' {
  const { candidates, domain } = views
  if (slug) {
    const match = candidates.find(
      (candidate) =>
        candidate.id === slug || candidate.path === slug || candidateSlug(candidate) === slug,
    )
    if (!match) {
      throw new AstraleError(
        'VIEW_NOT_FOUND',
        `No view "${slug}" in ${domain} - available: ${candidates.map(candidateSlug).join(', ') || '(none)'}`,
      )
    }
    return match
  }
  if (views.entrypoint) return views.entrypoint
  if (candidates.length === 0) {
    throw new AstraleError('VIEW_NOT_FOUND', `${domain} publishes no views`)
  }
  if (candidates.length === 1) return candidates[0]!
  return 'ambiguous'
}
