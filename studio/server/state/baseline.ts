/**
 * baseline.ts — the PRIMARY change tracker. The first bundle that holds a Schema
 * is captured as a versioned snapshot (canonical revision/root, render IR, and a
 * content hash of the "anatomy + schema fileset")
 * under `.domain-studio/.cache/baseline/`. Subsequent runs diff the live state
 * against that baseline to compute a ChangeSet. Git (git.ts) only enriches when
 * a real repo is present; the fixtures are not repos, so baseline stands alone.
 *
 * Layout under `.cache/baseline/`:
 *   ir.json           — the captured render SchemaIR
 *   schema-root.json  — the admitted portable V1 root (or null)
 *   files.json        — { [relpathFromRoot]: sha256 }
 *   meta.json         — format/projection versions, revision, capturedAt
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import type { SchemaIR, SchemaRevision, StudioSchemaBundle } from '../../shared/contracts/schema'
import type { ChangeSet, FileChange, SchemaComparison } from '../../shared/contracts/workspace'
import type { DomainHandle } from '../domain/registry'

import { isSchemaRevision, STUDIO_SCHEMA_PROJECTION_VERSION } from '../../shared/contracts/schema'
import { unreadSchemaReason } from '../introspect/bundle'
import { isCanonicalDomainSchemaV1 } from '../introspect/canonical-schema'
import { diffSchemas } from '../introspect/diff'
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
    'functions',
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
    'client/src',
  ],
  files: [
    'domain.ts',
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

/** What `path` is on disk, or null when it is missing or unreadable. */
function entryKind(path: string): 'file' | 'dir' | null {
  try {
    const st = statSync(path)
    return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : null
  } catch {
    return null
  }
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
    const kind = entryKind(full)
    if (kind === 'dir') walkFiles(full, out)
    else if (kind === 'file') out.push(full)
  }
}

/**
 * Hash (sha256) every file in the anatomy + schema fileset. Keys are paths
 * relative to `root`, forward-slashed. Missing dirs/files are silently skipped.
 */
