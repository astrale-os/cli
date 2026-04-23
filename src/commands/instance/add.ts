import type { CommandDefinition } from '../../command'

import { addInstance, setActive } from '../../lib/instance'
import { fatal, log } from '../../lib/log'

/**
 * Deprecated alias for `instance bookmark`. Kept to preserve scripts
 * that predate V3 (e.g., older instance-prepare invocations). New usage
 * should prefer `astrale instance bookmark`.
 */
export default {
  name: 'add',
  description: '[deprecated] Alias for `instance bookmark`',
  arguments: [{ name: 'name', description: 'Instance name', required: true }],
  options: [
    { flags: '--url <http-url>', description: 'Kernel HTTP URL (for remote instances)' },
    { flags: '--use', description: 'Set as active instance after adding' },
  ],
  action: async (name: string, opts: { url?: string; use?: boolean }) => {
    try {
      log.warn('`instance add` is deprecated — use `instance bookmark` (§9.3)')
      const entry = await addInstance(name, {
        url: opts.url,
        name,
        kind: opts.url ? 'bookmark' : 'local-child',
        mode: 'local',
      })
      if (entry.url) {
        log.success(`Added instance "${name}" (${entry.url})`)
      } else {
        log.success(`Added instance "${name}" (local)`)
      }
      if (opts.use) {
        await setActive(name)
        log.success(`Active instance: ${name}`)
      }
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
