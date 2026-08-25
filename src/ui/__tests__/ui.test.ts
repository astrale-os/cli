import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { digest, parseUiLock } from '../lock'
import { UiError, type UiLock, type UiRegistry } from '../model'
import { addUi, applyPreset, diffUi, doctorUi, initUi } from '../operations'
import { resolveUiRelease } from '../release'
import { shadcnInvocation } from '../runner'

const commit = 'a'.repeat(40)
const registry: UiRegistry = {
  name: 'astrale-ui',
  items: [
    {
      name: 'pattern-chart-line-basic',
      type: 'registry:block',
      description: 'A controlled chart.',
      files: [
        {
          path: 'registry/patterns/chart/line-basic.tsx',
          type: 'registry:component',
          target: 'components/astrale/pattern/chart/line-basic.tsx',
        },
      ],
      meta: { canonicalAddress: 'pattern/chart/line/basic' },
    },
  ],
}
const compatibility = {
  version: 1,
  shadcn: '4.18.0',
  base: 'base',
  style: 'nova',
  baseUi: '1.7.0',
  react: '^18.3.1 || ^19.0.0',
  tailwind: '^4.3.3',
  presets: ['astrale', 'compact', 'expressive'],
}

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

function mockFetch(seen: string[] = [], suppliedRegistry: UiRegistry = registry): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    seen.push(url)
    if (url.includes('/git/ref/tags/')) {
      return Response.json({ object: { type: 'commit', sha: commit, url: '' } })
    }
    if (url.endsWith('/tooling/compatibility.json')) return Response.json(compatibility)
    if (url.endsWith('/' + commit + '/registry.json')) {
      return Response.json({
        name: 'astrale-ui',
        include: ['registry/base/registry.json', 'registry/patterns/chart/registry.json'],
      })
    }
    if (url.endsWith('/registry/base/registry.json')) {
      return Response.json({ items: [{ name: 'astrale-base', type: 'registry:base' }] })
    }
    if (url.endsWith('/registry/patterns/chart/registry.json'))
      return Response.json(suppliedRegistry)
    const item = suppliedRegistry.items.find((candidate) =>
      url.endsWith('/registry/public/r/' + candidate.name + '.json'),
    )
    if (item) return Response.json(builtItem(item))
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

function builtItem(item: UiRegistry['items'][number]) {
  return {
    ...item,
    files: item.files.map((file, index) => ({
      ...file,
      content: index === 0 ? 'export const Chart = true\n' : 'export const Summary = true\n',
    })),
  }
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'astrale-ui-cli-'))
  temporary.push(root)
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      private: true,
      dependencies: { react: '19.2.8', 'react-dom': '19.2.8', tailwindcss: '4.3.3' },
      packageManager: 'pnpm@11.13.1',
    }),
  )
  await writeFile(path.join(root, 'src/index.css'), '/* consumer css */\n')
  return root
}

function lock(): UiLock {
  return {
    $schema: 'https://example.invalid/ui-lock.schema.json',
    version: 1,
    package: { name: '@astrale-os/ui', version: '0.3.0-beta.0' },
    registry: { repository: 'astrale-os/ui', ref: 'v0.3.0-beta.0', commit },
    tooling: { shadcn: '4.18.0', base: 'base', style: 'nova', baseUi: '1.7.0' },
    preset: 'astrale',
    items: {},
  }
}

