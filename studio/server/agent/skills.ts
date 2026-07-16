import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'

import type { LoadoutSkill } from '../../shared/types'

export interface CodexPlugin {
  name: string
  path: string
  enabled: boolean
}

function readSkillMeta(skillMd: string): { name?: string; description?: string } {
  let text: string
  try {
    text = readFileSync(skillMd, 'utf8')
  } catch {
    return {}
  }
  if (!text.startsWith('---')) return {}
  const end = text.indexOf('\n---', 3)
  const fm = end >= 0 ? text.slice(3, end) : text.slice(3)
  try {
    const meta = parseYaml(fm) as { name?: unknown; description?: unknown } | null
    return {
      name: typeof meta?.name === 'string' ? meta.name : undefined,
      description: typeof meta?.description === 'string' ? meta.description.trim() : undefined,
    }
  } catch {
    return {}
  }
}

function scanSkillDir(
  dir: string,
  source: LoadoutSkill['source'],
  plugin: string | undefined,
  commandPrefix: string,
  loaded: boolean,
  out: LoadoutSkill[],
  seen: Set<string>,
): void {
  if (!existsSync(dir)) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const skillMd = join(dir, entry, 'SKILL.md')
    if (!existsSync(skillMd)) continue
    const command = commandPrefix + entry
    if (seen.has(command)) continue
    seen.add(command)
    const meta = readSkillMeta(skillMd)
    out.push({
      command,
      name: meta.name || entry,
      description: meta.description,
      source,
      plugin,
      loaded,
      path: skillMd,
    })
  }
}

function scanAncestors(root: string, dirs: string[], out: LoadoutSkill[], seen: Set<string>): void {
  const home = homedir()
  let current = root
  for (let i = 0; i < 12 && current !== home; i++) {
    for (const dir of dirs)
      scanSkillDir(join(current, dir), 'project', undefined, '', true, out, seen)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}

function installedClaudePluginDirs(): { plugin: string; installPath: string }[] {
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

export function scanClaudeSkills(root: string): LoadoutSkill[] {
  const out: LoadoutSkill[] = []
  const seen = new Set<string>()
  const home = homedir()
  scanAncestors(root, ['.claude/skills', '.agents/skills'], out, seen)
  scanSkillDir(join(home, '.claude', 'skills'), 'user', undefined, '', true, out, seen)
  scanSkillDir(join(home, '.agents', 'skills'), 'user', undefined, '', true, out, seen)
  for (const { plugin, installPath } of installedClaudePluginDirs())
    scanSkillDir(join(installPath, 'skills'), 'plugin', plugin, `${plugin}:`, true, out, seen)
  return out
}

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

export function readSkillContent(
  skills: LoadoutSkill[],
  command: string,
): { command: string; content: string; path: string } | null {
  const skill = skills.find((candidate) => candidate.command === command)
  if (!skill?.path) return null
  try {
    return { command, content: readFileSync(skill.path, 'utf8'), path: skill.path }
  } catch {
    return null
  }
}

export function reconcileLoadedSkills(
  installed: LoadoutSkill[],
  loadedCommands: string[],
): LoadoutSkill[] {
  const loaded = new Set(loadedCommands)
  return installed.map((skill) => ({ ...skill, loaded: loaded.has(skill.command) }))
}
