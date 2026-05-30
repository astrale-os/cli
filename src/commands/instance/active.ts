import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { getActive, resolveInstance } from '../../lib/instance'
import { log } from '../../lib/log'
import { RAW_OUTPUT_OPTIONS, isRawOutput, output, type RawOutputOpts } from '../../lib/output'

export default {
  name: 'active',
  description: 'Show the currently active instance',
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (opts: RawOutputOpts) => {
    try {
      const isRaw = isRawOutput(opts)
      const { name } = await getActive()
      // Manager is always derivable; bookmarks live in the entry; local-
      // child needs the manager. If the manager is down and we have no
      // cache, fall back to the name alone.
      let url: string | null = null
      let createdAt: string | null = null
      try {
        const resolved = await resolveInstance(name)
        url = resolved.url
        createdAt = resolved.createdAt ?? null
      } catch {
        /* MANAGER_UNREACHABLE */
      }

      if (isRaw) {
        output({ name, url, createdAt }, opts)
        return
      }

      console.log(`${chalk.bold(name)} (${url ?? 'local'})`)
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }
  },
} satisfies CommandDefinition
