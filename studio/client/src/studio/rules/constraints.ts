import type { Bundle, RuleExpr, RulesDocument, RuleValue } from '@astrale-os/visual'

import { unread, type Unread } from './catalogue'

/**
 * The fixed constraints a Schema declares on its own Classes (end counts, `noSelf`, `acyclic`,
 * unique tuples, `immutable` and `auto` Properties) as invariants, so the reader words them as it
 * words every rule. A declaration the reader has no form for is returned with why, never left out.
 *
 * An invariant is written twice, side by side: as the Rules language writes it (its `document`,
 * what an author writes and the rule's source) and in the reader's notation (what is read). The
 * Rules language names a Class by its Schema name in the root's origin alone; an end accepts
 * Classes of any Domain the root depends on (Kernel `Identity`, Issues `Project`), and the
 * notation names any Class of the Bundle by its Key (`⊑⟨key⟩`, the Class and those extending it,
 * as a Rules binder reads a name). So every invariant is read from its notation.
 */

type Root = Bundle['root']
type ClassDefinition = Root['classes'][string]
type EdgeDefinition = Extract<ClassDefinition, { readonly kind: 'edge' }>
type Endpoint = EdgeDefinition['endpoints'] extends infer E
  ? E extends readonly (infer End)[]
    ? End
    : E[keyof E]
  : never
type ClassRef = Endpoint['accepts'][number]

/** One constraint of a Class: the declaration as the Schema writes it, and its invariant or why it has none. */
export interface Constraint {
  /** The root Class (node or Edge) that declares it, by its name. */
  readonly owner: string
  readonly ownerKind: 'node' | 'edge'
  /** The declaration in the Schema's own terms: `noSelf`, `comment · incoming 1`, `unique (source, target)`. */
  readonly declaration: string
  readonly written: Invariant | Unread
}

/** One invariant, as the Rules language writes it and in the reader's notation (see above). */
export interface Invariant {
  readonly document: RulesDocument
  readonly notation: string
}

type Count = '0..*' | '1..*' | '0..1' | '1'

const BOUNDS: Record<Exclude<Count, '0..*'>, { atLeast?: number; atMost?: number }> = {
  '1': { atLeast: 1, atMost: 1 },
  '0..1': { atMost: 1 },
  '1..*': { atLeast: 1 },
}

/** How the notation quantifies each bounded count. */
const QUANTIFIERS: Record<Exclude<Count, '0..*'>, string> = {
  '1': '∃=1',
  '0..1': '∃≤1',
  '1..*': '∃',
}

const invariant = (name: string, holds: RuleExpr, notation: string): Invariant => ({
  document: { rule: 'invariant', name, holds },
  notation: `constraint ${notation}`,
})

/** The Classes an end accepts, by their Schema names: what a Rules binder reads. */
const namesOf = (accepts: readonly ClassRef[]) => [...new Set(accepts.map((ref) => ref.name))]

/** A Class by its Key, as the notation names it: `⟨<origin>:class.<Name>⟩`. */
const keyOf = (ref: ClassRef) => `⟨${ref.origin}:class.${ref.name}⟩`

/** The Classes an end accepts, each with those extending it, by Key: what a notation binder reads. */
const classesOf = (accepts: readonly ClassRef[]) =>
  [...new Set(accepts.map((ref) => `⊑${keyOf(ref)}`))].join(' | ')

const end = (edge: string, role: 'source' | 'target'): RuleValue => ({ end: edge, role })

/** The short name of a Property Key: `<origin>:class.<Owner>.property.<name>`. */
const propertyName = (key: string) => key.slice(key.lastIndexOf('.property.') + '.property.'.length)

export function constraintsOf(root: Root): Constraint[] {
  const out: Constraint[] = []
  for (const [name, definition] of Object.entries(root.classes)) {
    const add = (declaration: string, written: Invariant | Unread) =>
      out.push({ owner: name, ownerKind: definition.kind, declaration, written })
    const own: ClassRef = { kind: 'class', origin: root.origin, name }
    if (definition.kind === 'edge') edgeConstraints(own, definition, add)
    else
      for (const tuple of definition.unique ?? []) {
        const fields = tuple.map(propertyName)
        add(
          `unique (${fields.join(', ')})`,
          invariant(
            `${name} unique (${fields.join(', ')})`,
            {
              every: { var: 'x', class: name },
              holds: {
                some: {
                  var: 'y',
                  class: name,
                  where: {
                    all: fields.map((field) => ({
                      cmp: '=',
                      left: `$y.${field}`,
                      right: `$x.${field}`,
                    })),
                  },
                },
                atMost: 1,
              },
            },
            `∀ x: ${classesOf([own])} . ∃≤1 y: ${classesOf([own])} [${fields.map((field) => `y.${field} = x.${field}`).join(' ∧ ')}]`,
          ),
        )
      }
    for (const [property, declared] of Object.entries(definition.properties)) {
      if (declared.immutable !== undefined)
        add(
          `${property} · immutable ${declared.immutable}`,
          unread(
            'not-expressible',
            declared.immutable === 'create'
              ? `${property} is written only when its ${definition.kind === 'edge' ? 'Edge' : 'Node'} is created: an invariant reads one graph, and this compares a write with the graph before it.`
              : `${property} is written while it has no value and never unset: an invariant reads one graph, and this compares a write with the graph before it.`,
          ),
        )
      if (declared.auto !== undefined)
        add(
          `${property} · auto on ${declared.auto.on.join(', ')}`,
          unread(
            'not-expressible',
            `The Kernel sets ${property} to the instant of each ${declared.auto.on.join(' and ')}: an invariant reads one graph, and this is a write's effect.`,
          ),
        )
    }
  }
  return out
}

