import type { KernelCommandOpts } from '../kernel'

import { runKernelCommand } from '../kernel'
import { log } from '../lib/log'
import { output } from '../lib/output'

/**
 * `astrale token` — mint a fresh delegation token for the active instance
 * + active identity (§9). Shortcut over the mintDelegationCredential call.
 */
export type TokenOpts = KernelCommandOpts & {
  audience?: string
  ttl?: string
}

export async function tokenCommand(opts: TokenOpts): Promise<void> {
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
        ctx.credential,
      )) as string
      return result
    },
    format: (token, fmtOpts, isRaw) => {
      if (isRaw) {
        output(token, fmtOpts)
        return
      }
      log.dim('  (delegation token — ES256, self-identity)')
      process.stdout.write(`${token}\n`)
    },
  })
}
