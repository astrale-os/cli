import type { StudioCore, StudioSchemaBundle } from '@shared/types'

import { expect, test } from 'bun:test'

import { indexPolicies, type PolicyPattern } from '@/lib/policy'

import { MAX_EXPANDED_POLICY_DEPTH, evaluatePolicy, groupProofs } from './policy-evaluate'
import { buildDataGraph } from './policy-graph'

const ORIGIN = 'org.example.dev'
const KERNEL = 'kernel.astrale.ai'
const ref = (kind: 'class' | 'policy', name: string, origin = ORIGIN) => ({ origin, kind, name })

// ── schema: User ⊂ Identity, Group, Record; owns (User→Group), belongs (Record→Group),
//    parent (Group→Group), linked (undirected Record—Record)
const bundle = {
  domainId: 'org',
  ir: {
    domain: ORIGIN,
    classes: {
      User: {
        name: 'User',
        type: 'node',
        extendsRefs: [ref('class', 'Identity', KERNEL)],
        methods: {},
        properties: {},
      },
      Group: { name: 'Group', type: 'node', extendsRefs: [], methods: {}, properties: {} },
      Record: { name: 'Record', type: 'node', extendsRefs: [], methods: {}, properties: {} },
      owns: { name: 'owns', type: 'edge', orientation: 'directed', methods: {}, properties: {} },
      belongs: {
        name: 'belongs',
        type: 'edge',
        orientation: 'directed',
        methods: {},
        properties: {},
        policies: { traverse: ref('policy', 'TraverseMembership') },
      },
      parent: {
        name: 'parent',
        type: 'edge',
        orientation: 'directed',
        methods: {},
        properties: {},
      },
      linked: {
        name: 'linked',
        type: 'edge',
        orientation: 'undirected',
        methods: {},
        properties: {},
      },
    },
    importedClassesByKey: {},
    importsByKey: {},
    functions: {},
    views: {},
    policies: {
      ObserveGroup: {
        ref: ref('policy', 'ObserveGroup'),
        expression: {
          match: {
            source: { kind: 'subject' },
            class: ref('class', 'owns'),
            target: { kind: 'object' },
          },
        },
      },
      ObserveRecord: {
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
      },
      TraverseMembership: {
        ref: ref('policy', 'TraverseMembership'),
        expression: {
          match: {
            source: { kind: 'subject' },
            class: ref('class', 'owns'),
            target: { kind: 'target' },
          },
        },
      },
      ObserveAny: {
        ref: ref('policy', 'ObserveAny'),
        expression: { anyOf: [ref('policy', 'ObserveGroup'), ref('policy', 'ObserveRecord')] },
      },
      ObserveTree: {
        ref: ref('policy', 'ObserveTree'),
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
                    class: ref('class', 'parent'),
                    target: { kind: 'variable', id: 0 },
                    repeat: { min: 0, max: 2 },
                  },
                ],
              },
            },
          },
        },
      },
      Sibling: {
        ref: ref('policy', 'Sibling'),
        expression: {
          match: {
            source: { kind: 'object' },
            class: ref('class', 'linked'),
            target: { kind: 'subject' },
          },
        },
      },
      Dangling: {
        ref: ref('policy', 'Dangling'),
        expression: { allOf: [ref('policy', 'Missing')] },
      },
    },
    dependencies: [],
    core: null,
  },
} as unknown as StudioSchemaBundle

