import type { KernelCommandOpts } from './types'

/**
 * Bridges `lib/self.ts` to CLI command sites: builds a `SelfResolverContext`
 * from CLI opts (local I/O only — no kernel round-trip), resolves a nodeId via
 * `resolveOrThrow` (throwing `SelfRefusalError` on refusal), and wraps async
 * calls with `withSelfHint` so `NotFoundError`s carry expansion metadata for
 * the stale-registration hint emitted by `formatKernelError`.
 */
import { readConfig } from '../lib/config'
import { getDefault, getIdentity } from '../lib/identity'
import { getActive, resolveInstance } from '../lib/instance'
import { fileExists, keypairPaths } from '../lib/keys'
import { KEYS_DIR } from '../lib/paths'
import {
  containsSelfRef,
  expandSelfReferences,
  resolveSelfNodeId,
  selfRefusalError,
  type SelfResolverContext,
  type SelfResolution,
} from '../lib/self'

/** Metadata attached to errors so the NotFoundError path can hint at stale `@self` expansions. */
export type SelfExpansionMeta = {
  original: string
  expanded: string
  selfId: string
  identity?: string
  slug?: string
}

/**
 * Build a `SelfResolverContext` from CLI opts. Mirrors the slug + signing-mode
 * logic in `withKernelClient` / `resolveCredential` — local I/O only:
 * reads config + identities + checks instance keypair file presence.
 *
 * Cheap enough to call eagerly; commands skip the call entirely when
 * `containsSelfRef` returns false on every input.
 */
export async function buildSelfContext(opts: KernelCommandOpts): Promise<SelfResolverContext> {
  const config = await readConfig()
  // Mirror withKernelClient's slug logic: --url without -i ⇒ no slug.
  let slug: string | undefined
  if (opts.url && !opts.instance) {
    slug = undefined
  } else {
    const identifier = opts.instance ?? (await getActive(config)).name
    // resolveInstance throws if the bookmark doesn't exist; we just need the slug
    // for the registration lookup, so trust the user input on failure.
    try {
      await resolveInstance(identifier, config)
    } catch {
      // Fall through — slug is still `identifier`.
    }
    slug = identifier
  }

  // Mirror resolveCredential's instance-signed branch: when targeting a
  // child for which the CLI generated a dedicated keypair, the call signs
  // as the instance itself, not as a user identity.
  let instanceSigned = false
  if (!opts.creds && !opts.as && slug && slug !== 'manager') {
    const { privatePath } = keypairPaths(slug, KEYS_DIR)
    instanceSigned = await fileExists(privatePath)
  }

  // Identity that will sign (only relevant when not instance-signed and not --creds).
  // Failures here (corrupt identities.json, missing --as identity) are
  // re-thrown rather than swallowed — swallowing produces a useless
  // refusal naming `identityName: '(unknown)'`. The fatal-error UX is
  // honest about the actual problem.
  let identity: SelfResolverContext['identity']
  if (!opts.creds) {
    if (opts.as) {
      const i = await getIdentity(opts.as)
      identity = { ...i, name: opts.as }
    } else {
      identity = await getDefault()
    }
  }

  return { identity, instanceSlug: slug, credsJwt: opts.creds, instanceSigned }
}

/**
 * Run `fn`; if it throws a `NotFoundError`, stamp expansion metadata onto the
 * error so `formatKernelError` can append the stale-registration hint. The
 * error is re-thrown either way.
 */
export async function withSelfHint<T>(
  fn: () => Promise<T>,
  meta: SelfExpansionMeta | undefined,
): Promise<T> {
  if (!meta) return fn()
  try {
    return await fn()
  } catch (err) {
    if (err instanceof Error && err.name === 'NotFoundError') {
      ;(err as Error & { expandedFromSelf?: SelfExpansionMeta }).expandedFromSelf = meta
    }
    throw err
  }
}

/** Convenience: resolve the nodeId once, or throw the typed refusal. */
export function resolveOrThrow(selfCtx: SelfResolverContext): string {
  const r: SelfResolution = resolveSelfNodeId(selfCtx)
  if ('reason' in r) throw selfRefusalError(r)
  return r.id
}

/**
 * Expand `@self` in a single path string for the common command shape
 * (`get`, `ls`, `describe`). Returns the expanded path AND the metadata
 * needed by `withSelfHint` to attach the stale-registration hint to a
 * downstream `NotFoundError`.
 *
 * No-op (returns the input unchanged with `meta: undefined`) when the path
 * contains no `@self` — avoids the I/O of `buildSelfContext`.
 *
 * Throws `SelfRefusalError` when `@self` is present but unresolvable.
 */
export async function expandSelfInPath(
  path: string,
  opts: KernelCommandOpts,
): Promise<{ path: string; meta: SelfExpansionMeta | undefined }> {
  if (!containsSelfRef(path)) return { path, meta: undefined }
  const selfCtx = await buildSelfContext(opts)
  const id = resolveOrThrow(selfCtx)
  const expanded = expandSelfReferences(path, id)
  if (expanded === path) return { path, meta: undefined }
  return {
    path: expanded,
    meta: {
      original: path,
      expanded,
      selfId: id,
      identity: selfCtx.identity?.name,
      slug: selfCtx.instanceSlug,
    },
  }
}
