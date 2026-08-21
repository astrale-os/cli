/**
 * Compatibility facade for the contracts shared by Studio's Bun server and
 * React client.
 *
 * Semantic ownership lives in `contracts/` and `schema/identity.ts`. Existing
 * `@shared/types` consumers intentionally keep the same public surface while
 * new code may import its owning contract directly.
 */

export * from './schema/identity'
export * from './contracts/schema'
export * from './contracts/workspace'
export * from './contracts/agent'
export * from './contracts/runtime'
