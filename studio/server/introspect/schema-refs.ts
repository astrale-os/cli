import type { StudioSchemaBundle } from '../../shared/types'

/**
 * schema-refs.ts — enumerate every SCHEMA anchor ref a bundle can target, derived
 * from the IR (the authority), NOT from `overlay.sourceSpans`.
 *
 * Source spans are a best-effort ts-morph source-location index: they cover only
 * locally-authored members and only the declaration helpers the parser recognises.
 * Using their keys as the set of "valid" targets falsely orphans real, commentable
 * targets — most notably INHERITED members surfaced in the detail pane's Inherited
 * section (kernel mixins / cross-domain interfaces, e.g. `interface.Named.property.name`),
 * which live in another package and so have no local span. This walks the IR
 * instead, mirroring exactly the refs the detail pane stamps.
 */
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
    for (const p of Object.keys(properties ?? {})) refs.add(`${base}.property.${p}`)
    for (const m of Object.keys(methods ?? {})) refs.add(`${base}.method.${m}`)
  }

  for (const [name, iface] of Object.entries(ir.interfaces))
    addMember(`interface.${name}`, iface.properties, iface.methods)

  for (const [name, cls] of Object.entries(ir.classes)) {
    const ns = cls.type === 'edge' ? 'edge' : 'class'
    addMember(`${ns}.${name}`, cls.properties, cls.methods)
    if (cls.type === 'edge')
      for (const ep of cls.endpoints ?? [])
        if (ep.name) refs.add(`edge.${name}.endpoint.${ep.name}`)
  }

  // Imported interfaces (kernel mixins + cross-domain) are rendered — and so are
  // commentable — in the Inherited section, keyed under the `interface.` namespace.
  for (const [name, iface] of Object.entries(bundle.importedInterfaces ?? {}))
    addMember(`interface.${name}`, iface.properties, iface.methods)

  return [...refs]
}