function edgeConstraints(
  own: ClassRef,
  edge: EdgeDefinition,
  add: (declaration: string, written: Invariant | Unread) => void,
) {
  const { name } = own
  const edges = classesOf([own])
  if (edge.constraints.noSelf)
    add(
      'noSelf',
      invariant(
        `${name} noSelf`,
        {
          none: { var: 'e', class: name, edge: true },
          holds: { same: [end('e', 'source'), end('e', 'target')] },
        },
        `∄ e: ${edges} [source(e) ≡ target(e)]`,
      ),
    )
  if (edge.orientation === 'directed') {
    const { source, target } = edge.endpoints
    if (edge.constraints.acyclic) {
      const ends = [...source.accepts, ...target.accepts]
      add(
        'acyclic',
        invariant(
          `${name} acyclic`,
          {
            none: { var: 'x', class: namesOf(ends) },
            holds: { reaches: { repeat: name, min: 1 }, from: '$x', to: '$x' },
          },
          `∄ x: ${classesOf(ends)} [reaches(x, x, ${keyOf(own)}{1..})]`,
        ),
      )
    }
    const counted = (
      role: 'source' | 'target',
      count: Count,
      accepts: readonly ClassRef[],
      word: string,
    ) => {
      if (count === '0..*') return
      add(
        `${role === 'source' ? source.role : target.role} · ${word} ${count}`,
        invariant(
          `${name} ${role} ${count}`,
          {
            every: { var: 'x', class: namesOf(accepts) },
            holds: {
              some: { var: 'e', class: name, edge: true, where: { same: [end('e', role), '$x'] } },
              ...BOUNDS[count],
            },
          },
          `∀ x: ${classesOf(accepts)} . ${QUANTIFIERS[count]} e: ${edges} [${role}(e) ≡ x]`,
        ),
      )
    }
    counted('source', source.outgoing, source.accepts, 'outgoing')
    counted('target', target.incoming, target.accepts, 'incoming')
    for (const tuple of edge.unique ?? []) {
      const fields = tuple.map((field) =>
        typeof field === 'string' ? field : propertyName(field.property),
      )
      const declaration = `unique (${fields.join(', ')})`
      if (tuple.includes('slug')) {
        add(
          declaration,
          unread(
            'not-expressible',
            'The Rules language reads no Edge slug, so a key tuple that names one has no invariant.',
          ),
        )
        continue
      }
      add(
        declaration,
        invariant(
          `${name} ${declaration}`,
          {
            every: { var: 'e', class: name, edge: true },
            holds: {
              some: {
                var: 'f',
                class: name,
                edge: true,
                where: {
                  all: tuple.map((field): RuleExpr =>
                    typeof field === 'string'
                      ? {
                          same: [
                            end('f', field as 'source' | 'target'),
                            end('e', field as 'source' | 'target'),
                          ],
                        }
                      : {
                          cmp: '=',
                          left: `$f.${propertyName(field.property)}`,
                          right: `$e.${propertyName(field.property)}`,
                        },
                  ),
                },
              },
              atMost: 1,
            },
          },
          `∀ e: ${edges} . ∃≤1 f: ${edges} [${fields
            .map((field, at) =>
              typeof tuple[at] === 'string'
                ? `${field}(f) ≡ ${field}(e)`
                : `f.${field} = e.${field}`,
            )
            .join(' ∧ ')}]`,
        ),
      )
    }
    return
  }
  for (const incident of edge.endpoints) {
    const count = incident.incident as Count
    if (count === '0..*') continue
    add(
      `${incident.role} · incident ${count}`,
      invariant(
        `${name} ${incident.role} ${count}`,
        {
          every: { var: 'x', class: namesOf(incident.accepts) },
          holds: {
            some: {
              var: 'e',
              class: name,
              edge: true,
              where: {
                any: [{ same: [end('e', 'source'), '$x'] }, { same: [end('e', 'target'), '$x'] }],
              },
            },
            ...BOUNDS[count],
          },
        },
        `∀ x: ${classesOf(incident.accepts)} . ${QUANTIFIERS[count]} e: ${edges} [source(e) ≡ x ∨ target(e) ≡ x]`,
      ),
    )
  }
}
