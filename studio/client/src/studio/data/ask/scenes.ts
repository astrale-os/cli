/**
 * What the Data level draws through Structure: the dataset measured against its Schema, or the
 * slice of it a question reaches.
 *
 * - The measure is the Schema's own Structure Scene, every Class saying how many Nodes it holds
 *   and every relationship how many Edges, with the links a Node really has at each end. Nothing
 *   of the dataset is drawn Node by Node: the whole reads at any size.
 * - The slice is a dataset of its own, holding the Nodes a question reached and the Edges it
 *   followed, drawn as any dataset is.
 */

import type { StudioDataset, StudioSchemaBundle } from '@shared/contracts/schema'

import { parseClassRefKey } from '@shared/schema/identity'

import type { Scene, SceneEnd, SceneLink, SceneNode } from '../../scene/types'
import type { DatasetModel } from '../model'
import type { EndMeasure, Measure } from './measure'
import type { Answer } from './run'

import { classTarget, projectStructure } from '../../lenses/structure'
import { ancestorsOf } from './shape'

/** A count as a card reads it: `1,204`. */
export const counted = (value: number): string => value.toLocaleString('en-US')

/** An end's count on the map: what it declares, then what the dataset really holds there. */
function endCount(end: SceneEnd, measured: EndMeasure): SceneEnd {
  const held = measured.min === measured.max ? `${measured.min}` : `${measured.min}–${measured.max}`
  return { ...end, count: end.count ? `${end.count} · has ${held}` : `has ${held}` }
}

/** What a Class's card holds: its own Nodes, and those of Classes that descend from it and have no card. */
interface HeldByClass {
  nodes: number
  /** the Classes whose Nodes it counts beside its own, by name */
  through: string[]
}

/**
 * The Nodes each drawn Class holds. A Node counts on its own Class's card; where the Schema draws
 * no card for its Class (another Domain's `User`), on the card of the nearest Class it descends
 * from that is drawn (Kernel `Identity`), named there.
 */
function heldBy(
  bundle: StudioSchemaBundle,
  model: DatasetModel,
  drawn: ReadonlySet<string>,
): Map<string, HeldByClass> {
  const domain = bundle.ir?.domain ?? model.origin
  const held = new Map<string, HeldByClass>()
  const add = (target: string, nodes: number, through?: string) => {
    let known = held.get(target)
    if (!known) held.set(target, (known = { nodes: 0, through: [] }))
    known.nodes += nodes
    if (through) known.through.push(through)
  }
  for (const cls of model.classes) {
    if (drawn.has(cls.target)) {
      add(cls.target, cls.nodes.length)
      continue
    }
    const ancestor = ancestorsOf(bundle, { origin: cls.origin, kind: 'class', name: cls.name })
      .map((key) => parseClassRefKey(key))
      .map((ref) => (ref ? classTarget(ref, domain) : undefined))
      .find((target) => target !== undefined && drawn.has(target))
    if (ancestor) add(ancestor, cls.nodes.length, cls.name)
  }
  return held
}

function measuredNode(node: SceneNode, held: ReadonlyMap<string, HeldByClass>): SceneNode {
  if (node.kind !== 'class' && node.kind !== 'imported class' && node.kind !== 'kernel class')
    return node
  const { nodes, through } = held.get(node.id) ?? { nodes: 0, through: [] }
  const as = through.length > 0 ? `, as ${through.join(', ')}` : ''
  const { rows: _rows, rules: _rules, tallies: _tallies, ...rest } = node
  return {
    ...rest,
    counts: [{ label: nodes === 1 ? 'Node' : 'Nodes', value: nodes }],
    badges: [
      nodes === 0
        ? { label: 'no Node', tone: 'muted', title: 'The dataset holds no Node of this Class.' }
        : {
            label: `${counted(nodes)} ${nodes === 1 ? 'Node' : 'Nodes'}${as}`,
            tone: 'node',
            title: `The dataset holds ${counted(nodes)} of this Class${as}.`,
          },
    ],
    ...(nodes === 0 ? { absent: true as const } : {}),
  }
}

function measuredLink(link: SceneLink, measure: Measure): SceneLink {
  if (link.kind !== 'relationship') return link
  const relation = measure.relations.get(link.id)
  if (!relation) return link
  const broken = relation.ends?.some((end) => end.below > 0 || end.above > 0) ?? false
  return {
    ...link,
    name: link.name ?? link.label,
    label: `${link.label} · ${counted(relation.edges)}`,
    ...(relation.ends
      ? { from: endCount(link.from, relation.ends[0]), to: endCount(link.to, relation.ends[1]) }
      : {}),
    ...(broken ? { tone: 'warning' as const } : {}),
    ...(relation.edges === 0 ? { dashed: true } : {}),
  }
}

/** The Schema's Structure, measured: every Class and relationship with what the dataset holds. */
export function measuredScene(
  bundle: StudioSchemaBundle,
  model: DatasetModel,
  measure: Measure,
  key: string,
): Scene {
  const structure = projectStructure(bundle, {})
  const held = heldBy(bundle, model, new Set(structure.nodes.map((node) => node.id)))
  return {
    ...structure,
    key: `measure:${key}:${structure.key}`,
    nodes: structure.nodes.map((node) => measuredNode(node, held)),
    links: structure.links.map((link) => measuredLink(link, measure)),
    folded: [],
  }
}

/** What a slice holds of a dataset: Nodes by path, Edges by their place in the dataset. */
type Held = Pick<Answer, 'nodes' | 'edges'>

const slices = new WeakMap<Held, WeakMap<StudioDataset, StudioDataset>>()

/** The dataset an answer reached: its Nodes, and the Edges it followed between them. */
export function sliceOf(dataset: StudioDataset, answer: Held): StudioDataset {
  let byDataset = slices.get(answer)
  if (!byDataset) slices.set(answer, (byDataset = new WeakMap()))
  const known = byDataset.get(dataset)
  if (known) return known
  const slice: StudioDataset = {
    ...dataset,
    nodes: dataset.nodes.filter((node) => answer.nodes.has(node.path)),
    edges: dataset.edges.filter((_, index) => answer.edges.has(index)),
    variables: Object.fromEntries(
      Object.entries(dataset.variables)
        .map(([name, paths]) => [name, paths.filter((path) => answer.nodes.has(path))] as const)
        .filter(([, paths]) => paths.length > 0),
    ),
  }
  byDataset.set(dataset, slice)
  return slice
}
