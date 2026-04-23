import type { CommandDefinition } from '../../../command'

import { resolveDomainPlatform } from '../../../adapters/domain-platform'
import { fatal, log } from '../../../lib/log'
import { isRawOutput, output } from '../../../lib/output'

type Opts = {
  cwd?: string
  platform?: string
  raw?: boolean
  json?: boolean
}

export default {
  name: 'status',
  description: 'Show the persisted dev state (what `dev up` started for this domain)',
  options: [
    { flags: '--cwd <path>', description: 'Domain directory (default: current working directory)' },
    {
      flags: '--platform <id>',
      description: 'DomainPlatform adapter id (default: cloudflare)',
      default: 'cloudflare',
    },
    { flags: '--raw', description: 'Output raw JSON' },
    { flags: '--json', description: 'Alias for --raw' },
  ],
  action: async (opts: Opts) => {
    try {
      const platform = resolveDomainPlatform(opts.platform)
      const state = await platform.devStatus({ domainDir: opts.cwd ?? process.cwd() })

      if (state === null) {
        if (isRawOutput(opts)) {
          output(null, opts)
        } else {
          log.info('dev state: not started (no state file)')
        }
        return
      }
      if (isRawOutput(opts)) {
        output(state, opts)
        return
      }
      log.step('dev state')
      log.dim(`  presets:   kernel=${state.presets.kernel} domain=${state.presets.domain}`)
      log.dim(`  startedAt: ${state.startedAt}`)
      log.dim(`  astrale:   ${state.started.astrale ? 'started by dev up' : '(untouched)'}`)
      log.dim(
        `  tunnel:    ${state.started.cloudflared ? state.started.cloudflared.name : '(none)'}`,
      )
      log.dim(
        `  wrangler:  ${state.started.wrangler ? `:${state.started.wrangler.port} pid=${state.started.wrangler.pid}` : '(none)'}`,
      )
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
