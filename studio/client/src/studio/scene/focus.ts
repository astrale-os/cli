/**
 * Focus: what lights up around one thing, and the smaller Scene `F` isolates.
 *
 * A neighbourhood is read from the Scene's links, never from what happens to be drawn:
 * selecting a Class lights every link that accepts it, and through any pill those links reach
 * — a step between cards — the links that go on from it. A link that reaches the Class
 * through a junction lights the junction and the one fan to the Class; the focus at the
 * link's other end — or the junction, or the link itself — opens the whole fan.
 */

import type { Arrangement, JunctionBox } from './arrange'
import type { Scene, SceneLink, SceneTone, SceneWalkStep } from './types'

export interface Neighbourhood {
  /** the id it was computed for */
  focus: string
  /** boxes and junctions */
  boxes: Set<string>
  /** scene link ids */
  links: Set<string>
  /** scene nodes: the focus's own and those its links reach */
  nodes: Set<string>
  /** trunks that open into their members */
  trunks: Set<string>
  /** ribbons carrying a lit link */
  ribbons: Set<string>
  /** fan ids */
  fans: Set<string>
  /** expanded groups that are themselves the focus */
  regions: Set<string>
  /** for rules: the rows lit on their cards (see `rulesLit`) */
  rules?: Set<string>
  /** for rules: those asked for by their own id, so a row naming what each guards lights its name */
  named?: Set<string>
  /**
   * for one rule that walks: what it reads that the map draws, in order; the steps numbered
   * beside what the map draws, by the rule's own numbers; and the rule's tone: its operation's,
   * else a constraint's
   */
  walk?: { ids: string[]; steps: SceneWalkStep[]; tone: SceneTone }
}

const touches = (link: SceneLink, node: string) =>
  link.from.nodes.includes(node) || link.to.nodes.includes(node)

/** The scene nodes `id` stands for: itself, or a group's members. */
function focusNodes(scene: Scene, id: string): Set<string> {
  const members = scene.nodes.filter((node) => node.group === id).map((node) => node.id)
  if (members.length > 0) return new Set(members)
  return scene.nodes.some((node) => node.id === id) ? new Set([id]) : new Set()
}

/**
 * `links` and, past every pill they reach, the links that go on from it the way they came: a
 * pill is a step between cards, so a card's focus lights through it to the cards beyond —
 * never back to the other cards that reach the same pill.
 */
function throughPills(scene: Scene, own: ReadonlySet<string>, links: SceneLink[]): SceneLink[] {
  const pills = new Set(scene.nodes.flatMap((node) => (node.shape === 'pill' ? [node.id] : [])))
  if (pills.size === 0) return links
  const result = [...links]
  const seen = new Set(links.map((link) => link.id))
  const passed = new Set(own)
  for (let index = 0; index < result.length; index += 1) {
    const current = result[index]!
    for (const [near, far] of [
      ['from', 'to'],
      ['to', 'from'],
    ] as const) {
      if (!current[near].nodes.some((node) => passed.has(node))) continue
      for (const pill of current[far].nodes) {
        if (!pills.has(pill) || passed.has(pill)) continue
        passed.add(pill)
        for (const onward of scene.links)
          if (!seen.has(onward.id) && onward[near].nodes.includes(pill)) {
            seen.add(onward.id)
            result.push(onward)
          }
      }
    }
  }
  return result
}

