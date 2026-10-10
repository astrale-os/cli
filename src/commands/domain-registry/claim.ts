import type { CommandDefinition } from '../../program/index'
import type { RegistryCommandDependencies, RegistryCommandOpts } from './shared'

import { registryOrigin } from '../../admin/registry'
import { ADMIN_TARGET_OPTIONS } from '../../lib/admin-target'
import { runRegistryCommand } from './shared'

export async function runClaim(
  origin: string,
  opts: RegistryCommandOpts,
  dependencies?: RegistryCommandDependencies,
): Promise<number> {
  return runRegistryCommand({
    opts,
    machine: true,
    action: 'change',
    admit: () => registryOrigin(origin),
    work: (registry, admitted) => registry.claim(admitted),
    ...(dependencies === undefined ? {} : { dependencies }),
  })
}

export default {
  name: 'claim',
  description:
    'Claim one Domain origin in the Admin registry: its first claimer administers it (registry plumbing)',
  arguments: [{ name: 'origin', description: 'The Domain origin', required: true }],
  options: [...ADMIN_TARGET_OPTIONS],
  action: async (origin: string, opts: RegistryCommandOpts) => {
    const code = await runClaim(origin, opts)
    if (code !== 0) process.exit(code)
  },
} satisfies CommandDefinition
