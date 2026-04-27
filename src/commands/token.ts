import type { KernelCommandOpts } from '../kernel'

import { runKernelCommand } from '../kernel'
import { log } from '../lib/log'

/**
 * `astrale token` — mint a fresh delegation token for the active instance
 * + active identity (§9). Shortcut over the mintDelegationCredential call.
 */
export type TokenOpts = KernelCommandOpts & {
  audience?: string
  ttl?: string
  // `--for <identity>` is an alias of `--as` (reads better at mint-time).
  // Promoted into opts.as before the credential resolver runs.
  for?: string
}

export async function tokenCommand(opts: TokenOpts): Promise<void> {
  if (opts.for && !opts.as) opts.as = opts.for
  await runKernelCommand<string>({
    opts,
    label: 'Minting delegation token',
    fn: async (ctx) => {
      const audience = opts.audience ?? ''
      const parsedTtl = Number(opts.ttl)
      const ttl = Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : 3600
      const result = (await ctx.client.call(
        '@__system__::mintDelegationCredential',
        {
          audience,
          delegation: { kind: 'identity', self: true },
          ttl,
        },
      )) as string
      return result
    },
    format: (token, fmtOpts, isRaw) => {
      if (isRaw) {
        process.stdout.write(token + '\n')
        return
      }
      log.dim('  (delegation token — ES256, self-identity)')
      process.stdout.write(`${token}\n`)
    },
  })
}
