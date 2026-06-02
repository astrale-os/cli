import type { Command } from 'commander'

import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildProgram } from '../../program'

// The `astrale-cli` skill claims `astrale --help` is the source of truth and
// "never drifts". These tests hold that claim to account: the version is
// single-sourced from package.json, no internal `§` spec anchors leak into
// rendered help, and the workspace skill mirror stays byte-identical.

const cliRoot = join(import.meta.dir, '../../..')

/** Every command in the tree (root + groups + nested subgroups), depth-first. */
function allCommands(cmd: Command): Command[] {
  return [cmd, ...cmd.commands.flatMap(allCommands)]
}

describe('help contract — version is single-sourced', () => {
  test('program version === package.json === release-please manifest', async () => {
    const program = await buildProgram()
    const pkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8')) as {
      version: string
    }
    const manifest = JSON.parse(
      readFileSync(join(cliRoot, '.release-please-manifest.json'), 'utf8'),
    ) as Record<string, string>

    // `bin/astrale.ts` -> buildProgram -> .version(pkg.version): asserting the
    // rendered version equals BOTH JSON sources catches a re-hardcoded literal
    // and a manifest/package.json divergence (release-please bumps both).
    expect(program.version()).toBe(pkg.version)
    expect(manifest['.']).toBe(pkg.version)
  })
})

describe('help contract — no internal SPEC anchors leak to users', () => {
  test('no rendered --help text contains a § section anchor', async () => {
    const program = await buildProgram()
    const offenders = allCommands(program)
      .filter((c) => c.helpInformation().includes('§'))
      .map((c) => c.name() || '<root>')

    expect(offenders).toEqual([])
  })
})

describe('help contract — IdP/auth surface is registered', () => {
  test('idp group and auth commands are visible in --help tree', async () => {
    const program = await buildProgram()
    const names = allCommands(program).map((command) => command.name())

    expect(names).toContain('idp')
    expect(names).toContain('add')
    expect(names).toContain('login')
    expect(names).toContain('token')
    expect(program.helpInformation()).toContain('idp')
  })
})

describe('help contract — admin target surface is registered', () => {
  test('admin group and admin-target flags are visible', async () => {
    const program = await buildProgram()
    const names = allCommands(program).map((command) => command.name())
    const instanceCreate = allCommands(program).find((command) => command.name() === 'create')

    expect(names).toContain('admin')
    expect(names).toContain('status')
    expect(names).toContain('use')
    expect(program.helpInformation()).toContain('admin')
    expect(instanceCreate?.helpInformation()).toContain('--admin <name>')
    expect(instanceCreate?.helpInformation()).toContain('--admin-url <url>')
  })
})

describe('help contract — connect-only command surface', () => {
  test('runtime management commands are not registered', async () => {
    const program = await buildProgram()
    const names = allCommands(program).map((command) => command.name())

    for (const removed of [
      'init',
      'start',
      'stop',
      'restart',
      'reset',
      'bootstrap',
      'logs',
      'tunnel',
      'graph',
      'server',
      'domain',
      'env',
    ]) {
      expect(names).not.toContain(removed)
    }
  })
})

describe('help contract — skill is single-source, not duplicated', () => {
  const canonical = join(cliRoot, 'skill/astrale-cli/SKILL.md')
  // Workspace mirror lives in the superrepo, outside this submodule. Absent
  // when the CLI repo is tested standalone — only assert parity when present.
  const mirror = join(cliRoot, '../.agents/skills/astrale-cli/SKILL.md')

  test('canonical skill file exists and is non-empty', () => {
    expect(existsSync(canonical)).toBe(true)
    expect(readFileSync(canonical, 'utf8').length).toBeGreaterThan(0)
  })

  test.skipIf(!existsSync(mirror))(
    'workspace mirror is byte-identical to the canonical skill',
    () => {
      expect(readFileSync(mirror, 'utf8')).toBe(readFileSync(canonical, 'utf8'))
    },
  )
})
