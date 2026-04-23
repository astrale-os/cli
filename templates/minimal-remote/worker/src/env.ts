/**
 * Worker runtime env. `WORKER_URL` is stamped by `infra:prepare` (dev) or
 * `wrangler secret put` (prod) so `createRemoteServer` can publish JWKS at
 * the correct base URL. `MINIMAL_BASE_DOMAIN` is the logical slug used as
 * JWT iss/aud — matches `schema.domain`.
 */
export interface Env {
  WORKER_URL: string
  MINIMAL_BASE_DOMAIN?: string
}
