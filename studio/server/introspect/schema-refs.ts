import type { StudioSchemaBundle } from '../../shared/types'

/** Enumerate every schema anchor represented by the admitted render IR. */
export function schemaRefs(bundle: StudioSchemaBundle): string[] {
  const ir = bundle.ir
  if (!ir) return []
  const refs = new Set<string>()
  const addMember = (
    base: string,
    properties: Record<string, unknown> | undefined,
    methods: Record<string, unknown> | undefined,
  ) => {
    refs.add(base)
    for (const property of Object.keys(properties ?? {})) refs.add(`${base}.property.${property}`)
    for (const method of Object.keys(methods ?? {})) refs.add(`${base}.method.${method}`)
  }

  for (const [name, definition] of Object.entries(ir.classes)) {
    const namespace = definition.type === 'edge' ? 'edge' : 'class'
    addMember(`${namespace}.${name}`, definition.properties, definition.methods)
    if (definition.type === 'edge') {
      for (const endpoint of definition.endpoints ?? []) {
        if (endpoint.name) refs.add(`edge.${name}.endpoint.${endpoint.name}`)
      }
    }
  }
  for (const name of Object.keys(ir.functions)) refs.add(`function.${name}`)
  for (const [key, definition] of Object.entries(ir.importedClassesByKey)) {
    addMember(`class.${key}`, definition.properties, definition.methods)
  }
  return [...refs]
}
