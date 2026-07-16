import type { HarnessCapabilities } from '../../../../shared/types'

export const CODEX_CAPABILITIES = {
  effortLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  accessLevels: ['workspace', 'full'],
  allowCustomModel: true,
  ask: true,
  loadout: true,
  gateway: 'none',
} as const satisfies HarnessCapabilities
