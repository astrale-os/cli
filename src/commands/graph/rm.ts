import { KernelClient, type FnMap } from '@astrale-os/kernel-client'

import type { CommandDefinition } from '../../command'

import { resolveCredential } from '../../kernel/auth'
import { readConfig } from '../../lib/config'
import {
  getAllGraphs,
  getGraphStats,
  removeGraph,
  validateGraphName,
  formatStats,
  handleGraphError,
} from '../../lib/graph'
import { log } from '../../lib/log'
import { confirm } from '../../lib/prompt'

type RmOpts = {
  yes?: boolean
  force?: boolean
}

type KernelInstance = { id: string; graphName: string; status: string }

export default {
  name: 'rm',
  description: 'Delete a specific FalkorDB graph',
  arguments: [{ name: 'name', description: 'Graph name to delete', required: true }],
  options: [
    { flags: '-y, --yes', description: 'Skip confirmation' },
    { flags: '-f, --force', description: 'Delete even if an instance references the graph' },
  ],
  action: async (name: string, opts: RmOpts) => {
    const config = await readConfig()

    // Validate graph name
    try {
      validateGraphName(name)
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }

    // Verify graph exists
    let existingGraphs: string[]
    try {
      existingGraphs = await getAllGraphs(config)
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e))
      handleGraphError(e)
      process.exit(1)
    }

    if (!existingGraphs.includes(name)) {
      log.error(`Graph "${name}" not found in FalkorDB`)
      if (existingGraphs.length > 0) {
        log.dim(`  Available: ${existingGraphs.join(', ')}`)
      }
      process.exit(1)
    }

    // Check protections (manager graph, in-use)
    if (name === config.graphName && !opts.force) {
      log.error(`"${name}" is the manager graph — cannot delete without --force`)
      log.dim('  This will make the manager unusable until you reset it.')
      process.exit(1)
    }

    if (!opts.force) {
      const instance = await findInstanceForGraph(config, name)
      if (instance) {
        log.error(`Graph "${name}" is referenced by instance "${instance.id}" (${instance.status})`)
        log.dim('  Use --force to delete anyway.')
        process.exit(1)
      }
    }

    // Show stats and confirm
    const stats = await getGraphStats(config, name)
    const { nodes, edges } = formatStats(stats)

    if (!opts.yes) {
      const confirmed = await confirm(`Delete graph "${name}" (${nodes} nodes, ${edges} edges)?`)
      if (!confirmed) {
        log.info('Aborted')
        return
      }
    }

    try {
      await removeGraph(config, name)
      log.success(`Deleted graph "${name}"`)
    } catch (e) {
      log.error(`Failed to delete "${name}": ${e instanceof Error ? e.message : String(e)}`)
      process.exit(1)
    }
  },
} satisfies CommandDefinition

/** Check if a single graph is referenced by any instance. Much cheaper than resolveGraphStatuses. */
async function findInstanceForGraph(
  config: { managerPort: number; issuer: string },
  graphName: string,
): Promise<KernelInstance | null> {
  const url = `http://localhost:${config.managerPort}/mngt`
  const client = new KernelClient<FnMap>({ url, requestTimeout: 5_000 })
  try {
    const credential = await resolveCredential(
      {},
      config as Parameters<typeof resolveCredential>[1],
    )
    const instances = (await client.call(
      '/manager.astrale.ai/KernelInstance/list',
      {},
      credential,
    )) as KernelInstance[]
    return instances.find((i) => i.graphName === graphName) ?? null
  } catch {
    return null
  } finally {
    client.disconnect()
  }
}
