import type { HarnessCapabilities } from '../../../../shared/types'

/** Stable CLI aliases; account-specific availability is resolved by Claude Code itself. */
export const CLAUDE_CAPABILITIES = {
  effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  effortLabels: { max: 'Ultra' },
  accessLevels: ['workspace', 'full'],
  modelOptions: [
    {
      id: 'fable',
      label: 'Fable',
      description: 'Claude Code alias for the latest available Fable model.',
    },
    {
      id: 'sonnet',
      label: 'Sonnet',
      description: 'Claude Code alias for the latest available Sonnet model.',
    },
    {
      id: 'opus',
      label: 'Opus',
      description: 'Claude Code alias for the latest available Opus model.',
    },
  ],
  allowCustomModel: true,
  ask: true,
  loadout: true,
  gateway: 'anthropic',
} as const satisfies HarnessCapabilities
