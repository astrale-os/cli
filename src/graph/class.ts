import type { ClassKey as ClassKeyValue, ClassRef } from '@astrale-os/sdk/graph/class'

import { ClassKey } from '@astrale-os/sdk/graph/class'
import { Path } from '@astrale-os/sdk/graph/path'

/** Admit one canonical Domain-rooted Class Path into its DSL coordinate. */
export function classReference(input: string, label: string): ClassRef {
  const path = Path.parse(input)
  const step = path.ast.steps[0]
  if (
    path.ast.anchor.kind !== 'domain' ||
    path.ast.steps.length !== 1 ||
    step?.kind !== 'projection' ||
    step.projection.kind !== 'class'
  ) {
    throw new TypeError(`${label} must be one canonical Class Path`)
  }
  return ClassKey.ref(
    ClassKey.of({
      origin: path.ast.anchor.origin,
      kind: 'class',
      name: step.projection.name,
    }),
  )
}

/** Admit one canonical Domain-rooted Class Path into its exact string identity. */
export function classKey(input: string, label: string): ClassKeyValue {
  return ClassKey.of(classReference(input, label))
}
