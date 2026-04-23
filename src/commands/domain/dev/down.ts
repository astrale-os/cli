import type { CommandDefinition } from '../../../command'

import { resolveDomainPlatform } from '../../../adapters/domain-platform'
import { fatal, log } from '../../../lib/log'

type Opts = {
  cwd?: string
  platform?: string
}

export default {
  name: 'down',
  description: 'Stop only what `dev up` started for this domain (state-driven)',
  options: [
    { flags: '--cwd <path>', description: 'Domain directory (default: current working directory)' },
    {
      flags: '--platform <id>',
      description: 'DomainPlatform adapter id (default: cloudflare)',
      default: 'cloudflare',
    },
  ],
  action: async (opts: Opts) => {
    try {
      const platform = resolveDomainPlatform(opts.platform)
      const result = await platform.devDown({ domainDir: opts.cwd ?? process.cwd() })
      log.dim(`  stopped: ${JSON.stringify(result.stopped)}`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
