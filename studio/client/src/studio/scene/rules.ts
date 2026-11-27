/**
 * Rules on the map: where each rule a Scene carries is read, what selecting rules lights, and
 * which folds a selection opens.
 *
 * A rule is a row of the card it sits on, or is carried by a link without a row. A rule said
 * alike another (`also`) is found at that one's row, and a rule a fold holds at the fold's row
 * and at its own row inside the fold. Selecting rules lights their rows, the folds that hold
 * them, the cards that draw them and the links that carry them, whole. One rule that walks
 * lights its walk too — each Class and relationship it reads that the map draws, in order —
 * and of a junction only the fans toward what it walks; a Policy selected lights its own rule's
 * walk over the rows of the sites it sits on.
 *
 * A fold the reader opens is laid out open (`withFoldsOpen`); a fold a selection reaches is
 * raised open over the map (`foldsOpenedBy`), and never moves a card.
 */

import type { Arrangement, JunctionBox } from './arrange'
import type { Neighbourhood } from './focus'
import type {
  Scene,
  SceneNode,
  SceneRule,
  SceneRuleMark,
  SceneRuleRef,
  SceneTone,
  SceneWalkStep,
} from './types'

import { linkName } from './types'

/** One place a rule is read. */
export interface RulePlace {
  /** the rule as its row draws it, or as its link carries it */
  rule: SceneRuleRef | SceneRule
  /** the node whose card draws it, or the link that carries it */
  owner: string
  on: 'node' | 'link'
  /** the row it is read at on a card while its fold is shut: its own, or its fold's */
  row?: string
  /** the row it is read at inside the fold that holds it, while the fold is open */
  inner?: string
}

const placed = new WeakMap<Scene, Map<string, RulePlace[]>>()

/** Every rule id the Scene carries — its own, those said alike, those a fold holds — and where each is read. */
export function rulePlaces(scene: Scene): ReadonlyMap<string, readonly RulePlace[]> {
  const known = placed.get(scene)
  if (known) return known
  const places = new Map<string, RulePlace[]>()
  const add = (id: string, place: RulePlace) => places.set(id, [...(places.get(id) ?? []), place])
  const own = (rule: SceneRuleRef, place: RulePlace) => {
    add(rule.id, place)
    for (const id of rule.also ?? []) add(id, place)
  }
  for (const node of scene.nodes)
    for (const rule of node.rules ?? []) {
      const place: RulePlace = { rule, owner: node.id, on: 'node', row: rule.id }
      own(rule, place)
      const held = new Set(rule.holds)
      for (const row of rule.rows ?? []) {
        own(row, { rule: row, owner: node.id, on: 'node', row: rule.id, inner: row.id })
        for (const id of [row.id, ...(row.also ?? [])]) held.delete(id)
      }
      for (const id of held) add(id, place)
    }
  for (const link of scene.links)
    for (const rule of link.rules ?? []) own(rule, { rule, owner: link.id, on: 'link' })
  placed.set(scene, places)
  return places
}

/** The rule a link's name is marked with, its mark, and what the mark says on hover. */
export interface RuleMark {
  id: string
  mark?: SceneRuleMark
  title: string
}

const marked = new WeakMap<Scene, Map<string, RuleMark>>()

/**
 * The marks before link names, by the id of the link, or of the trunk a link runs alone in:
 * its traverse Policy, where the link's tone says one is written.
 */
export function ruleMarks(scene: Scene, arrangement: Arrangement): ReadonlyMap<string, RuleMark> {
  let marks = marked.get(scene)
  if (!marks) {
    marks = new Map()
    for (const link of scene.links) {
      if (link.tone !== 'traverse') continue
      const rule = link.rules?.find((each) =>
        [each.id, ...(each.also ?? [])].some((id) => id.endsWith('#traverse')),
      )
      if (!rule) continue
      marks.set(link.id, {
        id: rule.id,
        ...(rule.marks?.[0] ? { mark: rule.marks[0] } : {}),
        title: `The traverse Policy of ${linkName(link)}: select to read it`,
      })
    }
    marked.set(scene, marks)
  }
  const byLabel = new Map(marks)
  for (const trunk of arrangement.trunks) {
    const mark = trunk.links.length === 1 ? marks.get(trunk.links[0]!) : undefined
    if (mark) byLabel.set(trunk.id, mark)
  }
  return byLabel
}

