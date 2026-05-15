import type { CommandDefinition } from '../../../command'

import { resolveDomainPlatform } from '../../../adapters/domain-platform'
import { resolveDomainDirs } from '../../../lib/domain-discovery'
import { fatal, log } from '../../../lib/log'
import { isRawOutput, output } from '../../../lib/output'
import { labelFor } from './_shared'

type Opts = {
  cwd?: string
  platform?: string
  raw?: boolean
  json?: boolean
}

export default {
  name: 'status',
  description:
    'Show the persisted dev state for every domain found under the cwd (what `dev up` started). Falls back to the single enclosing domain when run from inside one.',
  options: [
    {
      flags: '--cwd <path>',
      description: 'Directory to scan for domains (default: current working directory)',
    },
    {
      flags: '--platform <id>',
      description: 'DomainPlatform adapter id (default: cloudflare)',
      default: 'cloudflare',
    },
    { flags: '--raw', description: 'Output raw JSON (an array, one entry per domain)' },
    { flags: '--json', description: 'Alias for --raw' },
  ],
  action: async (opts: Opts) => {
    const platform = resolveDomainPlatform(opts.platform)

    let dirs: string[]
    try {
      dirs = await resolveDomainDirs(opts.cwd)
    } catch (e) {
      fatal(e)
    }

    try {
      if (isRawOutput(opts)) {
        const entries = []
        for (const dir of dirs) {
          entries.push({
            dir,
            label: labelFor(dir),
            state: await platform.devStatus({ domainDir: dir }),
          })
        }
        output(entries, opts)
        return
      }

      for (const dir of dirs) {
        const label = labelFor(dir)
        const state = await platform.devStatus({ domainDir: dir })
        log.step(`dev state — ${label}`)
        if (state === null) {
          log.dim('  not started (no state file)')
          continue
        }
        log.dim(`  presets:   kernel=${state.presets.kernel} domain=${state.presets.domain}`)
        log.dim(`  startedAt: ${state.startedAt}`)
        log.dim(`  astrale:   ${state.started.astrale ? 'started by dev up' : '(untouched)'}`)
        log.dim(
          `  tunnel:    ${state.started.cloudflared ? state.started.cloudflared.name : '(none)'}`,
        )
        log.dim(
          `  wrangler:  ${state.started.wrangler ? `:${state.started.wrangler.port} pid=${state.started.wrangler.pid}` : '(none)'}`,
        )
      }
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
