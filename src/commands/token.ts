import { issuer } from '@astrale-os/kernel-core/auth'

import type { KernelCommandOpts } from '../connection'
import type { CommandDefinition } from '../program/index'

import { runKernelCommand } from '../connection'
import { log } from '../lib/log'

/**
 * `astrale token` — mint a fresh delegation token for the active instance
 * + active identity through the bound AuthApi.
 */
export type TokenOpts = KernelCommandOpts & {
  audience?: string
  ttl?: string
  // `--for <identity>` is an alias of `--as` (reads better at mint-time).
  // Promoted into opts.as before the credential resolver runs.
  for?: string
}

export async function tokenCommand(opts: TokenOpts): Promise<void> {
  const commandOpts: TokenOpts = opts.for && !opts.as ? { ...opts, as: opts.for } : opts
  await runKernelCommand<string>({
    opts: commandOpts,
    label: 'Minting delegation token',
    fn: async (ctx) => {
      const audience =
        commandOpts.audience === undefined ? ctx.target.issuer : issuer.accept(commandOpts.audience)
      const parsedTtl = Number(commandOpts.ttl)
      const ttl = Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : 3600
      const self = await ctx.auth.whoami()
      return ctx.auth.delegate(self.id, {
        audience,
        ttlSeconds: ttl,
        delegation: { kind: 'identity', self: true },
      })
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
  Delegates the selected authenticated identity for 3600 seconds by default.
  The default audience is the target Kernel issuer; choose --audience when the
  credential is intended for another service. --for is an alias of --as.

  The receiver must admit the exact token audience. A Kernel-audience token can
  be reused with --creds; a service-audience token can be sent as a Bearer token
  to that service's authenticated endpoint.

Examples:
  $ export TOKEN=$(astrale token --audience shell.astrale.ai --raw)
  $ astrale token --audience worker.example.com --for alice -i staging
`,
  options: [
    {
      flags: '--audience <aud>',
      description: 'Token audience (default: target Kernel issuer)',
    },
    { flags: '--ttl <sec>', description: 'TTL in seconds (default: 3600)' },
    { flags: '--for <identity>', description: 'Mint the token for this identity (alias of --as)' },
  ],
  action: async (opts) => {
    await tokenCommand(opts as Parameters<typeof tokenCommand>[0])
  },
} satisfies CommandDefinition
