import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { LoadoutSkill } from '../../../../shared/types'

import { scanAncestors, scanSkillDir } from '../skills'

function installedPluginDirs(): { plugin: string; installPath: string }[] {
  const file = join(homedir(), '.claude', 'plugins', 'installed_plugins.json')
  let parsed: any
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return []
  }
  const out: { plugin: string; installPath: string }[] = []
  const seen = new Set<string>()
  for (const [key, entries] of Object.entries(parsed?.plugins ?? {})) {
    const plugin = String(key).split('@')[0]
    for (const entry of Array.isArray(entries) ? entries : []) {
      const installPath = (entry as any)?.installPath
      if (typeof installPath === 'string' && !seen.has(installPath)) {
        seen.add(installPath)
        out.push({ plugin, installPath })
      }
    }
  }
  return out
}

/** Discover the skills visible to Claude Code for one domain root. */
export function scanClaudeSkills(root: string): LoadoutSkill[] {
  const out: LoadoutSkill[] = []
  const seen = new Set<string>()
  const home = homedir()
  scanAncestors(root, ['.claude/skills', '.agents/skills'], out, seen)
  scanSkillDir(join(home, '.claude', 'skills'), 'user', undefined, '', true, out, seen)
  scanSkillDir(join(home, '.agents', 'skills'), 'user', undefined, '', true, out, seen)
  for (const { plugin, installPath } of installedPluginDirs())
    scanSkillDir(join(installPath, 'skills'), 'plugin', plugin, `${plugin}:`, true, out, seen)
  return out
}