export function neighbourhood(
  scene: Scene,
  arrangement: Arrangement,
  id: string,
): Neighbourhood | null {
  const junctions = new Map(
    arrangement.boxes.flatMap((box) => (box.kind === 'junction' ? [[box.id, box] as const] : [])),
  )
  const junction = junctions.get(id)
  const link = junction ? undefined : scene.links.find((candidate) => candidate.id === id)
  const own = link || junction ? new Set<string>() : focusNodes(scene, id)
  if (!link && !junction && own.size === 0) return null

  const result: Neighbourhood = {
    focus: id,
    boxes: new Set(),
    nodes: new Set(own),
    links: new Set(),
    trunks: new Set(),
    ribbons: new Set(),
    fans: new Set(),
    regions: new Set(),
  }
  if (arrangement.regions.some((region) => region.id === id)) result.regions.add(id)
  for (const node of own) {
    const box = arrangement.boxOf.get(node)
    if (box) result.boxes.add(box)
  }
  const ownBoxes = new Set(result.boxes)
  const fan = (at: JunctionBox, box: string) => {
    result.fans.add(`fan:${at.id}|${box}`)
    result.boxes.add(box)
  }
  if (junction) {
    result.boxes.add(junction.id)
    for (const box of junction.accepts) fan(junction, box)
  }

  const linkById = new Map(scene.links.map((candidate) => [candidate.id, candidate]))
  const links = junction
    ? junction.links.flatMap((linkId) => linkById.get(linkId) ?? [])
    : link
      ? [link]
      : throughPills(
          scene,
          own,
          scene.links.filter((candidate) => [...own].some((node) => touches(candidate, node))),
        )
  for (const current of links) {
    result.links.add(current.id)
    for (const node of [...current.from.nodes, ...current.to.nodes]) result.nodes.add(node)
    const place = arrangement.linkPlace.get(current.id)
    if (!place) continue
    if (place.box) result.boxes.add(place.box)
    if (place.trunk) result.trunks.add(place.trunk)
    if (place.ribbon) result.ribbons.add(place.ribbon)
    for (const side of ['from', 'to'] as const) {
      const at = place[side]
      if (!at) continue
      result.boxes.add(at)
      const end = junctions.get(at)
      if (!end) continue
      // The focus at this end reaches its own boxes through the junction; from anywhere
      // else the whole set is what the link may reach.
      const other = side === 'from' ? 'to' : 'from'
      const here = current[side].nodes.some((node) => own.has(node))
      const there = current[other].nodes.some((node) => own.has(node))
      if (here && !there)
        for (const box of end.accepts.filter((box) => ownBoxes.has(box))) fan(end, box)
      else for (const box of end.accepts) fan(end, box)
    }
  }
  return result
}

/**
 * Which links a set of things lights: `among`, every link between two of them; `named`, only
 * the links it names — the Edges that prove a verdict, and not one more.
 */
export type LitLinks = 'among' | 'named'

/**
 * What lights for a selection the scene does not draw, through the things that stand for it
 * here: their boxes, and the links among them (or only those named: `LitLinks`) — never a link
 * out to the rest. A link that stands in itself lights whole, as when it is selected.
 */
export function standingFor(
  scene: Scene,
  arrangement: Arrangement,
  ids: readonly string[],
  links: LitLinks = 'among',
): Neighbourhood | null {
  const result: Neighbourhood = {
    focus: ids.join(' '),
    boxes: new Set(),
    nodes: new Set(),
    links: new Set(),
    trunks: new Set(),
    ribbons: new Set(),
    fans: new Set(),
    regions: new Set(),
  }
  const own = new Set<string>()
  for (const id of ids) {
    for (const node of focusNodes(scene, id)) own.add(node)
    if (arrangement.regions.some((region) => region.id === id)) result.regions.add(id)
  }
  for (const node of own) {
    result.nodes.add(node)
    const box = arrangement.boxOf.get(node)
    if (box) result.boxes.add(box)
  }
  const ownBoxes = new Set(result.boxes)
  const junctions = new Map(
    arrangement.boxes.flatMap((box) => (box.kind === 'junction' ? [[box.id, box] as const] : [])),
  )
  const named = new Set(ids)
  for (const link of scene.links) {
    const whole = named.has(link.id)
    const among =
      links === 'among' &&
      link.from.nodes.some((node) => own.has(node)) &&
      link.to.nodes.some((node) => own.has(node))
    if (!whole && !among) continue
    result.links.add(link.id)
    if (whole) for (const node of [...link.from.nodes, ...link.to.nodes]) result.nodes.add(node)
    const place = arrangement.linkPlace.get(link.id)
    if (!place) continue
    if (place.trunk) result.trunks.add(place.trunk)
    if (place.ribbon) result.ribbons.add(place.ribbon)
    for (const at of [place.from, place.to]) {
      if (!at) continue
      result.boxes.add(at)
      const junction = junctions.get(at)
      if (!junction) continue
      for (const box of junction.accepts) {
        if (!whole && !ownBoxes.has(box)) continue
        result.fans.add(`fan:${junction.id}|${box}`)
        result.boxes.add(box)
      }
    }
  }
  return result.boxes.size > 0 ? result : null
}

