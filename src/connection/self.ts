import type { KernelCommandOpts } from './command'

import { containsSelfRef, expandSelfReferences } from '../lib/self'
import { withClientSession } from './session'

/** Metadata attached to errors after an authenticated caller-authored @self expansion. */
export interface SelfExpansionMeta {
  readonly original: string
  readonly expanded: string
  readonly selfId: string
  readonly slug?: string
}

/**
 * Run `action`; if it throws a node NotFoundError, retain the authenticated
 * expansion for precise diagnostics. The error is re-thrown either way.
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

type AuthenticatedSelf = {
  readonly id?: unknown
  readonly slug?: string
}

export type ResolveSelfIdDependencies = {
  readonly whoami?: (opts: KernelCommandOpts) => Promise<AuthenticatedSelf>
}

/** Resolve @self only from the effective principal authenticated by the selected Kernel. */
export async function resolveSelfIdAuthenticated(
  opts: KernelCommandOpts,
  dependencies: ResolveSelfIdDependencies = {},
): Promise<{ readonly id: string; readonly slug?: string }> {
  const resolved = await (dependencies.whoami ?? whoamiSelfId)(opts)
  if (typeof resolved.id !== 'string' || resolved.id.trim().length === 0) {
    const error = new Error(
      '`@self` could not be resolved: authenticated Identity.whoami returned no NodeId.',
    )
    error.name = 'SelfResolutionError'
    throw error
  }
  return resolved.slug === undefined
    ? { id: resolved.id }
    : { id: resolved.id, slug: resolved.slug }
}

async function whoamiSelfId(opts: KernelCommandOpts): Promise<AuthenticatedSelf> {
  return withClientSession(opts, async ({ auth, target }) => ({
    ...(await auth.whoami()),
    ...(target.slug === undefined ? {} : { slug: target.slug }),
  }))
}

/** Expand @self in path-like commands and return metadata for NotFound diagnostics. */
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
  const self = await resolveSelfIdAuthenticated(options)
  const expandedPath = expandSelfReferences(path, self.id)
  const expandedParameters = parameters.map((parameter) => expandSelfReferences(parameter, self.id))
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
      selfId: self.id,
      ...(self.slug === undefined ? {} : { slug: self.slug }),
    },
  }
}
