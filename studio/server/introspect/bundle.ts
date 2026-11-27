/**
 * bundle.ts — assembles the StudioSchemaBundle: runtime IR (PRIMARY) + ts-morph
 * overlay + render fingerprint + deps-installed precondition. Never throws; a failed
 * runtime import becomes a render-state error (with the overlay still computed
 * statically, so anchors/handler-links survive a mid-edit compile break).
 */
import type { SchemaIR, StudioSchemaBundle } from '../../shared/contracts/schema'
import type { IntrospectionTimer } from './timing'

import { type DomainHandle, depsInstalled } from '../domain/registry'
import { studioSettings } from '../state/settings'
import { isCanonicalDomainSchemaV1 } from './canonical-schema'
import { renderFingerprintOf } from './hash'
import { buildOverlay } from './overlay'
import { runtimeExtract } from './runtime'

/**
 * Why a bundle holds no Schema, in one sentence: the extraction's own error (a compile failure, or
 * dependencies not installed), or that the Domain left the workspace.
 */
export function unreadSchemaReason(bundle: StudioSchemaBundle | null): string {
  if (bundle === null) return 'The Domain is no longer in the workspace.'
  return bundle.error?.message ?? 'The Schema could not be read.'
}

export async function buildBundle(
  handle: DomainHandle,
  timing?: IntrospectionTimer,
): Promise<StudioSchemaBundle> {
  const measured = <T>(phase: 'dependencies' | 'static-overlay' | 'fingerprint', run: () => T) =>
    timing ? timing.measureSync(phase, run) : run()
  const measuredAsync = <T>(phase: 'runtime-extract', run: () => Promise<T>) =>
    timing ? timing.measure(phase, run) : run()

  const installed = measured('dependencies', () => depsInstalled(handle.root))
  let ir: SchemaIR | null = null
  let schemaRoot: unknown | undefined
  let schemaClosure: unknown[] | undefined
  let schemaMode: StudioSchemaBundle['schemaMode'] = 'unavailable'
  let schemaRevision: StudioSchemaBundle['schemaRevision']
  let error: StudioSchemaBundle['error'] = null
  let extractedBy: StudioSchemaBundle['extractedBy'] = 'runtime-bun'

  if (installed) {
    const r = await measuredAsync('runtime-extract', () =>
      runtimeExtract(handle.schemaIndex, handle.root, studioSettings().introspectTimeoutMs),
    )
    if (r.ok) {
      ir = r.ir
      if (r.root !== null) schemaRoot = r.root
      if (r.closure !== null) schemaClosure = r.closure
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

  const overlay = measured('static-overlay', () =>
    buildOverlay({
      ir,
      domainRoot: handle.root,
      schemaDir: handle.schemaDir,
      dependencies: dependencyOrigins(schemaRoot),
    }),
  )
  if (ir) handle.origin = ir.domain
  const renderFingerprint = measured('fingerprint', () =>
    schemaRoot !== undefined
      ? renderFingerprintOf(schemaRoot)
      : ir
        ? renderFingerprintOf(ir)
        : 'sha-none',
  )

  return {
    domainId: handle.id,
    renderFingerprint,
    schemaMode,
    ...(schemaRevision === undefined ? {} : { schemaRevision }),
    extractedBy,
    depsInstalled: installed,
    ir,
    ...(schemaRoot === undefined ? {} : { schemaRoot }),
    ...(schemaClosure === undefined ? {} : { schemaClosure }),
    overlay,
    error,
    extractedAt: new Date().toISOString(),
  }
}

/** Each dependency alias the Schema declares → its origin, as the sources name them. */
export function dependencyOrigins(root: unknown): Record<string, string> {
  if (!isCanonicalDomainSchemaV1(root)) return {}
  return Object.fromEntries(
    Object.entries(root.dependencies ?? {}).flatMap(([alias, dependency]) =>
      typeof dependency?.origin === 'string' ? [[alias, dependency.origin]] : [],
    ),
  )
}
