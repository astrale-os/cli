/**
 * runtime.ts — the introspection driver. Spawns the Bun extractor island in a
 * short-lived subprocess from a neutral directory, with a hard timeout. A Bun
 * standalone executable captures its startup cwd for nested Bun.build package
 * resolution, so starting it inside the Domain breaks authored `#` imports.
 * Returns the raw render IR plus the raw canonical root (when present), or an
 * error render-state — never throws.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SchemaIR, SchemaRevision, StudioSchemaBundle } from '../../shared/types'

import { isSchemaRevision } from '../../shared/types'
import { studioCliCommand } from '../cli'

const EXTRACTOR = new URL('./extractor.ts', import.meta.url).pathname

export interface RuntimeExtractResult {
  ok: boolean
  ir: SchemaIR | null
  /** Portable canonical V1 document. Null only for failures. */
  root: unknown | null
  schemaMode: StudioSchemaBundle['schemaMode']
  /** Present only when the Domain's installed SDK admitted `root`. */
  revision: SchemaRevision | null
  error?: { message: string }
}

/** One extractor island run: its stdout, plus its stderr when stdout was blank. */
export interface IslandOutput {
  stdout: string
  stderr: string
}

/**
 * Run one extractor island from a neutral launch directory and collect its output.
 * Prefers the exact Astrale CLI mode; direct Studio development falls back to
 * running `extractorPath` with this Bun. Throws on spawn/IO failures.
 */
export async function runExtractorIsland(
  cliMode: string,
  extractorPath: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<IslandOutput> {
  let launchDirectory: string | undefined
  try {
    launchDirectory = await mkdtemp(join(tmpdir(), 'astrale-studio-launch-'))
    let command: string[]
    try {
      command = studioCliCommand([cliMode, ...args])
    } catch {
      // Direct Studio development remains supported outside `astrale studio`.
      command = [process.execPath, extractorPath, ...args]
    }
    const proc = Bun.spawn(command, {
      cwd: launchDirectory,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timer = setTimeout(() => proc.kill(9), timeoutMs)
    const stdout = await new Response(proc.stdout).text()
    await proc.exited
    clearTimeout(timer)
    const stderr = stdout.trim() ? '' : await new Response(proc.stderr).text()
    return { stdout, stderr }
  } finally {
    if (launchDirectory !== undefined) {
      await rm(launchDirectory, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

function extractFailure(error: { message: string }): RuntimeExtractResult {
  return { ok: false, ir: null, root: null, schemaMode: 'unavailable', revision: null, error }
}

export async function runtimeExtract(
  schemaIndexPath: string,
  domainDir: string,
  timeoutMs = 60_000,
): Promise<RuntimeExtractResult> {
  try {
    const { stdout: out, stderr } = await runExtractorIsland(
      '__studio-extractor',
      EXTRACTOR,
      [schemaIndexPath, domainDir],
      timeoutMs,
    )
    if (!out.trim()) {
      return extractFailure({ message: stderr.trim() || 'extractor produced no output' })
    }
    const parsed = JSON.parse(out)
    if (!parsed.ok) return extractFailure(parsed.error ?? { message: 'extraction failed' })
    const schemaMode = parsed.schemaMode
    const revision = parsed.revision
    const validMode = schemaMode === 'canonical-admitted' || schemaMode === 'canonical-preview'
    const validRevision =
      schemaMode === 'canonical-admitted' ? isSchemaRevision(revision) : revision == null
    const validRoot = parsed.root !== null && parsed.root !== undefined
    if (!validMode || !validRevision || !validRoot) {
      return extractFailure({ message: 'extractor produced an invalid schema admission envelope' })
    }
    return {
      ok: true,
      ir: parsed.ir as SchemaIR,
      root: parsed.root,
      schemaMode,
      revision: revision ?? null,
    }
  } catch (e: any) {
    return extractFailure({ message: String(e?.message ?? e) })
  }
}
