/**
 * A dataset measured against its Schema: how many Nodes each Class holds, how many Edges each
 * relationship, and how many links a Node really has at each end against what the end declares.
 * The whole of a dataset in numbers, whatever its size: the first thing to read of data, before
 * any slice of it.
 */

import type { IrEndpoint, StudioSchemaBundle } from '@shared/contracts/schema'

import { classRefKey, type IrClassRef } from '@shared/schema/identity'

import type { DatasetModel } from '../model'

import { resolveClass } from '../../../schema-studio/inheritance'
import { classTarget } from '../../lenses/structure'
import { isA } from './shape'

export interface EndMeasure {
  /** the end's name */
  readonly name: string
  /** the Classes that stand at the end, by selection id: those it accepts and those of the dataset that descend from them */
  readonly classes: readonly string[]
  /** Nodes that can stand at the end: of a Class it accepts */
  readonly nodes: number
  /** links per such Node: fewest, median, most */
  readonly min: number
  readonly median: number
  readonly max: number
  /** Nodes with fewer links than the end requires, or more than it admits */
  readonly below: number
  readonly above: number
  readonly declared?: IrEndpoint['cardinality']
}

export interface RelationMeasure {
  /** the relationship's selection id */
  readonly target: string
  readonly name: string
  readonly edges: number
  /** its two ends, source then target; absent when the Schema does not declare them */
  readonly ends?: readonly [EndMeasure, EndMeasure]
}

export interface ClassMeasure {
  /** the Class's selection id */
  readonly target: string
  readonly name: string
  readonly nodes: number
}

export interface Measure {
  readonly nodes: number
  readonly edges: number
  readonly classes: ReadonlyMap<string, ClassMeasure>
  readonly relations: ReadonlyMap<string, RelationMeasure>
  /** ends where at least one Node breaks what the end declares */
  readonly breaches: number
}

const median = (sorted: readonly number[]): number =>
  sorted.length === 0 ? 0 : sorted[Math.floor((sorted.length - 1) / 2)]!

/** Measure `model` against the Schema `bundle` holds. */
export function measure(model: DatasetModel, bundle: StudioSchemaBundle): Measure {
  const domain = bundle.ir?.domain ?? model.origin
  const classes = new Map<string, ClassMeasure>()
  for (const cls of model.classes)
    classes.set(cls.target, { target: cls.target, name: cls.name, nodes: cls.nodes.length })

  // Each relationship's Edges, and how many each Node has at each end.
  const edges = new Map<
    string,
    { name: string; count: number; at: [Map<string, number>, Map<string, number>] }
  >()
  for (const edge of model.edges) {
    let known = edges.get(edge.relationTarget)
    if (!known)
      edges.set(
        edge.relationTarget,
        (known = { name: edge.name, count: 0, at: [new Map(), new Map()] }),
      )
    known.count += 1
    known.at[0].set(edge.from, (known.at[0].get(edge.from) ?? 0) + 1)
    known.at[1].set(edge.to, (known.at[1].get(edge.to) ?? 0) + 1)
  }

  const standing = (accepted: readonly IrClassRef[]) =>
    model.classes.filter((cls) =>
      accepted.some((ref) =>
        isA(bundle, { origin: cls.origin, kind: 'class', name: cls.name }, ref),
      ),
    )

  const relations = new Map<string, RelationMeasure>()
  let breaches = 0
  const declared = Object.values(bundle.ir?.classes ?? {}).filter(
    (member) => member.type === 'edge',
  )
  const seen = new Set<string>()
  for (const member of declared) {
    const target = classTarget(member.ref, domain)
    seen.add(target)
    const known = edges.get(target)
    const ends = [0, 1].map((index): EndMeasure | undefined => {
      const end = member.endpoints?.[index]
      if (!end) return undefined
      const declared = (end.refs ?? []).filter((ref): ref is IrClassRef => ref.kind === 'class')
      const accepted =
        declared.length > 0
          ? declared
          : end.types.map((name) => ({ origin: member.origin, kind: 'class' as const, name }))
      const stand = standing(accepted)
      const nodes = stand.flatMap((cls) => cls.nodes)
      const counts = nodes
        .map((path) => known?.at[index as 0 | 1].get(path) ?? 0)
        .sort((left, right) => left - right)
      const { min: least, max: most } = end.cardinality ?? { min: 0, max: null }
      const below = counts.filter((count) => count < least).length
      const above = most === null ? 0 : counts.filter((count) => count > most).length
      if (below > 0 || above > 0) breaches += 1
      return {
        name: end.name,
        classes: [
          ...new Set([
            ...accepted.map((ref) => classTarget(ref, domain)),
            ...stand.map((cls) => cls.target),
          ]),
        ],
        nodes: nodes.length,
        min: counts[0] ?? 0,
        median: median(counts),
        max: counts.at(-1) ?? 0,
        below,
        above,
        ...(end.cardinality ? { declared: end.cardinality } : {}),
      }
    })
    relations.set(target, {
      target,
      name: member.name,
      edges: known?.count ?? 0,
      ...(ends[0] && ends[1] ? { ends: [ends[0], ends[1]] as const } : {}),
    })
  }
  // A relationship the dataset writes and this Schema does not declare is still counted.
  for (const [target, known] of edges)
    if (!seen.has(target)) relations.set(target, { target, name: known.name, edges: known.count })

  return { nodes: model.order.length, edges: model.edges.length, classes, relations, breaches }
}

/** A Class's measure by its coordinates, whatever Domain declares it. */
export function classMeasure(
  measured: Measure,
  bundle: StudioSchemaBundle,
  ref: IrClassRef,
): ClassMeasure | undefined {
  const domain = bundle.ir?.domain ?? ''
  return (
    measured.classes.get(classTarget(ref, domain)) ??
    [...measured.classes.values()].find(
      (cls) => resolveClass(bundle, ref) !== undefined && cls.target.endsWith(classRefKey(ref)),
    )
  )
}

/** An end's links per Node in words: `1 each`, `0 to 3, mostly 1`. */
export function spreadWords(end: EndMeasure): string {
  if (end.nodes === 0) return 'no Node'
  if (end.min === end.max) return `${end.min} each`
  return `${end.min} to ${end.max}, mostly ${end.median}`
}
