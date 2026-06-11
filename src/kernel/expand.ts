import type { KernelCommandOpts } from './types'

/**
 * Bridges `lib/self.ts` to CLI command sites: builds a `SelfResolverContext`
 * from CLI opts (local I/O only — no kernel round-trip), resolves a nodeId via
 * `resolveOrThrow` (throwing `SelfRefusalError` on refusal), and wraps async
 * calls with `withSelfHint` so `NotFoundError`s carry expansion metadata for
 * the stale-registration hint emitted by `formatKernelError`.
 */
import { readConfig } from '../lib/config'
import { getDefault, getIdentity, setRegistration } from '../lib/identity'
import { decodeTokenClaims, readIdpSession } from '../lib/idp'
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
import { withKernelClient } from './client'

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
  let defaultIdentity: string | undefined
  if (opts.url && !opts.instance) {
    slug = undefined
  } else {
    const identifier = opts.instance ?? (await getActive(config)).name
    // resolveInstance throws if the bookmark doesn't exist; we just need the slug
    // for the registration lookup, so trust the user input on failure.
    try {
      const resolved = await resolveInstance(identifier, config)
      defaultIdentity = resolved.defaultIdentity
    } catch {
      // Fall through — slug is still `identifier`.
    }
    slug = identifier
  }

  // Mirror resolveCredential's instance-signed branch: when targeting a
  // child for which the CLI generated a dedicated keypair, the call signs
  // as the instance itself, not as a user identity.
  let instanceSigned = false
  if (!opts.creds && !opts.as && !defaultIdentity && slug && slug !== 'manager') {
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
    const identityName = opts.as ?? defaultIdentity
    if (identityName) {
      const i = await getIdentity(identityName)
      identity = { ...i, name: identityName }
    } else {
      identity = await getDefault()
    }
  }

  let idpSubject: string | undefined
  if (identity && (identity.source ?? 'key') === 'idp') {
    instanceSigned = false
    const session = await readIdpSession(identity.name)
    const claims = decodeTokenClaims(session?.id_token ?? session?.access_token)
    if (typeof claims?.sub === 'string' && claims.sub.trim().length > 0) {
      idpSubject = claims.sub
    }
  }

  return { identity, instanceSlug: slug, credsJwt: opts.creds, instanceSigned, idpSubject }
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

// The kernel's whoami — returns the AUTHENTICATED principal's graph node.
// Static interface method, so the colon form (slash form is rejected).
const WHOAMI_PATH = '/:kernel.astrale.ai:interface.Identity:whoami'

/**
 * Resolve `@self`, falling back to ONE kernel `whoami` round-trip when an
 * IdP identity merely lacks a cached registration on this instance (the
 * normal `astrale auth login` flow — the IdP subject is never a node id).
 * The resolved id is persisted as a registration so subsequent expansions
 * are local again. Every other refusal (manager, instance-signed, …) and a
 * failed whoami throw the typed refusal unchanged.
 */
export async function resolveSelfIdLazy(
  selfCtx: SelfResolverContext,
  opts: KernelCommandOpts,
): Promise<string> {
  const r: SelfResolution = resolveSelfNodeId(selfCtx)
  if (!('reason' in r)) return r.id
  if (r.reason !== 'idp-no-sub' || !selfCtx.instanceSlug || !selfCtx.identity) {
    throw selfRefusalError(r)
  }
  let me: { id?: unknown } | null
  let kernelUrl = ''
  try {
    me = (await withKernelClient(opts, (ctx) => {
      kernelUrl = ctx.url
      return ctx.client.call(WHOAMI_PATH as never, {} as never)
    })) as { id?: unknown } | null
  } catch {
    // Network/auth failure — surface the original recipe, not a stack.
    throw selfRefusalError(r)
  }
  const id = typeof me?.id === 'string' && me.id.trim().length > 0 ? me.id : undefined
  if (!id) throw selfRefusalError(r)
  await setRegistration(selfCtx.identity.name, selfCtx.instanceSlug, {
    iss: kernelUrl,
    sub: id,
    registeredAt: new Date().toISOString(),
  })
  return id
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
  const id = await resolveSelfIdLazy(selfCtx, opts)
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
