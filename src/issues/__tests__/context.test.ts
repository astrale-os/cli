import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { collectIssueContext } from '../context'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'astrale-issue-context-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function json(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}

function collect(options: Partial<Parameters<typeof collectIssueContext>[0]> = {}) {
  return collectIssueContext({ cwd: root, cliVersion: '1.0.0-beta.123', ...options })
}

describe('issue context selection', () => {
  it('accepts no project or instance and never borrows the active bookmark', async () => {
    const value = await collect({
      instances: {
        active: 'unrelated',
        instances: {
          unrelated: { url: 'https://unrelated.test/api' },
        },
      },
    })
    expect(value.instance).toBeUndefined()
    expect(value.project).toBeUndefined()
    expect(value.cli.version).toBe('1.0.0-beta.123')
  })

  it('keeps two concurrent projects and their installed SDK versions independent', async () => {
    for (const [name, version] of [
      ['first', '0.5.0-beta.151'],
      ['second', '0.6.0-beta.0'],
    ]) {
      await json(join(root, name!, 'package.json'), {
        name,
        dependencies: { '@astrale-os/sdk': '^0.5.0' },
      })
      await json(join(root, name!, 'node_modules/@astrale-os/sdk/package.json'), {
        name: '@astrale-os/sdk',
        version,
      })
    }
    const [first, second] = await Promise.all([
      collect({ project: 'first' }),
      collect({ project: 'second' }),
    ])
    expect(first.project?.packages).toEqual([
      {
        name: '@astrale-os/sdk',
        declared: '^0.5.0',
        version: '0.5.0-beta.151',
        source: 'installed',
      },
    ])
    expect(second.project?.packages[0]?.version).toBe('0.6.0-beta.0')
    expect(first.instance).toBeUndefined()
  })

  it('uses the nearest package for a nested cwd, not a sibling package', async () => {
    await json(join(root, 'package.json'), { name: 'workspace', workspaces: ['packages/*'] })
    await json(join(root, 'packages/a/package.json'), {
      name: 'a',
      dependencies: { '@astrale-os/sdk': '0.6.0-beta.0' },
    })
    await mkdir(join(root, 'packages/a/src'), { recursive: true })
    const value = await collect({ cwd: join(root, 'packages/a/src') })
    expect(value.project?.name).toBe('a')
    expect(value.project?.packages).toEqual([
      { name: '@astrale-os/sdk', declared: '0.6.0-beta.0', source: 'unresolved' },
    ])
    expect((await collect()).project).toBeUndefined()
  })

  it('does not select a Domain from a pnpm workspace root', async () => {
    await json(join(root, 'package.json'), { name: 'workspace' })
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: ["packages/*"]')
    expect((await collect()).project).toBeUndefined()
    expect((await collect({ project: '.' })).project?.name).toBe('workspace')
  })

  it('observes a linked local SDK without executing package or project code', async () => {
    await json(join(root, 'package.json'), {
      name: 'app',
      dependencies: { '@astrale-os/sdk': 'workspace:*' },
    })
    await json(join(root, 'sdk/package.json'), {
      name: '@astrale-os/sdk',
      version: '0.6.0-beta.0',
      main: 'index.js',
    })
    await writeFile(join(root, 'sdk/index.js'), 'throw new Error("must not execute")')
    await writeFile(join(root, 'astrale.config.ts'), 'throw new Error("must not execute config")')
    await mkdir(join(root, 'node_modules/@astrale-os'), { recursive: true })
    await symlink(join(root, 'sdk'), join(root, 'node_modules/@astrale-os/sdk'))
    const value = await collect()
    expect(value.project?.packages[0]).toMatchObject({ source: 'local', version: '0.6.0-beta.0' })
    expect(JSON.stringify(value)).not.toContain(root)
  })

  it('selects only the explicit affected instance without connecting or exposing credentials', async () => {
    const value = await collect({
      instance: 'staging',
      instances: {
        active: 'prod',
        instances: {
          staging: {
            url: 'https://login:secret@offline.test/api?token=private#fragment',
            issuer: 'https://offline.test/api',
            caFile: '/secret.pem',
            defaultIdentity: 'private-name',
          },
          prod: { url: 'https://prod.test/api' },
        },
      },
    })
    expect(value.instance).toEqual({
      name: 'staging',
      issuer: 'https://offline.test/api',
      url: 'https://offline.test/api',
    })
    expect(JSON.stringify(value)).not.toContain('secret')
    expect(JSON.stringify(value)).not.toContain('private')
  })

  it.each(['/session/private-token', '/private-token/../api', '/api%2Fprivate-token'])(
    'omits unrecognized credential-bearing path %s without changing instance identity',
    async (path) => {
      const value = await collect({
        instance: 'proxy',
        instances: {
          active: '',
          instances: {
            proxy: { issuer: `https://kernel.test${path}`, url: `https://proxy.test${path}` },
          },
        },
      })
      expect(value.instance).toEqual({ name: 'proxy' })
      expect(JSON.stringify(value)).not.toContain('private-token')
    },
  )

  it('does not invent an issuer from the transport URL', async () => {
    const value = await collect({
      instance: 'proxy',
      instances: {
        active: '',
        instances: {
          proxy: { url: 'https://proxy.test/api' },
        },
      },
    })
    expect(value.instance).toEqual({ name: 'proxy', url: 'https://proxy.test/api' })
  })

  it('omits an issuer that would need redaction rather than inventing a different identity', async () => {
    const value = await collect({
      instance: 'bad',
      instances: {
        active: '',
        instances: {
          bad: { issuer: 'https://user:secret@kernel.test', url: 'https://kernel.test/api' },
        },
      },
    })
    expect(value.instance).toEqual({ name: 'bad', url: 'https://kernel.test/api' })
    expect(JSON.stringify(value)).not.toContain('secret')
  })

  it('records a local SDK commit and dirty state without executing its fsmonitor hook', async () => {
    const execute = promisify(execFile)
    const sdk = join(root, 'sdk')
    await json(join(root, 'package.json'), {
      name: 'app',
      dependencies: { '@astrale-os/sdk': 'workspace:*' },
    })
    await json(join(sdk, 'package.json'), { name: '@astrale-os/sdk', version: '0.6.0-beta.0' })
    const options = { cwd: sdk }
    await execute('git', ['init', '--quiet'], options)
    await execute('git', ['add', 'package.json'], options)
    await execute(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.test',
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgSign=false',
        'commit',
        '-qm',
        'Fixture',
      ],
      options,
    )
    const { stdout } = await execute('git', ['rev-parse', 'HEAD'], options)
    await writeFile(join(sdk, 'changed.ts'), 'export const changed = true')
    await writeFile(join(sdk, 'fsmonitor.sh'), '#!/bin/sh\ntouch hook-executed\n', { mode: 0o755 })
    await execute('git', ['config', 'core.fsmonitor', join(sdk, 'fsmonitor.sh')], options)
    await mkdir(join(root, 'node_modules/@astrale-os'), { recursive: true })
    await symlink(sdk, join(root, 'node_modules/@astrale-os/sdk'))
    expect((await collect()).project?.packages[0]).toMatchObject({
      source: 'local',
      commit: stdout.trim(),
      dirty: true,
    })
    await expect(readFile(join(sdk, 'hook-executed'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves an exact issuer without URL normalization', async () => {
    const value = await collect({
      instance: 'staging',
      instances: {
        active: '',
        instances: { staging: { issuer: 'https://staging.test', url: 'https://proxy.test/api' } },
      },
    })
    expect(value.instance?.issuer).toBe('https://staging.test')
  })

  it('reports malformed bookmark coordinates without a raw URL exception', async () => {
    await expect(
      collect({
        instance: 'broken',
        instances: { active: '', instances: { broken: { url: 'invalid' } } },
      }),
    ).rejects.toMatchObject({ code: 'ISSUE_INSTANCE_INVALID' })
  })

  it.each(['malformed', 'missing', 'dangling'])(
    'never borrows a parent SDK when the nearer installation is %s',
    async (kind) => {
      await json(join(root, 'node_modules/@astrale-os/sdk/package.json'), {
        name: '@astrale-os/sdk',
        version: '0.6.0-beta.0',
      })
      await json(join(root, 'app/package.json'), {
        name: 'app',
        dependencies: { '@astrale-os/sdk': '0.5.0-beta.151' },
      })
      const target = join(root, 'app/node_modules/@astrale-os/sdk')
      await mkdir(dirname(target), { recursive: true })
      if (kind === 'dangling') await symlink(join(root, 'absent'), target)
      else {
        await mkdir(target)
        if (kind === 'malformed') await writeFile(join(target, 'package.json'), '{broken')
      }
      expect((await collect({ project: 'app' })).project?.packages).toEqual([
        { name: '@astrale-os/sdk', declared: '0.5.0-beta.151', source: 'unresolved' },
      ])
    },
  )

  it('rejects an unknown explicit instance instead of borrowing the active one', async () => {
    await expect(
      collect({
        instance: 'typo',
        instances: { active: 'prod', instances: { prod: { url: 'https://prod.test' } } },
      }),
    ).rejects.toMatchObject({ code: 'ISSUE_INSTANCE_NOT_FOUND' })
  })

  it('rejects an invalid explicit project and accepts an unavailable implicit one', async () => {
    await expect(collect({ project: 'missing' })).rejects.toMatchObject({
      code: 'ISSUE_PROJECT_INVALID',
    })
    await writeFile(join(root, 'package.json'), 'broken')
    await expect(collect({ project: '.' })).rejects.toMatchObject({ code: 'ISSUE_PROJECT_INVALID' })
    expect((await collect()).project).toBeUndefined()
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe('broken')
  })

  it('does not forward dependency URLs, paths or unrelated packages', async () => {
    await json(join(root, 'package.json'), {
      name: 'app',
      dependencies: {
        '@astrale-os/sdk': 'git+https://user:password@repo.test/sdk',
        '@astrale-os/adapter-cloudflare': 'file:/private/source',
        '@astrale-os/../../secret': '1.0.0',
        'other-package': '1.0.0',
      },
    })
    expect((await collect()).project?.packages).toEqual([
      { name: '@astrale-os/adapter-cloudflare', source: 'unresolved' },
      { name: '@astrale-os/sdk', source: 'unresolved' },
    ])
  })
})
