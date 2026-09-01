import type { IrClass, IrClassRef, IrMethod, JsonSchema, StudioSchemaBundle } from '@shared/types'

import { classRefKey } from '@shared/schema/identity'

const KERNEL_ORIGIN = 'kernel.astrale.ai'
const UNIVERSAL_BASES = new Set(['Node', 'Edge'])

export type ClassTier = 'local' | 'kernel' | 'external'

export interface InheritedGroup {
  owner: string
  ref: IrClassRef
  tier: ClassTier
  origin?: string
  props: [name: string, schema: JsonSchema, optional: boolean][]
  methods: { name: string; method: IrMethod; overridden: boolean }[]
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

/** A kernel base that says what a Class IS, rather than what it declares. */
export type KernelRole = 'identity' | 'function'

const KERNEL_ROLES: Record<string, KernelRole> = { Identity: 'identity', Function: 'function' }
/** stable painting order, so two Classes with the same roles read the same way */
const KERNEL_ROLE_ORDER: KernelRole[] = ['identity', 'function']

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
  className: string,
): InheritedGroup[] {
  const selected = bundle.ir?.classes[className]
  if (!selected) return []
  const ownProperties = new Set(Object.keys(selected.properties))
  const ownMethods = new Set(Object.keys(selected.methods))
  const claimedProperties = new Set(ownProperties)
  const claimedMethods = new Set<string>()
  const visited = new Set<string>()
  const queue = [...(selected.extendsRefs ?? [])]
  const groups: InheritedGroup[] = []

  while (queue.length > 0) {
    const ref = queue.shift()!
    const key = classRefKey(ref)
    if (visited.has(key) || (ref.origin === KERNEL_ORIGIN && UNIVERSAL_BASES.has(ref.name))) {
      continue
    }
    visited.add(key)
    const owner = resolveClass(bundle, ref)
    if (!owner) continue
    queue.push(...(owner.extendsRefs ?? []))
    const props = Object.entries(owner.properties)
      .filter(([name]) => !claimedProperties.has(name))
      .map(
        ([name, value]) =>
          [name, value, !(owner.required ?? []).includes(name)] as InheritedGroup['props'][number],
      )
    const methods = Object.entries(owner.methods)
      .filter(([name]) => !claimedMethods.has(name))
      .map(([name, method]) => ({ name, method, overridden: ownMethods.has(name) }))
    for (const [name] of props) claimedProperties.add(name)
    for (const { name } of methods) claimedMethods.add(name)
    if (props.length === 0 && methods.length === 0) continue
    groups.push({
      owner: ref.name,
      ref,
      tier: classTier(bundle, ref),
      ...(ref.origin === bundle.ir?.domain ? {} : { origin: ref.origin }),
      props,
      methods,
    })
  }

  const rank: Record<ClassTier, number> = { local: 0, external: 1, kernel: 2 }
  return groups.sort((left, right) => rank[left.tier] - rank[right.tier])
}
