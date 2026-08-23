/**
 * runtime.ts — the introspection driver. Spawns the Bun extractor island in a
 * short-lived subprocess (cwd = domain dir so the domain's own node_modules
 * resolve the @astrale-os/* packages), with a hard timeout. Returns the raw
 * render IR plus the raw canonical root (when present), or an error render-state
 * — never throws.
 */
import type { SchemaIR, SchemaRevision, StudioCore, StudioSchemaBundle } from '../../shared/types'

import { isSchemaRevision } from '../../shared/types'

const EXTRACTOR = new URL('./extractor.ts', import.meta.url).pathname
const CORE_EXTRACTOR = new URL('./core-extractor.ts', import.meta.url).pathname

export interface RuntimeExtractResult {
  ok: boolean
  ir: SchemaIR | null
  /** Portable canonical V1 document. Null only for failures. */
  root: unknown | null
  schemaMode: StudioSchemaBundle['schemaMode']
  /** Present only when the Domain cohort SDK admitted `root`. */
  revision: SchemaRevision | null
  error?: { message: string }
}

export async function runtimeExtract(
  schemaIndexPath: string,
  domainDir: string,
  timeoutMs = 20000,
): Promise<RuntimeExtractResult> {
  try {
    const proc = Bun.spawn(['bun', 'run', EXTRACTOR, schemaIndexPath, domainDir], {
      cwd: domainDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timer = setTimeout(() => proc.kill(9), timeoutMs)
    const out = await new Response(proc.stdout).text()
    await proc.exited
    clearTimeout(timer)

    if (!out.trim()) {
      const err = await new Response(proc.stderr).text()
      return {
        ok: false,
        ir: null,
        root: null,
        schemaMode: 'unavailable',
        revision: null,
        error: { message: err.trim() || 'extractor produced no output' },
      }
    }
    const parsed = JSON.parse(out)
    if (!parsed.ok)
      return {
        ok: false,
        ir: null,
        root: null,
        schemaMode: 'unavailable',
        revision: null,
        error: parsed.error ?? { message: 'extraction failed' },
      }
    const schemaMode = parsed.schemaMode
    const revision = parsed.revision
    const validMode = schemaMode === 'canonical-admitted' || schemaMode === 'canonical-preview'
    const validRevision =
      schemaMode === 'canonical-admitted' ? isSchemaRevision(revision) : revision == null
    const validRoot = parsed.root !== null && parsed.root !== undefined
    if (!validMode || !validRevision || !validRoot) {
      return {
        ok: false,
        ir: null,
        root: null,
        schemaMode: 'unavailable',
        revision: null,
        error: { message: 'extractor produced an invalid schema admission envelope' },
      }
    }
    return {
      ok: true,
      ir: parsed.ir as SchemaIR,
      root: parsed.root ?? null,
      schemaMode,
      revision: revision ?? null,
    }
  } catch (e: any) {
    return {
      ok: false,
      ir: null,
      root: null,
      schemaMode: 'unavailable',
      revision: null,
      error: { message: String(e?.message ?? e) },
    }
  }
}

export interface CoreExtractResult {
  ok: boolean
  /** the resolved core graph, or null when the domain defines no core */
  core: Pick<StudioCore, 'domain' | 'nodes' | 'edges'> | null
  error?: { message: string }
}

/**
 * Spawn the Core extractor over the pure Schema entry. Returns the projected
 * graph or an error and never imports Application or Runtime modules.
 */
export async function coreExtract(
  schemaIndexPath: string,
  domainDir: string,
  timeoutMs = 20000,
): Promise<CoreExtractResult> {
  try {
    const proc = Bun.spawn(['bun', 'run', CORE_EXTRACTOR, schemaIndexPath, domainDir], {
      cwd: domainDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timer = setTimeout(() => proc.kill(9), timeoutMs)
    const out = await new Response(proc.stdout).text()
    await proc.exited
    clearTimeout(timer)

    if (!out.trim()) {
      const err = await new Response(proc.stderr).text()
      return {
        ok: false,
        core: null,
        error: { message: err.trim() || 'core extractor produced no output' },
      }
    }
    const parsed = JSON.parse(out)
    if (!parsed.ok)
      return { ok: false, core: null, error: parsed.error ?? { message: 'core extraction failed' } }
    return { ok: true, core: (parsed.core ?? null) as CoreExtractResult['core'] }
  } catch (e: any) {
    return { ok: false, core: null, error: { message: String(e?.message ?? e) } }
  }
}
