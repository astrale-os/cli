import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { fatal, log } from '../../lib/log'
import { checkIssuerReachability } from '../../lib/meta'
import { RAW_OUTPUT_OPTIONS, isRawOutput, output, type RawOutputOpts } from '../../lib/output'

export default {
  name: 'check',
  description: 'Probe a domain or kernel: OIDC discovery + JWKS reachable (§11)',
  afterHelpText: `
Behavior:
  A real reachability probe (not a stub): requires --url, fetches the
  target's OIDC discovery + JWKS and reports iss/kid. Use it to verify
  a deployed worker or kernel before wiring callers to it.

Examples:
  $ astrale domain check --url https://my-domain.example.com
`,
  options: [{ flags: '--url <url>', description: 'Target URL' }, ...RAW_OUTPUT_OPTIONS],
  action: async (opts: RawOutputOpts & { url?: string }) => {
    try {
      if (!opts.url) fatal(new Error('Missing required flag: --url <url>'))
      const { issuer, keys } = await checkIssuerReachability(opts.url!)
      if (isRawOutput(opts)) {
        output({ url: opts.url, issuer, keys: keys.map((k) => ({ kid: k.kid })) }, opts)
        return
      }
      console.log(chalk.bold(opts.url))
      log.dim(`  iss=${issuer} keys=${keys.length}`)
      log.success('OIDC discovery + JWKS reachable')
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
