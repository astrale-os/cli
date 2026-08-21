import { createHash } from 'node:crypto'

/** Deterministic JSON with stable key order — so cosmetic edits/reordering don't churn the hash. */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const out: Record<string, any> = {}
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k])
    return out
  }
  return v
}

/**
 * Short, deterministic identity for Studio rendering/cache invalidation only.
 * This is deliberately not the DSL-owned `schema.revision()`.
 */
export function renderFingerprintOf(value: unknown): string {
  return 'sha-' + createHash('sha256').update(canonicalJSON(value)).digest('hex').slice(0, 12)
}
