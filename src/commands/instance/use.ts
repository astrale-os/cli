import type { CommandDefinition } from '../../command'

import { type UseOpts, useCommand } from '../use'

export default {
  name: 'use',
  description: 'Set the active kernel instance (no args: show current, §9.1)',
  arguments: [{ name: 'name', description: 'Registered instance name', required: false }],
  options: [
    {
      flags: '--adopt-default',
      description: 'Adopt instance default identity without prompt (§7.1)',
    },
    { flags: '--skip-jwks-check', description: 'Skip the /meta ↔ JWKS match check (§7)' },
  ],
  action: async (name: string | undefined, opts: UseOpts) => {
    await useCommand(name, opts)
  },
} satisfies CommandDefinition