// ── data: ada owns g1; bob owns g2; g2 is a child of g1 (parent: g2→g1), g3 child of g2;
//    r1 belongs to g1; r2 belongs to g2; r1—linked—bob (undirected)
const core: StudioCore = {
  domain: ORIGIN,
  nodes: [
    { path: 'ada', className: 'User', data: { name: 'Ada' } },
    { path: 'bob', className: 'User', data: { name: 'Bob' } },
    { path: 'g1', className: 'Group', data: {} },
    { path: 'g2', className: 'Group', data: {} },
    { path: 'g3', className: 'Group', data: {} },
    { path: 'r1', className: 'Record', data: {} },
    { path: 'r2', className: 'Record', data: {} },
  ],
  edges: [
    { from: 'ada', to: 'g1', edgeName: 'owns' }, // 0
    { from: 'bob', to: 'g2', edgeName: 'owns' }, // 1
    { from: 'g2', to: 'g1', edgeName: 'parent' }, // 2
    { from: 'g3', to: 'g2', edgeName: 'parent' }, // 3
    { from: 'r1', to: 'g1', edgeName: 'belongs' }, // 4
    { from: 'r2', to: 'g2', edgeName: 'belongs' }, // 5
    { from: 'r1', to: 'bob', edgeName: 'linked' }, // 6
  ],
  extractedAt: '',
}

const graph = buildDataGraph(core, bundle)
const index = indexPolicies(bundle.ir!)
const policy = (name: string) => index.byKey.get(`${ORIGIN}:policy.${name}`)!
const pairs = (proofs: { subject: string | null; object: unknown }[]) =>
  proofs.map((proof) => `${proof.subject}→${JSON.stringify(proof.object)}`).sort()

test('the data graph knows classes, principals and orientations', () => {
  expect(graph.identities).toEqual(['ada', 'bob'])
  expect(graph.isInstance('g1', ref('class', 'Group'))).toBe(true)
  expect(graph.isInstance('ada', ref('class', 'Identity', KERNEL))).toBe(true)
  expect(graph.isInstance('r1', ref('class', 'Group'))).toBe(false)
  expect(graph.edges[6].undirected).toBe(true)
  expect(graph.outgoing.get('bob')?.map((edge) => edge.index)).toEqual([1, 6])
})

test('enumerates every proof of a one-step policy', () => {
  const result = evaluatePolicy({ policy: policy('ObserveGroup'), index, graph })
  expect(result.status).toBe('ok')
  if (result.status !== 'ok') return
  expect(pairs(result.proofs)).toEqual([
    'ada→{"kind":"node","id":"g1"}',
    'bob→{"kind":"node","id":"g2"}',
  ])
  expect(result.proofs[0].edges).toEqual([0])
  expect(result.proofs[0].nodes.sort()).toEqual(['ada', 'g1'])
})

test('decides a picked subject and object, and lights only their proof', () => {
  const yes = evaluatePolicy({
    policy: policy('ObserveRecord'),
    index,
    graph,
    probe: { subject: 'ada', object: { kind: 'node', id: 'r1' } },
  })
  expect(yes.status === 'ok' && yes.proofs.length).toBe(1)
  if (yes.status === 'ok') {
    expect(yes.proofs[0].edges).toEqual([0, 4])
    expect(yes.proofs[0].nodes.sort()).toEqual(['ada', 'g1', 'r1'])
  }
  const no = evaluatePolicy({
    policy: policy('ObserveRecord'),
    index,
    graph,
    probe: { subject: 'ada', object: { kind: 'node', id: 'r2' } },
  })
  expect(no.status === 'ok' && no.proofs).toEqual([])
})

test('lists who can, given only the object', () => {
  const result = evaluatePolicy({
    policy: policy('ObserveAny'),
    index,
    graph,
    probe: { object: { kind: 'node', id: 'r2' } },
  })
  expect(result.status === 'ok' && pairs(result.proofs)).toEqual(['bob→{"kind":"node","id":"r2"}'])
})

