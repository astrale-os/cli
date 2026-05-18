import type { CommandDefinition } from '../../command'

import { addInstance, setActive } from '../../lib/instance'
import { fatal, log } from '../../lib/log'
import { checkIssuerReachability } from '../../lib/meta'

export default {
  name: 'bookmark',
  description: 'Register a reference to an existing remote instance',
  arguments: [{ name: 'name', description: 'Bookmark name (free, required)', required: true }],
  options: [
    { flags: '--url <url>', description: 'URL of the remote instance (required)' },
    {
      flags: '--as <identity>',
      description: 'Default identity for this bookmark (defaults to astrale cloud)',
    },
    {
      flags: '--local',
      description: 'Store this bookmark locally only (default: remote sync when cloud is wired)',
    },
    { flags: '--use', description: 'Set as active instance after bookmarking' },
    { flags: '--skip-probe', description: 'Skip the OIDC + JWKS liveness probe (still recorded)' },
  ],
  action: async (
    name: string,
    opts: { url?: string; as?: string; local?: boolean; use?: boolean; skipProbe?: boolean },
  ) => {
    try {
      if (!opts.url) fatal(new Error('Missing required flag: --url <url>'))

      if (!opts.skipProbe) {
        try {
          const { issuer, keys } = await checkIssuerReachability(opts.url!)
          log.dim(`  iss=${issuer} keys=${keys.length}`)
        } catch (e) {
          log.dim('  (re-run with --skip-probe to bookmark anyway.)')
          fatal(e)
        }
      }

      // §2.7 default = remote; cloud sync is stubbed in v1 (§15).
      const mode = opts.local ? 'local' : 'remote'
      if (!opts.local) log.dim('  (remote mode stored — cloud sync is a no-op in v1)')
      const entry = await addInstance(name, {
        url: opts.url,
        name,
        kind: 'bookmark',
        mode,
        defaultIdentity: opts.as,
      })
      log.success(`Bookmarked "${name}" → ${entry.url}`)
      if (opts.as) log.dim(`  default identity: ${opts.as}`)
      if (opts.use) {
        await setActive(name)
        log.success(`Active instance: ${name}`)
      }
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
