import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  releaseBase,
  shouldUpdate,
  updateAstrale,
  writeInstallMetadata,
  type InstallMetadata,
} from '../update'

async function makeFakeRelease(root: string, version: string): Promise<string> {
  const release = join(root, 'release')
  const payload = join(root, 'payload')
  await mkdir(release, { recursive: true })
  await mkdir(payload, { recursive: true })
  await writeFile(
    join(payload, 'astrale'),
    `#!/usr/bin/env sh\nif [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\necho astrale\n`,
  )
  await chmod(join(payload, 'astrale'), 0o755)

  const asset = join(release, 'astrale-darwin-arm64.tar.gz')
  const tar = Bun.spawn(['tar', '-C', payload, '-czf', asset, 'astrale'])
  expect(await tar.exited).toBe(0)
  const shaProc = Bun.spawn(['shasum', '-a', '256', asset], { stdout: 'pipe' })
  const sha = (await new Response(shaProc.stdout).text()).trim().split(/\s+/)[0]
  expect(await shaProc.exited).toBe(0)
  await writeFile(
    join(release, 'manifest.json'),
    JSON.stringify(
      {
        version,
        channel: 'alpha',
        repo: 'astrale-os/cli',
        assets: {
          'darwin-arm64': {
            name: 'astrale-darwin-arm64.tar.gz',
            sha256: sha,
          },
        },
      },
      null,
      2,
    ),
  )
  return release
}

async function makeInstall(
  root: string,
  version: string,
): Promise<{ meta: InstallMetadata; path: string }> {
  const bin = join(root, 'bin', 'astrale')
  await mkdir(join(root, 'bin'), { recursive: true })
  await writeFile(
    bin,
    `#!/usr/bin/env sh\nif [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\necho old\n`,
  )
  await chmod(bin, 0o755)
  const path = join(root, 'home', 'install.json')
  const meta: InstallMetadata = {
    method: 'script',
    channel: 'alpha',
    version,
    repo: 'astrale-os/cli',
    bin,
  }
  await writeInstallMetadata(meta, path)
  return { meta, path }
}

describe('update helpers', () => {
  test('releaseBase resolves exact versions and channels', () => {
    const meta: InstallMetadata = {
      method: 'script',
      channel: 'alpha',
      repo: 'astrale-os/cli',
      bin: '/tmp/astrale',
    }
    expect(releaseBase(meta, {})).toBe('https://github.com/astrale-os/cli/releases/download/alpha')
    expect(releaseBase(meta, { channel: 'canary' })).toBe(
      'https://github.com/astrale-os/cli/releases/download/canary',
    )
    expect(releaseBase(meta, { version: '0.4.1' })).toBe(
      'https://github.com/astrale-os/cli/releases/download/cli/v0.4.1',
    )
  })

  test('shouldUpdate is exact and predictable', () => {
    expect(shouldUpdate('0.4.0', '0.4.0')).toBe(false)
    expect(shouldUpdate('0.4.0', '0.4.1')).toBe(true)
  })
})

describe('updateAstrale', () => {
  test('check reports available update without replacing the binary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const { path, meta } = await makeInstall(root, '1.0.0')
    const release = await makeFakeRelease(root, '1.1.0')
    process.env.ASTRALE_UPDATE_BASE = `file://${release}`
    try {
      const result = await updateAstrale({
        check: true,
        currentVersion: '1.0.0',
        platform: { os: 'darwin', arch: 'arm64' },
        installPath: path,
      })

      expect(result).toMatchObject({
        status: 'available',
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
      })
      expect(await readFile(meta.bin, 'utf8')).toContain('echo old')
    } finally {
      delete process.env.ASTRALE_UPDATE_BASE
    }
  })

  test('updates the binary and install metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const { path, meta } = await makeInstall(root, '1.0.0')
    const release = await makeFakeRelease(root, '1.1.0')
    process.env.ASTRALE_UPDATE_BASE = `file://${release}`
    try {
      const result = await updateAstrale({
        currentVersion: '1.0.0',
        platform: { os: 'darwin', arch: 'arm64' },
        installPath: path,
      })

      expect(result).toMatchObject({
        status: 'updated',
        previousVersion: '1.0.0',
        currentVersion: '1.1.0',
      })
      const versionProc = Bun.spawn([meta.bin, '--version'], { stdout: 'pipe' })
      expect(await new Response(versionProc.stdout).text()).toBe('1.1.0\n')
      expect(await versionProc.exited).toBe(0)
      const updatedMeta = JSON.parse(await readFile(path, 'utf8')) as InstallMetadata
      expect(updatedMeta.version).toBe('1.1.0')
    } finally {
      delete process.env.ASTRALE_UPDATE_BASE
    }
  })
})
