import type { CommandDefinition } from '../../../command'

import { resolveDomainPlatform } from '../../../adapters/domain-platform'
import { fatal, log } from '../../../lib/log'

type Opts = {
  kernel: string
  domain: string
  cwd?: string
  platform?: string
}

export default {
  name: 'up',
  description: 'Start local dev infrastructure for the current domain (wrangler + optional tunnel/manager)',
  options: [
    { flags: '--kernel <name>', description: 'Kernel preset (e.g. local:manager:inprocess)' },
    { flags: '--domain <name>', description: 'Domain preset (e.g. local:inprocess)' },
    { flags: '--cwd <path>', description: 'Domain directory (default: current working directory)' },
    {
      flags: '--platform <id>',
      description: 'DomainPlatform adapter id (default: cloudflare)',
      default: 'cloudflare',
    },
  ],
  action: async (opts: Opts) => {
    try {
      if (!opts.kernel || !opts.domain) {
        throw new Error('both --kernel and --domain are required')
      }
      const platform = resolveDomainPlatform(opts.platform)
      const state = await platform.devUp({
        domainDir: opts.cwd ?? process.cwd(),
        kernel: opts.kernel,
        domain: opts.domain,
      })
      log.dim(`  state: ${JSON.stringify(state.started)}`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
