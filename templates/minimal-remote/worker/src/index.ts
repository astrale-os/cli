/**
 * Minimal remote worker.
 *
 * Serves the `minimalRemoteDomain` (schema + stub handlers) behind
 * `createRemoteServer` and exports the default fetch handler. `/meta` is
 * auto-mounted by the SDK — never route it yourself. See the
 * astrale-domain-dev skill (references/deploy.md) for the `/meta` contract
 * and deploy flow.
 *
 * Views live under `/ui/*`: the worker delegates to the Workers Assets
 * binding (serving the Vite build of `../client/`). In dev, setting
 * `VIEW_DEV_URL` in `.dev.vars` forwards to `vite dev` for React HMR.
 *
 * The production wiring is `../../domain.ts` (the RemoteDomain consumed by
 * `build-spec.ts` and installed into the kernel). Swap the stubs with real
 * handlers here (or build a worker-local `defineRemoteDomain<Env>()` with
 * Env-typed methods like `distribution/worker/src/index.ts`) once this
 * domain does more than /meta smoke.
 */
import { createRemoteServer } from '@astrale-os/sdk/server'

import type { Env } from './env.ts'

import { minimalRemoteDomain } from '../../domain.ts'
import { PRIVATE_JWK } from './keys.ts'

// Build-time defines (injected by `wrangler deploy --define` in prod;
// absent under `wrangler dev`).
declare const SDK_COMMIT: string | undefined
declare const SCHEMA_HASH: string | undefined

let cachedUrl: string | null = null
let cachedApp: { fetch: (req: Request) => Response | Promise<Response> } | null = null

function getApp(env: Env) {
  const workerUrl = env.WORKER_URL
  const baseDomain = env.MINIMAL_BASE_DOMAIN ?? 'minimal.test.astrale.ai'
  if (cachedApp && cachedUrl === workerUrl) return cachedApp

  const sdkCommit = typeof SDK_COMMIT === 'string' ? SDK_COMMIT : undefined
  const schemaHash = typeof SCHEMA_HASH === 'string' ? SCHEMA_HASH : undefined
  const { app } = createRemoteServer({
    domain: minimalRemoteDomain,
    deps: env,
    url: workerUrl,
    issuer: baseDomain,
    privateKey: PRIVATE_JWK,
    meta: {
      ...(sdkCommit ? { sdkCommit } : {}),
      ...(schemaHash ? { schemaHash } : {}),
      domainName: 'minimal-remote',
    },
  })

  cachedUrl = workerUrl
  cachedApp = app
  return app
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Views live under `/ui/*`. See `client/README.md` for the dev loops.
    //   - Default: Workers Assets serves the Vite build from `../dist-client/`.
    //     Vite emits asset refs with `base: '/ui/'`; we strip `/ui` before
    //     delegating so the files resolve from the assets root. SPA fallback
    //     returns `index.html` for unmatched deep URLs (TanStack Router
    //     takes over client-side).
    //   - HMR: if `env.VIEW_DEV_URL` is set (`.dev.vars` override), forward
    //     `/ui/*` to `vite dev` for React fast-refresh.
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
