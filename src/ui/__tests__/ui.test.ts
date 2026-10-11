import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import * as fsPromises from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { UiRunner } from '../model'

import { sha256 } from '../files'
import { parseUiLock } from '../lock'
import { THEME_TOKENS, UiError, type UiLock, type UiRegistry, type UiRegistryItem } from '../model'
import { addUi, applyPreset, doctorUi, initUi } from '../operations'
import { resolveUiRelease } from '../release'

const COMMIT = 'a'.repeat(40)
const VERSION = '0.3.0-beta.0'
const PACKAGE_CSS =
  "@import '@astrale-os/ui/theme.css';\n@import '@astrale-os/ui/presets/astrale.css';\n"
const CHART = 'pattern/chart/line/basic'
const CHART_FILE = 'components/astrale/pattern/chart/line-basic.tsx'

const chart: UiRegistryItem = {
  name: 'pattern-chart-line-basic',
  type: 'registry:block',
  files: [{ path: 'line-basic.tsx', type: 'registry:component', target: CHART_FILE }],
  meta: { canonicalAddress: CHART },
}
const sidebar: UiRegistryItem = {
  name: 'component-sidebar',
  type: 'registry:component',
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
  meta: { canonicalAddress: 'component/sidebar' },
}
const theme: UiRegistryItem = {
  name: 'theme-observatory',
  type: 'registry:theme',
  files: [
    {
      path: 'observatory.css',
      type: 'registry:file',
      target: 'components/astrale/theme/observatory.css',
    },
  ],
  meta: { canonicalAddress: 'theme/observatory' },
}
const themeCss = [
  '/* Consumer-owned after installation. */',
  `:root, [data-ui-theme='observatory'] { ${THEME_TOKENS.map((token) => `--ui-${token}: 1;`).join(' ')} }`,
  `[data-ui-theme='observatory'].dark { ${THEME_TOKENS.map((token) => `--ui-${token}: 2;`).join(' ')} }`,
  '',
].join('\n')
const compatibility = { version: 1, shadcn: '4.18.0', base: 'base', style: 'nova', baseUi: '1.7.0' }

function built(item: UiRegistryItem) {
  return {
    ...item,
    files: item.files.map((file) => ({
      ...file,
      path: `registry/family/${file.path}`,
      content: item === theme ? themeCss : `export const source = '${file.path}'\n`,
    })),
  }
}

type Route = Response | (() => Response)

/** A UI release snapshot at COMMIT whose one family registry holds `items`; `routes` overrides by URL suffix. */
function release(
  items: UiRegistryItem[] = [chart],
  routes: Record<string, Route> = {},
  seen: string[] = [],
) {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    seen.push(url)
    const route = Object.entries(routes).find(([suffix]) => url.endsWith(suffix))?.[1]
    if (route) return typeof route === 'function' ? route() : route.clone()
    if (url.includes('/git/ref/tags/'))
      return Response.json({ object: { type: 'commit', sha: COMMIT, url: '' } })
    if (url.endsWith('/tooling/compatibility.json')) return Response.json(compatibility)
    if (url.endsWith(`/${COMMIT}/registry.json`)) {
      return Response.json({
        include: ['registry/base/registry.json', 'registry/family/registry.json'],
      })
    }
    if (url.endsWith('/registry/base/registry.json')) {
      return Response.json({ items: [{ name: 'base', type: 'registry:base' }] })
    }
    if (url.endsWith('/registry/family/registry.json')) return Response.json({ items })
    const item = items.find((candidate) => url.endsWith(`/r/${candidate.name}.json`))
    return item ? Response.json(built(item)) : new Response('not found', { status: 404 })
  }) as typeof fetch
}

const noNetwork = (() => Promise.reject(new Error('no network'))) as unknown as typeof fetch

function runner(effect?: (file: string, args: string[]) => Promise<number | void>) {
  const calls: Array<{ file: string; args: string[] }> = []
  const run: UiRunner = async (file, args) => {
    calls.push({ file, args })
    const code = (await effect?.(file, args)) ?? 0
    return { code, stdout: '', stderr: code === 0 ? '' : 'failed' }
  }
  return { run, calls }
}

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function directory(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'astrale-ui-'))
  roots.push(root)
  return root
}

