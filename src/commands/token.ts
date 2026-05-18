import type { CommandDefinition } from '../command'
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
      const result = (await ctx.client.call('@__system__::mintDelegationCredential', {
        audience,
        delegation: { kind: 'identity', self: true },
        ttl,
      })) as string
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

export default {
  name: 'token',
  description: 'Mint a fresh delegation token for the active instance + identity',
  afterHelpText: `
Behavior:
  Default ttl 3600s, audience empty. The result is a two-layer
  envelope: an outer JWT signed by the kernel system key
  (sub __system__) wrapping an inner ES256 delegation credential for
  the identity. The token aud must match the worker's expected
  audience or the worker rejects it. --for is an alias of --as.

Examples:
  $ export TOKEN=$(astrale token --audience dist.astrale.ai --raw)
  $ astrale token --audience worker.example.com --for alice -i staging
`,
  options: [
    { flags: '--audience <aud>', description: 'Token audience (defaults to empty)' },
    { flags: '--ttl <sec>', description: 'TTL in seconds (default: 3600)' },
    { flags: '--for <identity>', description: 'Mint the token for this identity (alias of --as)' },
  ],
  action: async (opts) => {
    await tokenCommand(opts as Parameters<typeof tokenCommand>[0])
  },
} satisfies CommandDefinition