describe('UI release and runner contracts', () => {
  /** @evidence TEST-CLI-UI-ONE-SNAPSHOT */
  test('resolves one commit and reads the full release snapshot from it', async () => {
    const seen: string[] = []
    const release = await resolveUiRelease('0.3.0-beta.0', mockFetch(seen))
    expect(release.commit).toBe(commit)
    expect(release.compatibility.base).toBe('base')
    expect(release.registry.items).toHaveLength(1)
    expect(seen.filter((url) => url.includes('raw.githubusercontent.com'))).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/' + commit + '/tooling/compatibility.json'),
        expect.stringContaining('/' + commit + '/registry'),
      ]),
    )
  })

  test('constructs exact on-demand commands for every supported package manager', () => {
    expect(shadcnInvocation('pnpm', '4.18.0', ['add', 'item'])).toEqual({
      file: 'pnpm',
      args: ['dlx', 'shadcn@4.18.0', 'add', 'item'],
    })
    expect(shadcnInvocation('npm', '4.18.0', ['add', 'item'])).toEqual({
      file: 'npx',
      args: ['--yes', 'shadcn@4.18.0', 'add', 'item'],
    })
    expect(shadcnInvocation('yarn', '4.18.0', ['add', 'item'])).toEqual({
      file: 'yarn',
      args: ['dlx', 'shadcn@4.18.0', 'add', 'item'],
    })
    expect(shadcnInvocation('bun', '4.18.0', ['add', 'item'])).toEqual({
      file: 'bunx',
      args: ['shadcn@4.18.0', 'add', 'item'],
    })
  })

  test('rejects an unsafe authoritative root without falling back to a legacy registry', async () => {
    const seen: string[] = []
    const fallback = mockFetch(seen)
    const unsafe = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/' + commit + '/registry.json')) {
        return Response.json({ name: 'astrale-ui', include: ['../registry.json'] })
      }
      return fallback(input, init)
    }) as typeof fetch
    await expect(resolveUiRelease('0.3.0-beta.0', unsafe)).rejects.toThrow()
    expect(seen.some((url) => url.endsWith('/registry/registry.json'))).toBe(false)
  })

  /** @evidence TEST-CLI-UI-BOUNDED-REMOTE-DOCUMENTS */
  test('bounds and normalizes malformed registry responses', async () => {
    const fallback = mockFetch()
    const oversized = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/tooling/compatibility.json')) {
        return new Response('x'.repeat(1_048_577), {
          headers: { 'content-type': 'application/json' },
        })
      }
      return fallback(input, init)
    }) as typeof fetch
    await expect(resolveUiRelease('0.3.0-beta.0', oversized)).rejects.toMatchObject({
      code: 'UI_REGISTRY_UNAVAILABLE',
    })

    const malformed = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/' + commit + '/registry.json')) {
        return new Response('{', { headers: { 'content-type': 'application/json' } })
      }
      return fallback(input, init)
    }) as typeof fetch
    await expect(resolveUiRelease('0.3.0-beta.0', malformed)).rejects.toMatchObject({
      code: 'UI_REGISTRY_UNAVAILABLE',
    })
  })

  test('rejects include fan-out before fetching an unbounded registry graph', async () => {
    const fallback = mockFetch()
    const fanOut = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/' + commit + '/registry.json')) {
        return Response.json({
          include: Array.from(
            { length: 100 },
            (_, index) => 'registry/patterns/family-' + index + '/registry.json',
          ),
        })
      }
      return fallback(input, init)
    }) as typeof fetch
    await expect(resolveUiRelease('0.3.0-beta.0', fanOut)).rejects.toMatchObject({
      code: 'UI_REGISTRY_UNAVAILABLE',
    })
  })
})

