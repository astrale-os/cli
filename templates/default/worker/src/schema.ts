/**
 * Re-export `AstraleDomainSchema` as `WorkerSchema` so worker-local modules
 * can `import { WorkerSchema } from './schema'` without reaching back into
 * the domain root every time. Identical to `domains/notes/worker/src/schema.ts`.
 */
export { AstraleDomainSchema as WorkerSchema } from '../../schema/schema.ts'
