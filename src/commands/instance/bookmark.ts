import type { CommandDefinition } from '../../program/index'

import { fetchWithCaFile } from '../../lib/ca-fetch'
import {
  findBookmarkTrustConflicts,
  normalizeInstanceKernelUrl,
  readInstances,
  setActive,
  upsertInstance,
} from '../../lib/instance'
import { fatal, log } from '../../lib/log'
import { checkIssuerReachability } from '../../lib/meta'

export default {
  name: 'bookmark',
  description: 'Register a reference to an existing remote instance',
  arguments: [{ name: 'name', description: 'Bookmark name (free, required)', required: true }],
  options: [
    { flags: '--url <url>', description: 'URL of the remote instance (required)' },
    { flags: '--issuer <url>', description: 'Kernel issuer/audience if different from URL' },
    {
      flags: '--domain-issuer <url>',
      description: 'Product Domain issuer for standard token exchange',
    },
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
      domainIssuer?: string
      ca?: string
      as?: string
      use?: boolean
      skipProbe?: boolean
    },
  ) => {
    try {
      if (!opts.url) fatal(new Error('Missing required flag: --url <url>'))
      const url = normalizeInstanceKernelUrl(opts.url)
      const store = await readInstances()
      const expectedIssuer = opts.issuer
        ? normalizeInstanceKernelUrl(opts.issuer)
        : store.instances[name]?.issuer
      const effectiveCa = opts.ca ?? store.instances[name]?.caFile
      const trustConflicts = findBookmarkTrustConflicts(store, name, url, effectiveCa)
      if (trustConflicts.length > 0) {
        log.warn(
          `TLS trust differs for the same Kernel URL ${url}: ` +
            `"${name}" uses ${describeCa(effectiveCa)}, while ${trustConflicts
              .map((conflict) => `"${conflict.name}" uses ${describeCa(conflict.caFile)}`)
              .join(', ')}. Remove or update stale bookmarks to avoid certificate surprises.`,
        )
      }

      if (!opts.skipProbe) {
        try {
          const { issuer, keys } = await checkIssuerReachability(
            url,
            expectedIssuer,
            effectiveCa ? fetchWithCaFile(effectiveCa) : undefined,
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
        domainIssuer: opts.domainIssuer,
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

function describeCa(caFile: string | null | undefined): string {
  return caFile ? `CA ${caFile}` : 'the system trust store'
}
