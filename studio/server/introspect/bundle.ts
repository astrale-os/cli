/**
 * bundle.ts — assembles the StudioSchemaBundle: runtime IR (PRIMARY) + ts-morph
 * overlay + schemaHash + deps-installed precondition. Never throws; a failed
 * runtime import becomes a render-state error (with the overlay still computed
 * statically, so anchors/handler-links survive a mid-edit compile break).
 */
import type { StudioSchemaBundle } from '../../shared/types'

import { type DomainHandle, depsInstalled } from '../domain'
import { readSettings } from '../state/settings'
import { schemaHashOf } from './hash'
import { buildOverlay } from './overlay'
import { runtimeExtract } from './runtime'

export async function buildBundle(handle: DomainHandle): Promise<StudioSchemaBundle> {
  const installed = depsInstalled(handle.root)
  let ir = null
  let schemaRoot: unknown | undefined
  let importedInterfaces: StudioSchemaBundle['importedInterfaces']
  let error: StudioSchemaBundle['error'] = null
  let extractedBy: StudioSchemaBundle['extractedBy'] = 'runtime-bun'

  if (installed) {
    const r = await runtimeExtract(
      handle.schemaIndex,
      handle.root,
      readSettings(handle.root).introspectTimeoutMs,
    )
    if (r.ok) {
      ir = r.ir
      if (r.root !== null) schemaRoot = r.root
      importedInterfaces = r.importedInterfaces
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

  return {
    domainId: handle.id,
    // The Kernel installs the canonical DomainSchema root, not the Studio's
    // lossy render projection. Legacy domains have no root and retain IR hashing.
    schemaHash:
      schemaRoot !== undefined ? schemaHashOf(schemaRoot) : ir ? schemaHashOf(ir) : 'sha-none',
    extractedBy,
    depsInstalled: installed,
    ir,
    ...(schemaRoot === undefined ? {} : { schemaRoot }),
    overlay,
    importedInterfaces,
    error,
    extractedAt: new Date().toISOString(),
  }
}