type ProjectOptions = {
  locked?: boolean
  domain?: boolean
  npm?: boolean
  devDependency?: boolean
  components?: Record<string, unknown>
}

async function project(options: ProjectOptions = {}) {
  const root = await directory()
  const at = (relative: string) => path.join(root, relative)
  const manifest: Record<string, unknown> = {
    name: 'fixture',
    private: true,
    dependencies: { react: '19.2.8', 'react-dom': '19.2.8', tailwindcss: '4.3.3' },
    packageManager: options.npm ? 'npm@11.16.0' : 'pnpm@12.1.0',
  }
  if (options.locked) {
    const section = options.devDependency ? 'devDependencies' : 'dependencies'
    manifest[section] = { ...(manifest[section] as object), '@astrale-os/ui': VERSION }
  }
  await mkdir(at('src'), { recursive: true })
  await writeFile(at('src/index.css'), options.locked ? PACKAGE_CSS : '/* consumer css */\n')
  if (options.domain) {
    if (options.npm) manifest.workspaces = ['frontend']
    else await writeFile(at('pnpm-workspace.yaml'), "packages:\n  - 'frontend'\n")
    await mkdir(at('frontend/src'), { recursive: true })
    await mkdir(at('ui'))
    await writeFile(
      at('frontend/package.json'),
      JSON.stringify({ name: 'astrale-frontend', private: true }),
    )
    await writeFile(at('frontend/src/styles.css'), '/* Domain frontend */\n')
    await writeFile(at('ui/index.ts'), 'export {}\n')
    await writeFile(at('astrale.config.ts'), 'export default {}\n')
  }
  await writeFile(at('package.json'), JSON.stringify(manifest))
  if (options.locked) await writeFile(at('astrale-ui.lock.json'), JSON.stringify(lockOf()))
  if (options.locked || options.components) {
    await writeJson(at('components.json'), {
      style: 'base-nova',
      tailwind: { css: 'src/index.css' },
      ...options.components,
    })
  }
  return { root, at, read: (relative: string) => readFile(at(relative), 'utf8') }
}

function writeJson(target: string, value: unknown) {
  return writeFile(target, JSON.stringify(value))
}

function lockOf(items: UiLock['items'] = {}): UiLock {
  return {
    $schema: 'https://example.invalid/ui-lock.schema.json',
    version: 1,
    package: { name: '@astrale-os/ui', version: VERSION },
    registry: { repository: 'astrale-os/ui', ref: 'v' + VERSION, commit: COMMIT },
    tooling: { shadcn: '4.18.0', base: 'base', style: 'nova', baseUi: '1.7.0' },
    preset: 'astrale',
    items,
  }
}

async function exists(target: string): Promise<boolean> {
  return Bun.file(target).exists()
}

