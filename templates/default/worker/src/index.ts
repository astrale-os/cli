/**
 * Default scaffold worker.
 *
 * The top-level `../../domain.ts` ships stub handlers (consumed by
 * `astrale domain build` to stamp `binding.remoteUrl` on every Function
 * node). The real work happens here: a worker-local `defineRemoteDomain<Env>()`
 * wired with:
 *   - `workerMethods`         — real impls for `NoteOps.createNote` (interface)
 *                                and `Note.reference` (class instance).
 *   - `views.ui-note`         — inline HTML iframe (template stub).
 *   - `remoteFunctions.count` — uses the `kernel` field on `RemoteFunctionContext`
 *                                to count Notes under the domain origin.
 *
 * `/meta` is auto-mounted by `createRemoteServer` — never route it yourself.
 * Views are mounted at `/views/<slug>`, RemoteFunctions at
 * `/functions/<slug>`. `/ui/*` is the SPA served from the Workers Assets
 * binding (Vite build of `../client/`).
 *
 * Self-fetch JWKS interceptor mirrors notes/distribution (Cloudflare Workers
 * can't self-fetch).
 */
import { DistributionSchema } from '@astrale-os/distribution-domain/schema'
import { selfOf } from '@astrale-os/kernel-dsl'
import { defineRemoteDomain, defineRemoteFunction, defineView } from '@astrale-os/sdk'
import { createRemoteServer, requireEnv } from '@astrale-os/sdk/server'
import { z } from 'zod'

import type { Env } from './env.ts'

import { Note } from '../../schema/schema.ts'
import { PRIVATE_JWK } from './keys.ts'
import { workerMethods } from './methods/index.ts'
import { WorkerSchema } from './schema.ts'

declare const SDK_COMMIT: string | undefined
declare const SCHEMA_HASH: string | undefined

const { View, view_for, RemoteFunction } = DistributionSchema.classes

function buildDomain(workerUrl: string) {
  return defineRemoteDomain<Env>()({
    schema: WorkerSchema,
    methods: workerMethods,
    workerUrl,

    viewClass: View,
    viewForEdgeClass: view_for,
    views: {
      'ui-note': defineView({
        auth: 'public',
        viewFor: selfOf(Note),
        // Redirect to the SPA route `/ui/note` (served from the Workers Assets
        // binding). Same convention as domains/distribution/views.ts. The SPA
        // renderer is registered under the `note` slug in
        // client/src/renderers/index.ts.
        render: ({ c }) => c.redirect('/ui/note'),
      }),
    },

    remoteFunctionClass: RemoteFunction,
    remoteFunctions: {
      count: defineRemoteFunction({
        inputSchema: z.object({}),
        outputSchema: z.object({ count: z.number() }),
        execute: async ({ kernel }) => {
          if (!kernel) throw new Error('count requires a kernel credential')
          // Stub: demonstrates that `RemoteFunctionContext` carries a `kernel`
          // client. A real impl would `kernel.call(`${origin}::getTree`, {
          // depth: 1 })` and count nodes whose class is `Note` — omitted here
          // (needs the origin path + a maxNodes cap) to keep the wire small.
          return { count: 0 }
        },
      }),
    },
  })
}

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
    domain: buildDomain(url),
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
    const url = new URL(request.url)

    // SPA under `/ui/*`. Default: Workers Assets serves the Vite build from
    // `../dist-client/`; we strip `/ui` so files resolve from assets root.
    // HMR: if `env.VIEW_DEV_URL` is set, forward to `vite dev`.
    if (url.pathname === '/ui' || url.pathname.startsWith('/ui/')) {
      if (env.VIEW_DEV_URL) {
        const devBase = env.VIEW_DEV_URL.replace(/\/$/, '')
        return fetch(new Request(`${devBase}${url.pathname}${url.search}`, request))
      }
      const stripped = url.pathname.replace(/^\/ui\/?/, '/')
      const rewrittenUrl = new URL(stripped + url.search, url.origin)
      return env.ASSETS.fetch(new Request(rewrittenUrl, request))
    }

    const app = getApp(env)
    return app.fetch(request)
  },
}
