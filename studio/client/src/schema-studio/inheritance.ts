import type { IrClass, IrClassRef, IrMethod, JsonSchema, StudioSchemaBundle } from '@shared/types'

import { classRefKey } from '@shared/schema/identity'

const KERNEL_ORIGIN = 'kernel.astrale.ai'

export type ClassTier = 'local' | 'kernel' | 'external'

export interface InheritedGroup {
  owner: string
  ref: IrClassRef
  tier: ClassTier
  /** One means declared directly by the selected Class; larger values are transitive hops. */
  depth: number
  /** False in best-effort preview mode when Studio has the ref but not its definition. */
  resolved: boolean
  origin?: string
  props: [name: string, schema: JsonSchema, optional: boolean][]
  methods: { name: string; method: IrMethod; declaredLocally: boolean }[]
}

export function resolveClass(
  bundle: StudioSchemaBundle,
  reference: string | IrClassRef,
): IrClass | undefined {
  const ir = bundle.ir
  if (!ir) return undefined
  if (typeof reference === 'string') return ir.classes[reference]
  return reference.origin === ir.domain
    ? ir.classes[reference.name]
    : ir.importedClassesByKey[classRefKey(reference)]
}

export function classTier(bundle: StudioSchemaBundle, reference: IrClassRef): ClassTier {
  if (reference.origin === bundle.ir?.domain) return 'local'
  return reference.origin === KERNEL_ORIGIN ? 'kernel' : 'external'
}

export function isKernelClass(reference: IrClassRef): boolean {
  return reference.origin === KERNEL_ORIGIN
}

/** A kernel base that says what a Class IS, rather than what it declares. */
export type KernelRole = 'identity' | 'function' | 'view'

const KERNEL_ROLES: Record<string, KernelRole> = {
  Identity: 'identity',
  Function: 'function',
  View: 'view',
}
/** stable painting order, so two Classes with the same roles read the same way */
const KERNEL_ROLE_ORDER: KernelRole[] = ['identity', 'function', 'view']

/** The role a single `extends` reference confers, if it is one of the kernel bases. */
export function kernelRoleOf(reference: IrClassRef): KernelRole | undefined {
  return reference.origin === KERNEL_ORIGIN ? KERNEL_ROLES[reference.name] : undefined
}

/**
 * Every kernel role a Class carries, however far up the chain it was picked up.
 *
 * Being a principal or a callable is inherited whole: a Class three levels below
 * `Identity` is exactly as much an Identity as one that extends it outright, and the
 * canvas has to say so — the intermediate hops are nowhere in sight on the card.
 *
 * The walk resolves each parent through the bundle, so it crosses into imported domains
 * as far as their definitions were shipped; a parent that cannot be resolved simply ends
 * that branch. Cycles are guarded by `visited`, which a malformed schema can present.
 */
export function kernelRolesOfClass(
  bundle: StudioSchemaBundle,
  extendsRefs: readonly IrClassRef[],
): KernelRole[] {
  const found = new Set<KernelRole>()
  const visited = new Set<string>()
  const queue = [...extendsRefs]

  while (queue.length > 0) {
    const ref = queue.shift()!
    const key = classRefKey(ref)
    if (visited.has(key)) continue
    visited.add(key)
    const role = kernelRoleOf(ref)
    if (role) found.add(role)
    queue.push(...(resolveClass(bundle, ref)?.extendsRefs ?? []))
  }

  return KERNEL_ROLE_ORDER.filter((role) => found.has(role))
}

export function inheritedGroupsOfClass(
  bundle: StudioSchemaBundle,
  reference: string | IrClassRef,
): InheritedGroup[] {
  const selected = resolveClass(bundle, reference)
  if (!selected) return []
  const ownProperties = new Set(Object.keys(selected.properties))
  const ownMethods = new Set(Object.keys(selected.methods))
  const claimedProperties = new Set(ownProperties)
  const visited = new Set<string>([classRefKey(selected.ref)])
  const queue = (selected.extendsRefs ?? []).map((ref) => ({ ref, depth: 1 }))
  const groups: InheritedGroup[] = []

  while (queue.length > 0) {
    const { ref, depth } = queue.shift()!
    const key = classRefKey(ref)
    if (visited.has(key)) continue
    visited.add(key)
    const owner = resolveClass(bundle, ref)
    if (owner) {
      queue.push(...(owner.extendsRefs ?? []).map((parent) => ({ ref: parent, depth: depth + 1 })))
    }
    const props = Object.entries(owner?.properties ?? {})
      .filter(([name]) => !claimedProperties.has(name))
      .map(
        ([name, value]) =>
          [name, value, !(owner?.required ?? []).includes(name)] as InheritedGroup['props'][number],
      )
    const methods = Object.entries(owner?.methods ?? {})
      .filter(([, method]) => method.abstract)
      .map(([name, method]) => ({ name, method, declaredLocally: ownMethods.has(name) }))
    for (const [name] of props) claimedProperties.add(name)
    groups.push({
      owner: ref.name,
      ref,
      tier: classTier(bundle, ref),
      depth,
      resolved: owner !== undefined,
      ...(ref.origin === bundle.ir?.domain ? {} : { origin: ref.origin }),
      props,
      methods,
    })
  }

  return groups
}

/**
 * The whole chain a Class descends from, nearest first: level 0 holds the declared
 * parents, level 1 their parents, and so on. A base reached by several routes is listed
 * once, at the shallowest depth it is met. Kernel roots remain in the result because the
 * detail panel is the exhaustive account of the inheritance chain.
 */
export function ancestryOfClass(
  bundle: StudioSchemaBundle,
  extendsRefs: readonly IrClassRef[],
): IrClassRef[][] {
  const levels: IrClassRef[][] = []
  const visited = new Set<string>()
  let frontier = [...extendsRefs]
  while (frontier.length > 0) {
    const level: IrClassRef[] = []
    const next: IrClassRef[] = []
    for (const ref of frontier) {
      const key = classRefKey(ref)
      if (visited.has(key)) continue
      visited.add(key)
      level.push(ref)
      next.push(...(resolveClass(bundle, ref)?.extendsRefs ?? []))
    }
    if (level.length > 0) levels.push(level)
    frontier = next
  }
  return levels
}
