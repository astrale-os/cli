import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const platforms = [
  { os: 'darwin', arch: 'arm64', unameS: 'Darwin', unameM: 'arm64' },
  { os: 'darwin', arch: 'x64', unameS: 'Darwin', unameM: 'x86_64' },
  { os: 'linux', arch: 'arm64', unameS: 'Linux', unameM: 'aarch64' },
  { os: 'linux', arch: 'x64', unameS: 'Linux', unameM: 'x86_64' },
]

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'astrale-install-script-'))
  const release = join(root, 'release')
  const payload = join(root, 'payload')
  const fakeBin = join(root, 'fake-bin')
  mkdirSync(payload, { recursive: true })
  mkdirSync(release, { recursive: true })
  mkdirSync(fakeBin, { recursive: true })

  writeFileSync(
    join(payload, 'astrale'),
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.0.0-beta.test; exit 0; fi\nprintf "%s\\n" "$*" >> "$ASTRALE_TEST_INVOCATIONS"\n',
  )
  writeFileSync(
    join(payload, 'astrale-cloudflared'),
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "cloudflared version 2026.8.2 (fixture)"; exit 0; fi\n',
  )
  chmodSync(join(payload, 'astrale'), 0o755)
  chmodSync(join(payload, 'astrale-cloudflared'), 0o755)
  copyFileSync('licenses/cloudflared.txt', join(payload, 'LICENSE.cloudflared'))

  const checksums = []
  const assets = {}
  for (const { os, arch } of platforms) {
    const name = `astrale-${os}-${arch}.tar.gz`
    const path = join(release, name)
    execFileSync('tar', [
      '-C',
      payload,
      '-czf',
      path,
      'astrale',
      'astrale-cloudflared',
      'LICENSE.cloudflared',
    ])
    const sha256 = execFileSync('shasum', ['-a', '256', path], { encoding: 'utf8' }).split(
      /\s+/u,
    )[0]
    checksums.push(`${sha256}  ${name}`)
    assets[`${os}-${arch}`] = { name, sha256 }
  }
  writeFileSync(join(release, 'sha256sums.txt'), `${checksums.join('\n')}\n`)
  writeFileSync(
    join(release, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 2,
        version: '1.0.0-beta.test',
        binaryVersion: '1.0.0-beta.test',
        cloudflaredVersion: '2026.8.2',
        channel: 'beta',
        repo: 'astrale-os/cli',
        assets,
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(fakeBin, 'uname'),
    '#!/bin/sh\nif [ "$1" = "-s" ]; then printf "%s\\n" "$ASTRALE_TEST_UNAME_S"; else printf "%s\\n" "$ASTRALE_TEST_UNAME_M"; fi\n',
  )
  writeFileSync(
    join(fakeBin, 'mv'),
    '#!/bin/sh\nif [ "${ASTRALE_TEST_FAIL_METADATA:-}" = "1" ] && [ "${2:-}" = "$ASTRALE_HOME/install.json" ]; then exit 1; fi\nexec /bin/mv "$@"\n',
  )
  chmodSync(join(fakeBin, 'uname'), 0o755)
  chmodSync(join(fakeBin, 'mv'), 0o755)
  return { root, release, fakeBin }
}

function installEnvironment(owner, platform, name) {
  const install = join(owner.root, `install-${name}`)
  const state = join(owner.root, `state-${name}`)
  const invocations = join(owner.root, `invocations-${name}.log`)
  return {
    install,
    state,
    invocations,
    env: {
      ...process.env,
      PATH: `${owner.fakeBin}:${process.env.PATH}`,
      ASTRALE_DOWNLOAD_BASE: `file://${owner.release}`,
      ASTRALE_INSTALL_DIR: install,
      ASTRALE_HOME: state,
      ASTRALE_TEST_INVOCATIONS: invocations,
      ASTRALE_TEST_UNAME_S: platform.unameS,
      ASTRALE_TEST_UNAME_M: platform.unameM,
    },
  }
}

