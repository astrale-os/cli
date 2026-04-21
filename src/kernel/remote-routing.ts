import type { KernelClient, FnMap } from '@astrale-os/kernel-client'

/**
 * Client-side routing of remote-bound kernel calls.
 *
 * A kernel Syscall whose Function carries `binding.remoteUrl` lives on an
 * external worker; the kernel dispatch path never invokes it. Before calling
 * such a method, the CLI needs to:
 *
 *   1. Discover the worker URL — via `::get` on the Syscall node.
 *   2. Derive the audience the worker expects — the domain slug is the first
 *      segment of the path (e.g. `/dist.localhost/…` → `dist.localhost`).
 *   3. Mint a delegation credential scoped to that audience (the default CLI
 *      credential targets the kernel's own issuer and would fail `verifyAudience`
 *      on the worker).
 *
 * Both kernel hops (lookup + mint) happen before the worker call.
 */

type SyscallNode = {
  __labels?: string[]
  props?: Record<string, unknown>
}

const BINDING_KEY = 'kernel.astrale.ai:interface.Function.property.binding'

export type RemoteBinding = {
  /** Worker URL where the envelope should be POSTed. */
  remoteUrl: string
  /** Audience the worker expects on inbound credentials (= domain slug). */
  audience: string
}

/**
 * Discover the remote binding for a kernel method path, if any.
 *
 * Returns `null` when the target isn't a Syscall, has no binding, or the
 * lookup fails for any reason — callers fall through to the normal envelope
 * path against the kernel.
 */
export async function lookupRemoteBinding(
  client: KernelClient<FnMap>,
  path: string,
  credential: string,
): Promise<RemoteBinding | null> {
  const audience = extractDomainSlug(path)
  if (!audience) return null

  let node: SyscallNode | null = null
  try {
    node = (await client.call(
      `${path}::get` as never,
      {} as never,
      credential,
    )) as SyscallNode | null
  } catch {
    return null
  }

  const props = node?.props
  if (!props) return null

  const bindingRaw = props[BINDING_KEY]
  const binding = parseBinding(bindingRaw)
  if (!binding || typeof binding.remoteUrl !== 'string' || binding.remoteUrl.length === 0) {
    return null
  }

  return { remoteUrl: binding.remoteUrl, audience }
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
  client: KernelClient<FnMap>,
  audience: string,
  callerCredential: string,
): Promise<string> {
  const result = await client.call(
    '@__system__::mintDelegationCredential' as never,
    {
      audience,
      delegation: { kind: 'identity', self: true },
      ttl: 3600,
    } as never,
    callerCredential,
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
function extractDomainSlug(path: string): string | null {
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
