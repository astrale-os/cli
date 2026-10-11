import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { SchemaIR } from '../../shared/types'

import { STUDIO_SCHEMA_PROJECTION_VERSION } from '../../shared/types'
import {
  BASELINE_FORMAT_VERSION,
  captureBaseline,
  computeChanges,
  hashAnatomyFiles,
  loadBaseline,
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
    schema('new-projection.example.dev'),
    {},
    {
      currentRevision: revision,
      git: { hasGit: false },
    },
  )
  expect(changes.schemaChanges).toEqual([])
  expect(changes.structuralStatus).toBe('none')
  expect(changes.baselineRevision).toBe(revision)
  expect(changes.currentRevision).toBe(revision)
})

test('uses caller-provided Git enrichment without importing workspace effects', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-enriched-baseline-'))
  roots.push(root)
  captureBaseline(root, { ir: schema('notes.example.dev'), root: null, revision: null }, {})

  const changes = computeChanges(
    root,
    schema('notes.example.dev'),
    {},
    {
      git: { hasGit: true, diffText: 'diff --git a/schema/index.ts b/schema/index.ts' },
    },
  )

  expect(changes.source).toBe('git')
  expect(changes.hasGit).toBe(true)
  expect(changes.schemaDiffText).toBe('diff --git a/schema/index.ts b/schema/index.ts')
})
