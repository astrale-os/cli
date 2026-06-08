import type { FnMap } from '@astrale-os/kernel-client'
import type { ClientSession } from '@astrale-os/kernel-client/session'

import { K } from '@astrale-os/kernel-core'
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
 *   3. Derive the audience — the target's own `iss` identity (read off the
 *      node). A remote-bound function always carries one.
 *   4. Mint a delegation credential scoped to that audience.
 *
 * For an instance-method form (`<node>::<method>`), the Syscall doesn't sit
 * at `<node>::<method>` in the graph — it lives at `<domain>/class.<Class>/<method>`.
 * The CLI resolves the source's class and rewrites the path; callers then
 * POST to the worker with `_self = <source>` injected into params.
 */

type MethodNode = {
  __labels?: string[]
  props?: Record<string, unknown>
}

type NodeHead = {
  class?: string
  /** Class + every interface the class implements (domain-relative names). */
  __labels?: string[]
}

/**
 * Built-in kernel interfaces that never host domain-specific instance methods.
 * Skipping them as candidates avoids a wasted round-trip per call.
 */
const KERNEL_INTERFACES = new Set(['Node', 'Container', 'Identity', 'Function', 'Edge'])

export type RemoteBinding = {
  /** Worker URL where the envelope should be POSTed. */
  remoteUrl: string
  /** Function output mode. Binary methods must use the binary transport. */
  output?: string
  /** Audience the worker expects on inbound credentials — the target's own
   *  `iss` identity, read off the node. */
  audience: string
  /** The path to send to the worker — may differ from the input when rewriting `::method`. */
  path: string
  /** Target-of-call for instance methods. Forwarded as `KernelRequest.self`. */
  self?: string
}

/**
 * Discover the remote binding for a kernel method path, if any.
 *
 * Returns `null` when the target isn't a Syscall, has no binding, or the
 * lookup fails for any reason — callers fall through to the normal envelope
 * path against the kernel.
 *
 * Iterates through candidate syscall paths (class-bucket first, then each
 * interface the source's class implements) so instance methods declared on
 * an interface — whose syscall lives at `/<domain>/interface.<Iface>/<method>`
 * rather than on the class — also get the worker re-mint treatment.
 */
export async function lookupRemoteBinding(
  client: ClientSession<FnMap>,
  path: string,
  _credential: string,
): Promise<RemoteBinding | null> {
  const resolved = await resolveSyscallCandidates(client, path)
  if (!resolved) return null

  for (const candidate of resolved.candidates) {
    // Skip candidates that aren't domain-addressed (relative / id-anchored /
    // malformed) before the round-trip; the slug itself is no longer the
    // audience (that's the node's `iss`).
    if (!extractDomainSlug(candidate)) continue

    let node: MethodNode | null = null
    try {
      node = (await client.call(`${candidate}::get`, {})) as MethodNode | null
    } catch {
      // Syscall doesn't exist at this candidate — try the next one.
      continue
    }
    if (!node) continue

    // `Function` is a homonym (node class + contract interface) so the flat
    // `K.Function` is ambiguous — reach the interface props via `K.$.i('Function')`.
    const binding = parseBinding(node.props?.[K.$.i('Function').binding.key])
    if (!binding || typeof binding.remoteUrl !== 'string' || binding.remoteUrl.length === 0) {
      // Found the syscall but it has no remote binding — kernel handles it.
      return null
    }

    const output = node.props?.[K.$.i('Function').output.key]
    // Audience = the target Function's own issuer (its `iss` identity), read off
    // the resolved node — NOT the path slug. Addressing (the slug) and identity
    // (the `iss`) are decoupled: a domain addressed `/:crm.astrale.ai:…` carries
    // `iss = https://…` (its serving URL). A remote-bound function always has an
    // iss — a missing one means a misconfigured install.
    const iss = node.props?.[K.Identity.iss.key]
    if (typeof iss !== 'string' || iss.length === 0) {
      throw new Error(
        `remote function "${candidate}" has a binding.remoteUrl but no iss identity — ` +
          `it must be installed with an identity binding.`,
      )
    }
    const audience = iss

    return {
      remoteUrl: binding.remoteUrl,
      ...(typeof output === 'string' && { output }),
      audience,
      path: candidate,
      ...(resolved.selfRef !== undefined && { self: resolved.selfRef }),
    }
  }

  return null
}

