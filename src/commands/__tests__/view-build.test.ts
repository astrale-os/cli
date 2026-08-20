import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { devDistIsStale } from '../view'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('view development runtime build', () => {
  test('reuses a current official build and detects every runtime build input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-view-build-'))
    temporaryDirectories.push(root)
    const entry = join(root, 'bin', 'astrale.ts')
    const source = join(root, 'src', 'command.ts')
    const vendor = join(root, 'vendor', 'dependency.tgz')
    const buildScript = join(root, 'scripts', 'build.ts')
    const packageJson = join(root, 'package.json')
    const lockfile = join(root, 'pnpm-lock.yaml')
    const dist = join(root, 'dist', 'astrale.js')

    await Promise.all(
      ['bin', 'src', 'vendor', 'scripts', 'dist'].map((directory) =>
        mkdir(join(root, directory), { recursive: true }),
      ),
    )
    const inputs = [entry, source, vendor, buildScript, packageJson, lockfile]
    await Promise.all(inputs.map((file) => writeFile(file, 'input')))
    await writeFile(dist, 'built')
    const past = new Date(Date.now() - 2_000)
    const present = new Date()
    await Promise.all(inputs.map((file) => utimes(file, past, past)))
    await utimes(dist, present, present)

    expect(await devDistIsStale(entry, dist)).toBe(false)

    for (const input of inputs) {
      await utimes(input, new Date(Date.now() + 2_000), new Date(Date.now() + 2_000))
      expect(await devDistIsStale(entry, dist)).toBe(true)
      await utimes(input, past, past)
    }
  })

  test('requires a build when dist/astrale.js is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-view-build-missing-'))
    temporaryDirectories.push(root)

    expect(
      await devDistIsStale(join(root, 'bin', 'astrale.ts'), join(root, 'dist', 'astrale.js')),
    ).toBe(true)
  })
})
