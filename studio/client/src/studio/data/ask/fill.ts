/**
 * Which Nodes a question's slots take when the reader has not said: the choice a decision model
 * would make, made here by evidence a reader can check. Each pick says why it was made, and each
 * candidate what asking with it gives, so the reader can change it knowingly.
 *
 * In order: what the reader has selected on the canvas, when a slot takes its Class; a Node the
 * dataset names by a variable; else the Node whose answer is richest without being too large to
 * read.
 */

import type { StudioSchemaBundle } from '@shared/contracts/schema'

import type { DatasetModel } from '../model'
import type { Question, Slot } from './question'
import type { QueryShape } from './shape'

import { bindingOf } from './question'
import { type Answer, ask } from './run'
import { isA, stepOf } from './shape'

/** A slice a reader takes in at a glance holds about this many Nodes. */
export const READABLE_SLICE = 24
/** Above this an unheld question is too large to read, and an optional slot is filled to hold it. */
export const LARGE_SLICE = 120
/** How many candidates of a slot are asked to rank them; the rest are listed unranked. */
const RANKED = 160

export type Why =
  | { readonly kind: 'selected' }
  | { readonly kind: 'named'; readonly variable: string }
  | { readonly kind: 'richest'; readonly nodes: number; readonly classes: number }
  /** a call's Node: the one that holds most links, where a call shows most */
  | { readonly kind: 'linked'; readonly edges: number }

export interface Candidate {
  readonly path: string
  readonly label: string
  /** the dataset's variables that name it */
  readonly variables: readonly string[]
  /** what asking with it gives; absent when it was not asked */
  readonly gives?: { readonly matched: number; readonly nodes: number; readonly classes: number }
}

export interface Pick {
  readonly slot: string
  readonly path: string
  readonly why: Why
}

export interface FillInput {
  readonly model: DatasetModel
  readonly bundle: StudioSchemaBundle
  readonly shape: QueryShape
  readonly slots: readonly Slot[]
  readonly question: Question
  readonly readable?: (path: string) => boolean | undefined
  /** the Node selected on the canvas, by path */
  readonly selected?: string
}

const asked = (input: FillInput, question: Question): Answer =>
  ask({
    model: input.model,
    bundle: input.bundle,
    shape: input.shape,
    binding: bindingOf(input.slots, question),
    ...(input.readable ? { readable: input.readable } : {}),
  })

const withValue = (question: Question, slot: string, paths: readonly string[]): Question => ({
  ...question,
  values: { ...question.values, [slot]: paths },
})

/** How good a slice is to read: the more Classes it shows the better, near a readable size. */
function interest(answer: Answer): number {
  if (answer.matched === 0) return Number.NEGATIVE_INFINITY
  const size = answer.nodes.size
  const classes = [...answer.perStep.values()].filter((count) => count > 0).length
  return classes * 6 - Math.abs(size - READABLE_SLICE) / 4
}

const givesOf = (answer: Answer) => ({
  matched: answer.matched,
  nodes: answer.nodes.size,
  classes: [...answer.perStep.values()].filter((count) => count > 0).length,
})

/** The Nodes a slot can take: of its step's Class and readable, in dataset order. */
function takers(input: FillInput, slot: Slot): string[] {
  const step = slot.step === undefined ? undefined : stepOf(input.shape, slot.step)
  if (!step) return []
  // A Node the Query holds by its id in a Property: the Nodes that Property names in the dataset.
  if (slot.property !== undefined)
    return valuesOf(input, slot)
      .map((candidate) => candidate.value)
      .filter((path) => input.model.nodes.has(path) && input.readable?.(path) !== false)
  const paths: string[] = []
  for (const cls of input.model.classes) {
    if (!isA(input.bundle, { origin: cls.origin, kind: 'class', name: cls.name }, step.ref))
      continue
    for (const path of cls.nodes) if (input.readable?.(path) !== false) paths.push(path)
  }
  const order = new Map(input.model.order.map((node, index) => [node.path, index]))
  return paths.sort((left, right) => order.get(left)! - order.get(right)!)
}

/**
 * A slot's candidates, the most interesting first: each asked with the question's other values
 * kept, up to a bound; the ones past it follow in dataset order, unasked.
 */
export function candidatesOf(input: FillInput, slot: Slot): Candidate[] {
  const paths = takers(input, slot)
  const ranked = paths.slice(0, RANKED).map((path) => {
    const answer = asked(input, withValue(input.question, slot.id, [path]))
    return { path, answer, score: interest(answer) }
  })
  ranked.sort((left, right) => right.score - left.score)
  const describe = (path: string, answer?: Answer): Candidate => ({
    path,
    label: input.model.nodes.get(path)?.label ?? path,
    variables: input.model.nodes.get(path)?.variables ?? [],
    ...(answer ? { gives: givesOf(answer) } : {}),
  })
  return [
    ...ranked.map(({ path, answer }) => describe(path, answer)),
    ...paths.slice(RANKED).map((path) => describe(path)),
  ]
}

