import type { IrClass, IrDefinitionRef, SchemaIR, StudioSchemaBundle } from '@shared/types'

import { describe, expect, test } from 'bun:test'

import {
  buildModuleTree,
  domainInterfacesOf,
  externalInterfaceOrigin,
  folderModules,
  implementedInterfaceRefsOf,
  interfaceBadge,
  interfaceIdentity,
  interfaceSelectionId,
  moduleMembers,
  moduleOfClass,
  parseInterfaceSelectionToken,
} from './modules'

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
      functions: {},
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

test('keeps implemented interfaces qualified across origin and kind collisions', () => {
  const localShared = {
    origin: 'example.test',
    kind: 'interface',
    name: 'Shared',
  } satisfies IrDefinitionRef
  const externalShared = {
    origin: 'dependency.example.dev',
    kind: 'interface',
    name: 'Shared',
  } satisfies IrDefinitionRef
  const otherExternalShared = {
    origin: 'other.example.dev',
    kind: 'interface',
    name: 'Shared',
  } satisfies IrDefinitionRef
  const externalClassCollision = {
    origin: 'dependency.example.dev',
    kind: 'class',
    name: 'Shared',
  } satisfies IrDefinitionRef
  const kernelNamed = {
    origin: 'kernel.astrale.ai',
    kind: 'interface',
    name: 'Named',
  } satisfies IrDefinitionRef
  const input = bundle(
    {
      Record: {
        ...node('Record'),
        implements: ['Shared', 'Shared', 'Shared', 'Named'],
        implementsRefs: [localShared, externalShared, otherExternalShared, kernelNamed],
      },
    },
    { 'class.Record': '/domains/example/schema/record.ts' },
  )
  input.ir!.interfaces.Shared = {
    type: 'interface',
    name: 'Shared',
    origin: input.ir!.domain,
    ref: localShared,
    properties: {},
    methods: {},
  }
  input.ir!.importsByKey = {
    'dependency.example.dev:interface.Shared': {
      origin: externalShared.origin,
      definition: 'interface',
      ref: externalShared,
    },
    'dependency.example.dev:class.Shared': {
      origin: externalClassCollision.origin,
      definition: 'class',
      ref: externalClassCollision,
    },
    'other.example.dev:interface.Shared': {
      origin: otherExternalShared.origin,
      definition: 'interface',
      ref: otherExternalShared,
    },
    'kernel.astrale.ai:interface.Named': {
      origin: kernelNamed.origin,
      definition: 'interface',
      ref: kernelNamed,
    },
  }

  expect(implementedInterfaceRefsOf(input, 'Record')).toEqual([
    localShared,
    externalShared,
    otherExternalShared,
    kernelNamed,
  ])
  expect(domainInterfacesOf(input, 'Record')).toEqual([
    localShared,
    externalShared,
    otherExternalShared,
  ])
  expect([externalShared, otherExternalShared].map(interfaceIdentity)).toEqual([
    'dependency.example.dev:interface.Shared',
    'other.example.dev:interface.Shared',
  ])
  expect(
    [externalShared, otherExternalShared].map((ref) => interfaceSelectionId(ref, input.ir!.domain)),
  ).toEqual([
    'interface.dependency.example.dev:interface.Shared',
    'interface.other.example.dev:interface.Shared',
  ])
  expect(interfaceSelectionId(localShared, input.ir!.domain)).toBe('interface.Shared')
  expect(parseInterfaceSelectionToken('dependency.example.dev:interface.$Shared')).toEqual({
    origin: 'dependency.example.dev',
    kind: 'interface',
    name: '$Shared',
  })
  expect(externalInterfaceOrigin(input, externalShared)).toBe('dependency.example.dev')
  expect(externalInterfaceOrigin(input, externalClassCollision)).toBeNull()
  expect(externalInterfaceOrigin(input, 'Shared')).toBeNull()
})

test('keeps legacy interface badges on their short-name selection path', () => {
  const input = bundle(
    {
      Record: {
        ...node('Record'),
        implements: ['Shared'],
      },
    },
    { 'class.Record': '/domains/example/schema/record.ts' },
  )
  input.ir!.imports.Shared = {
    origin: 'dependency.example.dev',
    definition: 'interface',
  }

  expect(domainInterfacesOf(input, 'Record')).toEqual(['Shared'])
  expect(interfaceBadge('Shared', input.ir!.domain)).toEqual({
    name: 'Shared',
    identity: 'legacy:interface.Shared',
    selectionId: 'interface.Shared',
  })
})
