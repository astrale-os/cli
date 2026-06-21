/**
 * core.ts — assembles a domain's StudioCore: the genesis node/edge graph
 * extracted from `defineCore`, gated on installed deps. Never throws; a failed
 * import or a domain with no core both become a well-formed (empty) render state.
 */
import type { StudioCore } from '../../shared/types'

import { type DomainHandle, depsInstalled } from '../domain'
import { readSettings } from '../state/settings'
import { coreExtract } from './runtime'

export async function buildCore(handle: DomainHandle): Promise<StudioCore> {
  const at = new Date().toISOString()
  const empty = (error: StudioCore['error']): StudioCore => ({
    domain: handle.origin ?? handle.id,
    nodes: [],
    edges: [],
    error,
    extractedAt: at,
  })

  if (!depsInstalled(handle.root)) {
    return empty({
      message: 'dependencies not installed — run `pnpm install` in the domain for core extraction',
    })
  }

  const r = await coreExtract(
    handle.domainFile,
    handle.root,
    readSettings(handle.root).introspectTimeoutMs,
  )
  // r.ok && r.core===null  → the domain simply defines no core (not an error).
  if (!r.ok) return empty(r.error ?? { message: 'core extraction failed' })
  if (!r.core) return empty(null)

  return {
    domain: r.core.domain,
    nodes: r.core.nodes,
    edges: r.core.edges,
    error: null,
    extractedAt: at,
  }
}
