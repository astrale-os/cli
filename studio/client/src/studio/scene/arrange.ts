/**
 * The canvas grammar, applied to any Scene: which boxes are drawn and how every link
 * reaches them. Pure and deterministic — the same Scene and state always arrange the same
 * way, whatever is selected or hovered.
 *
 * - One thing, one mark: a node is one box; a link is one trunk member. Every link is
 *   drawn.
 * - An end that accepts exactly one drawn box is attached to it. An end that accepts
 *   several meets a junction — one small box, "one of" — that fans out to each of them;
 *   ends that accept the same boxes share one junction.
 * - Links of one kind between the same two ends (boxes or junctions) travel as one trunk,
 *   whatever their direction; a link of another kind (`extends` beside a relationship)
 *   keeps its own.
 * - A collapsed group is one box: its members' ends land on it, and links inside it are
 *   counted on it instead of drawn. A group of rows is one box open or collapsed: its
 *   members are its rows, and their ends land on it either way.
 * - An expanded group of one box is not framed: the box carries the group's name, unless
 *   its own name already says it.
 * - In a Scene of ribbons, the links between two boxes of different columns travel as one
 *   ribbon instead of a trunk; any other link — within a column, dashed, latent — is drawn
 *   on its own.
 * - The cost guard bounds what is drawn and records every fold.
 */

import type {
  Scene,
  SceneBadge,
  SceneBand,
  SceneFold,
  SceneGroup,
  SceneLink,
  SceneNode,
  SceneTone,
} from './types'

export interface ArrangeState {
  /** Groups drawn as a single box. */
  collapsed: ReadonlySet<string>
}

export interface ArrangeLimits {
  boxes: number
  links: number
}

/** Above these the canvas stops drawing and says what it folded. */
export const ARRANGE_LIMITS: ArrangeLimits = { boxes: 320, links: 960 }

/** A Scene with more nodes than this opens with its groups collapsed. */
export const COLLAPSE_ABOVE = 36

export const JUNCTION_PREFIX = 'junction:'

export type Box =
  | {
      kind: 'node'
      id: string
      node: SceneNode
      group?: string
      /** its group's name, when the group is drawn as this box alone: the box says it */
      caption?: string
      /** its group's badges, when the group is drawn as this box alone: said with its caption */
      captionBadges?: SceneBadge[]
    }
  | {
      kind: 'group'
      id: string
      group: SceneGroup
      /** the scene nodes it stands for */
      members: string[]
      /** links that run between two of its members, counted on it while it is collapsed */
      inner: string[]
      /** the first column any member stands in, when the Scene ranks its nodes */
      column?: number
      /** a group of rows drawn open: its members' rows show */
      open?: boolean
      /** a group of rows: its member nodes, in scene order, each drawn as one of its rows */
      rows?: SceneNode[]
    }
  | {
      kind: 'junction'
      /** `junction:<box>,<box>…`, the accepted boxes in sorted order */
      id: string
      /** the boxes it fans out to, in arrangement order */
      accepts: string[]
      /** the links that meet it, in scene order */
      links: string[]
      /** the expanded group that holds every accepted box, when one does */
      group?: string
    }

export type JunctionBox = Extract<Box, { kind: 'junction' }>

export interface Trunk {
  /** `trunk:<kind>:<end>|<end>`, the two ends (boxes or junctions) in sorted order */
  id: string
  from: string
  /** equal to `from` for a loop */
  to: string
  /** member link ids, in scene order */
  links: string[]
}

/** One line from a junction to a box it accepts. */
export interface Fan {
  /** `fan:<junction>|<box>` */
  id: string
  junction: string
  box: string
  /**
   * The fan runs from the box into the junction: the junction's first link leaves from it,
   * so the accepted boxes sit upstream of the link, as its `from` end.
   */
  inward: boolean
}

export interface Region {
  id: string
  group: SceneGroup
  /** box ids, junctions included */
  members: string[]
}

