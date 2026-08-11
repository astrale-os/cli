import type { CommandDefinition } from '../../program/index'

import { fetchWithCaFile } from '../../lib/ca-fetch'
import { normalizeInstanceKernelUrl, setActive, upsertInstance } from '../../lib/instance'
import { fatal, log } from '../../lib/log'
import { checkIssuerReachability } from '../../lib/meta'

export default {
  name: 'bookmark',
  description: 'Register a reference to an existing remote instance',
  arguments: [{ name: 'name', description: 'Bookmark name (free, required)', required: true }],
  options: [
    { flags: '--url <url>', description: 'URL of the remote instance (required)' },
    { flags: '--issuer <url>', description: 'Kernel issuer/audience if different from URL' },
    { flags: '--ca <path>', description: 'CA certificate file to trust for this bookmark' },
    {
      flags: '--as <identity>',
      description: 'Default identity for this bookmark',
    },
    { flags: '--use', description: 'Set as active instance after bookmarking' },
    { flags: '--skip-probe', description: 'Skip the OIDC + JWKS liveness probe (still recorded)' },
  ],
  action: async (
    name: string,
    opts: {
      url?: string
      issuer?: string
      ca?: string
      as?: string
      use?: boolean
      skipProbe?: boolean
    },
  ) => {
    try {
      if (!opts.url) fatal(new Error('Missing required flag: --url <url>'))
      const url = normalizeInstanceKernelUrl(opts.url)
      const expectedIssuer = opts.issuer ? normalizeInstanceKernelUrl(opts.issuer) : undefined

      if (!opts.skipProbe) {
        try {
          const { issuer, keys } = await checkIssuerReachability(
            url,
            expectedIssuer,
            opts.ca ? fetchWithCaFile(opts.ca) : undefined,
          )
          log.dim(`  iss=${issuer} keys=${keys.length}`)
        } catch (e) {
          log.dim('  (re-run with --skip-probe to bookmark anyway.)')
          fatal(e)
        }
      }

      const { entry, created } = await upsertInstance(name, {
        url,
        issuer: expectedIssuer,
        caFile: opts.ca,
        name,
        kind: 'bookmark',
        mode: 'remote',
        defaultIdentity: opts.as,
      })
      log.success(`${created ? 'Bookmarked' : 'Updated bookmark'} "${name}" → ${entry.url}`)
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
