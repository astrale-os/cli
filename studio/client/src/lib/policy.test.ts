import type { SchemaIR } from '@shared/types'

import { expect, test } from 'bun:test'

import {
  decodePolicy,
  decodePolicyCheck,
  indexPolicies,
  patternTerms,
  policyCheckLeaves,
  policyGuard,
  policyUsage,
} from './policy'

const ORIGIN = 'org.example.dev'
const ref = (kind: 'class' | 'policy', name: string, origin = ORIGIN) => ({ origin, kind, name })

const observeGroup = {
  ref: ref('policy', 'ObserveGroup'),
  description: 'The subject administers this perimeter.',
  expression: {
    match: { source: { kind: 'subject' }, class: ref('class', 'owns'), target: { kind: 'object' } },
  },
}
const observeRecord = {
  ref: ref('policy', 'ObserveRecord'),
  expression: {
    match: {
      exists: {
        nodes: [{ variable: { kind: 'variable', id: 0 }, class: ref('class', 'Group') }],
        where: {
          allOf: [
            {
              source: { kind: 'subject' },
              class: ref('class', 'owns'),
              target: { kind: 'variable', id: 0 },
            },
            {
              source: { kind: 'object' },
              class: ref('class', 'belongs'),
              target: { kind: 'variable', id: 0 },
            },
          ],
        },
      },
    },
  },
}
const traverseMembership = {
  ref: ref('policy', 'TraverseMembership'),
  expression: {
    match: { source: { kind: 'subject' }, class: ref('class', 'owns'), target: { kind: 'target' } },
  },
}
const either = {
  ref: ref('policy', 'Either'),
  expression: { anyOf: [ref('policy', 'ObserveGroup'), ref('policy', 'ObserveRecord')] },
}

test('decodes the V1 policy shapes and rejects what it cannot read', () => {
  expect(decodePolicy(ORIGIN, 'ObserveGroup', observeGroup)).toEqual(observeGroup as never)
  expect(decodePolicy(ORIGIN, 'ObserveRecord', observeRecord)).toEqual(observeRecord as never)
  // a missing ref falls back to the domain + name
  const bare = decodePolicy(ORIGIN, 'Bare', { expression: observeGroup.expression })
  expect(bare?.ref).toEqual(ref('policy', 'Bare'))
  expect(
    decodePolicy(ORIGIN, 'x', { expression: { match: { source: { kind: 'subject' } } } }),
  ).toBeUndefined()
  expect(decodePolicy(ORIGIN, 'x', { expression: { not: {} } })).toBeUndefined()
  expect(
    decodePolicy(ORIGIN, 'x', {
      expression: {
        match: {
          source: { kind: 'subject' },
          class: ref('class', 'owns'),
          target: { kind: 'object' },
          repeat: { min: 2, max: 1 },
        },
      },
    }),
  ).toBeUndefined()
})

test('decodes callable checks and lists their leaves', () => {
  const check = decodePolicyCheck({
    anyOf: [
      { check: ref('policy', 'ObserveGroup'), object: { kind: 'self' } },
      {
        allOf: [
          { check: ref('policy', 'ObserveRecord'), object: { kind: 'input', field: 'record' } },
          {
            check: ref('policy', 'Either'),
            object: { kind: 'ref', ref: { origin: ORIGIN, kind: 'core', name: 'root' } },
          },
        ],
      },
    ],
  })
  expect(check).toBeDefined()
  expect(policyCheckLeaves(check!).map((leaf) => [leaf.check.name, leaf.object.kind])).toEqual([
    ['ObserveGroup', 'self'],
    ['ObserveRecord', 'input'],
    ['Either', 'ref'],
  ])
  expect(
    decodePolicyCheck({ check: ref('policy', 'X'), object: { kind: 'elsewhere' } }),
  ).toBeUndefined()
})

test('tells node policies, edge policies and subject-only policies apart, through composition', () => {
  const index = indexPolicies({
    domain: ORIGIN,
    policies: {
      ObserveGroup: observeGroup,
      ObserveRecord: observeRecord,
      TraverseMembership: traverseMembership,
      Either: either,
      Broken: { expression: 42 },
    },
  })
  expect(index.policies.map((policy) => policy.ref.name)).toEqual([
    'ObserveGroup',
    'ObserveRecord',
    'TraverseMembership',
    'Either',
  ])
  expect(index.unsupported).toEqual(['Broken'])
  const guard = (name: string) => policyGuard(index.byKey.get(`${ORIGIN}:policy.${name}`)!, index)
  expect(guard('ObserveGroup')).toBe('object')
  expect(guard('ObserveRecord')).toBe('object')
  expect(guard('TraverseMembership')).toBe('edge')
  expect(guard('Either')).toBe('object')
  expect([...patternTerms(traverseMembership.expression.match as never)]).toEqual([
    'subject',
    'target',
  ])
})

test('finds where a policy is used: protected classes and checking callables', () => {
  const ir = {
    domain: ORIGIN,
    classes: {
      Group: {
        name: 'Group',
        type: 'node',
        policies: { read: ref('policy', 'ObserveGroup') },
        methods: {
          rename: {
            name: 'rename',
            policy: { check: ref('policy', 'ObserveGroup'), object: { kind: 'self' } },
          },
          archive: { name: 'archive' },
        },
      },
      belongs: {
        name: 'belongs',
        type: 'edge',
        policies: { traverse: ref('policy', 'ObserveGroup') },
        methods: {},
      },
    },
    functions: {
      createRecord: {
        name: 'createRecord',
        policy: {
          allOf: [
            { check: ref('policy', 'ObserveGroup'), object: { kind: 'input', field: 'group' } },
            { check: ref('policy', 'ObserveRecord'), object: { kind: 'input', field: 'group' } },
          ],
        },
      },
    },
    policies: { ObserveGroup: observeGroup },
  } as unknown as SchemaIR
  const usage = policyUsage(ir, decodePolicy(ORIGIN, 'ObserveGroup', observeGroup)!)
  expect(usage.classes).toEqual([
    { className: 'Group', type: 'node', operation: 'read' },
    { className: 'belongs', type: 'edge', operation: 'traverse' },
  ])
  expect(usage.callables).toEqual([
    {
      owner: 'Group',
      ownerKind: 'class',
      name: 'rename',
      object: { kind: 'self' },
      composed: false,
    },
    {
      owner: ORIGIN,
      ownerKind: 'function',
      name: 'createRecord',
      object: { kind: 'input', field: 'group' },
      composed: true,
    },
  ])
})