/**
 * The links between two boxes of different columns, in a Scene of ribbons: one band at rest,
 * as thick as the node pairs it carries, striped by what its links say.
 */
export interface Ribbon {
  /** `ribbon:<end>|<end>`, the two ends (boxes or junctions) in sorted order */
  id: string
  /** the end its first link leaves from */
  from: string
  to: string
  /** member link ids, in scene order */
  links: string[]
  /** how many distinct pairs of scene nodes its links join */
  carriers: number
  /** how many of its links say each tone, in stripe order */
  stripes: { tone: SceneTone; count: number }[]
  /** every link it carries reaches a hub */
  ambient: boolean
}

/** Where one scene link is drawn. */
export interface LinkPlace {
  trunk?: string
  ribbon?: string
  /** the box or junction its `from` end is drawn at */
  from?: string
  /** the box or junction its `to` end is drawn at */
  to?: string
  /** the collapsed group it runs inside, counted there instead of drawn */
  box?: string
}

export interface Arrangement {
  /** Equal keys guarantee equal arrangements. */
  key: string
  /** how links travel at rest, as the Scene asks */
  lines: 'routes' | 'ribbons'
  /** which way links lead, as the Scene asks */
  flow: 'across' | 'either'
  bands: SceneBand[]
  boxes: Box[]
  regions: Region[]
  trunks: Trunk[]
  ribbons: Ribbon[]
  fans: Fan[]
  /** scene node or link id → the box that stands for it; every box id maps to itself */
  boxOf: ReadonlyMap<string, string>
  linkPlace: ReadonlyMap<string, LinkPlace>
  folded: SceneFold[]
}

/** The groups a Scene opens with collapsed: all of them once it is too large to read whole. */
export function defaultCollapsed(scene: Scene, above = COLLAPSE_ABOVE): Set<string> {
  if (scene.nodes.length <= above || scene.groups.length < 2) return new Set()
  return new Set(scene.groups.map((group) => group.id))
}

export const isJunction = (id: string) => id.startsWith(JUNCTION_PREFIX)

/** The order a ribbon's stripes read in: what changes first, what reaches out after. */
const STRIPE_ORDER: readonly SceneTone[] = [
  'create',
  'update',
  'transition',
  'link',
  'unlink',
  'delete',
  'call',
  'warning',
  'fn',
  'node',
  'edge',
  'view',
  'core',
  'muted',
]

/** The arrangement key of a Scene with these groups collapsed. */
export const arrangementKey = (scene: Scene, collapsed: ReadonlySet<string>) =>
  `${scene.key}|${[...collapsed]
    .filter((id) => scene.groups.some((group) => group.id === id))
    .sort(compare)
    .join(',')}`

const stem = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/s$/, '')

/** Whether a node's name or qualifier already says a group's name: `Host` in `Host`. */
export const namesGroup = (label: string, node: SceneNode) =>
  stem(label) === stem(node.label) ||
  (node.sublabel !== undefined && stem(label) === stem(node.sublabel))

/** Whether a node's name alone already says a group's name. */
export const titledAs = (label: string, node: SceneNode) => stem(label) === stem(node.label)

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)

