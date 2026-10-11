import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DomainHandle } from '../domain/registry'

import { buildBundle } from './bundle'
import { buildCore } from './core'
import { renderFingerprintOf } from './hash'
import { runtimeExtract } from './runtime'

const roots: string[] = []
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

function currentFixture(): DomainHandle {
  const root = mkdtempSync(join(tmpdir(), 'studio-canonical-runtime-'))
  roots.push(root)
  mkdirSync(join(root, 'schema'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
  writeFileSync(join(root, 'astrale.config.ts'), 'export default {}\n')
  const sdk = realpathSync(join(import.meta.dir, '../../../node_modules/@astrale-os/sdk'))
  const scope = join(root, 'node_modules', '@astrale-os')
  mkdirSync(scope, { recursive: true })
  symlinkSync(sdk, join(scope, 'sdk'), 'dir')
  const schemaIndex = join(root, 'schema/index.ts')
  const domainFile = join(root, 'domain.ts')
  writeFileSync(
    schemaIndex,
    `
      import { classIcon, core, defineSchema, nodeClass, view } from '@astrale-os/sdk/schema'
      const Named = nodeClass({ icon: classIcon.neutral, policies: { read: true }, properties: {} })
      export const DirectorySchema = defineSchema('directory.runtime.test', { name: 'Test Domain',
        classes: { Named },
      })
      const Document = nodeClass({ extends: [Named], icon: classIcon.neutral, policies: { read: true }, properties: {} })
      const welcome = core.node(Document, {})
      export const schema = defineSchema('documents.runtime.test', { name: 'Test Domain',
        dependencies: { directory: DirectorySchema },
        classes: { Document },
        views: { editor: view({ description: 'Edit documents.' }) },
        core: { nodes: { welcome } },
      })
    `,
  )
  writeFileSync(domainFile, `throw new Error('Domain definition entry was imported')\n`)
  return {
    id: 'documents-runtime-test',
    root,
    configFile: join(root, 'astrale.config.ts'),
    domainFile,
    schemaDirName: 'schema',
    schemaDir: join(root, 'schema'),
    schemaIndex,
  }
}

test('the authored SDK admits the Schema; the bundle carries its revision, Core and imports', async () => {
  const handle = currentFixture()
  const extracted = await runtimeExtract(handle.schemaIndex, handle.root)
  expect(extracted).toMatchObject({
    ok: true,
    schemaMode: 'canonical-admitted',
    root: { format: 'astrale.dsl', version: 'v1', origin: 'documents.runtime.test' },
    ir: {
      domain: 'documents.runtime.test',
      views: { editor: { name: 'editor', description: 'Edit documents.' } },
      importsByKey: {
        'directory.runtime.test:class.Named': {
          ref: { origin: 'directory.runtime.test', kind: 'class', name: 'Named' },
        },
      },
    },
  })
  expect(extracted.revision).toMatch(/^sha256:[0-9a-f]{64}$/)

  // the DSL revision travels as is, while the render identity stays separate
  const built = await buildBundle(handle)
  expect(built.schemaRoot).toEqual(extracted.root)
  expect(built.schemaRevision).toBe(extracted.revision!)
  expect(built.renderFingerprint).toBe(renderFingerprintOf(extracted.root))
  expect(built.renderFingerprint).not.toBe(renderFingerprintOf(extracted.ir))

  // Core comes through the pure Schema entry, never the Domain definition
  expect(buildCore(handle, built)).toMatchObject({
    domain: 'documents.runtime.test',
    nodes: [{ path: '/:documents.runtime.test:core.welcome', className: 'Document', data: {} }],
    edges: [],
    error: null,
  })
})
