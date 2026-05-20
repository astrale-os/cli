import type { CommandDefinition } from '../../../command'

import { resolveDomainPlatform } from '../../../adapters/domain-platform'
import { AstraleError } from '../../../errors'
import { resolveDomainDirs } from '../../../lib/domain-discovery'
import { fatal, log } from '../../../lib/log'
import { type DomainResult, labelFor, printSummary } from './_shared'

type Opts = {
  kernel: string
  domain: string
  cwd?: string
  platform?: string
}

export default {
  name: 'up',
  description:
    'Restart local dev infrastructure for every domain found under the cwd (wrangler + optional tunnel/manager). Falls back to the single enclosing domain when run from inside one.',
  options: [
    {
      flags: '--kernel <name>',
      description: 'Kernel preset, applied to every domain (default: local:manager:inprocess)',
      default: 'local:manager:inprocess',
    },
    {
      flags: '--domain <name>',
      description: 'Domain preset, applied to every domain (default: local:inprocess)',
      default: 'local:inprocess',
    },
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
      log.step(`restarting ${label} (${dir})`)
      try {
        await platform.devDown({ domainDir: dir })
        await platform.devUp({ domainDir: dir, kernel: opts.kernel, domain: opts.domain })
        results.push({ dir, label, ok: true })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        log.error(`${label}: ${msg}`)
        if (e instanceof AstraleError && e.hint) log.dim(`  hint: ${e.hint}`)
        results.push({ dir, label, ok: false, error: msg })
        // continue with the remaining domains
      }
    }

    printSummary('dev up', results)
    if (results.some((r) => !r.ok)) process.exit(1)
  },
} satisfies CommandDefinition
