import type { IrClass, SchemaIR, StudioSchemaBundle } from '@shared/types'

import { describe, expect, test } from 'bun:test'

import { buildModuleTree, folderModules, moduleMembers, moduleOfClass } from './modules'

const node = (name: string): IrClass => ({
  type: 'node',
  name,
  properties: {},
  methods: {},
})

const edge = (name: string): IrClass => ({
  type: 'edge',
  name,
  properties: {},
  methods: {},
  endpoints: [],
})

function bundle(classes: SchemaIR['classes'], files: Record<string, string>): StudioSchemaBundle {
  return {
    domainId: 'example',
    schemaHash: 'test',
    extractedBy: 'runtime-bun',
    depsInstalled: true,
    ir: {
      version: '1',
      domain: 'example.test',
      types: {},
      interfaces: {},
      classes,
      imports: {},
    },
    overlay: {
      origin: 'example.test',
      requires: [],
      crossDomainImports: [],
      mixins: [],
      handlerLinks: [],
      sourceSpans: Object.fromEntries(
        Object.entries(files).map(([member, file]) => [member, { file, startLine: 1, endLine: 1 }]),
      ),
      annotations: [],
    },
    extractedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('schema folder modules', () => {
  const issues = bundle(
    {
      Comment: node('Comment'),
      comment_by: edge('comment_by'),
      issue_has_comment: edge('issue_has_comment'),
      Issue: node('Issue'),
      issue_assigned_to: edge('issue_assigned_to'),
      Tag: node('Tag'),
      issue_tagged: edge('issue_tagged'),
    },
    {
      'class.Comment': '/domains/issues/schema/comments/comment.ts',
      'edge.comment_by': '/domains/issues/schema/comments/comment-author.ts',
      'edge.issue_has_comment': '/domains/issues/schema/comments/issue-comment.ts',
      'class.Issue': '/domains/issues/schema/issue/issue.ts',
      'edge.issue_assigned_to': '/domains/issues/schema/issue/issue-assignment.ts',
      'class.Tag': '/domains/issues/schema/tags/tag.ts',
      'edge.issue_tagged': '/domains/issues/schema/tags/issue-tag.ts',
    },
  )

  test('uses containing folders as modules and omits source-file tree nodes', () => {
    const tree = buildModuleTree(issues)

    expect(
      tree.children.map((folder) => ({
        name: folder.name,
        path: folder.path,
        children: folder.children.map((child) => child.name),
        members: folder.members.map((member) => member.name),
      })),
    ).toEqual([
      {
        name: 'comments',
        path: 'comments',
        children: [],
        members: ['Comment', 'comment_by', 'issue_has_comment'],
      },
      {
        name: 'issue',
        path: 'issue',
        children: [],
        members: ['Issue', 'issue_assigned_to'],
      },
      {
        name: 'tags',
        path: 'tags',
        children: [],
        members: ['Tag', 'issue_tagged'],
      },
    ])
  })

  test('groups the canvas and selection by folder while retaining source metadata', () => {
    expect(
      folderModules(issues).map(({ path, label, classes, edges }) => ({
        path,
        label,
        classes,
        edges,
      })),
    ).toEqual([
      {
        path: 'comments',
        label: 'comments',
        classes: ['Comment'],
        edges: ['comment_by', 'issue_has_comment'],
      },
      {
        path: 'issue',
        label: 'issue',
        classes: ['Issue'],
        edges: ['issue_assigned_to'],
      },
      {
        path: 'tags',
        label: 'tags',
        classes: ['Tag'],
        edges: ['issue_tagged'],
      },
    ])
    expect(moduleOfClass(issues, 'Issue')).toBe('issue')
    expect(moduleMembers(issues, 'issue').files).toEqual(['issue/issue', 'issue/issue-assignment'])
  })

  test('represents root-level schema files as one schema folder module', () => {
    const rootFiles = bundle(
      { Agent: node('Agent'), agent_calls: edge('agent_calls') },
      {
        'class.Agent': '/domains/agents/schema/agent.ts',
        'edge.agent_calls': '/domains/agents/schema/agent-contract.ts',
      },
    )

    const tree = buildModuleTree(rootFiles)
    expect(tree.children).toHaveLength(1)
    expect(tree.children[0]).toMatchObject({
      name: 'schema',
      path: 'root',
      children: [],
    })
    expect(tree.children[0].members.map((member) => member.name)).toEqual(['Agent', 'agent_calls'])
    expect(folderModules(rootFiles)).toMatchObject([
      {
        path: 'root',
        label: 'schema',
        classes: ['Agent'],
        edges: ['agent_calls'],
      },
    ])
  })
})
