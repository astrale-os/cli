/**
 * The Index: the current Scene as a list. It has no model of its own — the same nodes and
 * links, grouped as the canvas groups them, in the Scene's order — so whatever a lens
 * draws, the Index lists, and a selection means the same thing in both. A Scene that lists
 * other things than it draws (`Scene.index`: the Rules lens's Policies and constraints) is
 * listed by those entries and their groups instead.
 */

import type { RuleOp, Scene, SceneGlyph, SceneTone } from '../scene/types'

import { linkName } from '../scene/types'

export interface IndexGroupRow {
  type: 'group'
  id: string
  label: string
  hue?: number
  /** items listed under it, after filtering */
  count: number
  collapsed: boolean
}

export interface IndexItemRow {
  type: 'item'
  /** the scene id — a selection target */
  id: string
  anchor?: string
  /** The Domain a comment on the row is filed under, when not the canvas's (`SceneNode`). */
  anchorDomain?: string
  group?: string
  kind: string
  label: string
  sublabel?: string
  tone?: SceneTone
  icon?: { svg?: string; glyph?: SceneGlyph }
  /** read at its end: the operations a Policy decides, each by its own mark */
  ops?: RuleOp[]
  /** a keyword the query matched, when it was not the label itself */
  matched?: string
}

export type IndexRow = IndexGroupRow | IndexItemRow

export interface IndexFilter {
  query: string
  /** kinds left out */
  hidden: ReadonlySet<string>
}

export interface IndexKind {
  kind: string
  count: number
}

/** Every kind the Index lists for this Scene, in order of first appearance. */
export function indexKinds(scene: Scene): IndexKind[] {
  const counts = new Map<string, number>()
  for (const item of listedItems(scene)) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1)
  return [...counts].map(([kind, count]) => ({ kind, count }))
}

/**
 * What the Index lists: the Scene's own entries when it gives them, else every node, and
 * every link that is a thing of its own.
 */
function listedItems(scene: Scene): IndexItemRow[] {
  if (scene.index)
    return scene.index.entries.map((entry) => ({
      type: 'item',
      id: entry.id,
      ...(entry.anchor ? { anchor: entry.anchor } : {}),
      ...(entry.group ? { group: entry.group } : {}),
      kind: entry.kind,
      label: entry.label,
      ...(entry.sublabel ? { sublabel: entry.sublabel } : {}),
      ...(entry.tone ? { tone: entry.tone } : {}),
      ...(entry.icon ? { icon: entry.icon } : {}),
      ...(entry.ops?.length ? { ops: entry.ops } : {}),
    }))
  const nodes: IndexItemRow[] = scene.nodes.map((node) => ({
    type: 'item',
    id: node.id,
    ...(node.anchor ? { anchor: node.anchor } : {}),
    ...(node.anchorDomain ? { anchorDomain: node.anchorDomain } : {}),
    ...(node.group ? { group: node.group } : {}),
    kind: node.kind,
    label: node.label,
    ...(node.sublabel ? { sublabel: node.sublabel } : {}),
    ...(node.tone ? { tone: node.tone } : {}),
    ...(node.icon ? { icon: node.icon } : {}),
  }))
  // A link that only draws something another item owns (`opens`) is not listed twice.
  const links: IndexItemRow[] = scene.links
    .filter((link) => link.opens === undefined)
    .map((link) => ({
      type: 'item',
      id: link.id,
      ...(link.anchor ? { anchor: link.anchor } : {}),
      ...(link.group ? { group: link.group } : {}),
      kind: link.kind,
      label: linkName(link),
      ...(link.name !== undefined && link.label ? { sublabel: link.label } : {}),
      ...(link.tone ? { tone: link.tone } : {}),
      icon: { glyph: 'relationship' },
    }))
  return [...nodes, ...links]
}

function keywordsOf(scene: Scene): Map<string, string[]> {
  const keywords = new Map<string, string[]>()
  if (scene.index) {
    for (const entry of scene.index.entries)
      if (entry.keywords) keywords.set(entry.id, entry.keywords)
    return keywords
  }
  for (const node of scene.nodes) if (node.keywords) keywords.set(node.id, node.keywords)
  for (const link of scene.links) {
    const words = [link.from.role, link.to.role].filter((word): word is string => Boolean(word))
    if (words.length > 0) keywords.set(link.id, words)
  }
  return keywords
}

/**
 * The rows the Index shows: each group's header, then its items, nodes before links. A
 * query shows every match whatever is collapsed; groups with nothing left are dropped.
 */
export function indexRows(
  scene: Scene,
  filter: IndexFilter,
  collapsed: ReadonlySet<string>,
): IndexRow[] {
  const query = filter.query.trim().toLowerCase()
  const keywords = keywordsOf(scene)
  const matches = (item: IndexItemRow): IndexItemRow | undefined => {
    if (filter.hidden.has(item.kind)) return undefined
    if (!query) return item
    if (item.label.toLowerCase().includes(query)) return item
    if (item.sublabel?.toLowerCase().includes(query)) return item
    const keyword = keywords.get(item.id)?.find((word) => word.toLowerCase().includes(query))
    return keyword ? { ...item, matched: keyword } : undefined
  }
  const items = listedItems(scene).flatMap((item) => matches(item) ?? [])
  const groups = scene.index?.groups ?? scene.groups
  const known = new Set(groups.map((group) => group.id))
  const rows: IndexRow[] = []
  for (const group of groups) {
    const members = items.filter((item) => item.group === group.id)
    if (members.length === 0) continue
    const shut = !query && collapsed.has(group.id)
    rows.push({
      type: 'group',
      id: group.id,
      label: group.label,
      ...(group.hue !== undefined ? { hue: group.hue } : {}),
      count: members.length,
      collapsed: shut,
    })
    if (!shut) rows.push(...members)
  }
  rows.push(...items.filter((item) => !item.group || !known.has(item.group)))
  return rows
}

/** Kind names as the filter chips read them. */
export function kindLabel(kind: string, count: number): string {
  const plural =
    count === 1
      ? kind
      : kind.endsWith('s')
        ? `${kind}es`
        : kind.endsWith('y')
          ? `${kind.slice(0, -1)}ies`
          : `${kind}s`
  return plural.charAt(0).toUpperCase() + plural.slice(1)
}
