import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { SetupStep } from '../types'

import { log } from '../../lib/log'
import { ensureSkillsBridge, skillsBridgeStatus } from '../../lib/skills'

/**
 * Equip — make a workspace's own staged skills loadable. Agent tooling stages
 * skills under `.agents/skills`, but the harness (Claude Code et al.) only loads
 * `.claude/skills` (walking up to the project root). A single
 * `.claude/skills -> ../.agents/skills` symlink bridges every staged skill —
 * present and future — for this workspace and every project nested under it.
 * This is exactly how this monorepo wires its own skills; doing it in `setup`
 * means a skill landing in `.agents/skills` is loaded, not silently invisible
 * (the gap that let agent-browser report "installed" yet never load).
 *
 * Runs first in the equip group so the per-skill steps below detect against the
 * already-bridged state. Idempotent and non-destructive.
 */
function countStaged(root: string): number {
  try {
    const dir = join(root, '.agents', 'skills')
    return readdirSync(dir).filter((e) => existsSync(join(dir, e, 'SKILL.md'))).length
  } catch {
    return 0
  }
}

export const skillsBridgeStep: SetupStep = {
  id: 'skills-bridge',
  title: 'workspace skills bridge',
  group: 'equip',

  async detect() {
    const s = skillsBridgeStatus()
    if (s.kind === 'none') return { state: 'satisfied', summary: 'no workspace skills to bridge' }
    if (s.kind === 'bridged')
      return { state: 'satisfied', summary: '.agents/skills bridged → the harness loads them' }
    if (s.kind === 'foreign')
      return { state: 'satisfied', summary: '.claude/skills already present — left as-is' }
    const n = countStaged(s.root)
    return {
      state: 'gap',
      summary: `${n} skill${n === 1 ? '' : 's'} in .agents/skills not loaded by the harness`,
      fixHint: `ln -s ../.agents/skills ${s.link}`,
    }
  },

  async ensure() {
    const before = skillsBridgeStatus()
    if (before.kind === 'none' || before.kind === 'bridged') return 'unchanged'
    if (before.kind === 'foreign') {
      log.dim('  .claude/skills already exists — leaving it untouched.')
      return 'unchanged'
    }
    const after = ensureSkillsBridge()
    if (after.kind === 'bridged') {
      log.success(
        `Workspace skills bridged — ${join(after.root, '.agents/skills')} → .claude/skills`,
      )
      return 'fixed'
    }
    log.warn(
      'Could not create the skills bridge — create it manually: ln -s ../.agents/skills .claude/skills',
    )
    return 'failed'
  },
}