describe('UI release', () => {
  /** @evidence TEST-CLI-UI-BETA-DEFAULT */
  test('an unversioned operation resolves the npm beta tag, never latest, and refuses a non-beta tag', async () => {
    const seen: string[] = []
    const resolved = await resolveUiRelease(
      undefined,
      release(
        [chart],
        { '/@astrale-os/ui/beta': Response.json({ version: '0.3.0-beta.1' }) },
        seen,
      ),
    )
    expect(resolved.version).toBe('0.3.0-beta.1')
    expect(seen[0]).toBe('https://registry.npmjs.org/@astrale-os/ui/beta')

    const stable = release([chart], { '/@astrale-os/ui/beta': Response.json({ version: '0.3.0' }) })
    await expect(resolveUiRelease(undefined, stable)).rejects.toMatchObject({
      message: 'Invalid UI beta release version: 0.3.0',
    })
  })

  /** @evidence TEST-CLI-UI-ONE-SNAPSHOT */
  test('reads compatibility and every nested registry from one commit, qualifying item paths', async () => {
    const seen: string[] = []
    const nested = {
      ...chart,
      name: 'pattern-chart-nested',
      meta: { canonicalAddress: 'pattern/chart/nested' },
    }
    const resolved = await resolveUiRelease(
      VERSION,
      release(
        [chart],
        {
          '/registry/family/registry.json': Response.json({
            items: [chart],
            include: ['deeper/registry.json'],
          }),
          '/registry/family/deeper/registry.json': Response.json({ items: [nested] }),
        },
        seen,
      ),
    )
    expect(resolved.commit).toBe(COMMIT)
    expect(resolved.registry.items.map((item) => item.files[0]?.path)).toEqual([
      'registry/family/line-basic.tsx',
      'registry/family/deeper/line-basic.tsx',
    ])
    const raw = seen.filter((url) => url.startsWith('https://raw.githubusercontent.com/'))
    expect(raw.every((url) => url.includes(`/${COMMIT}/`))).toBe(true)
  })

  test('a rate-limited tag lookup falls back to the release page; a missing tag does not', async () => {
    const page = `<a href="/astrale-os/ui/tree/v${VERSION}">tag</a>
      <a data-hovercard-type="commit" href="/astrale-os/ui/commit/${COMMIT}">commit</a>`
    const limited = { '/git/ref/tags/v0.3.0-beta.0': new Response('limited', { status: 403 }) }
    expect(
      (
        await resolveUiRelease(
          VERSION,
          release([chart], { ...limited, [`/releases/tag/v${VERSION}`]: new Response(page) }),
        )
      ).commit,
    ).toBe(COMMIT)
    await expect(
      resolveUiRelease(
        VERSION,
        release([chart], { ...limited, [`/releases/tag/v${VERSION}`]: new Response('<main/>') }),
      ),
    ).rejects.toMatchObject({ message: `UI ref v${VERSION} did not resolve to a commit.` })

    const seen: string[] = []
    await expect(
      resolveUiRelease(
        VERSION,
        release(
          [chart],
          { '/git/ref/tags/v0.3.0-beta.0': new Response('', { status: 404 }) },
          seen,
        ),
      ),
    ).rejects.toMatchObject({ message: `UI ref v${VERSION} returned HTTP 404.` })
    expect(seen.some((url) => url.includes('/releases/tag/'))).toBe(false)
  })

  /** @evidence TEST-CLI-UI-BOUNDED-REMOTE-DOCUMENTS */
  test('oversized, malformed, fanned-out or escaping registry documents are refused before use', async () => {
    const root = `/${COMMIT}/registry.json`
    const hostile: Array<Record<string, Route>> = [
      { '/tooling/compatibility.json': new Response('x'.repeat(1_048_577)) },
      {
        '/tooling/compatibility.json': () =>
          new Response(
            new ReadableStream({
              start: (c) => {
                c.enqueue(new Uint8Array(1_048_577))
                c.close()
              },
            }),
          ),
      },
      { [root]: new Response('{') },
      {
        [root]: Response.json({
          include: Array.from({ length: 100 }, (_, i) => `registry/f${i}/registry.json`),
        }),
      },
      ...[
        '../registry.json',
        '%2e%2e/x/registry.json',
        'registry/x/registry.json?raw=1',
        'https://example.invalid/registry.json',
      ].map((include) => ({ [root]: Response.json({ include: [include] }) })),
      ...['/absolute.tsx', '../line-basic.tsx', 'registry/family/line-basic.tsx'].map((unsafe) => ({
        '/registry/family/registry.json': Response.json({
          items: [{ ...chart, files: [{ ...chart.files[0], path: unsafe }] }],
        }),
      })),
      {
        '/registry/family/registry.json': Response.json({
          items: [
            {
              ...sidebar,
              files: [{ ...sidebar.files[0], target: 'components/astrale/pattern/sidebar.tsx' }],
            },
          ],
        }),
      },
    ]
    for (const routes of hostile) {
      const seen: string[] = []
      await expect(resolveUiRelease(VERSION, release([chart], routes, seen))).rejects.toMatchObject(
        {
          code: 'UI_REGISTRY_UNAVAILABLE',
        },
      )
      expect(seen.some((url) => url.includes('example.invalid') || url.includes('/x/'))).toBe(false)
    }
  })

  test('admits a theme as one consumer-owned CSS file and a component with its own files', async () => {
    const resolved = await resolveUiRelease(VERSION, release([theme, sidebar]))
    expect(resolved.registry.items.map((item) => item.meta.canonicalAddress)).toEqual([
      'theme/observatory',
      'component/sidebar',
    ])
  })
})

