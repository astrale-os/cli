import type { CommandDefinition } from '../../command'

import { resolveDomainPlatform } from '../../adapters/domain-platform'
import { fatal } from '../../lib/log'

type Opts = {
  kernel: string
  domain: string
  instance?: string
  cwd?: string
  platform?: string
}

export default {
  name: 'instance-prepare',
  description: 'Manager-mode bootstrap: rebuild spec, create child instance, install domain, mint delegation token',
  options: [
    { flags: '--kernel <name>', description: 'Kernel preset (e.g. local:manager:inprocess)' },
    { flags: '--domain <name>', description: 'Domain preset (e.g. local:inprocess)' },
    { flags: '--instance <id>', description: 'Child instance id (default: test)' },
    { flags: '--cwd <path>', description: 'Domain directory (default: current working directory)' },
    {
      flags: '--platform <id>',
      description: 'DomainPlatform adapter id (default: cloudflare)',
      default: 'cloudflare',
    },
  ],
  action: async (opts: Opts) => {
    try {
      if (!opts.kernel || !opts.domain) {
        throw new Error('both --kernel and --domain are required')
      }
      const platform = resolveDomainPlatform(opts.platform)
      const r = await platform.instancePrepare({
        domainDir: opts.cwd ?? process.cwd(),
        kernel: opts.kernel,
        domain: opts.domain,
        instanceId: opts.instance,
      })
      // Shell-exportable env block on stdout — mirror the legacy script
      // so callers can `eval $(astrale domain instance-prepare ...)`.
      process.stdout.write(
        `INSTANCE=${r.instanceId}\n` +
          `DOMAIN=${r.domain}\n` +
          `DOMAIN_URL=${r.domainUrl}\n` +
          `WORKER_URL=${r.workerUrl}\n` +
          `CONTROL_URL=${r.controlUrl}\n` +
          `ISS=${r.iss}\n` +
          `PARENT=${r.parent ?? ''}\n` +
          `TOKEN=${r.token ?? ''}\n`,
      )
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
