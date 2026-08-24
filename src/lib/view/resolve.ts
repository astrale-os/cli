import type { ResolvedView as SessionResolvedView } from '@astrale-os/sdk/client/session'
import type { ResolvedView } from '@astrale-os/shell'

import { Path } from '@astrale-os/sdk/graph/path'

import type { ConnectionContext } from '../../connection'

import { AstraleError } from '../../errors'

/**
 * View + target resolution for `astrale view`. Both spec shapes funnel through
 * the kernel's `View:resolve` syscall: a ViewPath resolves to the view node
 * itself (its class implements UI), a target path lists the views attached to
 * it via `view_for`.
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

/** The owning Domain principal used when an explicit ViewPath has no target override. */
export function viewOwnerTarget(viewPath: string): string {
  const parsed = Path.parse(viewPath)
  if (parsed.ast.anchor.kind !== 'domain') {
    throw new AstraleError('INVALID_ARGUMENT', `ViewPath has no Domain owner: ${viewPath}`)
  }
  return `/:${parsed.ast.anchor.origin}`
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
