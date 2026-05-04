import type { FnMap } from '@astrale-os/kernel-client'
import type { ClientSession } from '@astrale-os/kernel-client/session'

import { ClassPath, InstanceMethodPath } from '@astrale-os/kernel-core/domain'

/**
 * Client-side routing of remote-bound kernel calls.
 *
 * A kernel Syscall whose Function carries `binding.remoteUrl` lives on an
 * external worker; the kernel dispatch path never invokes it. Before calling,
 * the CLI must:
 *
 *   1. Find the Syscall node for the target method (via `::get`).
 *   2. Read `binding.remoteUrl` off its Function props.
 *   3. Derive the audience — the domain slug (first segment of the tree path).
 *   4. Mint a delegation credential scoped to that audience.
 *
 * For an instance-method form (`<node>::<method>`), the Syscall doesn't sit
 * at `<node>::<method>` in the graph — it lives at `<domain>/class.<Class>/<method>`.
 * The CLI resolves the source's class and rewrites the path; callers then
 * POST to the worker with `_self = <source>` injected into params.
 */

type SyscallNode = {
  __labels?: string[]
  props?: Record<string, unknown>
}

type NodeHead = {
  class?: string
}

const BINDING_KEY = 'kernel.astrale.ai:interface.Function.property.binding'

export type RemoteBinding = {
  /** Worker URL where the envelope should be POSTed. */
  remoteUrl: string
  /** Audience the worker expects on inbound credentials (= domain slug). */
  audience: string
  /** The path to send to the worker — may differ from the input when rewriting `::method`. */
  path: string
  /** Params to merge into the user's params (currently `_self` for instance-method dispatch). */
  paramsInjection?: Record<string, unknown>
}

/**
 * Discover the remote binding for a kernel method path, if any.
 *
 * Returns `null` when the target isn't a Syscall, has no binding, or the
 * lookup fails for any reason — callers fall through to the normal envelope
 * path against the kernel.
 */
export async function lookupRemoteBinding(
  client: ClientSession<FnMap>,
  path: string,
  _credential: string,
): Promise<RemoteBinding | null> {
  const resolved = await resolveSyscallPath(client, path)
  if (!resolved) return null

  const audience = extractDomainSlug(resolved.syscallPath)
  if (!audience) return null

  let node: SyscallNode | null = null
  try {
    node = (await client.call(`${resolved.syscallPath}::get`, {})) as SyscallNode | null
  } catch {
    return null
  }

  const binding = parseBinding(node?.props?.[BINDING_KEY])
  if (!binding || typeof binding.remoteUrl !== 'string' || binding.remoteUrl.length === 0) {
    return null
  }

  return {
    remoteUrl: binding.remoteUrl,
    audience,
    path: resolved.syscallPath,
    ...(resolved.selfRef !== undefined && { paramsInjection: { _self: resolved.selfRef } }),
  }
}

/**
 * Resolve the Syscall tree path (and `_self` when applicable) for a given
 * method reference. For a plain class path, this is a pass-through. For an
 * instance-method path, we fetch the source's class to reconstruct the
 * Syscall's tree location.
 */
async function resolveSyscallPath(
  client: ClientSession<FnMap>,
  path: string,
): Promise<{ syscallPath: string; selfRef?: string } | null> {
  const instanceMethod = InstanceMethodPath.tryParse(path)
  if (!instanceMethod) {
    return { syscallPath: path }
  }

  const sourceRaw = instanceMethod.source.raw
  let sourceNode: NodeHead | null = null
  try {
    sourceNode = (await client.call(`${sourceRaw}::get`, {})) as NodeHead | null
  } catch {
    return null
  }

  const rawClass = sourceNode?.class
  if (typeof rawClass !== 'string' || rawClass.length === 0) return null

  const parsedClass = ClassPath.tryParse(rawClass)
  if (!parsedClass) return null

  const syscallPath = `/${parsedClass.domain}/class.${parsedClass.className}/${instanceMethod.methodName}`
  return { syscallPath, selfRef: sourceRaw }
}

/**
 * Mint a delegation credential scoped to the remote worker's audience.
 *
 * The Syscall lives under the caller's self identity (`@__system__` in manager
 * kernels), so the invariant on `mintDelegationCredential` passes without
 * additional claims. A self-delegation is the least-privilege shape — the
 * worker inherits whatever grants the caller already has.
 */
export async function mintRemoteCredential(
  client: ClientSession<FnMap>,
  audience: string,
  callerCredential: string,
): Promise<string> {
  const result = await client.call(
    '@__system__::mintDelegationCredential',
    {
      audience,
      delegation: { kind: 'identity', self: true },
      ttl: 3600,
    },
    { credential: callerCredential },
  )
  if (typeof result !== 'string') {
    throw new Error(
      `mintDelegationCredential returned non-string: ${typeof result} — cannot use as credential`,
    )
  }
  return result
}

/**
 * Extract the domain slug from a kernel method path.
 *
 * `/dist.localhost/class.BlaxelComputer/init` → `dist.localhost`
 * Returns `null` for relative paths, id-anchored paths, or malformed input.
 */
export function extractDomainSlug(path: string): string | null {
  if (!path.startsWith('/')) return null
  const rest = path.slice(1)
  const slash = rest.indexOf('/')
  const slug = slash === -1 ? rest : rest.slice(0, slash)
  return slug.length > 0 ? slug : null
}

function parseBinding(raw: unknown): { remoteUrl?: unknown } | null {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as { remoteUrl?: unknown }
    } catch {
      return null
    }
  }
  if (raw && typeof raw === 'object') return raw as { remoteUrl?: unknown }
  return null
}
