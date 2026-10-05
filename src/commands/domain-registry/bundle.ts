import type { CommandDefinition } from '../../program/index'
import type { RegistryCommandDependencies, RegistryCommandOpts } from './shared'

import { exactPublicationReference, registryOrigin } from '../../admin/registry'
import { AstraleError } from '../../errors'
import { ADMIN_TARGET_OPTIONS } from '../../lib/admin-target'
import { runRegistryCommand } from './shared'

type BundleOpts = RegistryCommandOpts & { readonly output?: string }

export async function runBundle(
  reference: string,
  opts: BundleOpts,
  dependencies?: RegistryCommandDependencies,
): Promise<number> {
  return runRegistryCommand({
    opts,
    machine: true,
    action: 'read',
    admit: () => {
      if (opts.output === undefined || opts.output === '')
        throw new AstraleError('MISSING_ARG', '__domain-registry bundle requires --output <file>.')
      const { origin, version } = exactPublicationReference(reference)
      return { origin: registryOrigin(origin), version, output: opts.output }
    },
    work: (registry, { origin, version, output }) => registry.bundle(origin, version, output),
    ...(dependencies === undefined ? {} : { dependencies }),
  })
}

export default {
  name: 'bundle',
  description:
    "Download one Publication's bundle from its deployment, digest verified (registry plumbing)",
  arguments: [
    {
      name: 'reference',
      description: '<origin>@<major>.<minor>.<patch>[-<pre>]',
      required: true,
    },
  ],
  options: [
    { flags: '--output <file>', description: 'File the verified bundle is written to' },
    ...ADMIN_TARGET_OPTIONS,
  ],
  action: async (reference: string, opts: BundleOpts) => {
    const code = await runBundle(reference, opts)
    if (code !== 0) process.exit(code)
  },
} satisfies CommandDefinition
