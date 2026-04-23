import { resolve } from 'node:path'

import type { CommandDefinition } from '../../command'

import { resolveDomainPlatform } from '../../adapters/domain-platform'
import { fatal, log } from '../../lib/log'

type Opts = {
  preset?: string
  skipDriftCheck?: boolean
  cwd?: string
  platform?: string
}

export default {
  name: 'deploy',
  description: 'Build spec + deploy worker + drift check (§9.1, §10)',
  options: [
    {
      flags: '--preset <name>',
      description: 'Domain env preset for build:spec (default: prod)',
      default: 'prod',
    },
    {
      flags: '--skip-drift-check',
      description: 'Skip post-deploy /meta drift check (soft mode when DNS is not yet live)',
    },
    {
      flags: '--cwd <path>',
      description: 'Domain directory (default: current working directory)',
    },
    {
      flags: '--platform <id>',
      description: 'DomainPlatform adapter id (default: cloudflare)',
      default: 'cloudflare',
    },
  ],
  action: async (opts: Opts) => {
    try {
      const domainDir = opts.cwd ? resolve(process.cwd(), opts.cwd) : process.cwd()

      const platform = resolveDomainPlatform(opts.platform)
      log.step(`Deploying domain in ${domainDir}`)
      log.dim(`  preset=${opts.preset ?? 'prod'} skipDriftCheck=${!!opts.skipDriftCheck}`)

      const result = await platform.deploy({
        domainDir,
        preset: opts.preset,
        skipDriftCheck: opts.skipDriftCheck,
      })

      if (result.url) log.dim(`  url         = ${result.url}`)
      if (result.schemaHash) log.dim(`  schemaHash  = ${result.schemaHash}`)
      if (result.sdkCommit) log.dim(`  sdkCommit   = ${result.sdkCommit}`)
      for (const w of result.warnings) log.warn(w)
      log.success('Deploy complete')
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
