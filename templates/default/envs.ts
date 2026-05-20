/**
 * Per-domain env presets for the astrale-domain scaffold.
 *
 * Pick one via `ASTRALE_DOMAIN_DOMAIN=<preset>`. Consumers derive `iss` / `url`
 * from `(domain, port)` at runtime via `@astrale-os/kernel-host`'s
 * `schemeOf`, `hostOf`, `domainUrl` helpers. See the `astrale-domain-dev`
 * skill for the full identity model.
 *
 * The `prod` preset points at `astrale-domain.test.astrale.ai` on purpose — the
 * shared `*.test.astrale.ai` zone is the scaffold's default deploy target
 * (see deploy.md → "Shipping to the shared `*.test.astrale.ai` zone").
 * Flip to your real prod slug when the domain is ready to ship to users.
 */

import type { DomainEnv } from '@astrale-os/kernel-host'

import { readIntEnv, readStringEnv } from '@astrale-os/kernel-host'

/**
 * Port where the local wrangler dev worker listens. Default 8801.
 *
 * Picked off 8787 so a freshly-scaffolded domain doesn't collide with
 * `distribution` (the canonical in-tree domain that owns 8787) on a
 * developer machine running both. Override per-shell via `DOMAIN_PORT=…`
 * if 8801 is also taken in your setup.
 */
export function readDomainPort(): number {
  return readIntEnv('DOMAIN_PORT', 8801)
}

/** Cloudflare tunnel ID fronting the local worker (for `:tunneled`). */
export function readTunnelId(): string {
  return readStringEnv('ASTRALE_DOMAIN_TUNNEL_ID')
}

export const domainEnvs = {
  /**
   * All-local, no tunnel. slug = `astrale-domain.localhost` (reserved TLD per RFC 6761),
   * url = `http://astrale-domain.localhost:PORT`. Matches the shape the fixture uses
   * when tests pick `local:inprocess`.
   */
  'local:inprocess': (): DomainEnv => ({
    domain: 'astrale-domain.localhost',
    port: readDomainPort(),
  }),
  /** Local + tunnel HTTPS (tests against worker deployed or `wrangler dev --remote`). */
  'local:tunneled': (): DomainEnv => ({
    domain: `astrale-domain.local-${readTunnelId()}.astrale.ai`,
  }),
  /**
   * Shared test-prod on Cloudflare (astrale.ai zone). `astrale domain deploy
   * --preset prod` ships here. Flip the slug to your real prod hostname when
   * you graduate the domain out of the scaffold.
   */
  prod: (): DomainEnv => ({
    domain: 'astrale-domain.test.astrale.ai',
  }),
} satisfies Record<string, () => DomainEnv>

export type DomainEnvName = keyof typeof domainEnvs
