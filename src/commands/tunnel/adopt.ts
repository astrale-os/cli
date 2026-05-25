import type { CommandDefinition } from '../../command'

import { ADAPTER_NAME, resolveTunnelAdapter } from '../../adapters/tunnel'
import { fatal, log } from '../../lib/log'
import { addIngressHint, addTunnel, readTunnels } from '../../lib/tunnels'

export default {
  name: 'adopt',
  description: 'Register an existing tunnel (created outside the CLI) in the astrale registry',
  afterHelpText: `
Behavior:
  Imports the tunnel's existing http(s) ingress rules into the astrale
  registry. After adoption, ~/.astrale/tunnels.json is the source of
  truth — mutate it via \`astrale tunnel ingress add\`. Tunnels with
  non-http(s) routes (tcp/ssh/…) or per-rule provider options are
  refused: astrale only manages http(s) hostname→service routing.

Examples:
  $ astrale tunnel adopt my-existing-tunnel
  $ astrale tunnel adopt my-existing-tunnel --hostname my.public.host
`,
  arguments: [{ name: 'name', description: 'Existing tunnel name', required: true }],
  options: [
    {
      flags: '--hostname <host>',
      description:
        'Primary hostname for the registry. Inferred from the imported ingress when omitted.',
    },
    { flags: '--adapter <id>', description: 'Tunnel adapter (default: cloudflared)' },
  ],
  action: async (name: string, opts: { hostname?: string; adapter?: string }) => {
    try {
      const adapter = resolveTunnelAdapter(opts.adapter ?? ADAPTER_NAME)
      if (!(await adapter.isAvailable())) {
        fatal(new Error(`Tunnel adapter "${adapter.name}" is not available on this machine.`))
      }

      const existing = await readTunnels()
      if (existing.tunnels[name]) {
        fatal(
          new Error(
            `Tunnel "${name}" is already registered with astrale. Use \`astrale tunnel list\` to inspect.`,
          ),
        )
      }

      // importExisting throws TunnelUnsupportedConfigError on non-http(s) /
      // originRequest routes — astrale refuses partial imports.
      const { descriptor, ingress, suggestedHostname } = await adapter.importExisting(name)

      const hostname = opts.hostname ?? suggestedHostname
      if (!hostname) {
        fatal(
          new Error(
            ingress.length === 0
              ? `Cannot infer hostname: imported tunnel has no http(s) ingress. Pass --hostname <host>.`
              : `Imported ingress has only wildcard hostnames. Pass --hostname <host> for the registry's primary hostname.`,
          ),
        )
      }

      await addTunnel({
        id: descriptor.id,
        name: descriptor.name,
        adapter: descriptor.adapter,
        hostname,
        createdAt: new Date().toISOString(),
        ingress,
      })

      log.success(`Adopted tunnel "${name}" (id=${descriptor.id})`)
      log.dim(`  hostname: ${hostname}`)
      if (ingress.length > 0) {
        log.dim(`  ingress: ${ingress.length} rule(s) imported`)
      } else {
        log.dim(`  no ingress imported — run \`${addIngressHint(name)}\``)
      }
      log.dim(`  Next: astrale tunnel start ${name}`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
