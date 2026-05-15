import { type FnMap } from '@astrale-os/kernel-client'
import { ClientSession } from '@astrale-os/kernel-client/session'

import type { CommandDefinition } from '../../command'

import { CannotDeleteManagerError } from '../../errors'
import { resolveCredential } from '../../kernel/auth'
import { readConfig } from '../../lib/config'
import {
  invalidateManagerCache,
  managerUrl,
  readInstances,
  removeInstance,
  resolveInstanceKey,
} from '../../lib/instance'
import { removeKeypair } from '../../lib/keys'
import { fatal, log } from '../../lib/log'
import { readTunnels, unbindTunnel } from '../../lib/tunnels'

export default {
  name: 'delete',
  description: 'Destructively delete a local or managed instance (§5)',
  afterHelpText: `
Behavior:
  Destructive: removes the instance kernel-side and from the local
  registry. Refused on the manager (use \`astrale stop\`) and on
  remote bookmarks (use \`astrale instance forget\`). -f forces.
`,
  arguments: [{ name: 'name', description: 'Instance name (slug or name)', required: true }],
  options: [{ flags: '-f, --force', description: 'Skip manager-side cleanup on failure' }],
  action: async (name: string, cmdOpts: { force?: boolean }) => {
    const store = await readInstances()
    const key = resolveInstanceKey(store, name)
    const entry = key ? store.instances[key] : undefined

    // §5.1 refusals with actionable hints.
    if (entry?.kind === 'manager' || key === 'manager') fatal(new CannotDeleteManagerError())
    if (entry?.kind === 'bookmark') {
      log.dim('  hint: use `astrale instance forget` to drop the reference (§5.1)')
      fatal(new Error(`"${name}" is a bookmark — delete is destructive kernel-side.`))
    }

    const inLocal = key !== null
    let deletedSomewhere = false

    if (inLocal && key) {
      try {
        // §12 — orphan tunnels are never auto-stopped; detach + warn.
        const tunnels = await readTunnels()
        for (const t of Object.values(tunnels.tunnels)) {
          if (t.boundInstance === key) {
            await unbindTunnel(t.name)
            log.warn(`  tunnel "${t.name}" detached — stop it with: astrale tunnel stop ${t.name}`)
          }
        }
        await removeInstance(key)
        // Drop the per-instance keypair written at `instance create`. Left
        // behind it would leak identity material for a slug the user could
        // later reuse for a different instance.
        if (entry?.kind === 'local-child') {
          await removeKeypair(key)
        }
        log.success(`Deleted local instance "${key}"`)
        deletedSomewhere = true
      } catch (e) {
        fatal(e)
      }
    }

    const config = await readConfig()
    const credential = await resolveCredential({}, config)
    const client = new ClientSession<FnMap>({
      default: managerUrl(config),
      identity: credential,
    })
    try {
      await client.call(
        '/manager.astrale.ai/class.KernelInstance/delete',
        { id: key ?? name },
        { timeout: 5_000 },
      )
      log.success(`Unregistered "${key ?? name}" from manager`)
      deletedSomewhere = true
    } catch (e) {
      if (!inLocal && !cmdOpts.force) {
        fatal(
          new Error(
            `Instance "${name}" not found locally and manager unregister failed: ${e instanceof Error ? e.message : String(e)}`,
          ),
        )
      }
      if (cmdOpts.force) {
        log.warn(
          `Manager-side cleanup failed (--force): ${e instanceof Error ? e.message : String(e)}`,
        )
        deletedSomewhere = true
      }
    } finally {
      client.disconnect()
    }

    // Bust the manager snapshot cache — any `astrale instance list` right
    // after a delete must see the post-delete state, not a stale hit.
    await invalidateManagerCache()

    if (!deletedSomewhere) fatal(new Error(`Instance "${name}" not found`))
  },
} satisfies CommandDefinition
