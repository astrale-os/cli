/**
 * Acquire bearer tokens for a harness model gateway.
 *
 * - mint: shell out to `astrale token` and cache the short-lived delegation
 * - token: use the manually configured bearer
 * - host: consume a token relayed by the embedding Astrale application
 *
 * Tokens only flow into the spawned harness child environment.
 */
import type { HarnessGatewayConfig } from '../../../../shared/types'

const MINT_TTL_SECONDS = 3600
const REFRESH_SKEW_MS = 5 * 60_000

interface CachedToken {
  token: string
  expiresAtMs: number
}

const mintCache = new Map<string, CachedToken>()
const hostTokens = new Map<string, CachedToken>()

export class HarnessTokenError extends Error {
  constructor(
    message: string,
    readonly kind: 'mint-failed' | 'host-token-needed' | 'config',
  ) {
    super(message)
    this.name = 'HarnessTokenError'
  }
}

function jwtExpiration(jwt: string): number | undefined {
  try {
    const payload = Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')
    const expiration = JSON.parse(payload)?.exp
    return typeof expiration === 'number' ? expiration * 1000 : undefined
  } catch {
    return undefined
  }
}

async function astraleText(args: string[], timeoutMs = 12_000): Promise<string | null> {
  try {
    const proc = Bun.spawn(['astrale', ...args], { stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        /* already exited */
      }
    }, timeoutMs)
    try {
      const output = await new Response(proc.stdout).text()
      const code = await proc.exited
      return code === 0 ? output.trim() || null : null
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

async function mintToken(audience: string, instance?: string): Promise<string> {
  const key = `${audience}\u0000${instance ?? ''}`
  const cached = mintCache.get(key)
  if (cached && cached.expiresAtMs - Date.now() > REFRESH_SKEW_MS) return cached.token

  const args = ['token', '--audience', audience, '--ttl', String(MINT_TTL_SECONDS), '--raw']
  if (instance) args.push('-i', instance)
  const token = await astraleText(args)
  if (!token || token.split('.').length !== 3)
    throw new HarnessTokenError(
      'could not mint a delegation token — is the instance reachable and are you signed in? (try `astrale login` / `astrale use <instance>`)',
      'mint-failed',
    )
  mintCache.set(key, {
    token,
    expiresAtMs: jwtExpiration(token) ?? Date.now() + MINT_TTL_SECONDS * 1000,
  })
  return token
}

/** Relay a host-owned delegation token into the embedded Studio process. */
export function setHostToken(audience: string, token: string): boolean {
  if (!audience || !token || token.split('.').length !== 3) return false
  hostTokens.set(audience, {
    token,
    expiresAtMs: jwtExpiration(token) ?? Date.now() + MINT_TTL_SECONDS * 1000,
  })
  return true
}

function readHostToken(audience: string): string {
  const cached = hostTokens.get(audience)
  if (!cached || cached.expiresAtMs - Date.now() <= 0)
    throw new HarnessTokenError(
      'no valid host-supplied token — the embedding Astrale app must provide one',
      'host-token-needed',
    )
  return cached.token
}

/** Acquire the configured gateway bearer for one child-process invocation. */
export async function acquireGatewayToken(
  config: HarnessGatewayConfig,
  audience: string,
): Promise<string> {
  switch (config.auth.mode) {
    case 'token':
      if (!config.auth.token) throw new HarnessTokenError('no token set for this gateway', 'config')
      return config.auth.token
    case 'host':
      return readHostToken(audience)
    default:
      return mintToken(audience, config.auth.instance)
  }
}
