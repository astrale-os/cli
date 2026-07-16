import type { HarnessCapabilities } from '../../../../shared/types'

/** Stable model aliases plus the effort modes supported by current Claude Code. */
export const CLAUDE_CAPABILITIES = {
  effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
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
  ask: true,
  loadout: true,
  gateway: 'anthropic',
} as const satisfies HarnessCapabilities
