/**
 * Acquire bearer tokens for a harness model gateway.
 *
 * - mint: shell out to `astrale token`, cache the short-lived delegation, and
 *   coalesce concurrent requests for the same audience/instance
 * - token: use the manually configured bearer
 * - host: the embedding Astrale application owns the bearer; nothing relays one into
 *   Studio, so this mode fails closed instead of falling back to ambient credentials
 *
 * Tokens only flow into the spawned harness child environment.
 */
import type { HarnessGatewayConfig } from '../../../../shared/contracts/agent'

import { captureCommand, type CapturedCommand, type CaptureOptions } from '../process'

const MINT_TTL_SECONDS = 4 * 60
const MINT_TTL_MS = MINT_TTL_SECONDS * 1000
const REFRESH_SKEW_MS = 60_000

interface CachedToken {
  token: string
  expiresAtMs: number
}

type CaptureHarnessCommand = (
  bin: string,
  args: string[],
  cwd: string,
  options?: CaptureOptions,
) => Promise<CapturedCommand>

interface HarnessTokenBrokerOptions {
  capture?: CaptureHarnessCommand
  now?: () => number
}

export class HarnessTokenError extends Error {
  constructor(
    message: string,
    readonly kind: 'mint-failed' | 'host-token-needed' | 'config',
  ) {
    super(message)
    this.name = 'HarnessTokenError'
  }
}

function jwtClaims(jwt: string): { audience?: string | string[]; expiresAtMs?: number } | null {
  try {
    const payload = Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')
    const claims = JSON.parse(payload)
    return {
      audience:
        typeof claims?.aud === 'string' ||
        (Array.isArray(claims?.aud) &&
          claims.aud.every((item: unknown) => typeof item === 'string'))
          ? claims.aud
          : undefined,
      expiresAtMs: typeof claims?.exp === 'number' ? claims.exp * 1000 : undefined,
    }
  } catch {
    return null
  }
}

function audienceMatches(actual: string | string[] | undefined, expected: string): boolean {
  return actual === expected || (Array.isArray(actual) && actual.includes(expected))
}

export class HarnessTokenBroker {
  private readonly mintCache = new Map<string, CachedToken>()
  private readonly inFlightMints = new Map<string, Promise<string>>()
  private readonly capture: CaptureHarnessCommand
  private readonly now: () => number

  constructor(options: HarnessTokenBrokerOptions = {}) {
    this.capture = options.capture ?? captureCommand
    this.now = options.now ?? Date.now
  }

  /** Acquire the configured gateway bearer for one child-process invocation. */
  async acquireGatewayToken(config: HarnessGatewayConfig, audience: string): Promise<string> {
    switch (config.auth.mode) {
      case 'token': {
        const token = config.auth.token.trim()
        if (!token) throw new HarnessTokenError('no token set for this gateway', 'config')
        return token
      }
      case 'host':
        throw new HarnessTokenError(
          'no valid host-supplied token — the embedding Astrale app must provide one',
          'host-token-needed',
        )
      default:
        return this.mintToken(audience, config.auth.instance)
    }
  }

  private mintToken(audience: string, instance?: string): Promise<string> {
    const key = `${audience}\u0000${instance ?? ''}`
    const cached = this.mintCache.get(key)
    if (cached && cached.expiresAtMs - this.now() > REFRESH_SKEW_MS)
      return Promise.resolve(cached.token)

    const pending = this.inFlightMints.get(key)
    if (pending) return pending

    let mint!: Promise<string>
    mint = this.mintAndCache(key, audience, instance).finally(() => {
      if (this.inFlightMints.get(key) === mint) this.inFlightMints.delete(key)
    })
    this.inFlightMints.set(key, mint)
    return mint
  }

  private async mintAndCache(key: string, audience: string, instance?: string): Promise<string> {
    const args = ['token', '--audience', audience, '--ttl', String(MINT_TTL_SECONDS), '--raw']
    if (instance) args.push('-i', instance)
    const result = await this.capture('astrale', args, process.cwd(), { timeoutMs: 12_000 })
    const token = result.code === 0 ? result.stdout.trim() : ''
    const claims = token && token.split('.').length === 3 ? jwtClaims(token) : null
    if (
      !claims ||
      !audienceMatches(claims.audience, audience) ||
      (claims.expiresAtMs !== undefined && claims.expiresAtMs <= this.now())
    )
      throw new HarnessTokenError(
        'could not mint a delegation token — is the instance reachable and are you signed in? (try `astrale auth login` / `astrale instance use <instance>`)',
        'mint-failed',
      )
    this.mintCache.set(key, {
      token,
      expiresAtMs: claims.expiresAtMs ?? this.now() + MINT_TTL_MS,
    })
    return token
  }
}

const defaultBroker = new HarnessTokenBroker()

export function acquireGatewayToken(
  config: HarnessGatewayConfig,
  audience: string,
): Promise<string> {
  return defaultBroker.acquireGatewayToken(config, audience)
}
