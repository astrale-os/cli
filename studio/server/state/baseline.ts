/**
 * baseline.ts — the PRIMARY change tracker. On first launch we capture a
 * snapshot (the schema IR + a content hash of the "anatomy + schema fileset")
 * under `.domain-studio/.cache/baseline/`. Subsequent runs diff the live state
 * against that baseline to compute a ChangeSet. Git (git.ts) only enriches when
 * a real repo is present; the fixtures are not repos, so baseline stands alone.
 *
 * Layout under `.cache/baseline/`:
 *   ir.json     — the captured SchemaIR (or null)
 *   files.json  — { [relpathFromRoot]: sha256 }
 *   meta.json   — { capturedAt }
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import type { ChangeSet, FileChange, SchemaChange, SchemaIR } from '../../shared/types'

import { classify, diffSchemas } from '../introspect/diff'
import { detectGit, gitDiff } from './git'
import { readJson, writeJson } from './store'

const BASE = '.cache/baseline'

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
    'capabilities',
    'core',
    'runtime',
    'views',
    'functions',
    'handlers',
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
    'implementation.ts',
    'domain.ts',
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
  ir: SchemaIR | null
  files: Record<string, string>
  capturedAt?: string
}

/** Persist a baseline snapshot under `.cache/baseline/`. All writes go through the store. */
export function captureBaseline(
  root: string,
  ir: SchemaIR | null,
  fileHashes: Record<string, string>,
): void {
  writeJson(root, `${BASE}/ir.json`, ir)
  writeJson(root, `${BASE}/files.json`, fileHashes)
  writeJson(root, `${BASE}/meta.json`, { capturedAt: new Date().toISOString() })
}

/** Load a previously-captured baseline, or null if none exists. Never throws. */
export function loadBaseline(root: string): Baseline | null {
  const irPath = join(resolve(root), '.domain-studio', BASE, 'meta.json')
  if (!existsSync(irPath)) return null
  const ir = readJson<SchemaIR | null>(root, `${BASE}/ir.json`, null)
  const files = readJson<Record<string, string>>(root, `${BASE}/files.json`, {})
  const meta = readJson<{ capturedAt?: string }>(root, `${BASE}/meta.json`, {})
  return { ir, files, capturedAt: meta.capturedAt }
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
      const flag = c.breaking ? 'breaking' : 'additive'
      const detail = c.detail ? `: ${c.detail}` : ''
      return `${c.kind} ${c.target}${detail} (${flag})`
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
  opts: { schemaDirName: string },
): ChangeSet {
  const { hasGit } = detectGit(root)
  const source: ChangeSet['source'] = hasGit ? 'git' : 'baseline'
  const baseline = loadBaseline(root)

  if (!baseline) {
    return {
      source,
      hasGit,
      hasBaseline: false,
      schemaChanges: [],
      fileChanges: [],
      classification: 'none',
    }
  }

  const schemaChanges = diffSchemas(baseline.ir ?? null, currentIr)
  const classification = classify(schemaChanges)
  const fileChanges = diffFiles(baseline.files ?? {}, currentFiles)

  const schemaDiffText = hasGit
    ? (gitDiff(root, opts.schemaDirName) ?? undefined)
    : summarizeSchemaChanges(schemaChanges)

  return {
    source,
    hasGit,
    hasBaseline: true,
    schemaChanges,
    fileChanges,
    schemaDiffText,
    classification,
    baselineCapturedAt: baseline.capturedAt,
  }
}