function runInstaller(environment) {
  return spawnSync('sh', ['install.sh'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: environment.env,
  })
}

test('standalone installer places one verified cohort on all four admitted platforms', () => {
  const owner = fixture()
  try {
    for (const platform of platforms) {
      const name = `${platform.os}-${platform.arch}`
      const environment = installEnvironment(owner, platform, name)
      const installed = runInstaller(environment)
      assert.equal(installed.status, 0, `${name}: ${installed.stderr}`)
      assert.equal(
        execFileSync(join(environment.install, 'astrale'), ['--version'], { encoding: 'utf8' }),
        '1.0.0-beta.test\n',
      )
      assert.match(
        execFileSync(join(environment.install, 'astrale-cloudflared'), ['--version'], {
          encoding: 'utf8',
        }),
        /cloudflared version 2026\.8\.2/u,
      )
      assert.equal(
        readFileSync(join(environment.state, 'licenses', 'cloudflared.txt'), 'utf8'),
        readFileSync('licenses/cloudflared.txt', 'utf8'),
      )
      assert.equal(statSync(join(environment.install, 'astrale')).mode & 0o777, 0o755)
      assert.equal(statSync(join(environment.install, 'astrale-cloudflared')).mode & 0o777, 0o755)
      assert.equal(
        statSync(join(environment.state, 'licenses', 'cloudflared.txt')).mode & 0o777,
        0o644,
      )
      const metadata = JSON.parse(readFileSync(join(environment.state, 'install.json'), 'utf8'))
      assert.equal(metadata.version, '1.0.0-beta.test')
      assert.deepEqual(metadata.cohort, {
        schemaVersion: 2,
        binaryVersion: '1.0.0-beta.test',
        cloudflaredVersion: '2026.8.2',
      })
      assert.match(readFileSync(environment.invocations, 'utf8'), /^skills update --json$/mu)
      assert.equal(
        statSync(join(environment.install, '.astrale-install.lock'), { throwIfNoEntry: false }),
        undefined,
      )
    }
  } finally {
    rmSync(owner.root, { recursive: true, force: true })
  }
})

test('installer migrates an existing one-binary script install into the cohort', () => {
  const owner = fixture()
  try {
    const environment = installEnvironment(owner, platforms[0], 'legacy')
    mkdirSync(environment.install, { recursive: true })
    mkdirSync(environment.state, { recursive: true })
    const binary = join(environment.install, 'astrale')
    writeFileSync(binary, '#!/bin/sh\necho legacy\n', { mode: 0o755 })
    writeFileSync(
      join(environment.state, 'install.json'),
      `${JSON.stringify({
        method: 'script',
        channel: 'beta',
        version: 'legacy',
        repo: 'astrale-os/cli',
        bin: binary,
      })}\n`,
    )

    const installed = runInstaller(environment)
    assert.equal(installed.status, 0, installed.stderr)
    assert.equal(execFileSync(binary, ['--version'], { encoding: 'utf8' }), '1.0.0-beta.test\n')
    assert.equal(statSync(join(environment.install, 'astrale-cloudflared')).isFile(), true)
    assert.equal(statSync(join(environment.state, 'licenses', 'cloudflared.txt')).isFile(), true)
    assert.equal(
      JSON.parse(readFileSync(join(environment.state, 'install.json'), 'utf8')).cohort
        .schemaVersion,
      2,
    )
  } finally {
    rmSync(owner.root, { recursive: true, force: true })
  }
})

