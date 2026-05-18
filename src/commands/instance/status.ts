import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { readConfig } from '../../lib/config'
import { readInstances, resolveInstance } from '../../lib/instance'
import { fatal, log } from '../../lib/log'
import { checkIssuerReachability } from '../../lib/meta'
import { RAW_OUTPUT_OPTIONS, isRawOutput, output, type RawOutputOpts } from '../../lib/output'

export default {
  name: 'status',
  description: 'Check a single instance: OIDC discovery + JWKS reachable',
  arguments: [{ name: 'name', description: 'Instance name (slug or name)', required: false }],
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (name: string | undefined, opts: RawOutputOpts) => {
    try {
      const config = await readConfig()
      const target = name ?? (await readInstances(config)).active
      if (!target) fatal(new Error('No active instance. Run: astrale instance use <name>'))

      const resolved = await resolveInstance(target, config)
      const { issuer, keys } = await checkIssuerReachability(resolved.url, resolved.issuer)

      if (isRawOutput(opts)) {
        output(
          {
            name: resolved.name,
            url: resolved.url,
            issuer,
            keys: keys.map((k) => ({ kid: k.kid })),
          },
          opts,
        )
        return
      }
      console.log(`${chalk.bold(resolved.name)} (${resolved.url})`)
      log.dim(`  iss=${issuer} keys=${keys.length}`)
      log.success('OIDC discovery + JWKS reachable')
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
