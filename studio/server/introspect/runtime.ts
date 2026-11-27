/**
 * runtime.ts — the introspection driver. Runs the Bun extractor island in a
 * short-lived subprocess from a neutral directory, through the Studio's runner (process.ts). A Bun
 * standalone executable captures its startup cwd for nested Bun.build package
 * resolution, so starting it inside the Domain breaks authored `#` imports.
 * Returns the raw render IR plus the raw canonical root (when present), or an
 * error render-state — never throws.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SchemaIR, SchemaRevision, StudioSchemaBundle } from '../../shared/contracts/schema'

import { isSchemaRevision } from '../../shared/contracts/schema'
import { studioCliCommand } from '../cli'
import { captureProcess } from '../process'
import { isCanonicalDomainSchemaV1 } from './canonical-schema'

const EXTRACTOR = new URL('./extractor.ts', import.meta.url).pathname

interface RuntimeExtractResult {
  ok: boolean
  ir: SchemaIR | null
  /** Portable canonical V1 document. Null only for failures. */
  root: unknown | null
  /**
   * The admitted root's dependency Schemas (canonical V1 documents). Null for a preview, a
   * failure, or an extractor that predates it.
   */
  closure: unknown[] | null
  schemaMode: StudioSchemaBundle['schemaMode']
  /** Present only when the Domain's installed SDK admitted `root`. */
  revision: SchemaRevision | null
  error?: { message: string }
}

/** One extractor island run: its stdout, plus its stderr when stdout was blank. */
interface IslandOutput {
  stdout: string
  stderr: string
}

/**
 * The command one extractor island runs: the exact Astrale CLI mode, or, in direct Studio
 * development, `extractorPath` with this Bun. It need not be this server's Bun:
 * `astrale studio --dev` serves from the PATH `bun` and extracts with the launching CLI.
 */
export function extractorCommand(
  cliMode: string,
  extractorPath: string,
  args: readonly string[],
): string[] {
  try {
    return studioCliCommand([cliMode, ...args])
  } catch {
    // Direct Studio development remains supported outside `astrale studio`.
    return [process.execPath, extractorPath, ...args]
  }
}

/** The program that reads a Domain's Schema, before its per-Domain arguments. */
export function schemaExtractorCommand(): string[] {
  return extractorCommand('__studio-extractor', EXTRACTOR, [])
}

/**
 * Run one extractor island from a neutral launch directory and collect its output, through the
 * Studio's runner: past `timeoutMs` its whole process group is killed. Throws when it could not
 * start, or when it ran out of time — an island cut short answers nothing to read.
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
    const command = extractorCommand(cliMode, extractorPath, args)
    const run = await captureProcess(command, { cwd: launchDirectory, timeoutMs })
    if (run.spawnError) throw new Error(`the extractor could not run: ${run.spawnError}`)
    if (run.timedOut) throw new Error(`the extractor did not answer within ${timeoutMs}ms`)
    return { stdout: run.stdout, stderr: run.stdout.trim() ? '' : run.stderr }
  } finally {
    if (launchDirectory !== undefined) {
      await rm(launchDirectory, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

function extractFailure(error: { message: string }): RuntimeExtractResult {
  return {
    ok: false,
    ir: null,
    root: null,
    closure: null,
    schemaMode: 'unavailable',
    revision: null,
    error,
  }
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
    const closure = parsed.closure ?? null
    const validClosure =
      closure === null ||
      (schemaMode === 'canonical-admitted' &&
        Array.isArray(closure) &&
        closure.every(isCanonicalDomainSchemaV1))
    if (!validMode || !validRevision || !validRoot || !validClosure) {
      return extractFailure({ message: 'extractor produced an invalid schema admission envelope' })
    }
    return {
      ok: true,
      ir: parsed.ir as SchemaIR,
      root: parsed.root,
      closure,
      schemaMode,
      revision: revision ?? null,
    }
  } catch (e: any) {
    return extractFailure({ message: String(e?.message ?? e) })
  }
}
