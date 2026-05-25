/**
 * Minimal remote worker.
 *
 * Serves `astraleDomainDef` (schema + the real `createNote` impl authored in
 * `../../domain.ts`) behind `createRemoteServer` and exports the default fetch
 * handler. `/meta` is auto-mounted by the SDK — never route it yourself. See
 * the astrale-domain-dev skill (references/deploy.md) for the `/meta` contract
 * and deploy flow.
 *
 * No views: the minimal template ships no `View` (that needs the
 * `@astrale-os/distribution-domain` dependency), so there is no `/ui/*` surface
 * and no SPA. Switch to the `default` template when you need a View.
 *
 * Self-fetch JWKS interceptor mirrors default/distribution — Cloudflare Workers
 * can't self-fetch, so credential verification (which fetches the domain's own
 * JWKS) is short-circuited here.
 */
import { createRemoteServer, requireEnv } from '@astrale-os/sdk/server'

import type { Env } from './env.ts'

import { astraleDomainDef } from '../../domain.ts'
import { PRIVATE_JWK } from './keys.ts'

// Build-time defines (injected by `wrangler deploy --define` in prod;
// absent under `wrangler dev`).
declare const SDK_COMMIT: string | undefined
declare const SCHEMA_HASH: string | undefined

function derivePublicJwk(privateKey: JsonWebKey): Record<string, unknown> {
  const { d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, ...pub } = privateKey
  return pub
}

const publicJwk = derivePublicJwk(PRIVATE_JWK)
const jwksPayload = JSON.stringify({ keys: [publicJwk] })

type App = { fetch: (req: Request) => Response | Promise<Response> }
let cache: { url: string; issuer: string; app: App } | null = null

function getApp(env: Env): App {
  const url = env.WORKER_URL
  const baseDomain = requireEnv(
    env,
    'ASTRALE_DOMAIN_BASE_DOMAIN',
    'set in .dev.vars locally or as a worker secret in prod',
  )
  if (cache && cache.url === url && cache.issuer === baseDomain) return cache.app

  const sdkCommit = typeof SDK_COMMIT === 'string' ? SDK_COMMIT : undefined
  const schemaHash = typeof SCHEMA_HASH === 'string' ? SCHEMA_HASH : undefined
  const { app } = createRemoteServer({
    domain: astraleDomainDef,
    deps: env,
    url,
    issuer: baseDomain,
    privateKey: PRIVATE_JWK,
    meta: {
      ...(sdkCommit ? { sdkCommit } : {}),
      ...(schemaHash ? { schemaHash } : {}),
      domainName: 'astrale-domain',
    },
  })

  cache = { url, issuer: baseDomain, app }
  return app
}

const originalFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (cache) {
    const candidates = [
      `https://${cache.issuer}/.well-known/jwks.json`,
      `${cache.url}/.well-known/jwks.json`,
    ]
    if (candidates.includes(url)) {
      return new Response(jwksPayload, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }
  return originalFetch(input, init)
}) as typeof fetch

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const app = getApp(env)
    return app.fetch(request)
  },
}
