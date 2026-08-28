import { createHash } from 'node:crypto'

import type { SearchManifest } from '../model'

export const fixtureCommit = 'a'.repeat(40)
export const fixtureVersion = '0.3.0-beta.12'

const parameters = {
  boosts: [4, 5, 0.25, 0.4],
  lengthNormalization: [0.25, 0.65, 0.2, 0.1],
  saturation: 1.2,
  prefixWeight: 0.55,
  fuzzyWeight: 0.2,
  prefixTermLimit: 8,
  fuzzyTermLimit: 8,
  rerankCandidates: 1_010,
}

const fieldNames = ['identity', 'description', 'behavior', 'dependencies']
const fingerprint = createHash('sha256')
  .update(JSON.stringify({ engine: 'lexical-v1', fieldNames, ...parameters }))
  .digest('hex')

function file(path: string, source: string) {
  return {
    path,
    bytes: Buffer.byteLength(source),
    sha256: createHash('sha256').update(source).digest('hex'),
  }
}

function termPart(value: string, count: number): number {
  let result = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16_777_619)
  }
  return (result >>> 0) % count
}

export function singleFixture() {
  const sources = new Map([
    [
      'registry/blocks/data-table/data-table-12.preview.tsx',
      'export default function Demo() { return <div>Export payments</div> }\n',
    ],
    [
      'packages/ui/previews/button/button.preview.tsx',
      "import { Button } from '@astrale-os/ui/button'\nexport default () => <Button>Save</Button>\n",
    ],
  ])
  const documents = [
    {
      address: '@astrale-os/ui/button',
      title: 'Button',
      description: 'Runtime button component.',
      dependencies: [],
      code: {
        language: 'tsx',
        ...file(
          'packages/ui/previews/button/button.preview.tsx',
          sources.get('packages/ui/previews/button/button.preview.tsx')!,
        ),
      },
      packageImport: '@astrale-os/ui/button',
      family: 'component/button',
      lengths: [2, 3, 0, 0],
    },
    {
      address: 'block/data-table/data-table-12',
      title: 'Data Table 12',
      description: 'Editable payment table with export.',
      dependencies: ['@tanstack/react-table'],
      code: {
        language: 'tsx',
        ...file(
          'registry/blocks/data-table/data-table-12.preview.tsx',
          sources.get('registry/blocks/data-table/data-table-12.preview.tsx')!,
        ),
      },
      command: 'astrale ui add block/data-table/data-table-12',
      family: 'block/data-table',
      lengths: [5, 5, 0, 3],
    },
  ]
  const postings = {
    button: [0, 2, 1, 0, 0],
    data: [1, 2, 0, 0, 0],
    editable: [1, 0, 1, 0, 0],
    export: [1, 0, 1, 0, 0],
    payment: [1, 0, 1, 0, 0],
    runtime: [0, 0, 1, 0, 0],
    table: [1, 2, 1, 0, 0],
  }
  const index = {
    version: 1,
    scoringFingerprint: fingerprint,
    fieldNames,
    averageLengths: [3.5, 4, 0, 1.5],
    documents,
    terms: Object.entries(postings).sort(([left], [right]) => left.localeCompare(right)),
  }
  const indexSource = JSON.stringify(index) + '\n'
  const indexFile = file('search/public/index.json', indexSource)
  const manifest: SearchManifest = {
    version: 1,
    engine: 'lexical-v1',
    scoring: { fingerprint, parameters },
    corpus: { registry: 1, runtime: 1, total: 2 },
    layout: { kind: 'single', index: indexFile },
  }
  return {
    manifest,
    index,
    sources,
    responses: new Map([
      ['search/public/manifest.json', JSON.stringify(manifest) + '\n'],
      ['search/public/index.json', indexSource],
      ...sources,
    ]),
  }
}

export function partitionFixture() {
  const single = singleFixture()
  const documents = single.index.documents.map(({ lengths: _lengths, ...document }) => document)
  const termValues: Array<Array<[string, number[]]>> = [[], []]
  for (const [term, flat] of single.index.terms) {
    termValues[termPart(term, termValues.length)]!.push([term, [flat[0]!, 5]])
  }
  for (const [term, posting] of [
    ['\0@astrale-os/ui/button', [0, 1]],
    ['\0block/data-table/data-table-12', [1, 1]],
  ] as const) {
    termValues[termPart(term, termValues.length)]!.push([term, [...posting]])
  }
  for (const values of termValues) {
    values.sort(([left], [right]) => left.localeCompare(right))
  }
  const termSources = termValues.map((values) => JSON.stringify(values) + '\n')
  const metadataSources = documents.map((document, id) => JSON.stringify([[id, document]]) + '\n')
  const termFiles = termSources.map((source, id) => file(`search/public/terms/${id}.json`, source))
  const metadataFiles = metadataSources.map((source, id) =>
    file(`search/public/metadata/${id}.json`, source),
  )
  const manifest: SearchManifest = {
    ...single.manifest,
    layout: {
      kind: 'partitioned',
      documents: 2,
      terms: single.index.terms.map(([term]) => [term, termPart(term, termFiles.length), 1]),
      documentMetadataParts: [0, 1],
      termFiles,
      metadataFiles,
    },
  }
  const responses = new Map<string, string>([
    ['search/public/manifest.json', JSON.stringify(manifest) + '\n'],
    ...termFiles.map((descriptor, id) => [descriptor.path, termSources[id]!] as const),
    ...metadataFiles.map((descriptor, id) => [descriptor.path, metadataSources[id]!] as const),
    ...single.sources,
  ])
  return {
    manifest,
    values: new Map<string, unknown>([
      ...termFiles.map((descriptor, id) => [descriptor.path, termValues[id]] as const),
      ...metadataFiles.map((descriptor, id) => [descriptor.path, [[id, documents[id]]]] as const),
    ]),
    responses,
  }
}

export function fixtureFetch(
  seen: string[] = [],
  fixture: { responses: ReadonlyMap<string, string> } = singleFixture(),
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    seen.push(url)
    if (url.endsWith('/@astrale-os/ui/beta')) return Response.json({ version: fixtureVersion })
    if (url.includes('/git/ref/tags/')) {
      return Response.json({ object: { type: 'commit', sha: fixtureCommit, url: '' } })
    }
    const marker = `/${fixtureCommit}/`
    const offset = url.indexOf(marker)
    const relative = offset < 0 ? undefined : url.slice(offset + marker.length)
    const source = relative ? fixture.responses.get(relative) : undefined
    return source === undefined ? new Response('not found', { status: 404 }) : new Response(source)
  }) as typeof fetch
}
