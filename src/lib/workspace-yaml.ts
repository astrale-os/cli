/**
 * Append a freshly-scaffolded domain to its host pnpm-workspace.yaml file(s).
 *
 * Two yaml files may be in play in the Astrale monorepo: the closest
 * ancestor of the new package (typically the workspace root) and
 * `<workspaceRoot>/domains/pnpm-workspace.yaml` if it exists separately
 * (used by the inner `domains/` submodule). Idempotent: existing entries
 * are left untouched. Comments and trailing whitespace are preserved
 * (we use `parseDocument`, not `parse`).
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { isScalar, isSeq, parseDocument, Scalar, type Document } from 'yaml'

export type WorkspaceRegistration = {
  /** Absolute paths of yaml files that received new entries. */
  updated: { path: string; added: string[] }[]
  /** Absolute paths of yaml files inspected but already containing every entry. */
  alreadyPresent: string[]
  /** Files we attempted to update but couldn't (e.g. unexpected shape). One warning per entry. */
  warnings: string[]
}

/** Sub-paths to register, relative to a domain's `targetDir` root. */
const PACKAGE_SUBPATHS = ['', 'test', 'worker', 'worker/client'] as const

/**
 * Walk up from `start` collecting every ancestor that contains a
 * `pnpm-workspace.yaml`, closest first. Stops at `/` or `$HOME`, whichever
 * comes first. Two yamls show up in Astrale's monorepo (the inner
 * `domains/` submodule has its own pnpm-workspace.yaml in addition to the
 * outer workspace root) — both need updating.
 */
export function findAllWorkspaceRoots(start: string): string[] {
  const home = homedir()
  const out: string[] = []
  let dir = resolve(start)
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) out.push(dir)
    const parent = dirname(dir)
    if (parent === dir) break
    if (dir === home) break
    dir = parent
  }
  return out
}

/**
 * Register a freshly-scaffolded package's sub-tree in every ancestor
 * `pnpm-workspace.yaml`. See module doc for the two-file rule.
 */
export async function registerWorkspaceMember(targetDir: string): Promise<WorkspaceRegistration> {
  const out: WorkspaceRegistration = { updated: [], alreadyPresent: [], warnings: [] }
  for (const yamlRoot of findAllWorkspaceRoots(dirname(targetDir))) {
    await applyToYaml(join(yamlRoot, 'pnpm-workspace.yaml'), yamlRoot, targetDir, out)
  }
  return out
}

async function applyToYaml(
  yamlPath: string,
  yamlRoot: string,
  targetDir: string,
  out: WorkspaceRegistration,
): Promise<void> {
  // Sub-paths that actually exist on disk after the scaffold (filtering
  // makes this safe for templates that ever drop one of the conventional
  // sub-dirs).
  const candidates = PACKAGE_SUBPATHS.map((sub) => (sub ? join(targetDir, sub) : targetDir))
    .filter((p) => existsSync(p))
    .map((p) => normalizeRel(relative(yamlRoot, p)))
    .filter((rel) => rel.length > 0 && !rel.startsWith('..'))

  if (candidates.length === 0) {
    // targetDir not under this yaml's root — silently skip.
    return
  }

  const raw = await readFile(yamlPath, 'utf-8')
  const doc = parseDocument(raw)

  const packages = doc.get('packages', true)
  if (!isSeq(packages)) {
    out.warnings.push(
      `${yamlPath}: no top-level 'packages' sequence — skipped (add the entries by hand: ${candidates.join(', ')}).`,
    )
    return
  }

  const existing = new Set<string>()
  for (const node of packages.items) {
    if (isScalar(node) && typeof node.value === 'string') existing.add(node.value)
  }

  const toAdd = candidates.filter((c) => !existing.has(c))
  if (toAdd.length === 0) {
    out.alreadyPresent.push(yamlPath)
    return
  }

  for (const entry of toAdd) {
    appendPackageEntry(doc, entry)
  }

  await writeFile(yamlPath, doc.toString())
  out.updated.push({ path: yamlPath, added: toAdd })
}

function normalizeRel(rel: string): string {
  // Yaml entries use POSIX separators regardless of host OS.
  return rel.split(/[\\/]/).filter(Boolean).join('/')
}

function appendPackageEntry(doc: Document, entry: string): void {
  // `addIn(['packages'], …)` preserves the existing sequence node and its
  // formatting (block style, indentation, comments). Force single-quote
  // style so new entries match the existing convention in Astrale's
  // workspace yamls (every prior entry is single-quoted; mixing styles
  // looks janky on review).
  const scalar = new Scalar(entry)
  scalar.type = Scalar.QUOTE_SINGLE
  doc.addIn(['packages'], scalar)
}
