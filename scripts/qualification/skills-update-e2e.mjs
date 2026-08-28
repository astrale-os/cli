import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const cliRoot = new URL('../..', import.meta.url).pathname
const root = mkdtempSync(join(tmpdir(), 'astrale-skills-e2e-'))
const skillNames = readdirSync(join(cliRoot, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

function environment(name) {
  const base = join(root, name)
  const skillRoot = join(base, 'global')
  const state = join(base, 'state')
  const astraleState = join(base, 'astrale')
  mkdirSync(join(skillRoot, '.codex'), { recursive: true })
  mkdirSync(join(skillRoot, '.claude'), { recursive: true })
  return {
    skillRoot,
    lockPath: join(state, 'skills', '.skill-lock.json'),
    env: {
      ...process.env,
      ASTRALE_SKILLS_HOME: skillRoot,
      XDG_STATE_HOME: state,
      ASTRALE_HOME: astraleState,
      NO_SPINNER: '1',
      CI: '1',
    },
  }
}

function execute(args, env) {
  const binary = process.env.ASTRALE_E2E_CLI
  const command = binary ?? 'bun'
  const commandArgs = binary ? args : ['bin/astrale.ts', ...args]
  const result = spawnSync(command, commandArgs, {
    cwd: cliRoot,
    env,
    encoding: 'utf8',
    timeout: 180_000,
  })
  assert.equal(
    result.status,
    0,
    `${command} ${commandArgs.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  )
  return result
}

function readLock(lockPath) {
  return JSON.parse(readFileSync(lockPath, 'utf8'))
}

function status(env) {
  return JSON.parse(execute(['skills', 'status', '--json'], env).stdout).skills
}

function updateSkills(env) {
  return JSON.parse(execute(['skills', 'update', '--json'], env).stdout)
}

function canonicalSnapshot(target) {
  const lock = readFileSync(target.lockPath, 'utf8')
  const files = skillNames.map((name) =>
    readFileSync(join(target.skillRoot, '.agents', 'skills', name, 'SKILL.md'), 'utf8'),
  )
  return JSON.stringify({ lock, files })
}

function qualifySelfUpdate(sourceBinary) {
  const updateRoot = join(root, 'self-update')
  const installDir = join(updateRoot, 'bin')
  const releaseDir = join(updateRoot, 'release')
  const payloadDir = join(updateRoot, 'payload')
  const stateDir = join(updateRoot, 'state')
  const licenseDir = join(stateDir, 'licenses')
  const skillRoot = join(updateRoot, 'global')
  mkdirSync(installDir, { recursive: true })
  mkdirSync(releaseDir, { recursive: true })
  mkdirSync(payloadDir, { recursive: true })
  mkdirSync(licenseDir, { recursive: true })

  const installedBinary = join(installDir, 'astrale')
  const payloadBinary = join(payloadDir, 'astrale')
  const sourceCloudflared = join(dirname(sourceBinary), 'astrale-cloudflared')
  const installedCloudflared = join(installDir, 'astrale-cloudflared')
  const payloadCloudflared = join(payloadDir, 'astrale-cloudflared')
  const payloadLicense = join(payloadDir, 'LICENSE.cloudflared')
  assert.equal(existsSync(sourceCloudflared), true, 'built release companion is missing')
  copyFileSync(sourceBinary, installedBinary)
  copyFileSync(sourceBinary, payloadBinary)
  copyFileSync(sourceCloudflared, installedCloudflared)
  copyFileSync(sourceCloudflared, payloadCloudflared)
  copyFileSync(join(cliRoot, 'licenses', 'cloudflared.txt'), join(licenseDir, 'cloudflared.txt'))
  copyFileSync(join(cliRoot, 'licenses', 'cloudflared.txt'), payloadLicense)
  chmodSync(installedBinary, 0o755)
  chmodSync(payloadBinary, 0o755)
  chmodSync(installedCloudflared, 0o755)
  chmodSync(payloadCloudflared, 0o755)

  const version = spawnSync(sourceBinary, ['--version'], { encoding: 'utf8' }).stdout.trim()
  const cloudflaredVersion = spawnSync(sourceCloudflared, ['--version'], {
    encoding: 'utf8',
  }).stdout.match(/^cloudflared version ([^ ]+)/u)?.[1]
  assert.equal(typeof cloudflaredVersion, 'string')
  const platform = `${process.platform}-${process.arch}`
  const assetName = `astrale-${platform}.tar.gz`
  const assetPath = join(releaseDir, assetName)
  const archived = spawnSync(
    'tar',
    ['-C', payloadDir, '-czf', assetPath, 'astrale', 'astrale-cloudflared', 'LICENSE.cloudflared'],
    { encoding: 'utf8' },
  )
  assert.equal(archived.status, 0, archived.stderr)
  const checksum = createHash('sha256').update(readFileSync(assetPath)).digest('hex')
  writeFileSync(
    join(releaseDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 2,
      version: 'next-e2e',
      binaryVersion: version,
      cloudflaredVersion,
      channel: 'beta',
      assets: { [platform]: { name: assetName, sha256: checksum } },
    }),
  )
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(
    join(stateDir, 'install.json'),
    `${JSON.stringify({
      method: 'script',
      channel: 'beta',
      version: 'previous-e2e',
      repo: 'astrale-os/cli',
      bin: installedBinary,
      cohort: {
        schemaVersion: 2,
        binaryVersion: version,
        cloudflaredVersion,
      },
    })}\n`,
  )

  const qualificationEnvironment = {
    ...process.env,
    ASTRALE_UPDATE_BASE: `file://${releaseDir}`,
    ASTRALE_HOME: stateDir,
    ASTRALE_SKILLS_HOME: skillRoot,
    XDG_STATE_HOME: join(updateRoot, 'xdg-state'),
    NO_SPINNER: '1',
    CI: '1',
  }
  const configured = spawnSync(
    installedBinary,
    ['skills', 'configure', '--agent', 'codex', 'claude-code', '--json'],
    {
      cwd: cliRoot,
      env: qualificationEnvironment,
      encoding: 'utf8',
      timeout: 180_000,
    },
  )
  assert.equal(configured.status, 0, `${configured.stdout}\n${configured.stderr}`)

  const updated = spawnSync(installedBinary, ['update', '--yes', '--no-deps'], {
    cwd: cliRoot,
    env: qualificationEnvironment,
    encoding: 'utf8',
    timeout: 180_000,
  })
  assert.equal(updated.status, 0, `${updated.stdout}\n${updated.stderr}`)
  const installed = JSON.parse(readFileSync(join(stateDir, 'install.json'), 'utf8'))
  assert.equal(installed.version, 'next-e2e')
  assert.equal(installed.cohort.cloudflaredVersion, cloudflaredVersion)
  assert.equal(existsSync(installedCloudflared), true)
  assert.equal(existsSync(join(licenseDir, 'cloudflared.txt')), true)
  for (const name of skillNames) {
    assert.equal(existsSync(join(skillRoot, '.agents', 'skills', name, 'SKILL.md')), true)
  }
}

try {
  const updateCase = environment('update')
  execute(['skills', 'configure', '--agent', 'codex', 'claude-code', '--json'], updateCase.env)

  const installedLock = readLock(updateCase.lockPath)
  assert.equal(installedLock.version, 3)
  assert.deepEqual(installedLock.lastSelectedAgents, ['codex', 'claude-code'])
  assert.deepEqual(Object.keys(installedLock.skills).sort(), skillNames)
  for (const name of skillNames) {
    assert.deepEqual(
      {
        source: installedLock.skills[name].source,
        sourceType: installedLock.skills[name].sourceType,
        sourceUrl: installedLock.skills[name].sourceUrl,
        ref: installedLock.skills[name].ref,
        skillPath: installedLock.skills[name].skillPath,
      },
      {
        source: 'astrale-os/cli',
        sourceType: 'github',
        sourceUrl: 'https://github.com/astrale-os/cli.git',
        ref: 'main',
        skillPath: `skills/${name}/SKILL.md`,
      },
    )
    assert.match(installedLock.skills[name].skillFolderHash, /^[0-9a-f]{40}$/u)
    assert.equal(
      resolve(
        dirname(join(updateCase.skillRoot, '.claude', 'skills', name)),
        readlinkSync(join(updateCase.skillRoot, '.claude', 'skills', name)),
      ),
      join(updateCase.skillRoot, '.agents', 'skills', name),
    )
  }

  const staleLock = structuredClone(installedLock)
  for (const entry of Object.values(staleLock.skills)) entry.ref = 'stale'
  writeFileSync(updateCase.lockPath, `${JSON.stringify(staleLock, null, 2)}\n`)
  assert.equal(status(updateCase.env).status, 'update-available')
  assert.equal(updateSkills(updateCase.env).status, 'updated')

  const afterUpdate = canonicalSnapshot(updateCase)
  assert.equal(updateSkills(updateCase.env).status, 'unchanged')
  assert.equal(canonicalSnapshot(updateCase), afterUpdate)
  const checked = status(updateCase.env)
  assert.equal(checked.status, 'current')
  assert.equal(checked.source.repository, 'astrale-os/cli')
  if (process.env.ASTRALE_E2E_CLI) {
    assert.match(process.env.ASTRALE_E2E_SOURCE_REVISION ?? '', /^[0-9a-f]{40}$/u)
    assert.equal(checked.source.revision, process.env.ASTRALE_E2E_SOURCE_REVISION)
  } else {
    assert.match(checked.source.revision, /^cli:(?:[0-9a-f]{40})(?::[0-9a-f]{40})*$/u)
  }
  assert.deepEqual(checked.source.skills.map(({ name }) => name).sort(), skillNames)
  const receipt = readLock(updateCase.lockPath)
  for (const skill of checked.source.skills) {
    assert.match(skill.tree, /^[0-9a-f]{40}$/u)
    assert.equal(receipt.skills[skill.name].astraleSourceRevision, checked.source.revision)
    assert.equal(receipt.skills[skill.name].astraleSourceTree, skill.tree)
  }

  const repairedName = skillNames[0]
  const expected = readFileSync(
    join(updateCase.skillRoot, '.agents', 'skills', repairedName, 'SKILL.md'),
    'utf8',
  )
  writeFileSync(
    join(updateCase.skillRoot, '.agents', 'skills', repairedName, 'SKILL.md'),
    'tampered\n',
  )
  rmSync(join(updateCase.skillRoot, '.claude', 'skills', repairedName))
  assert.equal(status(updateCase.env).status, 'repair-needed')
  assert.equal(updateSkills(updateCase.env).status, 'repaired')
  assert.equal(
    readFileSync(join(updateCase.skillRoot, '.agents', 'skills', repairedName, 'SKILL.md'), 'utf8'),
    expected,
  )

  const installCase = environment('install')
  assert.equal(updateSkills(installCase.env).status, 'installed')
  for (const name of skillNames) {
    assert.equal(
      existsSync(join(installCase.skillRoot, '.agents', 'skills', name, 'SKILL.md')),
      true,
    )
  }

  if (process.env.ASTRALE_E2E_CLI) {
    qualifySelfUpdate(resolve(cliRoot, process.env.ASTRALE_E2E_CLI))
  }

  console.log(
    'native skills E2E passed: compatible lock, installed, updated, unchanged, repaired, self-update',
  )
} finally {
  rmSync(root, { recursive: true, force: true })
}
