/**
 * One dataset of a Domain as the Data level reads it: its Classes, each with the Nodes of it in
 * dataset order; its Nodes, each with its properties as a reader reads them; its Edges, by their
 * place in the dataset; and the ends an Edge names that the dataset does not hold (the Domain
 * itself, written `/:<origin>`, or a path outside it). Pure: nothing here draws or decides.
 */

import type {
  StudioDataset,
  StudioDatasetFailure,
  StudioSchemaBundle,
} from '@shared/contracts/schema'

import { ANYONE } from '@shared/contracts/scenarios'
import { parseClassRefKey } from '@shared/schema/identity'

import { resolveClass } from '../../schema-studio/inheritance'
import { moduleHues, moduleOfMember } from '../../schema-studio/modules'
import { originShort } from '../lenses/structure'
import { shortRevision } from '../workspace/words'
import { coreEdgeId, dataEntries, displayName, lastSeg, nodeAnchor } from './names'

/** The module of what a Schema declares at its root: its Classes belong to no module, and wear no hue. */
const ROOT_MODULE = 'root'
const SCHEMA_DIR = 'schema'

export interface DataClass {
  /** The Class's selection id, as the Schema level names it: `class.X` at home, `class.<key>` elsewhere. */
  readonly target: string
  /** Its Kernel Key, `<origin>:class.<name>`. */
  readonly key: string
  readonly name: string
  readonly origin: string
  /** Declared by the dataset's own Domain. */
  readonly local: boolean
  /** The Class as the dataset writes it: the local name, or the exact imported Key. */
  readonly written: string
  /** Its Nodes' paths, in dataset order. */
  readonly nodes: readonly string[]
  /** The hue its module wears at the Schema level; none for the root module and other Domains. */
  readonly hue?: number
  /** The Class's own icon, when it declares one. */
  readonly icon?: string
}

/** One property as a reader reads it: its short name when that is unambiguous, its value in words. */
export interface PropertyLine {
  /** the exact key the dataset writes, then the path into a nested value (`key/format`) */
  readonly key: string
  readonly label: string
  readonly value: string
  /** a part of a nested value: indented under the property it belongs to */
  readonly depth: number
}

export interface DataNode {
  readonly path: string
  /** its scene id and comment anchor: `core.node.<path>`, as Tests named it */
  readonly id: string
  readonly classTarget: string
  readonly label: string
  readonly properties: readonly PropertyLine[]
  /** the dataset's variables that name it */
  readonly variables: readonly string[]
}

export interface DataEdge {
  /** its place in the dataset: two Edges may join the same two Nodes */
  readonly index: number
  /** `core.edge.<index>`, as the rules' data names it */
  readonly id: string
  /** the relationship as the dataset writes it */
  readonly name: string
  /** the relationship's selection id: `class.<name>` at home, `class.<key>` elsewhere */
  readonly relationTarget: string
  readonly from: string
  readonly to: string
  readonly properties: readonly PropertyLine[]
}

/** An end an Edge names that the dataset holds no Node for. */
export interface OutsideEnd {
  readonly path: string
  /** `outside.<path>` */
  readonly id: string
  /** the Domain the dataset belongs to (`/:<origin>`), or a path the dataset does not hold */
  readonly kind: 'domain' | 'external'
  readonly label: string
}

export interface DatasetModel {
  readonly dataset: StudioDataset
  readonly origin: string
  /** Its Classes: the Domain's own by name, then other Domains' by Domain and name. */
  readonly classes: readonly DataClass[]
  readonly nodes: ReadonlyMap<string, DataNode>
  /** Nodes in dataset order. */
  readonly order: readonly DataNode[]
  readonly edges: readonly DataEdge[]
  readonly outgoing: ReadonlyMap<string, readonly DataEdge[]>
  readonly incoming: ReadonlyMap<string, readonly DataEdge[]>
  readonly outside: ReadonlyMap<string, OutsideEnd>
  readonly classOf: ReadonlyMap<string, DataClass>
  readonly classByTarget: ReadonlyMap<string, DataClass>
}

export const nodeId = nodeAnchor
export const edgeId = coreEdgeId
export const outsideId = (path: string) => `outside.${path}`

/** The path a Node's scene id names, if it names one. */
export function pathOfNodeId(id: string): string | undefined {
  return id.startsWith('core.node.') ? id.slice('core.node.'.length) : undefined
}

/** The index an Edge's scene id names, if it names one. */
export function indexOfEdgeId(id: string): number | undefined {
  const match = /^core\.edge\.(\d+)$/.exec(id)
  return match ? Number(match[1]) : undefined
}

