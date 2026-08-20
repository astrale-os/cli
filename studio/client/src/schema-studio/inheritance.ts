import type {
  IrDefinitionKey,
  IrDefinitionRef,
  IrInterface,
  IrMethod,
  IrSchemaRef,
  JsonSchema,
  StudioSchemaBundle,
} from '@shared/types'

/**
 * Inherited members — the properties/methods a class (or interface) gets from the
 * interfaces it implements/extends, which the IR does NOT flatten into the
 * member's own `properties`/`methods`. We resolve them here so the detail pane can
 * surface e.g. `Product → Listable.list` and `Product → Named.name`, grouped by
 * the interface that declares them.
 *
 * Rules (deliberate, see the studio's "kernel is structural noise" principle):
 *  - STOP at the universal `Node`/`Edge` base — every node/edge implements those,
 *    so surfacing their members (and their transitive mixins) would repeat the
 *    same block on every class. We only follow interfaces a member *opts into*.
 *  - Member bodies come from `ir.interfaces` (this domain) first, then
 *    `bundle.importedInterfaces` (kernel mixins + cross-domain interfaces).
 *  - Members the class declares ITSELF are omitted — those are its own/override,
 *    already shown in the main Properties/Methods lists.
 */

/** Universal bases — implemented by every node/edge; never surfaced as inherited. */
const BASE_INTERFACES = new Set(['Node', 'Edge'])
const KERNEL_ORIGIN = 'kernel.astrale.ai'

export type InterfaceTier = 'local' | 'kernel' | 'external'

export interface InheritedGroup {
  /** the interface that declares these members */
  iface: string
  /** Exact declaring Definition. Absent only for legacy name-only bundles. */
  ref?: IrDefinitionRef & { kind: 'interface' }
  tier: InterfaceTier
  /** import origin (undefined for this-domain interfaces) */
  origin?: string
  /** whether a detail view can be opened for it (always true here — body resolved) */
  navigable: boolean
  /** Optionality is explicit for canonical V1 and absent for legacy nullable schemas. */
  props: [name: string, schema: JsonSchema, optional?: boolean][]
  methods: { name: string; method: IrMethod; overridden: boolean }[]
}

type InterfaceReference = string | (IrDefinitionRef & { kind: 'interface' })

function isInterfaceRef(ref: IrSchemaRef): ref is IrDefinitionRef & { kind: 'interface' } {
  return ref.kind === 'interface'
}

function definitionKey(ref: IrDefinitionRef): IrDefinitionKey {
  return `${ref.origin}:${ref.kind}.${ref.name}`
}

function referenceIdentity(ref: InterfaceReference): string {
  return typeof ref === 'string' ? `legacy:${ref}` : definitionKey(ref)
}

function referenceName(ref: InterfaceReference): string {
  return typeof ref === 'string' ? ref : ref.name
}

function parentReferences(def: IrInterface): InterfaceReference[] {
  if (def.extendsRefs !== undefined) return def.extendsRefs.filter(isInterfaceRef)
  return def.extends ?? []
}

function isUniversalBase(ref: InterfaceReference): boolean {
  if (typeof ref === 'string') return BASE_INTERFACES.has(ref)
  return ref.origin === KERNEL_ORIGIN && ref.kind === 'interface' && BASE_INTERFACES.has(ref.name)
}

/**
 * Resolve an interface body. Exact refs never fall back to a name lookup: doing so could select a
 * local declaration or another dependency that happens to reuse the same member name.
 */
export function resolveInterface(
  bundle: StudioSchemaBundle,
  reference: string | IrDefinitionRef,
): IrInterface | undefined {
  const ir = bundle.ir
  if (!ir) return undefined
  if (typeof reference === 'string') {
    return ir.interfaces[reference] ?? bundle.importedInterfaces?.[reference]
  }
  if (reference.kind !== 'interface') return undefined
  if (reference.origin === ir.domain) return ir.interfaces[reference.name]
  return ir.importedInterfacesByKey?.[definitionKey(reference)]
}

/** Where an implemented interface comes from, for icon/tone selection. */
export function interfaceTier(
  bundle: StudioSchemaBundle,
  reference: InterfaceReference,
): InterfaceTier {
  if (typeof reference !== 'string') {
    if (reference.origin === bundle.ir?.domain) return 'local'
    return reference.origin === KERNEL_ORIGIN ? 'kernel' : 'external'
  }
  if (bundle.ir?.interfaces[reference]) return 'local'
  return bundle.ir?.imports[reference]?.origin === KERNEL_ORIGIN ? 'kernel' : 'external'
}