export function arrange(
  scene: Scene,
  state: ArrangeState,
  limits: ArrangeLimits = ARRANGE_LIMITS,
): Arrangement {
  const folded: SceneFold[] = [...scene.folded]
  const groups = new Map(scene.groups.map((group) => [group.id, group]))
  const collapsed = new Set([...state.collapsed].filter((id) => groups.has(id)))

  const boxes: Box[] = []
  const boxIndex = new Map<string, Box>()
  const boxOf = new Map<string, string>()
  const addBox = (box: Box) => {
    boxes.push(box)
    boxIndex.set(box.id, box)
  }

  // Nodes first, in scene order; a collapsed group's box, or a group of rows, takes the place
  // of its first member.
  let droppedNodes = 0
  for (const node of scene.nodes) {
    const group = node.group && groups.has(node.group) ? node.group : undefined
    const rows = group !== undefined && groups.get(group)!.members === 'rows'
    if (group && (rows || collapsed.has(group))) {
      const existing = boxIndex.get(group)
      if (existing?.kind === 'group') {
        existing.members.push(node.id)
        existing.rows?.push(node)
        if (node.column !== undefined)
          existing.column = Math.min(existing.column ?? node.column, node.column)
      } else if (boxes.length < limits.boxes) {
        addBox({
          kind: 'group',
          id: group,
          group: groups.get(group)!,
          members: [node.id],
          inner: [],
          ...(node.column !== undefined ? { column: node.column } : {}),
          ...(rows ? { rows: [node] } : {}),
          ...(rows && !collapsed.has(group) ? { open: true } : {}),
        })
      } else {
        droppedNodes += 1
        continue
      }
      boxOf.set(node.id, group)
      continue
    }
    if (boxes.length >= limits.boxes) {
      droppedNodes += 1
      continue
    }
    addBox({ kind: 'node', id: node.id, node, ...(group ? { group } : {}) })
    boxOf.set(node.id, node.id)
  }
  if (droppedNodes > 0) {
    folded.push({
      label: 'Nodes',
      count: droppedNodes,
      reason: 'over the canvas budget — search the Index or isolate a neighbourhood (F)',
    })
  }

  const order = new Map(boxes.map((box, index) => [box.id, index]))
  /** The drawn boxes an end accepts, in arrangement order. */
  const acceptedBy = (link: SceneLink, side: 'from' | 'to'): string[] =>
    [...new Set(link[side].nodes.flatMap((node) => boxOf.get(node) ?? []))].sort(
      (left, right) => order.get(left)! - order.get(right)!,
    )

  const junctions = new Map<string, JunctionBox>()
  const fans = new Map<string, Fan>()
  /** The box or junction an end is drawn at, given the boxes it accepts. */
  const endAt = (link: SceneLink, side: 'from' | 'to', accepted: string[]): string => {
    if (accepted.length === 1) return accepted[0]!
    const id = `${JUNCTION_PREFIX}${[...accepted].sort(compare).join(',')}`
    const junction = junctions.get(id)
    if (junction) {
      if (!junction.links.includes(link.id)) junction.links.push(link.id)
      return id
    }
    const homes = new Set(
      accepted.map((box) => {
        const found = boxIndex.get(box)
        return found?.kind === 'node' ? found.group : undefined
      }),
    )
    const group = homes.size === 1 ? [...homes][0] : undefined
    junctions.set(id, {
      kind: 'junction',
      id,
      accepts: accepted,
      links: [link.id],
      ...(group ? { group } : {}),
    })
    for (const box of accepted) {
      const fan = `fan:${id}|${box}`
      fans.set(fan, { id: fan, junction: id, box, inward: side === 'from' })
    }
    return id
  }

  const trunks = new Map<string, Trunk>()
  const ribbons = new Map<string, Ribbon & { pairs: Set<string> }>()
  const linkPlace = new Map<string, LinkPlace>()
  const lines = scene.lines ?? 'routes'
  const columnOf = (id: string) => {
    const box = boxIndex.get(id)
    return box?.kind === 'node' ? box.node.column : box?.kind === 'group' ? box.column : undefined
  }
  /** Whether a link between these two ends travels in their ribbon. */
  const ribboned = (link: SceneLink, from: string, to: string) => {
    if (lines !== 'ribbons' || link.latent || link.dashed || from === to) return false
    const [left, right] = [columnOf(from), columnOf(to)]
    return left === undefined || right === undefined || left !== right
  }
  let drawnLinks = 0
  let droppedLinks = 0

  for (const link of scene.links) {
    const fromBoxes = acceptedBy(link, 'from')
    const toBoxes = acceptedBy(link, 'to')
    if (fromBoxes.length === 0 || toBoxes.length === 0) {
      // Only an end whose every node went over the box budget is left with nothing drawn.
      droppedLinks += 1
      continue
    }
    const lone = fromBoxes.length === 1 && toBoxes.length === 1 ? fromBoxes[0] : undefined
    const inner = lone !== undefined && lone === toBoxes[0] ? boxIndex.get(lone) : undefined
    if (inner?.kind === 'group' && !inner.open) {
      // Both ends inside one collapsed group: counted on it, not drawn as a loop.
      inner.inner.push(link.id)
      linkPlace.set(link.id, { box: inner.id, from: inner.id, to: inner.id })
      boxOf.set(link.id, inner.id)
      continue
    }
    if (drawnLinks >= limits.links) {
      droppedLinks += 1
      continue
    }
    drawnLinks += 1
    const from = endAt(link, 'from', fromBoxes)
    const to = endAt(link, 'to', toBoxes)
    const [left, right] = compare(from, to) <= 0 ? [from, to] : [to, from]
    if (ribboned(link, from, to)) {
      const id = `ribbon:${left}|${right}`
      const ribbon =
        ribbons.get(id) ??
        ribbons
          .set(id, {
            id,
            from,
            to,
            links: [],
            carriers: 0,
            stripes: [],
            ambient: true,
            pairs: new Set(),
          })
          .get(id)!
      ribbon.links.push(link.id)
      ribbon.pairs.add(`${link.from.nodes.join(',')}|${link.to.nodes.join(',')}`)
      const tone = link.tone ?? 'edge'
      const stripe = ribbon.stripes.find((one) => one.tone === tone)
      if (stripe) stripe.count += 1
      else ribbon.stripes.push({ tone, count: 1 })
      ribbon.ambient &&= link.ambient === true
      linkPlace.set(link.id, { ribbon: id, from, to })
      continue
    }
    if (lines === 'ribbons') {
      // Drawn on its own, as a curve between its ends.
      linkPlace.set(link.id, { from, to })
      continue
    }
    const id = `trunk:${link.kind}:${left}|${right}`
    const trunk = trunks.get(id)
    if (trunk) trunk.links.push(link.id)
    // The first member's direction is the trunk's: layered layout reads it left to right.
    else trunks.set(id, { id, from, to, links: [link.id] })
    linkPlace.set(link.id, { trunk: id, from, to })
  }
  if (droppedLinks > 0) {
    folded.push({
      label: 'Links',
      count: droppedLinks,
      reason: 'over the canvas budget — isolate a neighbourhood (F) to read them',
    })
  }

  // Junctions follow the boxes they serve, in the order they were first met.
  for (const junction of junctions.values()) {
    addBox(junction)
    boxOf.set(junction.id, junction.id)
  }

  const regions: Region[] = []
  for (const group of scene.groups) {
    if (collapsed.has(group.id)) continue
    const members = boxes.filter((box) => box.kind !== 'group' && box.group === group.id)
    const [only] = members
    if (members.length === 1 && only?.kind === 'node') {
      only.caption = group.label
      if (group.badges && group.badges.length > 0) only.captionBadges = group.badges
      continue
    }
    if (members.length > 0)
      regions.push({ id: group.id, group, members: members.map((box) => box.id) })
  }

  for (const [id, box] of boxIndex) if (box.kind !== 'group') boxOf.set(id, id)

  return {
    key: arrangementKey(scene, collapsed),
    lines,
    flow: scene.flow ?? 'across',
    bands: scene.bands ?? [],
    boxes,
    regions,
    trunks: [...trunks.values()],
    ribbons: [...ribbons.values()].map(({ pairs, ...ribbon }) => ({
      ...ribbon,
      carriers: pairs.size,
      stripes: ribbon.stripes.sort(
        (left, right) => STRIPE_ORDER.indexOf(left.tone) - STRIPE_ORDER.indexOf(right.tone),
      ),
    })),
    fans: [...fans.values()],
    boxOf,
    linkPlace,
    folded,
  }
}