describe('UI initialization transaction', () => {
  test('dry-run reports every mutation and writes nothing', async () => {
    const root = await fixture()
    const before = await readFile(path.join(root, 'package.json'), 'utf8')
    const result = await initUi(
      { path: root, version: '0.3.0-beta.0', dryRun: true },
      { fetcher: mockFetch() },
    )
    expect(result.status).toBe('planned')
    expect(result.files).toEqual(
      expect.arrayContaining([
        'package.json',
        'src/index.css',
        'components.json',
        'astrale-ui.lock.json',
      ]),
    )
    expect(await readFile(path.join(root, 'package.json'), 'utf8')).toBe(before)
    expect(await Bun.file(path.join(root, 'astrale-ui.lock.json')).exists()).toBe(false)
  })

  /** @evidence TEST-CLI-UI-LOCK-AFTER-SUCCESS */
  test('restores all files and leaves no lock when dependency installation fails', async () => {
    const root = await fixture()
    const packageBefore = await readFile(path.join(root, 'package.json'), 'utf8')
    const cssBefore = await readFile(path.join(root, 'src/index.css'), 'utf8')
    await expect(
      initUi(
        { path: root, version: '0.3.0-beta.0' },
        {
          fetcher: mockFetch(),
          runner: async () => ({ code: 1, stdout: '', stderr: 'registry unavailable' }),
        },
      ),
    ).rejects.toMatchObject({ code: 'UI_DEPENDENCY_INSTALL_FAILED' })
    expect(await readFile(path.join(root, 'package.json'), 'utf8')).toBe(packageBefore)
    expect(await readFile(path.join(root, 'src/index.css'), 'utf8')).toBe(cssBefore)
    expect(await Bun.file(path.join(root, 'components.json')).exists()).toBe(false)
    expect(await Bun.file(path.join(root, 'astrale-ui.lock.json')).exists()).toBe(false)
    expect(await Bun.file(path.join(root, 'pnpm-lock.yaml')).exists()).toBe(false)
  })

  test('writes Base Nova config and advances the lock only after configuration succeeds', async () => {
    const root = await fixture()
    await initUi(
      { path: root, version: '0.3.0-beta.0', preset: 'compact', install: false },
      { fetcher: mockFetch() },
    )
    const components = JSON.parse(await readFile(path.join(root, 'components.json'), 'utf8'))
    const written = JSON.parse(await readFile(path.join(root, 'astrale-ui.lock.json'), 'utf8'))
    expect(components.style).toBe('base-nova')
    expect(written.tooling).toMatchObject({ base: 'base', style: 'nova', baseUi: '1.7.0' })
    expect(await readFile(path.join(root, 'src/index.css'), 'utf8')).toContain(
      '@astrale-os/ui/presets/compact.css',
    )
  })

  test('repeated exact init performs no release fetch while requested drift rejects', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'astrale-ui.lock.json'), JSON.stringify(lock()))
    await writeFile(
      path.join(root, 'components.json'),
      JSON.stringify({ style: 'base-nova', tailwind: { css: 'src/index.css' } }),
    )
    await writeFile(
      path.join(root, 'src/index.css'),
      "@import '@astrale-os/ui/theme.css';\n@import '@astrale-os/ui/presets/astrale.css';\n",
    )
    let fetched = false
    const result = await initUi(
      { path: root, preset: 'astrale' },
      {
        fetcher: (async () => {
          fetched = true
          throw new Error('must not fetch')
        }) as unknown as typeof fetch,
      },
    )
    expect(result.status).toBe('unchanged')
    expect(fetched).toBe(false)
    await expect(initUi({ path: root, preset: 'compact' })).rejects.toMatchObject({
      code: 'UI_ITEM_CONFLICT',
    })
  })
})

