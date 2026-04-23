import type { CommandDefinition } from '../../command'

import { streamManagerLogs } from '../../lib/docker'
import { fatal } from '../../lib/log'

export default {
  name: 'logs',
  description: 'Stream the manager container logs (docker-mode)',
  options: [
    { flags: '-f, --follow', description: 'Follow log output (tail -f)' },
    { flags: '-n, --tail <lines>', description: 'Number of recent lines to show', default: '50' },
  ],
  action: async (opts: { follow?: boolean; tail?: string }) => {
    try {
      await streamManagerLogs({
        follow: opts.follow ?? false,
        tail: opts.tail ?? '50',
      })
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
