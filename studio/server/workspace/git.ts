/**
 * Best-effort workspace Git enrichment for change tracking. The fixtures are not
 * git repos, so EVERY function here degrades gracefully and NEVER throws. The
 * baseline (baseline.ts) is the primary tracker; git only enriches when present.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

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
  return git(gitRoot, ['diff', '--', rel || '.'])
}
