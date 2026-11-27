/**
 * Structure lens: what exists. Node Classes are cards, relationships are links.
 *
 * The projector states the schema as it is declared — every relationship once, every end
 * with everything it accepts, every accepted Class drawn — and leaves the drawing grammar
 * to the canvas: a union end meets a junction there without this file knowing.
 *
 * - A Class of another Domain or of the Kernel that an end accepts is a node, quiet, in a
 *   frame named for its Domain.
 * - A module is a group; what the schema declares at its root belongs to none.
 * - A parent on the canvas is an "is a" link; a parent off it is a badge.
 *
 * Options:
 * - `dependencies` (on by default) frames other Domains' Classes; off, each other Domain
 *   is one node its ends land on.
 * - `inheritance` also draws the named parents no end accepts, with their "is a" links.
 */

import type { IrClass, IrEndpoint, JsonSchema, StudioSchemaBundle } from '@shared/contracts/schema'

import { isNodePathSchema } from '@shared/contracts/schema'
import { classRefKey, type IrClassRef, isIrClassRef } from '@shared/schema/identity'

import type {
  LensOption,
  LensOptions,
  Scene,
  SceneBadge,
  SceneEnd,
  SceneFold,
  SceneGroup,
  SceneLink,
  SceneNode,
  SceneRow,
} from '../scene/types'

import {
  isKernelClass,
  isKernelImplementationClass,
  KERNEL_ORIGIN,
  kernelRolesOfClass,
  resolveClass,
} from '../../schema-studio/inheritance'
import { moduleHues, moduleLabel, moduleOfMember } from '../../schema-studio/modules'
import { type Lifetime, lifetimesOf } from './lifetimes'

export const STRUCTURE_OPTIONS: LensOption[] = [
  {
    id: 'dependencies',
    label: 'Other Domains',
    description:
      'Draw each Class of another Domain or the Kernel that a relationship accepts, in its Domain’s frame; off, each Domain is one node',
    default: true,
    icon: 'domains',
  },
  {
    id: 'inheritance',
    label: 'Inheritance',
    description: 'Also draw the parents no relationship accepts, each with its “is a” link',
    default: false,
    icon: 'inheritance',
  },
]

/** The most Classes one Structure scene states; past it the rest is counted, not drawn. */
export const STRUCTURE_NODE_BUDGET = 600

const SCHEMA_DIR = 'schema'
/** The module of what the schema declares at its root, outside any module folder. */
const ROOT_MODULE = 'root'

/** The group a module's members belong to; the root's belong to none. */
const groupOf = (module: string): { group?: string } =>
  module === ROOT_MODULE ? {} : { group: `module.${module}` }

/** `shell` for `shell.astrale.ai`, `kernel` for the Kernel. */
export function originShort(origin: string): string {
  if (origin === KERNEL_ORIGIN) return 'kernel'
  return origin.split('.')[0] ?? origin
}

/** The selection target that opens a Class: its bare name at home, its exact key elsewhere. */
export function classTarget(ref: IrClassRef, domain: string): string {
  return ref.origin === domain ? `class.${ref.name}` : `class.${classRefKey(ref)}`
}

function countLabel(cardinality: IrEndpoint['cardinality']): string | undefined {
  if (!cardinality) return undefined
  const { min, max } = cardinality
  if (max === null) return `${min}..*`
  return min === max ? `${min}` : `${min}..${max}`
}

/** A property's type, short enough for a card row. */
export function shortType(schema: JsonSchema | undefined): string {
  if (!schema) return 'unknown'
  if (isNodePathSchema(schema)) return '→ node'
  if (Array.isArray(schema.enum)) return schema.enum.map(String).join(' | ')
  const type = Array.isArray(schema.type)
    ? schema.type.find((candidate) => candidate !== 'null')
    : schema.type
  if (type === 'array') return `${shortType(schema.items)}[]`
  if (type === 'string' && typeof schema.format === 'string') return schema.format
  return type ?? 'unknown'
}

