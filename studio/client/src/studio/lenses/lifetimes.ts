/**
 * What deleting a Node does to the links it stands in, as the Kernel defines it. Each end of a
 * relationship has a lifetime: `detach`, the link is removed with the Node; `restrict`, deleting
 * the Node is refused unless the same change removes the link itself. An end declares its
 * lifetime, else the Kernel derives it (`edgeLifetimes`, LANGUAGE-EDGE-LIFETIME): an end that can
 * hold a Node of another Domain — it accepts a Class another Domain owns, or one of its own
 * Domain's that another Domain may extend (`open`, or extended by an `open` one) — detaches,
 * unless an end of the relationship requires a link (`1`, `1..*`); every other end restricts. The
 * Kernel's own relationships keep the lifetimes they declare.
 *
 * The IR carries no lifetime: they are read from the canonical Schema the installed SDK admitted
 * (`schemaRoot`) with the Schemas it depends on (`schemaClosure`), which hold every Class whose
 * `open`-ness the derivation reads. Without them, nothing here is told.
 */

import type { StudioSchemaBundle } from '@shared/contracts/schema'

import { KERNEL_ORIGIN } from '../../schema-studio/inheritance'

export type Lifetime = 'detach' | 'restrict'

/** A relationship's lifetimes, in endpoint order: source then target, or its two incident ends. */
export interface EdgeLifetimes {
  readonly ends: readonly [Lifetime, Lifetime]
  /** whether each end declares its lifetime, rather than taking the derived one */
  readonly declared: readonly [boolean, boolean]
}

interface CanonicalRef {
  readonly origin: string
  readonly kind: string
  readonly name: string
}

interface CanonicalEndpoint {
  readonly accepts: readonly CanonicalRef[]
  readonly onDelete?: Lifetime
  /** its count, under whichever key the orientation declares it */
  readonly count?: string
}

