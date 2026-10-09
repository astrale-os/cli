import {
  legacyDependencyFootprint,
  type LegacyDependencyFootprintSchema,
} from './legacy/dependency-footprint'

export interface DependencyFootprintSchema extends LegacyDependencyFootprintSchema {
  readonly compatibility?: {
    compareMeaning(request: {
      readonly scope: { readonly kind: 'dependency'; readonly dependent: any }
      readonly target: any
    }): {
      readonly entries: readonly {
        readonly subject: { readonly key: unknown }
        readonly observations: readonly { readonly before?: unknown }[]
      }[]
    }
  }
}

/** Prefer the inspected Domain's canonical compatibility owner; never retry its errors as legacy. */
export function dependencyFootprint(
  schema: DependencyFootprintSchema,
  dependent: unknown,
  dependency: unknown,
): readonly unknown[] {
  if (schema.compatibility === undefined) {
    return legacyDependencyFootprint(schema, dependent, dependency)
  }
  const comparison = schema.compatibility.compareMeaning({
    scope: { kind: 'dependency', dependent },
    target: dependency,
  })
  // Target-only additions have no meaning used by the dependent.
  return comparison.entries
    .filter(({ observations }) => observations.some(({ before }) => before !== undefined))
    .map(({ subject }) => subject.key)
}
