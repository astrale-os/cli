import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const cliRoot = new URL('../..', import.meta.url).pathname
const previousSource = 'cli/v1.0.0-beta.20'
const installer = 'skills@1.5.23'
const root = mkdtempSync(join(tmpdir(), 'astrale-skills-e2e-'))

function environment(name) {
  const base = join(root, name)
  const home = join(base, 'home')
  const state = join(base, 'state')
  const astrale = join(base, 'astrale')
  mkdirSync(join(home, '.codex'), { recursive: true })
  mkdirSync(join(home, '.claude'), { recursive: true })
  return {
    home,
    env: {
      ...process.env,
      HOME: home,
      XDG_STATE_HOME: state,
      ASTRALE_HOME: astrale,
      NO_SPINNER: '1',
      CI: '1',
    },
  }
}

function execute(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: cliRoot,
    env,
    encoding: 'utf8',
    timeout: 180_000,
  })
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  )
  return result
}

function runUpdate(env) {
  const binary = process.env.ASTRALE_E2E_CLI
  return binary
    ? execute(binary, ['update', '--yes', '--no-deps'], env)
    : execute('bun', ['bin/astrale.ts', 'update', '--yes', '--no-deps'], env)
}

function runCheck(env) {
  const binary = process.env.ASTRALE_E2E_CLI
  const command = binary ?? 'bun'
  const args = binary
    ? ['update', '--check', '--json', '--no-deps']
    : ['bin/astrale.ts', 'update', '--check', '--json', '--no-deps']
  const result = spawnSync(command, args, { cwd: cliRoot, env, encoding: 'utf8', timeout: 180_000 })
  assert.equal(
    result.status === 0 || result.status === 10,
    true,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  )
  return JSON.parse(result.stdout)
}

const skillNames = ['astrale-cli', 'astrale-domain', 'astrale-frontend-design', 'astrale-services']

function canonicalSnapshot(home) {
  const lock = readFileSync(join(home, '..', 'state', 'skills', '.skill-lock.json'), 'utf8')
  const files = skillNames.map((name) =>
    readFileSync(join(home, '.agents', 'skills', name, 'SKILL.md'), 'utf8'),
  )
  return JSON.stringify({ lock, files })
}

try {
  const updateCase = environment('update')
  execute(
    'npx',
    [
      '--yes',
      installer,
      'add',
      `astrale-os/cli#${previousSource}`,
      '-g',
      '-y',
      '--skill',
      'astrale-cli',
      'astrale-domain',
      'astrale-services',
      '--agent',
      'codex',
      'claude-code',
    ],
    updateCase.env,
  )

  const updated = runUpdate(updateCase.env)
  assert.match(updated.stdout, /Astrale skills (?:repaired and )?updated/u)
  const afterUpdate = canonicalSnapshot(updateCase.home)
  const listed = execute('npx', ['--yes', installer, 'list', '-g', '--json'], updateCase.env)
  const installedSkills = JSON.parse(listed.stdout)
  const domainSkill = installedSkills.find((skill) => skill.name === 'astrale-domain')
  assert.equal(domainSkill.path, join(updateCase.home, '.agents', 'skills', 'astrale-domain'))
  assert.equal(domainSkill.agents.includes('Codex'), true)

  const unchanged = runUpdate(updateCase.env)
  assert.match(unchanged.stdout, /Astrale skills already up to date/u)
  assert.equal(canonicalSnapshot(updateCase.home), afterUpdate)
  assert.equal(runCheck(updateCase.env).skills.status, 'current')

  const expectedDomainSkill = readFileSync(
    join(updateCase.home, '.agents', 'skills', 'astrale-domain', 'SKILL.md'),
    'utf8',
  )
  writeFileSync(
    join(updateCase.home, '.agents', 'skills', 'astrale-domain', 'SKILL.md'),
    'tampered\n',
  )
  rmSync(join(updateCase.home, '.claude', 'skills', 'astrale-domain'))
  assert.equal(runCheck(updateCase.env).skills.status, 'repair-needed')
  const repaired = runUpdate(updateCase.env)
  assert.match(repaired.stdout, /Astrale skills repaired and updated/u)
  assert.equal(
    readFileSync(join(updateCase.home, '.agents', 'skills', 'astrale-domain', 'SKILL.md'), 'utf8'),
    expectedDomainSkill,
  )
  assert.equal(
    resolve(
      dirname(join(updateCase.home, '.claude', 'skills', 'astrale-domain')),
      readlinkSync(join(updateCase.home, '.claude', 'skills', 'astrale-domain')),
    ),
    join(updateCase.home, '.agents', 'skills', 'astrale-domain'),
  )

  const installCase = environment('install')
  const installed = runUpdate(installCase.env)
  assert.match(installed.stdout, /Astrale skills installed/u)
  for (const name of skillNames) {
    assert.equal(existsSync(join(installCase.home, '.agents', 'skills', name, 'SKILL.md')), true)
  }

  console.log('skills update E2E passed: installed, updated, unchanged, repaired')
} finally {
  rmSync(root, { recursive: true, force: true })
}
