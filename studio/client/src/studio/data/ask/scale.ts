/**
 * A dataset made larger than it was written, to read the Data level at a size its author did not
 * write by hand. NOT a generated dataset: the same Nodes and Edges laid down again `copies` times,
 * so every count grows and no new shape appears. It stands in for a dataset drawn from a Shape,
 * and the level says so wherever it shows one.
 *
 * The dataset's identities are kept once and shared by every copy, as the people of one
 * organisation are; a copy's links to an identity go to that identity or, by a draw the seed
 * settles, to another of the same Class, so who may read what differs from one copy to the next.
 * Every other Node is laid down once per copy under a path and a name of its own, with its Edges.
 * The first copy is the dataset as written, variables included.
 */

import type { StudioDataset, StudioSchemaBundle } from '@shared/contracts/schema'

import { parseClassRefKey } from '@shared/schema/identity'

import { KERNEL_ORIGIN } from '../../../schema-studio/inheritance'
import { isA } from './shape'

const IDENTITY = { origin: KERNEL_ORIGIN, kind: 'class' as const, name: 'Identity' }

/** The factors the level offers; 1 is the dataset as written. */
export const FACTORS = [1, 20, 100] as const

/** A small seeded generator: the same seed lays the same dataset down again. */
function draws(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x1_0000_0000
  }
}

const copyPath = (path: string, copy: number) => (copy === 0 ? path : `${path}~${copy + 1}`)

/** A Node's data with its `name` or `title` saying which copy it is. */
function renamed(data: Record<string, unknown>, copy: number): Record<string, unknown> {
  if (copy === 0) return data
  const next = { ...data }
  for (const [key, value] of Object.entries(data)) {
    const short = key.slice(key.lastIndexOf('.') + 1)
    if ((short === 'name' || short === 'title') && typeof value === 'string') {
      next[key] = `${value} · ${copy + 1}`
      break
    }
  }
  return next
}

const laid = new WeakMap<StudioDataset, Map<string, StudioDataset>>()

/** `dataset` laid down `copies` times; the dataset itself at one copy. */
export function scaled(
  dataset: StudioDataset,
  bundle: StudioSchemaBundle,
  copies: number,
  seed = 7,
): StudioDataset {
  if (copies <= 1) return dataset
  let known = laid.get(dataset)
  if (!known) laid.set(dataset, (known = new Map()))
  const key = `${copies}|${seed}|${bundle.renderFingerprint}`
  const before = known.get(key)
  if (before) return before

  const isIdentity = (className: string) =>
    isA(
      bundle,
      parseClassRefKey(className) ?? { origin: dataset.origin, kind: 'class', name: className },
      IDENTITY,
    )
  const shared = new Set<string>()
  const peers = new Map<string, string[]>()
  for (const node of dataset.nodes) {
    if (!isIdentity(node.className)) continue
    shared.add(node.path)
    peers.set(node.className, [...(peers.get(node.className) ?? []), node.path])
  }
  const classOf = new Map(dataset.nodes.map((node) => [node.path, node.className]))
  const held = new Set(dataset.nodes.map((node) => node.path))
  const draw = draws(seed)

  const nodes = dataset.nodes.filter((node) => shared.has(node.path))
  const edges: StudioDataset['edges'] = []
  for (let copy = 0; copy < copies; copy++) {
    for (const node of dataset.nodes) {
      if (shared.has(node.path)) continue
      nodes.push({ ...node, path: copyPath(node.path, copy), data: renamed(node.data, copy) })
    }
    const end = (path: string): string => {
      if (!held.has(path)) return path
      if (!shared.has(path)) return copyPath(path, copy)
      if (copy === 0) return path
      // One link in three goes to another identity of the same Class.
      const others = peers.get(classOf.get(path)!) ?? [path]
      return draw() < 1 / 3 ? others[Math.floor(draw() * others.length)]! : path
    }
    for (const edge of dataset.edges) {
      // An Edge between two identities is the organisation's own: it is laid down once.
      if (copy > 0 && shared.has(edge.from) && shared.has(edge.to)) continue
      edges.push({ ...edge, from: end(edge.from), to: end(edge.to) })
    }
  }

  const grown: StudioDataset = { ...dataset, nodes, edges }
  known.set(key, grown)
  return grown
}