/** The node or link a rule id is read on first, when the Scene carries it. */
export function ruleOwner(scene: Scene, id: string): string | undefined {
  return rulePlaces(scene).get(id)?.[0]?.owner
}

/** A walk drawn for a selection the map draws no row for: a Policy's own (`SceneEntry`). */
export interface OwnWalk {
  walk: readonly string[]
  steps?: readonly SceneWalkStep[]
  tone: SceneTone
}

/** The walk of its own the Scene carries for `id`, a Policy listed in its Index. */
export function ownWalkOf(scene: Scene, id: string): OwnWalk | undefined {
  const entry = scene.index?.entries.find((each) => each.id === id)
  if (!entry?.walk) return undefined
  return {
    walk: entry.walk,
    ...(entry.steps ? { steps: entry.steps } : {}),
    tone: entry.tone ?? 'who',
  }
}

/**
 * What selecting the rules `ids` lights, or null when the Scene carries none of them nor
 * a walk of its own. Its
 * `rules` are the rows lit; `walk` is what one rule reads, in order: `own`'s, else that of the
 * one rule asked for.
 */
export function rulesLit(
  scene: Scene,
  arrangement: Arrangement,
  ids: readonly string[],
  own?: OwnWalk,
): Neighbourhood | null {
  const places = rulePlaces(scene)
  const found = ids.flatMap((id) => places.get(id) ?? [])
  if (found.length === 0 && !own) return null
  const result: Neighbourhood = {
    focus: ids.join(' '),
    boxes: new Set(),
    nodes: new Set(),
    links: new Set(),
    trunks: new Set(),
    ribbons: new Set(),
    fans: new Set(),
    regions: new Set(),
    rules: new Set(),
  }
  const junctions = new Map(
    arrangement.boxes.flatMap((box) =>
      box.kind === 'junction' ? [[box.id, box] as [string, JunctionBox]] : [],
    ),
  )
  const linkById = new Map(scene.links.map((link) => [link.id, link]))
  const nodeIds = new Set(scene.nodes.map((node) => node.id))
  const lightNode = (id: string) => {
    result.nodes.add(id)
    const box = arrangement.boxOf.get(id)
    if (box) result.boxes.add(box)
  }
  /** A link, and of a junction it meets the fans toward `toward` — all of them when absent. */
  const lightLink = (id: string, toward?: ReadonlySet<string>) => {
    const link = linkById.get(id)
    if (!link) return
    result.links.add(id)
    if (!toward) for (const node of [...link.from.nodes, ...link.to.nodes]) result.nodes.add(node)
    const place = arrangement.linkPlace.get(id)
    if (!place) return
    if (place.box) result.boxes.add(place.box)
    if (place.trunk) result.trunks.add(place.trunk)
    if (place.ribbon) result.ribbons.add(place.ribbon)
    for (const at of [place.from, place.to]) {
      if (!at) continue
      result.boxes.add(at)
      const junction = junctions.get(at)
      if (!junction) continue
      for (const box of junction.accepts) {
        if (toward && !toward.has(box)) continue
        result.fans.add(`fan:${junction.id}|${box}`)
        result.boxes.add(box)
      }
    }
  }

  // A rule asked for by its own id (a function's call rule, at the row of the rule it
  // shares) lights its name in that row; a row lit for its fold lights no name.
  result.named = new Set(ids.filter((id) => places.has(id)))
  for (const place of found) {
    if (place.row) result.rules!.add(place.row)
    if (place.inner) result.rules!.add(place.inner)
    // A fold lights the rows it holds with it.
    else
      for (const row of 'rows' in place.rule ? (place.rule.rows ?? []) : [])
        result.rules!.add(row.id)
    if (place.on === 'node') lightNode(place.owner)
    else lightLink(place.owner)
  }

  const lone = ids.length === 1 ? found.find((place) => place.rule.walk?.length)?.rule : undefined
  const walking: OwnWalk | undefined =
    own ??
    (lone
      ? {
          walk: lone.walk!,
          ...(lone.steps ? { steps: lone.steps } : {}),
          tone: lone.op ?? lone.tone,
        }
      : undefined)
  if (walking) {
    const drawn = (id: string) => nodeIds.has(id) || linkById.has(id)
    const walked = walking.walk.filter(drawn)
    const toward = new Set(
      [...walked, ...found.map((place) => place.owner)].flatMap((id) => {
        const box = nodeIds.has(id) ? arrangement.boxOf.get(id) : undefined
        return box ? [box] : []
      }),
    )
    for (const id of walked) {
      if (nodeIds.has(id)) lightNode(id)
      else lightLink(id, toward)
    }
    if (walked.length > 0)
      result.walk = {
        ids: walked,
        // A step the map does not draw leaves its number out, never renumbers the others.
        steps: (walking.steps ?? []).filter((step) => drawn(step.id)),
        tone: walking.tone,
      }
  }
  return result
}

