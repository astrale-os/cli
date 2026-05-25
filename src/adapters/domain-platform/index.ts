import type { DomainPlatform } from '../../ports/domain-platform'

import { NotImplementedError } from '../../errors'
import { cloudflareDomainPlatform } from './cloudflare'

const ADAPTERS: Record<string, DomainPlatform | null> = {
  cloudflare: cloudflareDomainPlatform,
  blaxel: null,
}

export function resolveDomainPlatform(id: string = 'cloudflare'): DomainPlatform {
  const adapter = ADAPTERS[id]
  if (adapter) return adapter
  throw new NotImplementedError(
    `DomainPlatform adapter "${id}"`,
    `Known ids: ${Object.keys(ADAPTERS).join(', ')}. Only "cloudflare" is implemented in v1.`,
  )
}

export { cloudflareDomainPlatform }
export {
  astraleArgv,
  needsAstraleManager,
  readDevState,
  requireAstraleManager,
} from './cloudflare-helpers'
export { resolveWorkerPort } from './cloudflare-lifecycle'