/** A value a slot's Property holds in the dataset, and how many Nodes of its step carry it. */
export interface ValueCandidate {
  readonly value: string
  readonly nodes: number
}

/**
 * The values a value slot can take, as the dataset holds them: every value its Property carries
 * on a Node of its step, the most carried first. A slot whose type names its choices lists those
 * too, with none where the dataset holds none.
 */
export function valuesOf(input: FillInput, slot: Slot): ValueCandidate[] {
  const step = slot.step === undefined ? undefined : stepOf(input.shape, slot.step)
  const counts = new Map<string, number>((slot.options ?? []).map((option) => [option, 0]))
  if (step && slot.property !== undefined)
    for (const cls of input.model.classes) {
      if (!isA(input.bundle, { origin: cls.origin, kind: 'class', name: cls.name }, step.ref))
        continue
      for (const path of cls.nodes) {
        if (input.readable?.(path) === false) continue
        const line = input.model.nodes
          .get(path)
          ?.properties.find((each) => each.depth === 0 && each.label === slot.property)
        if (line && line.value !== '') counts.set(line.value, (counts.get(line.value) ?? 0) + 1)
      }
    }
  return [...counts]
    .map(([value, nodes]) => ({ value, nodes }))
    .sort((left, right) => right.nodes - left.nodes || left.value.localeCompare(right.value))
}

/** The pick for one node slot, with the other values kept: selected, named, else richest. */
function pickFor(input: FillInput, slot: Slot): Pick | undefined {
  const paths = takers(input, slot)
  if (paths.length === 0) return undefined
  if (input.selected !== undefined && paths.includes(input.selected))
    return { slot: slot.id, path: input.selected, why: { kind: 'selected' } }
  let best: { path: string; answer: Answer; score: number; named?: string } | undefined
  for (const path of paths.slice(0, RANKED)) {
    const answer = asked(input, withValue(input.question, slot.id, [path]))
    if (answer.matched === 0) continue
    const named = input.model.nodes.get(path)?.variables[0]
    // A Node the dataset's author named is the one they meant to be looked at.
    const score = interest(answer) + (named ? 8 : 0)
    if (!best || score > best.score) best = { path, answer, score, ...(named ? { named } : {}) }
  }
  if (!best) return undefined
  const gives = givesOf(best.answer)
  return {
    slot: slot.id,
    path: best.path,
    why: best.named
      ? { kind: 'named', variable: best.named }
      : { kind: 'richest', nodes: gives.nodes, classes: gives.classes },
  }
}

/**
 * The picks that make a question worth reading: one for every node slot the Query requires and
 * the reader left free; and, when the answer is still too large to read, one optional slot held,
 * the one that brings it nearest a readable size.
 */
export function fill(input: FillInput): Pick[] {
  const picks: Pick[] = []
  let question = input.question
  const free = (slot: Slot) =>
    slot.applied && slot.kind !== 'value' && !question.values[slot.id]?.length

  for (const slot of input.slots) {
    if (slot.optional || !free(slot)) continue
    const pick = pickFor({ ...input, question }, slot)
    if (!pick) continue
    picks.push(pick)
    question = withValue(question, slot.id, [pick.path])
  }

  if (asked(input, question).nodes.size <= LARGE_SLICE) return picks
  let best: { pick: Pick; distance: number } | undefined
  for (const slot of input.slots) {
    if (!slot.optional || !free(slot)) continue
    const pick = pickFor({ ...input, question }, slot)
    if (!pick) continue
    const size = asked(input, withValue(question, slot.id, [pick.path])).nodes.size
    const distance = Math.abs(size - READABLE_SLICE)
    if (!best || distance < best.distance) best = { pick, distance }
  }
  return best ? [...picks, best.pick] : picks
}

/** A pick's reason in words, after the Node's name: `named checkout in the dataset`. */
export function whyWords(why: Why): string {
  switch (why.kind) {
    case 'selected':
      return 'selected on the map'
    case 'named':
      return `named ${why.variable} in the dataset`
    case 'richest':
      return `the fullest answer: ${why.nodes} Nodes of ${why.classes} ${why.classes === 1 ? 'kind' : 'kinds'}`
    case 'linked':
      return `the one with most links: ${why.edges}`
  }
}
