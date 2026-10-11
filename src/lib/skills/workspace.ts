import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { findAgentBrowser } from '../browser/agent-browser'

export const AGENT_BROWSER_SKILL = 'agent-browser'

/** `cwd` and each of its ancestors, nearest first. */
function ancestors(from: string): string[] {
  const dirs = [from]
  for (let parent = dirname(from); parent !== dirs.at(-1); parent = dirname(parent)) {
    dirs.push(parent)
  }
  return dirs
}

/**
 * Is `<name>/SKILL.md` in a directory the agent harness loads: a project `.claude/skills` up
 * the tree, then the user's `~/.claude/skills`. `.agents/skills` alone is not loaded; it needs
 * the bridge below.
 */
export function detectSkill(name: string): { installed: boolean; location: string | null } {
  const dirs = [...ancestors(process.cwd()), homedir()].map((dir) => join(dir, '.claude', 'skills'))
  const location = dirs.map((dir) => join(dir, name, 'SKILL.md')).find((file) => existsSync(file))
  return { installed: location !== undefined, location: location ?? null }
}

export async function detectAgentBrowser(): Promise<boolean> {
  return (await findAgentBrowser()) !== null
}

/**
 * A workspace stages its own skills under `.agents/skills`; one `.claude/skills ->
 * ../.agents/skills` link makes every staged skill loadable by the harness.
 */
const BRIDGE_TARGET = join('..', '.agents', 'skills')

export type BridgeStatus =
  | { kind: 'none' }
  | { kind: 'bridged'; root: string }
  /** `.claude/skills` exists and is not our link: never touched. */
  | { kind: 'foreign'; root: string }
  | { kind: 'unbridged'; root: string; link: string }

export function skillsBridgeStatus(fromDir: string = process.cwd()): BridgeStatus {
  const root = ancestors(fromDir).find((dir) => existsSync(join(dir, '.agents', 'skills')))
  if (!root) return { kind: 'none' }
  const link = join(root, '.claude', 'skills')
  const stat = lstatSync(link, { throwIfNoEntry: false })
  if (!stat) return { kind: 'unbridged', root, link }
  return stat.isSymbolicLink() && readlinkSync(link) === BRIDGE_TARGET
    ? { kind: 'bridged', root }
    : { kind: 'foreign', root }
}

/** Create the bridge when missing; an existing `.claude/skills` is left as it is. */
export function ensureSkillsBridge(fromDir: string = process.cwd()): BridgeStatus {
  const status = skillsBridgeStatus(fromDir)
  if (status.kind !== 'unbridged') return status
  mkdirSync(dirname(status.link), { recursive: true })
  symlinkSync(BRIDGE_TARGET, status.link)
  return { kind: 'bridged', root: status.root }
}
