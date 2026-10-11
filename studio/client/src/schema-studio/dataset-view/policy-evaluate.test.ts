import type { StudioCore, StudioSchemaBundle } from '@shared/types'

import { expect, test } from 'bun:test'

import { decodePolicy, decodePolicyCheck, indexPolicies, policyCheckLabel } from '@/lib/policy'

import { evaluatePolicy, groupProofs } from './policy-evaluate'
import { buildDataGraph } from './policy-graph'

const ORIGIN = 'org.example.dev'
const KERNEL = 'kernel.astrale.ai'
const ref = (kind: 'class' | 'policy', name: string, origin = ORIGIN) => ({ origin, kind, name })
/** A path term: `group` is the one Group variable an `exists` binds, anything else a role. */
const term = (kind: string) => (kind === 'group' ? { kind: 'variable', id: 0 } : { kind })
const step = (source: string, edge: string, target: string, extra = {}) => ({
  source: term(source),
  class: ref('class', edge),
  target: term(target),
  ...extra,
})
/** Some Group the subject owns, which the object reaches over `edge`. */
const viaGroup = (edge: string, extra = {}) => ({
  match: {
    exists: {
      nodes: [{ variable: term('group'), class: ref('class', 'Group') }],
      where: { allOf: [step('subject', 'owns', 'group'), step('object', edge, 'group', extra)] },
    },
  },
})
const node = (name: string, extendsRefs: unknown[] = []) =>
  ({ name, type: 'node', extendsRefs, methods: {}, properties: {} }) as const
const edge = (name: string, orientation = 'directed') =>
  ({ name, type: 'edge', orientation, methods: {}, properties: {} }) as const

