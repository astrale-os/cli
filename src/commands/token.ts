import { issuer, type AuthApi, type IssuerId, type MintedCredential } from '@astrale-os/sdk/auth'

import type { KernelCommandOpts } from '../connection'
import type { CommandDefinition } from '../program/index'

import { runKernelCommand } from '../connection'
import { AstraleError } from '../errors'
import { decodeJwtExpiration } from '../lib/local-status'
import { failInput, log } from '../lib/log'
import { output } from '../lib/output'

/**
 * `astrale token` — mint a fresh audience-bound token for the active instance
 * and selected identity through the bound AuthApi.
 */
export type TokenOpts = KernelCommandOpts & {
  audience?: string
  ttl?: string
  // `--for <identity>` is an alias of `--as` (reads better at mint-time).
  // Promoted into opts.as before the credential resolver runs.
  for?: string
}

const DEFAULT_TOKEN_TTL_SECONDS = 4 * 60

export async function tokenCommand(opts: TokenOpts): Promise<void> {
  const commandOpts: TokenOpts = opts.for && !opts.as ? { ...opts, as: opts.for } : opts
  let ttl: number
  try {
    ttl = parseTtl(commandOpts.ttl)
  } catch (error) {
    failInput(error, opts)
  }
  await runKernelCommand<string>({
    opts: commandOpts,
    label: 'Minting token',
    fn: async (ctx) => {
      const audience =
        commandOpts.audience === undefined
          ? ctx.target.kernelIssuer
          : issuer.accept(commandOpts.audience)
      return issueToken(ctx.auth, ctx.target.kernelIssuer, audience, ttl)
    },
    format: (token, fmtOpts) => {
      if (fmtOpts.json || fmtOpts.format !== undefined) {
        output({ token, expiresAt: decodeJwtExpiration(token)?.expiresAt ?? null }, fmtOpts)
        return
      }
      if (!fmtOpts.raw && (process.stdout.isTTY ?? false)) {
        log.dim('  (audience-bound token — ES256, self-identity)')
      }
      process.stdout.write(`${token}\n`)
    },
  })
}

/** Issue either a top-level Kernel credential or an external-audience delegation. */
export async function issueToken(
  auth: Pick<AuthApi, 'delegate' | 'mint' | 'whoami'>,
  kernel: IssuerId,
  audience: IssuerId,
  ttlSeconds: number,
): Promise<MintedCredential> {
  if (audience === kernel) return auth.mint({ ttlSeconds })
  const self = await auth.whoami()
  return auth.delegate(self.id, {
    audience,
    ttlSeconds,
    attenuation: { kind: 'identity', self: true },
  })
}

export function parseTtl(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TOKEN_TTL_SECONDS
  if (!/^\d+$/.test(raw)) {
    throw new AstraleError(
      'INVALID_FLAG',
      `Invalid --ttl value "${raw}" — expected a positive integer (seconds)`,
    )
  }
  const value = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AstraleError(
      'INVALID_FLAG',
      `Invalid --ttl value "${raw}" — must be a positive integer`,
    )
  }
  return value
}

export default {
  name: 'token',
  description: 'Mint a fresh audience-bound credential for the active instance + identity',
  afterHelpText: `
Behavior:
  Mints a token for the selected authenticated identity for 240 seconds by default.
  The default Kernel audience produces a top-level Grant credential reusable with
  --creds. A different --audience produces a delegated service envelope. --for is
  an alias of --as.

  Every receiver must admit the exact token audience. A service-audience token can
  be sent as a Bearer token only to that service's authenticated endpoint. The
  requested lifetime cannot exceed the selected source credential's remaining life.

Examples:
  $ export TOKEN=$(astrale token --audience shell.astrale.ai --raw)
  $ astrale token --json -i staging
  $ astrale token --audience worker.example.com --for alice -i staging
`,
  options: [
    {
      flags: '--audience <aud>',
      description: 'Token audience (default: target Kernel issuer)',
    },
    { flags: '--ttl <sec>', description: 'TTL in seconds (default: 240)' },
    { flags: '--for <identity>', description: 'Mint the token for this identity (alias of --as)' },
  ],
  action: async (opts) => {
    await tokenCommand(opts as Parameters<typeof tokenCommand>[0])
  },
} satisfies CommandDefinition
