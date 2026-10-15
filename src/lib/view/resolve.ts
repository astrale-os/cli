import type { ResolvedView as SessionResolvedView } from '@astrale-os/sdk/client/session'
import type { ResolvedView } from '@astrale-os/shell'

import { Path, PathError } from '@astrale-os/sdk/graph/path'

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
 * authenticated, admitted view of the exact active schema and release
 * bindings. A Domain is resolved through its per-Domain View catalog.
 */

type ViewSpec = { kind: 'view'; path: string } | { kind: 'domain'; origin: string }

/**
 * Read a ViewPath, a Domain Path or a bare Domain origin with the Kernel's own Path
 * parser, so a View name is admitted exactly when the Kernel admits it.
 */
export function parseViewSpec(spec: string): ViewSpec {
  const bare = !spec.startsWith('/') && !spec.startsWith('@')
  let path: Path
  try {
    path = Path.parse(bare ? `/:${spec}` : spec)
  } catch (error) {
    if (!(error instanceof PathError)) throw error
    throw new AstraleError(
      'INVALID_ARGUMENT',
      `"${spec}" is neither a ViewPath (/:<origin>:view.<name>) nor a Domain origin: ${error.message}`,
    )
  }
  const { anchor, steps } = path.ast
  if (anchor.kind === 'domain' && steps.length === 0) {
    return { kind: 'domain', origin: anchor.origin }
  }
  const [step] = steps
  if (
    !bare &&
    anchor.kind === 'domain' &&
    steps.length === 1 &&
    step?.kind === 'projection' &&
    step.projection.kind === 'view'
  ) {
    return { kind: 'view', path: path.raw }
  }
  if (bare) {
    throw new AstraleError(
      'INVALID_ARGUMENT',
      `"${spec}" is neither a ViewPath (/:<origin>:view.<name>) nor a Domain origin`,
    )
  }
  throw new AstraleError(
    'INVALID_ARGUMENT',
    `"${spec}" is a node path. Views belong to their Domain: pass its origin or a ViewPath (/:<origin>:view.<name>), and let the View route to the node itself.`,
  )
}

/**
 * The ViewPath `/:<origin>:view.<name>` of one View, built with the Kernel's Path grammar:
 * an origin or View name the Kernel refuses never becomes a path.
 */
export function viewPathOf(origin: string, name: string): string {
  try {
    return Path.project({ origin, kind: 'view', name }).raw
  } catch (error) {
    if (!(error instanceof PathError)) throw error
    throw new AstraleError(
      'INVALID_ARGUMENT',
      `/:${origin}:view.${name} is not a valid ViewPath: ${error.message}`,
    )
  }
}

/** What resolving a View needs of a connection: its Session and the Kernel it reaches. */
export type ViewResolutionContext = Pick<ConnectionContext, 'session'> & {
  readonly target: Pick<ConnectionContext['target'], 'url'>
}

/** One exact Shell selection plus stable presentation fields for CLI output. */
export type ViewCandidate = ResolvedView & {
  id: string
  path: string
  url: string
  name?: string
  handshake: 'shell' | 'none'
  issuer: string
  release: string
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
  ctx: Pick<ConnectionContext, 'session'>,
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
  ctx: ViewResolutionContext,
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

  const release = installed.domain.release
  if (release === null) {
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
      `${viewPath} has no active View binding in its installed release`,
    )
  }
  assertAllowedInstalledViewEndpoint(ctx, binding.href)

  const { ref: _ref, ...viewDeclaration } = declaration
  const route: SessionResolvedView = Object.freeze({
    key: binding.view,
    declaration: Object.freeze(viewDeclaration),
    href: binding.href,
    handshake: binding.handshake,
    ...(binding.host === undefined ? {} : { host: binding.host }),
    issuer: release.identity.issuer,
    release: release.digest,
    revision: release.revision,
  })
  return toCandidate(Path.domain(origin).raw, route)
}

/** Mirror the Session policy used by the CLI connection for this admitted binding. */
function assertAllowedInstalledViewEndpoint(ctx: ViewResolutionContext, href: string): void {
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
    release: route.release,
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
