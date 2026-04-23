/**
 * Minimal remote worker.
 *
 * Serves the `minimalRemoteDomain` (schema + stub handlers) behind
 * `createRemoteServer` and exports the default fetch handler. `/meta` is
 * auto-mounted by the SDK — never route it yourself. See the
 * astrale-domain-dev skill (references/deploy.md) for the `/meta` contract
 * and deploy flow.
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
    const app = getApp(env)
    return app.fetch(request)
  },
}
