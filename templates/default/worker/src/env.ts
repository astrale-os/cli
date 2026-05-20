/**
 * Worker runtime env. `WORKER_URL` is stamped by `infra:prepare` (dev) or
 * `wrangler secret put` (prod) so `createRemoteServer` can publish JWKS at
 * the correct base URL. `ASTRALE_DOMAIN_BASE_DOMAIN` is the logical slug used as
 * JWT iss/aud — matches `schema.domain`.
 */
export interface Env {
  WORKER_URL: string
  ASTRALE_DOMAIN_BASE_DOMAIN?: string
  /**
   * Local distribution origin. The imported `DistributionSchema` reads
   * `process.env.DISTRIBUTION_BASE_DOMAIN` at module load and throws if
   * unset. `astrale domain dev up` writes this into `.dev.vars` from
   * `lifecycle.ts > config.extraDevVars`.
   */
  DISTRIBUTION_BASE_DOMAIN?: string
  /**
   * Workers Assets binding (wrangler `assets:` config). Serves the
   * `../client/` Vite build output under `/ui/*`. See `src/index.ts`.
   */
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  /**
   * Optional dev-only override. When set (via `.dev.vars` during
   * `wrangler dev`), `/ui/*` requests are forwarded to this URL instead of
   * the baked-in `ASSETS` bundle — typically `http://127.0.0.1:5173`
   * running `vite dev` to get React HMR.
   */
  VIEW_DEV_URL?: string
}
