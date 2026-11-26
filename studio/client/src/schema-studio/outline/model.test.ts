import type { IrMethod } from '@shared/contracts/schema'

import { expect, test } from 'bun:test'

import { bundle, classRef, edgeClass, nodeClass, nodePath } from '../__tests__/fixture'
import { buildOutline, type OutlineNode } from './model'

const DOMAIN = 'local.example.dev'
const policy = (name: string) => ({ origin: DOMAIN, kind: 'policy' as const, name })
const method = (name: string, input: Partial<IrMethod> = {}): IrMethod => ({
  name,
  input: {},
  output: { mode: 'value', schema: {} },
  static: false,
  abstract: false,
  executable: true,
  ...input,
})

const fixture = bundle({
  Issue: nodeClass('Issue', {
    icon: '<svg><path d="M0 0"/></svg>',
    policies: { read: policy('SeeIssue'), traverse: policy('SeeIssue') },
    methods: {
      rename: method('rename', {
        policy: { check: policy('EditIssue'), object: { kind: 'self' } },
      }),
      archive: method('archive'),
      find: method('find', { static: true }),
    },
  }),
  Comment: nodeClass('Comment'),
  issue_has_comment: edgeClass('issue_has_comment', [
    { name: 'issue', types: ['Issue'], cardinality: { min: 0, max: null } },
    { name: 'comment', types: ['Comment'], cardinality: { min: 1, max: 1 } },
  ]),
  issue_subtask_of: {
    ...edgeClass('issue_subtask_of', [
      { name: 'subtask', types: ['Issue'], cardinality: { min: 0, max: 1 } },
      { name: 'parent', types: ['Issue'] },
    ]),
    constraints: { noSelf: true, acyclic: true },
    policies: { read: policy('SeeIssue') },
  },
})
fixture.ir!.functions = {
  report: {
    name: 'report',
    input: { type: 'object', properties: { issue: nodePath(classRef(DOMAIN, 'Issue')) } },
    output: { mode: 'value', schema: {} },
  },
}
fixture.ir!.views = { Board: { name: 'Board' } }
fixture.ir!.policies = { SeeIssue: {}, EditIssue: {}, Composed: {} }
for (const [key, file] of Object.entries({
  'class.Issue': 'schema/modules/issue/classes/issue.ts',
  'class.Comment': 'schema/modules/comment/classes/comment.ts',
  'edge.issue_has_comment': 'schema/modules/issue/edges/issue-has-comment.ts',
  'edge.issue_subtask_of': 'schema/modules/issue/edges/issue-subtask-of.ts',
  'function.report': 'schema/modules/issue/functions/report.ts',
  'view.Board': 'schema/modules/issue/views/board.ts',
  'policy.SeeIssue': 'schema/modules/issue/policies/see-issue.ts',
  'policy.EditIssue': 'schema/modules/issue/policies/edit-issue.ts',
  'policy.Composed': 'schema/modules/issue/policies/composed.ts',
}))
  fixture.overlay.sourceSpans[key] = { file, startLine: 1, endLine: 2 }
fixture.overlay.definitions = [
  {
    kind: 'query',
    id: 'issues.issue.in-project',
    name: 'issueInProject',
    file: 'queries/issue.ts',
    line: 1,
    classes: ['Issue'],
  },
  // the id's module segment places it, whatever Class `build` names first
  {
    kind: 'mutation',
    id: 'issues.comment.delete',
    file: 'mutations/comment.ts',
    line: 1,
    classes: ['Issue', 'Comment'],
  },
  // an id that names no module: the first local Class places it
  {
    kind: 'query',
    id: 'issues.thread.latest',
    name: 'latestThread',
    file: 'queries/thread.ts',
    line: 1,
    classes: ['Comment'],
  },
]
fixture.overlay.handlerLinks = [
  {
    owner: 'Issue',
    ownerKind: 'class',
    kind: 'action',
    method: 'rename',
    static: false,
    implemented: true,
    definitions: ['issues.issue.in-project'],
    calls: ['Issue.archive'],
  },
]

/** The tree as `kind label` lines, children indented under their parent. */
function shape(nodes: readonly OutlineNode[], depth = 0): string[] {
  return nodes.flatMap((node) => [
    `${'  '.repeat(depth)}${node.kind} ${node.label}${node.detail ? ` (${node.detail})` : ''}`,
    ...shape(node.children, depth + 1),
  ])
}

