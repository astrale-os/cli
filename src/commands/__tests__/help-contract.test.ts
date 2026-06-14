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
    expect(names).toContain('update')
    expect(program.helpInformation()).toContain('idp')
    expect(program.helpInformation()).toContain('update')
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

  test('instance create is the alphaCreate flow, not legacy Instance.init DX', async () => {
    const program = await buildProgram()
    const instanceCreate = allCommands(program).find((command) => command.name() === 'create')
    const help = instanceCreate?.helpInformation() ?? ''

    expect(help).toContain('Instance.alphaCreate')
    expect(help).not.toContain('--no-use')
    expect(help).not.toContain('Instance.init requires --host-id')
  })
})

describe('help contract — connect-only command surface', () => {
  test('runtime management commands are not registered', async () => {
    const program = await buildProgram()
    const names = allCommands(program).map((command) => command.name())

    // 'logs' and 'domain' are NOT in this list anymore: each was once LOCAL
    // runtime management (the historical `astrale logs`, removed with
    // start/stop; the historical `astrale domain`, local domain wiring) and each
    // has since been RECLAIMED for a connect-side meaning through the admin
    // control plane — `astrale logs <service>` tails a MANAGED service's buffer;
    // `astrale domain publish` registers an installable domain in the admin's
    // catalog and `astrale domain install <url>` mounts one on an instance.
    for (const removed of [
      'init',
      'start',
      'stop',
      'restart',
      'reset',
      'bootstrap',
      'tunnel',
      'graph',
      'server',
      'env',
    ]) {
      expect(names).not.toContain(removed)
    }
  })
})

describe('help contract — skill is single-source, not duplicated', () => {
  const canonical = join(cliRoot, 'skills/astrale-cli/SKILL.md')
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
