/**
 * `astrale logs <service>` — tail a deployed service's runtime log buffer.
 *
 * Service hosting moved OUT of the admin control plane into the per-instance
 * `services` domain (a separate bounded context). This command now resolves the
 * service through the TARGET INSTANCE's services domain (`Service.logs`), not
 * admin — pass `-i <instance>` (the instance the service is deployed on). The
 * `--services-origin` flag overrides the domain origin (default
 * `services.astrale.ai`).
 *
 * Requires the services domain installed on the target instance.
 */
import chalk from 'chalk'

import type { CommandDefinition } from '../command'
import type { KernelCommandOpts } from '../kernel'

import { withKernelClient } from '../kernel/client'
import { fatal, withSpinner } from '../lib/log'
import { isMachine, output, type RawOutputOpts } from '../lib/output'

const DEFAULT_SERVICES_ORIGIN = 'services.astrale.ai'

type LogsOpts = KernelCommandOpts & RawOutputOpts & { tail?: string; servicesOrigin?: string }

type ServiceLogs = {
  name: string
  lines: Array<{ ts: number; level: string; line: string }>
}

/** Accept a bare service name, a `<name>.…` host, or a full https URL → the service name. */
function parseServiceName(ref: string): string {
  let host = ref.trim()
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname
    } catch {
      // keep the raw value — the call will fail loud with the name
    }
  }
  return host.includes('.') ? (host.split('.')[0] ?? host) : host
}

const LEVEL_COLOR: Record<string, (s: string) => string> = {
  error: chalk.red,
  warn: chalk.yellow,
  access: chalk.cyan,
  debug: chalk.dim,
}

export default {
  name: 'logs',
  description: "Tail a deployed service's logs (console output, 5xx accesses, uncaught exceptions)",
  arguments: [
    {
      name: 'service',
      description: 'Service name (or its URL) deployed on the target instance',
      required: true,
    },
  ],
  options: [
    { flags: '--tail <n>', description: 'Lines to return (default 200, max 500)' },
    {
      flags: '--services-origin <origin>',
      description: `Services-domain origin on the instance (default ${DEFAULT_SERVICES_ORIGIN})`,
    },
  ],
  afterHelpText: `
Service logs are served by the instance's \`services\` domain (no longer admin).
Target the instance the service runs on with \`-i <instance>\`.

Examples:
  astrale logs my-notes -i staging
  astrale logs https://my-notes.example.dev -i staging --tail 50
`,
  action: async (service: string, opts: LogsOpts) => {
    try {
      const name = parseServiceName(service)
      const origin = opts.servicesOrigin ?? DEFAULT_SERVICES_ORIGIN
      const tail = opts.tail !== undefined ? Number(opts.tail) : undefined
      if (tail !== undefined && (!Number.isInteger(tail) || tail <= 0)) {
        throw new Error(`--tail needs a positive integer, got "${opts.tail}"`)
      }
      const result = await withSpinner(`Fetching logs for ${name}`, !isMachine(opts), () =>
        withKernelClient(
          opts,
          async (ctx) =>
            (await ctx.client.call(
              `/${origin}/services/${name}::logs`,
              tail !== undefined ? { tail } : {},
            )) as ServiceLogs,
        ),
      )
      if (isMachine(opts)) {
        output(result, opts)
        return
      }
      if (result.lines.length === 0) {
        console.log(chalk.dim(`no log lines captured yet for ${result.name}`))
        return
      }
      for (const entry of result.lines) {
        const ts = new Date(entry.ts).toISOString()
        const paint = LEVEL_COLOR[entry.level] ?? ((s: string) => s)
        console.log(`${chalk.dim(ts)} ${paint(entry.level.padEnd(6))} ${entry.line}`)
      }
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
