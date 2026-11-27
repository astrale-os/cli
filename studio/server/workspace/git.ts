/**
 * Best-effort workspace Git enrichment for change tracking. The fixtures are not
 * git repos, so EVERY function here degrades gracefully and NEVER throws. The
 * baseline (baseline.ts) is the primary tracker; git only enriches when present.
 */
import { existsSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import { captureProcess } from '../process'

/** How long one git command may take; past it, it answers nothing. */
const GIT_TIMEOUT_MS = 15_000

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

/** One git command's stdout, through the Studio's runner; null when it did not succeed. */
async function git(gitRoot: string, args: string[]): Promise<string | null> {
  const run = await captureProcess(['git', '-C', gitRoot, ...args], { timeoutMs: GIT_TIMEOUT_MS })
  return run.exitCode === 0 && !run.timedOut && !run.spawnError ? run.stdout : null
}

/** `git diff` scoped to the schema dir. Returns stdout (possibly '') or null when there is no git. */
export async function gitDiff(root: string, schemaDirName: string): Promise<string | null> {
  const { hasGit, gitRoot } = detectGit(root)
  if (!hasGit || !gitRoot) return null
  // Path to the schema dir relative to the git root (forward-slashed for git).
  const rel = relative(gitRoot, resolve(root, schemaDirName)).split('\\').join('/')
  return git(gitRoot, ['diff', '--', rel || '.'])
}

/** A full SHA-1 commit in lower case, as a deployment record holds it. */
const COMMIT_SHA = /^[0-9a-f]{40}$/

/**
 * The provenance a deploy of the Project in `root` records (SDK `deploymentCommit`): HEAD, and
 * whether tracked changes or untracked files exist anywhere in the working tree; ignored files
 * never count. Null outside a git repository, without git, before the first commit, or for a
 * repository whose commits are not SHA-1.
 */
export async function gitCommit(root: string): Promise<{ commit: string; dirty: boolean } | null> {
  if (!detectGit(root).hasGit) return null
  const head = (await git(root, ['rev-parse', '--verify', 'HEAD']))?.trim()
  if (!head || !COMMIT_SHA.test(head)) return null
  const status = await git(root, ['status', '--porcelain', '--untracked-files=normal'])
  if (status === null) return null
  return { commit: head, dirty: status.length > 0 }
}
