/** @deprecated Compatibility with inspected Domains whose DSL predates schema.compatibility. */
export interface LegacyDependencyFootprintSchema {
  compareDependencyMeaning?(
    dependent: unknown,
    dependency: unknown,
  ): { readonly footprint: readonly unknown[] }
}

/** Delegate to that Domain's DSL; Studio does not reconstruct dependency reachability. */
export function legacyDependencyFootprint(
  schema: LegacyDependencyFootprintSchema,
  dependent: unknown,
  dependency: unknown,
): readonly unknown[] {
  if (typeof schema.compareDependencyMeaning !== 'function') {
    throw new TypeError('The inspected Domain SDK does not expose dependency compatibility.')
  }
  return schema.compareDependencyMeaning(dependent, dependency).footprint
}
