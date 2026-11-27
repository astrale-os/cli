/**
 * How the Data level names what a dataset holds: a Node's and an Edge's ids on the map, a Node's
 * properties as a reader reads them, and a Node's label. Pure: nothing here draws.
 */

/** A Node's id on the map and in the Index, by its dataset path. */
export const nodeAnchor = (path: string) => `core.node.${path}`
/** An Edge is keyed by its place in the dataset: two Edges may share a triple. */
export const coreEdgeId = (index: number) => `core.edge.${index}`
/** A path's last segment. */
export const lastSeg = (path: string) => path.split('/').filter(Boolean).pop() ?? path

const propertyKeyPattern = /^.+:class\.[A-Za-z][A-Za-z0-9_]*\.property\.([A-Za-z][A-Za-z0-9_]*)$/

export interface DataEntry {
  /** Exact key retained by the canonical declaration. */
  readonly key: string
  /** Short property name when unambiguous, otherwise the exact key. */
  readonly label: string
  readonly value: unknown
}

/** Present canonical property keys without discarding their exact identity. */
export function dataEntries(data: Record<string, unknown>): DataEntry[] {
  const entries = Object.entries(data).map(([key, value]) => ({
    key,
    shortName: propertyKeyPattern.exec(key)?.[1] ?? key,
    value,
  }))
  const counts = new Map<string, number>()
  for (const entry of entries) {
    counts.set(entry.shortName, (counts.get(entry.shortName) ?? 0) + 1)
  }
  return entries.map(({ key, shortName, value }) => ({
    key,
    label: counts.get(shortName) === 1 ? shortName : key,
    value,
  }))
}

/** A Node's label: its `name` or `title` property, else its path's last segment. */
export function displayName(n: { path: string; data: Record<string, unknown> }): string {
  const entries = dataEntries(n.data)
  for (const name of ['name', 'title']) {
    const value = entries.find((candidate) => candidate.label === name)?.value
    if (typeof value === 'string' && value) return value
  }
  return lastSeg(n.path)
}
