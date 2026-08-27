import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

test('hashes current Application and vertical authoring files', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-current-baseline-'))
  roots.push(root)
  for (const dir of [
    'schema',
    'actions/risk',
    'providers/mail',
    'queries/risk',
    'ui/risk',
    'views/risk',
  ]) {
    mkdirSync(join(root, dir), { recursive: true })
  }
  for (const file of [
    'schema/index.ts',
    'application.ts',
    'runtime.ts',
    'actions/risk/index.ts',
    'providers/mail/index.ts',
    'queries/risk/index.ts',
    'ui/risk/screen.tsx',
    'views/risk/index.ts',
    'package.json',
  ]) {
    writeFileSync(join(root, file), `${file}\n`)
  }
  writeFileSync(join(root, 'README.md'), 'not part of the anatomy fileset\n')

  expect(Object.keys(hashAnatomyFiles(root, 'schema')).sort()).toEqual([
    'actions/risk/index.ts',
    'application.ts',
    'package.json',
    'providers/mail/index.ts',
    'queries/risk/index.ts',
    'runtime.ts',
    'schema/index.ts',
    'ui/risk/screen.tsx',
    'views/risk/index.ts',
  ])
})

test('hashes a config-selected nested Application explicitly', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-nested-application-baseline-'))
  roots.push(root)
  mkdirSync(join(root, 'domain/schema'), { recursive: true })
  const application = join(root, 'domain/application.ts')
  writeFileSync(application, 'nested Application\n')
  writeFileSync(join(root, 'domain/schema/index.ts'), 'selected Schema\n')

  expect(hashAnatomyFiles(root, 'domain/schema', application)).toMatchObject({
    'domain/application.ts': expect.any(String),
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

test('invalidates an unversioned baseline instead of diffing it through a new projection', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-legacy-baseline-'))
  roots.push(root)
  writeJson(root, '.cache/baseline/meta.json', { capturedAt: '2026-01-01T00:00:00.000Z' })
  writeJson(root, '.cache/baseline/ir.json', schema('notes.example.dev'))
  writeJson(root, '.cache/baseline/files.json', {})

  expect(loadBaseline(root)).toBeNull()
})

const corruptBaselineCases = [
  {
    name: 'missing meta',
    mutate: (root: string) => rmSync(join(root, '.domain-studio/.cache/baseline/meta.json')),
  },
  {
    name: 'syntactically invalid meta',
    mutate: (root: string) => writeState(root, '.cache/baseline/meta.json', '{'),
  },
  {
    name: 'structurally invalid meta',
    mutate: (root: string) =>
      writeJson(root, '.cache/baseline/meta.json', {
        formatVersion: BASELINE_FORMAT_VERSION,
        projectionVersion: STUDIO_SCHEMA_PROJECTION_VERSION,
      }),
  },
  {
    name: 'future baseline format',
    mutate: (root: string) =>
      writeJson(root, '.cache/baseline/meta.json', {
        formatVersion: BASELINE_FORMAT_VERSION + 1,
        projectionVersion: STUDIO_SCHEMA_PROJECTION_VERSION,
        revision: `sha256:${'d'.repeat(64)}`,
      }),
  },
  {
    name: 'future projection format',
    mutate: (root: string) =>
      writeJson(root, '.cache/baseline/meta.json', {
        formatVersion: BASELINE_FORMAT_VERSION,
        projectionVersion: STUDIO_SCHEMA_PROJECTION_VERSION + 1,
        revision: `sha256:${'d'.repeat(64)}`,
      }),
  },
  {
    name: 'missing IR',
    mutate: (root: string) => rmSync(join(root, '.domain-studio/.cache/baseline/ir.json')),
  },
  {
    name: 'syntactically invalid IR',
    mutate: (root: string) => writeState(root, '.cache/baseline/ir.json', '{'),
  },
  {
    name: 'structurally invalid IR',
    mutate: (root: string) =>
      writeJson(root, '.cache/baseline/ir.json', {
        ...schema('notes.example.dev'),
        classes: { Broken: null },
      }),
  },
  {
    name: 'missing canonical root',
    mutate: (root: string) => rmSync(join(root, '.domain-studio/.cache/baseline/schema-root.json')),
  },
  {
    name: 'syntactically invalid canonical root',
    mutate: (root: string) => writeState(root, '.cache/baseline/schema-root.json', '{'),
  },
  {
    name: 'structurally invalid canonical root',
    mutate: (root: string) =>
      writeJson(root, '.cache/baseline/schema-root.json', { canonical: true }),
  },
  {
    name: 'missing file hashes',
    mutate: (root: string) => rmSync(join(root, '.domain-studio/.cache/baseline/files.json')),
  },
  {
    name: 'syntactically invalid file hashes',
    mutate: (root: string) => writeState(root, '.cache/baseline/files.json', '{'),
  },
  {
    name: 'structurally invalid file hashes',
    mutate: (root: string) => writeJson(root, '.cache/baseline/files.json', { source: 42 }),
  },
] as const

for (const scenario of corruptBaselineCases) {
  test(`invalidates a baseline with ${scenario.name}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-corrupt-baseline-'))
    roots.push(root)
    const revision = `sha256:${'d'.repeat(64)}` as const
    captureBaseline(root, { ir: schema('notes.example.dev'), root: canonicalRoot, revision }, {})

    scenario.mutate(root)

    expect(loadBaseline(root)).toBeNull()
  })
}

test('keeps a valid current-format legacy baseline without a canonical root or revision', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-legacy-v2-baseline-'))
  roots.push(root)
  const legacyIr = { ...schema('notes.example.dev'), version: 'legacy' }

  captureBaseline(root, { ir: legacyIr, root: null, revision: null }, { source: 'hash' })

  expect(loadBaseline(root)).toMatchObject({
    formatVersion: BASELINE_FORMAT_VERSION,
    ir: legacyIr,
    root: null,
    revision: null,
    files: { source: 'hash' },
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
