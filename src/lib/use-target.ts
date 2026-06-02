import type { IdentityStore } from './identity'
import type { InstanceStore } from './instance'

import { resolveInstanceKey } from './instance'

export type UseTarget =
  | { kind: 'identity'; name: string }
  | { kind: 'instance'; name: string }
  | { kind: 'ambiguous'; name: string }
  | { kind: 'missing'; name: string }

export function resolveUseTarget(
  name: string,
  instances: InstanceStore,
  identities: IdentityStore,
): UseTarget {
  const identityExists = !!identities.identities[name]
  const instanceKey = resolveInstanceKey(instances, name)

  if (identityExists && instanceKey) return { kind: 'ambiguous', name }
  if (identityExists) return { kind: 'identity', name }
  if (instanceKey) return { kind: 'instance', name: instanceKey }
  return { kind: 'missing', name }
}
