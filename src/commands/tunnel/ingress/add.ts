import type { CommandDefinition } from '../../../command'

import { fatal, log } from '../../../lib/log'
import { addIngressRule } from '../../../lib/tunnels'
import { validateUrl } from '../../../lib/validation'

export default {
  name: 'add',
  description: 'Append an ingress rule to a tunnel (hostname → local service URL)',
  afterHelpText: `
Behavior:
  Appends a new ingress rule to the named tunnel in ~/.astrale/tunnels.json.
  The rule is picked up next time the tunnel starts. Order matters in
  cloudflared (top-to-bottom match) — specific routes before wildcards.

  SIGHUP live reload is not wired yet: run \`tunnel stop && tunnel start\`
  for the new rule to take effect on a running tunnel.

Examples:
  $ astrale tunnel ingress add my-tunnel --hostname foo.example.com --service http://localhost:8080
  $ astrale tunnel ingress add my-tunnel --hostname '*.fn.foo.example.com' --service http://localhost:8787
`,
  arguments: [{ name: 'tunnel', description: 'Tunnel name or id', required: true }],
  options: [
    {
      flags: '--hostname <host>',
      description: 'Public hostname (wildcards like `*.foo.bar` allowed)',
    },
    { flags: '--service <url>', description: 'Local service URL (http://localhost:NNNN)' },
    {
      flags: '--path <pattern>',
      description: 'Optional path pattern to match (cloudflared regex)',
    },
  ],
  action: async (tunnel: string, opts: { hostname?: string; service?: string; path?: string }) => {
    try {
      if (!opts.hostname) fatal(new Error('--hostname is required'))
      if (!opts.service) fatal(new Error('--service is required'))
      validateUrl(opts.service!)
      const { entry, duplicate } = await addIngressRule(tunnel, {
        hostname: opts.hostname!,
        service: opts.service!,
        ...(opts.path ? { path: opts.path } : {}),
      })
      if (duplicate) {
        log.warn(`Ingress already exists: ${opts.hostname} → ${opts.service} — no change`)
        return
      }
      log.success(`Added ingress: ${opts.hostname} → ${opts.service}`)
      log.dim(
        `  Restart the tunnel to apply: astrale tunnel stop ${entry.name} && astrale tunnel start ${entry.name}`,
      )
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