export function hashAnatomyFiles(
  root: string,
  schemaDirName: string,
  domainFile?: string,
): Record<string, string> {
  const r = resolve(root)
  const absFiles: string[] = []

  // Schema dir (configurable name) + the fixed anatomy dirs.
  for (const d of [schemaDirName, ...ANATOMY_GLOBS.dirs]) {
    const abs = join(r, d)
    const kind = entryKind(abs)
    if (kind === 'dir') walkFiles(abs, absFiles)
    else if (kind === 'file') absFiles.push(abs)
  }

  // Standalone files.
  for (const f of ANATOMY_GLOBS.files) {
    const abs = join(r, f)
    if (entryKind(abs) === 'file') absFiles.push(abs)
  }

  // A config-selected Domain definition (or the `application.ts` of a Project on an SDK
  // before 0.6.0-beta.11) may live below the domain root. It is the composition source of
  // truth and must participate in cache/change identity.
  if (domainFile && entryKind(domainFile) === 'file') absFiles.push(domainFile)

  const hashes: Record<string, string> = {}
  for (const abs of new Set(absFiles)) {
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

interface Baseline {
  formatVersion: typeof BASELINE_FORMAT_VERSION
  projectionVersion: number
  ir: SchemaIR
  /** Admitted canonical root only; null for legacy/preview snapshots. */
  root: unknown | null
  revision: SchemaRevision | null
  files: Record<string, string>
  capturedAt?: string
}

interface BaselineSchemaSnapshot {
  ir: SchemaIR
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
 * authored schema changes; so is a snapshot without a Schema, which would diff
 * nothing against every later one. The lifecycle will seed a replacement snapshot.
 */
export function loadBaseline(root: string): Baseline | null {
  const meta = readBaselineJson(root, `${BASE}/meta.json`, decodeBaselineMeta)
  if (
    !meta ||
    meta.formatVersion !== BASELINE_FORMAT_VERSION ||
    meta.projectionVersion !== STUDIO_SCHEMA_PROJECTION_VERSION
  ) {
    return null
  }
  const ir = readBaselineJson(root, `${BASE}/ir.json`, decodeSchemaIR)
  const schemaRoot = readBaselineJson(root, `${BASE}/schema-root.json`, decodeNullableSchemaRoot)
  const files = readBaselineJson(root, `${BASE}/files.json`, asStringRecord)
  if (ir === undefined || schemaRoot === undefined || files === undefined) return null
  if (meta.revision !== null && schemaRoot === null) return null
  if (meta.revision === null && schemaRoot !== null) return null
  return {
    formatVersion: BASELINE_FORMAT_VERSION,
    projectionVersion: STUDIO_SCHEMA_PROJECTION_VERSION,
    ir,
    root: schemaRoot,
    revision: meta.revision,
    files,
    capturedAt: meta.capturedAt,
  }
}

/**
 * Seed the baseline from `bundle` unless one is held already. Only a bundle that holds a
 * Schema seeds it: a failed extraction holds none, so the Domain stays without a baseline
 * until an extraction succeeds, instead of keeping a snapshot that hides every change.
 */
export function seedBaseline(
  handle: Pick<DomainHandle, 'root' | 'schemaDirName' | 'domainFile'>,
  bundle: StudioSchemaBundle | null,
): void {
  if (!bundle?.ir || loadBaseline(handle.root)) return
  captureBaseline(
    handle.root,
    {
      ir: bundle.ir,
      root: bundle.schemaMode === 'canonical-admitted' ? (bundle.schemaRoot ?? null) : null,
      revision: bundle.schemaRevision ?? null,
    },
    hashAnatomyFiles(handle.root, handle.schemaDirName, handle.domainFile),
  )
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

/** What the current extraction holds: its Schema and admitted revision, or why it holds none. */
export type CurrentSchema =
  | { state: 'read'; ir: SchemaIR; revision: SchemaRevision | null }
  | { state: 'unread'; reason: string }

/** The current extraction of a bundle, as `computeChanges` compares it. */
export function currentSchemaOf(bundle: StudioSchemaBundle | null): CurrentSchema {
  return bundle?.ir
    ? { state: 'read', ir: bundle.ir, revision: bundle.schemaRevision ?? null }
    : { state: 'unread', reason: unreadSchemaReason(bundle) }
}

/** The comparison in a few lines: the baseline source's diff text, and the handoff's digest. */
export function schemaComparisonText(schema: SchemaComparison): string {
  switch (schema.state) {
    case 'unchanged':
      return 'No schema changes.'
    case 'unread':
      return `The Schema cannot be read, so nothing is compared: ${schema.reason}`
    case 'changed':
      return schema.changes
        .map((c) => {
          const detail = c.detail ? `: ${c.detail}` : ''
          return `${c.kind} ${c.target}${detail}`
        })
        .join('\n')
  }
}

function compare(
  baseline: { ir: SchemaIR; revision: SchemaRevision | null } | null,
  current: CurrentSchema,
): SchemaComparison {
  if (current.state === 'unread') return current
  if (!baseline || (baseline.revision && current.revision === baseline.revision))
    return { state: 'unchanged' }
  const changes = diffSchemas(baseline.ir, current.ir)
  return changes.length === 0 ? { state: 'unchanged' } : { state: 'changed', changes }
}

/**
 * Compute the live ChangeSet against the captured baseline. Without one (no bundle has held a
 * Schema yet) nothing is compared and `hasBaseline` is false. A current extraction that holds no
 * Schema is unread, with the extraction's reason, whether or not a baseline is held: a failed
 * extraction never reads as "no changes".
 */
export function computeChanges(
  root: string,
  current: CurrentSchema,
  currentFiles: Record<string, string>,
  opts: { git: { hasGit: boolean; diffText?: string } },
): ChangeSet {
  const { hasGit } = opts.git
  const source: ChangeSet['source'] = hasGit ? 'git' : 'baseline'
  const baseline = loadBaseline(root)
  const currentRevision =
    current.state === 'read' && current.revision ? { currentRevision: current.revision } : {}
  const schema = compare(baseline, current)

  if (!baseline) {
    return {
      source,
      hasGit,
      hasBaseline: false,
      schema,
      fileChanges: [],
      ...currentRevision,
    }
  }

  const fileChanges = diffFiles(baseline.files, currentFiles)
  const schemaDiffText = hasGit ? opts.git.diffText : schemaComparisonText(schema)

  return {
    source,
    hasGit,
    hasBaseline: true,
    schema,
    fileChanges,
    schemaDiffText,
    ...(baseline.revision ? { baselineRevision: baseline.revision } : {}),
    ...currentRevision,
    baselineCapturedAt: baseline.capturedAt,
  }
}
