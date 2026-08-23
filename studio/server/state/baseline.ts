/**
 * baseline.ts — the PRIMARY change tracker. On first launch we capture a
 * versioned snapshot (canonical revision/root, render IR, and a content hash of
 * the "anatomy + schema fileset")
 * under `.domain-studio/.cache/baseline/`. Subsequent runs diff the live state
 * against that baseline to compute a ChangeSet. Git (git.ts) only enriches when
 * a real repo is present; the fixtures are not repos, so baseline stands alone.
 *
 * Layout under `.cache/baseline/`:
 *   ir.json           — the captured render SchemaIR (or null)
 *   schema-root.json  — the admitted portable V1 root (or null)
 *   files.json        — { [relpathFromRoot]: sha256 }
 *   meta.json         — format/projection versions, revision, capturedAt
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import type {
  ChangeSet,
  FileChange,
  SchemaChange,
  SchemaIR,
  SchemaRevision,
} from '../../shared/types'

import { isSchemaRevision, STUDIO_SCHEMA_PROJECTION_VERSION } from '../../shared/types'
import { isCanonicalDomainSchemaV1 } from '../introspect/canonical-schema'
import { diffSchemas, structuralStatusOf } from '../introspect/diff'
import { decodeSchemaIR } from '../introspect/schema-ir-json'
import { asFiniteNumber, asJsonRecord, asStringRecord, parseJson } from '../json'
import { readState, writeJson } from './store'

const BASE = '.cache/baseline'
export const BASELINE_FORMAT_VERSION = 2

/** Directories to never descend into when hashing the fileset. */
const SKIP_DIRS = new Set(['node_modules', '.dist', 'dist', '.domain-studio', '.git'])

/**
 * The "anatomy + schema fileset": directories walked recursively + standalone
 * files. The schema dir is injected per-domain (its name is configurable), so it
 * is NOT listed here — see hashAnatomyFiles. Everything else is a fixed contract.
 */
export const ANATOMY_GLOBS = {
  dirs: [
    'actions',
    'core',
    'providers',
    'runtime',
    'views',
    'integrations',
    'migrations',
    'mutations',
    'queries',
    'rules',
    'scripts',
    'states',
    'ui',
    'utils',
    'workflows',
    'client/src',
  ],
  files: [
    'application.ts',
    'runtime.ts',
    'index.ts',
    'core.ts',
    'deps.ts',
    'env.ts',
    'package.json',
    'pnpm-workspace.yaml',
    'astrale.config.ts',
  ],
} as const

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** Recursively collect file paths under `dir` (absolute), skipping SKIP_DIRS. */
function walkFiles(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue
    const full = join(dir, e)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walkFiles(full, out)
    else if (st.isFile()) out.push(full)
  }
}

/**
 * Hash (sha256) every file in the anatomy + schema fileset. Keys are paths
 * relative to `root`, forward-slashed. Missing dirs/files are silently skipped.
 */
export function hashAnatomyFiles(root: string, schemaDirName: string): Record<string, string> {
  const r = resolve(root)
  const absFiles: string[] = []

  // Schema dir (configurable name) + the fixed anatomy dirs.
  for (const d of [schemaDirName, ...ANATOMY_GLOBS.dirs]) {
    const abs = join(r, d)
    if (existsSync(abs)) {
      let st
      try {
        st = statSync(abs)
      } catch {
        st = null
      }
      if (st?.isDirectory()) walkFiles(abs, absFiles)
      else if (st?.isFile()) absFiles.push(abs)
    }
  }

  // Standalone files.
  for (const f of ANATOMY_GLOBS.files) {
    const abs = join(r, f)
    if (existsSync(abs)) {
      try {
        if (statSync(abs).isFile()) absFiles.push(abs)
      } catch {
        /* skip */
      }
    }
  }

  const hashes: Record<string, string> = {}
  for (const abs of absFiles) {
    let buf: Buffer
    try {
      buf = readFileSync(abs)
    } catch {
      continue
    }
    const key = relative(r, abs).split('\\').join('/')
    hashes[key] = sha256(buf)
  }
  return hashes
}

export interface Baseline {
  formatVersion: typeof BASELINE_FORMAT_VERSION
  projectionVersion: number
  ir: SchemaIR | null
  /** Admitted canonical root only; null for legacy/preview snapshots. */
  root: unknown | null
  revision: SchemaRevision | null
  files: Record<string, string>
  capturedAt?: string
}

export interface BaselineSchemaSnapshot {
  ir: SchemaIR | null
  /** Admitted canonical root only; preview roots must be passed as null. */
  root: unknown | null
  revision: SchemaRevision | null
}

interface BaselineMeta {
  formatVersion: number
  projectionVersion: number
  revision: SchemaRevision | null
  capturedAt?: string
}

function decodeBaselineMeta(value: unknown): BaselineMeta | undefined {
  const record = asJsonRecord(value)
  if (!record) return undefined
  const formatVersion = asFiniteNumber(record.formatVersion)
  const projectionVersion = asFiniteNumber(record.projectionVersion)
  const revision =
    record.revision === null
      ? null
      : isSchemaRevision(record.revision)
        ? record.revision
        : undefined
  const capturedAt = record.capturedAt
  if (
    formatVersion === undefined ||
    projectionVersion === undefined ||
    revision === undefined ||
    (capturedAt !== undefined && typeof capturedAt !== 'string')
  ) {
    return undefined
  }
  return {
    formatVersion,
    projectionVersion,
    revision,
    ...(capturedAt === undefined ? {} : { capturedAt }),
  }
}

function decodeNullableSchemaIR(value: unknown): SchemaIR | null | undefined {
  return value === null ? null : decodeSchemaIR(value)
}

