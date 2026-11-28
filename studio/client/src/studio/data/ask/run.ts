/**
 * A Query asked of a dataset, approximately: the Nodes and Edges its tree of reads (`QueryShape`)
 * reaches from the Nodes its parameters name, as one identity may read them. The answer is the
 * slice the canvas draws and the rows a panel lists.
 *
 * What it does: starts from every Node of a root's Class, keeps the ones the bound steps hold,
 * follows each relationship of the tree to the Nodes of the Class it reaches, and leaves out
 * every Node the identity may not read. What it does not: the Query's own filters beyond the
 * bound values, its order and its bounds. The Studio runs no Kernel; a reader is told so.
 */

import type { StudioSchemaBundle } from '@shared/contracts/schema'

import type { DataClass, DatasetModel } from '../model'
import type { QueryShape, ShapeStep } from './shape'

import { isA } from './shape'

/** How many root rows an answer lists; the slice still holds every Node matched. */
export const ROWS_LISTED = 200
/** How many rows one row lists under each relationship; the rest are counted. */
export const CHILDREN_LISTED = 12
/** How many Nodes a slice holds before it stops growing. */
export const SLICE_BOUND = 600

/** What a question's parameters hold the tree to. */
export interface Binding {
  /** the Nodes a step is held to, by step id; a step absent is free */
  readonly nodes: Readonly<Record<string, readonly string[]>>
  /** values a step's Nodes must carry: a Property, by its short name, equal to a value in words */
  readonly values?: readonly ValueBound[]
}

export interface ValueBound {
  readonly step: string
  readonly property: string
  readonly equals: string
}

export const FREE: Binding = { nodes: {} }

export interface AnswerRow {
  readonly path: string
  readonly step: string
  /** the Edge followed to reach it, by its place in the dataset; none for a root */
  readonly edge?: number
  readonly children: readonly AnswerGroup[]
}

/** The rows one row holds under one step of the tree. */
export interface AnswerGroup {
  readonly step: string
  readonly rows: readonly AnswerRow[]
  /** rows reached and not listed */
  readonly more: number
}

export interface Answer {
  readonly rows: readonly AnswerRow[]
  /** root Nodes matched, listed or not */
  readonly matched: number
  /** every Node of the slice, by path */
  readonly nodes: ReadonlySet<string>
  /** every Edge followed, by its place in the dataset */
  readonly edges: ReadonlySet<number>
  /** distinct Nodes reached that the identity may not read, left out */
  readonly hidden: number
  /** distinct Nodes at each step, by step id */
  readonly perStep: ReadonlyMap<string, number>
  /** the slice reached its bound: more is matched than it holds */
  readonly clipped: boolean
}

export interface AskInput {
  readonly model: DatasetModel
  readonly bundle: StudioSchemaBundle
  readonly shape: QueryShape
  readonly binding: Binding
  /** whether the identity may read a Node: `false` leaves it out, anything else keeps it */
  readonly readable?: (path: string) => boolean | undefined
}

const classRefOf = (cls: DataClass) => ({
  origin: cls.origin,
  kind: 'class' as const,
  name: cls.name,
})

interface Reach {
  readonly path: string
  readonly edge: number
}

/** The questions one model is asked share what each Class holds and where each step leads. */
class Walk {
  private readonly holds = new Map<string, boolean>()
  private readonly reachMemo = new Map<string, boolean>()
  private readonly boundBelow = new Map<string, boolean>()
  private readonly valuesOf = new Map<string, readonly { property: string; equals: string }[]>()
  hiddenNodes = new Set<string>()

  constructor(private readonly input: AskInput) {
    for (const bound of input.binding.values ?? [])
      this.valuesOf.set(bound.step, [...(this.valuesOf.get(bound.step) ?? []), bound])
  }

  /** Whether the Node at `path` is of the step's Class or one that descends from it. */
  private isOf(path: string, step: ShapeStep): boolean {
    const cls = this.input.model.classOf.get(path)
    if (!cls) return false
    const key = `${cls.key}|${step.target}`
    let held = this.holds.get(key)
    if (held === undefined) {
      held = isA(this.input.bundle, classRefOf(cls), step.ref)
      this.holds.set(key, held)
    }
    return held
  }

  private carries(path: string, step: ShapeStep): boolean {
    const wanted = this.valuesOf.get(step.id)
    if (!wanted) return true
    const properties = this.input.model.nodes.get(path)?.properties ?? []
    return wanted.every((bound) =>
      properties.some((line) => line.label === bound.property && line.value === bound.equals),
    )
  }

  /** Whether the Node fits the step: its Class, its bound Nodes and its bound values. */
  fits(path: string, step: ShapeStep): boolean {
    if (!this.isOf(path, step)) return false
    const held = this.input.binding.nodes[step.id]
    if (held && !held.includes(path)) return false
    return this.carries(path, step)
  }

