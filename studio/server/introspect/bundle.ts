/**
 * bundle.ts — assembles the StudioSchemaBundle: runtime IR (PRIMARY) + ts-morph
 * overlay + render fingerprint + deps-installed precondition. Never throws; a failed
 * runtime import becomes a render-state error (with the overlay still computed
 * statically, so anchors/handler-links survive a mid-edit compile break).
 */
import type { StudioSchemaBundle } from '../../shared/types'

import { type DomainHandle, depsInstalled } from '../domain'
import { studioSettings } from '../studio-settings'
import { renderFingerprintOf } from './hash'
import { buildOverlay } from './overlay'
import { runtimeExtract } from './runtime'

export async function buildBundle(handle: DomainHandle): Promise<StudioSchemaBundle> {
  const installed = depsInstalled(handle.root)
  let ir = null
  let schemaRoot: unknown | undefined
  let schemaMode: StudioSchemaBundle['schemaMode'] = 'unavailable'
  let schemaRevision: StudioSchemaBundle['schemaRevision']
  let error: StudioSchemaBundle['error'] = null
  let extractedBy: StudioSchemaBundle['extractedBy'] = 'runtime-bun'

  if (installed) {
    const r = await runtimeExtract(
      handle.schemaIndex,
      handle.root,
      studioSettings().introspectTimeoutMs,
    )
    if (r.ok) {
      ir = r.ir
      if (r.root !== null) schemaRoot = r.root
      schemaMode = r.schemaMode
      if (r.revision !== null) schemaRevision = r.revision
    } else {
      error = { message: r.error?.message ?? 'schema failed to compile' }
      extractedBy = 'static-tsmorph-fallback'
    }
  } else {
    extractedBy = 'static-tsmorph-fallback'
    error = {
      message:
        'dependencies not installed — run `pnpm install` in the domain for full-fidelity schema rendering',
    }
  }

  const overlay = buildOverlay({ ir, domainRoot: handle.root, schemaDir: handle.schemaDir })
  if (ir) handle.origin = ir.domain
  const renderFingerprint =
    schemaRoot !== undefined
      ? renderFingerprintOf(schemaRoot)
      : ir
        ? renderFingerprintOf(ir)
        : 'sha-none'

  return {
    domainId: handle.id,
    renderFingerprint,
    schemaMode,
    ...(schemaRevision === undefined ? {} : { schemaRevision }),
    extractedBy,
    depsInstalled: installed,
    ir,
    ...(schemaRoot === undefined ? {} : { schemaRoot }),
    overlay,
    error,
    extractedAt: new Date().toISOString(),
  }
}
