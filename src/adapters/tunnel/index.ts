import type { TunnelAdapter } from '../../ports/tunnel'

import { NotImplementedError } from '../../errors'
import { ADAPTER_NAME, cloudflaredAdapter } from '../tunnel-cloudflared'

/**
 * Tunnel adapter registry. Commands resolve a `TunnelAdapter` through here
 * (never the concrete `cloudflaredAdapter`) so the CLI stays agnostic of the
 * provider. Mirrors `resolveDomainPlatform`. `null` marks a roadmap adapter.
 */
const ADAPTERS: Record<string, TunnelAdapter | null> = {
  cloudflared: cloudflaredAdapter,
}

export function resolveTunnelAdapter(id: string = ADAPTER_NAME): TunnelAdapter {
  const adapter = ADAPTERS[id]
  if (adapter) return adapter
  throw new NotImplementedError(
    `TunnelAdapter "${id}"`,
    `Known ids: ${Object.keys(ADAPTERS).join(', ')}. Only "cloudflared" is implemented in v1.`,
  )
}

export { ADAPTER_NAME }