  /** Whether the identity may read the Node; what it cannot tell is read. */
  reads(path: string): boolean {
    return this.input.readable?.(path) !== false
  }

  /** Whether the step takes the Node: it fits and the identity may read it. */
  takes(path: string, step: ShapeStep): boolean {
    return this.fits(path, step) && this.reads(path)
  }

  /**
   * Whether the step would take the Node were it readable; one that fits, holds what is bound
   * below and is withheld from the identity is counted as such.
   */
  admits(path: string, step: ShapeStep): boolean {
    if (!this.fits(path, step)) return false
    if (this.bound(step) && !this.holdsBelow(path, step)) return false
    if (this.reads(path)) return true
    this.hiddenNodes.add(path)
    return false
  }

  /** The Nodes a step reaches from its parent's Node, whatever the step then takes. */
  across(path: string, step: ShapeStep): Reach[] {
    const via = step.via
    if (!via) return []
    const { model } = this.input
    const reached: Reach[] = []
    if (via.from === 0 || via.either)
      for (const edge of model.outgoing.get(path) ?? [])
        if (edge.relationTarget === via.target) reached.push({ path: edge.to, edge: edge.index })
    if (via.from === 1 || via.either)
      for (const edge of model.incoming.get(path) ?? [])
        if (edge.relationTarget === via.target) reached.push({ path: edge.from, edge: edge.index })
    return reached
  }

  /** Whether the step or anything under it is held to something. */
  bound(step: ShapeStep): boolean {
    let known = this.boundBelow.get(step.id)
    if (known === undefined) {
      known =
        this.input.binding.nodes[step.id] !== undefined ||
        this.valuesOf.has(step.id) ||
        step.children.some((child) => this.bound(child))
      this.boundBelow.set(step.id, known)
    }
    return known
  }

  /** Whether, from the Node at `path` standing on `step`, every bound step below is met. */
  holdsBelow(path: string, step: ShapeStep): boolean {
    const key = `${step.id}|${path}`
    const known = this.reachMemo.get(key)
    if (known !== undefined) return known
    const held = step.children.every(
      (child) =>
        !this.bound(child) ||
        this.across(path, child).some(
          (reach) => this.takes(reach.path, child) && this.holdsBelow(reach.path, child),
        ),
    )
    this.reachMemo.set(key, held)
    return held
  }
}

/** Ask the dataset what the shape reaches under `binding`. */
export function ask(input: AskInput): Answer {
  const { model, shape } = input
  const walk = new Walk(input)
  const nodes = new Set<string>()
  const edges = new Set<number>()
  const perStep = new Map<string, Set<string>>()
  let clipped = false

  const note = (path: string, step: ShapeStep) => {
    nodes.add(path)
    let seen = perStep.get(step.id)
    if (!seen) perStep.set(step.id, (seen = new Set()))
    seen.add(path)
  }

  const expand = (
    path: string,
    step: ShapeStep,
    edge: number | undefined,
    listed: boolean,
  ): AnswerRow => {
    note(path, step)
    if (edge !== undefined) edges.add(edge)
    const children: AnswerGroup[] = []
    for (const child of step.children) {
      const reached = walk.across(path, child).filter((reach) => walk.admits(reach.path, child))
      const rows: AnswerRow[] = []
      let more = 0
      for (const reach of reached) {
        if (nodes.size >= SLICE_BOUND && !nodes.has(reach.path)) {
          clipped = true
          more += 1
          continue
        }
        const keep = listed && rows.length < CHILDREN_LISTED
        const row = expand(reach.path, child, reach.edge, keep)
        if (keep) rows.push(row)
        else more += 1
      }
      if (rows.length > 0 || more > 0) children.push({ step: child.id, rows, more })
    }
    return { path, step: step.id, ...(edge === undefined ? {} : { edge }), children }
  }

  const rows: AnswerRow[] = []
  let matched = 0
  for (const root of shape.roots) {
    for (const node of model.order) {
      if (!walk.admits(node.path, root)) continue
      matched += 1
      if (nodes.size >= SLICE_BOUND && !nodes.has(node.path)) {
        clipped = true
        continue
      }
      const listed = rows.length < ROWS_LISTED
      const row = expand(node.path, root, undefined, listed)
      if (listed) rows.push(row)
    }
  }

  // A Node counted hidden at one step and read at another is in the slice: it is not hidden.
  let hidden = 0
  for (const path of walk.hiddenNodes) if (!nodes.has(path)) hidden += 1

  return {
    rows,
    matched,
    nodes,
    edges,
    hidden,
    perStep: new Map([...perStep].map(([step, seen]) => [step, seen.size])),
    clipped,
  }
}

/** How many root Nodes a binding matches, without building the answer. */
export function countMatched(input: AskInput): number {
  const walk = new Walk(input)
  let matched = 0
  for (const root of input.shape.roots)
    for (const node of input.model.order) if (walk.admits(node.path, root)) matched += 1
  return matched
}
