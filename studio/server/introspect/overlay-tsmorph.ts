/**
 * Compatibility facade for the ts-morph source overlay.
 *
 * Keep this path stable for the overlay composer and focused tests. The
 * implementation lives under source-overlay, split by responsibility.
 */
export { buildHandlerLinks } from './source-overlay/handlers'
export { buildSourceSpans } from './source-overlay/spans'
