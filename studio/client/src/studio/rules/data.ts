import type { Catalogue, Data, Key, Value } from '@astrale-os/visual'
import type { StudioDataset } from '@shared/contracts/schema'

import { coreEdgeId, displayName } from '../data/names'

/**
 * A Studio Dataset as the data a rule is decided on (`Data`): its Nodes and Edges under the ids
 * the Studio's canvas gives them (a Node its path, an Edge `coreEdgeId` of its index), each value
 * under its Property Key, each Node a Schema reference names located by that reference, and `now`
 * the instant the caller reads it at. A value the reader has no type for is left out, never
 * guessed.
 */

const PROPERTY = /^.+:class\.[A-Za-z][A-Za-z0-9_]*\.property\.[A-Za-z][A-Za-z0-9_]*$/u

/** A Class name as the Dataset writes it: the local name in its own Schema, else the exact Key. */
const classKey = (name: string, origin: string): Key =>
  name.includes(':') ? name : `${origin}:class.${name}`

function valueOf(value: unknown): Value | null | undefined {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value
  if (typeof value === 'object' && 'amount' in value && 'currency' in value) {
    const { amount, currency } = value as { amount: unknown; currency: unknown }
    if (typeof amount === 'number' && typeof currency === 'string') return { amount, currency }
  }
  return undefined
}

export function dataOf(dataset: StudioDataset, catalogue: Catalogue, now: string): Data {
  const { classes, properties } = catalogue.words.schema
  // The Property Key of a short name on a Class: its own Property, else its nearest ancestor's.
  const owned = new Map<string, Key>()
  for (const [key, property] of Object.entries(properties))
    owned.set(`${property.owner}\n${property.name}`, key)
  const propertyKey = (owner: Key, name: string, seen = new Set<Key>()): Key | undefined => {
    if (seen.has(owner)) return undefined
    seen.add(owner)
    const own = owned.get(`${owner}\n${name}`)
    if (own !== undefined) return own
    for (const parent of classes[owner]?.extends ?? []) {
      const found = propertyKey(parent, name, seen)
      if (found !== undefined) return found
    }
    return undefined
  }
  const valuesOf = (owner: Key, data: Readonly<Record<string, unknown>> = {}) => {
    const values: Record<Key, Value | null> = {}
    for (const [name, raw] of Object.entries(data)) {
      const key = PROPERTY.test(name) ? name : propertyKey(owner, name)
      const value = valueOf(raw)
      if (key !== undefined && value !== undefined) values[key] = value
    }
    return values
  }
  const located = new Map<string, string>()
  for (const [reference, node] of Object.entries(dataset.references)) located.set(node, reference)

  return {
    now,
    graph: {
      name: dataset.title?.trim() || dataset.id,
      nodes: dataset.nodes.map((node) => {
        const owner = classKey(node.className, dataset.origin)
        const path = located.get(node.path)
        return {
          id: node.path,
          class: owner,
          label: displayName(node),
          values: valuesOf(owner, node.data),
          ...(path === undefined ? {} : { path }),
        }
      }),
      edges: dataset.edges.map((edge, index) => {
        const owner = classKey(edge.edgeName, dataset.origin)
        return {
          id: coreEdgeId(index),
          class: owner,
          source: edge.from,
          target: edge.to,
          values: valuesOf(owner, edge.data),
        }
      }),
    },
  }
}
