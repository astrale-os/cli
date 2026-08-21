/**
 * Best-effort workspace Git enrichment for change tracking. The fixtures are not
 * git repos, so EVERY function here degrades gracefully and NEVER throws. The
 * baseline (baseline.ts) is the primary tracker; git only enriches when present.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import type { FileChange } from '../../shared/types'

/** Walk parent dirs looking for a `.git` entry (dir or file, to support worktrees/submodules). */
export function detectGit(root: string): { hasGit: boolean; gitRoot?: string } {
  let dir = resolve(root)
  while (true) {
    if (existsSync(resolve(dir, '.git'))) return { hasGit: true, gitRoot: dir }
    const parent = dirname(dir)
    if (parent === dir) return { hasGit: false }
    dir = parent
  }
}

function git(gitRoot: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', gitRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

/** `git diff` scoped to the schema dir. Returns stdout (possibly '') or null when there is no git. */
export function gitDiff(root: string, schemaDirName: string): string | null {
  const { hasGit, gitRoot } = detectGit(root)
  if (!hasGit || !gitRoot) return null
  // Path to the schema dir relative to the git root (forward-slashed for git).
  const rel = relative(gitRoot, resolve(root, schemaDirName)).split('\\').join('/')
  const out = git(gitRoot, ['diff', '--', rel || '.'])
  return out
}

/** XY porcelain code → our FileChange status. Returns null for codes we don't surface. */
function mapStatus(xy: string): FileChange['status'] | null {
  const x = xy[0] ?? ' '
  const y = xy[1] ?? ' '
  if (x === '?' || y === '?') return 'added' // untracked
  if (x === 'A' || y === 'A') return 'added'
  if (x === 'D' || y === 'D') return 'removed'
  if (x === 'R' || y === 'R') return 'modified' // rename → surface destination as modified
  if (x === 'M' || y === 'M' || x === 'C' || y === 'C' || x === 'U' || y === 'U') return 'modified'
  return null
}

/** Parse `git status --porcelain` into FileChange[]. Empty array when there is no git. */
export function gitStatus(root: string): FileChange[] {
  const { hasGit, gitRoot } = detectGit(root)
  if (!hasGit || !gitRoot) return []
  const out = git(gitRoot, ['status', '--porcelain'])
  if (out == null) return []
  const changes: FileChange[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const xy = line.slice(0, 2)
    let path = line.slice(3)
    // Renames/copies render as "old -> new"; keep the destination path.
    const arrow = path.indexOf(' -> ')
    if (arrow !== -1) path = path.slice(arrow + 4)
    const status = mapStatus(xy)
    if (status) changes.push({ file: path, status })
  }
  return changes
}
