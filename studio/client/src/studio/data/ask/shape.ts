/**
 * What a Query reads, as a tree: the Class it starts from, then every Class it reaches, each
 * through the relationship it follows to get there. Built from the source reading's effects (a
 * flat list in the order the `build` meets them) and the Schema's relationship ends, which say
 * where each step hangs.
 *
 * This is the reading's account of the Query's reach, not its semantics: filters, order and bounds
 * are the Query's own and are not in it. A reader of the tree is told so (`Answer.approximate`).
 */

import type { DefinitionLink, IrClass, StudioSchemaBundle } from '@shared/contracts/schema'

import { classRefKey, type IrClassRef, parseClassRefKey } from '@shared/schema/identity'

import { effectClass } from '../../../schema-studio/definitions'
import { resolveClass } from '../../../schema-studio/inheritance'
import { classTarget } from '../../lenses/structure'
import { rulesOf } from '../../rules/model'

/** One Class of the tree: the root, or a Class reached through `via`. */
export interface ShapeStep {
  /** its place in the tree, stable for one definition: `0`, `0.1`, `0.1.0` */
  readonly id: string
  readonly ref: IrClassRef
  /** the Class's selection id, as every level names it */
  readonly target: string
  /** how its parent reaches it; none for a root */
  readonly via?: ShapeVia
  readonly children: readonly ShapeStep[]
}

export interface ShapeVia {
  readonly ref: IrClassRef
  /** the relationship's selection id */
  readonly target: string
  /** the end of the relationship the parent stands on: 0 its source, 1 its target */
  readonly from: 0 | 1
  /** both ends accept both Classes: either direction is followed */
  readonly either: boolean
}

export interface QueryShape {
  /** more than one when the Query reads several things side by side */
  readonly roots: readonly ShapeStep[]
  /** every step, parents before children */
  readonly steps: readonly ShapeStep[]
  /** effects the tree could not place, in plain words */
  readonly unplaced: readonly string[]
}

const lineages = new WeakMap<StudioSchemaBundle, Map<string, readonly string[]>>()

/**
 * The Classes a Class declares it extends, by key: as the bundle's own Schema says, else as the
 * Schemas of its closure do, so a Class of another Domain a dataset holds is known by what it is
 * (a Shell `User` is a Kernel `Identity`) though the Domain's own Schema never names it.
 */
function parentsOf(bundle: StudioSchemaBundle, ref: IrClassRef): readonly string[] {
  let known = lineages.get(bundle)
  if (!known) lineages.set(bundle, (known = new Map()))
  const key = classRefKey(ref)
  let parents = known.get(key)
  if (parents === undefined) {
    const declared = resolveClass(bundle, ref)
    parents = declared
      ? (declared.extendsRefs ?? []).map(classRefKey)
      : ((
          rulesOf(bundle).catalogue?.words.schema.classes as
            | Record<string, { extends?: readonly string[] } | undefined>
            | undefined
        )?.[key]?.extends ?? [])
    known.set(key, parents)
  }
  return parents
}

/** Every Class `ref` descends from, by key, the nearest first; `ref` itself is not among them. */
export function ancestorsOf(bundle: StudioSchemaBundle, ref: IrClassRef): string[] {
  const own = classRefKey(ref)
  const seen = new Set<string>([own])
  const found: string[] = []
  let frontier = [...parentsOf(bundle, ref)]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const key of frontier) {
      if (seen.has(key)) continue
      seen.add(key)
      found.push(key)
      const parent = parseClassRefKey(key)
      if (parent) next.push(...parentsOf(bundle, parent))
    }
    frontier = next
  }
  return found
}

/** Whether `ref` is `base` or descends from it, as the bundle's Schemas say. */
export function isA(bundle: StudioSchemaBundle, ref: IrClassRef, base: IrClassRef): boolean {
  const wanted = classRefKey(base)
  const seen = new Set<string>()
  const queue: string[] = [classRefKey(ref)]
  while (queue.length > 0) {
    const key = queue.shift()!
    if (key === wanted) return true
    if (seen.has(key)) continue
    seen.add(key)
    const parent = parseClassRefKey(key)
    if (parent) queue.push(...parentsOf(bundle, parent))
  }
  return false
}

/**
 * How well a relationship's end fits a Class: 3 when it accepts exactly that Class, 2 when it
 * accepts a base of it, 1 when it accepts a Class that descends from it (the Query reads the
 * base, the Schema names the kind), 0 when it does not fit.
 */
function fit(bundle: StudioSchemaBundle, end: readonly IrClassRef[], ref: IrClassRef): number {
  const key = classRefKey(ref)
  let best = 0
  for (const accepted of end) {
    if (classRefKey(accepted) === key) return 3
    if (isA(bundle, ref, accepted)) best = Math.max(best, 2)
    else if (isA(bundle, accepted, ref)) best = Math.max(best, 1)
  }
  return best
}

