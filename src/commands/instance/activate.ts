import type { KernelCommandOpts } from '../../connection'
import type { AdminTargetCommandOpts } from '../../lib/admin-target'
import type { CommandDefinition } from '../../program'

import { formatKernelError } from '../../connection/errors'
import { AstraleError } from '../../errors'
import { activateInstance } from '../../lib/activate-instance'
import { findOwnedInstance, listOwnedInstancesWithIdentity } from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS } from '../../lib/admin-target'
import { isMachine, output } from '../../lib/output'

export default {
  name: 'activate',
  description: 'Activate the retained owner of an existing Instance with WorkOS',
  arguments: [{ name: 'instance', description: 'Owned Instance slug or id', required: true }],
  options: [...ADMIN_TARGET_OPTIONS],
  action: async (identifier: string, opts: KernelCommandOpts & AdminTargetCommandOpts) => {
    try {
      const inventory = await listOwnedInstancesWithIdentity(opts)
      const instance = findOwnedInstance(inventory.instances, identifier)
      if (!instance)
        throw new AstraleError(
          'INSTANCE_NOT_FOUND',
          'No owned Admin Instance matches this identifier.',
        )
      const result = await activateInstance(instance, {
        ...opts,
        ...(inventory.identity === undefined ? {} : { as: inventory.identity }),
      })
      if (isMachine(opts)) output({ instance: instance.id, ...result }, opts)
      else console.log(`Owner access activated: ${instance.slug}`)
    } catch (cause) {
      await formatKernelError(cause, isMachine(opts), undefined, opts.debug)
      process.exitCode = 1
    }
  },
} satisfies CommandDefinition