export function isReadyDataset(
  entry: StudioDataset | StudioDatasetFailure | undefined,
): entry is StudioDataset {
  return entry?.status === 'ready'
}

/** A dataset module's file name without its extension: `./tests/datasets/owners.ts` → `owners`. */
export const moduleName = (path: string) => lastSeg(path).replace(/\.[a-z]+$/i, '')

/**
 * A dataset's name as the Studio says it: its title, else its id. One that could not be read has
 * neither, and is named by its module.
 */
export function datasetLabel(entry: StudioDataset | StudioDatasetFailure): string {
  return entry.status === 'ready' ? entry.title?.trim() || entry.id : moduleName(entry.path)
}

/** How a dataset stands against the Schema shown, in a sentence: admitted against it, or another revision. */
export function admittedSentence(dataset: StudioDataset): string {
  return dataset.schemaMatch
    ? `Admitted against this Schema (revision ${shortRevision(dataset.revision)}).`
    : 'Admitted against another Schema revision: it is read again once the Schema settles.'
}

/** The dataset at `path` as the crumb names it: by its entry once it is read, else by its module. */
export function datasetName(
  entries: readonly (StudioDataset | StudioDatasetFailure)[] | undefined,
  path: string,
): string {
  const entry = entries?.find((candidate) => candidate.path === path)
  return entry ? datasetLabel(entry) : moduleName(path)
}

/** What a dataset's module path finds among a Domain's datasets: it, ready or failed; else nothing. */
export function findDataset(
  entries: readonly (StudioDataset | StudioDatasetFailure)[],
  path: string,
):
  | { readonly status: 'ready'; readonly dataset: StudioDataset }
  | { readonly status: 'failed'; readonly failure: StudioDatasetFailure }
  | { readonly status: 'missing' } {
  const entry = entries.find((candidate) => candidate.path === path)
  if (!entry) return { status: 'missing' }
  return entry.status === 'ready'
    ? { status: 'ready', dataset: entry }
    : { status: 'failed', failure: entry }
}

/** A value in words: text as it is, nothing as a dash, a list joined; an object is read part by part. */
function words(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value === '' ? '""' : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value))
    return value.length === 0
      ? 'none'
      : value.map((each) => (isRecord(each) ? JSON.stringify(each) : words(each))).join(', ')
  return JSON.stringify(value)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** How deep a nested value is read part by part before the rest is written as JSON. */
const NESTED_DEPTH = 2

/** Properties in reading order, each nested object read part by part, `NESTED_DEPTH` deep. */
export function propertyLines(data: Readonly<Record<string, unknown>> | undefined): PropertyLine[] {
  const lines: PropertyLine[] = []
  const nested = (key: string, value: Record<string, unknown>, depth: number) => {
    for (const [name, part] of Object.entries(value)) {
      const at = `${key}/${name}`
      if (isRecord(part) && depth < NESTED_DEPTH && Object.keys(part).length > 0) {
        lines.push({ key: at, label: name, value: '', depth })
        nested(at, part, depth + 1)
      } else lines.push({ key: at, label: name, value: words(part), depth })
    }
  }
  for (const entry of dataEntries({ ...data })) {
    if (isRecord(entry.value) && Object.keys(entry.value).length > 0) {
      lines.push({ key: entry.key, label: entry.label, value: '', depth: 0 })
      nested(entry.key, entry.value, 1)
    } else lines.push({ key: entry.key, label: entry.label, value: words(entry.value), depth: 0 })
  }
  return lines
}

/** The Class a dataset writes, as its Key: a bare name is the dataset's own Domain's. */
function classKeyOf(
  written: string,
  origin: string,
): { key: string; name: string; origin: string } {
  const ref = parseClassRefKey(written)
  if (ref) return { key: written, name: ref.name, origin: ref.origin }
  return { key: `${origin}:class.${written}`, name: written, origin }
}

const known = new WeakMap<StudioDataset, WeakMap<object, DatasetModel>>()
const NO_BUNDLE = {}

/** The dataset's model, made once per dataset and bundle reply. */
export function datasetModel(dataset: StudioDataset, bundle?: StudioSchemaBundle): DatasetModel {
  let byBundle = known.get(dataset)
  if (!byBundle) known.set(dataset, (byBundle = new WeakMap()))
  const key = bundle ?? NO_BUNDLE
  let model = byBundle.get(key)
  if (!model) byBundle.set(key, (model = build(dataset, bundle)))
  return model
}

