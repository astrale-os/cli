import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { digest, parseUiLock } from '../lock'
import { UiError, type UiLock, type UiRegistry } from '../model'
import { addUi, applyPreset, doctorUi, initUi, listUi } from '../operations'
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
          path: 'line-basic.tsx',
          type: 'registry:component',
          target: 'components/astrale/pattern/chart/line-basic.tsx',
        },
      ],
      meta: { canonicalAddress: 'pattern/chart/line/basic' },
    },
  ],
}
const componentRegistry: UiRegistry = {
  name: 'astrale-ui',
  items: [
    {
      name: 'component-sidebar',
      type: 'registry:component',
      title: 'Component · sidebar',
      dependencies: ['@astrale-os/ui@^0.3.0-beta.0', 'lucide-react@1.32.0'],
      files: [
        {
          path: 'sidebar.tsx',
          type: 'registry:component',
          target: 'components/astrale/component/sidebar/sidebar.tsx',
        },
        {
          path: 'use-mobile.ts',
          type: 'registry:hook',
          target: 'components/astrale/component/sidebar/use-mobile.ts',
        },
      ],
      meta: { canonicalAddress: 'component/sidebar', ownership: 'consumer-source' },
    },
  ],
}
const themeCss = `/* Generated from observatory.astrale-theme.json. Consumer-owned after installation. */
:root,
[data-ui-theme='observatory'] {
  --ui-background: #ffffff;
  --ui-foreground: #111111;
  --ui-card: #ffffff;
  --ui-card-foreground: #111111;
  --ui-popover: #ffffff;
  --ui-popover-foreground: #111111;
  --ui-primary: #2244aa;
  --ui-primary-foreground: #ffffff;
  --ui-secondary: #eeeeee;
  --ui-secondary-foreground: #111111;
  --ui-muted: #eeeeee;
  --ui-muted-foreground: #555555;
  --ui-accent: #ddeeff;
  --ui-accent-foreground: #111111;
  --ui-destructive: #aa2222;
  --ui-destructive-foreground: #ffffff;
  --ui-border: #dddddd;
  --ui-input: #dddddd;
  --ui-ring: #2244aa;
  --ui-chart-1: #2244aa;
  --ui-chart-2: #228844;
  --ui-chart-3: #aa7722;
  --ui-chart-4: #aa2222;
  --ui-chart-5: #7722aa;
  --ui-font-body: ui-sans-serif;
  --ui-font-heading: ui-serif;
  --ui-radius: 0.5rem;
  --ui-radius-panel: 0.75rem;
  --ui-control-height: 2.25rem;
  --ui-control-height-sm: 2rem;
  --ui-control-height-lg: 2.5rem;
  --ui-shadow-control: none;
  --ui-shadow-panel: none;
  --ui-motion-fast: 120ms;
  --ui-motion-standard: 180ms;
}
[data-ui-theme='observatory'].dark {
  --ui-background: #111111;
  --ui-foreground: #ffffff;
  --ui-card: #191919;
  --ui-card-foreground: #ffffff;
  --ui-popover: #191919;
  --ui-popover-foreground: #ffffff;
  --ui-primary: #88aaff;
  --ui-primary-foreground: #111111;
  --ui-secondary: #292929;
  --ui-secondary-foreground: #ffffff;
  --ui-muted: #292929;
  --ui-muted-foreground: #bbbbbb;
  --ui-accent: #334455;
  --ui-accent-foreground: #ffffff;
  --ui-destructive: #ff7777;
  --ui-destructive-foreground: #111111;
  --ui-border: #333333;
  --ui-input: #333333;
  --ui-ring: #88aaff;
  --ui-chart-1: #88aaff;
  --ui-chart-2: #77dd99;
  --ui-chart-3: #ffcc77;
  --ui-chart-4: #ff7777;
  --ui-chart-5: #cc88ff;
  --ui-font-body: ui-sans-serif;
  --ui-font-heading: ui-serif;
  --ui-radius: 0.5rem;
  --ui-radius-panel: 0.75rem;
  --ui-control-height: 2.25rem;
  --ui-control-height-sm: 2rem;
  --ui-control-height-lg: 2.5rem;
  --ui-shadow-control: none;
  --ui-shadow-panel: none;
  --ui-motion-fast: 120ms;
  --ui-motion-standard: 180ms;
}
`
const themeRegistry: UiRegistry = {
  name: 'astrale-ui',
  items: [
    {
      name: 'theme-observatory',
      type: 'registry:theme',
      description: 'An owned theme.',
      dependencies: ['@astrale-os/ui@^0.3.0-beta.0'],
      files: [
        {
          path: 'observatory.css',
          type: 'registry:file',
          target: 'components/astrale/theme/observatory.css',
        },
      ],
      meta: { canonicalAddress: 'theme/observatory', ownership: 'consumer-source' },
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

function themeFetch(seen: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    seen.push(url)
    if (url.includes('/git/ref/tags/')) {
      return Response.json({ object: { type: 'commit', sha: commit, url: '' } })
    }
    if (url.endsWith('/tooling/compatibility.json')) return Response.json(compatibility)
    if (url.endsWith('/' + commit + '/registry.json')) {
      return Response.json({ name: 'astrale-ui', include: ['registry/themes/registry.json'] })
    }
    if (url.endsWith('/registry/themes/registry.json')) return Response.json(themeRegistry)
    if (url.endsWith('/registry/public/r/theme-observatory.json')) {
      return Response.json(builtThemeItem())
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

function builtThemeItem() {
  return {
    ...themeRegistry.items[0],
    files: [
      {
        ...themeRegistry.items[0]!.files[0],
        path: 'registry/themes/observatory.css',
        content: themeCss,
      },
    ],
  }
}

function builtItem(item: UiRegistry['items'][number]) {
  return {
    ...item,
    files: item.files.map((file, index) => ({
      ...file,
      path: `registry/patterns/chart/${file.path}`,
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
      dependencies: {
        react: '19.2.8',
        'react-dom': '19.2.8',
        tailwindcss: '4.3.3',
      },
      packageManager: 'pnpm@11.13.1',
    }),
  )
  await writeFile(path.join(root, 'src/index.css'), '/* consumer css */\n')
  return root
}

async function lockedFixture(): Promise<string> {
  const root = await fixture()
  const manifestPath = path.join(root, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.dependencies['@astrale-os/ui'] = '0.3.0-beta.0'
  await writeFile(manifestPath, JSON.stringify(manifest))
  await writeFile(path.join(root, 'astrale-ui.lock.json'), JSON.stringify(lock()))
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
  /** @evidence TEST-CLI-UI-BETA-DEFAULT */
  test('resolves the default release from the public beta channel', async () => {
    const seen: string[] = []
    const fallback = mockFetch()
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      seen.push(url)
      if (url.endsWith('/@astrale-os/ui/beta')) {
        return Response.json({ version: '0.3.0-beta.1' })
      }
      return fallback(input, init)
    }) as typeof fetch

    const release = await resolveUiRelease(undefined, fetcher)

    expect(release.version).toBe('0.3.0-beta.1')
    expect(seen[0]).toBe('https://registry.npmjs.org/@astrale-os/ui/beta')
    expect(seen).not.toContain('https://registry.npmjs.org/@astrale-os/ui/latest')
  })

  test('rejects a public beta channel that does not resolve to a beta release', async () => {
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/@astrale-os/ui/beta')) return Response.json({ version: '0.3.0' })
      throw new Error('release snapshot must not be fetched')
    }) as typeof fetch

    await expect(resolveUiRelease(undefined, fetcher)).rejects.toMatchObject({
      code: 'UI_REGISTRY_UNAVAILABLE',
      message: 'Invalid UI beta release version: 0.3.0',
    })
  })

  /** @evidence TEST-CLI-UI-ONE-SNAPSHOT */
  test('resolves one commit and reads the full release snapshot from it', async () => {
    const seen: string[] = []
    const release = await resolveUiRelease('0.3.0-beta.0', mockFetch(seen))
    expect(release.commit).toBe(commit)
    expect(release.compatibility.base).toBe('base')
    expect(release.registry.items).toHaveLength(1)
    expect(release.registry.items[0]?.files[0]?.path).toBe('registry/patterns/chart/line-basic.tsx')
    expect(seen.filter((url) => new URL(url).hostname === 'raw.githubusercontent.com')).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/' + commit + '/tooling/compatibility.json'),
        expect.stringContaining('/' + commit + '/registry'),
      ]),
    )
  })

  test('admits a release theme as one canonical consumer-owned CSS target', async () => {
    const release = await resolveUiRelease('0.3.0-beta.0', themeFetch())
    expect(release.registry.items).toEqual([
      expect.objectContaining({
        name: 'theme-observatory',
        type: 'registry:theme',
        meta: expect.objectContaining({ canonicalAddress: 'theme/observatory' }),
        files: [
          expect.objectContaining({
            type: 'registry:file',
            path: 'registry/themes/observatory.css',
            target: 'components/astrale/theme/observatory.css',
          }),
        ],
      }),
    ])
  })

  test('admits an exact consumer-owned component with item-local dependencies and files', async () => {
    const release = await resolveUiRelease('0.3.0-beta.0', mockFetch([], componentRegistry))
    expect(release.registry.items).toEqual([
      expect.objectContaining({
        name: 'component-sidebar',
        type: 'registry:component',
        dependencies: ['@astrale-os/ui@^0.3.0-beta.0', 'lucide-react@1.32.0'],
        meta: expect.objectContaining({ canonicalAddress: 'component/sidebar' }),
        files: [
          expect.objectContaining({
            type: 'registry:component',
            target: 'components/astrale/component/sidebar/sidebar.tsx',
          }),
          expect.objectContaining({
            type: 'registry:hook',
            target: 'components/astrale/component/sidebar/use-mobile.ts',
          }),
        ],
      }),
    ])
  })

  test('rejects a component item that targets another registry ownership category', async () => {
    const invalid = structuredClone(componentRegistry)
    invalid.items[0]!.files[0]!.target = 'components/astrale/pattern/sidebar/sidebar.tsx'
    await expect(resolveUiRelease('0.3.0-beta.0', mockFetch([], invalid))).rejects.toMatchObject({
      code: 'UI_REGISTRY_UNAVAILABLE',
    })
  })

  test('lists release themes through the public type filter', async () => {
    const themes = await listUi(
      undefined,
      { type: 'theme', version: '0.3.0-beta.0' },
      { fetcher: themeFetch() },
    )
    expect(themes.map((item) => item.meta.canonicalAddress)).toEqual(['theme/observatory'])
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

  test('rejects noncanonical and encoded registry includes before fetching them', async () => {
    const unsafeIncludes = [
      '%2e%2e/other/registry.json',
      'registry/%2Fother/registry.json',
      'registry/other/registry.json?raw=1',
      'registry/other/registry.json#item',
      'https://example.invalid/registry.json',
      './registry/other/registry.json',
    ]

    for (const include of unsafeIncludes) {
      const seen: string[] = []
      const fallback = mockFetch(seen)
      const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/' + commit + '/registry.json')) {
          return Response.json({ include: [include] })
        }
        return fallback(input, init)
      }) as typeof fetch

      await expect(resolveUiRelease('0.3.0-beta.0', fetcher)).rejects.toMatchObject({
        code: 'UI_REGISTRY_UNAVAILABLE',
      })
      expect(seen.some((url) => url.includes('example.invalid') || url.includes('/other/'))).toBe(
        false,
      )
    }
  })

  test('rejects malformed and already-qualified family-local item paths', async () => {
    const unsafePaths = [
      '',
      '/absolute.tsx',
      'C:/windows.tsx',
      './line-basic.tsx',
      '../line-basic.tsx',
      '%2e%2e/line-basic.tsx',
      'registry/patterns/chart/line-basic.tsx',
    ]

    for (const unsafePath of unsafePaths) {
      const supplied = structuredClone(registry)
      supplied.items[0]!.files[0]!.path = unsafePath
      await expect(resolveUiRelease('0.3.0-beta.0', mockFetch([], supplied))).rejects.toMatchObject(
        {
          code: 'UI_REGISTRY_UNAVAILABLE',
        },
      )
    }
  })

  test('qualifies every item file relative to its declaring nested registry', async () => {
    const rootItem = {
      ...structuredClone(registry.items[0]!),
      name: 'pattern-chart-root',
      files: [
        {
          ...structuredClone(registry.items[0]!.files[0]!),
          path: 'registry/root.tsx',
          target: 'components/astrale/pattern/chart/root.tsx',
        },
      ],
      meta: { canonicalAddress: 'pattern/chart/root' },
    }
    const chartItem = {
      ...structuredClone(registry.items[0]!),
      files: [
        structuredClone(registry.items[0]!.files[0]!),
        {
          ...structuredClone(registry.items[0]!.files[0]!),
          path: 'parts/legend.tsx',
          target: 'components/astrale/pattern/chart/parts/legend.tsx',
        },
      ],
    }
    const nestedItem = {
      ...structuredClone(registry.items[0]!),
      name: 'pattern-chart-nested-line',
      files: [structuredClone(registry.items[0]!.files[0]!)],
      meta: { canonicalAddress: 'pattern/chart/nested-line' },
    }
    const fallback = mockFetch()
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/' + commit + '/registry.json')) {
        return Response.json({
          items: [rootItem],
          include: ['registry/patterns/chart/registry.json'],
        })
      }
      if (url.endsWith('/registry/patterns/chart/registry.json')) {
        return Response.json({ items: [chartItem], include: ['nested/registry.json'] })
      }
      if (url.endsWith('/registry/patterns/chart/nested/registry.json')) {
        return Response.json({ items: [nestedItem] })
      }
      return fallback(input, init)
    }) as typeof fetch

    const release = await resolveUiRelease('0.3.0-beta.0', fetcher)
    expect(release.registry.items.map((item) => item.files.map((file) => file.path))).toEqual([
      ['registry/root.tsx'],
      ['registry/patterns/chart/line-basic.tsx', 'registry/patterns/chart/parts/legend.tsx'],
      ['registry/patterns/chart/nested/line-basic.tsx'],
    ])
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
  test('initializes the generated Domain frontend stylesheet instead of an unused fallback', async () => {
    const root = await fixture()
    await mkdir(path.join(root, 'frontend/src'), { recursive: true })
    await writeFile(
      path.join(root, 'frontend/package.json'),
      JSON.stringify({ name: 'astrale-frontend', private: true, type: 'module' }),
    )
    await writeFile(path.join(root, 'frontend/src/styles.css'), '/* Domain frontend */\n')
    await mkdir(path.join(root, 'ui'), { recursive: true })
    await writeFile(path.join(root, 'ui/index.ts'), 'export {}\n')
    await writeFile(path.join(root, 'astrale.config.ts'), 'export default {}\n')
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'frontend'\n")
    const rootCssBefore = await readFile(path.join(root, 'src/index.css'), 'utf8')

    await initUi(
      { path: path.join(root, 'frontend'), version: '0.3.0-beta.0', install: false },
      { fetcher: mockFetch() },
    )

    const css = await readFile(path.join(root, 'frontend/src/styles.css'), 'utf8')
    const components = JSON.parse(await readFile(path.join(root, 'components.json'), 'utf8'))
    expect(css).toContain("@import '@astrale-os/ui/theme.css';")
    expect(css).toContain('/* Domain frontend */')
    expect(components.tailwind.css).toBe('frontend/src/styles.css')
    expect(await readFile(path.join(root, 'src/index.css'), 'utf8')).toBe(rootCssBefore)
    expect(
      JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).dependencies,
    ).toHaveProperty('@astrale-os/ui', '0.3.0-beta.0')
    expect(await Bun.file(path.join(root, 'src/astrale-ui.css')).exists()).toBe(false)
    expect(JSON.parse(await readFile(path.join(root, 'components/package.json'), 'utf8'))).toEqual({
      name: 'fixture-ui-registry',
      private: true,
      type: 'module',
    })
    expect(await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')).toContain('components')

    await writeFile(path.join(root, 'src/app.css'), '/* later root stylesheet */\n')
    const repeated = await initUi(
      { path: root, version: '0.3.0-beta.0', install: false },
      { fetcher: mockFetch() },
    )
    expect(repeated.status).toBe('unchanged')
  })

  test('adds the private registry workspace to an npm-authored Domain manifest', async () => {
    const root = await fixture()
    const manifestPath = path.join(root, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.packageManager = 'npm@11.16.0'
    manifest.workspaces = ['frontend']
    await writeFile(manifestPath, JSON.stringify(manifest))
    await writeFile(path.join(root, 'package-lock.json'), '{}')
    await mkdir(path.join(root, 'frontend/src'), { recursive: true })
    await writeFile(
      path.join(root, 'frontend/package.json'),
      JSON.stringify({ name: 'astrale-frontend', private: true }),
    )
    await writeFile(path.join(root, 'frontend/src/styles.css'), '/* Domain frontend */\n')
    await mkdir(path.join(root, 'ui'), { recursive: true })
    await writeFile(path.join(root, 'ui/index.ts'), 'export {}\n')
    await writeFile(path.join(root, 'astrale.config.ts'), 'export default {}\n')

    const result = await initUi(
      { path: root, version: '0.3.0-beta.0', install: false },
      { fetcher: mockFetch() },
    )

    expect(result.files).toEqual(expect.arrayContaining(['components/package.json']))
    expect(JSON.parse(await readFile(manifestPath, 'utf8')).workspaces).toEqual([
      'frontend',
      'components',
    ])
    expect(JSON.parse(await readFile(path.join(root, 'components/package.json'), 'utf8'))).toEqual({
      name: 'fixture-ui-registry',
      private: true,
      type: 'module',
    })
  })

  test('rejects a Domain registry workspace whose physical parent escapes the project', async () => {
    const root = await fixture()
    const outside = await fixture()
    await mkdir(path.join(root, 'frontend/src'), { recursive: true })
    await writeFile(
      path.join(root, 'frontend/package.json'),
      JSON.stringify({ name: 'astrale-frontend', private: true }),
    )
    await writeFile(path.join(root, 'frontend/src/styles.css'), '/* Domain frontend */\n')
    await mkdir(path.join(root, 'ui'), { recursive: true })
    await writeFile(path.join(root, 'ui/index.ts'), 'export {}\n')
    await writeFile(path.join(root, 'astrale.config.ts'), 'export default {}\n')
    await symlink(outside, path.join(root, 'components'), 'dir')
    const outsideManifest = await readFile(path.join(outside, 'package.json'), 'utf8')
    const rootManifest = await readFile(path.join(root, 'package.json'), 'utf8')

    await expect(
      initUi({ path: root, version: '0.3.0-beta.0', install: false }, { fetcher: mockFetch() }),
    ).rejects.toMatchObject({ code: 'UI_LOCK_INVALID' })
    expect(await readFile(path.join(outside, 'package.json'), 'utf8')).toBe(outsideManifest)
    expect(await readFile(path.join(root, 'package.json'), 'utf8')).toBe(rootManifest)
    expect(await Bun.file(path.join(root, 'astrale-ui.lock.json')).exists()).toBe(false)
  })

  test('rejects a symlinked pnpm workspace manifest before any Domain mutation', async () => {
    const root = await fixture()
    const outside = await fixture()
    await mkdir(path.join(root, 'frontend/src'), { recursive: true })
    await writeFile(
      path.join(root, 'frontend/package.json'),
      JSON.stringify({ name: 'astrale-frontend', private: true }),
    )
    await writeFile(path.join(root, 'frontend/src/styles.css'), '/* Domain frontend */\n')
    await mkdir(path.join(root, 'ui'), { recursive: true })
    await writeFile(path.join(root, 'ui/index.ts'), 'export {}\n')
    await writeFile(path.join(root, 'astrale.config.ts'), 'export default {}\n')
    const outsideWorkspace = path.join(outside, 'workspace.yaml')
    await writeFile(outsideWorkspace, "packages:\n  - 'outside'\n")
    await symlink(outsideWorkspace, path.join(root, 'pnpm-workspace.yaml'), 'file')
    const outsideBefore = await readFile(outsideWorkspace, 'utf8')

    await expect(
      initUi({ path: root, version: '0.3.0-beta.0', install: false }, { fetcher: mockFetch() }),
    ).rejects.toMatchObject({ code: 'UI_LOCK_INVALID' })
    expect(await readFile(outsideWorkspace, 'utf8')).toBe(outsideBefore)
    expect(await Bun.file(path.join(root, 'components/package.json')).exists()).toBe(false)
    expect(await Bun.file(path.join(root, 'astrale-ui.lock.json')).exists()).toBe(false)
  })

  test('restores every Domain workspace mutation when dependency installation fails', async () => {
    const root = await fixture()
    await mkdir(path.join(root, 'frontend/src'), { recursive: true })
    await writeFile(
      path.join(root, 'frontend/package.json'),
      JSON.stringify({ name: 'astrale-frontend', private: true }),
    )
    await writeFile(path.join(root, 'frontend/src/styles.css'), '/* Domain frontend */\n')
    await mkdir(path.join(root, 'ui'), { recursive: true })
    await writeFile(path.join(root, 'ui/index.ts'), 'export {}\n')
    await writeFile(path.join(root, 'astrale.config.ts'), 'export default {}\n')
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'frontend'\n")
    const manifestBefore = await readFile(path.join(root, 'package.json'), 'utf8')
    const cssBefore = await readFile(path.join(root, 'frontend/src/styles.css'), 'utf8')
    const workspaceBefore = await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')

    await expect(
      initUi(
        { path: root, version: '0.3.0-beta.0' },
        {
          fetcher: mockFetch(),
          runner: async () => ({ code: 1, stdout: '', stderr: 'install failed' }),
        },
      ),
    ).rejects.toMatchObject({ code: 'UI_DEPENDENCY_INSTALL_FAILED' })

    expect(await readFile(path.join(root, 'package.json'), 'utf8')).toBe(manifestBefore)
    expect(await readFile(path.join(root, 'frontend/src/styles.css'), 'utf8')).toBe(cssBefore)
    expect(await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe(workspaceBefore)
    expect(await Bun.file(path.join(root, 'components/package.json')).exists()).toBe(false)
    expect(await Bun.file(path.join(root, 'components.json')).exists()).toBe(false)
    expect(await Bun.file(path.join(root, 'astrale-ui.lock.json')).exists()).toBe(false)
    expect(await Bun.file(path.join(root, 'pnpm-lock.yaml')).exists()).toBe(false)
  })

  test('rejects a registry workspace that could shadow the public UI package', async () => {
    const root = await fixture()
    await mkdir(path.join(root, 'frontend/src'), { recursive: true })
    await writeFile(
      path.join(root, 'frontend/package.json'),
      JSON.stringify({ name: 'astrale-frontend', private: true }),
    )
    await writeFile(path.join(root, 'frontend/src/styles.css'), '/* Domain frontend */\n')
    await mkdir(path.join(root, 'ui'), { recursive: true })
    await writeFile(path.join(root, 'ui/index.ts'), 'export {}\n')
    await writeFile(path.join(root, 'astrale.config.ts'), 'export default {}\n')
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'frontend'\n")
    await mkdir(path.join(root, 'components'), { recursive: true })
    await writeFile(
      path.join(root, 'components/package.json'),
      JSON.stringify({ name: '@astrale-os/ui', private: true, version: '0.3.0-beta.0' }),
    )
    const workspaceBefore = await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')

    await expect(
      initUi({ path: root, version: '0.3.0-beta.0', install: false }, { fetcher: mockFetch() }),
    ).rejects.toMatchObject({ code: 'UI_PROJECT_UNSUPPORTED' })
    expect(await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe(workspaceBefore)
    expect(
      JSON.parse(await readFile(path.join(root, 'components/package.json'), 'utf8')).name,
    ).toBe('@astrale-os/ui')
  })

  test('rejects configured and discovered stylesheets whose physical parent escapes', async () => {
    const root = await fixture()
    const outside = await fixture()
    await symlink(outside, path.join(root, 'escaped'), 'dir')
    await writeFile(
      path.join(root, 'components.json'),
      JSON.stringify({ tailwind: { css: 'escaped/styles.css' } }),
    )

    await expect(
      initUi({ path: root, version: '0.3.0-beta.0', install: false }, { fetcher: mockFetch() }),
    ).rejects.toMatchObject({ code: 'UI_PROJECT_UNSUPPORTED' })
    expect(await Bun.file(path.join(outside, 'styles.css')).exists()).toBe(false)

    const automaticRoot = await fixture()
    await rm(path.join(automaticRoot, 'src/index.css'))
    const outsideCss = await readFile(path.join(outside, 'src/index.css'), 'utf8')
    await symlink(outside, path.join(automaticRoot, 'frontend'), 'dir')
    await expect(
      initUi(
        { path: automaticRoot, version: '0.3.0-beta.0', install: false },
        { fetcher: mockFetch() },
      ),
    ).rejects.toMatchObject({ code: 'UI_PROJECT_UNSUPPORTED' })
    expect(await readFile(path.join(outside, 'src/index.css'), 'utf8')).toBe(outsideCss)
  })

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

  test('preserves an existing development-only UI dependency during initialization', async () => {
    const root = await fixture()
    const manifestPath = path.join(root, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.devDependencies = { '@astrale-os/ui': '0.3.0-beta.0' }
    await writeFile(manifestPath, JSON.stringify(manifest))

    await initUi({ path: root, version: '0.3.0-beta.0', install: false }, { fetcher: mockFetch() })

    const written = JSON.parse(await readFile(manifestPath, 'utf8'))
    expect(written.dependencies['@astrale-os/ui']).toBeUndefined()
    expect(written.devDependencies['@astrale-os/ui']).toBe('0.3.0-beta.0')
  })

  test('doctor accepts one exact development dependency and rejects drift or duplication', async () => {
    const root = await lockedFixture()
    const manifestPath = path.join(root, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete manifest.dependencies['@astrale-os/ui']
    manifest.devDependencies = { '@astrale-os/ui': '0.3.0-beta.0' }
    await writeFile(manifestPath, JSON.stringify(manifest))
    await writeFile(
      path.join(root, 'components.json'),
      JSON.stringify({ style: 'base-nova', tailwind: { css: 'src/index.css' } }),
    )
    await writeFile(
      path.join(root, 'src/index.css'),
      "@import '@astrale-os/ui/theme.css';\n@import '@astrale-os/ui/presets/astrale.css';\n",
    )

    expect((await doctorUi(root)).healthy).toBe(true)

    manifest.devDependencies['@astrale-os/ui'] = '0.3.0-beta.1'
    await writeFile(manifestPath, JSON.stringify(manifest))
    expect((await doctorUi(root)).checks.find(({ check }) => check === 'package')).toMatchObject({
      ok: false,
      detail: 'devDependencies:0.3.0-beta.1',
    })

    manifest.devDependencies['@astrale-os/ui'] = '0.3.0-beta.0'
    manifest.dependencies['@astrale-os/ui'] = '0.3.0-beta.0'
    await writeFile(manifestPath, JSON.stringify(manifest))
    expect((await doctorUi(root)).checks.find(({ check }) => check === 'package')).toMatchObject({
      ok: false,
      detail: 'declared in dependencies and devDependencies',
    })
  })

  test('repeated exact init performs no release fetch while requested drift rejects', async () => {
    const root = await fixture()
    const manifestPath = path.join(root, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.dependencies['@astrale-os/ui'] = '0.3.0-beta.0'
    await writeFile(manifestPath, JSON.stringify(manifest))
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
    manifest.dependencies['@astrale-os/ui'] = '0.3.0-beta.1'
    await writeFile(manifestPath, JSON.stringify(manifest))
    await expect(initUi({ path: root, preset: 'astrale' })).rejects.toMatchObject({
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
    const root = await lockedFixture()
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

  /** @evidence TEST-CLI-UI-THEME-OWNERSHIP */
  test('installs and activates a released theme while recording owned source', async () => {
    const root = await lockedFixture()
    await writeFile(
      path.join(root, 'components.json'),
      JSON.stringify({ style: 'base-nova', tailwind: { css: 'src/index.css' } }),
    )
    await writeFile(
      path.join(root, 'src/index.css'),
      "@import '@astrale-os/ui/theme.css';\n@import '@astrale-os/ui/presets/astrale.css';\n",
    )
    const target = path.join(root, 'components/astrale/theme/observatory.css')
    let invoked = false
    const result = await addUi(
      ['theme/observatory'],
      { project: root, yes: true },
      {
        fetcher: themeFetch(),
        runner: async () => {
          invoked = true
          return { code: 0, stdout: '', stderr: '' }
        },
      },
    )

    expect(invoked).toBe(false)
    expect(result).toMatchObject({ status: 'installed', items: ['theme/observatory'] })
    expect(await readFile(target, 'utf8')).toBe(themeCss)
    expect(await readFile(path.join(root, 'src/index.css'), 'utf8')).toContain(
      "@import '../components/astrale/theme/observatory.css';",
    )
    const written = JSON.parse(await readFile(path.join(root, 'astrale-ui.lock.json'), 'utf8'))
    expect(written.items['theme/observatory']).toMatchObject({
      address: 'theme/observatory',
      sourceDigest: digest(JSON.stringify(builtThemeItem())),
      files: { 'components/astrale/theme/observatory.css': digest(themeCss) },
    })
    expect((await doctorUi(root)).healthy).toBe(true)
  })

  /** @evidence TEST-CLI-UI-THEME-OWNERSHIP */
  test('installs a playground-exported theme without registry or shadcn and preserves edits', async () => {
    const root = await lockedFixture()
    const source = path.join(root, 'observatory.css')
    const target = path.join(root, 'components/astrale/theme/observatory.css')
    await writeFile(source, themeCss)
    let invoked = false

    const planned = await addUi(
      ['./observatory.css'],
      { project: root, dryRun: true },
      {
        fetcher: (async () => {
          invoked = true
          throw new Error('must not fetch')
        }) as unknown as typeof fetch,
        runner: async () => {
          invoked = true
          return { code: 1, stdout: '', stderr: '' }
        },
      },
    )
    expect(planned).toMatchObject({
      status: 'planned',
      items: ['theme/observatory'],
      activation: {
        file: 'src/index.css',
        import: "@import '../components/astrale/theme/observatory.css';",
      },
    })
    expect(await Bun.file(target).exists()).toBe(false)

    await addUi(
      ['./observatory.css'],
      { project: root },
      {
        fetcher: (async () => {
          invoked = true
          throw new Error('must not fetch')
        }) as unknown as typeof fetch,
        runner: async () => {
          invoked = true
          return { code: 1, stdout: '', stderr: '' }
        },
      },
    )
    expect(invoked).toBe(false)
    expect(await readFile(target, 'utf8')).toBe(themeCss)
    expect(await readFile(path.join(root, 'src/index.css'), 'utf8')).toContain(
      "@import '../components/astrale/theme/observatory.css';",
    )

    await writeFile(target, 'consumer edit\n')
    await expect(addUi(['./observatory.css'], { project: root })).rejects.toMatchObject({
      code: 'UI_LOCAL_CHANGES',
    })
    await addUi(['./observatory.css'], { project: root, overwrite: true, yes: true })
    expect(await readFile(target, 'utf8')).toBe(themeCss)
  })

  test('rejects malformed and symlinked local themes before project mutation', async () => {
    const root = await lockedFixture()
    const cssBefore = await readFile(path.join(root, 'src/index.css'), 'utf8')
    await writeFile(path.join(root, 'unsafe.css'), "@import 'https://example.invalid/theme.css';\n")
    await expect(addUi(['./unsafe.css'], { project: root })).rejects.toMatchObject({
      code: 'UI_ITEM_CONFLICT',
    })

    const outside = await mkdtemp(path.join(tmpdir(), 'astrale-ui-theme-'))
    temporary.push(outside)
    await writeFile(path.join(outside, 'observatory.css'), themeCss)
    await symlink(path.join(outside, 'observatory.css'), path.join(root, 'linked.css'))
    await expect(addUi(['./linked.css'], { project: root })).rejects.toMatchObject({
      code: 'UI_ITEM_NOT_FOUND',
    })
    expect(await readFile(path.join(root, 'src/index.css'), 'utf8')).toBe(cssBefore)
  })

  test('rejects a symlinked UI lock before a theme can mutate outside the project', async () => {
    const root = await lockedFixture()
    const source = path.join(root, 'observatory.css')
    await writeFile(source, themeCss)
    const lockPath = path.join(root, 'astrale-ui.lock.json')
    const outside = await mkdtemp(path.join(tmpdir(), 'astrale-ui-lock-'))
    temporary.push(outside)
    const outsideLock = path.join(outside, 'astrale-ui.lock.json')
    const lockSource = await readFile(lockPath, 'utf8')
    await writeFile(outsideLock, lockSource)
    await rm(lockPath)
    await symlink(outsideLock, lockPath)
    const cssBefore = await readFile(path.join(root, 'src/index.css'), 'utf8')

    await expect(addUi(['./observatory.css'], { project: root })).rejects.toMatchObject({
      code: 'UI_LOCK_INVALID',
    })
    expect(await readFile(outsideLock, 'utf8')).toBe(lockSource)
    expect(await readFile(path.join(root, 'src/index.css'), 'utf8')).toBe(cssBefore)
    expect(
      await Bun.file(path.join(root, 'components/astrale/theme/observatory.css')).exists(),
    ).toBe(false)
  })

  test('rolls back a newly copied local theme and activation when the lock commit fails', async () => {
    const root = await lockedFixture()
    await writeFile(path.join(root, 'observatory.css'), themeCss)
    const lockPath = path.join(root, 'astrale-ui.lock.json')
    const cssPath = path.join(root, 'src/index.css')
    const target = path.join(root, 'components/astrale/theme/observatory.css')
    const lockBefore = await readFile(lockPath, 'utf8')
    const cssBefore = await readFile(cssPath, 'utf8')
    await chmod(lockPath, 0o444)

    try {
      await expect(addUi(['./observatory.css'], { project: root })).rejects.toBeInstanceOf(Error)
    } finally {
      await chmod(lockPath, 0o644)
    }

    expect(await Bun.file(target).exists()).toBe(false)
    expect(await readFile(cssPath, 'utf8')).toBe(cssBefore)
    expect(await readFile(lockPath, 'utf8')).toBe(lockBefore)
  })

  test('successful add records installed file digests and doctor detects later edits', async () => {
    const root = await lockedFixture()
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

  test('restores the exact locked UI dependency after shadcn applies its compatible range', async () => {
    const root = await lockedFixture()
    const installed = path.join(root, 'components/astrale/pattern/chart/line-basic.tsx')
    const calls: Array<{ file: string; args: string[] }> = []

    await addUi(
      ['pattern/chart/line/basic'],
      { project: root, yes: true },
      {
        fetcher: mockFetch(),
        runner: async (file, args) => {
          calls.push({ file, args })
          if (args[0] === 'dlx') {
            await mkdir(path.dirname(installed), { recursive: true })
            await writeFile(installed, 'export const Chart = true\n')
            const manifestPath = path.join(root, 'package.json')
            const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
            manifest.dependencies['@astrale-os/ui'] = '^0.3.0-beta.0'
            await writeFile(manifestPath, JSON.stringify(manifest))
          }
          return { code: 0, stdout: '', stderr: '' }
        },
      },
    )

    expect(calls).toEqual([
      expect.objectContaining({ file: 'pnpm', args: expect.arrayContaining(['dlx']) }),
      { file: 'pnpm', args: ['install'] },
    ])
    expect(
      JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).dependencies[
        '@astrale-os/ui'
      ],
    ).toBe('0.3.0-beta.0')
  })

  test('restores a development-only UI dependency without retaining shadcn duplication', async () => {
    const root = await lockedFixture()
    const manifestPath = path.join(root, 'package.json')
    const initial = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete initial.dependencies['@astrale-os/ui']
    initial.devDependencies = { '@astrale-os/ui': '0.3.0-beta.0' }
    await writeFile(manifestPath, JSON.stringify(initial))
    const installed = path.join(root, 'components/astrale/pattern/chart/line-basic.tsx')

    await addUi(
      ['pattern/chart/line/basic'],
      { project: root, yes: true },
      {
        fetcher: mockFetch(),
        runner: async (_file, args) => {
          if (args[0] === 'dlx') {
            await mkdir(path.dirname(installed), { recursive: true })
            await writeFile(installed, 'export const Chart = true\n')
            const changed = JSON.parse(await readFile(manifestPath, 'utf8'))
            changed.dependencies['@astrale-os/ui'] = '^0.3.0-beta.0'
            await writeFile(manifestPath, JSON.stringify(changed))
          }
          return { code: 0, stdout: '', stderr: '' }
        },
      },
    )

    const written = JSON.parse(await readFile(manifestPath, 'utf8'))
    expect(written.dependencies['@astrale-os/ui']).toBeUndefined()
    expect(written.devDependencies['@astrale-os/ui']).toBe('0.3.0-beta.0')
  })

  test('rolls back item and package state when restoring the locked dependency fails', async () => {
    const root = await lockedFixture()
    const manifestPath = path.join(root, 'package.json')
    const lockPath = path.join(root, 'astrale-ui.lock.json')
    const installed = path.join(root, 'components/astrale/pattern/chart/line-basic.tsx')
    const manifestBefore = await readFile(manifestPath, 'utf8')
    const lockBefore = await readFile(lockPath, 'utf8')

    await expect(
      addUi(
        ['pattern/chart/line/basic'],
        { project: root, yes: true },
        {
          fetcher: mockFetch(),
          runner: async (_file, args) => {
            if (args[0] === 'dlx') {
              await mkdir(path.dirname(installed), { recursive: true })
              await writeFile(installed, 'export const Chart = true\n')
              const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
              manifest.dependencies['@astrale-os/ui'] = '^0.3.0-beta.0'
              await writeFile(manifestPath, JSON.stringify(manifest))
              return { code: 0, stdout: '', stderr: '' }
            }
            await writeFile(path.join(root, 'pnpm-lock.yaml'), 'partial lock\n')
            return { code: 1, stdout: '', stderr: 'registry timeout' }
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'UI_DEPENDENCY_INSTALL_FAILED' })

    expect(await readFile(manifestPath, 'utf8')).toBe(manifestBefore)
    expect(await readFile(lockPath, 'utf8')).toBe(lockBefore)
    expect(await Bun.file(installed).exists()).toBe(false)
    expect(await Bun.file(path.join(root, 'pnpm-lock.yaml')).exists()).toBe(false)
  })

  test('preflights symlink targets without invoking shadcn', async () => {
    const root = await lockedFixture()
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
    const root = await lockedFixture()
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
              path: 'summary.tsx',
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
    const root = await lockedFixture()
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
    const root = await lockedFixture()
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
