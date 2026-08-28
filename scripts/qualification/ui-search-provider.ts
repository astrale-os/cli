#!/usr/bin/env bun

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { searchUi } from '../../src/ui/search'

const uiRoot = path.resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('usage: pnpm qualification:ui-search <ui-repository>')

const generator = (await import(pathToFileURL(path.join(uiRoot, 'search/generate.mjs')).href)) as {
  buildArtifactSet(options?: {
    maxSingleArtifactRawBytes?: number
    maxPartitionRawBytes?: number
  }): Promise<{
    corpus: { documents: Array<{ address: string; code: { sha256: string } }> }
    index: unknown
    manifest: unknown
    files: Map<string, string>
  }>
}
const engine = (await import(pathToFileURL(path.join(uiRoot, 'search/src/engine.mjs')).href)) as {
  searchIndex(
    index: unknown,
    query: string,
    options: { limit: number; offset?: number },
  ): { results: Array<{ document: { address: string } }> }
}
const cases = JSON.parse(
  await readFile(path.join(uiRoot, 'search/.spec/benchmarks/relevance.cases.json'), 'utf8'),
) as Array<{ query: string }>
const packageDocument = JSON.parse(
  await readFile(path.join(uiRoot, 'packages/ui/package.json'), 'utf8'),
) as { version: string }

const temporary = await mkdtemp(path.join(tmpdir(), 'astrale-ui-provider-contract-'))
const project = path.join(temporary, 'project')
const cacheRoot = path.join(temporary, 'cache')
await Bun.write(
  path.join(project, 'package.json'),
  JSON.stringify({
    name: 'ui-provider-contract',
    dependencies: { react: '19.2.8', 'react-dom': '19.2.8', tailwindcss: '4.3.3' },
  }),
)

try {
  const reports = []
  for (const [layoutName, options, commit] of [
    ['single', {}, 'a'.repeat(40)],
    ['partitioned', { maxSingleArtifactRawBytes: 1 }, 'b'.repeat(40)],
  ] as const) {
    const artifact = await generator.buildArtifactSet(options)
    assert.equal((artifact.manifest as { layout: { kind: string } }).layout.kind, layoutName)
    await writeFile(
      path.join(project, 'astrale-ui.lock.json'),
      JSON.stringify({
        $schema: 'fixture',
        version: 1,
        package: { name: '@astrale-os/ui', version: packageDocument.version },
        registry: { repository: 'astrale-os/ui', ref: `v${packageDocument.version}`, commit },
        tooling: { shadcn: '4.18.0', base: 'base', style: 'nova', baseUi: '1.7.0' },
        preset: 'astrale',
        items: {},
      }),
    )

    const fetched = new Set<string>()
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input)
      const marker = `/${commit}/`
      const position = url.indexOf(marker)
      if (position < 0) return new Response('not found', { status: 404 })
      const relative = url.slice(position + marker.length)
      fetched.add(relative)
      const generated = artifact.files.get(relative)
      if (generated !== undefined) return new Response(generated)
      const target = path.resolve(uiRoot, relative)
      const within = path.relative(uiRoot, target)
      if (within === '..' || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) {
        return new Response('not found', { status: 404 })
      }
      return readFile(target).then(
        (source) => new Response(source),
        () => new Response('not found', { status: 404 }),
      )
    }) as typeof fetch

    for (const document of artifact.corpus.documents) {
      const response = await searchUi(
        document.address,
        { project, limit: 1 },
        { fetcher, cacheRoot },
      )
      assert.equal(response.results[0]?.address, document.address)
      assert.equal(
        createHash('sha256').update(response.results[0]!.code.source).digest('hex'),
        document.code.sha256,
      )
    }
    for (const testCase of cases) {
      const expected = engine
        .searchIndex(artifact.index, testCase.query, { limit: 10 })
        .results.map(({ document }) => document.address)
      const response = await searchUi(
        testCase.query,
        { project, limit: 10 },
        { fetcher, cacheRoot },
      )
      assert.deepEqual(
        response.results.map(({ address }) => address),
        expected,
        `${layoutName}: ${testCase.query}`,
      )
    }
    assert.ok(![...fetched].some((file) => file.endsWith('/registry.json')))
    reports.push({
      layout: layoutName,
      documents: artifact.corpus.documents.length,
      queries: artifact.corpus.documents.length + cases.length,
      fetchedFiles: fetched.size,
    })
  }
  process.stdout.write(`${JSON.stringify({ provider: uiRoot, reports }, null, 2)}\n`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