// ── schema: User ⊂ Identity, Group, Record; owns (User→Group), belongs (Record→Group),
//    parent (Group→Group), linked (undirected Record—Record)
const bundle = {
  domainId: 'org',
  ir: {
    domain: ORIGIN,
    classes: {
      User: node('User', [ref('class', 'Identity', KERNEL)]),
      Group: node('Group'),
      Record: node('Record'),
      owns: edge('owns'),
      belongs: { ...edge('belongs'), policies: { traverse: ref('policy', 'TraverseMembership') } },
      parent: edge('parent'),
      linked: edge('linked', 'undirected'),
    },
    importedClassesByKey: {},
    importsByKey: {},
    functions: {},
    views: {},
    policies: {
      ObserveGroup: { expression: { match: step('subject', 'owns', 'object') } },
      ObserveRecord: { expression: viaGroup('belongs') },
      TraverseMembership: { expression: { match: step('subject', 'owns', 'target') } },
      ObserveAny: {
        expression: { anyOf: [ref('policy', 'ObserveGroup'), ref('policy', 'ObserveRecord')] },
      },
      ObserveTree: { expression: viaGroup('parent', { repeat: { min: 0, max: 2 } }) },
      Sibling: { expression: { match: step('object', 'linked', 'subject') } },
      Dangling: { expression: { allOf: [ref('policy', 'Missing')] } },
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
const evaluate = (name: string, input: Partial<Parameters<typeof evaluatePolicy>[0]> = {}) =>
  evaluatePolicy({ policy: policy(name), index, graph, ...input })
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
  const result = evaluate('ObserveGroup')
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
  const yes = evaluate('ObserveRecord', {
    probe: { subject: 'ada', object: { kind: 'node', id: 'r1' } },
  })
  expect(yes.status === 'ok' && yes.proofs.length).toBe(1)
  if (yes.status === 'ok') {
    expect(yes.proofs[0].edges).toEqual([0, 4])
    expect(yes.proofs[0].nodes.sort()).toEqual(['ada', 'g1', 'r1'])
  }
  const no = evaluate('ObserveRecord', {
    probe: { subject: 'ada', object: { kind: 'node', id: 'r2' } },
  })
  expect(no.status === 'ok' && no.proofs).toEqual([])
})

test('lists who can, given only the object', () => {
  const result = evaluate('ObserveAny', { probe: { object: { kind: 'node', id: 'r2' } } })
  expect(result.status === 'ok' && pairs(result.proofs)).toEqual(['bob→{"kind":"node","id":"r2"}'])
})

test('an edge policy binds the protected edge endpoints and includes that edge in the proof', () => {
  const all = evaluate('TraverseMembership', { guardedEdges: ['belongs'] })
  expect(all.status === 'ok' && pairs(all.proofs)).toEqual([
    'ada→{"kind":"edge","index":4}',
    'bob→{"kind":"edge","index":5}',
  ])
  if (all.status === 'ok') expect(all.proofs[0].edges).toEqual([0, 4])
  const one = evaluate('TraverseMembership', {
    probe: { subject: 'ada', object: { kind: 'edge', index: 5 } },
  })
  expect(one.status === 'ok' && one.proofs).toEqual([])
  const wrong = evaluate('TraverseMembership', { probe: { object: { kind: 'node', id: 'g1' } } })
  expect(wrong.status).toBe('unsupported')
})

test('bounded repeats climb the tree, zero hops included', () => {
  const result = evaluate('ObserveTree', { probe: { subject: 'ada' } })
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
  const result = evaluate('Sibling')
  expect(result.status === 'ok' && pairs(result.proofs)).toEqual(['bob→{"kind":"node","id":"r1"}'])
})

test('a reference to an undeclared policy is reported, not thrown', () => {
  const result = evaluate('Dangling')
  expect(result).toEqual({
    status: 'unsupported',
    reason: 'references a policy this domain does not declare: Missing',
  })
})

test('groups proofs per subject and object', () => {
  const result = evaluate('ObserveTree')
  if (result.status !== 'ok') throw new Error(result.reason)
  const matches = groupProofs(result.proofs)
  const g2 = matches.find(
    (match) => match.subject === 'ada' && match.object?.kind === 'node' && match.object.id === 'g2',
  )!
  expect([...g2.edges]).toEqual([0, 2])
  expect(matches.length).toBe(5)
})

test('proves Node identity without edges and requires explicit Dataset references', () => {
  const fixed = { origin: ORIGIN, kind: 'core' as const, name: 'owner' }
  const equality = { sameNode: { left: { kind: 'subject' }, right: { kind: 'object' } } }
  const policy = decodePolicy(ORIGIN, 'Self', { expression: { match: equality } })!
  const index = indexPolicies({ domain: ORIGIN, policies: {} })
  const graph = buildDataGraph(core, bundle)
  const result = evaluatePolicy({
    policy,
    index,
    graph,
    probe: { subject: 'ada', object: { kind: 'node', id: 'ada' } },
  })
  expect(result).toMatchObject({
    status: 'ok',
    proofs: [{ subject: 'ada', edges: [], nodes: ['ada'] }],
  })
  expect(
    evaluatePolicy({
      policy,
      index,
      graph,
      probe: { subject: 'missing', object: { kind: 'node', id: 'missing' } },
    }),
  ).toMatchObject({ status: 'ok', proofs: [] })
  const referenced = decodePolicy(ORIGIN, 'Fixed', {
    expression: {
      match: {
        allOf: [
          equality,
          { sameNode: { left: { kind: 'object' }, right: { kind: 'ref', ref: fixed } } },
        ],
      },
    },
  })!
  expect(evaluatePolicy({ policy: referenced, index, graph })).toMatchObject({
    status: 'unsupported',
  })
  const explicit = buildDataGraph(core, bundle, { [`${ORIGIN}:core.owner`]: 'ada' })
  expect(evaluatePolicy({ policy: referenced, index, graph: explicit })).toMatchObject({
    status: 'ok',
    proofs: [{ subject: 'ada', edges: [] }],
  })
  const guard = decodePolicyCheck({
    sameNode: { left: { kind: 'input', field: 'group' }, right: { kind: 'ref', ref: fixed } },
  })!
  expect(policyCheckLabel(guard)).toBe('input.group is the same Node as core owner')
  expect(policyCheckLabel({ allOf: [guard, { anyOf: [guard, guard] }] })).toBe(
    '(input.group is the same Node as core owner and (input.group is the same Node as core owner or input.group is the same Node as core owner))',
  )
})