function metadataOf(member: IrClass, property: string): Record<string, unknown> {
  const value = member.propertyMetadata?.[property]
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function propertyRows(className: string, member: IrClass): SceneRow[] {
  const required = new Set(member.required ?? [])
  return Object.entries(member.properties).map(([name, schema]) => {
    const metadata = metadataOf(member, name)
    const marks: string[] = []
    if (required.has(name)) marks.push('required')
    if (metadata.immutable === true || schema.readOnly === true) marks.push('immutable')
    if (metadata.auto === true) marks.push('auto')
    if (metadata.state !== undefined) marks.push('state')
    const anchor = `class.${className}.property.${name}`
    return { id: anchor, anchor, label: name, detail: shortType(schema), marks }
  })
}

/** The Classes an end accepts, as exact references. */
export function endpointRefs(endpoint: IrEndpoint | undefined, domain: string): IrClassRef[] {
  if (!endpoint) return []
  if (endpoint.refs !== undefined) return endpoint.refs.filter(isIrClassRef)
  return endpoint.types.map((name) => ({ origin: domain, kind: 'class' as const, name }))
}

/** A Class and every Class it extends, however far up, by reference key. */
export function lineage(bundle: StudioSchemaBundle, ref: IrClassRef): Set<string> {
  const keys = new Set<string>()
  const queue = [ref]
  while (queue.length > 0) {
    const next = queue.shift()!
    const key = classRefKey(next)
    if (keys.has(key)) continue
    keys.add(key)
    queue.push(...(resolveClass(bundle, next)?.extendsRefs ?? []))
  }
  return keys
}

/**
 * Whether one Node could stand at both ends: some Class one end accepts is, extends, or is
 * extended by one the other end accepts. Otherwise `no self` cannot be broken and says nothing.
 */
function endsMeet(
  bundle: StudioSchemaBundle,
  from: readonly IrClassRef[],
  to: readonly IrClassRef[],
): boolean {
  const lineages = (refs: readonly IrClassRef[]) =>
    refs.map((ref) => ({ key: classRefKey(ref), lineage: lineage(bundle, ref) }))
  const left = lineages(from)
  const right = lineages(to)
  return left.some((a) => right.some((b) => a.lineage.has(b.key) || b.lineage.has(a.key)))
}

/**
 * What a card says of its parents: the named ones not drawn as "is a" links, the Kernel
 * scaffolding when near, and the Kernel role it carries however far up it was picked up.
 */
function inheritanceBadges(
  bundle: StudioSchemaBundle,
  parents: readonly IrClassRef[],
  drawn: (ref: IrClassRef) => boolean,
  roleRefs: readonly IrClassRef[] = parents,
): SceneBadge[] {
  const domain = bundle.ir!.domain
  const named = parents.filter((ref) => !isKernelImplementationClass(ref) && !drawn(ref))
  const scaffolding = parents.filter((ref) => isKernelImplementationClass(ref) && !drawn(ref))
  const label = (ref: IrClassRef) =>
    ref.origin === domain ? ref.name : `${originShort(ref.origin)}.${ref.name}`
  const badges: SceneBadge[] = []
  if (named.length > 0) {
    badges.push({
      label: `extends ${named.map(label).join(', ')}`,
      title: named.map((ref) => classRefKey(ref)).join('\n'),
    })
  }
  if (scaffolding.length > 0) {
    badges.push({
      label: scaffolding.map((ref) => ref.name).join(' · '),
      title: 'Kernel bases every such Class carries',
      near: true,
    })
  }
  for (const role of kernelRolesOfClass(bundle, roleRefs)) {
    badges.push({ label: role, tone: 'core', title: `A Kernel ${role}` })
  }
  return badges
}

export function projectStructure(bundle: StudioSchemaBundle, options: LensOptions): Scene {
  const ir = bundle.ir
  if (!ir) {
    return {
      key: `structure:${bundle.domainId}:empty`,
      nodes: [],
      links: [],
      groups: [],
      folded: [],
    }
  }
  const domain = ir.domain
  const showInheritance = options.inheritance === true
  const showDependencies = options.dependencies !== false
  const hues = moduleHues(bundle, SCHEMA_DIR)

  const local = Object.entries(ir.classes)
    .filter(([, member]) => member.type === 'node')
    .map(([name, member]) => ({
      name,
      member,
      module: moduleOfMember(bundle, 'class', name, SCHEMA_DIR),
    }))
    .sort(
      (left, right) =>
        left.module.localeCompare(right.module) || left.name.localeCompare(right.name),
    )
  const relationships = Object.entries(ir.classes)
    .filter(([, member]) => member.type === 'edge')
    .map(([name, member]) => ({
      name,
      member,
      module: moduleOfMember(bundle, 'edge', name, SCHEMA_DIR),
    }))
    .sort(
      (left, right) =>
        left.module.localeCompare(right.module) || left.name.localeCompare(right.name),
    )

  const folded: SceneFold[] = []
  const drawnLocal = local.slice(0, STRUCTURE_NODE_BUDGET)
  if (local.length > drawnLocal.length) {
    folded.push({
      label: 'Classes',
      count: local.length - drawnLocal.length,
      reason: 'over the Structure budget — search the Index or isolate a neighbourhood (F)',
    })
  }
  const localIds = new Set(drawnLocal.map(({ name }) => `class.${name}`))

  // Every Class an end accepts is drawn: another Domain's or the Kernel's in its Domain's
  // frame, or — without frames — as that Domain's one node. Never a whole imported Domain.
  const foreign = new Map<string, { ref: IrClassRef; member?: IrClass }>()
  const otherDomains = new Set<string>()
  const nodeFor = (ref: IrClassRef): string | undefined => {
    const target = classTarget(ref, domain)
    if (ref.origin === domain) return localIds.has(target) ? target : undefined
    if (!showDependencies) {
      otherDomains.add(ref.origin)
      return `domain.${ref.origin}`
    }
    if (!foreign.has(target)) foreign.set(target, { ref, member: resolveClass(bundle, ref) })
    return target
  }
  const end = (endpoint: IrEndpoint | undefined, lifetime: Lifetime | undefined): SceneEnd => {
    const nodes: string[] = []
    for (const ref of endpointRefs(endpoint, domain)) {
      const node = nodeFor(ref)
      if (node && !nodes.includes(node)) nodes.push(node)
    }
    const count = countLabel(endpoint?.cardinality)
    return {
      ...(endpoint?.name ? { role: endpoint.name } : {}),
      nodes,
      ...(count ? { count } : {}),
      ...(lifetime === 'restrict' ? { restricts: true as const } : {}),
    }
  }

  const lifetimes = lifetimesOf(bundle)
  const links: SceneLink[] = relationships.map(({ name, member, module }) => {
    const [source, target] = member.endpoints ?? []
    const ends = lifetimes?.get(classRefKey({ origin: domain, kind: 'class', name }))?.ends
    const marks = [
      ...(member.constraints?.noSelf &&
      endsMeet(bundle, endpointRefs(source, domain), endpointRefs(target, domain))
        ? ['no self']
        : []),
      ...(member.constraints?.acyclic ? ['acyclic'] : []),
    ]
    return {
      id: `class.${name}`,
      anchor: `edge.${name}`,
      kind: 'relationship',
      label: name,
      ...groupOf(module),
      from: end(source, ends?.[0]),
      to: end(target, ends?.[1]),
      directed: member.orientation !== 'undirected',
      tone: 'edge' as const,
      ...(marks.length > 0 ? { marks } : {}),
    }
  })

  // With inheritance asked for, the named parents no end accepts are drawn too, and theirs
  // in turn: the chain up to the Kernel scaffolding, which stays a badge.
  if (showInheritance && showDependencies) {
    const queue = [
      ...drawnLocal.flatMap(({ member }) => member.extendsRefs ?? []),
      ...[...foreign.values()].flatMap(({ member }) => member?.extendsRefs ?? []),
    ]
    while (queue.length > 0) {
      const parent = queue.shift()!
      if (parent.origin === domain || isKernelImplementationClass(parent)) continue
      if (foreign.has(classTarget(parent, domain))) continue
      nodeFor(parent)
      queue.push(...(foreign.get(classTarget(parent, domain))?.member?.extendsRefs ?? []))
    }
  }

  /** The node a parent is drawn as, when it is on the canvas as a Class of its own. */
  const drawnParent = (ref: IrClassRef): string | undefined => {
    const target = classTarget(ref, domain)
    return ref.origin === domain
      ? localIds.has(target)
        ? target
        : undefined
      : foreign.has(target)
        ? target
        : undefined
  }
  const children = [
    ...drawnLocal.map(({ name, member, module }) => ({
      id: `class.${name}`,
      parents: member.extendsRefs ?? [],
      group: groupOf(module).group,
    })),
    ...[...foreign].map(([id, { ref, member }]) => ({
      id,
      parents: member?.extendsRefs ?? [],
      group: `domain.${ref.origin}`,
    })),
  ]
  for (const child of children) {
    for (const parent of child.parents) {
      const node = drawnParent(parent)
      if (!node) continue
      links.push({
        id: `extends:${child.id}:${classRefKey(parent)}`,
        opens: child.id,
        kind: 'extends',
        label: 'is a',
        ...(child.group ? { group: child.group } : {}),
        from: { nodes: [child.id] },
        to: { nodes: [node] },
        directed: true,
        tone: 'fn',
        dashed: true,
      })
    }
  }

  const relationshipCount = new Map<string, number>()
  for (const link of links) {
    if (link.kind !== 'relationship') continue
    for (const node of new Set([...link.from.nodes, ...link.to.nodes])) {
      relationshipCount.set(node, (relationshipCount.get(node) ?? 0) + 1)
    }
  }
  // A module that declares only relationships is still a group: the Index lists them there.
  const modules = [...new Set([...drawnLocal, ...relationships].map(({ module }) => module))]
    .filter((module) => module !== ROOT_MODULE)
    .sort((left, right) => left.localeCompare(right))
  const groups: SceneGroup[] = modules.map((module) => ({
    id: `module.${module}`,
    label: moduleLabel(module, SCHEMA_DIR),
    ...(hues.has(module) ? { hue: hues.get(module)! } : {}),
  }))

  const nodes: SceneNode[] = drawnLocal.map(({ name, member, module }) => {
    const id = `class.${name}`
    const properties = Object.keys(member.properties).length
    return {
      id,
      kind: 'class',
      shape: 'card',
      label: name,
      ...groupOf(module),
      icon: { ...(member.icon ? { svg: member.icon } : {}), glyph: 'class' },
      tone: 'node',
      counts: [
        { label: 'properties', value: properties },
        { label: 'relationships', value: relationshipCount.get(id) ?? 0 },
      ],
      badges: inheritanceBadges(bundle, member.extendsRefs ?? [], (ref) =>
        Boolean(drawnParent(ref)),
      ),
      rows: propertyRows(name, member),
      keywords: Object.keys(member.properties),
    }
  })

  for (const [id, { ref, member }] of foreign) {
    const group = `domain.${ref.origin}`
    if (!groups.some((candidate) => candidate.id === group)) {
      groups.push({ id: group, label: originShort(ref.origin) })
    }
    const parents = member?.extendsRefs ?? []
    nodes.push({
      id,
      kind: isKernelClass(ref) ? 'kernel class' : 'imported class',
      shape: 'card',
      label: ref.name,
      sublabel: originShort(ref.origin),
      group,
      icon: { ...(member?.icon ? { svg: member.icon } : {}), glyph: 'class' },
      tone: 'muted',
      counts: [
        { label: 'properties', value: Object.keys(member?.properties ?? {}).length },
        { label: 'relationships', value: relationshipCount.get(id) ?? 0 },
      ],
      // A Kernel base says what it is itself: `Identity` is an identity.
      badges: inheritanceBadges(bundle, parents, (parent) => Boolean(drawnParent(parent)), [
        ref,
        ...parents,
      ]),
      ...(member ? { rows: propertyRows(classRefKey(ref), member) } : {}),
    })
  }
  for (const origin of otherDomains) {
    nodes.push({
      id: `domain.${origin}`,
      kind: 'domain',
      shape: 'card',
      label: originShort(origin),
      sublabel: 'Domain',
      icon: { glyph: 'module' },
      tone: 'muted',
      counts: [{ label: 'relationships', value: relationshipCount.get(`domain.${origin}`) ?? 0 }],
    })
  }

  const functions = Object.keys(ir.functions).length
  const methods = Object.values(ir.classes).reduce(
    (total, member) => total + Object.keys(member.methods).length,
    0,
  )
  if (functions + methods > 0) {
    folded.push({
      label: 'Functions and methods',
      count: functions + methods,
      reason: 'read in the Behavior lens',
      lens: 'behavior',
    })
  }

  return {
    key: [
      'structure',
      bundle.domainId,
      bundle.renderFingerprint,
      showInheritance ? 'inheritance' : '',
      showDependencies ? 'dependencies' : '',
    ].join(':'),
    nodes,
    links,
    groups,
    folded,
    ...(nodes.length === 0 ? { empty: 'The Schema declares no Class.' } : {}),
  }
}
