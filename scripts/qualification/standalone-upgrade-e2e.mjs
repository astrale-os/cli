import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { packageReleaseAsset } from '../package-release-asset.mjs'

// Use real standalone binaries, but never their installation or user state.
const [previousPath, candidatePath, ...extra] = process.argv.slice(2)
assert.ok(
  previousPath && candidatePath && extra.length === 0,
  'Usage: node scripts/qualification/standalone-upgrade-e2e.mjs <previous-astrale> <candidate-astrale>',
)
const previous = resolve(previousPath)
const candidate = resolve(candidatePath)
const root = mkdtempSync(join(tmpdir(), 'astrale-standalone-upgrade-'))

function execute(binary, args, env) {
  return spawnSync(binary, args, { cwd: root, env, encoding: 'utf8', timeout: 60_000 })
}

try {
  for (const retainedCompanion of [false, true]) {
    const base = join(root, retainedCompanion ? 'retained' : 'missing')
    const install = join(base, 'bin')
    const state = join(base, 'state')
    const release = join(base, 'release')
    for (const directory of [install, state, release]) mkdirSync(directory, { recursive: true })
    const env = {
      ...process.env,
      ASTRALE_HOME: state,
      ASTRALE_SKILLS_HOME: join(base, 'skills'),
      XDG_STATE_HOME: join(base, 'xdg-state'),
      ASTRALE_UPDATE_BASE: `file://${release}`,
      CI: '1',
      NO_SPINNER: '1',
    }
    const oldVersion = execute(previous, ['--version'], env)
    const nextVersion = execute(candidate, ['--version'], env)
    assert.equal(oldVersion.status, 0, oldVersion.stderr)
    assert.equal(nextVersion.status, 0, nextVersion.stderr)
    const binary = join(install, 'astrale')
    copyFileSync(previous, binary)
    const companion = join(install, 'astrale-cloudflared')
    const license = join(state, 'licenses', 'cloudflared.txt')
    const invoked = join(base, 'companion-invoked')
    if (retainedCompanion) {
      mkdirSync(join(state, 'licenses'))
      writeFileSync(companion, `#!/bin/sh\ntouch '${invoked}'\nexit 1\n`, { mode: 0o755 })
      writeFileSync(license, 'retained historical license\n')
    }
    const metadata = join(state, 'install.json')
    writeFileSync(
      metadata,
      JSON.stringify({
        method: 'script',
        channel: 'beta',
        version: oldVersion.stdout.trim(),
        repo: 'astrale-os/cli',
        bin: binary,
        cohort: {
          schemaVersion: 2,
          binaryVersion: oldVersion.stdout.trim(),
          cloudflaredVersion: '2026.8.2',
        },
      }),
    )
    const beforeBinary = readFileSync(binary)
    const beforeMetadata = readFileSync(metadata)
    const name = `astrale-${process.platform}-${process.arch}.tar.gz`
    const archive = packageReleaseAsset(readFileSync(candidate))
    writeFileSync(join(release, name), archive)
    const sha256 = createHash('sha256').update(archive).digest('hex')
    const manifest = {
      version: 'next-upgrade-qualification',
      binaryVersion: nextVersion.stdout.trim(),
      channel: 'beta',
      repo: 'astrale-os/cli',
      assets: { [`${process.platform}-${process.arch}`]: { name, sha256: '0'.repeat(64) } },
    }
    const manifestPath = join(release, 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const args = ['update', '--yes', '--no-deps', '--no-skills']
    const rejected = execute(binary, args, env)
    assert.notEqual(rejected.status, 0)
    assert.match(`${rejected.stdout}\n${rejected.stderr}`, /checksum/i)
    assert.deepEqual(readFileSync(binary), beforeBinary)
    assert.deepEqual(readFileSync(metadata), beforeMetadata)

    manifest.assets[`${process.platform}-${process.arch}`].sha256 = sha256
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const result = execute(binary, args, env)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.deepEqual(readFileSync(binary), readFileSync(candidate))
    const installed = JSON.parse(readFileSync(metadata, 'utf8'))
    assert.equal(installed.version, manifest.version)
    assert.equal(installed.cohort, undefined)
    assert.equal(existsSync(companion), retainedCompanion)
    assert.equal(existsSync(license), retainedCompanion)
    assert.equal(existsSync(invoked), false)
    if (retainedCompanion) {
      assert.equal(readFileSync(license, 'utf8'), 'retained historical license\n')
    }
    assert.equal(existsSync(join(install, '.astrale-install.lock')), false)
    console.log(
      `${oldVersion.stdout.trim()} -> ${nextVersion.stdout.trim()}: checksum rejection and upgrade pass; companion ${retainedCompanion ? 'untouched' : 'absent'}`,
    )
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}
