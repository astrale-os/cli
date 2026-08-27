import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('standalone installer places one self-contained binary', () => {
  const root = mkdtempSync(join(tmpdir(), 'astrale-install-script-'))
  const release = join(root, 'release')
  const payload = join(root, 'payload')
  const install = join(root, 'install')
  const state = join(root, 'state')
  const invocations = join(root, 'invocations.log')
  mkdirSync(payload, { recursive: true })
  mkdirSync(release, { recursive: true })
  const binary = join(payload, 'astrale')
  writeFileSync(
    binary,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.0.0-beta.test; exit 0; fi\nprintf "%s\\n" "$*" >> "$ASTRALE_TEST_INVOCATIONS"\n',
  )
  chmodSync(binary, 0o755)

  const platform = process.platform === 'darwin' ? 'darwin' : 'linux'
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x64'
  const asset = `astrale-${platform}-${architecture}.tar.gz`
  execFileSync('tar', ['-C', payload, '-czf', join(release, asset), 'astrale'])
  const checksum = execFileSync('shasum', ['-a', '256', join(release, asset)], {
    encoding: 'utf8',
  }).split(/\s+/u)[0]
  writeFileSync(join(release, 'sha256sums.txt'), `${checksum}  ${asset}\n`)
  writeFileSync(
    join(release, 'manifest.json'),
    JSON.stringify({ version: '1.0.0-beta.test', channel: 'beta' }),
  )

  const installed = spawnSync('sh', ['install.sh'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ASTRALE_DOWNLOAD_BASE: `file://${release}`,
      ASTRALE_INSTALL_DIR: install,
      ASTRALE_HOME: state,
      ASTRALE_TEST_INVOCATIONS: invocations,
    },
  })
  assert.equal(installed.status, 0, installed.stderr)
  assert.equal(
    execFileSync(join(install, 'astrale'), ['--version'], { encoding: 'utf8' }),
    '1.0.0-beta.test\n',
  )
  assert.match(
    readFileSync(join(state, 'install.json'), 'utf8'),
    /"version": "1\.0\.0-beta\.test"/u,
  )
  assert.match(readFileSync(invocations, 'utf8'), /^skills update --json$/mu)
})
