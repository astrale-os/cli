import type { CommandDefinition } from '../../command'

import { resolveDomainPlatform } from '../../adapters/domain-platform'
import { fatal, log } from '../../lib/log'

type Opts = {
  preset?: string
  cwd?: string
  platform?: string
}

export default {
  name: 'build',
  description: "Build the domain's spec.json for a given env preset (replaces `pnpm build:spec`)",
  options: [
    { flags: '--preset <name>', description: 'Domain env preset (default: prod)', default: 'prod' },
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
      const r = await platform.buildSpec({
        domainDir: opts.cwd ?? process.cwd(),
        preset: opts.preset,
      })
      log.success(`spec.json → ${r.specPath}`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
