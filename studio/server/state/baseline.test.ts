import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { SchemaIR, StudioSchemaBundle } from '../../shared/contracts/schema'

import { STUDIO_SCHEMA_PROJECTION_VERSION } from '../../shared/contracts/schema'
import {
  BASELINE_FORMAT_VERSION,
  captureBaseline,
  computeChanges,
  currentSchemaOf,
  hashAnatomyFiles,
  loadBaseline,
  seedBaseline,
} from './baseline'
import { writeJson, writeState } from './store'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('hashes the current Domain definition and vertical authoring files', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-current-baseline-'))
  roots.push(root)
  const anatomy = [
    'domain.ts',
    'functions/risk/index.ts',
    'package.json',
    'providers/mail/index.ts',
    'queries/risk/index.ts',
    'runtime.ts',
    'schema/index.ts',
    'ui/risk/screen.tsx',
    'views/risk/index.ts',
  ]
  for (const file of [...anatomy, 'README.md']) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), `${file}\n`)
  }
  expect(Object.keys(hashAnatomyFiles(root, 'schema')).sort()).toEqual(anatomy)
})

test('hashes a config-selected nested Domain definition explicitly', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-nested-domain-baseline-'))
  roots.push(root)
  mkdirSync(join(root, 'domain/schema'), { recursive: true })
  const domainFile = join(root, 'domain/domain.ts')
  writeFileSync(domainFile, 'nested Domain definition\n')
  writeFileSync(join(root, 'domain/schema/index.ts'), 'selected Schema\n')

  expect(hashAnatomyFiles(root, 'domain/schema', domainFile)).toMatchObject({
    'domain/domain.ts': expect.any(String),
    'domain/schema/index.ts': expect.any(String),
  })
})

const schema = (domain: string): SchemaIR => ({
  format: 'astrale.dsl',
  version: 'v1',
  domain,
  classes: {},
  importsByKey: {},
  importedClassesByKey: {},
  functions: {},
  views: {},
  policies: {},
  dependencies: [],
  core: {},
})

const canonicalRoot = {
  format: 'astrale.dsl',
  version: 'v1',
  origin: 'notes.example.dev',
} as const

test('persists a versioned canonical baseline with revision and raw root', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-versioned-baseline-'))
  roots.push(root)
  const revision = `sha256:${'b'.repeat(64)}` as const

  captureBaseline(
    root,
    { ir: schema('notes.example.dev'), root: canonicalRoot, revision },
    { source: 'hash' },
  )

  expect(loadBaseline(root)).toMatchObject({
    formatVersion: BASELINE_FORMAT_VERSION,
    revision,
    root: canonicalRoot,
    files: { source: 'hash' },
  })
})

test('any missing, unparsable, malformed or future part invalidates the baseline', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-corrupt-baseline-'))
  roots.push(root)
  const revision = `sha256:${'d'.repeat(64)}` as const
  const meta = (formatVersion: number, projectionVersion: number) => ({
    formatVersion,
    projectionVersion,
    revision,
  })
  const V = BASELINE_FORMAT_VERSION
  const P = STUDIO_SCHEMA_PROJECTION_VERSION
  for (const [file, content] of [
    ['meta.json', { formatVersion: V, projectionVersion: P }],
    ['meta.json', meta(V + 1, P)],
    ['meta.json', meta(V, P + 1)],
    ['ir.json', { ...schema('notes.example.dev'), classes: { Broken: null } }],
    ['ir.json', { ...schema('notes.example.dev'), version: 'legacy' }],
    ['schema-root.json', { canonical: true }],
    ['files.json', { source: 42 }],
    ...['meta.json', 'ir.json', 'schema-root.json', 'files.json'].flatMap((name) => [
      [name, null],
      [name, '{'],
    ]),
  ] as const) {
    captureBaseline(root, { ir: schema('notes.example.dev'), root: canonicalRoot, revision }, {})
    expect(loadBaseline(root)).not.toBeNull()
    const path = `.cache/baseline/${file}`
    if (content === null) rmSync(join(root, '.domain-studio', path))
    else if (typeof content === 'string') writeState(root, path, content)
    else writeJson(root, path, content)
    expect(loadBaseline(root)).toBeNull()
  }
})

test('a snapshot without a Schema is no baseline', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-schemaless-baseline-'))
  roots.push(root)
  captureBaseline(root, { ir: schema('notes.example.dev'), root: null, revision: null }, {})
  expect(loadBaseline(root)).not.toBeNull()
  writeJson(root, '.cache/baseline/ir.json', null)
  expect(loadBaseline(root)).toBeNull()
})