/**
 * The folds a selection of the rules `ids` opens, by the card that draws each: those holding
 * one of them, and any of them that is a fold itself.
 */
export function foldsOpenedBy(
  scene: Scene,
  ids: readonly string[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const places = rulePlaces(scene)
  const opened = new Map<string, Set<string>>()
  for (const id of ids)
    for (const place of places.get(id) ?? []) {
      if (place.on !== 'node' || !place.row) continue
      const fold = place.inner !== undefined || 'rows' in place.rule ? place.row : undefined
      const row = fold === undefined ? undefined : findRow(scene, place.owner, fold)
      if (!row?.rows || row.open) continue
      opened.set(place.owner, new Set([...(opened.get(place.owner) ?? []), fold!]))
    }
  return opened
}

const findRow = (scene: Scene, owner: string, id: string) =>
  scene.nodes.find((node) => node.id === owner)?.rules?.find((row) => row.id === id)

/**
 * A card with the folds `opened` raised open, as the canvas draws it over the map: the same
 * card with those folds' rows drawn, its layout untouched.
 */
export function cardWithFoldsRaised(node: SceneNode, opened: ReadonlySet<string>): SceneNode {
  if (!node.rules?.some((row) => opened.has(row.id) && !row.open)) return node
  return {
    ...node,
    rules: node.rules.map((row) =>
      opened.has(row.id) && !row.open ? { ...row, raised: true } : row,
    ),
  }
}

const withOpen = new WeakMap<Scene, Map<string, Scene>>()

/**
 * The Scene with the folds the reader opened (`opened`, by fold id) open: each laid out with
 * its card, so the map makes room for it. Its key says which are open.
 */
export function withFoldsOpen(scene: Scene, opened: ReadonlySet<string>): Scene {
  const folds = new Set(
    scene.nodes.flatMap((node) =>
      (node.rules ?? []).filter((row) => row.rows && opened.has(row.id)).map((row) => row.id),
    ),
  )
  if (folds.size === 0) return scene
  const key = [...folds].sort().join(',')
  let known = withOpen.get(scene)
  if (!known) {
    known = new Map()
    withOpen.set(scene, known)
  }
  const found = known.get(key)
  if (found) return found
  const open: Scene = {
    ...scene,
    key: `${scene.key}|open:${key}`,
    nodes: scene.nodes.map((node) =>
      node.rules?.some((row) => folds.has(row.id))
        ? {
            ...node,
            rules: node.rules.map((row) => (folds.has(row.id) ? { ...row, open: true } : row)),
          }
        : node,
    ),
  }
  known.set(key, open)
  return open
}
