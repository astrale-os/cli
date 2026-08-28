import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { findAgentBrowser } from './browser'

export * from './skills/sync'
export * from './skills/onboarding'

export const AGENT_BROWSER_SKILL = 'agent-browser'

/**
 * The directories the agent harness ACTUALLY loads skills from, in resolution
 * order: a project `.claude/skills` found by walking UP from cwd (the harness
 * walks up to the project root), then the user-global Claude dir.
 *
 * Deliberately NOT `.agents/skills`: the harness never reads it, so a skill
 * present only there is on disk but NOT loaded — the false "installed" this
 * used to report, which let `astrale setup` mark a skill satisfied while the
 * agent couldn't see it. `.agents/skills` is a SOURCE convention; it only loads
 * once bridged into `.claude/skills` (e.g. `.claude/skills` symlinked to
 * `.agents/skills`, as this monorepo wires itself — see {@link ensureSkillsBridge}).
 * We probe for `SKILL.md` (not the directory) so a symlinked skill still resolves.
 */
function skillSearchDirs(): string[] {
  const dirs: string[] = []
  let cur = process.cwd()
  for (;;) {
    dirs.push(join(cur, '.claude', 'skills'))
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  dirs.push(join(homedir(), '.claude', 'skills'))
  return dirs
}

export type SkillPresence = { installed: boolean; location: string | null }

/** Is `<name>/SKILL.md` present in a directory the harness actually loads from? */
export function detectSkill(name: string): SkillPresence {
  for (const dir of skillSearchDirs()) {
    const file = join(dir, name, 'SKILL.md')
    if (existsSync(file)) return { installed: true, location: file }
  }
  return { installed: false, location: null }
}

/** Is the `agent-browser` binary resolvable on PATH? */
export async function detectAgentBrowser(): Promise<boolean> {
  return (await findAgentBrowser()) !== null
}

/* ───────────────────────────── skills bridge ─────────────────────────────
 * Agent tooling stages skills under `.agents/skills`, but the harness only loads
 * `.claude/skills` (walking up). A single `.claude/skills -> ../.agents/skills`
 * symlink bridges EVERY staged skill — present and future — for a workspace and
 * every project nested under it. This is exactly how this monorepo wires itself.
 * It complements the global `-g` installs above: those equip machine-wide skills
 * the CLI owns; this makes a workspace's own staged skills loadable. */

/** The relative target every bridge points at, from `<root>/.claude/skills`. */
const BRIDGE_TARGET = join('..', '.agents', 'skills')

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

/** Nearest ancestor of `fromDir` (inclusive) that stages skills under
 *  `.agents/skills` — the "skills workspace root". null if none up the tree. */
function findAgentsSkillsRoot(fromDir: string): string | null {
  let cur = fromDir
  for (;;) {
    if (existsSync(join(cur, '.agents', 'skills'))) return cur
    const parent = dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

export type BridgeStatus =
  /** no `.agents/skills` up the tree → nothing to bridge */
  | { kind: 'none' }
  /** `.claude/skills` already symlinks to `.agents/skills` → harness loads them */
  | { kind: 'bridged'; root: string }
  /** `.claude/skills` exists but isn't our bridge (a real dir / foreign link) → leave it */
  | { kind: 'foreign'; root: string }
  /** `.agents/skills` present, no `.claude/skills` → we can create the bridge */
  | { kind: 'unbridged'; root: string; link: string }

/** Read-only: is the workspace's `.agents/skills` visible to the harness? */
export function skillsBridgeStatus(fromDir: string = process.cwd()): BridgeStatus {
  const root = findAgentsSkillsRoot(fromDir)
  if (!root) return { kind: 'none' }
  const link = join(root, '.claude', 'skills')
  if (isSymlink(link)) {
    try {
      if (readlinkSync(link) === BRIDGE_TARGET) return { kind: 'bridged', root }
    } catch {
      /* unreadable link → treat as foreign, don't touch it */
    }
    return { kind: 'foreign', root }
  }
  if (existsSync(link)) return { kind: 'foreign', root }
  return { kind: 'unbridged', root, link }
}

/** Create the `.claude/skills -> ../.agents/skills` bridge if it's missing.
 *  Idempotent and NON-destructive: a correct bridge is left as-is; a pre-existing
 *  real `.claude/skills` (or a foreign symlink) is never clobbered. */
export function ensureSkillsBridge(fromDir: string = process.cwd()): BridgeStatus {
  const status = skillsBridgeStatus(fromDir)
  if (status.kind !== 'unbridged') return status
  mkdirSync(dirname(status.link), { recursive: true })
  symlinkSync(BRIDGE_TARGET, status.link)
  return { kind: 'bridged', root: status.root }
}