test('only a bundle that holds a Schema seeds the baseline, and the first one stays', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-seeded-baseline-'))
  roots.push(root)
  mkdirSync(join(root, 'schema'), { recursive: true })
  writeFileSync(join(root, 'schema/index.ts'), 'export const schema = {}\n')
  const handle = { root, schemaDirName: 'schema', domainFile: join(root, 'domain.ts') }
  const bundle = (ir: SchemaIR | null): StudioSchemaBundle => ({
    domainId: 'notes',
    renderFingerprint: 'sha-none',
    schemaMode: ir ? 'canonical-preview' : 'unavailable',
    extractedBy: ir ? 'runtime-bun' : 'static-tsmorph-fallback',
    depsInstalled: true,
    ir,
    overlay: { handlerLinks: [], definitions: [], integrations: [], sourceSpans: {} },
    error: ir ? null : { message: 'schema failed to compile' },
    extractedAt: new Date().toISOString(),
  })

  seedBaseline(handle, bundle(null))
  seedBaseline(handle, null)
  expect(loadBaseline(root)).toBeNull()

  seedBaseline(handle, bundle(schema('first.example.dev')))
  seedBaseline(handle, bundle(schema('second.example.dev')))
  expect(loadBaseline(root)).toMatchObject({
    ir: { domain: 'first.example.dev' },
    files: { 'schema/index.ts': expect.any(String) },
  })
})

test('uses equal admitted revisions to suppress projection-only schema churn', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-revision-baseline-'))
  roots.push(root)
  const revision = `sha256:${'c'.repeat(64)}` as const
  captureBaseline(
    root,
    {
      ir: schema('old-projection.example.dev'),
      root: { ...canonicalRoot, origin: 'old-projection.example.dev' },
      revision,
    },
    {},
  )

  const changes = computeChanges(
    root,
    { state: 'read', ir: schema('new-projection.example.dev'), revision },
    {},
    { git: { hasGit: false } },
  )
  expect(changes.schema).toEqual({ state: 'unchanged' })
  expect(changes.baselineRevision).toBe(revision)
  expect(changes.currentRevision).toBe(revision)
})

test('uses caller-provided Git enrichment without importing workspace effects', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-enriched-baseline-'))
  roots.push(root)
  captureBaseline(root, { ir: schema('notes.example.dev'), root: null, revision: null }, {})

  const changes = computeChanges(
    root,
    { state: 'read', ir: schema('notes.example.dev'), revision: null },
    {},
    { git: { hasGit: true, diffText: 'diff --git a/schema/index.ts b/schema/index.ts' } },
  )

  expect(changes.source).toBe('git')
  expect(changes.hasGit).toBe(true)
  expect(changes.schemaDiffText).toBe('diff --git a/schema/index.ts b/schema/index.ts')
})

test('a current extraction that holds no Schema is unread, with its reason, never unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-unread-baseline-'))
  roots.push(root)
  const reason = 'schema/index.ts(4,1): Cannot find name `Clas`.'
  const failed = { ir: null, error: { message: reason } } as StudioSchemaBundle
  const current = currentSchemaOf(failed)
  const unread = { state: 'unread', reason } as const
  expect(current).toEqual(unread)

  // no baseline yet: still unread, not "no changes"
  expect(computeChanges(root, current, {}, { git: { hasGit: false } })).toMatchObject({
    hasBaseline: false,
    schema: unread,
  })

  // against a baseline: unread, and the baseline source's diff text says so and why
  captureBaseline(root, { ir: schema('notes.example.dev'), root: null, revision: null }, {})
  const changes = computeChanges(root, current, {}, { git: { hasGit: false } })
  expect(changes.hasBaseline).toBe(true)
  expect(changes.schema).toEqual(unread)
  expect(changes.schemaDiffText).toBe(
    'The Schema cannot be read, so nothing is compared: schema/index.ts(4,1): Cannot find name `Clas`.',
  )
  expect(currentSchemaOf(null)).toEqual({
    state: 'unread',
    reason: 'The Domain is no longer in the workspace.',
  })
})

test('a read Schema that differs from the baseline is changed, with each change', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-changed-baseline-'))
  roots.push(root)
  captureBaseline(root, { ir: schema('notes.example.dev'), root: null, revision: null }, {})
  const changes = computeChanges(
    root,
    { state: 'read', ir: schema('renamed.example.dev'), revision: null },
    {},
    { git: { hasGit: false } },
  )
  expect(changes.schema).toEqual({
    state: 'changed',
    changes: [{ kind: 'schema-metadata-changed', target: 'renamed.example.dev' }],
  })
  expect(changes.schemaDiffText).toBe('schema-metadata-changed renamed.example.dev')
})
