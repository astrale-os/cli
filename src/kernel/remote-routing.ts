import type { FnMap } from '@astrale-os/kernel-client'
import type { ClientSession } from '@astrale-os/kernel-client/session'

/**
 * Credential-minting helpers for remote-bound kernel calls.
 *
 * The CLI no longer resolves remote bindings client-side: the kernel emits a
 * redirect carrying the target worker's `iss`, and the `ClientSession` follows
 * it, minting a worker-scoped delegation via `mintRemoteCredential` (wired as
 * the session's delegation-cache mint in `client.ts`). These helpers (whoami →
 * self-delegation) are the mint itself.
 */

/**
 * Mint a delegation credential scoped to the remote worker's audience.
 *
 * The Function lives under the caller's self identity (`@__system__` in manager
 * kernels), so the invariant on `mintDelegationCredential` passes without
 * additional claims. A self-delegation is the least-privilege shape — the
 * worker inherits whatever grants the caller already has.
 *
 * Internal calls pass `skipDelegation: true`: they target the default kernel
 * (same origin), so the delegation cache would skip them anyway, but being
 * explicit guarantees the mint can never recurse into itself.
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
    { credential: callerCredential, skipDelegation: true },
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
    { credential, skipDelegation: true },
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
