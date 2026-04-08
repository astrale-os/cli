import type { CommandDefinition } from '../../command'

import { addInstance } from '../../lib/instance'
import { log } from '../../lib/log'

export default {
  name: 'add',
  description: 'Register a kernel instance',
  arguments: [{ name: 'name', description: 'Instance name', required: true }],
  options: [{ flags: '--url <http-url>', description: 'Kernel HTTP URL (for remote instances)' }],
  action: async (name: string, opts: { url?: string }) => {
    try {
      const entry = await addInstance(name, opts)
      if (entry.url) {
        log.success(`Added instance "${name}" (${entry.url})`)
      } else {
        log.success(`Added instance "${name}" (local)`)
      }
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }
  },
} satisfies CommandDefinition
