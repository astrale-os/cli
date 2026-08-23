import { expect, test } from 'bun:test'

import type { IrClassKey, SchemaIR } from '../../shared/types'

import { buildOverlay } from './overlay'

function descriptor(origin: string, name: string) {
  const key = `${origin}:class.${name}` as IrClassKey
  return { origin, ref: { origin, kind: 'class' as const, name }, key }
}

test('preserves homonymous Classes through exact import identity', () => {
  const first = descriptor('a.example', 'Shared')
  const second = descriptor('b.example', 'Shared')
  const kernel = descriptor('kernel.astrale.ai', 'Identity')
  const ir = {
    version: 'v1',
    format: 'astrale.dsl',
    domain: 'app.example',
    classes: {},
    functions: {},
    importsByKey: {
      [first.key]: first,
      [second.key]: second,
      [kernel.key]: kernel,
    },
    importedClassesByKey: {},
    views: {},
    policies: {},
    dependencies: [
      { origin: first.origin, revision: `sha256:${'a'.repeat(64)}` },
      { origin: second.origin, revision: `sha256:${'b'.repeat(64)}` },
    ],
    core: {},
  } satisfies SchemaIR

  const overlay = buildOverlay({ ir, domainRoot: '', schemaDir: '' })
  expect(overlay.crossDomainImports).toEqual([
    { name: 'Shared', origin: first.origin, ref: first.ref },
    { name: 'Shared', origin: second.origin, ref: second.ref },
  ])
  expect(overlay.mixins).toEqual([{ name: 'Identity', origin: kernel.origin, ref: kernel.ref }])
  expect(overlay.requires).toEqual(['a.example', 'b.example'])
})
