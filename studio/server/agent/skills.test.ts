import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readSkillContent, scanCodexSkills } from './skills'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function skill(dir: string, command: string, frontmatter: string): string {
  const target = join(dir, command)
  mkdirSync(target, { recursive: true })
  const path = join(target, 'SKILL.md')
  writeFileSync(path, `---\n${frontmatter}\n---\n\nInstructions for ${command}.\n`)
  return path
}

test('Codex skill discovery prefers the nearest project skill and preserves disabled plugins', () => {
  const parent = mkdtempSync(join(tmpdir(), 'studio-skills-'))
  roots.push(parent)
  const root = join(parent, 'domain')
  mkdirSync(root)
  const parentSkill = skill(
    join(parent, '.agents', 'skills'),
    'project-check',
    'name: Parent\ndescription: parent',
  )
  const nearestSkill = skill(
    join(root, '.agents', 'skills'),
    'project-check',
    `name: Nearest
description: >
  First line of a folded description.
  Second line stays visible.`,
  )
  const pluginRoot = join(parent, 'plugin')
  const pluginSkill = skill(
    join(pluginRoot, 'skills'),
    'review',
    'name: Review\ndescription: Disabled review tool',
  )

  const found = scanCodexSkills(root, [{ name: 'demo', path: pluginRoot, enabled: false }])
  const project = found.find((item) => item.command === 'project-check')!
  const plugin = found.find((item) => item.command === 'demo:review')!

  expect(project).toMatchObject({
    name: 'Nearest',
    description: 'First line of a folded description. Second line stays visible.',
    source: 'project',
    loaded: true,
    path: nearestSkill,
  })
  expect(project.path).not.toBe(parentSkill)
  expect(plugin).toMatchObject({
    name: 'Review',
    source: 'plugin',
    plugin: 'demo',
    loaded: false,
    path: pluginSkill,
  })
  expect(readSkillContent(found, 'demo:review')).toEqual({
    command: 'demo:review',
    content: `---\nname: Review\ndescription: Disabled review tool\n---\n\nInstructions for review.\n`,
    path: pluginSkill,
  })
})
