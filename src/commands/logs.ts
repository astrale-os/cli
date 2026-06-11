/**
 * `astrale logs <service>` — tail a managed service's runtime log buffer.
 *
 * The platform's user-workerd runtime wraps every service in a logging shim
 * (console output, 5xx accesses, uncaught exceptions — including the
 * "internal error; reference = …" class of failures). This command resolves
 * the service through the admin control plane (`Service.logs` → the box's
 * host-kernel `Service.logs`) and prints the last N lines.
 */
import chalk from 'chalk'

import type { CommandDefinition } from '../command'
import type { KernelCommandOpts } from '../kernel'

import { withAdminKernelClient } from '../kernel/client'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../lib/admin-target'
import { fatal, withSpinner } from '../lib/log'
import { isMachine, output, type RawOutputOpts } from '../lib/output'

const ADMIN_SERVICE = '/admin.astrale.ai/class.Service'

type LogsOpts = KernelCommandOpts & AdminTargetCommandOpts & RawOutputOpts & { tail?: string }

type ServiceLogs = {
  slug: string
  lines: Array<{ ts: number; level: string; line: string }>
}

/** Accept a bare slug, a `<slug>.svc.<region>.…` host, or the full https URL. */
function parseServiceRef(ref: string): string {
  let host = ref.trim()
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname
    } catch {
      // keep the raw value — the admin call will fail loud with the slug
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
  description: "Tail a managed service's logs (console output, 5xx accesses, uncaught exceptions)",
  arguments: [
    {
      name: 'service',
      description: 'Service slug or its .svc URL (the URL `pnpm prod` prints)',
      required: true,
    },
  ],
  options: [
    { flags: '--tail <n>', description: 'Lines to return (default 200, max 500)' },
    ...ADMIN_TARGET_OPTIONS,
  ],
  afterHelpText: `
The buffer is in-memory and per-runtime: it holds the most recent ~500 lines
and resets when the service runtime restarts. Services deployed before log
capture need one redeploy (\`pnpm prod\`) to provision their log token.

Examples:
  astrale logs gate-notes-01bac66d
  astrale logs https://gate-notes-01bac66d.svc.eu.astrale.ai --tail 50
`,
  action: async (service: string, opts: LogsOpts) => {
    try {
      const slug = parseServiceRef(service)
      const tail = opts.tail !== undefined ? Number(opts.tail) : undefined
      if (tail !== undefined && (!Number.isInteger(tail) || tail <= 0)) {
        throw new Error(`--tail needs a positive integer, got "${opts.tail}"`)
      }
      const result = await withSpinner(`Fetching logs for ${slug}`, !isMachine(opts), () =>
        withAdminKernelClient(
          opts,
          async (ctx) =>
            (await ctx.client.call(`${ADMIN_SERVICE}/logs`, {
              slug,
              ...(tail !== undefined ? { tail } : {}),
            })) as ServiceLogs,
        ),
      )
      if (isMachine(opts)) {
        output(result, opts)
        return
      }
      if (result.lines.length === 0) {
        console.log(chalk.dim(`no log lines captured yet for ${result.slug}`))
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
