import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { UiError } from '../../model'
import { addUi } from '../../operations'
import { admitSearchRequest, executeSearch } from '../engine'
import { nextSearchOffset, searchUi } from '../index'
import {
  fixtureCommit,
  fixtureFetch,
  fixtureVersion,
  partitionFixture,
  singleFixture,
} from './fixture'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true })
    }),
  )
})

async function temporary(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  roots.push(root)
  return root
}

async function lockedProject(): Promise<string> {
  const root = await temporary('astrale-ui-search-project-')
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'search-project',
      dependencies: { react: '19.2.8', 'react-dom': '19.2.8', tailwindcss: '4.3.3' },
    }),
  )
  await writeFile(
    path.join(root, 'astrale-ui.lock.json'),
    JSON.stringify({
      $schema: 'fixture',
      version: 1,
      package: { name: '@astrale-os/ui', version: fixtureVersion },
      registry: { repository: 'astrale-os/ui', ref: `v${fixtureVersion}`, commit: fixtureCommit },
      tooling: { shadcn: '4.18.0', base: 'base', style: 'nova', baseUi: '1.7.0' },
      preset: 'astrale',
      items: {},
    }),
  )
  return root
}

describe('Astrale UI search', () => {
  test('uses the exact project lock, returns canonical code, and never loads the registry', async () => {
    const project = await lockedProject()
    const cacheRoot = await temporary('astrale-ui-search-cache-')
    const seen: string[] = []
    const response = await searchUi(
      'editable payment table with export',
      { project },
      { fetcher: fixtureFetch(seen), cacheRoot },
    )

    expect(response).toMatchObject({
      query: 'editable payment table with export',
      release: { version: fixtureVersion, commit: fixtureCommit },
      offset: 0,
      limit: 5,
      total: 1,
      nextOffset: null,
      results: [
        {
          address: 'block/data-table/data-table-12',
          command: 'astrale ui add block/data-table/data-table-12',
          code: { language: 'tsx' },
        },
      ],
    })
    expect(response.results[0]!.code.source).toContain('Export payments')
    expect(seen.some((url) => url.includes('/@astrale-os/ui/beta'))).toBe(false)
    expect(seen.some((url) => url.endsWith('/registry.json'))).toBe(false)
    expect(seen.filter((url) => url.endsWith('.preview.tsx'))).toHaveLength(1)
  })

  test('reuses an integrity-admitted immutable cache without network access', async () => {
    const project = await lockedProject()
    const cacheRoot = await temporary('astrale-ui-search-cache-')
    await searchUi('payment export', { project }, { fetcher: fixtureFetch(), cacheRoot })

    const response = await searchUi(
      'payment export',
      { project },
      {
        cacheRoot,
        fetcher: (async () => {
          throw new Error('network must not be used')
        }) as unknown as typeof fetch,
      },
    )
    expect(response.results[0]!.address).toBe('block/data-table/data-table-12')
  })

  test('repairs a corrupt cached index from the immutable release', async () => {
    const project = await lockedProject()
    const cacheRoot = await temporary('astrale-ui-search-cache-')
    await searchUi('payment export', { project }, { fetcher: fixtureFetch(), cacheRoot })
    const indexPath = path.join(cacheRoot, fixtureCommit, 'search/public/index.json')
    await writeFile(indexPath, '{"corrupt":true}\n')
    const seen: string[] = []

    const response = await searchUi(
      'payment export',
      { project },
      { fetcher: fixtureFetch(seen), cacheRoot },
    )
    expect(response.results[0]!.address).toBe('block/data-table/data-table-12')
    expect(seen.filter((url) => url.endsWith('/search/public/index.json'))).toHaveLength(1)
    expect(await readFile(indexPath, 'utf8')).toBe(
      singleFixture().responses.get('search/public/index.json')!,
    )
  })

  test('resolves the public beta only when no initialized project lock exists', async () => {
    const cacheRoot = await temporary('astrale-ui-search-cache-')
    const seen: string[] = []
    const response = await searchUi(
      '@astrale-os/ui/button',
      {},
      { fetcher: fixtureFetch(seen), cacheRoot },
    )
    expect(response.results[0]).toMatchObject({
      address: '@astrale-os/ui/button',
      packageImport: '@astrale-os/ui/button',
    })
    expect(seen.some((url) => url.endsWith('/@astrale-os/ui/beta'))).toBe(true)
  })

  test('uses a cwd project lock and falls back to beta for a supported unlocked cwd', async () => {
    const originalCwd = process.cwd()
    try {
      const project = await lockedProject()
      process.chdir(project)
      const lockedSeen: string[] = []
      const locked = await searchUi(
        'button',
        {},
        {
          fetcher: fixtureFetch(lockedSeen),
          cacheRoot: await temporary('astrale-ui-search-cache-'),
        },
      )
      expect(locked.release.commit).toBe(fixtureCommit)
      expect(lockedSeen.some((url) => url.endsWith('/@astrale-os/ui/beta'))).toBe(false)

      const unlocked = await temporary('astrale-ui-search-unlocked-project-')
      await writeFile(
        path.join(unlocked, 'package.json'),
        JSON.stringify({
          name: 'unlocked',
          dependencies: { react: '19.2.8', 'react-dom': '19.2.8', tailwindcss: '4.3.3' },
        }),
      )
      process.chdir(unlocked)
      const betaSeen: string[] = []
      await searchUi(
        'button',
        {},
        {
          fetcher: fixtureFetch(betaSeen),
          cacheRoot: await temporary('astrale-ui-search-cache-'),
        },
      )
      expect(betaSeen.some((url) => url.endsWith('/@astrale-os/ui/beta'))).toBe(true)
    } finally {
      process.chdir(originalCwd)
    }
  })

  test('rejects invalid queries before release or network work', async () => {
    let calls = 0
    const error = await searchUi(
      '   ',
      { limit: 11 },
      {
        fetcher: (async () => {
          calls += 1
          return new Response()
        }) as unknown as typeof fetch,
      },
    ).catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(UiError)
    expect((error as UiError).code).toBe('UI_SEARCH_QUERY_INVALID')
    expect(calls).toBe(0)
  })

  test('admits the exact query and pagination boundaries', () => {
    expect(admitSearchRequest(' button ', { limit: 1, offset: 0 })).toEqual({
      query: 'button',
      limit: 1,
      offset: 0,
    })
    expect(admitSearchRequest('x'.repeat(256), { limit: 10, offset: 1_009 })).toEqual({
      query: 'x'.repeat(256),
      limit: 10,
      offset: 1_009,
    })
    for (const [query, limit, offset] of [
      ['x'.repeat(257), 1, 0],
      ['button', 0, 0],
      ['button', 11, 0],
      ['button', 1, -1],
      ['button', 1, 1_010],
      ['button', Number.NaN, 0],
    ] as const) {
      expect(() => admitSearchRequest(query, { limit, offset })).toThrow(UiError)
    }
  })

  test('paginates the complete retained candidate window for every legal page size', () => {
    for (const limit of [1, 3, 7, 10]) {
      const visited = new Set<number>()
      let offset: number | null = 0
      while (offset !== null) {
        for (let id = offset; id < Math.min(offset + limit, 1_010); id += 1) visited.add(id)
        offset = nextSearchOffset(offset, limit, 1_010)
      }
      expect([...visited]).toEqual(Array.from({ length: 1_010 }, (_, id) => id))
    }
  })

  test('reports an honest empty result without hydrating canonical code', async () => {
    const project = await lockedProject()
    const cacheRoot = await temporary('astrale-ui-search-cache-')
    const seen: string[] = []
    const response = await searchUi(
      'unfindable-zzzzzzzz',
      { project },
      { fetcher: fixtureFetch(seen), cacheRoot },
    )
    expect(response).toMatchObject({ total: 0, nextOffset: null, results: [] })
    expect(seen.some((url) => url.endsWith('.preview.tsx'))).toBe(false)
  })

  test('maps a missing locked artifact to actionable search unavailability', async () => {
    const project = await lockedProject()
    const cacheRoot = await temporary('astrale-ui-search-cache-')
    const error = await searchUi(
      'button',
      { project },
      {
        cacheRoot,
        fetcher: (async () => new Response('missing', { status: 404 })) as unknown as typeof fetch,
      },
    ).catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(UiError)
    expect((error as UiError).code).toBe('UI_SEARCH_UNAVAILABLE')
    expect((error as UiError).hint).toContain('astrale ui doctor')
    expect((error as UiError).hint).toContain('astrale ui init --force')
  })

  test('maps cache filesystem failures into the specified search failure family', async () => {
    const project = await lockedProject()
    const root = await temporary('astrale-ui-search-cache-file-')
    const cacheRoot = path.join(root, 'not-a-directory')
    await writeFile(cacheRoot, 'occupied')
    const error = await searchUi(
      'button',
      { project },
      { fetcher: fixtureFetch(), cacheRoot },
    ).catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(UiError)
    expect((error as UiError).code).toBe('UI_SEARCH_UNAVAILABLE')
    expect((error as UiError).hint).toContain('astrale ui doctor')
  })

  test('executes partitioned postings, metadata selection, and exact addresses', async () => {
    const fixture = partitionFixture()
    const artifacts = {
      manifest: fixture.manifest,
      async readJson(file: { path: string }) {
        return fixture.values.get(file.path)
      },
      async readCode() {
        throw new Error('ranking must not hydrate code')
      },
    }
    const intent = await executeSearch(artifacts, 'payment export', 0, 5)
    expect(intent.results.map(({ document }) => document.address)).toEqual([
      'block/data-table/data-table-12',
    ])
    const exact = await executeSearch(artifacts, '@ASTRALE-OS/UI/BUTTON', 0, 1)
    expect(exact.results[0]!.document.address).toBe('@astrale-os/ui/button')
  })

  test('loads a partitioned release through immutable fetch, cache, and code hydration', async () => {
    const project = await lockedProject()
    const cacheRoot = await temporary('astrale-ui-search-cache-')
    const fixture = partitionFixture()
    const seen: string[] = []
    const response = await searchUi(
      'payment export',
      { project },
      { fetcher: fixtureFetch(seen, fixture), cacheRoot },
    )
    expect(response.results[0]).toMatchObject({
      address: 'block/data-table/data-table-12',
      command: 'astrale ui add block/data-table/data-table-12',
      code: { source: expect.stringContaining('Export payments') },
    })
    expect(seen.some((url) => url.endsWith('/search/public/terms/1.json'))).toBe(true)
    expect(seen.some((url) => url.endsWith('/search/public/terms/0.json'))).toBe(false)
    expect(seen.some((url) => url.endsWith('/search/public/metadata/1.json'))).toBe(true)
    expect(seen.some((url) => url.endsWith('/search/public/metadata/0.json'))).toBe(false)

    const exact = await searchUi(
      '＠ＡＳＴＲＡＬＥ－ＯＳ／ＵＩ／ＢＵＴＴＯＮ',
      { project, limit: 1 },
      {
        fetcher: fixtureFetch(seen, fixture),
        cacheRoot,
      },
    )
    expect(exact.results[0]!.address).toBe('@astrale-os/ui/button')
  })

  test('rejects semantically malformed single and partitioned artifacts', async () => {
    const single = singleFixture()
    const malformedSingle = {
      ...single.index,
      documents: [...single.index.documents].reverse(),
    }
    const singleError = await executeSearch(
      {
        manifest: single.manifest,
        async readJson() {
          return malformedSingle
        },
        async readCode() {
          throw new Error('ranking must not hydrate code')
        },
      },
      'button',
      0,
      5,
    ).catch((failure: unknown) => failure)
    expect(singleError).toBeInstanceOf(UiError)
    expect((singleError as UiError).code).toBe('UI_SEARCH_UNAVAILABLE')

    const partitioned = partitionFixture()
    const layout = partitioned.manifest.layout
    if (layout.kind !== 'partitioned') throw new Error('fixture must be partitioned')
    const malformedManifest = {
      ...partitioned.manifest,
      layout: {
        ...layout,
        documentMetadataParts: [0, 1],
      },
    }
    const metadataOne = layout.metadataFiles[1]!.path
    const partitionError = await executeSearch(
      {
        manifest: malformedManifest,
        async readJson(file: { path: string }) {
          if (file.path === metadataOne) {
            return partitioned.values.get(layout.metadataFiles[0]!.path)
          }
          return partitioned.values.get(file.path)
        },
        async readCode() {
          throw new Error('ranking must not hydrate code')
        },
      },
      'payment export',
      0,
      5,
    ).catch((failure: unknown) => failure)
    expect(partitionError).toBeInstanceOf(UiError)
    expect((partitionError as UiError).code).toBe('UI_SEARCH_UNAVAILABLE')

    const exactTerm = '\0@astrale-os/ui/button'
    const exactPart = layout.termFiles.find((file) => {
      const values = partitioned.values.get(file.path) as Array<[string, number[]]>
      return values.some(([term]) => term === exactTerm)
    })!
    const exactError = await executeSearch(
      {
        manifest: partitioned.manifest,
        async readJson(file: { path: string }) {
          const value = partitioned.values.get(file.path)
          if (file.path !== exactPart.path) return value
          return (value as Array<[string, number[]]>).map(([term, posting]) => [
            term,
            term === exactTerm ? [1, 1] : posting,
          ])
        },
        async readCode() {
          throw new Error('ranking must not hydrate code')
        },
      },
      '@astrale-os/ui/button',
      0,
      1,
    ).catch((failure: unknown) => failure)
    expect(exactError).toBeInstanceOf(UiError)
    expect((exactError as UiError).code).toBe('UI_SEARCH_UNAVAILABLE')

    const paymentPart = layout.termFiles.find((file) => {
      const values = partitioned.values.get(file.path) as Array<[string, number[]]>
      return values.some(([term]) => term === 'payment')
    })!
    for (const corrupt of [
      (values: Array<[string, number[]]>) => values.filter(([term]) => term !== 'payment'),
      (values: Array<[string, number[]]>) =>
        values.map(([term, posting]) => [term, term === 'payment' ? [0, 5, 1, 5] : posting]),
    ]) {
      const error = await executeSearch(
        {
          manifest: partitioned.manifest,
          async readJson(file: { path: string }) {
            const value = partitioned.values.get(file.path)
            return file.path === paymentPart.path
              ? corrupt(value as Array<[string, number[]]>)
              : value
          },
          async readCode() {
            throw new Error('ranking must not hydrate code')
          },
        },
        'payment',
        0,
        1,
      ).catch((failure: unknown) => failure)
      expect(error).toBeInstanceOf(UiError)
      expect((error as UiError).code).toBe('UI_SEARCH_UNAVAILABLE')
    }
  })

  test('hands a returned command directly to the existing add journey', async () => {
    const project = await lockedProject()
    const cacheRoot = await temporary('astrale-ui-search-cache-')
    await writeFile(
      path.join(project, 'components.json'),
      JSON.stringify({ aliases: { components: './components' } }),
    )
    const seen: string[] = []
    const base = fixtureFetch(seen)
    const registryItem = {
      name: 'block-data-table-data-table-12',
      type: 'registry:block',
      title: 'Data Table 12',
      description: 'Editable payment table with export.',
      dependencies: ['@tanstack/react-table@^8.0.0'],
      files: [
        {
          path: 'registry/blocks/data-table/data-table-12.tsx',
          type: 'registry:component',
          target: 'components/astrale/block/data-table/data-table-12.tsx',
        },
      ],
      meta: { canonicalAddress: 'block/data-table/data-table-12' },
    }
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/tooling/compatibility.json')) {
        return Response.json({
          version: 1,
          shadcn: '4.18.0',
          base: 'base',
          style: 'nova',
          baseUi: '1.7.0',
          react: '^18.3.1 || ^19.0.0',
          tailwind: '^4.3.3',
          presets: ['astrale', 'compact', 'expressive'],
        })
      }
      if (url.endsWith('/registry.json')) {
        return Response.json({ name: 'astrale-ui', items: [registryItem] })
      }
      if (url.endsWith('/registry/public/r/block-data-table-data-table-12.json')) {
        return Response.json({
          ...registryItem,
          files: registryItem.files.map((file) => ({
            ...file,
            content: 'export default function DataTable() { return null }\n',
          })),
        })
      }
      return base(input)
    }) as unknown as typeof fetch

    const search = await searchUi('payment table export', { project }, { fetcher, cacheRoot })
    const command = search.results[0]!.command!
    const address = command.slice('astrale ui add '.length)
    const added = await addUi(
      [address],
      { project, dryRun: true },
      {
        fetcher,
        runner: async (file, args) => ({ code: 0, stdout: [file, ...args].join(' '), stderr: '' }),
      },
    )
    expect(command).toBe('astrale ui add block/data-table/data-table-12')
    expect(added).toMatchObject({ status: 'planned', items: [address] })
  })
})