/**
 * Two lightings as one: whatever either lights, and `also`'s walk, else `lit`'s. What a panel
 * walks is lit with the selection or the spotlight it is read beside, never instead of it.
 */
export function litTogether(lit: Neighbourhood | null, also: Neighbourhood): Neighbourhood {
  if (!lit) return also
  const both = (a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined) =>
    new Set([...(a ?? []), ...(b ?? [])])
  const rules = lit.rules || also.rules ? both(lit.rules, also.rules) : undefined
  const named = lit.named || also.named ? both(lit.named, also.named) : undefined
  const walk = also.walk ?? lit.walk
  return {
    focus: lit.focus,
    boxes: both(lit.boxes, also.boxes),
    links: both(lit.links, also.links),
    nodes: both(lit.nodes, also.nodes),
    trunks: both(lit.trunks, also.trunks),
    ribbons: both(lit.ribbons, also.ribbons),
    fans: both(lit.fans, also.fans),
    regions: both(lit.regions, also.regions),
    ...(rules ? { rules } : {}),
    ...(named ? { named } : {}),
    ...(walk ? { walk } : {}),
  }
}

/**
 * The Scene `F` shows: the focus, the links that touch it, and every node those links
 * accept — laid out afresh, so a neighbourhood scattered across a large map reads as one.
 */
export function isolateScene(scene: Scene, id: string): Scene | null {
  const link = scene.links.find((candidate) => candidate.id === id)
  const own = link ? new Set<string>() : focusNodes(scene, id)
  if (!link && own.size === 0) return null
  const links = link
    ? [link]
    : scene.links.filter((candidate) => [...own].some((node) => touches(candidate, node)))
  const keep = new Set(own)
  for (const current of links) {
    for (const node of [...current.from.nodes, ...current.to.nodes]) keep.add(node)
  }
  const nodes = scene.nodes.filter((node) => keep.has(node.id))
  const groups = new Set(nodes.flatMap((node) => (node.group ? [node.group] : [])))
  return {
    ...scene,
    key: `${scene.key}|isolate:${id}`,
    nodes,
    links,
    groups: scene.groups.filter((group) => groups.has(group.id)),
    folded: [],
  }
}

/**
 * The groups of rows a focus on `id` opens: those holding a node its links reach, so every
 * line it lights leaves a row that shows. A group is never opened by its own focus.
 */
export function openedBy(scene: Scene, id: string | undefined): Set<string> {
  const opened = new Set<string>()
  if (!id) return opened
  const rows = new Set(
    scene.groups.flatMap((group) => (group.members === 'rows' ? [group.id] : [])),
  )
  if (rows.size === 0) return opened
  const own = scene.groups.some((group) => group.id === id)
    ? new Set<string>()
    : focusNodes(scene, id)
  const link = scene.links.find((candidate) => candidate.id === id)
  const links = link
    ? [link]
    : throughPills(
        scene,
        own,
        scene.links.filter((candidate) => [...own].some((node) => touches(candidate, node))),
      )
  const reached = new Set(own)
  for (const current of links)
    for (const node of [...current.from.nodes, ...current.to.nodes]) reached.add(node)
  for (const node of scene.nodes)
    if (reached.has(node.id) && node.group && rows.has(node.group)) opened.add(node.group)
  return opened
}
