import type { ResolvedView } from '@astrale-os/kernel-client/host'

import { Path } from '@astrale-os/kernel-core/path'

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

/** Wire shape of one `View:resolve` entry. */
export type ViewCandidate = {
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
  const catalog = await ctx.host.viewsFor(Path.parse(nodePath))
  return catalog.views.map(toCandidate)
}

function toCandidate(view: ResolvedView): ViewCandidate {
  const key = String(view.key)
  return Object.freeze({
    id: key,
    path: `/:${key}`,
    url: view.href,
    name: key.slice(key.lastIndexOf(':view.') + ':view.'.length),
    handshake: view.handshake,
    origin: view.declaration.target.kind === 'domain' ? 'self' : 'class',
    issuer: view.issuer,
    etag: view.etag,
    revision: view.revision,
  })
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
    const match = candidates.find((c) => candidateSlug(c) === slug || c.path.endsWith(`/${slug}`))
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

/**
 * Apply a `--view-url` override: an origin-only value swaps the origin and
 * keeps the resolved path, a value with a path replaces the URL wholesale.
 */
export function applyViewUrlOverride(resolvedUrl: string, override: string): string {
  const parsed = parseUrl(override)
  if (parsed.pathname !== '/') return parsed.toString()
  const original = parseUrl(resolvedUrl)
  return new URL(original.pathname + original.search + original.hash, parsed.origin).toString()
}

/**
 * The kernel addresses locally-served workers as `host.docker.internal`
 * (reachable from its container); the host browser reaches the same worker on
 * loopback. Rewrite so the iframe loads without an /etc/hosts entry.
 */
export function rewriteLocalViewUrl(url: string): string {
  const parsed = parseUrl(url)
  if (parsed.hostname !== 'host.docker.internal') return url
  parsed.hostname = '127.0.0.1'
  return parsed.toString()
}

function parseUrl(raw: string): URL {
  try {
    return new URL(raw)
  } catch {
    throw new AstraleError('INVALID_URL', `Not a valid URL: ${raw}`)
  }
}