test('the relational lens shows each module flat: node Classes with their data rules, then relationships', () => {
  expect(shape(buildOutline({ bundle: fixture, lens: 'relational' }))).toEqual([
    'module Comment',
    '  class Comment',
    'module Issue',
    '  class Issue',
    '    rule read (SeeIssue)',
    '    rule traverse (SeeIssue)',
    // each end carries its own count; an unconstrained one says nothing
    '  link issue_has_comment (Issue → 1 Comment)',
    '  link issue_subtask_of (Issue 0..1 → Issue · no self · acyclic)',
    '    rule read (SeeIssue)',
  ])
})

test('the functional lens shows what runs, flat, each function beside its anchor', () => {
  expect(shape(buildOutline({ bundle: fixture, lens: 'functional' }))).toEqual([
    'module Comment',
    '  query latestThread (issues.thread.latest)',
    '  mutation issues.comment.delete',
    'module Issue',
    '  function archive (Issue)',
    '  function find (Issue · static)',
    '  function rename (Issue)',
    '    function Issue.archive (calls)',
    '    query issueInProject (uses)',
    '    rule EditIssue (policy)',
    // a Domain function is anchored on the Classes its contract names
    '  function report (Issue)',
    '  query issueInProject (issues.issue.in-project)',
    '    function Issue.rename (used by)',
    '  view Board',
  ])
})

test('every row opens a Studio selection, and references are told apart from homes', () => {
  const [, issue] = buildOutline({ bundle: fixture, lens: 'relational' })
  expect(issue).toMatchObject({ id: 'module:modules/issue', target: 'module.modules/issue' })
  const [issueClass, hasComment] = issue!.children
  expect(issueClass).toMatchObject({
    target: 'class.Issue',
    svg: '<svg><path d="M0 0"/></svg>',
  })
  expect(issueClass!.reference).toBeUndefined()
  expect(hasComment).toMatchObject({ target: 'class.issue_has_comment' })
  expect(hasComment!.reference).toBeUndefined()
  expect(issueClass!.children[0]).toMatchObject({
    target: `policy.${DOMAIN}:policy.SeeIssue`,
    reference: true,
  })

  const [, running] = buildOutline({ bundle: fixture, lens: 'functional' })
  const byLabel = (label: string) => running!.children.find((node) => node.label === label)!
  // a method opens the Class that declares it; a Domain function opens itself
  expect(byLabel('rename')).toMatchObject({ target: 'class.Issue' })
  expect(byLabel('report')).toMatchObject({ target: 'function.report' })
  expect(byLabel('rename').children.at(-1)).toMatchObject({
    target: `policy.${DOMAIN}:policy.EditIssue`,
    reference: true,
  })
})

test('a definition opens as itself, from its home row and from each function that uses it', () => {
  const [, issue] = buildOutline({ bundle: fixture, lens: 'functional' })
  const query = issue!.children.find((node) => node.kind === 'query')!
  expect(query).toMatchObject({ target: 'query.issues.issue.in-project' })
  expect(query.reference).toBeUndefined()
  const rename = issue!.children.find((node) => node.label === 'rename')!
  expect(rename.children.find((node) => node.kind === 'query')).toMatchObject({
    target: 'query.issues.issue.in-project',
    reference: true,
  })
})

test('a relationship end is read by exact ref, and an imported end and rule are named with their Domain', () => {
  const imported = bundle({
    Role: nodeClass('Role'),
    Fleet: nodeClass('Fleet', {
      policies: { read: { ...policy('SeeFleet'), origin: 'shell.example.dev' } },
    }),
    uses_fleet: edgeClass('uses_fleet', [
      { name: 'principal', types: ['Role'], refs: [classRef('shell.example.dev', 'Role')] },
      { name: 'fleet', types: ['Fleet'], refs: [classRef(DOMAIN, 'Fleet')] },
    ]),
  })
  expect(shape(buildOutline({ bundle: imported, lens: 'relational' }))).toEqual([
    'class Fleet',
    '  rule read (shell:SeeFleet)',
    'class Role',
    'link uses_fleet (shell:Role → Fleet)',
  ])
})

test('an empty bundle has no outline', () => {
  expect(buildOutline({ bundle: { ...fixture, ir: null }, lens: 'functional' })).toEqual([])
})