test('installer excludes a live writer, recovers a dead owner, and fails closed on malformed evidence', () => {
  const owner = fixture()
  try {
    const environment = installEnvironment(owner, platforms[0], 'locking')
    assert.equal(runInstaller(environment).status, 0)
    const before = readFileSync(join(environment.install, 'astrale'))
    const lock = join(environment.install, '.astrale-install.lock')

    mkdirSync(lock)
    writeFileSync(join(lock, 'owner'), `${process.pid} live-owner\n`)
    const concurrent = runInstaller(environment)
    assert.notEqual(concurrent.status, 0)
    assert.match(concurrent.stderr, /Another Astrale install or update is running/u)
    assert.deepEqual(readFileSync(join(environment.install, 'astrale')), before)

    rmSync(lock, { recursive: true })
    mkdirSync(lock)
    writeFileSync(join(lock, 'owner'), '99999999 dead-owner\n')
    const recovered = runInstaller(environment)
    assert.equal(recovered.status, 0, recovered.stderr)
    assert.equal(statSync(lock, { throwIfNoEntry: false }), undefined)

    mkdirSync(lock)
    writeFileSync(join(lock, 'owner'), 'unknown\n')
    const malformed = runInstaller(environment)
    assert.notEqual(malformed.status, 0)
    assert.match(malformed.stderr, /Invalid Astrale install lock/u)
    assert.equal(readFileSync(join(lock, 'owner'), 'utf8'), 'unknown\n')
  } finally {
    rmSync(owner.root, { recursive: true, force: true })
  }
})

test('installer rejects an archive outside the exact cohort closure before replacing files', () => {
  const owner = fixture()
  try {
    const environment = installEnvironment(owner, platforms[0], 'closure')
    assert.equal(runInstaller(environment).status, 0)
    const installed = readFileSync(join(environment.install, 'astrale'))
    const asset = join(owner.release, 'astrale-darwin-arm64.tar.gz')
    const payload = join(owner.root, 'bad-payload')
    mkdirSync(payload)
    writeFileSync(join(payload, 'astrale'), 'unexpected')
    execFileSync('tar', ['-C', payload, '-czf', asset, 'astrale'])
    const sha256 = execFileSync('shasum', ['-a', '256', asset], { encoding: 'utf8' }).split(
      /\s+/u,
    )[0]
    const lines = readFileSync(join(owner.release, 'sha256sums.txt'), 'utf8')
      .trim()
      .split('\n')
      .map((line) =>
        line.endsWith('astrale-darwin-arm64.tar.gz')
          ? `${sha256}  astrale-darwin-arm64.tar.gz`
          : line,
      )
    writeFileSync(join(owner.release, 'sha256sums.txt'), `${lines.join('\n')}\n`)

    const rejected = runInstaller(environment)
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /invalid toolchain closure/u)
    assert.deepEqual(readFileSync(join(environment.install, 'astrale')), installed)
  } finally {
    rmSync(owner.root, { recursive: true, force: true })
  }
})

test('installer restores the prior cohort when metadata cannot commit', () => {
  const owner = fixture()
  try {
    const environment = installEnvironment(owner, platforms[0], 'rollback')
    assert.equal(runInstaller(environment).status, 0)
    const binary = join(environment.install, 'astrale')
    const cloudflared = join(environment.install, 'astrale-cloudflared')
    const license = join(environment.state, 'licenses', 'cloudflared.txt')
    const metadata = join(environment.state, 'install.json')
    writeFileSync(binary, 'prior binary\n')
    writeFileSync(cloudflared, 'prior provider\n')
    writeFileSync(license, 'prior license\n')
    const before = [binary, cloudflared, license, metadata].map((path) => readFileSync(path))

    const rejected = runInstaller({
      ...environment,
      env: { ...environment.env, ASTRALE_TEST_FAIL_METADATA: '1' },
    })
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /metadata.*previous installation was restored/u)
    assert.deepEqual(
      [binary, cloudflared, license, metadata].map((path) => readFileSync(path)),
      before,
    )
    assert.equal(
      statSync(join(environment.install, '.astrale-install.lock'), { throwIfNoEntry: false }),
      undefined,
    )
  } finally {
    rmSync(owner.root, { recursive: true, force: true })
  }
})