describe('UI initialization', () => {
  test('initializes a Domain frontend stylesheet and its private registry workspace once', async () => {
    const fixture = await project({ domain: true })
    const rootCss = await fixture.read('src/index.css')

    await initUi(
      { path: fixture.at('frontend'), version: VERSION, install: false },
      { fetcher: release() },
    )

    expect(await fixture.read('frontend/src/styles.css')).toStartWith(PACKAGE_CSS)
    expect(await fixture.read('src/index.css')).toBe(rootCss)
    expect(JSON.parse(await fixture.read('components.json')).tailwind.css).toBe(
      'frontend/src/styles.css',
    )
    expect(JSON.parse(await fixture.read('components/package.json'))).toEqual({
      name: 'fixture-ui-registry',
      private: true,
      type: 'module',
    })
    expect(await fixture.read('pnpm-workspace.yaml')).toContain('components')
    expect(
      (await initUi({ path: fixture.root, install: false }, { fetcher: noNetwork })).status,
    ).toBe('unchanged')
  })

  test('adds the registry workspace to an npm Domain manifest', async () => {
    const fixture = await project({ domain: true, npm: true })
    await initUi({ path: fixture.root, version: VERSION, install: false }, { fetcher: release() })
    expect(JSON.parse(await fixture.read('package.json')).workspaces).toEqual([
      'frontend',
      'components',
    ])
  })

  test('refuses a symlink or a shadowing package on any planned path without mutating anything', async () => {
    const outside = await directory()
    await writeFile(path.join(outside, 'workspace.yaml'), "packages:\n  - 'outside'\n")
    const cases: Array<[string, (root: string) => Promise<unknown>]> = [
      ['UI_LOCK_INVALID', (root) => symlink(outside, path.join(root, 'components'), 'dir')],
      [
        'UI_LOCK_INVALID',
        async (root) => {
          await rm(path.join(root, 'pnpm-workspace.yaml'))
          await symlink(
            path.join(outside, 'workspace.yaml'),
            path.join(root, 'pnpm-workspace.yaml'),
          )
        },
      ],
      [
        'UI_PROJECT_UNSUPPORTED',
        async (root) => {
          await mkdir(path.join(root, 'components'))
          await writeJson(path.join(root, 'components/package.json'), {
            name: '@astrale-os/ui',
            private: true,
          })
        },
      ],
      [
        'UI_PROJECT_UNSUPPORTED',
        async (root) => {
          await symlink(outside, path.join(root, 'escaped'), 'dir')
          await writeJson(path.join(root, 'components.json'), {
            tailwind: { css: 'escaped/styles.css' },
          })
        },
      ],
    ]
    for (const [code, prepare] of cases) {
      const fixture = await project({ domain: true })
      await prepare(fixture.root)
      const manifest = await fixture.read('package.json')
      await expect(
        initUi({ path: fixture.root, version: VERSION, install: false }, { fetcher: release() }),
      ).rejects.toMatchObject({ code })
      expect(await fixture.read('package.json')).toBe(manifest)
      expect(await exists(fixture.at('astrale-ui.lock.json'))).toBe(false)
    }
    expect(await readFile(path.join(outside, 'workspace.yaml'), 'utf8')).toBe(
      "packages:\n  - 'outside'\n",
    )
  })

  /** @evidence TEST-CLI-UI-LOCK-AFTER-SUCCESS */
  test('a failed dependency install restores every file and leaves no lock; a dry run writes nothing', async () => {
    const fixture = await project({ domain: true })
    const before = await Promise.all(
      ['package.json', 'frontend/src/styles.css', 'pnpm-workspace.yaml'].map(fixture.read),
    )

    await expect(
      initUi(
        { path: fixture.root, version: VERSION },
        { fetcher: release(), runner: runner(async () => 1).run },
      ),
    ).rejects.toMatchObject({ code: 'UI_DEPENDENCY_INSTALL_FAILED' })
    expect(
      await Promise.all(
        ['package.json', 'frontend/src/styles.css', 'pnpm-workspace.yaml'].map(fixture.read),
      ),
    ).toEqual(before)
    for (const created of [
      'components/package.json',
      'components.json',
      'astrale-ui.lock.json',
      'pnpm-lock.yaml',
    ]) {
      expect(await exists(fixture.at(created))).toBe(false)
    }

    const planned = await initUi(
      { path: fixture.root, version: VERSION, dryRun: true },
      { fetcher: release() },
    )
    expect(planned).toMatchObject({
      status: 'planned',
      files: expect.arrayContaining(['package.json', 'astrale-ui.lock.json']),
    })
    expect(await exists(fixture.at('astrale-ui.lock.json'))).toBe(false)
  })

  test('writes Base Nova config, the preset, and keeps a development-only UI dependency', async () => {
    const fixture = await project()
    const manifest = JSON.parse(await fixture.read('package.json'))
    await writeJson(fixture.at('package.json'), {
      ...manifest,
      devDependencies: { '@astrale-os/ui': VERSION },
    })

    await initUi(
      { path: fixture.root, version: VERSION, preset: 'compact', install: false },
      { fetcher: release() },
    )

    expect(JSON.parse(await fixture.read('components.json')).style).toBe('base-nova')
    expect(JSON.parse(await fixture.read('astrale-ui.lock.json')).tooling).toMatchObject({
      baseUi: '1.7.0',
    })
    expect(await fixture.read('src/index.css')).toContain('@astrale-os/ui/presets/compact.css')
    const written = JSON.parse(await fixture.read('package.json'))
    expect([
      written.dependencies['@astrale-os/ui'],
      written.devDependencies['@astrale-os/ui'],
    ]).toEqual([undefined, VERSION])
  })

  test('an existing initialization is unchanged without network, and any requested drift is refused', async () => {
    const fixture = await project({ locked: true })
    expect(
      (await initUi({ path: fixture.root, preset: 'astrale' }, { fetcher: noNetwork })).status,
    ).toBe('unchanged')
    await expect(initUi({ path: fixture.root, preset: 'compact' })).rejects.toMatchObject({
      code: 'UI_ITEM_CONFLICT',
    })
  })

  test('doctor accepts one exact dependency declaration and reports drift or duplication', async () => {
    const fixture = await project({ locked: true, devDependency: true })
    expect((await doctorUi(fixture.root)).healthy).toBe(true)

    const manifest = JSON.parse(await fixture.read('package.json'))
    for (const [change, detail] of [
      [{ devDependencies: { '@astrale-os/ui': '0.3.0-beta.1' } }, 'devDependencies:0.3.0-beta.1'],
      [
        { dependencies: { ...manifest.dependencies, '@astrale-os/ui': VERSION } },
        'declared in dependencies and devDependencies',
      ],
    ] as const) {
      await writeJson(fixture.at('package.json'), { ...manifest, ...change })
      expect(
        (await doctorUi(fixture.root)).checks.find(({ check }) => check === 'package'),
      ).toMatchObject({ ok: false, detail })
    }
  })
})

