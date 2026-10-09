import type { CommandDefinition } from '../../program/index'
import type { RegistryCommandDependencies, RegistryCommandOpts } from './shared'

import { exactPublicationReference, registryOrigin } from '../../admin/registry'
import { ADMIN_TARGET_OPTIONS } from '../../lib/admin-target'
import { runRegistryCommand } from './shared'

type YankOpts = RegistryCommandOpts & { readonly undo?: boolean }

export async function runYank(
  reference: string,
  opts: YankOpts,
  dependencies?: RegistryCommandDependencies,
): Promise<number> {
  return runRegistryCommand({
    opts,
    machine: true,
    action: 'change',
    admit: () => {
      const { origin, version } = exactPublicationReference(reference)
      return { origin: registryOrigin(origin), version }
    },
    work: (registry, { origin, version }) =>
      registry.yank(origin, version, { undo: opts.undo === true }),
    ...(dependencies === undefined ? {} : { dependencies }),
  })
}

export default {
  name: 'yank',
  description: 'Take one version out of resolution, or put it back with --undo (registry plumbing)',
  arguments: [
    {
      name: 'reference',
      description: '<origin>@<major>.<minor>.<patch>[-<pre>]',
      required: true,
    },
  ],
  options: [
    { flags: '--undo', description: 'Let line references choose the version again' },
    ...ADMIN_TARGET_OPTIONS,
  ],
  action: async (reference: string, opts: YankOpts) => {
    const code = await runYank(reference, opts)
    if (code !== 0) process.exit(code)
  },
} satisfies CommandDefinition
