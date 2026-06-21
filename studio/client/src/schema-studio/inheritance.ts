import type { IrInterface, IrMethod, JsonSchema, StudioSchemaBundle } from '@shared/types'

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
  tier: InterfaceTier
  /** import origin (undefined for this-domain interfaces) */
  origin?: string
  /** whether a detail view can be opened for it (always true here — body resolved) */
  navigable: boolean
  props: [string, JsonSchema][]
  methods: { name: string; method: IrMethod; overridden: boolean }[]
}

/** Resolve an interface's member body — own-domain first, then imported (kernel/cross-domain). */
export function resolveInterface(
  bundle: StudioSchemaBundle,
  name: string,
): IrInterface | undefined {
  return bundle.ir?.interfaces[name] ?? bundle.importedInterfaces?.[name]
}

/** Where an implemented interface comes from, for icon/tone selection. */
export function interfaceTier(bundle: StudioSchemaBundle, name: string): InterfaceTier {
  if (bundle.ir?.interfaces[name]) return 'local'
  return bundle.ir?.imports[name]?.origin === KERNEL_ORIGIN ? 'kernel' : 'external'
}

export function interfaceOrigin(bundle: StudioSchemaBundle, name: string): string | undefined {
  return bundle.ir?.imports[name]?.origin
}

/**
 * Walk `parents` (a class's `implements` or an interface's `extends`) plus each
 * parent's own `extends` chain, collecting members grouped by declaring interface.
 * `ownProps`/`ownMethods` are the member's own declarations (excluded — they're
 * the override). First interface to declare a member name wins (de-dupes diamonds).
 */
function buildGroups(
  bundle: StudioSchemaBundle,
  parents: string[],
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
    const name = queue.shift()!
    if (visited.has(name) || BASE_INTERFACES.has(name)) continue
    visited.add(name)
    const def = resolveInterface(bundle, name)
    if (!def) continue
    for (const parent of def.extends ?? [])
      if (!BASE_INTERFACES.has(parent) && !visited.has(parent)) queue.push(parent)

    const props = Object.entries(def.properties ?? {}).filter(([p]) => !claimedProps.has(p)) as [
      string,
      JsonSchema,
    ][]
    const methods = (Object.entries(def.methods ?? {}) as [string, IrMethod][])
      .filter(([m]) => !claimedMethods.has(m))
      .map(([name, method]) => ({ name, method, overridden: ownMethods.has(name) }))
    for (const [p] of props) claimedProps.add(p)
    for (const m of methods) claimedMethods.add(m.name)
    if (props.length === 0 && methods.length === 0) continue

    groups.push({
      iface: name,
      tier: interfaceTier(bundle, name),
      origin: interfaceOrigin(bundle, name),
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
    cls.implements ?? [],
    new Set(Object.keys(cls.properties ?? {})),
    new Set(Object.keys(cls.methods ?? {})),
  )
}

/** Inherited groups for an interface — from the interfaces it `extends`. */
export function inheritedGroupsOfInterface(
  bundle: StudioSchemaBundle,
  ifaceName: string,
): InheritedGroup[] {
  const def = resolveInterface(bundle, ifaceName)
  if (!def) return []
  return buildGroups(
    bundle,
    def.extends ?? [],
    new Set(Object.keys(def.properties ?? {})),
    new Set(Object.keys(def.methods ?? {})),
  )
}

/** Total inherited member count across all groups (for the section hint). */
export function inheritedCount(groups: InheritedGroup[]): number {
  return groups.reduce((n, g) => n + g.props.length + g.methods.length, 0)
}
