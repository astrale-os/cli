import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  admitScriptInstall,
  classifyUpdateExecution,
  DEFAULT_UPDATE_CHANNEL,
  InstallMetadataSchema,
  packageManagedUpdateError,
  readInstallMetadata,
  releaseBase,
  replaceStandaloneCohort,
  shouldUpdate,
  updateAstrale,
  writeInstallMetadata,
  type InstallMetadata,
  type UpdateExecution,
  type UpdateRequest,
} from '../update'

async function makeFakeRelease(
  root: string,
  version: string,
  options: {
    binaryVersion?: string
    cloudflaredVersion?: string
    legacyManifest?: boolean
    singleBinaryManifest?: boolean
    omitBinary?: boolean
    omitCloudflared?: boolean
    omitLicense?: boolean
  } = {},
): Promise<string> {
  const release = join(root, 'release')
  const payload = join(root, 'payload')
  const binaryVersion = options.binaryVersion ?? version
  const cohort = !options.legacyManifest && !options.singleBinaryManifest
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
  const cloudflaredVersion = options.cloudflaredVersion ?? '2026.8.2'
  if (cohort && !options.omitCloudflared) {
    await writeFile(
      join(payload, 'astrale-cloudflared'),
      `#!/usr/bin/env sh\nif [ "$1" = "--version" ]; then echo "cloudflared version ${cloudflaredVersion} (fixture)"; exit 0; fi\necho cloudflared\n`,
    )
    await chmod(join(payload, 'astrale-cloudflared'), 0o755)
  }
  if (cohort && !options.omitLicense) {
    await writeFile(join(payload, 'LICENSE.cloudflared'), 'Apache License 2.0 fixture\n')
  }

  const asset = join(release, 'astrale-darwin-arm64.tar.gz')
  const tar = Bun.spawn([
    'tar',
    '-C',
    payload,
    '-czf',
    asset,
    ...(options.omitBinary ? ['README'] : ['astrale']),
    ...(cohort && !options.omitCloudflared ? ['astrale-cloudflared'] : []),
    ...(cohort && !options.omitLicense ? ['LICENSE.cloudflared'] : []),
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
        ...(cohort ? { schemaVersion: 2 } : {}),
        version,
        binaryVersion: options.binaryVersion ?? binaryVersion,
        ...(cohort ? { cloudflaredVersion } : {}),
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
  options: { binaryVersion?: string; cloudflared?: false | string; license?: boolean } = {},
): Promise<{ meta: InstallMetadata; path: string; execution: UpdateExecution }> {
  const bin = join(root, 'bin', 'astrale')
  const cloudflaredVersion =
    options.cloudflared === false ? undefined : (options.cloudflared ?? '2026.8.2')
  await mkdir(join(root, 'bin'), { recursive: true })
  await writeFile(
    bin,
    `#!/usr/bin/env sh\nif [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\necho old\n`,
  )
  await chmod(bin, 0o755)
  if (cloudflaredVersion) {
    await writeFile(
      join(root, 'bin', 'astrale-cloudflared'),
      `#!/usr/bin/env sh\nif [ "$1" = "--version" ]; then echo "cloudflared version ${cloudflaredVersion} (fixture)"; exit 0; fi\n`,
    )
    await chmod(join(root, 'bin', 'astrale-cloudflared'), 0o755)
  }
  const path = join(root, 'home', 'install.json')
  if (options.license !== false && cloudflaredVersion) {
    await mkdir(join(root, 'home', 'licenses'), { recursive: true })
    await writeFile(join(root, 'home', 'licenses', 'cloudflared.txt'), 'installed license\n')
  }
  const meta: InstallMetadata = {
    method: 'script',
    channel: 'alpha',
    version,
    repo: 'astrale-os/cli',
    bin,
    ...(cloudflaredVersion
      ? {
          cohort: {
            schemaVersion: 2 as const,
            binaryVersion: options.binaryVersion ?? version,
            cloudflaredVersion,
          },
        }
      : {}),
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

  test('directs externally managed processes to the standalone installer', () => {
    const error = packageManagedUpdateError('/opt/homebrew/bin/node')
    expect(error.code).toBe('UPDATE_PACKAGE_MANAGED')
    expect(error.hint).toBe(
      'Active runtime: /opt/homebrew/bin/node. Remove any package-managed copy, then install with: curl -fsSL https://raw.githubusercontent.com/astrale-os/cli/main/install.sh | sh',
    )
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
    const { path, execution } = await makeInstall(root, 'main-abc123', {
      binaryVersion: '1.0.0',
    })
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

  test('single-binary updates clear cohort metadata without probing or replacing retained files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-single-'))
    const { path, meta, execution } = await makeInstall(root, '1.0.0')
    const companion = join(root, 'bin', 'astrale-cloudflared')
    const license = join(root, 'home', 'licenses', 'cloudflared.txt')
    await writeFile(companion, 'unusable retained provider')
    const before = await Promise.all(
      [meta.bin, companion, license, path].map((file) => readFile(file)),
    )
    const release = await makeFakeRelease(root, '1.1.0', { singleBinaryManifest: true })
    // A current release carries its digest, with no checksum-list fallback needed.
    await rm(join(release, 'sha256sums.txt'))
    process.env.ASTRALE_UPDATE_BASE = `file://${release}`
    try {
      const options = {
        currentVersion: '1.0.0',
        platform: { os: 'darwin', arch: 'arm64' },
        installPath: path,
        execution,
      } satisfies UpdateRequest
      await expect(
        updateAstrale(options, {
          writeInstallMetadata: async () => {
            throw new Error('metadata refused')
          },
        }),
      ).rejects.toThrow('metadata refused')
      expect(
        await Promise.all([meta.bin, companion, license, path].map((file) => readFile(file))),
      ).toEqual(before)
      expect(await updateAstrale(options)).toMatchObject({
        status: 'updated',
        currentVersion: '1.1.0',
      })
      expect((await readInstallMetadata(path))?.cohort).toBeUndefined()
      expect(await Promise.all([companion, license].map((file) => readFile(file)))).toEqual(
        before.slice(1, 3),
      )
    } finally {
      delete process.env.ASTRALE_UPDATE_BASE
      await rm(root, { recursive: true, force: true })
    }
  })

  test('single-binary manifest cannot admit an archive with companion files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-closure-'))
    const { path, meta, execution } = await makeInstall(root, '1.0.0')
    const release = await makeFakeRelease(root, '1.1.0')
    const manifestPath = join(release, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete manifest.schemaVersion
    delete manifest.cloudflaredVersion
    await writeFile(manifestPath, JSON.stringify(manifest))
    const before = await Promise.all([meta.bin, path].map((file) => readFile(file)))
    process.env.ASTRALE_UPDATE_BASE = `file://${release}`
    try {
      await expect(
        updateAstrale({
          currentVersion: '1.0.0',
          platform: { os: 'darwin', arch: 'arm64' },
          installPath: path,
          execution,
        }),
      ).rejects.toThrow('Update archive closure is invalid')
      expect(await Promise.all([meta.bin, path].map((file) => readFile(file)))).toEqual(before)
    } finally {
      delete process.env.ASTRALE_UPDATE_BASE
      await rm(root, { recursive: true, force: true })
    }
  })

  test('updates the exact executable cohort, license, and install metadata', async () => {
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
      const cloudflaredProc = Bun.spawn([join(root, 'bin', 'astrale-cloudflared'), '--version'], {
        stdout: 'pipe',
      })
      expect(await new Response(cloudflaredProc.stdout).text()).toContain(
        'cloudflared version 2026.8.2',
      )
      expect(await cloudflaredProc.exited).toBe(0)
      expect(await readFile(join(root, 'home', 'licenses', 'cloudflared.txt'), 'utf8')).toBe(
        'Apache License 2.0 fixture\n',
      )
      const updatedMeta = JSON.parse(await readFile(path, 'utf8')) as InstallMetadata
      expect(updatedMeta.version).toBe('1.1.0')
      expect(updatedMeta.cohort).toEqual({
        schemaVersion: 2,
        binaryVersion: '1.1.0',
        cloudflaredVersion: '2026.8.2',
      })
    } finally {
      delete process.env.ASTRALE_UPDATE_BASE
    }
  })

  test('check reports repair without writing and the real update repairs a legacy missing sibling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const { path, meta, execution } = await makeInstall(root, '1.1.0', {
      cloudflared: false,
      license: false,
    })
    const release = await makeFakeRelease(root, '1.1.0')
    process.env.ASTRALE_UPDATE_BASE = `file://${release}`
    try {
      const check = await updateAstrale({
        check: true,
        currentVersion: '1.1.0',
        platform: { os: 'darwin', arch: 'arm64' },
        installPath: path,
        execution,
      })
      expect(check).toMatchObject({ status: 'repair-available', currentVersion: '1.1.0' })
      await expect(readFile(join(root, 'bin', 'astrale-cloudflared'))).rejects.toMatchObject({
        code: 'ENOENT',
      })

      const repaired = await updateAstrale({
        currentVersion: '1.1.0',
        platform: { os: 'darwin', arch: 'arm64' },
        installPath: path,
        execution,
      })
      expect(repaired).toMatchObject({ status: 'repaired', currentVersion: '1.1.0' })
      expect(await readFile(meta.bin, 'utf8')).toContain('echo "1.1.0"')
      const cloudflaredProc = Bun.spawn([join(root, 'bin', 'astrale-cloudflared'), '--version'], {
        stdout: 'pipe',
      })
      expect(await new Response(cloudflaredProc.stdout).text()).toContain(
        'cloudflared version 2026.8.2',
      )
      expect(await cloudflaredProc.exited).toBe(0)
      expect(await readFile(join(root, 'home', 'licenses', 'cloudflared.txt'), 'utf8')).toBe(
        'Apache License 2.0 fixture\n',
      )
    } finally {
      delete process.env.ASTRALE_UPDATE_BASE
    }
  })

  test('same-version repair finishes a cohort whose install metadata commit was interrupted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const { path, meta, execution } = await makeInstall(root, '1.1.0')
    await writeInstallMetadata({ ...meta, cohort: undefined }, path)
    const release = await makeFakeRelease(root, '1.1.0')
    process.env.ASTRALE_UPDATE_BASE = `file://${release}`
    try {
      const check = await updateAstrale({
        check: true,
        currentVersion: '1.1.0',
        platform: { os: 'darwin', arch: 'arm64' },
        installPath: path,
        execution,
      })
      expect(check).toMatchObject({ status: 'repair-available' })

      await updateAstrale({
        currentVersion: '1.1.0',
        platform: { os: 'darwin', arch: 'arm64' },
        installPath: path,
        execution,
      })
      const repaired = JSON.parse(await readFile(path, 'utf8')) as InstallMetadata
      expect(repaired.cohort).toEqual({
        schemaVersion: 2,
        binaryVersion: '1.1.0',
        cloudflaredVersion: '2026.8.2',
      })
    } finally {
      delete process.env.ASTRALE_UPDATE_BASE
    }
  })

  test('a cohort archive missing its provider or license leaves the installed cohort unchanged', async () => {
    for (const omission of [{ omitCloudflared: true }, { omitLicense: true }]) {
      const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
      const { path, meta, execution } = await makeInstall(root, '1.0.0')
      const release = await makeFakeRelease(root, '1.1.0', omission)
      process.env.ASTRALE_UPDATE_BASE = `file://${release}`
      const cloudflared = join(root, 'bin', 'astrale-cloudflared')
      const license = join(root, 'home', 'licenses', 'cloudflared.txt')
      const before = await Promise.all([
        readFile(meta.bin, 'utf8'),
        readFile(cloudflared, 'utf8'),
        readFile(license, 'utf8'),
        readFile(path, 'utf8'),
      ])
      try {
        await expect(
          updateAstrale({
            currentVersion: '1.0.0',
            platform: { os: 'darwin', arch: 'arm64' },
            installPath: path,
            execution,
          }),
        ).rejects.toThrow(/archive closure/u)
        expect(
          await Promise.all([
            readFile(meta.bin, 'utf8'),
            readFile(cloudflared, 'utf8'),
            readFile(license, 'utf8'),
            readFile(path, 'utf8'),
          ]),
        ).toEqual(before)
      } finally {
        delete process.env.ASTRALE_UPDATE_BASE
      }
    }
  })

  test('an archive without the binary leaves the installation and metadata unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-update-test-'))
    const { path, meta, execution } = await makeInstall(root, '1.0.0')
    const release = await makeFakeRelease(root, '1.1.0', { omitBinary: true })
    process.env.ASTRALE_UPDATE_BASE = `file://${release}`
    const cloudflared = join(root, 'bin', 'astrale-cloudflared')
    const license = join(root, 'home', 'licenses', 'cloudflared.txt')
    const beforeBinary = await readFile(meta.bin, 'utf8')
    const beforeCloudflared = await readFile(cloudflared, 'utf8')
    const beforeLicense = await readFile(license, 'utf8')
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
      expect(await readFile(cloudflared, 'utf8')).toBe(beforeCloudflared)
      expect(await readFile(license, 'utf8')).toBe(beforeLicense)
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
    const cloudflared = join(root, 'bin', 'astrale-cloudflared')
    const license = join(root, 'home', 'licenses', 'cloudflared.txt')
    const beforeBinary = await readFile(meta.bin, 'utf8')
    const beforeCloudflared = await readFile(cloudflared, 'utf8')
    const beforeLicense = await readFile(license, 'utf8')
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
            replaceStandaloneCohort: (input) =>
              replaceStandaloneCohort(input, {
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
      expect(await readFile(cloudflared, 'utf8')).toBe(beforeCloudflared)
      expect(await readFile(license, 'utf8')).toBe(beforeLicense)
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
    const cloudflared = join(root, 'bin', 'astrale-cloudflared')
    const license = join(root, 'home', 'licenses', 'cloudflared.txt')
    const beforeBinary = await readFile(meta.bin, 'utf8')
    const beforeCloudflared = await readFile(cloudflared, 'utf8')
    const beforeLicense = await readFile(license, 'utf8')
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
      expect(await readFile(cloudflared, 'utf8')).toBe(beforeCloudflared)
      expect(await readFile(license, 'utf8')).toBe(beforeLicense)
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
