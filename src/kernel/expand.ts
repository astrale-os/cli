import type { KernelCommandOpts } from './types'

/** CLI bridge for @self resolution and stale-registration error hints. */
import { readConfig } from '../lib/config'
import { getDefault, getIdentity, setRegistration } from '../lib/identity'
import { decodeTokenClaims, readIdpSession } from '../lib/idp'
import { resolveInstanceTarget } from '../lib/instance-target'
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
import { lookupImplicitOwnedInstance, withKernelClient } from './client'

/** Metadata attached to errors so the NotFoundError path can hint at stale `@self` expansions. */
export type SelfExpansionMeta = {
  original: string
  expanded: string
  selfId: string
  identity?: string
  slug?: string
}

/** Build the same target/signing context `withKernelClient` will use. */
export async function buildSelfContext(opts: KernelCommandOpts): Promise<SelfResolverContext> {
  const config = await readConfig()
  // Mirror withKernelClient's slug logic: --url without -i ⇒ no slug.
  let slug: string | undefined
  let defaultIdentity: string | undefined
  if (opts.url && !opts.instance) {
    slug = undefined
  } else {
    const resolved = await resolveInstanceTarget(
      opts.instance ? { source: 'name', name: opts.instance } : { source: 'active' },
      {
        config,
        admin: {},
        managed: (instanceSlug) => lookupImplicitOwnedInstance(instanceSlug, opts),
      },
    )
    slug = resolved.name
    defaultIdentity = resolved.defaultIdentity
  }

  // Mirror resolveCredential's instance-signed branch: when targeting a
  // child for which the CLI generated a dedicated keypair, the call signs
  // as the instance itself, not as a user identity.
  let instanceSigned = false
  if (!opts.creds && !opts.as && !defaultIdentity && slug && slug !== 'manager') {
    const { privatePath } = keypairPaths(slug, KEYS_DIR)
    instanceSigned = await fileExists(privatePath)
  }

  // Identity lookup failures should surface as real CLI errors, not @self refusals.
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

export type ResolveSelfIdLazyDeps = {
  whoami?: (opts: KernelCommandOpts) => Promise<{ id?: unknown; kernelUrl: string }>
  setRegistration?: typeof setRegistration
  now?: () => Date
}

/**
 * Resolve @self for IdP identities through one whoami refresh, then cache the
 * current node id. Non-IdP refusals stay typed and local.
 */
export async function resolveSelfIdLazy(
  selfCtx: SelfResolverContext,
  opts: KernelCommandOpts,
  deps: ResolveSelfIdLazyDeps = {},
): Promise<string> {
  const r: SelfResolution = resolveSelfNodeId(selfCtx)
  const cachedId = 'reason' in r ? undefined : r.id
  const isIdp = (selfCtx.identity?.source ?? 'key') === 'idp'

  if (isIdp && selfCtx.instanceSlug && selfCtx.identity) {
    let lookup: { id?: unknown; kernelUrl: string }
    try {
      lookup = await (deps.whoami ?? whoamiSelfId)(opts)
    } catch {
      if (cachedId) return cachedId
      if ('reason' in r) throw selfRefusalError(r)
      throw selfRefusalError({ reason: 'idp-no-sub', identityName: selfCtx.identity.name })
    }

    const resolvedId =
      typeof lookup.id === 'string' && lookup.id.trim().length > 0 ? lookup.id : undefined
    if (!resolvedId) {
      if (cachedId) return cachedId
      if ('reason' in r) throw selfRefusalError(r)
      throw selfRefusalError({ reason: 'idp-no-sub', identityName: selfCtx.identity.name })
    }

    const cached = selfCtx.identity.registrations?.[selfCtx.instanceSlug]
    if (cached?.sub !== resolvedId || cached?.iss !== lookup.kernelUrl) {
      await (deps.setRegistration ?? setRegistration)(selfCtx.identity.name, selfCtx.instanceSlug, {
        iss: lookup.kernelUrl,
        sub: resolvedId,
        registeredAt: (deps.now ?? (() => new Date()))().toISOString(),
      })
    }
    return resolvedId
  }

  if (!('reason' in r)) return r.id
  throw selfRefusalError(r)
}

async function whoamiSelfId(opts: KernelCommandOpts): Promise<{ id?: unknown; kernelUrl: string }> {
  let kernelUrl = ''
  const me = await withKernelClient(opts, (ctx) => {
    kernelUrl = ctx.url
    return ctx.client.as(ctx.credential).auth.whoami()
  })
  return { id: me.id, kernelUrl }
}

/** Expand @self in path-like commands and return metadata for NotFound hints. */
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