function build(dataset: StudioDataset, bundle: StudioSchemaBundle | undefined): DatasetModel {
  const origin = dataset.origin
  const hues = bundle?.ir ? moduleHues(bundle, SCHEMA_DIR) : new Map<string, number>()
  const variablesOf = new Map<string, string[]>()
  for (const [name, paths] of Object.entries(dataset.variables).sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    for (const path of paths) variablesOf.set(path, [...(variablesOf.get(path) ?? []), name])

  const classes = new Map<string, DataClass & { nodes: string[] }>()
  const classOf = new Map<string, DataClass>()
  const nodes = new Map<string, DataNode>()
  const order: DataNode[] = []
  for (const node of dataset.nodes) {
    const ref = classKeyOf(node.className, origin)
    let cls = classes.get(ref.key)
    if (!cls) {
      const local = ref.origin === origin
      const module =
        local && bundle?.ir ? moduleOfMember(bundle, 'class', ref.name, SCHEMA_DIR) : undefined
      const hue = module !== undefined && module !== ROOT_MODULE ? hues.get(module) : undefined
      const icon = bundle?.ir
        ? resolveClass(bundle, { origin: ref.origin, kind: 'class', name: ref.name })?.icon
        : undefined
      cls = {
        target: local ? `class.${ref.name}` : `class.${ref.key}`,
        key: ref.key,
        name: ref.name,
        origin: ref.origin,
        local,
        written: node.className,
        nodes: [],
        ...(hue === undefined ? {} : { hue }),
        ...(icon ? { icon } : {}),
      }
      classes.set(ref.key, cls)
    }
    cls.nodes.push(node.path)
    classOf.set(node.path, cls)
    const model: DataNode = {
      path: node.path,
      id: nodeId(node.path),
      classTarget: cls.target,
      label: displayName(node),
      properties: propertyLines(node.data),
      variables: variablesOf.get(node.path) ?? [],
    }
    if (!nodes.has(node.path)) {
      nodes.set(node.path, model)
      order.push(model)
    }
  }

  const outgoing = new Map<string, DataEdge[]>()
  const incoming = new Map<string, DataEdge[]>()
  const outside = new Map<string, OutsideEnd>()
  const domainPath = `/:${origin}`
  const edges = dataset.edges.map((edge, index): DataEdge => {
    const ref = classKeyOf(edge.edgeName, origin)
    const model: DataEdge = {
      index,
      id: edgeId(index),
      name: edge.edgeName,
      relationTarget: ref.origin === origin ? `class.${ref.name}` : `class.${ref.key}`,
      from: edge.from,
      to: edge.to,
      properties: propertyLines(edge.data),
    }
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), model])
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), model])
    for (const path of [edge.from, edge.to]) {
      if (nodes.has(path) || outside.has(path)) continue
      outside.set(path, {
        path,
        id: outsideId(path),
        kind: path === domainPath ? 'domain' : 'external',
        label: path === domainPath ? originShort(origin) : lastSeg(path),
      })
    }
    return model
  })

  const sorted = [...classes.values()].sort(
    (left, right) =>
      Number(right.local) - Number(left.local) ||
      left.origin.localeCompare(right.origin) ||
      left.name.localeCompare(right.name),
  )
  return {
    dataset,
    origin,
    classes: sorted,
    nodes,
    order,
    edges,
    outgoing,
    incoming,
    outside,
    classOf,
    classByTarget: new Map(sorted.map((cls) => [cls.target, cls])),
  }
}

/** A Class's region label: its name, and the Domain it comes from when that is another. */
export function classLabel(cls: Pick<DataClass, 'name' | 'origin' | 'local'>): string {
  return cls.local ? cls.name : `${cls.name} · ${originShort(cls.origin)}`
}

/** A Node or outside end as the level names it. */
export function endLabel(model: DatasetModel, path: string): string {
  return model.nodes.get(path)?.label ?? model.outside.get(path)?.label ?? lastSeg(path)
}

/**
 * An identity as every sentence of the level names it: its Node's label exactly as the map
 * writes it, never recased; the path written, when the dataset no longer holds it; or "anyone",
 * no identity in particular, which alone takes a capital where it opens a sentence.
 */
export function identityLabel(model: DatasetModel, identity: string, opening = false): string {
  if (identity === ANYONE) return opening ? 'Anyone' : 'anyone'
  return model.nodes.has(identity) || model.outside.has(identity)
    ? endLabel(model, identity)
    : identity
}