/** The Classes an end accepts: its exact coordinates, or its local names where the Schema gives only those. */
function endRefs(member: IrClass, index: 0 | 1): IrClassRef[] {
  const end = member.endpoints?.[index]
  if (!end) return []
  if (end.refs?.length) return end.refs.filter((ref): ref is IrClassRef => ref.kind === 'class')
  return end.types.map((name) => ({ origin: member.origin, kind: 'class' as const, name }))
}

interface Draft {
  id: string
  ref: IrClassRef
  target: string
  via?: ShapeVia
  children: Draft[]
}

/** The tree of what `definition` reads; no root when it reads nothing the Schema knows. */
export function queryShape(bundle: StudioSchemaBundle, definition: DefinitionLink): QueryShape {
  const domain = bundle.ir?.domain ?? ''
  const roots: Draft[] = []
  const placed: Draft[] = []
  const unplaced: string[] = []
  let pending: { ref: IrClassRef; member: IrClass } | undefined

  const step = (ref: IrClassRef, parent?: Draft, via?: ShapeVia): Draft => {
    const siblings = parent ? parent.children : roots
    const draft: Draft = {
      id: parent ? `${parent.id}.${siblings.length}` : `${siblings.length}`,
      ref,
      target: classTarget(ref, domain),
      ...(via ? { via } : {}),
      children: [],
    }
    siblings.push(draft)
    placed.push(draft)
    return draft
  }

  /**
   * Hang `to` under the step that best stands on one end of `pending` while `to` fits the other.
   * Of the steps that fit alike a root comes first, since a Query mostly reads what its root
   * holds, then the step placed last.
   */
  const hang = (to: IrClassRef | undefined): boolean => {
    if (!pending) return false
    const { ref: relation, member } = pending
    const ends: [IrClassRef[], IrClassRef[]] = [endRefs(member, 0), endRefs(member, 1)]
    let best: { parent: Draft; from: 0 | 1; reached: IrClassRef; score: number } | undefined
    for (let index = placed.length - 1; index >= 0; index--) {
      const parent = placed[index]!
      for (const from of [0, 1] as const) {
        const other = from === 0 ? 1 : 0
        const reached = to ?? ends[other][0]
        if (!reached) continue
        const stands = fit(bundle, ends[from], parent.ref)
        const lands = fit(bundle, ends[other], reached)
        if (stands === 0 || lands === 0) continue
        const score = (stands + lands) * 2 + (parent.via ? 0 : 1)
        if (!best || score > best.score) best = { parent, from, reached, score }
      }
    }
    if (!best) return false
    const other = best.from === 0 ? 1 : 0
    const viaTarget = classTarget(relation, domain)
    const reachedKey = classRefKey(best.reached)
    // The same relationship followed twice from one step to one Class is one step of the tree.
    const again = best.parent.children.some(
      (child) =>
        child.via?.target === viaTarget &&
        child.via.from === best!.from &&
        classRefKey(child.ref) === reachedKey,
    )
    if (again) {
      pending = undefined
      return true
    }
    step(best.reached, best.parent, {
      ref: relation,
      target: classTarget(relation, domain),
      from: best.from,
      either:
        fit(bundle, ends[other], best.parent.ref) > 0 &&
        fit(bundle, ends[best.from], best.reached) > 0,
    })
    pending = undefined
    return true
  }

  /** A relationship nothing was read after: it is followed to the Class its other end declares. */
  const settle = () => {
    if (!pending) return
    if (!hang(undefined)) unplaced.push(`the relationship ${pending.ref.name}`)
    pending = undefined
  }

  for (const effect of definition.effects ?? []) {
    if (effect.kind !== 'read') continue
    const ref = effectClass(domain, effect.class)
    const member = resolveClass(bundle, ref)
    if (!member) {
      unplaced.push(`${ref.name}, which the Schema does not declare`)
      continue
    }
    if (member.type === 'edge') {
      settle()
      if (effect.role === 'root') {
        // A Query that starts from a relationship is read from its first end.
        const start = endRefs(member, 0)[0]
        if (!start) {
          unplaced.push(`the relationship ${ref.name}`)
          continue
        }
        step(start)
      }
      pending = { ref, member }
      continue
    }
    if (effect.role === 'root') {
      settle()
      step(ref)
      continue
    }
    if (pending) {
      if (!hang(ref)) {
        unplaced.push(`${ref.name}, reached through ${pending.ref.name}`)
        pending = undefined
      }
      continue
    }
    // A Class read again with no relationship before it narrows a step already there.
    if (!placed.some((each) => classRefKey(each.ref) === classRefKey(ref)))
      unplaced.push(`${ref.name}, reached by nothing the reading saw`)
  }
  settle()

  return { roots, steps: placed, unplaced }
}

/** The step with `id`. */
export function stepOf(shape: QueryShape, id: string): ShapeStep | undefined {
  return shape.steps.find((step) => step.id === id)
}

/** The steps from a root down to `step`, the root first. */
export function pathTo(shape: QueryShape, step: ShapeStep): ShapeStep[] {
  const parts = step.id.split('.')
  return parts.map((_, index) => stepOf(shape, parts.slice(0, index + 1).join('.'))!)
}
