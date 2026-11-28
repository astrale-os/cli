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
 * Each other Domain is drawn as the composition says (`DomainShare`):
 * - reached (the default): the Classes the open Domain's ends accept, in its frame;
 * - hidden: none of its Classes; each end that accepts one lands on one node for the Domain;
 * - whole: an area of its own, holding its whole Structure as its own lens draws it. The open
 *   Domain is then an area too, and the relationships between areas are drawn between them.
 * A Class keeps one id whichever way its Domain is drawn (`classTarget` from the open Domain),
 * and is drawn once: by its own Domain's area, else by the first area that reaches it, the
 * open Domain's first.
 *
 * Options: `inheritance` also draws the named parents no end accepts, with their "is a" links.
 */

import type { IrClass, IrEndpoint, JsonSchema, StudioSchemaBundle } from '@shared/contracts/schema'
import type { DomainShare } from '@shared/contracts/workspace'

import { isNodePathSchema } from '@shared/contracts/schema'
import { classRefKey, type IrClassRef, isIrClassRef } from '@shared/schema/identity'

import type {
  LensOption,
  LensOptions,
  Scene,
  SceneArea,
  SceneBadge,
  SceneEnd,
  SceneFold,
  SceneGroup,
  SceneIcon,
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

/** `shell` for `shell.astrale.ai`, `kernel` for the Kernel. */
export function originShort(origin: string): string {
  if (origin === KERNEL_ORIGIN) return 'kernel'
  return origin.split('.')[0] ?? origin
}

/** Whether a Class is Kernel `Identity` or extends it, however far up: one of its Nodes may act. */
export function isIdentityClass(bundle: StudioSchemaBundle, ref: IrClassRef): boolean {
  return kernelRolesOfClass(bundle, [ref]).includes('identity')
}

/** A Class's icon: its authored one, else the glyph of what it is — an identity's, or a Class's. */
export function classIcon(
  bundle: StudioSchemaBundle,
  ref: IrClassRef,
  member: Pick<IrClass, 'icon'> | undefined = resolveClass(bundle, ref),
): SceneIcon {
  return {
    ...(member?.icon ? { svg: member.icon } : {}),
    glyph: isIdentityClass(bundle, ref) ? 'identity' : 'class',
  }
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

/**
 * A card's property rows. `className` names them on the canvas; `anchorClass`, when given,
 * names them as their own Domain does, for a comment filed under `anchorDomain`.
 */
function propertyRows(
  className: string,
  member: IrClass,
  filed?: { anchorClass: string; anchorDomain: string },
): SceneRow[] {
  const required = new Set(member.required ?? [])
  return Object.entries(member.properties).map(([name, schema]) => {
    const metadata = metadataOf(member, name)
    const marks: string[] = []
    if (required.has(name)) marks.push('required')
    if (metadata.immutable === true || schema.readOnly === true) marks.push('immutable')
    if (metadata.auto === true) marks.push('auto')
    if (metadata.state !== undefined) marks.push('state')
    const id = `class.${className}.property.${name}`
    return {
      id,
      ...(filed
        ? {
            anchor: `class.${filed.anchorClass}.property.${name}`,
            anchorDomain: filed.anchorDomain,
          }
        : { anchor: id }),
      label: name,
      detail: shortType(schema),
      marks,
    }
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

/** How the open Domain's Structure draws the other Domains. */
export interface StructureComposition {
  /** How each other Domain is drawn, by origin; one absent is drawn as reached. */
  readonly shares: Readonly<Record<string, DomainShare>>
  /**
   * The Domains drawn whole, as read. A Domain whose share is whole but that is not here — still
   * being read, or unreadable — is drawn as reached meanwhile.
   */
  readonly whole: readonly ComposedDomain[]
  /** What the open Domain's area says of it, once there are areas. */
  readonly home?: AreaName
}

/** What an area says of its Domain: its name, and its version when it declares one. */
export interface AreaName {
  readonly label: string
  readonly version?: string
}

export interface ComposedDomain extends AreaName {
  readonly bundle: StudioSchemaBundle
}

/** Every other Domain drawn as reached: the open Domain's Structure alone. */
export const NO_COMPOSITION: StructureComposition = { shares: {}, whole: [] }

/** The id of the area a Domain is drawn in, beside others. */
export const areaId = (origin: string) => `area.${origin}`

/** The node an end lands on for a Domain drawn hidden. */
const standInId = (origin: string) => `domain.${origin}`

export function projectStructure(bundle: StudioSchemaBundle, options: LensOptions): Scene {
  return composeStructure(bundle, options, NO_COMPOSITION)
}

type Share = DomainShare | 'reached'

/** A Domain's node Classes and relationships, by module then name; its Classes within budget. */
function classesOf(bundle: StudioSchemaBundle) {
  const ir = bundle.ir!
  const sorted = (type: 'node' | 'edge') =>
    Object.entries(ir.classes)
      .filter(([, member]) => member.type === type)
      .map(([name, member]) => ({
        name,
        member,
        module: moduleOfMember(bundle, type === 'node' ? 'class' : 'edge', name, SCHEMA_DIR),
      }))
      .sort(
        (left, right) =>
          left.module.localeCompare(right.module) || left.name.localeCompare(right.name),
      )
  const local = sorted('node')
  return {
    local,
    drawn: local.slice(0, STRUCTURE_NODE_BUDGET),
    relationships: sorted('edge'),
  }
}

interface PartContext {
  /** the open Domain's origin: every Class id is named from it (`classTarget`) */
  home: string
  shareOf: (origin: string) => Share
  /** every Class an area draws as its own, by id */
  drawn: ReadonlySet<string>
  /** every Class a Domain drawn whole declares, drawn or over its budget */
  declared: ReadonlySet<string>
  /** the reached Classes and Domain nodes a part drew: none is drawn twice */
  taken: Set<string>
  inheritance: boolean
  /** a Domain drawn whole beside the open one: its id, which its comments are filed under */
  beside?: { domainId: string; label: string }
}

interface Part {
  nodes: SceneNode[]
  links: SceneLink[]
  groups: SceneGroup[]
  folded: SceneFold[]
}

/** One Domain's Structure as one part of the canvas: the open Domain's, or one drawn whole. */
function projectPart(
  bundle: StudioSchemaBundle,
  classes: ReturnType<typeof classesOf>,
  context: PartContext,
): Part {
  const ir = bundle.ir!
  const domain = ir.domain
  const { home, shareOf, taken, beside } = context
  const hues = moduleHues(bundle, SCHEMA_DIR)
  // A Domain drawn beside the open one names its groups apart; the open Domain's keep theirs.
  const inPart = (id: string) => (beside ? `${id}@${domain}` : id)
  const groupOf = (module: string): { group?: string } =>
    module === ROOT_MODULE ? {} : { group: inPart(`module.${module}`) }
  const own = (name: string): IrClassRef => ({ origin: domain, kind: 'class', name })
  const filed = beside ? { anchorDomain: beside.domainId } : {}

  const { local, drawn: drawnLocal, relationships } = classes
  const folded: SceneFold[] = []
  if (local.length > drawnLocal.length) {
    folded.push({
      label: beside ? `Classes of ${beside.label}` : 'Classes',
      count: local.length - drawnLocal.length,
      reason: 'over the Structure budget — search the Index or isolate a neighbourhood (F)',
    })
  }
  const localIds = new Set(drawnLocal.map(({ name }) => classTarget(own(name), home)))

  // Every Class an end accepts is drawn: in its own Domain's area, else as a reached Class in
  // its Domain's frame, else — its Domain hidden — as that Domain's one node. Never a whole
  // imported Domain.
  const foreign = new Map<string, { ref: IrClassRef; member?: IrClass }>()
  const standIns = new Set<string>()
  const nodeFor = (ref: IrClassRef): string | undefined => {
    const target = classTarget(ref, home)
    if (ref.origin === domain) return localIds.has(target) ? target : undefined
    const share = shareOf(ref.origin)
    if (share === 'whole' && context.declared.has(target))
      return context.drawn.has(target) ? target : undefined
    if (share === 'hidden') {
      const id = standInId(ref.origin)
      if (!taken.has(id)) {
        taken.add(id)
        standIns.add(ref.origin)
      }
      return id
    }
    if (!taken.has(target)) {
      taken.add(target)
      foreign.set(target, { ref, member: resolveClass(bundle, ref) })
    }
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
    const ends = lifetimes?.get(classRefKey(own(name)))?.ends
    const marks = [
      ...(member.constraints?.noSelf &&
      endsMeet(bundle, endpointRefs(source, domain), endpointRefs(target, domain))
        ? ['no self']
        : []),
      ...(member.constraints?.acyclic ? ['acyclic'] : []),
    ]
    return {
      id: classTarget(own(name), home),
      anchor: `edge.${name}`,
      ...filed,
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
  // in turn: the chain up to the Kernel scaffolding, which stays a badge. A parent of a hidden
  // Domain stays a badge; one its own area draws is drawn there.
  if (context.inheritance) {
    const queue = [
      ...drawnLocal.flatMap(({ member }) => member.extendsRefs ?? []),
      ...[...foreign.values()].flatMap(({ member }) => member?.extendsRefs ?? []),
    ]
    while (queue.length > 0) {
      const parent = queue.shift()!
      if (parent.origin === domain || isKernelImplementationClass(parent)) continue
      const share = shareOf(parent.origin)
      const target = classTarget(parent, home)
      if (share === 'hidden' || (share === 'whole' && context.declared.has(target))) continue
      if (taken.has(target)) continue
      nodeFor(parent)
      queue.push(...(foreign.get(target)?.member?.extendsRefs ?? []))
    }
  }

  /** The node a parent is drawn as, when it is on the canvas as a Class of its own. */
  const drawnParent = (ref: IrClassRef): string | undefined => {
    const target = classTarget(ref, home)
    if (ref.origin === domain) return localIds.has(target) ? target : undefined
    if (shareOf(ref.origin) === 'whole' && context.declared.has(target))
      return context.drawn.has(target) ? target : undefined
    return taken.has(target) ? target : undefined
  }
  const children = [
    ...drawnLocal.map(({ name, member, module }) => ({
      id: classTarget(own(name), home),
      parents: member.extendsRefs ?? [],
      group: groupOf(module).group,
    })),
    ...[...foreign].map(([id, { ref, member }]) => ({
      id,
      parents: member?.extendsRefs ?? [],
      group: inPart(`domain.${ref.origin}`),
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

  // A module that declares only relationships is still a group: the Index lists them there.
  const modules = [...new Set([...drawnLocal, ...relationships].map(({ module }) => module))]
    .filter((module) => module !== ROOT_MODULE)
    .sort((left, right) => left.localeCompare(right))
  const groups: SceneGroup[] = modules.map((module) => ({
    id: inPart(`module.${module}`),
    ...(beside ? { anchor: `module.${module}`, ...filed } : {}),
    label: moduleLabel(module, SCHEMA_DIR),
    ...(hues.has(module) ? { hue: hues.get(module)! } : {}),
  }))

  const nodes: SceneNode[] = drawnLocal.map(({ name, member, module }) => {
    const id = classTarget(own(name), home)
    const properties = Object.keys(member.properties).length
    return {
      id,
      ...(beside ? { anchor: `class.${name}`, ...filed } : {}),
      kind: 'class',
      shape: 'card',
      label: name,
      ...groupOf(module),
      icon: classIcon(bundle, own(name), member),
      tone: 'node',
      counts: [
        { label: 'properties', value: properties },
        { label: 'relationships', value: 0 },
      ],
      badges: inheritanceBadges(bundle, member.extendsRefs ?? [], (ref) =>
        Boolean(drawnParent(ref)),
      ),
      rows: beside
        ? propertyRows(classRefKey(own(name)), member, {
            anchorClass: name,
            anchorDomain: beside.domainId,
          })
        : propertyRows(name, member),
      keywords: Object.keys(member.properties),
    }
  })

  for (const [id, { ref, member }] of foreign) {
    const group = inPart(`domain.${ref.origin}`)
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
      icon: classIcon(bundle, ref, member),
      tone: 'muted',
      counts: [
        { label: 'properties', value: Object.keys(member?.properties ?? {}).length },
        { label: 'relationships', value: 0 },
      ],
      // A Kernel base says what it is itself: `Identity` is an identity.
      badges: inheritanceBadges(bundle, parents, (parent) => Boolean(drawnParent(parent)), [
        ref,
        ...parents,
      ]),
      ...(member ? { rows: propertyRows(classRefKey(ref), member) } : {}),
    })
  }
  for (const origin of standIns) {
    nodes.push({
      id: standInId(origin),
      kind: 'domain',
      shape: 'card',
      label: originShort(origin),
      sublabel: 'Domain',
      icon: { glyph: 'module' },
      tone: 'muted',
      counts: [{ label: 'relationships', value: 0 }],
    })
  }

  if (!beside) {
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
  }
  return { nodes, links, groups, folded }
}

/** The hues Domains' areas wear: far apart, so two frames side by side never read as one. */
const AREA_HUES = [252, 150, 320, 30, 190, 280, 100, 0]

/**
 * A hue per Domain, in the order given: a Domain starts from the hue its origin names, so it
 * wears the same one on most canvases, and takes the next free one when a Domain before it
 * holds that hue, so no two areas of a canvas share one (while the palette lasts).
 */
export function areaHues(origins: readonly string[]): number[] {
  const taken = new Set<number>()
  return origins.map((origin) => {
    let at = 0
    for (const char of origin) at = (at * 31 + char.charCodeAt(0)) % AREA_HUES.length
    for (let tries = 0; tries < AREA_HUES.length && taken.has(at); tries++)
      at = (at + 1) % AREA_HUES.length
    taken.add(at)
    return AREA_HUES[at]!
  })
}

/**
 * The open Domain's Structure, with each other Domain drawn as `composition` says. Without a
 * Domain drawn whole the Scene has no areas; every Domain drawn as reached, it is the open
 * Domain's Structure alone.
 */
export function composeStructure(
  bundle: StudioSchemaBundle,
  options: LensOptions,
  composition: StructureComposition,
): Scene {
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
  const home = ir.domain
  const showInheritance = options.inheritance === true
  const whole: ComposedDomain[] = []
  for (const domain of composition.whole) {
    const origin = domain.bundle.ir?.domain
    if (origin === undefined || origin === home || composition.shares[origin] !== 'whole') continue
    if (whole.some((each) => each.bundle.ir!.domain === origin)) continue
    whole.push(domain)
  }
  const wholeOrigins = new Set(whole.map((domain) => domain.bundle.ir!.domain))
  const shareOf = (origin: string): Share =>
    origin === home || wholeOrigins.has(origin)
      ? 'whole'
      : composition.shares[origin] === 'hidden'
        ? 'hidden'
        : 'reached'

  const sources = [bundle, ...whole.map((domain) => domain.bundle)]
  const classes = sources.map(classesOf)
  const drawn = new Set<string>()
  const declared = new Set<string>()
  sources.forEach((source, index) => {
    const origin = source.ir!.domain
    for (const { name } of classes[index]!.local)
      declared.add(classTarget({ origin, kind: 'class', name }, home))
    for (const { name } of classes[index]!.drawn)
      drawn.add(classTarget({ origin, kind: 'class', name }, home))
  })
  const taken = new Set<string>()
  const parts = sources.map((source, index) =>
    projectPart(source, classes[index]!, {
      home,
      shareOf,
      drawn,
      declared,
      taken,
      inheritance: showInheritance,
      ...(index === 0
        ? {}
        : { beside: { domainId: source.domainId, label: whole[index - 1]!.label } }),
    }),
  )

  // Each node counts the relationships it takes part in, wherever they are declared.
  const links = parts.flatMap((part) => part.links)
  const relationshipCount = new Map<string, number>()
  for (const link of links) {
    if (link.kind !== 'relationship') continue
    for (const node of new Set([...link.from.nodes, ...link.to.nodes])) {
      relationshipCount.set(node, (relationshipCount.get(node) ?? 0) + 1)
    }
  }
  for (const node of parts.flatMap((part) => part.nodes)) {
    const count = node.counts?.find((each) => each.label === 'relationships')
    if (count) count.value = relationshipCount.get(node.id) ?? 0
  }

  const hidden = Object.entries(composition.shares)
    .filter(([origin, share]) => share === 'hidden' && origin !== home)
    .map(([origin]) => origin)
    .sort()
  const hues = areaHues([home, ...whole.map((domain) => domain.bundle.ir!.domain)])
  const areas: SceneArea[] =
    whole.length === 0
      ? []
      : [
          {
            id: areaId(home),
            origin: home,
            domainId: bundle.domainId,
            label: composition.home?.label ?? originShort(home),
            ...(composition.home?.version ? { version: composition.home.version } : {}),
            home: true,
            hue: hues[0]!,
          },
          ...whole.map((domain, index): SceneArea => ({
            id: areaId(domain.bundle.ir!.domain),
            origin: domain.bundle.ir!.domain,
            domainId: domain.bundle.domainId,
            label: domain.label,
            ...(domain.version ? { version: domain.version } : {}),
            hue: hues[index + 1]!,
          })),
        ]
  const inArea = <T extends object>(items: T[], index: number): T[] =>
    areas.length === 0 ? items : items.map((item) => ({ ...item, area: areas[index]!.id }))
  const nodes = parts.flatMap((part, index) => inArea(part.nodes, index))

  return {
    key: [
      'structure',
      bundle.domainId,
      bundle.renderFingerprint,
      showInheritance ? 'inheritance' : '',
      // every other Domain is drawn as reached unless the composition says otherwise
      'dependencies',
      ...hidden.map((origin) => `hidden=${origin}`),
      ...areas.map(
        (area, index) =>
          `area=${area.origin}@${sources[index]!.renderFingerprint}@${area.label}@${area.version ?? ''}`,
      ),
    ].join(':'),
    nodes,
    links: parts.flatMap((part, index) => inArea(part.links, index)),
    groups: parts.flatMap((part, index) => inArea(part.groups, index)),
    folded: parts.flatMap((part) => part.folded),
    ...(areas.length > 0 ? { areas } : {}),
    ...(nodes.length === 0 ? { empty: 'The Schema declares no Class.' } : {}),
  }
}
