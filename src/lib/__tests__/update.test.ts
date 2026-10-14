import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acquireInstallLock } from '../install-lock'
import { readInstallMetadata, releaseBase, updateAstrale, type UpdateRequest } from '../update'

const roots: string[] = []
afterEach(async () => {
  delete process.env.ASTRALE_UPDATE_BASE
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function script(version: string, label: string): string {
  return `#!/usr/bin/env sh\nif [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\necho ${label}\n`
}

/** A script installation of `version` and a `file://` release of `next`. */
async function installation(
  version: string,
  next: {
    version: string
    binaryVersion?: string
    channel?: string
    reports?: string
    members?: string[]
    sha256?: string
  } = {
    version,
  },
) {
  const root = await mkdtemp(join(tmpdir(), 'astrale-update-'))
  roots.push(root)
  const bin = join(root, 'bin', 'astrale')
  const metadata = join(root, 'home', 'install.json')
  await mkdir(join(root, 'bin'))
  await mkdir(join(root, 'home'))
  await writeFile(bin, script(version, 'old'), { mode: 0o755 })
  await writeFile(
    metadata,
    JSON.stringify({ method: 'script', channel: 'alpha', version, repo: 'astrale-os/cli', bin }),
  )

  const payload = join(root, 'payload')
  const release = join(root, 'release')
  await mkdir(payload)
  await mkdir(release)
  await writeFile(
    join(payload, 'astrale'),
    script(next.reports ?? next.binaryVersion ?? next.version, 'new'),
    {
      mode: 0o755,
    },
  )
  await writeFile(join(payload, 'extra'), 'unexpected')
  const asset = join(release, 'astrale-darwin-arm64.tar.gz')
  const tar = Bun.spawn(['tar', '-C', payload, '-czf', asset, ...(next.members ?? ['astrale'])])
  expect(await tar.exited).toBe(0)
  const sha256 =
    next.sha256 ?? new Bun.CryptoHasher('sha256').update(await readFile(asset)).digest('hex')
  await writeFile(
    join(release, 'manifest.json'),
    JSON.stringify({
      version: next.version,
      binaryVersion: next.binaryVersion ?? next.version,
      channel: next.channel ?? 'alpha',
      assets: { 'darwin-arm64': { name: 'astrale-darwin-arm64.tar.gz', sha256 } },
    }),
  )
  process.env.ASTRALE_UPDATE_BASE = `file://${release}`
  const request = (extra: Partial<UpdateRequest> = {}): UpdateRequest => ({
    currentVersion: version,
    installPath: metadata,
    platform: { os: 'darwin', arch: 'arm64' },
    execution: { kind: 'standalone', executable: bin },
    ...extra,
  })
  const state = async () => ({
    binary: await readFile(bin, 'utf8'),
    metadata: await readFile(metadata, 'utf8'),
  })
  return { root, bin, metadata, request, state }
}

describe('standalone update', () => {
  test('replaces the executable and records the new release in the install metadata', async () => {
    const install = await installation('1.0.0', { version: '1.1.0' })

    expect(await updateAstrale(install.request())).toEqual({
      status: 'updated',
      previousVersion: '1.0.0',
      currentVersion: '1.1.0',
      channel: 'alpha',
      bin: install.bin,
    })
    expect(await readFile(install.bin, 'utf8')).toContain('echo new')
    expect(await readInstallMetadata(install.metadata)).toMatchObject({
      version: '1.1.0',
      channel: 'alpha',
    })
    expect(await Bun.file(`${install.bin}.previous`).exists()).toBe(false)
  })

  test('a check compares recorded and released versions without replacing anything', async () => {
    const current = await installation('1.0.0')
    expect((await updateAstrale(current.request({ check: true }))).status).toBe('up-to-date')
    const behind = await installation('1.0.0', { version: '1.1.0' })
    const before = await behind.state()
    expect(await updateAstrale(behind.request({ check: true }))).toMatchObject({
      status: 'available',
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
    })
    expect(await behind.state()).toEqual(before)
  })

  test('an installation ahead of another channel is not moved back unless the user names it', async () => {
    const ahead = await installation('1.0.0-beta.149', {
      version: '1.0.0-beta.147',
      channel: 'latest',
    })
    const before = await ahead.state()
    for (const check of [true, false]) {
      expect(await updateAstrale(ahead.request({ check, channel: 'latest' }))).toEqual({
        status: 'up-to-date',
        currentVersion: '1.0.0-beta.149',
        latestVersion: '1.0.0-beta.147',
        channel: 'latest',
      })
    }
    expect(await ahead.state()).toEqual(before)

    expect(
      (await updateAstrale(ahead.request({ check: true, channel: 'latest', explicit: true })))
        .status,
    ).toBe('available')
    const behind = await installation('1.0.0-beta.146', {
      version: '1.0.0-beta.147',
      channel: 'latest',
    })
    expect((await updateAstrale(behind.request({ check: true, channel: 'latest' }))).status).toBe(
      'available',
    )
    // The installed channel rolling back is still followed.
    const rollback = await installation('1.1.0', { version: '1.0.0' })
    expect((await updateAstrale(rollback.request({ check: true }))).status).toBe('available')
  })

  test('a canary binary may report the package version instead of the release version', async () => {
    const install = await installation('1.0.0', {
      version: '1.1.0-canary.3',
      binaryVersion: '1.1.0',
    })
    expect((await updateAstrale(install.request())).status).toBe('updated')
  })

  test('a bad archive, a checksum mismatch or a wrong binary leaves the installation unchanged', async () => {
    for (const next of [
      { version: '1.1.0', members: ['astrale', 'extra'] },
      { version: '1.1.0', members: ['extra'] },
      { version: '1.1.0', sha256: 'f'.repeat(64) },
      { version: '1.1.0', reports: '0.9.0' },
    ]) {
      const install = await installation('1.0.0', next)
      const before = await install.state()
      await expect(updateAstrale(install.request())).rejects.toThrow()
      expect(await install.state()).toEqual(before)
    }
  })

  test('a metadata commit failure puts the previous executable back', async () => {
    const install = await installation('1.0.0', { version: '1.1.0' })
    const before = await install.state()
    await chmod(join(install.root, 'home'), 0o555)
    try {
      await expect(updateAstrale(install.request())).rejects.toThrow()
    } finally {
      await chmod(join(install.root, 'home'), 0o755)
    }
    expect(await install.state()).toEqual(before)
  })

  test('only the recorded script installation, owned by the running binary, may update', async () => {
    const install = await installation('1.0.0', { version: '1.1.0' })
    const managed = await updateAstrale(
      install.request({ execution: { kind: 'package-managed', executable: '/usr/bin/node' } }),
    )
    expect(managed).toEqual({
      status: 'managed',
      currentVersion: '1.0.0',
      executable: '/usr/bin/node',
    })

    const linked = join(install.root, 'linked-astrale')
    await symlink(install.bin, linked)
    expect(
      (
        await updateAstrale(
          install.request({ check: true, execution: { kind: 'standalone', executable: linked } }),
        )
      ).status,
    ).toBe('available')
    await expect(
      updateAstrale(
        install.request({
          execution: { kind: 'standalone', executable: join(install.root, 'payload', 'astrale') },
        }),
      ),
    ).rejects.toMatchObject({ code: 'UPDATE_INSTALL_MISMATCH' })

    await writeFile(install.metadata, '{')
    await expect(updateAstrale(install.request())).rejects.toMatchObject({
      code: 'UPDATE_BAD_INSTALL_METADATA',
    })
    await rm(install.metadata)
    await expect(updateAstrale(install.request())).rejects.toMatchObject({
      code: 'UPDATE_NOT_SCRIPT_INSTALLED',
    })
  })

  test('another live installer holds the lock next to the binary', async () => {
    const install = await installation('1.0.0', { version: '1.1.0' })
    const lock = await acquireInstallLock(install.bin)
    try {
      await expect(updateAstrale(install.request())).rejects.toMatchObject({
        code: 'UPDATE_INSTALL_BUSY',
      })
    } finally {
      await lock.release()
    }
  })

  test('the release base names an exact version tag or a channel', () => {
    const meta = { repo: 'astrale-os/cli', channel: 'latest' }
    expect(releaseBase(meta, { version: 'cli/v1.2.3' })).toBe(
      'https://github.com/astrale-os/cli/releases/download/cli/v1.2.3',
    )
    expect(releaseBase(meta, {})).toBe('https://github.com/astrale-os/cli/releases/download/latest')
  })
})