describe('UI source operations', () => {
  test('refuses an empty request, a hostile lock, and an unconfirmed overwrite before running tools', async () => {
    await expect(addUi([], {})).rejects.toMatchObject({ code: 'UI_ITEM_NOT_FOUND' })
    for (const items of [
      { [CHART]: { address: CHART, sourceDigest: 'bad', files: {} } },
      {
        [CHART]: {
          address: CHART,
          sourceDigest: 'b'.repeat(64),
          files: { '../../outside': 'c'.repeat(64) },
        },
      },
    ]) {
      expect(() => parseUiLock(lockOf(items as UiLock['items']))).toThrow(UiError)
    }
    const fixture = await project({ locked: true })
    const tools = runner()
    await expect(
      addUi(
        [CHART],
        { project: fixture.root, overwrite: true },
        { fetcher: release(), runner: tools.run },
      ),
    ).rejects.toMatchObject({ code: 'UI_LOCAL_CHANGES' })
    expect(tools.calls).toEqual([])
  })

  test('a dry run invokes the pinned shadcn and resolves targets through the components alias', async () => {
    const fixture = await project({ locked: true })
    const plan = async (aliases?: object) => {
      if (aliases)
        await writeJson(fixture.at('components.json'), {
          style: 'base-nova',
          tailwind: { css: 'src/index.css' },
          aliases,
        })
      const tools = runner()
      const planned = await addUi(
        [CHART],
        { project: fixture.root, dryRun: true },
        { fetcher: release(), runner: tools.run },
      )
      return {
        files: (planned.sources as Array<{ files: string[] }>)[0]?.files,
        calls: tools.calls,
      }
    }
    const lock = await fixture.read('astrale-ui.lock.json')

    const direct = await plan()
    expect(direct.files).toEqual([CHART_FILE])
    expect(direct.calls[0]?.args).toEqual(
      expect.arrayContaining(['dlx', 'shadcn@4.18.0', '--dry-run']),
    )
    expect(await fixture.read('astrale-ui.lock.json')).toBe(lock)

    const manifest = JSON.parse(await fixture.read('package.json'))
    await writeJson(fixture.at('package.json'), {
      ...manifest,
      imports: { '#app/*': './src/app/*' },
    })
    expect((await plan({ components: '#app/components' })).files).toEqual([`src/app/${CHART_FILE}`])

    await mkdir(fixture.at('config'))
    await writeFile(
      fixture.at('tsconfig.json'),
      '{\n  // JSONC\n  "extends": "./config/base.json",\n}\n',
    )
    await writeFile(
      fixture.at('config/base.json'),
      '{ "compilerOptions": { "baseUrl": "..", "paths": { "@/*": ["frontend/src/*"], }, }, }',
    )
    expect((await plan({ components: '@/components' })).files).toEqual([
      `frontend/src/${CHART_FILE}`,
    ])

    for (const aliases of [{ components: '#missing/components' }, { components: '@/escape' }]) {
      await writeJson(fixture.at('tsconfig.json'), {
        compilerOptions: { paths: { '@/escape/*': ['../outside/*'] } },
      })
      await expect(plan(aliases)).rejects.toMatchObject({ code: 'UI_PROJECT_UNSUPPORTED' })
    }
  })

  /** @evidence TEST-CLI-UI-THEME-OWNERSHIP */
  test('a released theme becomes one owned, activated, locked CSS file without shadcn', async () => {
    const fixture = await project({ locked: true })
    const tools = runner()

    expect(
      await addUi(
        ['theme/observatory'],
        { project: fixture.root },
        { fetcher: release([theme]), runner: tools.run },
      ),
    ).toMatchObject({ status: 'installed', items: ['theme/observatory'] })
    expect(tools.calls).toEqual([])
    expect(await fixture.read('components/astrale/theme/observatory.css')).toBe(themeCss)
    expect(await fixture.read('src/index.css')).toContain(
      "@import '../components/astrale/theme/observatory.css';",
    )
    expect(
      JSON.parse(await fixture.read('astrale-ui.lock.json')).items['theme/observatory'],
    ).toEqual({
      address: 'theme/observatory',
      sourceDigest: sha256(JSON.stringify(built(theme))),
      files: { 'components/astrale/theme/observatory.css': sha256(themeCss) },
    })
    expect((await doctorUi(fixture.root)).healthy).toBe(true)
  })

  /** @evidence TEST-CLI-UI-THEME-OWNERSHIP */
  test('a playground theme installs offline, keeps local edits unless overwritten, and refuses unsafe sources', async () => {
    const fixture = await project({ locked: true })
    const target = fixture.at('components/astrale/theme/observatory.css')
    await writeFile(fixture.at('observatory.css'), themeCss)
    const offline = { fetcher: noNetwork, runner: runner(async () => 1).run }

    expect(
      await addUi(['./observatory.css'], { project: fixture.root, dryRun: true }, offline),
    ).toMatchObject({
      status: 'planned',
      activation: {
        file: 'src/index.css',
        import: "@import '../components/astrale/theme/observatory.css';",
      },
    })
    expect(await exists(target)).toBe(false)
    await addUi(['./observatory.css'], { project: fixture.root }, offline)
    expect((await doctorUi(fixture.root)).healthy).toBe(true)

    await writeFile(target, 'consumer edit\n')
    await expect(addUi(['./observatory.css'], { project: fixture.root })).rejects.toMatchObject({
      code: 'UI_LOCAL_CHANGES',
    })
    await addUi(['./observatory.css'], { project: fixture.root, overwrite: true, yes: true })
    expect(await readFile(target, 'utf8')).toBe(themeCss)

    await writeFile(fixture.at('unsafe.css'), "@import 'https://example.invalid/theme.css';\n")
    await expect(addUi(['./unsafe.css'], { project: fixture.root })).rejects.toMatchObject({
      code: 'UI_ITEM_CONFLICT',
    })
    await symlink(fixture.at('observatory.css'), fixture.at('linked.css'))
    await expect(addUi(['./linked.css'], { project: fixture.root })).rejects.toMatchObject({
      code: 'UI_ITEM_NOT_FOUND',
    })
  })

  test('a theme rolls back its file and activation when the lock cannot be written, and refuses a linked lock', async () => {
    const fixture = await project({ locked: true })
    await writeFile(fixture.at('observatory.css'), themeCss)
    const lockPath = fixture.at('astrale-ui.lock.json')
    const [lockBefore, cssBefore] = [
      await fixture.read('astrale-ui.lock.json'),
      await fixture.read('src/index.css'),
    ]
    const realWriteFile = fsPromises.writeFile
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' })
    const write = spyOn(fsPromises, 'writeFile').mockImplementation((async (
      ...args: Parameters<typeof realWriteFile>
    ) => {
      if (args[0] === lockPath) throw denied
      return realWriteFile(...args)
    }) as typeof realWriteFile)
    try {
      await expect(addUi(['./observatory.css'], { project: fixture.root })).rejects.toBe(denied)
    } finally {
      write.mockRestore()
    }
    expect(await exists(fixture.at('components/astrale/theme/observatory.css'))).toBe(false)
    expect([
      await fixture.read('astrale-ui.lock.json'),
      await fixture.read('src/index.css'),
    ]).toEqual([lockBefore, cssBefore])

    const outside = path.join(await directory(), 'astrale-ui.lock.json')
    await writeFile(outside, lockBefore)
    await rm(lockPath)
    await symlink(outside, lockPath)
    await expect(addUi(['./observatory.css'], { project: fixture.root })).rejects.toMatchObject({
      code: 'UI_LOCK_INVALID',
    })
  })

  test('an add records installed digests, restores the locked UI dependency, and doctor sees later edits', async () => {
    for (const devDependency of [false, true]) {
      const fixture = await project({ locked: true, devDependency })
      const tools = runner(async (_file, args) => {
        if (args[0] !== 'dlx') return
        await mkdir(path.dirname(fixture.at(CHART_FILE)), { recursive: true })
        await writeFile(fixture.at(CHART_FILE), 'export const Chart = true\n')
        const manifest = JSON.parse(await fixture.read('package.json'))
        manifest.dependencies['@astrale-os/ui'] = '^0.3.0-beta.0'
        await writeJson(fixture.at('package.json'), manifest)
      })

      await addUi(
        [CHART],
        { project: fixture.root, yes: true },
        { fetcher: release(), runner: tools.run },
      )

      expect(tools.calls.at(-1)).toEqual({ file: 'pnpm', args: ['install'] })
      const manifest = JSON.parse(await fixture.read('package.json'))
      const declared = devDependency ? manifest.devDependencies : manifest.dependencies
      expect(declared['@astrale-os/ui']).toBe(VERSION)
      if (devDependency) expect(manifest.dependencies['@astrale-os/ui']).toBeUndefined()
      expect(JSON.parse(await fixture.read('astrale-ui.lock.json')).items[CHART]).toEqual({
        address: CHART,
        sourceDigest: sha256(JSON.stringify(built(chart))),
        files: { [CHART_FILE]: sha256('export const Chart = true\n') },
      })
      await writeFile(fixture.at(CHART_FILE), 'consumer edit\n')
      expect((await doctorUi(fixture.root)).healthy).toBe(false)
      await expect(
        addUi([CHART], { project: fixture.root }, { fetcher: release(), runner: tools.run }),
      ).rejects.toMatchObject({
        code: 'UI_LOCAL_CHANGES',
      })
    }
  })

  test('a failed shadcn run or dependency restore puts every touched file back', async () => {
    const twoFiles = {
      ...chart,
      files: [
        ...chart.files,
        {
          path: 'summary.tsx',
          type: 'registry:component',
          target: 'components/astrale/pattern/chart/summary.tsx',
        },
      ],
    }
    for (const failAt of ['dlx', 'install']) {
      const fixture = await project({ locked: true })
      await mkdir(path.dirname(fixture.at(CHART_FILE)), { recursive: true })
      await writeFile(fixture.at(CHART_FILE), 'consumer original\n')
      const before = await Promise.all(['package.json', 'astrale-ui.lock.json'].map(fixture.read))
      const tools = runner(async (_file, args) => {
        if (args[0] === 'dlx') {
          await writeFile(fixture.at(CHART_FILE), 'partial overwrite\n')
          await writeFile(
            fixture.at('components/astrale/pattern/chart/summary.tsx'),
            'partial create\n',
          )
          const manifest = JSON.parse(await fixture.read('package.json'))
          manifest.dependencies['@astrale-os/ui'] = '^0.3.0-beta.0'
          await writeJson(fixture.at('package.json'), manifest)
        } else {
          await writeFile(fixture.at('pnpm-lock.yaml'), 'partial lock\n')
        }
        return args[0] === failAt ? 1 : 0
      })

      await expect(
        addUi(
          [CHART],
          { project: fixture.root, overwrite: true, yes: true },
          { fetcher: release([twoFiles]), runner: tools.run },
        ),
      ).rejects.toMatchObject({
        code: failAt === 'dlx' ? 'UI_TOOL_FAILED' : 'UI_DEPENDENCY_INSTALL_FAILED',
      })
      expect(await Promise.all(['package.json', 'astrale-ui.lock.json'].map(fixture.read))).toEqual(
        before,
      )
      expect(await fixture.read(CHART_FILE)).toBe('consumer original\n')
      expect(await exists(fixture.at('components/astrale/pattern/chart/summary.tsx'))).toBe(false)
      expect(await exists(fixture.at('pnpm-lock.yaml'))).toBe(false)
    }
  })

  /** @evidence TEST-CLI-UI-EXACT-ITEM-SOURCE */
  test('a built item that differs from the release index, or a linked target, stops before shadcn', async () => {
    const mismatched = await project({ locked: true })
    const tools = runner()
    await expect(
      addUi(
        [CHART],
        { project: mismatched.root },
        {
          fetcher: release([chart], { [`/r/${chart.name}.json`]: Response.json(chart) }),
          runner: tools.run,
        },
      ),
    ).rejects.toMatchObject({ code: 'UI_REGISTRY_UNAVAILABLE' })

    const linked = await project({ locked: true })
    await symlink(await directory(), linked.at('components'))
    await expect(
      addUi([CHART], { project: linked.root }, { fetcher: release(), runner: tools.run }),
    ).rejects.toMatchObject({
      code: 'UI_LOCK_INVALID',
    })
    expect(tools.calls).toEqual([])
  })

  test('a preset dry run is read-only; applying it rewrites the import and the lock only', async () => {
    const fixture = await project({ locked: true })
    await applyPreset('expressive', { project: fixture.root, dryRun: true })
    expect(await fixture.read('src/index.css')).toBe(PACKAGE_CSS)
    await applyPreset('expressive', { project: fixture.root })
    expect(await fixture.read('src/index.css')).toContain('@astrale-os/ui/presets/expressive.css')
    expect(JSON.parse(await fixture.read('astrale-ui.lock.json')).preset).toBe('expressive')
  })
})