function decodeNullableSchemaRoot(value: unknown): unknown | null | undefined {
  return value === null ? null : isCanonicalDomainSchemaV1(value) ? value : undefined
}

function readBaselineJson<T>(
  root: string,
  subpath: string,
  decode: (value: unknown) => T | undefined,
): T | undefined {
  const raw = readState(root, subpath)
  if (raw === null) return undefined
  const parsed = parseJson(raw)
  return parsed === undefined ? undefined : decode(parsed)
}

/** Persist a baseline snapshot under `.cache/baseline/`. All writes go through the store. */
export function captureBaseline(
  root: string,
  snapshot: BaselineSchemaSnapshot,
  fileHashes: Record<string, string>,
): void {
  writeJson(root, `${BASE}/ir.json`, snapshot.ir)
  writeJson(root, `${BASE}/schema-root.json`, snapshot.root)
  writeJson(root, `${BASE}/files.json`, fileHashes)
  writeJson(root, `${BASE}/meta.json`, {
    formatVersion: BASELINE_FORMAT_VERSION,
    projectionVersion: STUDIO_SCHEMA_PROJECTION_VERSION,
    revision: snapshot.revision,
    capturedAt: new Date().toISOString(),
  } satisfies BaselineMeta)
}

/**
 * Load a current baseline. Older/unrecognised formats and render-projection
 * versions are explicitly invalidated so adapter changes cannot masquerade as
 * authored schema changes. The lifecycle will seed a replacement snapshot.
 */
export function loadBaseline(root: string): Baseline | null {
  const meta = readBaselineJson(root, `${BASE}/meta.json`, decodeBaselineMeta)
  if (
    !meta ||
    meta.formatVersion !== BASELINE_FORMAT_VERSION ||
    meta.projectionVersion !== STUDIO_SCHEMA_PROJECTION_VERSION ||
    !isSchemaRevisionOrNull(meta.revision)
  ) {
    return null
  }
  const ir = readBaselineJson(root, `${BASE}/ir.json`, decodeNullableSchemaIR)
  const schemaRoot = readBaselineJson(root, `${BASE}/schema-root.json`, decodeNullableSchemaRoot)
  const files = readBaselineJson(root, `${BASE}/files.json`, asStringRecord)
  if (ir === undefined || schemaRoot === undefined || files === undefined) return null
  if (meta.revision !== null && (schemaRoot === null || ir === null)) return null
  if (meta.revision === null && schemaRoot !== null) return null
  return {
    formatVersion: BASELINE_FORMAT_VERSION,
    projectionVersion: STUDIO_SCHEMA_PROJECTION_VERSION,
    ir,
    root: schemaRoot,
    revision: meta.revision ?? null,
    files,
    capturedAt: meta.capturedAt,
  }
}

function isSchemaRevisionOrNull(value: unknown): value is SchemaRevision | null {
  return value === null || isSchemaRevision(value)
}

/** Compare two file-hash maps into added/modified/removed FileChange[]. */
function diffFiles(prev: Record<string, string>, next: Record<string, string>): FileChange[] {
  const out: FileChange[] = []
  for (const file of Object.keys(next)) {
    if (!(file in prev)) out.push({ file, status: 'added' })
    else if (prev[file] !== next[file]) out.push({ file, status: 'modified' })
  }
  for (const file of Object.keys(prev)) {
    if (!(file in next)) out.push({ file, status: 'removed' })
  }
  out.sort((a, b) => a.file.localeCompare(b.file))
  return out
}

/** A compact human-readable summary of schema changes (baseline source fallback for diff text). */
function summarizeSchemaChanges(changes: SchemaChange[]): string {
  if (changes.length === 0) return 'No schema changes.'
  return changes
    .map((c) => {
      const detail = c.detail ? `: ${c.detail}` : ''
      return `${c.kind} ${c.target}${detail}`
    })
    .join('\n')
}

/**
 * Compute the live ChangeSet against the captured baseline. On first launch
 * (no baseline yet) this returns an empty, 'none' ChangeSet with
 * hasBaseline:false so the UI shows "no changes" and the caller can then
 * capture an initial baseline.
 */
export function computeChanges(
  root: string,
  currentIr: SchemaIR | null,
  currentFiles: Record<string, string>,
  opts: {
    currentRevision?: SchemaRevision | null
    git: { hasGit: boolean; diffText?: string }
  },
): ChangeSet {
  const { hasGit } = opts.git
  const source: ChangeSet['source'] = hasGit ? 'git' : 'baseline'
  const baseline = loadBaseline(root)

  if (!baseline) {
    return {
      source,
      hasGit,
      hasBaseline: false,
      schemaChanges: [],
      fileChanges: [],
      structuralStatus: 'none',
      ...(opts.currentRevision ? { currentRevision: opts.currentRevision } : {}),
    }
  }

  const schemaChanges =
    baseline.revision && opts.currentRevision === baseline.revision
      ? []
      : diffSchemas(baseline.ir ?? null, currentIr)
  const structuralStatus = structuralStatusOf(schemaChanges)
  const fileChanges = diffFiles(baseline.files ?? {}, currentFiles)

  const schemaDiffText = hasGit ? opts.git.diffText : summarizeSchemaChanges(schemaChanges)

  return {
    source,
    hasGit,
    hasBaseline: true,
    schemaChanges,
    fileChanges,
    schemaDiffText,
    structuralStatus,
    ...(baseline.revision ? { baselineRevision: baseline.revision } : {}),
    ...(opts.currentRevision ? { currentRevision: opts.currentRevision } : {}),
    baselineCapturedAt: baseline.capturedAt,
  }
}
