import type { CommandDefinition } from '../../command'

import { ADAPTER_NAME, resolveTunnelAdapter } from '../../adapters/tunnel'
import { TunnelNotConfiguredError } from '../../errors'
import { fatal, log } from '../../lib/log'
import { addIngressHint, addTunnel } from '../../lib/tunnels'
import { validateUrl } from '../../lib/validation'

export default {
  name: 'setup',
  description: 'Configure TunnelAdapter + DNS preflight',
  afterHelpText: `
Behavior:
  Creates a fresh tunnel and registers it. A tunnel exposes a local
  port on the public Internet — only bind instances serving intended
  content. DNS preflight must resolve.

Examples:
  $ astrale tunnel setup prod --hostname my.host.tld --service http://localhost:8811 --route-dns
  $ astrale tunnel setup dev  --hostname dev.local.astrale.ai  # no service yet — add later
`,
  arguments: [{ name: 'name', description: 'Tunnel name (local identifier)', required: true }],
  options: [
    {
      flags: '--hostname <host>',
      description: 'Public hostname (default: <name>.local.astrale.ai)',
    },
    {
      flags: '--service <url>',
      description:
        'Local service URL to route the public hostname to (e.g. http://localhost:8811). Without this, the tunnel runs but returns 404 — add routes later via `astrale tunnel ingress add`.',
    },
    { flags: '--route-dns', description: 'Auto-register DNS for the hostname after create' },
    { flags: '--skip-preflight', description: 'Skip DNS preflight (allow unresolved hostname)' },
    { flags: '--adapter <id>', description: 'Tunnel adapter (default: cloudflared)' },
  ],
  action: async (
    name: string,
    opts: {
      hostname?: string
      service?: string
      routeDns?: boolean
      skipPreflight?: boolean
      adapter?: string
    },
  ) => {
    try {
      const adapterId = opts.adapter ?? ADAPTER_NAME
      const adapter = resolveTunnelAdapter(adapterId)
      if (!(await adapter.isAvailable())) {
        if (adapterId === 'cloudflared') {
          log.dim(
            '  install: `brew install cloudflared` (macOS) or https://github.com/cloudflare/cloudflared',
          )
        }
        fatal(new TunnelNotConfiguredError())
      }

      const hostname = opts.hostname ?? `${name}.local.astrale.ai`
      if (opts.service) validateUrl(opts.service)

      log.warn('  Public exposure: a tunnel exposes a local port on the Internet.')
      log.dim('  Ensure the bound instance only serves content you intend to publish.')

      const desc = await adapter.create({ name, hostname, routeDns: opts.routeDns })
      const ingress = opts.service ? [{ hostname, service: opts.service }] : []
      await addTunnel({
        id: desc.id,
        name: desc.name,
        adapter: desc.adapter,
        hostname,
        createdAt: new Date().toISOString(),
        ingress,
      })
      log.success(`Created tunnel "${name}" (id=${desc.id})`)
      log.dim(`  hostname: ${hostname}`)
      if (opts.service) {
        log.dim(`  routes to: ${opts.service}`)
      } else {
        log.warn(
          `  No --service mapped — tunnel will return 404 on every request until you add routes via \`${addIngressHint(name)}\`.`,
        )
      }
      if (!opts.routeDns) {
        log.dim(`  Next: register DNS for ${hostname}, or re-run with --route-dns.`)
      }

      if (!opts.skipPreflight) {
        try {
          await adapter.dnsPreflight(hostname)
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
