import type { KernelCommandOpts } from './command'

import { getDefault, getIdentity, setRegistration } from '../identity/index'
import { fileExists, keypairPaths } from '../keys/index'
/** CLI bridge for @self resolution and stale-registration error hints. */
import { decodeTokenClaims, readIdpSession } from '../lib/idp'
import {
  containsSelfRef,
  expandSelfReferences,
  resolveSelfNodeId,
  selfRefusalError,
  type SelfResolverContext,
  type SelfResolution,
} from '../lib/self'
import { KEYS_DIR } from '../state/index'
import { withHostSession } from './session'

/** Metadata attached to errors so the NotFoundError path can hint at stale `@self` expansions. */
export interface SelfExpansionMeta {
  readonly original: string
  readonly expanded: string
  readonly selfId: string
  readonly identity?: string
  readonly slug?: string
}

/** Build the same target/signing context the command-scoped HostSession will use. */
export async function buildSelfContext(opts: KernelCommandOpts): Promise<SelfResolverContext> {
  const target = await withHostSession(opts, async ({ target }) => target)
  const slug = target.slug
  const defaultIdentity = target.defaultIdentity

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
  action: () => Promise<T>,
  meta: SelfExpansionMeta | undefined,
): Promise<T> {
  if (!meta) return action()
  try {
    return await action()
  } catch (err) {
    if (err instanceof Error && err.name === 'NotFoundError') {
      ;(err as Error & { expandedFromSelf?: SelfExpansionMeta }).expandedFromSelf = meta
    }
    throw err
  }
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
  return withHostSession(opts, async ({ auth, target }) => ({
    ...(await auth.whoami()),
    kernelUrl: target.url,
  }))
}

/** Expand @self in path-like commands and return metadata for NotFound hints. */
export async function expandSelfInPath(
  path: string,
  options: KernelCommandOpts,
): Promise<{ readonly path: string; readonly meta?: SelfExpansionMeta }> {
  const expanded = await expandSelfValues(path, [], options)
  return expanded.meta === undefined
    ? { path: expanded.path }
    : { path: expanded.path, meta: expanded.meta }
}

/** Expand @self once across one Call path and its CLI-authored string parameters. */
export async function expandSelfInCall(
  path: string,
  parameters: readonly string[],
  options: KernelCommandOpts,
): Promise<{
  readonly path: string
  readonly parameters: readonly string[]
  readonly meta?: SelfExpansionMeta
}> {
  return expandSelfValues(path, parameters, options)
}

async function expandSelfValues(
  path: string,
  parameters: readonly string[],
  options: KernelCommandOpts,
): Promise<{
  readonly path: string
  readonly parameters: readonly string[]
  readonly meta?: SelfExpansionMeta
}> {
  if (!containsSelfRef(path) && !parameters.some(containsSelfRef)) {
    return { path, parameters }
  }
  const selfCtx = await buildSelfContext(options)
  const id = await resolveSelfIdLazy(selfCtx, options)
  const expandedPath = expandSelfReferences(path, id)
  const expandedParameters = parameters.map((parameter) => expandSelfReferences(parameter, id))
  const changed =
    expandedPath !== path ||
    expandedParameters.some((parameter, index) => parameter !== parameters[index])
  if (!changed) return { path, parameters }
  return {
    path: expandedPath,
    parameters: expandedParameters,
    meta: {
      original: path,
      expanded: expandedPath,
      selfId: id,
      identity: selfCtx.identity?.name,
      slug: selfCtx.instanceSlug,
    },
  }
}
