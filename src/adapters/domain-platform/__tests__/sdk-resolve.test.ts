import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveBuildSpecCli, resolveSdkFingerprint } from '../cloudflare-lifecycle'

/**
 * Materialize a domain dir with an installed `@astrale-os/sdk` whose
 * `package.json` declares the given `exports` + `version`, plus a stub
 * build-spec-cli file so the `existsSync` guard passes.
 */
async function fakeDomainWithSdk(
  root: string,
  opts: { exports?: unknown; version?: string; cliRelPath?: string | null } = {},
): Promise<{ domainDir: string; sdkDir: string; cliPath: string | null }> {
  const domainDir = join(root, 'mydomain')
  const sdkDir = join(domainDir, 'node_modules', '@astrale-os', 'sdk')
  await mkdir(sdkDir, { recursive: true })
  await writeFile(join(domainDir, 'package.json'), JSON.stringify({ name: 'mydomain' }))

  const cliRel = opts.cliRelPath === undefined ? './src/domain/build-spec-cli.ts' : opts.cliRelPath
  let cliPath: string | null = null
  if (cliRel) {
    const abs = join(sdkDir, cliRel)
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, '// stub\n')
    cliPath = abs
  }

  const pkg = {
    name: '@astrale-os/sdk',
    version: opts.version ?? '9.9.9',
    exports:
      opts.exports === undefined
        ? { './domain/build-spec-cli': { types: cliRel, import: cliRel } }
        : opts.exports,
  }
  await writeFile(join(sdkDir, 'package.json'), JSON.stringify(pkg))
  return { domainDir, sdkDir, cliPath }
}

describe('resolveBuildSpecCli', () => {
  let tmp = ''
  beforeEach(async () => {
    tmp = realpathSync(await mkdtemp(join(tmpdir(), 'astrale-sdkresolve-')))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  test('resolves the cli path from the domain’s installed sdk exports', async () => {
    const { domainDir, cliPath } = await fakeDomainWithSdk(tmp)
    expect(resolveBuildSpecCli(domainDir)).toBe(cliPath as string)
  })

  test('throws NO_SDK when @astrale-os/sdk is not installed', () => {
    expect(() => resolveBuildSpecCli(join(tmp, 'no-sdk-here'))).toThrow(/NO_SDK|@astrale-os\/sdk/)
  })

  test('throws when the sdk install lacks the build-spec-cli export', async () => {
    const { domainDir } = await fakeDomainWithSdk(tmp, { exports: { '.': './index.js' } })
    expect(() => resolveBuildSpecCli(domainDir)).toThrow(/build-spec-cli/)
  })

  test('throws when the export points at a missing file', async () => {
    const { domainDir } = await fakeDomainWithSdk(tmp, {
      cliRelPath: null,
      exports: { './domain/build-spec-cli': { import: './dist/domain/build-spec-cli.js' } },
    })
    expect(() => resolveBuildSpecCli(domainDir)).toThrow(/build-spec-cli/)
  })
})

describe('resolveSdkFingerprint', () => {
  let tmp = ''
  beforeEach(async () => {
    tmp = realpathSync(await mkdtemp(join(tmpdir(), 'astrale-sdkfp-')))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  test('non-git install → version fingerprint, gitMode false', async () => {
    const { domainDir, sdkDir } = await fakeDomainWithSdk(tmp, { version: '1.2.3' })
    const fp = resolveSdkFingerprint(domainDir)
    expect(fp).toEqual({ sdkDir, sdkCommit: '1.2.3', gitMode: false })
  })

  test('git-checkout install → short HEAD fingerprint, gitMode true', async () => {
    const { domainDir, sdkDir } = await fakeDomainWithSdk(tmp, { version: '1.2.3' })
    const run = (...args: string[]) =>
      spawnSync('git', ['-C', sdkDir, ...args], { encoding: 'utf-8' })
    run('init')
    run('config', 'user.email', 'test@astrale.ai')
    run('config', 'user.name', 'test')
    run('add', '-A')
    run('commit', '-m', 'init', '--no-gpg-sign')
    const head = run('rev-parse', '--short', 'HEAD').stdout.trim()

    const fp = resolveSdkFingerprint(domainDir)
    expect(fp.gitMode).toBe(true)
    expect(fp.sdkDir).toBe(sdkDir)
    expect(fp.sdkCommit).toBe(head)
  })
})
