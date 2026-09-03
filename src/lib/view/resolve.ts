import type { ResolvedView as SessionResolvedView } from '@astrale-os/sdk/client/session'
import type { ResolvedView } from '@astrale-os/shell'

import { Path } from '@astrale-os/sdk/graph/path'

import type { ConnectionContext } from '../../connection'

import { AstraleError } from '../../errors'

/**
 * View + target resolution for `astrale view`.
 *
 * A target path is resolved by the Kernel because applicability depends on the
 * target node and the caller's authority. An explicit Domain ViewPath can be
 * selected from the installed Domain bundle without reading the Domain's graph
 * node; installation introspection is already an authenticated, admitted view
 * of the exact active schema and Publication bindings.
 */

const VIEW_PATH_RE = /^\/:[^\s/:@]+:view\.[a-z][a-z0-9-]*$/

export type ViewSpec = { kind: 'view' | 'target'; path: string }

export function parseViewSpec(spec: string): ViewSpec {
  if (VIEW_PATH_RE.test(spec)) return { kind: 'view', path: spec }
  if (spec.startsWith('/') || spec.startsWith('@')) return { kind: 'target', path: spec }
  throw new AstraleError(
    'INVALID_ARGUMENT',
    `"${spec}" is neither a ViewPath (/:origin:view.slug) nor a node path (/… or @id)`,
  )
}

/** One exact Shell selection plus stable presentation fields for CLI output. */
export type ViewCandidate = ResolvedView & {
  id: string
  path: string
  url: string
  name?: string
  handshake: 'shell' | 'none'
  origin: 'self' | 'class'
  issuer: string
  etag: string
  revision: string
}

export async function resolveViewCandidates(
  ctx: ConnectionContext,
  nodePath: string,
): Promise<ViewCandidate[]> {
  const target = Path.parse(nodePath).raw
  const catalog = await ctx.session.viewsFor(target)
  return catalog.views.map((route) => toCandidate(target, route))
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
  if (declaration.target.kind !== 'domain') {
    throw new AstraleError(
      'VIEW_TARGET_REQUIRED',
      `${viewPath} applies to a graph node — pass that node with --target <path>`,
    )
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

function toCandidate(target: ResolvedView['target'], route: SessionResolvedView): ViewCandidate {
  const key = String(route.key)
  return Object.freeze({
    target,
    route,
    id: key,
    path: `/:${key}`,
    url: route.href,
    name: key.slice(key.lastIndexOf(':view.') + ':view.'.length),
    handshake: route.handshake,
    origin: route.declaration.target.kind === 'domain' ? 'self' : 'class',
    issuer: route.issuer,
    etag: route.etag,
    revision: route.revision,
  })
}

/** Strip presentation aliases before crossing the Shell mount boundary. */
export function selectedView(candidate: ViewCandidate): ResolvedView {
  return Object.freeze({ target: candidate.target, route: candidate.route })
}

/** The slug tail of a candidate: `view.dashboard` → `dashboard`. */
export function candidateSlug(candidate: ViewCandidate): string {
  return candidate.name ?? candidate.id.slice(candidate.id.lastIndexOf(':view.') + ':view.'.length)
}

export function pickCandidate(
  candidates: ViewCandidate[],
  nodePath: string,
  slug?: string,
): ViewCandidate | 'ambiguous' {
  if (slug) {
    const match = candidates.find(
      (candidate) =>
        candidate.id === slug || candidate.path === slug || candidateSlug(candidate) === slug,
    )
    if (!match) {
      throw new AstraleError(
        'VIEW_NOT_FOUND',
        `No view "${slug}" on ${nodePath} — available: ${candidates.map(candidateSlug).join(', ') || '(none)'}`,
      )
    }
    return match
  }
  if (candidates.length === 0) {
    throw new AstraleError('VIEW_NOT_FOUND', `No views resolve on ${nodePath}`)
  }
  if (candidates.length === 1) return candidates[0]
  return 'ambiguous'
}
