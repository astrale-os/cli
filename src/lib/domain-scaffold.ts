/**
 * Shared helpers for domain scaffolding: filtered recursive copy + token
 * rename engine.
 *
 * Used by the Cloudflare DomainPlatform adapter's `scaffold()` to turn
 * `cli/templates/<template>/` into `<targetDir>/` without any manual edit.
 */

import { cp, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

/** Paths that must never be copied into the new domain dir. */
const DEFAULT_EXCLUDES = [
  'node_modules',
  '.wrangler',
  '.dev.vars',
  'dist',
  'spec.json',
  'private-key.json',
]

/** File extensions treated as binary (content never rewritten). */
const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
])

export type RenameMap = {
  /** Literal substitutions applied in order. */
  literals: Array<{ from: string; to: string }>
  /** Word-boundary substitutions (\bword\b) applied after literals. */
  wordBoundary: Array<{ from: string; to: string }>
}

/**
 * Derive PascalCase/camelCase variants from a kebab-case slug.
 * `my-cool-domain` → { pascal: 'MyCoolDomain', camel: 'myCoolDomain', upper: 'MY_COOL_DOMAIN' }.
 */
export function slugVariants(slug: string): {
  kebab: string
  pascal: string
  camel: string
  upperSnake: string
} {
  const parts = slug.split('-').filter(Boolean)
  const pascal = parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join('')
  const camel = pascal[0]!.toLowerCase() + pascal.slice(1)
  const upperSnake = parts.join('_').toUpperCase()
  return { kebab: slug, pascal, camel, upperSnake }
}

/**
 * Build the default rename map for the `minimal-remote` template.
 * Every identifier that appears verbatim in the template maps to its
 * slug-derived equivalent.
 */
export function buildMinimalRemoteRenameMap(slug: string): RenameMap {
  const v = slugVariants(slug)
  return {
    literals: [
      // Folder + package name (must precede the bare `minimal` rule).
      { from: 'minimal-remote', to: v.kebab },
      // FQDNs and hostnames.
      { from: 'minimal.test.astrale.ai', to: `${v.kebab}.test.astrale.ai` },
      { from: 'minimal.astrale.ai', to: `${v.kebab}.astrale.ai` },
      { from: 'minimal.localhost', to: `${v.kebab}.localhost` },
      // Env-var prefix.
      { from: 'MINIMAL_', to: `${v.upperSnake}_` },
      // PascalCase / camelCase identifiers (template-specific).
      { from: 'MinimalRemoteSchema', to: `${v.pascal}Schema` },
      { from: 'minimalRemoteDomain', to: `${v.camel}Domain` },
    ],
    wordBoundary: [
      // Last pass — bare `minimal` inside comments, slugs, etc.
      { from: 'minimal', to: v.kebab },
    ],
  }
}

/** Filter predicate used by fs.cp. */
function makeFilter(rootSrc: string): (src: string) => boolean {
  return (src: string) => {
    const rel = relative(rootSrc, src)
    if (!rel) return true
    for (const ex of DEFAULT_EXCLUDES) {
      if (rel === ex || rel.startsWith(`${ex}/`) || rel.endsWith(`/${ex}`)) return false
    }
    return true
  }
}

/**
 * Recursively copy `srcDir` → `destDir`, skipping default-excluded paths.
 * Overwrites existing files in `destDir`.
 */
export async function copyTemplate(srcDir: string, destDir: string): Promise<void> {
  await cp(srcDir, destDir, {
    recursive: true,
    errorOnExist: false,
    force: true,
    filter: makeFilter(srcDir),
  })
}

/** Apply a rename map to the text content of a single file. */
export function applyRenameToText(text: string, map: RenameMap): string {
  let out = text
  for (const { from, to } of map.literals) {
    if (out.includes(from)) out = out.split(from).join(to)
  }
  for (const { from, to } of map.wordBoundary) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'g'), to)
  }
  return out
}

function isBinaryPath(path: string): boolean {
  const idx = path.lastIndexOf('.')
  if (idx < 0) return false
  return BINARY_EXT.has(path.slice(idx).toLowerCase())
}

/**
 * Walk `rootDir` and rewrite every text file's content through the rename
 * map. Skips binaries, node_modules, and other default-excluded paths.
 */
export async function rewriteFilesContent(rootDir: string, map: RenameMap): Promise<number> {
  let touched = 0
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (DEFAULT_EXCLUDES.includes(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        if (isBinaryPath(full)) continue
        const before = await readFile(full, 'utf-8')
        const after = applyRenameToText(before, map)
        if (after !== before) {
          await writeFile(full, after)
          touched++
        }
      }
    }
  }
  await walk(rootDir)
  return touched
}

/**
 * Rename files/dirs whose paths contain any literal `from` token.
 * Runs bottom-up so renaming a parent dir doesn't invalidate child paths.
 */
export async function renameFilesInTree(rootDir: string, map: RenameMap): Promise<number> {
  let renamed = 0
  async function collect(dir: string, acc: string[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (DEFAULT_EXCLUDES.includes(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await collect(full, acc)
      acc.push(full)
    }
  }
  const all: string[] = []
  await collect(rootDir, all)
  // Sort by depth desc so we rename leaves before parents.
  all.sort((a, b) => b.split('/').length - a.split('/').length)
  for (const path of all) {
    const base = path.slice(dirname(path).length + 1)
    let newBase = base
    for (const { from, to } of map.literals) {
      if (newBase.includes(from)) newBase = newBase.split(from).join(to)
    }
    if (newBase !== base) {
      const next = join(dirname(path), newBase)
      await rename(path, next)
      renamed++
    }
  }
  return renamed
}

/** Convenience check — does `path` exist as a file or directory? */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
