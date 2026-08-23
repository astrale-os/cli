import { NodeUnavailableError } from '@astrale-os/kernel-client/graph'

import type { ConnectionContext } from './session'

import { AstraleError } from '../errors'
import { containsSelfRef, expandSelfReferences } from '../lib/self'

/** Metadata attached to errors after an authenticated caller-authored @self expansion. */
export interface SelfExpansionMeta {
  readonly original: string
  readonly expanded: string
  readonly selfId: string
  readonly slug?: string
}

/**
 * Run `action`; if it throws NodeUnavailableError, retain the authenticated
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
    if (err instanceof NodeUnavailableError) {
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
  readonly whoami?: (context: ConnectionContext) => Promise<AuthenticatedSelf>
}

/** Resolve @self only from the effective principal authenticated by the selected Kernel. */
export async function resolveSelfIdAuthenticated(
  context: ConnectionContext,
  dependencies: ResolveSelfIdDependencies = {},
): Promise<{ readonly id: string; readonly slug?: string }> {
  const resolved = await (dependencies.whoami ?? whoamiSelfId)(context)
  if (typeof resolved.id !== 'string' || resolved.id.trim().length === 0) {
    throw new AstraleError(
      'SELF_RESOLUTION_FAILED',
      '`@self` could not be resolved: authenticated Identity.whoami returned no NodeId.',
    )
  }
  return resolved.slug === undefined
    ? { id: resolved.id }
    : { id: resolved.id, slug: resolved.slug }
}

async function whoamiSelfId({ auth, target }: ConnectionContext): Promise<AuthenticatedSelf> {
  return {
    ...(await auth.whoami()),
    ...(target.slug === undefined ? {} : { slug: target.slug }),
  }
}

/** Expand @self in path-like commands and return metadata for NotFound diagnostics. */
export async function expandSelfInPath(
  path: string,
  context: ConnectionContext,
): Promise<{ readonly path: string; readonly meta?: SelfExpansionMeta }> {
  const expanded = await expandSelfValues(path, [], context)
  return expanded.meta === undefined
    ? { path: expanded.path }
    : { path: expanded.path, meta: expanded.meta }
}

/** Expand @self once across one Call path and its CLI-authored string parameters. */
export async function expandSelfInCall(
  path: string,
  parameters: Readonly<Record<string, unknown>>,
  context: ConnectionContext,
): Promise<{
  readonly path: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly meta?: SelfExpansionMeta
}> {
  const values = Object.values(parameters).filter(
    (value): value is string => typeof value === 'string',
  )
  const expanded = await expandSelfValues(path, values, context)
  if (expanded.parameters === values) {
    return expanded.meta === undefined
      ? { path: expanded.path, parameters }
      : { path: expanded.path, parameters, meta: expanded.meta }
  }
  let index = 0
  const entries = Object.entries(parameters).map(([key, value]) => [
    key,
    typeof value === 'string' ? expanded.parameters[index++] : value,
  ])
  const resolved = Object.freeze(Object.fromEntries(entries))
  return expanded.meta === undefined
    ? { path: expanded.path, parameters: resolved }
    : { path: expanded.path, parameters: resolved, meta: expanded.meta }
}

async function expandSelfValues(
  path: string,
  parameters: readonly string[],
  context: ConnectionContext,
): Promise<{
  readonly path: string
  readonly parameters: readonly string[]
  readonly meta?: SelfExpansionMeta
}> {
  if (!containsSelfRef(path) && !parameters.some(containsSelfRef)) {
    return { path, parameters }
  }
  const self = await resolveSelfIdAuthenticated(context)
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
