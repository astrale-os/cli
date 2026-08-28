import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { replaceStandaloneCohort } from '../standalone-cohort'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'astrale-standalone-cohort-'))
  const bin = join(root, 'bin')
  const home = join(root, 'home')
  const next = join(root, 'next')
  await Promise.all([mkdir(bin), mkdir(home), mkdir(next)])
  const paths = {
    root,
    installedBinary: join(bin, 'astrale'),
    installedCloudflared: join(bin, 'astrale-cloudflared'),
    installedLicense: join(home, 'cloudflared.txt'),
    nextBinary: join(next, 'astrale'),
    nextCloudflared: join(next, 'astrale-cloudflared'),
    nextLicense: join(next, 'LICENSE.cloudflared'),
  }
  await Promise.all([
    writeFile(paths.installedBinary, 'old binary'),
    writeFile(paths.installedCloudflared, 'old provider'),
    writeFile(paths.installedLicense, 'old license'),
    writeFile(paths.nextBinary, 'new binary'),
    writeFile(paths.nextCloudflared, 'new provider'),
    writeFile(paths.nextLicense, 'new license'),
  ])
  return paths
}

function input(paths: Awaited<ReturnType<typeof fixture>>) {
  return {
    installedBinary: paths.installedBinary,
    nextBinary: paths.nextBinary,
    nextCloudflared: paths.nextCloudflared,
    installedLicense: paths.installedLicense,
    nextLicense: paths.nextLicense,
  }
}

describe('standalone cohort replacement', () => {
  test('commits license then provider then CLI and finalizes exact cleanup', async () => {
    const paths = await fixture()
    const commits: string[] = []
    const replacement = await replaceStandaloneCohort(input(paths), {
      rename: async (from, to) => {
        commits.push(String(to))
        await rename(from, to)
      },
    })
    expect(commits).toEqual([
      paths.installedLicense,
      paths.installedCloudflared,
      paths.installedBinary,
    ])
    expect(await readFile(paths.installedBinary, 'utf8')).toBe('new binary')
    expect(await readFile(paths.installedCloudflared, 'utf8')).toBe('new provider')
    expect(await readFile(paths.installedLicense, 'utf8')).toBe('new license')

    await replacement.finalize()
    for (const path of [
      `${paths.installedBinary}.previous`,
      `${paths.installedCloudflared}.previous`,
      `${paths.installedLicense}.previous`,
      join(paths.root, 'bin', '.astrale-install.lock'),
    ]) {
      expect(await stat(path).catch(() => undefined)).toBeUndefined()
    }
    await rm(paths.root, { recursive: true, force: true })
  })

  test('rolls the complete cohort back while metadata is not committed', async () => {
    const paths = await fixture()
    const replacement = await replaceStandaloneCohort(input(paths))
    await replacement.rollback()

    expect(await readFile(paths.installedBinary, 'utf8')).toBe('old binary')
    expect(await readFile(paths.installedCloudflared, 'utf8')).toBe('old provider')
    expect(await readFile(paths.installedLicense, 'utf8')).toBe('old license')
    await rm(paths.root, { recursive: true, force: true })
  })

  test('a CLI commit failure restores the already committed provider and license', async () => {
    const paths = await fixture()
    await expect(
      replaceStandaloneCohort(input(paths), {
        rename: async (from, to) => {
          if (String(to) === paths.installedBinary) throw new Error('injected CLI commit failure')
          await rename(from, to)
        },
      }),
    ).rejects.toThrow('injected CLI commit failure')

    expect(await readFile(paths.installedBinary, 'utf8')).toBe('old binary')
    expect(await readFile(paths.installedCloudflared, 'utf8')).toBe('old provider')
    expect(await readFile(paths.installedLicense, 'utf8')).toBe('old license')
    await rm(paths.root, { recursive: true, force: true })
  })

  test('legacy absence is restored by removing newly committed optional members', async () => {
    const paths = await fixture()
    await rm(paths.installedCloudflared)
    await rm(paths.installedLicense)
    const replacement = await replaceStandaloneCohort(input(paths))
    await replacement.rollback()

    expect(await readFile(paths.installedBinary, 'utf8')).toBe('old binary')
    await expect(readFile(paths.installedCloudflared)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(paths.installedLicense)).rejects.toMatchObject({ code: 'ENOENT' })
    await rm(paths.root, { recursive: true, force: true })
  })
})