test('an edge policy binds the protected edge endpoints and includes that edge in the proof', () => {
  const all = evaluatePolicy({
    policy: policy('TraverseMembership'),
    index,
    graph,
    guardedEdges: ['belongs'],
  })
  expect(all.status === 'ok' && pairs(all.proofs)).toEqual([
    'ada→{"kind":"edge","index":4}',
    'bob→{"kind":"edge","index":5}',
  ])
  if (all.status === 'ok') expect(all.proofs[0].edges).toEqual([0, 4])
  const one = evaluatePolicy({
    policy: policy('TraverseMembership'),
    index,
    graph,
    probe: { subject: 'ada', object: { kind: 'edge', index: 5 } },
  })
  expect(one.status === 'ok' && one.proofs).toEqual([])
  const wrong = evaluatePolicy({
    policy: policy('TraverseMembership'),
    index,
    graph,
    probe: { object: { kind: 'node', id: 'g1' } },
  })
  expect(wrong.status).toBe('unsupported')
})

test('bounded repeats climb the tree, zero hops included', () => {
  const result = evaluatePolicy({
    policy: policy('ObserveTree'),
    index,
    graph,
    probe: { subject: 'ada' },
  })
  expect(result.status === 'ok' && pairs(result.proofs)).toEqual([
    'ada→{"kind":"node","id":"g1"}',
    'ada→{"kind":"node","id":"g2"}',
    'ada→{"kind":"node","id":"g3"}',
  ])
  if (result.status === 'ok') {
    const g3 = result.proofs.find(
      (proof) => proof.object?.kind === 'node' && proof.object.id === 'g3',
    )!
    expect(g3.edges).toEqual([0, 2, 3])
  }
})

test('undirected edges prove in either direction', () => {
  const result = evaluatePolicy({ policy: policy('Sibling'), index, graph })
  expect(result.status === 'ok' && pairs(result.proofs)).toEqual(['bob→{"kind":"node","id":"r1"}'])
})

test('a reference to an undeclared policy is reported, not thrown', () => {
  const result = evaluatePolicy({ policy: policy('Dangling'), index, graph })
  expect(result).toEqual({
    status: 'unsupported',
    reason: 'references a policy this domain does not declare: Missing',
  })
})

test('accepts total expanded Policy depth 8 and reports depth 9 as unsupported', () => {
  let pattern: PolicyPattern = {
    source: { kind: 'subject' },
    class: ref('class', 'owns'),
    target: { kind: 'object' },
  }
  for (let depth = 1; depth < 4; depth++) {
    pattern = depth % 2 === 0 ? { allOf: [pattern] } : { anyOf: [pattern] }
  }
  const policies: Record<string, unknown> = {
    Depth4: { ref: ref('policy', 'Depth4'), expression: { match: pattern } },
  }
  let previous = 'Depth4'
  for (let depth = 5; depth <= 9; depth++) {
    const name = `Depth${String(depth)}`
    policies[name] = {
      ref: ref('policy', name),
      expression:
        depth % 2 === 0
          ? { allOf: [ref('policy', previous)] }
          : { anyOf: [ref('policy', previous)] },
    }
    previous = name
  }
  const depthIndex = indexPolicies({ domain: ORIGIN, policies } as never)
  const at = (depth: number) => depthIndex.byKey.get(`${ORIGIN}:policy.Depth${String(depth)}`)!

  expect(MAX_EXPANDED_POLICY_DEPTH).toBe(8)
  expect(
    evaluatePolicy({
      policy: at(8),
      index: depthIndex,
      graph,
      probe: { subject: 'ada', object: { kind: 'node', id: 'g1' } },
    }).status,
  ).toBe('ok')
  expect(evaluatePolicy({ policy: at(9), index: depthIndex, graph })).toEqual({
    status: 'unsupported',
    reason: 'expanded policy depth 9 exceeds 8',
  })
})

test('groups proofs per subject and object', () => {
  const result = evaluatePolicy({ policy: policy('ObserveTree'), index, graph })
  if (result.status !== 'ok') throw new Error(result.reason)
  const matches = groupProofs(result.proofs)
  const g2 = matches.find(
    (match) => match.subject === 'ada' && match.object?.kind === 'node' && match.object.id === 'g2',
  )!
  expect([...g2.edges]).toEqual([0, 2])
  expect(matches.length).toBe(5)
})
