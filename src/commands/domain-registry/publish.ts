import type { CommandDefinition } from '../../program/index'
import type { RegistryCommandDependencies, RegistryCommandOpts } from './shared'

import { publishRequest } from '../../admin/registry'
import { ADMIN_TARGET_OPTIONS } from '../../lib/admin-target'
import { readRequest, runRegistryCommand } from './shared'

export async function runPublish(
  opts: RegistryCommandOpts,
  dependencies?: RegistryCommandDependencies & { readonly request?: () => Promise<unknown> },
): Promise<number> {
  const read = dependencies?.request ?? (() => readRequest())
  return runRegistryCommand({
    opts,
    machine: true,
    action: 'change',
    admit: async () => publishRequest(await read()),
    work: (registry, request) => registry.publish(request),
    ...(dependencies === undefined ? {} : { dependencies }),
  })
}

export default {
  name: 'publish',
  description:
    'Name one deployed release with a version in the Admin registry; reads an astrale.registry-publish-request on stdin (registry plumbing)',
  options: [...ADMIN_TARGET_OPTIONS],
  action: async (opts: RegistryCommandOpts) => {
    const code = await runPublish(opts)
    if (code !== 0) process.exit(code)
  },
} satisfies CommandDefinition