interface CanonicalClass {
  readonly ref: CanonicalRef
  readonly kind: 'node' | 'edge'
  readonly inheritance?: string
  readonly extends: readonly CanonicalRef[]
  readonly endpoints?: readonly [CanonicalEndpoint, CanonicalEndpoint]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const refOf = (value: unknown): CanonicalRef | undefined =>
  isRecord(value) &&
  typeof value.origin === 'string' &&
  typeof value.kind === 'string' &&
  typeof value.name === 'string'
    ? { origin: value.origin, kind: value.kind, name: value.name }
    : undefined

const refsOf = (value: unknown): CanonicalRef[] =>
  Array.isArray(value) ? value.flatMap((each) => refOf(each) ?? []) : []

function endpointOf(value: unknown, countKey: string): CanonicalEndpoint | undefined {
  if (!isRecord(value)) return undefined
  const onDelete =
    value.onDelete === 'detach' || value.onDelete === 'restrict' ? value.onDelete : undefined
  const count = value[countKey]
  return {
    accepts: refsOf(value.accepts),
    ...(onDelete === undefined ? {} : { onDelete }),
    ...(typeof count === 'string' ? { count } : {}),
  }
}

/** The ends of a canonical Edge Class in endpoint order, each with its count. */
function endpointsOf(value: Record<string, unknown>): CanonicalClass['endpoints'] {
  const endpoints = value.endpoints
  if (Array.isArray(endpoints)) {
    const first = endpointOf(endpoints[0], 'incident')
    const second = endpointOf(endpoints[1], 'incident')
    return first && second ? [first, second] : undefined
  }
  if (!isRecord(endpoints)) return undefined
  const source = endpointOf(endpoints.source, 'outgoing')
  const target = endpointOf(endpoints.target, 'incoming')
  return source && target ? [source, target] : undefined
}

/** Every Class a canonical Schema declares, as lifetimes read them. */
function classesOf(schema: unknown): CanonicalClass[] {
  if (!isRecord(schema) || !isRecord(schema.classes)) return []
  return Object.values(schema.classes).flatMap((value): CanonicalClass[] => {
    if (!isRecord(value)) return []
    const ref = refOf(value.ref)
    if (ref === undefined || (value.kind !== 'node' && value.kind !== 'edge')) return []
    const endpoints = value.kind === 'edge' ? endpointsOf(value) : undefined
    return [
      {
        ref,
        kind: value.kind,
        ...(typeof value.inheritance === 'string' ? { inheritance: value.inheritance } : {}),
        extends: refsOf(value.extends),
        ...(endpoints === undefined ? {} : { endpoints }),
      },
    ]
  })
}

const keyOf = (ref: CanonicalRef) => `${ref.origin}:${ref.kind}.${ref.name}`

/**
 * The Classes a Node of another Domain may be of: every `open` Node Class, and every Class of its
 * own Domain it extends, however far up (`lifetimeScope`).
 */
function extendableOf(classes: readonly CanonicalClass[]): ReadonlySet<string> {
  const byKey = new Map(classes.map((each) => [keyOf(each.ref), each]))
  const extendable = new Set<string>()
  const queue = classes
    .filter((each) => each.kind === 'node' && each.inheritance === 'open')
    .map((each) => each.ref)
  while (queue.length > 0) {
    const next = queue.shift()!
    const key = keyOf(next)
    if (extendable.has(key)) continue
    extendable.add(key)
    for (const parent of byKey.get(key)?.extends ?? [])
      if (parent.origin === next.origin) queue.push(parent)
  }
  return extendable
}

/**
 * Whether an end of a relationship of `origin` can hold a Node of another Domain: it accepts a
 * Class `origin` does not own, or one another Domain may extend. The Kernel's own relationships
 * bind every Node and keep the lifetimes of closed Classes (`reachesAnotherDomain`).
 */
function reachesAnotherDomain(
  origin: string,
  endpoint: CanonicalEndpoint,
  extendable: ReadonlySet<string>,
): boolean {
  return endpoint.accepts.some(
    (ref) => ref.origin !== origin || (origin !== KERNEL_ORIGIN && extendable.has(keyOf(ref))),
  )
}

/** An end count that requires a link: detaching there could leave a Node below it. */
const REQUIRED: ReadonlySet<string> = new Set(['1', '1..*'])

const read = new WeakMap<StudioSchemaBundle, ReadonlyMap<string, EdgeLifetimes> | null>()

/**
 * Each relationship's lifetimes, by its key (`classRefKey`): those of the Domain on screen and of
 * the Schemas it depends on. None when the bundle carries no canonical Schema to read them from.
 */
export function lifetimesOf(
  bundle: StudioSchemaBundle,
): ReadonlyMap<string, EdgeLifetimes> | undefined {
  const cached = read.get(bundle)
  if (cached !== undefined) return cached ?? undefined
  const root = classesOf(bundle.schemaRoot)
  if (root.length === 0) {
    read.set(bundle, null)
    return undefined
  }
  const classes = [...root, ...(bundle.schemaClosure ?? []).flatMap(classesOf)]
  const extendable = extendableOf(classes)
  const lifetimes = new Map<string, EdgeLifetimes>()
  for (const edge of classes) {
    if (edge.kind !== 'edge' || edge.endpoints === undefined) continue
    const required = edge.endpoints.some(
      (endpoint) => endpoint.count !== undefined && REQUIRED.has(endpoint.count),
    )
    const [head, tail] = edge.endpoints.map(
      (endpoint): Lifetime =>
        endpoint.onDelete ??
        (!required && reachesAnotherDomain(edge.ref.origin, endpoint, extendable)
          ? 'detach'
          : 'restrict'),
    )
    lifetimes.set(keyOf(edge.ref), {
      ends: [head!, tail!],
      declared: [
        edge.endpoints[0].onDelete !== undefined,
        edge.endpoints[1].onDelete !== undefined,
      ],
    })
  }
  read.set(bundle, lifetimes)
  return lifetimes
}