/**
 * Resolve candidate Syscall tree paths (and `_self` when applicable) for a
 * given method reference, in priority order:
 *
 *   1. Class-bucket: `/<domain>/class.<X>/<method>` (most methods).
 *   2. Interface-bucket: `/<domain>/interface.<Iface>/<method>` for each
 *      interface the source's class implements (per its `__labels`).
 *
 * For a plain class/interface path, this is a pass-through (one candidate).
 * For an instance-method path (`<node>::<method>`), we fetch the source's
 * class + labels to reconstruct candidates.
 */
async function resolveSyscallCandidates(
  client: ClientSession<FnMap>,
  path: string,
): Promise<{ candidates: string[]; selfRef?: string } | null> {
  const instanceMethod = InstanceMethodPath.tryParse(path)
  if (!instanceMethod) {
    return { candidates: [path] }
  }

  const sourceRaw = instanceMethod.source.raw
  let sourceNode: NodeHead | null = null
  try {
    sourceNode = (await client.call(`${sourceRaw}::get`, {})) as NodeHead | null
  } catch {
    return null
  }

  if (!sourceNode) return null
  const rawClass = sourceNode.class
  if (typeof rawClass !== 'string' || rawClass.length === 0) return null

  const parsedClass = ClassPath.tryParse(rawClass)
  if (!parsedClass) return null

  const candidates: string[] = [
    `/${parsedClass.domain}/class.${parsedClass.className}/${instanceMethod.methodName}`,
  ]
  for (const label of sourceNode.__labels ?? []) {
    if (label === parsedClass.className) continue
    if (KERNEL_INTERFACES.has(label)) continue
    candidates.push(`/${parsedClass.domain}/interface.${label}/${instanceMethod.methodName}`)
  }
  return { candidates, selfRef: sourceRaw }
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
  const mintPath = await mintDelegationPath(client, callerCredential)
  const result = await client.call(
    mintPath,
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
 * Resolve the kernel path that mints a self-delegation credential for the
 * CALLER: `@<nodeId>::mintDelegationCredential`.
 */
export async function mintDelegationPath(
  client: ClientSession<FnMap>,
  credential: string,
): Promise<string> {
  const sub = readJwtSub(credential)
  // System / opaque credential: the graph node id is literally `__system__`,
  // so we can skip the whoami round-trip.
  if (!sub || sub === 'system') return '@__system__::mintDelegationCredential'
  const self = (await client.call(
    '/:kernel.astrale.ai:interface.Identity:whoami',
    {},
    { credential },
  )) as { id?: unknown } | null
  const id = self && typeof self.id === 'string' ? self.id : undefined
  if (!id) {
    throw new Error(
      'Could not resolve the caller identity (whoami returned no id) — cannot mint a delegation credential.',
    )
  }
  return `@${id}::mintDelegationCredential`
}

function readJwtSub(credential: string): string | null {
  const [, payload] = credential.split('.')
  if (!payload) return null
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as {
      sub?: unknown
    }
    return typeof decoded.sub === 'string' && decoded.sub.length > 0 ? decoded.sub : null
  } catch {
    return null
  }
}

/**
 * Extract the domain slug from a kernel method path.
 *
 * `/dist.localhost/class.BlaxelComputer/init` -> `dist.localhost`
 * Returns `null` for relative paths, id-anchored paths, or malformed input.
 */
export function extractDomainSlug(path: string): string | null {
  if (!path.startsWith('/')) return null
  const rest = path.slice(1)
  const slash = rest.indexOf('/')
  const slug = slash === -1 ? rest : rest.slice(0, slash)
  return slug.length > 0 ? slug : null
}

/** Parse a `Function.binding` prop value (JSON string or object form). */
export function parseBinding(raw: unknown): { remoteUrl?: unknown } | null {
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
