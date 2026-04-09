import { KernelClient, type FnMap } from '@astrale-os/kernel-client'

import type { CommandDefinition } from '../../command'

import { resolveCredential } from '../../kernel/auth'
import { readConfig } from '../../lib/config'
import { readInstances, removeInstance } from '../../lib/instance'
import { log } from '../../lib/log'

export default {
  name: 'remove',
  description: 'Remove a registered instance (local store + manager if reachable)',
  arguments: [{ name: 'name', description: 'Instance name', required: true }],
  options: [{ flags: '-f, --force', description: 'Skip manager-side cleanup on failure' }],
  action: async (name: string, cmdOpts: { force?: boolean }) => {
    const store = await readInstances()
    const inLocal = name in store.instances

    let removedSomewhere = false

    if (inLocal) {
      try {
        await removeInstance(name)
        log.success(`Removed local instance "${name}"`)
        removedSomewhere = true
      } catch (e) {
        log.error(e instanceof Error ? e.message : String(e))
        process.exit(1)
      }
    }

    // Also try to unregister from the manager — this is what makes
    // discovered-only entries removable.
    const config = await readConfig()
    const client = new KernelClient<FnMap>({
      url: `http://localhost:${config.managerPort}/mngt`,
      requestTimeout: 5_000,
    })
    try {
      const credential = await resolveCredential({}, config)
      await client.call('/manager.astrale.ai/KernelInstance/remove', { id: name }, credential)
      log.success(`Unregistered "${name}" from manager`)
      removedSomewhere = true
    } catch (e) {
      // Discovered-only entries: this is the only place we'd ever remove them.
      // For local-only entries (manager unreachable, instance never registered),
      // a manager error is fine — the local removal already happened.
      if (!inLocal && !cmdOpts.force) {
        log.error(
          `Instance "${name}" not found locally and manager unregister failed: ${e instanceof Error ? e.message : String(e)}`,
        )
        process.exit(1)
      }
      if (cmdOpts.force) {
        log.warn(
          `Manager-side cleanup failed (--force): ${e instanceof Error ? e.message : String(e)}`,
        )
        removedSomewhere = true
      }
    } finally {
      client.disconnect()
    }

    if (!removedSomewhere) {
      log.error(`Instance "${name}" not found`)
      process.exit(1)
    }
  },
} satisfies CommandDefinition
