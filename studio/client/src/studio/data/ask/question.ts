/**
 * A question asked of a dataset: one of the Domain's Queries, the values its parameters hold,
 * and who asks. A parameter is a slot: a Node or several of a Class the Query reads, or a value a
 * Property is compared with. A Query whose input the source reading reports gets its declared
 * slots; one whose input it cannot read gets slots the Studio offers from what the Query reads,
 * marked as such.
 */

import type {
  DefinitionInputField,
  DefinitionLink,
  StudioSchemaBundle,
} from '@shared/contracts/schema'

import { classRefKey } from '@shared/schema/identity'

import type { Binding, ValueBound } from './run'
import type { QueryShape, ShapeStep } from './shape'

import { effectClass } from '../../../schema-studio/definitions'
import { resolveClass } from '../../../schema-studio/inheritance'
import { isA } from './shape'

export interface Slot {
  /** the input field's name, or `step:<id>` for an offered one */
  readonly id: string
  /** as the reader names it: `issue`, `parent`, `project` */
  readonly label: string
  /** the author's words on the field */
  readonly doc?: string
  readonly optional: boolean
  readonly kind: 'node' | 'nodes' | 'value'
  /** the step of the tree its Nodes are held at, or its value is compared on */
  readonly step?: string
  /**
   * the Property the slot is compared with, by its short name: a value slot's, or a Node slot's
   * when the Query holds the Node's id in a Property (`assigneeId`) and names no Node by it
   */
  readonly property?: string
  /** a value slot's literals, when its type is a union of them */
  readonly options?: readonly string[]
  /** not declared by the Query: offered from what it reads */
  readonly offered: boolean
  /** whether asking can hold the tree to it; a slot that cannot is shown and not applied */
  readonly applied: boolean
}

export interface Question {
  /** the definition's id */
  readonly query: string
  /** each slot's values, by slot id: Node paths, or one value in words; absent is free */
  readonly values: Readonly<Record<string, readonly string[]>>
}

/** How many slots a Query with no readable input is offered. */
const OFFERED = 4

/** The first step, root first, that reads `className` or a Class it descends from or holds. */
function stepReading(
  bundle: StudioSchemaBundle,
  shape: QueryShape,
  className: string,
): ShapeStep | undefined {
  const ref = effectClass(bundle.ir?.domain ?? '', className)
  const key = classRefKey(ref)
  return (
    shape.steps.find((step) => classRefKey(step.ref) === key) ??
    shape.steps.find((step) => isA(bundle, step.ref, ref) || isA(bundle, ref, step.ref))
  )
}

/** A declared field as a slot, held at the step the `build` compares it on. */
function declaredSlot(
  bundle: StudioSchemaBundle,
  shape: QueryShape,
  field: DefinitionInputField,
): Slot {
  const kind = field.kind === 'nodes' ? 'nodes' : field.kind === 'node' ? 'node' : 'value'
  // A Node slot is held where the build names a Node by it, else where it compares a Property
  // with the Node's id (`assigneeId`); a value slot where it compares a Property.
  const use =
    kind === 'value'
      ? field.uses.find((each) => each.kind === 'property')
      : (field.uses.find((each) => each.kind === 'node') ??
        field.uses.find((each) => each.kind === 'property'))
  const step = use ? stepReading(bundle, shape, use.class) : undefined
  const applied = step !== undefined && (use?.kind === 'node' || use?.property !== undefined)
  return {
    id: field.name,
    label: field.name,
    ...(field.doc ? { doc: field.doc } : {}),
    optional: field.optional,
    kind,
    ...(step ? { step: step.id } : {}),
    ...(use?.kind === 'property' && use.property ? { property: use.property } : {}),
    ...(field.literals?.length ? { options: field.literals.map(String) } : {}),
    offered: false,
    applied,
  }
}

/** A step's name where it is read apart from its Class: the end it is reached by, else its Class. */
export function stepLabel(bundle: StudioSchemaBundle, step: ShapeStep): string {
  const end = step.via
    ? resolveClass(bundle, step.via.ref)?.endpoints?.[step.via.from === 0 ? 1 : 0]?.name
    : undefined
  return end ?? step.ref.name.charAt(0).toLowerCase() + step.ref.name.slice(1)
}

/** The slots of a Query: its declared input, else the roots and what they hold, offered. */
export function slotsOf(
  bundle: StudioSchemaBundle,
  definition: DefinitionLink,
  shape: QueryShape,
): Slot[] {
  const declared = definition.input
  // An input the reading reports gives the Query's own slots, none when it takes nothing.
  if (declared && declared.form !== 'unread')
    return declared.fields.map((field) => declaredSlot(bundle, shape, field))
  const seen = new Set<string>()
  const offered: Slot[] = []
  for (const step of shape.steps) {
    if (step.id.split('.').length > 2) continue
    const label = stepLabel(bundle, step)
    if (seen.has(label)) continue
    seen.add(label)
    offered.push({
      id: `step:${step.id}`,
      label,
      optional: true,
      kind: 'node',
      step: step.id,
      offered: true,
      applied: true,
    })
    if (offered.length === OFFERED) break
  }
  return offered
}

/** What a question's values hold the tree to; a slot that cannot be applied holds nothing. */
export function bindingOf(slots: readonly Slot[], question: Question): Binding {
  const nodes: Record<string, string[]> = {}
  const values: ValueBound[] = []
  for (const slot of slots) {
    const held = question.values[slot.id]
    if (!held?.length || !slot.applied || slot.step === undefined) continue
    if (slot.property !== undefined) {
      values.push({ step: slot.step, property: slot.property, equals: held[0]! })
      continue
    }
    if (slot.kind === 'value') continue
    // Two slots on one step hold it to the Nodes both name.
    const before = nodes[slot.step]
    nodes[slot.step] = before ? before.filter((path) => held.includes(path)) : [...held]
  }
  return { nodes, ...(values.length > 0 ? { values } : {}) }
}

/** A definition's name as a title: `issueInProject` reads "Issue in project". */
export function titleOf(definition: Pick<DefinitionLink, 'id' | 'name'>): string {
  const name = definition.name ?? definition.id.split('.').pop() ?? definition.id
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .toLowerCase()
    .trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
