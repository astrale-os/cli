import type { CommandDefinition } from '../../command'

import { cloudflaredAdapter } from '../../adapters/tunnel-cloudflared'
import { TunnelNotConfiguredError } from '../../errors'
import { fatal, log } from '../../lib/log'
import { addTunnel } from '../../lib/tunnels'

export default {
  name: 'setup',
  description: 'Configure TunnelAdapter + DNS preflight (§12)',
  arguments: [{ name: 'name', description: 'Tunnel name (local identifier)', required: true }],
  options: [
    {
      flags: '--hostname <host>',
      description: 'Public hostname (default: <name>.local.astrale.ai)',
    },
    { flags: '--route-dns', description: 'Auto-run `cloudflared tunnel route dns` after create' },
    { flags: '--skip-preflight', description: 'Skip DNS preflight (allow unresolved hostname)' },
  ],
  action: async (
    name: string,
    opts: { hostname?: string; routeDns?: boolean; skipPreflight?: boolean },
  ) => {
    try {
      if (!(await cloudflaredAdapter.isAvailable())) {
        log.dim(
          '  install: `brew install cloudflared` (macOS) or https://github.com/cloudflare/cloudflared',
        )
        fatal(new TunnelNotConfiguredError())
      }

      const hostname = opts.hostname ?? `${name}.local.astrale.ai`

      log.warn('  Public exposure: a tunnel exposes a local port on the Internet.')
      log.dim('  Ensure the bound instance only serves content you intend to publish (§12).')

      const desc = await cloudflaredAdapter.create({ name, hostname })
      await addTunnel({
        id: desc.id,
        name: desc.name,
        adapter: desc.adapter,
        hostname,
        createdAt: new Date().toISOString(),
      })
      log.success(`Created tunnel "${name}" (id=${desc.id})`)
      log.dim(`  hostname: ${hostname}`)

      if (opts.routeDns) {
        log.info('Routing DNS via cloudflared (requires a zone owned in CF)…')
        const { runCloudflared } = await import('../../lib/cloudflared')
        const r = runCloudflared(['tunnel', 'route', 'dns', desc.id, hostname])
        if (r.status !== 0) {
          log.warn(`route dns failed: ${r.stderr || r.stdout}`)
        } else {
          log.success(`DNS route registered for ${hostname}`)
        }
      } else {
        log.dim(`  Next: cloudflared tunnel route dns ${desc.id} ${hostname}`)
      }

      if (!opts.skipPreflight) {
        try {
          await cloudflaredAdapter.dnsPreflight(hostname)
          log.success(`DNS preflight ok for ${hostname}`)
        } catch (e) {
          log.warn((e as Error).message)
          log.dim('  Record not live yet — re-run preflight later or use --skip-preflight.')
        }
      }
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
