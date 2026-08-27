import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  admitScriptInstall,
  classifyUpdateExecution,
  DEFAULT_UPDATE_CHANNEL,
  InstallMetadataSchema,
  readInstallMetadata,
  releaseBase,
  replaceStandaloneCohort,
  shouldUpdate,
  updateAstrale,
  writeInstallMetadata,
  type InstallMetadata,
  type UpdateExecution,
} from '../update'

async function makeFakeRelease(
  root: string,
  version: string,
  options: { binaryVersion?: string; legacyManifest?: boolean; omitBinary?: boolean } = {},
): Promise<string> {
  const release = join(root, 'release')
  const payload = join(root, 'payload')
  const binaryVersion = options.binaryVersion ?? version
  await mkdir(release, { recursive: true })
  await mkdir(payload, { recursive: true })
  if (options.omitBinary) {
    await writeFile(join(payload, 'README'), 'intentionally incomplete release\n')
  } else {
    await writeFile(
      join(payload, 'astrale'),
      `#!/usr/bin/env sh\nif [ "$1" = "--version" ]; then echo "${binaryVersion}"; exit 0; fi\necho astrale\n`,
    )
    await chmod(join(payload, 'astrale'), 0o755)
  }

  const asset = join(release, 'astrale-darwin-arm64.tar.gz')
  const tar = Bun.spawn([
    'tar',
    '-C',
    payload,
    '-czf',
    asset,
    options.omitBinary ? 'README' : 'astrale',
  ])
  expect(await tar.exited).toBe(0)
  const shaProc = Bun.spawn(['shasum', '-a', '256', asset], { stdout: 'pipe' })
  const sha = (await new Response(shaProc.stdout).text()).trim().split(/\s+/)[0]
  expect(await shaProc.exited).toBe(0)
  await writeFile(join(release, 'sha256sums.txt'), `${sha}  astrale-darwin-arm64.tar.gz\n`)
  await writeFile(
    join(release, 'manifest.json'),
    JSON.stringify(
      {
        version,
        binaryVersion: options.binaryVersion,
        channel: 'alpha',
        repo: 'astrale-os/cli',
        assets: options.legacyManifest
          ? {
              'darwin-arm64': 'astrale-darwin-arm64.tar.gz',
            }
          : {
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
): Promise<{ meta: InstallMetadata; path: string; execution: UpdateExecution }> {
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
  return { meta, path, execution: { kind: 'standalone', executable: bin } }
}

describe('update helpers', () => {
  test('classifies only a Bun-compiled executable as standalone', () => {
    expect(
      classifyUpdateExecution({
        bunVersion: '1.3.14',
        executable: '/tmp/astrale',
        entry: '/$bunfs/root/astrale',
      }),
    ).toEqual({ kind: 'standalone', executable: '/tmp/astrale' })
    expect(
      classifyUpdateExecution({
        bunVersion: '1.3.14',
        executable: '/opt/homebrew/bin/bun',
        entry: '/tmp/astrale.ts',
      }),
    ).toEqual({ kind: 'package-managed', executable: '/opt/homebrew/bin/bun' })
    expect(
      classifyUpdateExecution({
        executable: '/opt/homebrew/bin/node',
        entry: '/tmp/astrale.js',
      }),
    ).toEqual({ kind: 'package-managed', executable: '/opt/homebrew/bin/node' })
  })

  test('defaults missing install metadata to the beta channel', () => {
    expect(DEFAULT_UPDATE_CHANNEL).toBe('beta')
    expect(
      InstallMetadataSchema.parse({
        method: 'script',
        bin: '/tmp/astrale',
      }).channel,
    ).toBe('beta')
  })

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

describe('script install admission', () => {
  test('a metadata commit failure restores the exact previous file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const path = join(root, 'install.json')
    const original = '{"exact":"previous metadata"}\n'
    await writeFile(path, original)

    await expect(
      writeInstallMetadata(
        {
          method: 'script',
          channel: 'beta',
          version: '1.1.0',
          repo: 'astrale-os/cli',
          bin: '/tmp/astrale',
        },
        path,
        {
          mkdir,
          rm,
          writeFile,
          rename: async (from, to) => {
            if (String(from).endsWith('.next')) throw new Error('injected metadata commit failure')
            await rename(from, to)
          },
        },
      ),
    ).rejects.toThrow('injected metadata commit failure')

    expect(await readFile(path, 'utf8')).toBe(original)
    await expect(readFile(`${path}.next`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(`${path}.previous`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('rejects malformed JSON with the stable metadata error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const path = join(root, 'install.json')
    await writeFile(path, '{')

    await expect(readInstallMetadata(path)).rejects.toMatchObject({
      code: 'UPDATE_BAD_INSTALL_METADATA',
    })
  })

  test('admits a symlink only when it resolves to the recorded binary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const { meta } = await makeInstall(root, '1.0.0')
    const alias = join(root, 'astrale-alias')
    await symlink(meta.bin, alias)

    const admitted = await admitScriptInstall(meta, {
      kind: 'standalone',
      executable: alias,
    })

    expect(admitted.metadata).toEqual(meta)
  })

  test('rejects a standalone binary that does not own the recorded target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const { meta } = await makeInstall(root, '1.0.0')
    const other = join(root, 'other-astrale')
    await writeFile(other, '#!/bin/sh\n')

    await expect(
      admitScriptInstall(meta, { kind: 'standalone', executable: other }),
    ).rejects.toMatchObject({ code: 'UPDATE_INSTALL_MISMATCH' })
  })
})

describe('updateAstrale', () => {
  test('a package-managed process never consults or mutates a coexisting script install', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const { path, meta } = await makeInstall(root, '1.0.0')
    const before = await readFile(meta.bin, 'utf8')
    process.env.ASTRALE_UPDATE_BASE = 'file:///definitely-not-a-release'
    try {
      const result = await updateAstrale({
        currentVersion: '2.0.0',
        installPath: path,
        execution: { kind: 'package-managed', executable: '/opt/homebrew/bin/node' },
      })

      expect(result).toEqual({
        status: 'managed',
        currentVersion: '2.0.0',
        executable: '/opt/homebrew/bin/node',
      })
      expect(await readFile(meta.bin, 'utf8')).toBe(before)
    } finally {
      delete process.env.ASTRALE_UPDATE_BASE
    }
  })

  test('check compares the installed release identity from metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const { path, execution } = await makeInstall(root, 'main-abc123')
    const release = await makeFakeRelease(root, 'main-abc123', { binaryVersion: '1.0.0' })
    process.env.ASTRALE_UPDATE_BASE = `file://${release}`
    try {
      const result = await updateAstrale({
        check: true,
        currentVersion: '1.0.0',
        platform: { os: 'darwin', arch: 'arm64' },
        installPath: path,
        execution,
      })

      expect(result).toMatchObject({
        status: 'up-to-date',
        currentVersion: 'main-abc123',
        latestVersion: 'main-abc123',
      })
    } finally {
      delete process.env.ASTRALE_UPDATE_BASE
    }
  })

  test('check reports available update without replacing the binary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const { path, meta, execution } = await makeInstall(root, '1.0.0')
    const release = await makeFakeRelease(root, '1.1.0')
    process.env.ASTRALE_UPDATE_BASE = `file://${release}`
    try {
      const result = await updateAstrale({
        check: true,
        currentVersion: '1.0.0',
        platform: { os: 'darwin', arch: 'arm64' },
        installPath: path,
        execution,
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

  test('supports legacy string asset manifests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const { path, meta, execution } = await makeInstall(root, '1.0.0')
    const release = await makeFakeRelease(root, '1.1.0', { legacyManifest: true })
    process.env.ASTRALE_UPDATE_BASE = `file://${release}`
    try {
      const check = await updateAstrale({
        check: true,
        currentVersion: '1.0.0',
        platform: { os: 'darwin', arch: 'arm64' },
        installPath: path,
        execution,
      })

      expect(check).toMatchObject({
        status: 'available',
        latestVersion: '1.1.0',
      })

      const result = await updateAstrale({
        currentVersion: '1.0.0',
        platform: { os: 'darwin', arch: 'arm64' },
        installPath: path,
        execution,
      })

      expect(result).toMatchObject({
        status: 'updated',
        currentVersion: '1.1.0',
      })
      const versionProc = Bun.spawn([meta.bin, '--version'], { stdout: 'pipe' })
      expect(await new Response(versionProc.stdout).text()).toBe('1.1.0\n')
      expect(await versionProc.exited).toBe(0)
    } finally {
      delete process.env.ASTRALE_UPDATE_BASE
    }
  })

  test('updates the binary and install metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const { path, meta, execution } = await makeInstall(root, '1.0.0')
    const release = await makeFakeRelease(root, '1.1.0')
    process.env.ASTRALE_UPDATE_BASE = `file://${release}`
    try {
      const result = await updateAstrale({
        currentVersion: '1.0.0',
        platform: { os: 'darwin', arch: 'arm64' },
        installPath: path,
        execution,
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

  test('an archive without the binary leaves the installation and metadata unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const { path, meta, execution } = await makeInstall(root, '1.0.0')
    const release = await makeFakeRelease(root, '1.1.0', { omitBinary: true })
    process.env.ASTRALE_UPDATE_BASE = `file://${release}`
    const beforeBinary = await readFile(meta.bin, 'utf8')
    const beforeMetadata = await readFile(path, 'utf8')
    try {
      await expect(
        updateAstrale({
          currentVersion: '1.0.0',
          platform: { os: 'darwin', arch: 'arm64' },
          installPath: path,
          execution,
        }),
      ).rejects.toThrow()

      expect(await readFile(meta.bin, 'utf8')).toBe(beforeBinary)
      expect(await readFile(path, 'utf8')).toBe(beforeMetadata)
    } finally {
      delete process.env.ASTRALE_UPDATE_BASE
    }
  })

  test('a binary commit failure preserves the installed binary and metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const { path, meta, execution } = await makeInstall(root, '1.0.0')
    const release = await makeFakeRelease(root, '1.1.0')
    process.env.ASTRALE_UPDATE_BASE = `file://${release}`
    const beforeBinary = await readFile(meta.bin, 'utf8')
    const beforeMetadata = await readFile(path, 'utf8')
    try {
      await expect(
        updateAstrale(
          {
            currentVersion: '1.0.0',
            platform: { os: 'darwin', arch: 'arm64' },
            installPath: path,
            execution,
          },
          {
            replaceStandaloneCohort: (installed, next) =>
              replaceStandaloneCohort(installed, next, {
                rename: async (
                  from: Parameters<typeof rename>[0],
                  to: Parameters<typeof rename>[1],
                ) => {
                  if (String(from).endsWith('astrale.next')) {
                    throw Object.assign(new Error('injected binary commit failure'), {
                      code: 'EIO',
                    })
                  }
                  await rename(from, to)
                },
              }),
          },
        ),
      ).rejects.toThrow('injected binary commit failure')

      expect(await readFile(meta.bin, 'utf8')).toBe(beforeBinary)
      expect(await readFile(path, 'utf8')).toBe(beforeMetadata)
    } finally {
      delete process.env.ASTRALE_UPDATE_BASE
    }
  })

  test('a metadata failure after binary commit restores the binary and metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const { path, meta, execution } = await makeInstall(root, '1.0.0')
    const release = await makeFakeRelease(root, '1.1.0')
    process.env.ASTRALE_UPDATE_BASE = `file://${release}`
    const beforeBinary = await readFile(meta.bin, 'utf8')
    const beforeMetadata = await readFile(path, 'utf8')
    try {
      await expect(
        updateAstrale(
          {
            currentVersion: '1.0.0',
            platform: { os: 'darwin', arch: 'arm64' },
            installPath: path,
            execution,
          },
          {
            writeInstallMetadata: async () => {
              throw new Error('injected metadata write failure')
            },
          },
        ),
      ).rejects.toThrow('injected metadata write failure')

      expect(await readFile(meta.bin, 'utf8')).toBe(beforeBinary)
      expect(await readFile(path, 'utf8')).toBe(beforeMetadata)
    } finally {
      delete process.env.ASTRALE_UPDATE_BASE
    }
  })

  test('updates canary-style releases whose binary reports the package version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const { path, meta, execution } = await makeInstall(root, 'main-old123')
    const release = await makeFakeRelease(root, 'main-new456', { binaryVersion: '1.0.0' })
    process.env.ASTRALE_UPDATE_BASE = `file://${release}`
    try {
      const result = await updateAstrale({
        currentVersion: '1.0.0',
        platform: { os: 'darwin', arch: 'arm64' },
        installPath: path,
        execution,
      })

      expect(result).toMatchObject({
        status: 'updated',
        previousVersion: 'main-old123',
        currentVersion: 'main-new456',
      })
      const versionProc = Bun.spawn([meta.bin, '--version'], { stdout: 'pipe' })
      expect(await new Response(versionProc.stdout).text()).toBe('1.0.0\n')
      expect(await versionProc.exited).toBe(0)
      const updatedMeta = JSON.parse(await readFile(path, 'utf8')) as InstallMetadata
      expect(updatedMeta.version).toBe('main-new456')
    } finally {
      delete process.env.ASTRALE_UPDATE_BASE
    }
  })
})
