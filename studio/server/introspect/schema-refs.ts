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

  for (const name of Object.keys(ir.functions ?? {})) refs.add(`function.${name}`)

  // Imported interfaces (kernel mixins + cross-domain) are rendered — and so are
  // commentable — in the Inherited section, keyed under the `interface.` namespace.
  // Canonical bundles retain every exact `(origin, kind, name)` identity. Iterate
  // all of them: a short-name map must never pick one homonym by traversal order.
  // The name-keyed bundle field remains a legacy-only fallback.
  if (ir.importedInterfacesByKey !== undefined) {
    for (const [key, iface] of Object.entries(ir.importedInterfacesByKey)) {
      const anchor = importedInterfaceAnchor(key)
      if (anchor) addMember(anchor, iface.properties, iface.methods)
    }
  } else {
    for (const [name, iface] of Object.entries(bundle.importedInterfaces ?? {}))
      addMember(`interface.${name}`, iface.properties, iface.methods)
  }

  return [...refs]
}

function importedInterfaceAnchor(key: string): string | null {
  const separator = key.lastIndexOf(':')
  if (separator <= 0) return null
  const ref = key.slice(separator + 1)
  if (!ref.startsWith('interface.')) return null
  const name = ref.slice('interface.'.length)
  return /^[A-Za-z_$][\w$]*$/.test(name) ? `interface.${key}` : null
}
