import { homedir } from 'node:os'
import { join } from 'node:path'

import type { LoadoutSkill } from '../../../../shared/types'

import { scanAncestors, scanSkillDir } from '../skills'

export interface CodexPlugin {
  name: string
  path: string
  enabled: boolean
}

/** Discover project, user, and plugin skills visible to Codex. */
export function scanCodexSkills(root: string, plugins: CodexPlugin[]): LoadoutSkill[] {
  const out: LoadoutSkill[] = []
  const seen = new Set<string>()
  const home = homedir()
  scanAncestors(root, ['.agents/skills', '.codex/skills'], out, seen)
  scanSkillDir(join(home, '.agents', 'skills'), 'user', undefined, '', true, out, seen)
  scanSkillDir(join(home, '.codex', 'skills'), 'user', undefined, '', true, out, seen)
  for (const plugin of plugins)
    scanSkillDir(
      join(plugin.path, 'skills'),
      'plugin',
      plugin.name,
      `${plugin.name}:`,
      plugin.enabled,
      out,
      seen,
    )
  return out
}
