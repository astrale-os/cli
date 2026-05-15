import type { CommandDefinition } from '../../../command'

import { resolveDomainPlatform } from '../../../adapters/domain-platform'
import { resolveDomainDirs } from '../../../lib/domain-discovery'
import { fatal, log } from '../../../lib/log'
import { type DomainResult, labelFor, printSummary } from './_shared'

type Opts = {
  cwd?: string
  platform?: string
}

export default {
  name: 'down',
  description:
    'Stop only what `dev up` started, for every domain found under the cwd (state-driven). Falls back to the single enclosing domain when run from inside one.',
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
  ],
  action: async (opts: Opts) => {
    const platform = resolveDomainPlatform(opts.platform)

    let dirs: string[]
    try {
      dirs = await resolveDomainDirs(opts.cwd)
    } catch (e) {
      fatal(e)
    }

    const results: DomainResult[] = []
    for (const dir of dirs) {
      const label = labelFor(dir)
      try {
        const result = await platform.devDown({ domainDir: dir })
        log.dim(`  ${label}: stopped ${JSON.stringify(result.stopped)}`)
        results.push({ dir, label, ok: true })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        log.error(`${label}: ${msg}`)
        results.push({ dir, label, ok: false, error: msg })
        // continue with the remaining domains
      }
    }

    printSummary('dev down', results)
    if (results.some((r) => !r.ok)) process.exit(1)
  },
} satisfies CommandDefinition