describe('UI source operations', () => {
  test('add rejects an empty programmatic request before project discovery or tool execution', async () => {
    await expect(addUi([], {})).rejects.toMatchObject({ code: 'UI_ITEM_NOT_FOUND' })
  })

  test('rejects hostile lock file records before an operation can escape the project', () => {
    for (const items of [
      [],
      {
        'pattern/chart/line/basic': {
          address: 'pattern/chart/line/basic',
          sourceDigest: 'bad',
          files: {},
        },
      },
      {
        'pattern/chart/line/basic': {
          address: 'pattern/chart/line/basic',
          sourceDigest: 'b'.repeat(64),
          files: { '../../outside': 'c'.repeat(64) },
        },
      },
    ]) {
      expect(() => parseUiLock({ ...lock(), items })).toThrow(UiError)
    }
  })

  test('add dry-run invokes the exact shadcn version and does not advance the lock', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'astrale-ui.lock.json'), JSON.stringify(lock()))
    const before = await readFile(path.join(root, 'astrale-ui.lock.json'), 'utf8')
    const calls: Array<{ file: string; args: string[] }> = []
    const result = await addUi(
      ['pattern/chart/line/basic'],
      { project: root, dryRun: true },
      {
        fetcher: mockFetch(),
        runner: async (file, args) => {
          calls.push({ file, args })
          return { code: 0, stdout: 'planned', stderr: '' }
        },
      },
    )
    expect(result.status).toBe('planned')
    expect(result.sources).toEqual([
      {
        address: 'pattern/chart/line/basic',
        dependencies: [],
        files: ['components/astrale/pattern/chart/line-basic.tsx'],
      },
    ])
    expect(calls[0]).toMatchObject({ file: 'pnpm' })
    expect(calls[0]?.args).toEqual(expect.arrayContaining(['dlx', 'shadcn@4.18.0', '--dry-run']))
    expect(await readFile(path.join(root, 'astrale-ui.lock.json'), 'utf8')).toBe(before)
  })

  test('successful add records installed file digests and doctor detects later edits', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'astrale-ui.lock.json'), JSON.stringify(lock()))
    await writeFile(
      path.join(root, 'components.json'),
      JSON.stringify({ style: 'base-nova', tailwind: { css: 'src/index.css' } }),
    )
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        dependencies: {
          react: '19.2.8',
          'react-dom': '19.2.8',
          tailwindcss: '4.3.3',
          '@astrale-os/ui': '0.3.0-beta.0',
        },
      }),
    )
    await writeFile(
      path.join(root, 'src/index.css'),
      "@import '@astrale-os/ui/theme.css';\n@import '@astrale-os/ui/presets/astrale.css';\n",
    )
    const installed = path.join(root, 'components/astrale/pattern/chart/line-basic.tsx')
    await addUi(
      ['pattern/chart/line/basic'],
      { project: root, yes: true },
      {
        fetcher: mockFetch(),
        runner: async () => {
          await mkdir(path.dirname(installed), { recursive: true })
          await writeFile(installed, 'export const Chart = true\n')
          return { code: 0, stdout: '', stderr: '' }
        },
      },
    )
    const written = JSON.parse(await readFile(path.join(root, 'astrale-ui.lock.json'), 'utf8'))
    expect(written.items['pattern/chart/line/basic'].files).toEqual({
      'components/astrale/pattern/chart/line-basic.tsx': digest('export const Chart = true\n'),
    })
    expect(written.items['pattern/chart/line/basic'].sourceDigest).toBe(
      digest(JSON.stringify(builtItem(registry.items[0]!))),
    )
    expect((await doctorUi(root)).healthy).toBe(true)
    await writeFile(installed, 'consumer edit\n')
    expect((await doctorUi(root)).healthy).toBe(false)
    await expect(
      addUi(
        ['pattern/chart/line/basic'],
        { project: root },
        { fetcher: mockFetch(), runner: async () => ({ code: 0, stdout: '', stderr: '' }) },
      ),
    ).rejects.toBeInstanceOf(UiError)
  })

  test('preflights symlink targets without invoking shadcn', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'astrale-ui.lock.json'), JSON.stringify(lock()))
    const outside = await mkdtemp(path.join(tmpdir(), 'astrale-ui-outside-'))
    temporary.push(outside)
    await symlink(outside, path.join(root, 'components'))
    let invoked = false
    await expect(
      addUi(
        ['pattern/chart/line/basic'],
        { project: root },
        {
          fetcher: mockFetch(),
          runner: async () => {
            invoked = true
            return { code: 0, stdout: '', stderr: '' }
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'UI_LOCK_INVALID' })
    expect(invoked).toBe(false)
  })

  test('restores declared files and package state after a partial shadcn failure', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'astrale-ui.lock.json'), JSON.stringify(lock()))
    const first = path.join(root, 'components/astrale/pattern/chart/line-basic.tsx')
    const second = path.join(root, 'components/astrale/pattern/chart/summary.tsx')
    await mkdir(path.dirname(first), { recursive: true })
    await writeFile(first, 'consumer original\n')
    const twoFileRegistry: UiRegistry = {
      ...registry,
      items: [
        {
          ...registry.items[0]!,
          files: [
            registry.items[0]!.files[0]!,
            {
              path: 'registry/patterns/chart/summary.tsx',
              type: 'registry:component',
              target: 'components/astrale/pattern/chart/summary.tsx',
            },
          ],
        },
      ],
    }
    const lockBefore = await readFile(path.join(root, 'astrale-ui.lock.json'), 'utf8')
    await expect(
      addUi(
        ['pattern/chart/line/basic'],
        { project: root },
        {
          fetcher: mockFetch([], twoFileRegistry),
          runner: async () => {
            await writeFile(first, 'partial overwrite\n')
            await writeFile(second, 'partial create\n')
            return { code: 1, stdout: '', stderr: 'interrupted' }
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'UI_TOOL_FAILED' })
    expect(await readFile(first, 'utf8')).toBe('consumer original\n')
    expect(await Bun.file(second).exists()).toBe(false)
    expect(await readFile(path.join(root, 'astrale-ui.lock.json'), 'utf8')).toBe(lockBefore)
  })

  test('overwrite requires explicit yes confirmation before invoking shadcn', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'astrale-ui.lock.json'), JSON.stringify(lock()))
    let invoked = false
    await expect(
      addUi(
        ['pattern/chart/line/basic'],
        { project: root, overwrite: true },
        {
          fetcher: mockFetch(),
          runner: async () => {
            invoked = true
            return { code: 0, stdout: '', stderr: '' }
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'UI_LOCAL_CHANGES' })
    expect(invoked).toBe(false)
  })

  /** @evidence TEST-CLI-UI-EXACT-ITEM-SOURCE */
  test('rejects a built item that differs from the admitted release index before invoking shadcn', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'astrale-ui.lock.json'), JSON.stringify(lock()))
    const fallback = mockFetch()
    let invoked = false
    const malformed = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/registry/public/r/pattern-chart-line-basic.json')) {
        return Response.json(registry.items[0])
      }
      return fallback(input, init)
    }) as typeof fetch
    await expect(
      addUi(
        ['pattern/chart/line/basic'],
        { project: root },
        {
          fetcher: malformed,
          runner: async () => {
            invoked = true
            return { code: 0, stdout: '', stderr: '' }
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'UI_REGISTRY_UNAVAILABLE' })
    expect(invoked).toBe(false)
  })

  /** @evidence TEST-CLI-UI-SEMANTIC-DIFF */
  test('diff classifies unchanged, modified, deleted, and upstream-changed state', async () => {
    const root = await fixture()
    const file = 'components/astrale/pattern/chart/line-basic.tsx'
    const target = path.join(root, file)
    const content = 'export const Chart = true\n'
    const document = builtItem(registry.items[0]!)
    const installedLock = lock()
    installedLock.items['pattern/chart/line/basic'] = {
      address: 'pattern/chart/line/basic',
      sourceDigest: digest(JSON.stringify(document)),
      files: { [file]: digest(content) },
    }
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
    await writeFile(path.join(root, 'astrale-ui.lock.json'), JSON.stringify(installedLock))

    const unchanged = await diffUi([], { project: root }, { fetcher: mockFetch() })
    expect(unchanged).toMatchObject({
      status: 'compared',
      items: [
        {
          address: 'pattern/chart/line/basic',
          upstream: 'unchanged',
          files: [{ state: 'unchanged' }],
        },
      ],
    })

    await writeFile(target, 'consumer edit\n')
    const modified = await diffUi(
      ['pattern/chart/line/basic'],
      { project: root, path: file },
      { fetcher: mockFetch() },
    )
    expect(modified).toMatchObject({ items: [{ files: [{ path: file, state: 'modified' }] }] })

    await rm(target)
    const deleted = await diffUi([], { project: root }, { fetcher: mockFetch() })
    expect(deleted).toMatchObject({ items: [{ files: [{ state: 'deleted' }] }] })

    const changedRegistry: UiRegistry = {
      ...registry,
      items: [{ ...registry.items[0]!, description: 'Changed upstream source identity.' }],
    }
    const upstream = await diffUi(
      [],
      { project: root },
      { fetcher: mockFetch([], changedRegistry) },
    )
    expect(upstream).toMatchObject({ items: [{ upstream: 'changed' }] })
  })

  test('diff rejects unsafe and unrecorded path restrictions', async () => {
    const root = await fixture()
    const installedLock = lock()
    installedLock.items['pattern/chart/line/basic'] = {
      address: 'pattern/chart/line/basic',
      sourceDigest: digest(JSON.stringify(builtItem(registry.items[0]!))),
      files: { 'components/astrale/pattern/chart/line-basic.tsx': 'b'.repeat(64) },
    }
    await writeFile(path.join(root, 'astrale-ui.lock.json'), JSON.stringify(installedLock))
    for (const selected of ['../../outside.ts', '/tmp/outside.ts', 'src/unrecorded.ts']) {
      await expect(
        diffUi([], { project: root, path: selected }, { fetcher: mockFetch() }),
      ).rejects.toBeInstanceOf(UiError)
    }
  })

  test('preset dry-run is read-only and apply changes CSS plus lock without source rewrites', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'astrale-ui.lock.json'), JSON.stringify(lock()))
    await writeFile(
      path.join(root, 'src/index.css'),
      "@import '@astrale-os/ui/theme.css';\n@import '@astrale-os/ui/presets/astrale.css';\n",
    )
    const before = await readFile(path.join(root, 'src/index.css'), 'utf8')
    await applyPreset('expressive', { project: root, dryRun: true })
    expect(await readFile(path.join(root, 'src/index.css'), 'utf8')).toBe(before)
    await applyPreset('expressive', { project: root })
    expect(await readFile(path.join(root, 'src/index.css'), 'utf8')).toContain(
      '@astrale-os/ui/presets/expressive.css',
    )
    const written = JSON.parse(await readFile(path.join(root, 'astrale-ui.lock.json'), 'utf8'))
    expect(written.preset).toBe('expressive')
  })
})
