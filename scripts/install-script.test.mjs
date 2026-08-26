import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('standalone installer places one complete binary and viewer cohort', () => {
  const root = mkdtempSync(join(tmpdir(), 'astrale-install-script-'))
  const release = join(root, 'release')
  const payload = join(root, 'payload')
  const install = join(root, 'install')
  const state = join(root, 'state')
  mkdirSync(join(payload, 'viewer', 'dist'), { recursive: true })
  mkdirSync(release, { recursive: true })
  const binary = join(payload, 'astrale')
  writeFileSync(binary, '#!/bin/sh\n[ "$1" = "--version" ] && echo 1.0.0-beta.test\n')
  chmodSync(binary, 0o755)
  writeFileSync(join(payload, 'viewer', 'dist', 'main.js'), 'viewer main\n')
  writeFileSync(join(payload, 'viewer', 'dist', 'index.html'), '<!doctype html>\n')

  const platform = process.platform === 'darwin' ? 'darwin' : 'linux'
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x64'
  const asset = `astrale-${platform}-${architecture}.tar.gz`
  execFileSync('tar', ['-C', payload, '-czf', join(release, asset), 'astrale', 'viewer'])
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
    },
  })
  assert.equal(installed.status, 0, installed.stderr)
  assert.equal(
    execFileSync(join(install, 'astrale'), ['--version'], { encoding: 'utf8' }),
    '1.0.0-beta.test\n',
  )
  assert.equal(readFileSync(join(install, 'viewer', 'dist', 'main.js'), 'utf8'), 'viewer main\n')
  assert.equal(
    readFileSync(join(install, 'viewer', 'dist', 'index.html'), 'utf8'),
    '<!doctype html>\n',
  )
  assert.match(
    readFileSync(join(state, 'install.json'), 'utf8'),
    /"version": "1\.0\.0-beta\.test"/u,
  )
})