export function interfaceOrigin(
  bundle: StudioSchemaBundle,
  reference: InterfaceReference,
): string | undefined {
  if (typeof reference !== 'string')
    return reference.origin === bundle.ir?.domain ? undefined : reference.origin
  return bundle.ir?.imports[reference]?.origin
}

/**
 * Walk `parents` (a class's `implements` or an interface's `extends`) plus each
 * parent's own `extends` chain, collecting members grouped by declaring interface.
 * `ownProps`/`ownMethods` are the member's own declarations (excluded — they're
 * the override). First interface to declare a member name wins (de-dupes diamonds).
 */
function buildGroups(
  bundle: StudioSchemaBundle,
  parents: InterfaceReference[],
  ownProps: Set<string>,
  ownMethods: Set<string>,
): InheritedGroup[] {
  if (!bundle.ir) return []
  const claimedProps = new Set<string>(ownProps)
  // Properties the member declares itself replace the inherited ones (excluded).
  // Methods are KEPT even when overridden — flagged so the UI can mark them — so
  // start this set empty and only use it to de-dupe across interfaces (diamonds).
  const claimedMethods = new Set<string>()
  const visited = new Set<string>()
  const groups: InheritedGroup[] = []

  // breadth-first in declaration order: a directly-implemented interface is
  // processed before the parents it extends, so it wins ownership of shared names.
  const queue = [...parents]
  while (queue.length) {
    const reference = queue.shift()!
    const identity = referenceIdentity(reference)
    const name = referenceName(reference)
    if (visited.has(identity) || isUniversalBase(reference)) continue
    visited.add(identity)
    const def = resolveInterface(bundle, reference)
    if (!def) continue
    for (const parent of parentReferences(def))
      if (!isUniversalBase(parent) && !visited.has(referenceIdentity(parent))) queue.push(parent)

    const props = Object.entries(def.properties ?? {})
      // Canonical Properties are keyed by their exact declaring Definition, so same-named
      // Properties from distinct origins coexist. A class/interface's own Property still
      // overrides every inherited declaration; cross-interface name de-duplication is legacy-only.
      .filter(([p]) => !ownProps.has(p) && (typeof reference !== 'string' || !claimedProps.has(p)))
      .map(
        ([name, schema]) =>
          [
            name,
            schema,
            def.required ? !def.required.includes(name) : undefined,
          ] as InheritedGroup['props'][number],
      )
    const methods = (Object.entries(def.methods ?? {}) as [string, IrMethod][])
      // Exact Method diamonds are already coalesced by visiting the declaring ref once. Methods
      // with the same name but distinct owners remain visible (and are marked overridden).
      .filter(([m]) => typeof reference !== 'string' || !claimedMethods.has(m))
      .map(([name, method]) => ({ name, method, overridden: ownMethods.has(name) }))
    if (typeof reference === 'string') {
      for (const [p] of props) claimedProps.add(p)
      for (const m of methods) claimedMethods.add(m.name)
    }
    if (props.length === 0 && methods.length === 0) continue

    groups.push({
      iface: name,
      ...(typeof reference === 'string' ? {} : { ref: reference }),
      tier: interfaceTier(bundle, reference),
      origin: interfaceOrigin(bundle, reference),
      navigable: true,
      props,
      methods,
    })
  }

  // this-domain interfaces first, then cross-domain, then kernel mixins — most
  // semantically meaningful at the top, structural mixins last.
  const rank: Record<InterfaceTier, number> = { local: 0, external: 1, kernel: 2 }
  return groups.sort((a, b) => rank[a.tier] - rank[b.tier])
}

/** Inherited groups for a class — from the interfaces it `implements`. */
export function inheritedGroupsOfClass(
  bundle: StudioSchemaBundle,
  className: string,
): InheritedGroup[] {
  const cls = bundle.ir?.classes[className]
  if (!cls) return []
  return buildGroups(
    bundle,
    cls.implementsRefs !== undefined
      ? cls.implementsRefs.filter(isInterfaceRef)
      : (cls.implements ?? []),
    new Set(Object.keys(cls.properties ?? {})),
    new Set(Object.keys(cls.methods ?? {})),
  )
}

/** Inherited groups for an interface — from the interfaces it `extends`. */
export function inheritedGroupsOfInterface(
  bundle: StudioSchemaBundle,
  interfaceReference: InterfaceReference,
): InheritedGroup[] {
  const def = resolveInterface(bundle, interfaceReference)
  if (!def) return []
  return buildGroups(
    bundle,
    parentReferences(def),
    new Set(Object.keys(def.properties ?? {})),
    new Set(Object.keys(def.methods ?? {})),
  )
}

/** Total inherited member count across all groups (for the section hint). */
export function inheritedCount(groups: InheritedGroup[]): number {
  return groups.reduce((n, g) => n + g.props.length + g.methods.length, 0)
}
