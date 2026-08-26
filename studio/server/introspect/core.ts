/**
 * core.ts — derives a domain's genesis graph from the canonical Schema already
 * extracted for its Studio bundle. Schema code is imported exactly once.
 */
import type { StudioCore, StudioSchemaBundle } from '../../shared/types'
import type { DomainHandle } from '../domain'

import { isCanonicalDomainSchemaV1, projectCanonicalCore } from './canonical-schema'

export function buildCore(handle: DomainHandle, bundle: StudioSchemaBundle | null): StudioCore {
  const at = new Date().toISOString()
  const empty = (error: StudioCore['error']): StudioCore => ({
    domain: handle.origin ?? handle.id,
    nodes: [],
    edges: [],
    error,
    extractedAt: at,
  })

  if (!bundle?.depsInstalled) {
    return empty({
      message: 'dependencies not installed — run `pnpm install` in the domain for core extraction',
    })
  }
  if (!isCanonicalDomainSchemaV1(bundle.schemaRoot)) {
    return empty(bundle.error ?? { message: 'canonical schema unavailable for core extraction' })
  }

  const core = projectCanonicalCore(bundle.schemaRoot)

  return {
    domain: core.domain,
    nodes: core.nodes,
    edges: core.edges,
    error: null,
    extractedAt: at,
  }
}
