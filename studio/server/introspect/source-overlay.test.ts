import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DefinitionLink, IrClass, SchemaIR } from '../../shared/contracts/schema'

import { readDefinitions } from './source-overlay/definitions'
import { buildHandlerLinks } from './source-overlay/handlers'
import { readIntegrations } from './source-overlay/integrations'
import { newProject } from './source-overlay/project'
import { buildSourceSpans } from './source-overlay/spans'

const roots: string[] = []
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

/** A link without its input, which the tests of the input pin on their own. */
const withoutInput = ({ input: _input, ...link }: DefinitionLink) => link

const ir: SchemaIR = {
  version: 'v1',
  format: 'astrale.dsl',
  domain: 'issues.example',
  importsByKey: {},
  importedClassesByKey: {},
  classes: {
    Issue: {
      type: 'node',
      name: 'Issue',
      origin: 'issues.example',
      ref: { origin: 'issues.example', kind: 'class', name: 'Issue' },
      properties: {},
      methods: {
        rename: {
          name: 'rename',
          input: {},
          output: { mode: 'value', schema: {} },
          static: false,
          abstract: false,
          executable: true,
          auth: 'authorized',
        },
      },
    },
  },
  functions: {
    createIssue: {
      name: 'createIssue',
      input: {},
      output: { mode: 'value', schema: {} },
      auth: 'anonymous',
    },
  },
  views: {},
  policies: {},
  dependencies: [],
  core: {},
}

const trackerClass = (name: string, more: Partial<IrClass> = {}): IrClass => ({
  type: 'node',
  name,
  origin: 'tracker.example',
  ref: { origin: 'tracker.example', kind: 'class', name },
  properties: {},
  methods: {},
  ...more,
})
/** An Edge Class from its two ends: role, accepted Class, and how many of that end it allows. */
const trackerEdge = (
  name: string,
  ...ends: [[string, string, number | null], [string, string, number | null]]
): IrClass =>
  trackerClass(name, {
    type: 'edge',
    endpoints: ends.map(([role, accepts, max]) => ({
      name: role,
      types: [accepts],
      cardinality: { min: 0, max },
    })),
  })
const shellUser = { origin: 'shell.example', kind: 'class', name: 'User' } as const

/** Issues in Projects, with Comments, a status machine, and Shell Users. */
const tracker: SchemaIR = {
  ...ir,
  domain: 'tracker.example',
  classes: {
    Project: trackerClass('Project'),
    Issue: trackerClass('Issue', {
      properties: { title: { type: 'string' }, status: { type: 'string' } },
      propertyMetadata: {
        status: {
          state: {
            initial: 'open',
            transitions: {
              open: { close: 'closed', start: 'active' },
              active: { close: 'closed' },
              closed: { reopen: 'open' },
            },
          },
        },
      },
    }),
    Comment: trackerClass('Comment'),
    // an Issue is in one Project: `issue.project` reaches it
    project_contains_issue: trackerEdge(
      'project_contains_issue',
      ['project', 'Project', null],
      ['issue', 'Issue', 1],
    ),
    // a Comment is on one Issue: `comment.issue` reaches it
    issue_has_comment: trackerEdge(
      'issue_has_comment',
      ['issue', 'Issue', null],
      ['comment', 'Comment', 1],
    ),
  },
  importsByKey: {
    'shell.example:class.User': {
      origin: 'shell.example',
      ref: shellUser,
      key: 'shell.example:class.User',
    },
  },
  importedClassesByKey: {
    'shell.example:class.User': {
      ...trackerClass('User'),
      origin: 'shell.example',
      ref: shellUser,
    },
  },
  functions: {},
}

describe('source overlay', () => {
  test('locates registered policies and views in their authored modules, including aliases and inline declarations', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-module-overlay-'))
    roots.push(root)
    const schemaDir = join(root, 'schema')
    const moduleDir = join(schemaDir, 'modules/billing')
    mkdirSync(join(moduleDir, 'policies'), { recursive: true })
    mkdirSync(join(moduleDir, 'views'), { recursive: true })
    writeFileSync(
      join(moduleDir, 'policies/pay.ts'),
      `import { policy } from '@astrale-os/sdk/schema'
/** May settle billing. */
export const declaredPolicy = policy({ expression: {} })`,
    )
    writeFileSync(
      join(moduleDir, 'views/billing.ts'),
      `import { view } from '@astrale-os/sdk/schema'
export const declaredView = view({})`,
    )
    writeFileSync(
      join(schemaDir, 'index.ts'),
      `import { defineSchema, view } from '@astrale-os/sdk/schema'
import { declaredPolicy as guard } from './modules/billing/policies/pay.js'
import { declaredView } from './modules/billing/views/billing.js'
export const schema = defineSchema('example.dev', { name: 'Test Domain',
  policies: { MayPay: guard },
  views: { billing: declaredView, overview: view({}) },
})`,
    )
    const spans = buildSourceSpans({ ir: null, domainRoot: root, schemaDir })
    expect(spans['policy.MayPay']).toMatchObject({
      file: 'schema/modules/billing/policies/pay.ts',
      doc: 'May settle billing.',
    })
    expect(spans['view.billing']?.file).toBe('schema/modules/billing/views/billing.ts')
    expect(spans['view.overview']?.file).toBe('schema/index.ts')
    expect(spans['policy.guard']).toBeUndefined()
  })
  test('links each Action and Workflow, in any module, to its wiring, its handler and its calls', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-handler-links-'))
    roots.push(root)
    mkdirSync(join(root, 'functions'))
    writeFileSync(
      join(root, 'functions/impl.ts'),
      `\n\nexport const settle = async ({ input }) => graph.createEdge(input)\n`,
    )
    writeFileSync(
      join(root, 'functions/index.ts'),
      `import { defineAction } from '@astrale-os/sdk/action'
import { settle } from './impl.ts'

export const rename = defineAction()('Issue.rename', settle)
`,
    )
    writeFileSync(
      join(root, 'functions/create.ts'),
      `import { defineWorkflow } from '@astrale-os/sdk/workflow'
export const create = defineWorkflow()('createIssue', async ({ input }) => graph.create(input))
`,
    )

    expect(buildHandlerLinks({ ir, domainRoot: root })).toEqual([
      expect.objectContaining({
        owner: 'Issue',
        ownerKind: 'class',
        kind: 'action',
        method: 'rename',
        // the handler is imported: the declaration and the implementation live apart
        wiringFile: 'functions/index.ts',
        wiringLine: 4,
        handlerFile: 'functions/impl.ts',
        handlerLine: 3,
        // `graph.createEdge` is not also counted as `graph.create`
        kernelCalls: ['graph.createEdge'],
      }),
      expect.objectContaining({
        owner: 'issues.example',
        ownerKind: 'function',
        kind: 'workflow',
        method: 'createIssue',
        // the handler is inline: both sit in the declaring module
        wiringFile: 'functions/create.ts',
        wiringLine: 2,
        handlerFile: 'functions/create.ts',
        handlerLine: 2,
        kernelCalls: ['graph.create'],
      }),
    ])
  })

  test('reads Query and Mutation definitions and links each handler to the definitions and callables it reaches', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-definitions-'))
    roots.push(root)
    mkdirSync(join(root, 'queries'))
    mkdirSync(join(root, 'mutations'))
    mkdirSync(join(root, 'functions'))
    writeFileSync(
      join(root, 'queries/issue.ts'),
      `import { defineQuery } from '@astrale-os/sdk/query'

/** An Issue with its Project. */
export const issueInProject = defineQuery()('issues.issue.in-project', {
  build: (issueId, { Issue, issue_in_project: inProject }) => Issue.get(issueId),
})
`,
    )
    writeFileSync(
      join(root, 'mutations/issue.ts'),
      `import { defineMutation } from '@astrale-os/sdk/mutation'

export const renameIssue = defineMutation()('issues.issue.rename', {
  build(input, classes, mutation) {
    mutation.updateNode({ node: input.id, class: classes.Issue })
  },
})
`,
    )
    writeFileSync(
      join(root, 'functions/revise.ts'),
      `import { renameIssue } from '../mutations/issue.ts'

export async function revise(context, input) {
  if (input.again) return reviseAgain(context, input)
  const operation = context.domain.classes.Issue.methods.restore.key
  return context.mutate(renameIssue, { ...input, operation })
}

const reviseAgain = (context, input) => revise(context, { ...input, again: false })
`,
    )
    writeFileSync(
      join(root, 'functions/rename.ts'),
      `import { defineAction } from '@astrale-os/sdk/action'
import { issueInProject } from '../queries/issue.ts'
import { revise } from './revise.js'

export const rename = defineAction()(
  'Issue.rename',
  { errors: {} },
  async (context) => {
    await context.query(issueInProject, context.self)
    await archiveFirst(context)
    return revise(context, context.input)
  },
)

function archiveFirst(context) {
  return context.step.run('archive', () => context.domain.classes.Issue.methods.archive)
}
`,
    )

    const project = newProject()
    const { definitions, idByDeclaration } = readDefinitions({ domainRoot: root, project })
    expect(definitions.map(withoutInput)).toEqual([
      {
        kind: 'query',
        id: 'issues.issue.in-project',
        name: 'issueInProject',
        file: 'queries/issue.ts',
        line: 4,
        // the Classes its effects name: `issue_in_project` is destructured, never read
        classes: ['Issue'],
        doc: 'An Issue with its Project.',
        effects: [
          {
            kind: 'read',
            class: 'Issue',
            verb: 'get',
            role: 'root',
            file: 'queries/issue.ts',
            line: 5,
          },
        ],
      },
      {
        kind: 'mutation',
        id: 'issues.issue.rename',
        name: 'renameIssue',
        file: 'mutations/issue.ts',
        line: 3,
        // a classes parameter read by member
        classes: ['Issue'],
        effects: [
          {
            kind: 'update',
            class: 'Issue',
            verb: 'updateNode',
            file: 'mutations/issue.ts',
            line: 5,
          },
        ],
      },
    ])

    const withCallables: SchemaIR = {
      ...ir,
      classes: {
        Issue: {
          ...ir.classes.Issue!,
          methods: {
            ...ir.classes.Issue!.methods,
            archive: { ...ir.classes.Issue!.methods.rename!, name: 'archive' },
            restore: { ...ir.classes.Issue!.methods.rename!, name: 'restore' },
          },
        },
      },
    }
    expect(
      buildHandlerLinks({
        ir: withCallables,
        domainRoot: root,
        project,
        definitionIds: idByDeclaration,
      }),
    ).toEqual([
      expect.objectContaining({
        owner: 'Issue',
        method: 'rename',
        // `(key, options, handler)`: the handler is the last argument
        handlerLine: 8,
        // named by the handler, or by the authored helpers it calls, through a cycle
        definitions: ['issues.issue.in-project', 'issues.issue.rename'],
        // handed on in a local helper declared below the handler; `restore` is only
        // named by its key
        calls: ['Issue.archive'],
      }),
    ])
  })

  test('reads what each Mutation does, in both forms, through helpers, closures and branches', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-mutation-effects-'))
    roots.push(root)
    mkdirSync(join(root, 'mutations'))
    mkdirSync(join(root, 'functions'))
    writeFileSync(
      join(root, 'mutations/open.ts'),
      `import { defineMutation } from '@astrale-os/sdk/mutation'
import { Query } from '@astrale-os/sdk/query'

export const openIssue = defineMutation()('tracker.issue.open', {
  build: (input, { Issue, Project, project_contains_issue, shell }, mutation) => {
    mutation.expect.node({ node: input.project, class: Project })
    mutation.expect.none(Issue.where((issue) => issue.title.is(input.title)))
    mutation.expect.query({ query: Query.from({ nodes: [shell.User] }), equals: [] })
    const issue = mutation.createNode({ as: 'issue', class: Issue, props: input })
    mutation.createEdge({ class: project_contains_issue, source: input.project, target: issue })
    mutation.transition({ node: input.id, class: Issue, property: 'status', from: input.from, event: input.event })
  },
})
`,
    )
    writeFileSync(
      join(root, 'mutations/close.ts'),
      `import { defineMutation } from '@astrale-os/sdk/mutation'

/** Close an Issue and drop its Comments. */
export const closeIssue = defineMutation()((Tracker) => ({
  id: 'tracker.issue.close',
  build: (input, mutation) => {
    closeOne(mutation, Tracker, input.id, 'open')
    for (const comment of input.comments) dropComment(mutation, Tracker, comment)
    const reassign = assigner(mutation, Tracker)
    reassign(input.id)
    mutation.createNode({ as: 'note', class: Tracker.classes[input.kind] })
  },
}))

function closeOne(mutation, Tracker, id, from) {
  mutation.transition({ node: id, class: Tracker.classes.Issue, property: 'status', from, event: from === 'open' ? 'close' : 'reopen' })
}

function dropComment(mutation, Tracker, comment) {
  unlink(mutation, Tracker.classes.issue_has_comment, comment)
  mutation.deleteNode({ node: comment.id, class: Tracker.classes.Comment })
}

function unlink(mutation, edge, comment) {
  const relation = { class: edge, source: comment.issue, target: comment.id }
  mutation.expect.edge(relation)
  mutation.deleteEdge(relation)
}

function assigner(mutation, Tracker) {
  return (id) => mutation.updateNode({ node: id, class: Tracker.classes.Issue, props: {} })
}
`,
    )
    writeFileSync(
      join(root, 'functions/close.ts'),
      `import { defineAction } from '@astrale-os/sdk/action'
import { closeIssue } from '../mutations/close.ts'

export const close = defineAction()('Issue.close', async (context) =>
  context.mutate(closeIssue, context.input),
)
`,
    )

    const project = newProject()
    const { definitions, idByDeclaration } = readDefinitions({
      domainRoot: root,
      project,
      ir: tracker,
      dependencies: { shell: 'shell.example' },
    })
    const at = (file: string) => (line: number) => ({ file: `mutations/${file}.ts`, line })
    const open = at('open')
    const close = at('close')
    expect(definitions.map(withoutInput)).toEqual([
      {
        kind: 'mutation',
        id: 'tracker.issue.close',
        // the projected form: a function of the resolved Domain returns the id and `build`
        name: 'closeIssue',
        file: 'mutations/close.ts',
        line: 4,
        doc: 'Close an Issue and drop its Comments.',
        classes: ['Issue', 'issue_has_comment', 'Comment'],
        effects: [
          // one level down; the literal `from` decides the event and the state reached
          {
            kind: 'transition',
            class: 'Issue',
            verb: 'transition',
            property: 'status',
            from: 'open',
            event: 'close',
            to: 'closed',
            ...close(16),
          },
          // two levels down, the Edge Class handed as a value and its options reused
          { kind: 'expect', class: 'issue_has_comment', verb: 'expect.edge', ...close(26) },
          { kind: 'delete', class: 'issue_has_comment', verb: 'deleteEdge', ...close(27) },
          { kind: 'delete', class: 'Comment', verb: 'deleteNode', ...close(21) },
          // a function a helper returns, closing over what it was handed
          { kind: 'update', class: 'Issue', verb: 'updateNode', ...close(31) },
        ],
        // the condition of an object a helper builds, opened where it is written
        preconditions: [
          {
            kind: 'edge',
            classes: ['issue_has_comment'],
            terms: [
              { term: 'source', text: 'comment.issue' },
              { term: 'target', text: 'comment.id' },
            ],
            ...close(26),
          },
        ],
        gaps: [
          {
            ...close(11),
            reason: 'names a Class the reading cannot tell: `Tracker.classes[input.kind]`',
          },
        ],
      },
      {
        kind: 'mutation',
        id: 'tracker.issue.open',
        name: 'openIssue',
        file: 'mutations/open.ts',
        line: 4,
        classes: ['Project', 'Issue', 'shell.example:class.User', 'project_contains_issue'],
        effects: [
          { kind: 'expect', class: 'Project', verb: 'expect.node', ...open(6) },
          { kind: 'expect', class: 'Issue', verb: 'expect.none', ...open(7) },
          // a dependency's Class by its exact key
          { kind: 'expect', class: 'shell.example:class.User', verb: 'expect.query', ...open(8) },
          { kind: 'create', class: 'Issue', verb: 'createNode', ...open(9) },
          { kind: 'create', class: 'project_contains_issue', verb: 'createEdge', ...open(10) },
          // coordinates from the input: the state Property alone
          {
            kind: 'transition',
            class: 'Issue',
            verb: 'transition',
            property: 'status',
            ...open(11),
          },
        ],
        preconditions: [
          {
            kind: 'node',
            classes: ['Project'],
            terms: [{ term: 'node', text: 'input.project' }],
            ...open(6),
          },
          {
            kind: 'none',
            classes: ['Issue'],
            terms: [{ term: 'range', text: 'Issue.where((issue) => issue.title.is(input.title))' }],
            ...open(7),
          },
          {
            kind: 'query',
            classes: ['shell.example:class.User'],
            terms: [
              { term: 'query', text: 'Query.from({ nodes: [shell.User] })' },
              { term: 'equals', text: '[]' },
            ],
            ...open(8),
          },
        ],
      },
    ])

    // the projected form links its handler like the defined one
    const withClose: SchemaIR = {
      ...tracker,
      classes: {
        ...tracker.classes,
        Issue: {
          ...tracker.classes.Issue!,
          methods: { close: { ...ir.classes.Issue!.methods.rename!, name: 'close' } },
        },
      },
    }
    expect(
      buildHandlerLinks({
        ir: withClose,
        domainRoot: root,
        project,
        definitionIds: idByDeclaration,
      }),
    ).toEqual([
      expect.objectContaining({
        owner: 'Issue',
        method: 'close',
        definitions: ['tracker.issue.close'],
      }),
    ])
  })

  test('reads each precondition a Mutation states, as Issues and Admin write them, and where it cannot', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-mutation-preconditions-'))
    roots.push(root)
    for (const dir of ['project', 'issue', 'tag', 'registry', 'fleet', 'onboarding'])
      mkdirSync(join(root, 'mutations', dir), { recursive: true })
    // Issues `mutations/project/create-project-tag.ts`, its `build` as written
    writeFileSync(
      join(root, 'mutations/project/create-project-tag.ts'),
      `import { LocalAlias } from '@astrale-os/sdk/graph'
import { defineMutation } from '@astrale-os/sdk/mutation'

const createdTag = LocalAlias('tag')

export const createProjectTag = defineMutation<IssuesSchema>()('issues.project.create-tag', {
  build: (input: CreateProjectTagInput, { Project, Tag, project_contains_tag }, mutation) => {
    mutation.expect.node({
      node: input.projectId,
      class: Project,
      props: { equals: { archived: false } },
    })
    mutation.expect.none(
      Tag.where((tag) => [tag.project.is(input.projectId), tag.slug.eq(input.slug)]),
      { name: 'tag-slug-taken' },
    )
    const tag = mutation.createNode({
      as: createdTag,
      class: Tag,
      props: {
        name: input.name,
        slug: input.slug,
        ...(input.color === undefined ? {} : { color: input.color }),
      },
    })
    mutation.createEdge({ class: project_contains_tag, source: input.projectId, target: tag })
  },
})
`,
    )
    // Issues `mutations/issue/set-issue-topics.ts`: a count, and an Edge whose ends a `const` holds
    writeFileSync(
      join(root, 'mutations/issue/set-issue-topics.ts'),
      `import { defineMutation } from '@astrale-os/sdk/mutation'

export const setIssueTopics = defineMutation<IssuesSchema>()('issues.issue.set-topics', {
  build: (input: SetIssueTopicsInput, { Issue, Project, issue_is_about }, mutation) => {
    const { issueId } = input
    mutation.expect.count(
      issue_is_about.where((edge) => edge.issue.id.eq(issueId)),
      input.previousTopics.length,
      { name: 'issue-topics' },
    )
    const next = new Map(input.topics.map((topic) => [topic.id, topic.name]))
    for (const { id, name } of input.previousTopics) {
      const link = { class: issue_is_about, source: issueId, target: id }
      const nextName = next.get(id)
      if (nextName === undefined) {
        mutation.deleteEdge(link)
        continue
      }
      mutation.expect.edge({ ...link, props: { equals: { name } } })
      if (nextName !== name) mutation.updateEdge({ ...link, props: { set: { name: nextName } } })
    }
  },
})
`,
    )
    // written for this test: a precondition stated under each kind of condition and loop
    writeFileSync(
      join(root, 'mutations/issue/archive-issues.ts'),
      `import { defineMutation } from '@astrale-os/sdk/mutation'

export const archiveIssues = defineMutation<IssuesSchema>()('issues.issue.archive-many', {
  build: (input: ArchiveIssuesInput, { Issue, Project }, mutation) => {
    if (input.issueIds.length === 0) throw new TypeError('Nothing to archive.')
    if (input.projectId !== undefined) {
      mutation.expect.node({ node: input.projectId, class: Project })
    } else mutation.expect.exists(Project.where((project) => project.archived.eq(false)))
    input.issueIds.forEach((id) => {
      if (input.force) return
      mutation.expect.node({ node: id, class: Issue, props: { equals: { archived: false } } })
    })
    switch (input.mode) {
      case 'strict':
        mutation.expect.none(Issue.where((issue) => issue.archived.eq(true)))
        break
      default:
        input.checked && mutation.expect.count(Issue.where((issue) => issue.archived.eq(false)), 1)
    }
    try {
      mutation.deleteNode({ node: input.issueIds[0], class: Issue })
    } catch {
      mutation.expect.node({ node: input.issueIds[0], class: Issue })
    }
  },
})
`,
    )
    // Issues `mutations/tag/delete-tag.ts`: the Issues tagged as read, by identity
    writeFileSync(
      join(root, 'mutations/tag/delete-tag.ts'),
      `import { defineMutation } from '@astrale-os/sdk/mutation'

export const deleteTag = defineMutation<IssuesSchema>()('issues.tag.delete', {
  build: (
    input: DeleteTagInput,
    { Issue, Project, Tag, issue_tagged_with, project_contains_tag },
    mutation,
  ) => {
    mutation.expect.unchanged(
      Issue.where((issue) => issue.via(issue_tagged_with).is(input.tagId)),
      input.issueIds,
      { name: 'tagged-issues' },
    )
    mutation.deleteNode({ node: input.tagId, class: Tag })
  },
})
`,
    )
    // Admin `mutations/registry/yank.ts`: the closure form, its Properties a choice it writes out
    writeFileSync(
      join(root, 'mutations/registry/yank.ts'),
      `import { defineMutation } from '@astrale-os/sdk/mutation'

export const changePublicationYank = defineMutation<typeof AdminSchema>()<
  ChangePublicationYankInput,
  MutationOutcome
>((Admin) => ({
  id: 'admin.registry.change-yank',
  build: ({ publication, observed, yankedAt }, mutation) => {
    if (observed === yankedAt) throw new TypeError('A yank change must change the yank.')
    const Publication = Admin.classes.Publication
    mutation.expect.node({
      node: publication,
      class: Publication,
      props: observed === undefined ? { absent: ['yankedAt'] } : { equals: { yankedAt: observed } },
    })
    mutation.updateNode({
      node: publication,
      class: Publication,
      props:
        yankedAt === undefined
          ? { set: {}, unset: ['yankedAt'] }
          : { set: { yankedAt }, unset: [] },
    })
  },
}))
`,
    )
    // Admin `mutations/fleet/create.ts`: a Query V6 precondition, written across lines
    writeFileSync(
      join(root, 'mutations/fleet/create.ts'),
      `import { defineMutation } from '@astrale-os/sdk/mutation'
import { Property, Query } from '@astrale-os/sdk/query'

export const createFleetCommit = defineMutation<typeof AdminSchema>()<
  CreateFleetCommitInput,
  Creation
>((Admin) => ({
  id: 'admin.fleet.create',
  build: (input, mutation) => {
    mutation.expect.query({
      query: Query.from({ nodes: [Admin.classes.Fleet] })
        .filter({
          // the slug is the Fleet's business identity
          predicate: Property(Admin.classes.Fleet.properties.slug.key).equals(input.slug),
        })
        .select({ kind: 'nodes', projection: { kind: 'reference' } }),
      equals: { kind: 'node', ids: [] },
    })
  },
}))
`,
    )
    // Admin `mutations/onboarding/record-directory-invitation.ts`: Properties a helper computes;
    // and, written for this test, `exists` (no fixture states one) and a condition handed in
    writeFileSync(
      join(root, 'mutations/onboarding/record-directory-invitation.ts'),
      `import { defineMutation, type RichMutationBuilder } from '@astrale-os/sdk/mutation'

import { invitationRecordConditions } from './invitation-record-conditions.js'

export const recordDirectoryInvitation = defineMutation<typeof AdminSchema>()<
  RecordDirectoryInvitationInput,
  MutationOutcome
>((domain) => ({
  id: 'admin.onboarding.record-directory',
  build({ current, directory, acceptedMembership, ...operation }, mutation) {
    buildDirectoryObservation(mutation, domain, current, directory)
    mutation.expect.exists(domain.classes.Instance.where((instance) => instance.id.eq(current.target.instance)), {
      name: \`\${current.state}-target\`,
    })
    guard(mutation, operation.edge)
  },
}))

export function buildDirectoryObservation(
  mutation: RichMutationBuilder,
  domain: AdminDomain,
  current: InvitationRecord,
  evidence: DirectoryInvitation | DirectoryMembership,
): void {
  const props = invitationRecordConditions(current)
  mutation.expect.edge({
    class: domain.classes.invitation_targets_instance,
    source: current.id,
    target: current.target.instance,
  })
  mutation.expect.node({ node: current.id, class: domain.classes.Invitation, props })
}

function guard(mutation: RichMutationBuilder, edge: EdgeSelector) {
  mutation.expect.edge(edge)
}
`,
    )

    const { definitions } = readDefinitions({ domainRoot: root, project: newProject() })
    const preconditions = Object.fromEntries(
      definitions.map((definition) => [definition.id, definition.preconditions]),
    )
    const at = (file: string) => (line: number) => ({ file: `mutations/${file}.ts`, line })
    expect(preconditions).toEqual({
      'issues.project.create-tag': [
        {
          kind: 'node',
          classes: ['Project'],
          terms: [
            { term: 'node', text: 'input.projectId' },
            { term: 'equals', text: '{ archived: false }' },
          ],
          ...at('project/create-project-tag')(8),
        },
        {
          kind: 'none',
          classes: ['Tag'],
          name: 'tag-slug-taken',
          terms: [
            {
              term: 'range',
              text: 'Tag.where((tag) => [tag.project.is(input.projectId), tag.slug.eq(input.slug)])',
            },
          ],
          ...at('project/create-project-tag')(13),
        },
      ],
      'issues.issue.set-topics': [
        {
          kind: 'count',
          classes: ['issue_is_about'],
          name: 'issue-topics',
          terms: [
            { term: 'range', text: 'issue_is_about.where((edge) => edge.issue.id.eq(issueId))' },
            { term: 'bounds', text: 'input.previousTopics.length' },
          ],
          ...at('issue/set-issue-topics')(6),
        },
        // the ends come through the spread of the `const` that holds them
        {
          kind: 'edge',
          classes: ['issue_is_about'],
          terms: [
            { term: 'source', text: 'issueId' },
            { term: 'target', text: 'id' },
            { term: 'equals', text: '{ name }' },
          ],
          ...at('issue/set-issue-topics')(19),
          // once for each previous topic, and only for one a guard before it does not leave
          under: [
            { kind: 'each', source: 'input.previousTopics', line: 12 },
            { kind: 'unless', source: 'nextName === undefined', line: 15 },
          ],
        },
      ],
      // a guard that throws is no condition: where it throws, nothing is built
      'issues.issue.archive-many': [
        {
          kind: 'node',
          classes: ['Project'],
          terms: [{ term: 'node', text: 'input.projectId' }],
          ...at('issue/archive-issues')(7),
          under: [{ kind: 'when', source: 'input.projectId !== undefined', line: 6 }],
        },
        {
          kind: 'exists',
          classes: ['Project'],
          terms: [
            { term: 'range', text: 'Project.where((project) => project.archived.eq(false))' },
          ],
          ...at('issue/archive-issues')(8),
          under: [{ kind: 'unless', source: 'input.projectId !== undefined', line: 6 }],
        },
        // an array's callback is a loop, read through; a guard that returns from it, a condition
        {
          kind: 'node',
          classes: ['Issue'],
          terms: [
            { term: 'node', text: 'id' },
            { term: 'equals', text: '{ archived: false }' },
          ],
          ...at('issue/archive-issues')(11),
          under: [
            { kind: 'each', source: 'input.issueIds', line: 9 },
            { kind: 'unless', source: 'input.force', line: 10 },
          ],
        },
        {
          kind: 'none',
          classes: ['Issue'],
          terms: [{ term: 'range', text: 'Issue.where((issue) => issue.archived.eq(true))' }],
          ...at('issue/archive-issues')(15),
          under: [{ kind: 'when', source: "input.mode === 'strict'", line: 14 }],
        },
        // the default case is every case but the others; a `&&` operand, when its left holds
        {
          kind: 'count',
          classes: ['Issue'],
          terms: [
            { term: 'range', text: 'Issue.where((issue) => issue.archived.eq(false))' },
            { term: 'bounds', text: '1' },
          ],
          ...at('issue/archive-issues')(18),
          under: [
            { kind: 'unless', source: "input.mode === 'strict'", line: 13 },
            { kind: 'when', source: 'input.checked', line: 18 },
          ],
        },
        {
          kind: 'node',
          classes: ['Issue'],
          terms: [{ term: 'node', text: 'input.issueIds[0]' }],
          ...at('issue/archive-issues')(23),
          under: [
            {
              kind: 'caught',
              source: 'mutation.deleteNode({ node: input.issueIds[0], class: Issue })',
              line: 21,
            },
          ],
        },
      ],
      'issues.tag.delete': [
        {
          kind: 'unchanged',
          // the range's roots: what its `where` walks through is no root
          classes: ['Issue'],
          name: 'tagged-issues',
          terms: [
            {
              term: 'range',
              text: 'Issue.where((issue) => issue.via(issue_tagged_with).is(input.tagId))',
            },
            { term: 'ids', text: 'input.issueIds' },
          ],
          ...at('tag/delete-tag')(9),
        },
      ],
      // a choice the source writes out reads as written, whole
      'admin.registry.change-yank': [
        {
          kind: 'node',
          classes: ['Publication'],
          terms: [
            { term: 'node', text: 'publication' },
            {
              term: 'props',
              text: "observed === undefined ? { absent: ['yankedAt'] } : { equals: { yankedAt: observed } }",
            },
          ],
          ...at('registry/yank')(11),
        },
      ],
      // folded to one line, its comment left out
      'admin.fleet.create': [
        {
          kind: 'query',
          classes: ['Fleet'],
          terms: [
            {
              term: 'query',
              text: "Query.from({ nodes: [Admin.classes.Fleet] }).filter({ predicate: Property(Admin.classes.Fleet.properties.slug.key).equals(input.slug) }).select({ kind: 'nodes', projection: { kind: 'reference' } })",
            },
            { term: 'equals', text: "{ kind: 'node', ids: [] }" },
          ],
          ...at('fleet/create')(10),
        },
      ],
      'admin.onboarding.record-directory': [
        {
          kind: 'edge',
          classes: ['invitation_targets_instance'],
          terms: [
            { term: 'source', text: 'current.id' },
            { term: 'target', text: 'current.target.instance' },
          ],
          ...at('onboarding/record-directory-invitation')(26),
        },
        // Properties a helper computes: the part as written, and a gap
        {
          kind: 'node',
          classes: ['Invitation'],
          terms: [
            { term: 'node', text: 'current.id' },
            { term: 'props', text: 'invitationRecordConditions(current)' },
          ],
          ...at('onboarding/record-directory-invitation')(31),
          gap: 'states its Properties as a value the reading cannot open: `invitationRecordConditions(current)`',
        },
        // a name the source computes is no name
        {
          kind: 'exists',
          classes: ['Instance'],
          terms: [
            {
              term: 'range',
              text: 'domain.classes.Instance.where((instance) => instance.id.eq(current.target.instance))',
            },
          ],
          ...at('onboarding/record-directory-invitation')(12),
          gap: 'names its failure with a value the reading cannot tell: `` `${current.state}-target` ``',
        },
        // a condition handed in whole: its Class and its parts are a gap
        {
          kind: 'edge',
          classes: [],
          terms: [],
          ...at('onboarding/record-directory-invitation')(35),
          gap: 'names a Class the reading cannot tell: `edge`; states its condition as a value the reading cannot open: `edge`',
        },
      ],
    })
    // every precondition is an `expect` effect too, which the Behavior lens draws
    for (const definition of definitions) {
      const expects = (definition.effects ?? []).filter((effect) => effect.kind === 'expect')
      for (const precondition of definition.preconditions ?? [])
        for (const cls of precondition.classes)
          expect(expects).toContainEqual(
            expect.objectContaining({ class: cls, line: precondition.line }),
          )
    }
  })

  test('reads what each Query reads: where it starts, the relations it follows and what it expands through', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-query-effects-'))
    roots.push(root)
    mkdirSync(join(root, 'queries'))
    writeFileSync(
      join(root, 'queries/issue.ts'),
      `import { defineQuery } from '@astrale-os/sdk/query'
import { Query } from '@astrale-os/sdk/query'

export const thread = defineQuery()('tracker.comment.thread', {
  build: (id, d) => d.Comment.where((comment) => comment.issue.is(id)).all(),
})

export const inProject = defineQuery()('tracker.issue.in-project', {
  build: (id, { Issue, project_contains_issue }) =>
    Issue.where((issue) => issue.via(project_contains_issue, { direction: 'incoming' }).is(id)),
})

export const people = defineQuery()('tracker.people', {
  build: (_, d) => holders(d).all(),
})

const holders = (d) => d.shell.User.union(d.Project)

export const tree = defineQuery()((Tracker) => ({
  id: 'tracker.project.tree',
  build: (input) =>
    Query.from({ nodes: [Tracker.classes.Project] })
      .expand({ via: [Tracker.classes.project_contains_issue], direction: 'outgoing' })
      .expand({ via: edgesOf(input), direction: 'outgoing' }),
}))

export const anything = defineQuery()('tracker.anything', {
  build: (input, d) => d[input.kind].all(),
})

export const comments = defineQuery()((Tracker) => ({
  id: 'tracker.issue.comments',
  build: ({ issue }) =>
    Query.from({ nodes: [issue] }).expand({
      via: [Tracker.classes.issue_has_comment],
      direction: 'outgoing',
    }),
}))

export const addressed = defineQuery()(() => ({
  id: 'tracker.addressed',
  build: (id) => Query.from({ nodes: [id] }).select({ kind: 'nodes' }),
}))
`,
    )
    const { definitions } = readDefinitions({
      domainRoot: root,
      project: newProject(),
      ir: tracker,
      dependencies: { shell: 'shell.example' },
    })
    const at = (line: number) => ({ file: 'queries/issue.ts', line })
    const effects = Object.fromEntries(
      definitions.map((definition) => [definition.id, [definition.effects, definition.gaps]]),
    )
    expect(effects).toEqual({
      'tracker.anything': [
        undefined,
        [{ ...at(28), reason: 'reads the Query handles by a computed name' }],
      ],
      // Nodes by id are the Nodes the first expand leaves from
      'tracker.issue.comments': [
        [
          { kind: 'read', class: 'Issue', verb: 'Query.from', role: 'root', ...at(34) },
          {
            kind: 'read',
            class: 'issue_has_comment',
            verb: 'Query.expand',
            role: 'traverse',
            ...at(34),
          },
          { kind: 'read', class: 'Comment', verb: 'Query.expand', role: 'traverse', ...at(34) },
        ],
        undefined,
      ],
      'tracker.addressed': [
        undefined,
        [{ ...at(42), reason: 'starts from Nodes whose Class the source does not name: `[id]`' }],
      ],
      // a named to-one relation: the Edge and the Class it reaches
      'tracker.comment.thread': [
        [
          { kind: 'read', class: 'Comment', verb: 'where', role: 'root', ...at(5) },
          { kind: 'read', class: 'issue_has_comment', verb: 'issue', role: 'traverse', ...at(5) },
          { kind: 'read', class: 'Issue', verb: 'issue', role: 'traverse', ...at(5) },
        ],
        undefined,
      ],
      // an Edge walked against its direction reaches its source
      'tracker.issue.in-project': [
        [
          { kind: 'read', class: 'Issue', verb: 'where', role: 'root', ...at(10) },
          {
            kind: 'read',
            class: 'project_contains_issue',
            verb: 'via',
            role: 'traverse',
            ...at(10),
          },
          { kind: 'read', class: 'Project', verb: 'via', role: 'traverse', ...at(10) },
        ],
        undefined,
      ],
      // through a helper; a union starts from each Class it joins
      'tracker.people': [
        [
          {
            kind: 'read',
            class: 'shell.example:class.User',
            verb: 'union',
            role: 'root',
            ...at(17),
          },
          { kind: 'read', class: 'Project', verb: 'union', role: 'root', ...at(17) },
        ],
        undefined,
      ],
      'tracker.project.tree': [
        [
          { kind: 'read', class: 'Project', verb: 'Query.from', role: 'root', ...at(22) },
          {
            kind: 'read',
            class: 'project_contains_issue',
            verb: 'Query.expand',
            role: 'traverse',
            ...at(23),
          },
          { kind: 'read', class: 'Issue', verb: 'Query.expand', role: 'traverse', ...at(23) },
        ],
        [
          {
            ...at(24),
            reason: 'expands through Classes the reading cannot tell: `edgesOf(input)`',
          },
        ],
      ],
    })
  })

  test('reads what each definition takes as input and what its `build` compares each field with', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-definition-inputs-'))
    roots.push(root)
    mkdirSync(join(root, 'queries'))
    mkdirSync(join(root, 'mutations'))
    writeFileSync(join(root, 'types.ts'), `export type Status = 'open' | 'active' | 'closed'\n`)
    writeFileSync(
      join(root, 'queries/issue.ts'),
      `import type { NodeId, NodePath } from '@astrale-os/sdk'
import { defineQuery, Property, Query } from '@astrale-os/sdk/query'
import type { Filters } from 'some-package'
import { visible } from 'some-package'

import type { Status } from '../types.ts'

interface IssueInput {
  /** the Issue to read */
  issue: NodeId
  note?: string
}

export const one = defineQuery()('tracker.issue.one', {
  build: (input: IssueInput, { Issue }) => Issue.get(input.issue),
})

export const withSibling = defineQuery()('tracker.issue.with-sibling', {
  build: (input: { issue: NodeId; sibling?: NodePath }, { Issue, project_contains_issue }) =>
    Issue.with((issue) => ({
      project: issue.project
        .with((project) => ({
          sibling: project
            .via(project_contains_issue)
            .where((candidate) => candidate.id.in(input.sibling === undefined ? [] : [input.sibling]))
            .find(),
        }))
        .get(),
    })).get(input.issue),
})

export const several = defineQuery()('tracker.issue.several', {
  build: (input: { ids: readonly NodeId[] }, { Issue }) =>
    Issue.where((issue) => issue.id.in(input.ids)).all(),
})

export const byStatus = defineQuery()('tracker.issue.by-status', {
  build: (input: { status: Status }, { Issue }) =>
    Issue.where((issue) => issue.status.eq(input.status)).all(),
})

export const projects = defineQuery()('tracker.projects', {
  build: (_input: void, { Project }) => Project.all(),
})

export const filtered = defineQuery()('tracker.issue.filtered', {
  build: (input: Filters, { Issue }) => Issue.where((issue) => issue.title.eq(input.title)).all(),
})

export const shown = defineQuery()('tracker.issue.shown', {
  build: (input: { issue: NodeId }, { Issue }) =>
    Issue.where((issue) => visible(issue, input.issue)).all(),
})

export const byKey = defineQuery()('tracker.issue.by-key', {
  build: (key: string, { Issue }) => Issue.where((issue) => issue.$prop.id.eq(key)).find(),
})

export const anyOf = defineQuery()('tracker.issue.any-of', {
  build: (input: { ids: NodeId | readonly NodeId[] }, { Issue }) => {
    const ids = Array.isArray(input.ids) ? input.ids : [input.ids]
    return Issue.where((issue) => issue.id.in(ids)).all()
  },
})

export const titled = defineQuery()<string>((Tracker) => ({
  id: 'tracker.issue.titled',
  build: (title) =>
    Query.from({ nodes: [Tracker.classes.Issue] }).filter({
      predicate: Property(Tracker.classes.Issue.properties.title.key).equals(title),
    }),
}))
`,
    )
    writeFileSync(
      join(root, 'mutations/close.ts'),
      `import type { NodeId } from '@astrale-os/sdk'
import { defineMutation } from '@astrale-os/sdk/mutation'

import type { Status } from '../types.ts'

export const closeIssue = defineMutation()<{ issue: NodeId; from: Status; title: string }>(
  (Tracker) => ({
    id: 'tracker.issue.close',
    build: (input, mutation) => {
      close(mutation, Tracker.classes.Issue, input.issue, input.from)
      mutation.updateNode({ node: input.issue, class: Tracker.classes.Issue, props: { title: input.title } })
    },
  }),
)

function close(mutation, Issue, node, from) {
  mutation.transition({ node, class: Issue, property: 'status', from, event: 'close' })
}

type Linked = 'project_contains_issue' | 'issue_has_comment'

export const unlink = defineMutation()<{ edges: { readonly [E in Linked]: readonly Ends[] } }>(
  (Tracker) => ({
    id: 'tracker.issue.unlink',
    build: (input, mutation) => {
      for (const ends of input.edges.issue_has_comment)
        mutation.deleteEdge({ class: Tracker.classes.issue_has_comment, ...ends })
    },
  }),
)

interface Ends {
  source: NodeId
  target: NodeId
}
`,
    )
    const issue = tracker.classes.Issue!
    // an Issue's business id: a Property its handle keeps under `$prop`
    const keyed = { ...issue, properties: { ...issue.properties, id: { type: 'string' } } }
    const { definitions } = readDefinitions({
      domainRoot: root,
      project: newProject(),
      ir: { ...tracker, classes: { ...tracker.classes, Issue: keyed } },
      dependencies: { shell: 'shell.example' },
    })
    const query = (line: number) => ({ file: 'queries/issue.ts', line })
    const mutation = (line: number) => ({ file: 'mutations/close.ts', line })
    const status = { kind: 'value' as const, literals: ['open', 'active', 'closed'] }
    const inputs = Object.fromEntries(
      definitions.map((definition) => [definition.id, definition.input]),
    )
    expect(inputs).toEqual({
      // a Node id `get` reads, and a field `build` never reads
      'tracker.issue.one': {
        form: 'fields',
        fields: [
          {
            name: 'issue',
            optional: false,
            type: 'NodeId',
            kind: 'node',
            doc: 'the Issue to read',
            ...query(10),
            read: true,
            uses: [{ kind: 'node', class: 'Issue', verb: 'get', ...query(15) }],
          },
          {
            name: 'note',
            optional: true,
            type: 'string',
            kind: 'value',
            ...query(11),
            read: false,
            uses: [],
          },
        ],
      },
      // an optional id among the Nodes a traversed Class keeps
      'tracker.issue.with-sibling': {
        form: 'fields',
        fields: [
          {
            name: 'issue',
            optional: false,
            type: 'NodeId',
            kind: 'node',
            ...query(19),
            read: true,
            uses: [{ kind: 'node', class: 'Issue', verb: 'get', ...query(29) }],
          },
          {
            name: 'sibling',
            optional: true,
            type: 'NodePath',
            kind: 'node',
            ...query(19),
            read: true,
            uses: [{ kind: 'node', class: 'Issue', verb: 'in', ...query(25) }],
          },
        ],
      },
      'tracker.issue.several': {
        form: 'fields',
        fields: [
          {
            name: 'ids',
            optional: false,
            type: 'readonly NodeId[]',
            kind: 'nodes',
            ...query(33),
            read: true,
            uses: [{ kind: 'node', class: 'Issue', verb: 'in', ...query(34) }],
          },
        ],
      },
      // a union of literals, from a module of the Domain, compared with a Property
      'tracker.issue.by-status': {
        form: 'fields',
        fields: [
          {
            name: 'status',
            optional: false,
            type: 'Status',
            ...status,
            ...query(38),
            read: true,
            uses: [
              { kind: 'property', class: 'Issue', property: 'status', verb: 'eq', ...query(39) },
            ],
          },
        ],
      },
      'tracker.projects': { form: 'none', fields: [] },
      'tracker.issue.filtered': {
        form: 'unread',
        fields: [],
        gaps: [
          {
            ...query(47),
            reason:
              'takes its input as `Filters`, imported from `some-package`, which the reading does not follow',
          },
        ],
      },
      // read, compared with nothing the reading is certain of, and why
      'tracker.issue.shown': {
        form: 'fields',
        fields: [
          {
            name: 'issue',
            optional: false,
            type: 'NodeId',
            kind: 'node',
            ...query(51),
            read: true,
            uses: [],
          },
        ],
        gaps: [
          {
            ...query(52),
            reason: 'hands the input field `issue` to `visible`, which the reading cannot follow',
          },
        ],
      },
      // one value, named after the parameter, compared with the Property `id`, not the Node id
      'tracker.issue.by-key': {
        form: 'value',
        fields: [
          {
            name: 'key',
            optional: false,
            type: 'string',
            kind: 'value',
            ...query(56),
            read: true,
            uses: [{ kind: 'property', class: 'Issue', property: 'id', verb: 'eq', ...query(56) }],
          },
        ],
      },
      // a type that mixes one id and a list says nothing certain; a type test reads it, quietly
      'tracker.issue.any-of': {
        form: 'fields',
        fields: [
          {
            name: 'ids',
            optional: false,
            type: 'NodeId | readonly NodeId[]',
            kind: 'unknown',
            ...query(60),
            read: true,
            uses: [{ kind: 'node', class: 'Issue', verb: 'in', ...query(62) }],
          },
        ],
      },
      // the type the call names; a Query V6 predicate names the Property by its key
      'tracker.issue.titled': {
        form: 'value',
        fields: [
          {
            name: 'title',
            optional: false,
            type: 'string',
            kind: 'value',
            ...query(68),
            read: true,
            uses: [
              {
                kind: 'property',
                class: 'Issue',
                property: 'title',
                verb: 'equals',
                ...query(70),
              },
            ],
          },
        ],
      },
      // the type the call names, followed through a helper; a field it writes is read, not compared
      'tracker.issue.close': {
        form: 'fields',
        fields: [
          {
            name: 'issue',
            optional: false,
            type: 'NodeId',
            kind: 'node',
            ...mutation(6),
            read: true,
            uses: [
              { kind: 'node', class: 'Issue', verb: 'transition', ...mutation(17) },
              { kind: 'node', class: 'Issue', verb: 'updateNode', ...mutation(11) },
            ],
          },
          {
            name: 'from',
            optional: false,
            type: 'Status',
            ...status,
            ...mutation(6),
            read: true,
            uses: [
              {
                kind: 'property',
                class: 'Issue',
                property: 'status',
                verb: 'transition',
                ...mutation(17),
              },
            ],
          },
          {
            name: 'title',
            optional: false,
            type: 'string',
            kind: 'value',
            ...mutation(6),
            read: true,
            uses: [],
          },
        ],
      },
      // the members of a mapped type over literal keys; an Edge's ends spread from an item of one
      'tracker.issue.unlink': {
        form: 'fields',
        fields: [
          {
            name: 'edges',
            optional: false,
            type: '{ readonly [E in Linked]: readonly Ends[] }',
            kind: 'unknown',
            ...mutation(22),
            read: true,
            uses: [
              {
                kind: 'node',
                class: 'Issue',
                verb: 'deleteEdge',
                path: ['issue_has_comment', 'source'],
                ...mutation(27),
              },
              {
                kind: 'node',
                class: 'Comment',
                verb: 'deleteEdge',
                path: ['issue_has_comment', 'target'],
                ...mutation(27),
              },
            ],
          },
        ],
      },
    })
    // the definitions' own reading leaves the input out
    expect(definitions.flatMap((definition) => definition.gaps ?? [])).toEqual([])
  })

  test('reads the runtime Integrations and follows each handler to the operations it reaches', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-integrations-'))
    roots.push(root)
    mkdirSync(join(root, 'integrations'))
    mkdirSync(join(root, 'functions'))
    writeFileSync(
      join(root, 'integrations/machines.ts'),
      `import { defineIntegration } from '@astrale-os/sdk/integration'

/** The machines a Host runs on. */
export const MachineLifecycle = defineIntegration({
  id: 'example.machine-lifecycle',
  operations: {
    start: defineIntegration.operation<string, void>({
      replay: ({ id }) => ({ kind: 'keyed', source: 'input', key: id }),
    }),
    probe: defineIntegration.operation<string, boolean>({ replay: { kind: 'safe' } }),
    destroy: defineIntegration.operation<string, void>({
      replay: (urgent) => (urgent ? { kind: 'unsafe' } : { kind: 'safe' }),
    }),
  },
})
`,
    )
    writeFileSync(
      join(root, 'integrations/index.ts'),
      `import { defineIntegration } from '@astrale-os/sdk/integration'
import { MachineLifecycle } from './machines.ts'

const clock = defineIntegration({
  id: 'example.clock',
  operations: { now: defineIntegration.operation<void, string>({ replay: { kind: 'safe' } }) },
})

export const integrations = Object.freeze({ machines: MachineLifecycle, time: clock }) satisfies Integrations
`,
    )
    writeFileSync(
      join(root, 'runtime.ts'),
      `import { defineRuntime } from '@astrale-os/sdk/runtime'
import { integrations } from './integrations/index.ts'

export default defineRuntime<typeof schema>()({ integrations, functions: [] })
`,
    )
    writeFileSync(
      join(root, 'functions/helpers.ts'),
      `import type { integrations } from '../integrations/index.ts'

export function stop(lifecycle: IntegrationClients<typeof integrations>['machines']) {
  return lifecycle.destroy('host')
}

export async function commit(context, input) {
  return input.prepare(context)
}

export function settle(input) {
  const { integrations: clients } = input
  return clients.machines.start('host')
}

export function helpersOf(authority) {
  return Object.freeze({ integrations: authority.integrations })
}

export async function runStep(context, execute) {
  return context.step.run('step', async (authority) => execute(helpersOf(authority)))
}

export async function probe(context, look) {
  async function once(helpers) {
    try {
      return await look(helpers)
    } catch {
      return undefined
    }
  }
  return runStep(context, once)
}
`,
    )
    writeFileSync(
      join(root, 'functions/rename.ts'),
      `import { defineAction } from '@astrale-os/sdk/action'
import { commit, settle, stop } from './helpers.ts'

export const rename = defineAction<typeof schema, typeof integrations>()(
  'Issue.rename',
  async (context) => {
    const { integrations, step } = context
    const { machines } = integrations
    await step.run('read-time', ({ integrations: replayable }) => replayable.time.now())
    await stop(machines)
    await settle({ integrations, now: Date.now })
    await integrations.unknown.call()
    return commit(context, { prepare: async (each) => ({ alive: await each.integrations.machines.probe('host') }) })
  },
)
`,
    )
    writeFileSync(
      join(root, 'functions/create.ts'),
      `import { defineWorkflow } from '@astrale-os/sdk/workflow'
import { schedule } from 'some-package'
import { probe, runStep } from './helpers.ts'

export const create = defineWorkflow()('createIssue', async ({ input, integrations, step }) => {
  await integrations[input.kind].start('host')
  schedule(integrations.machines)
  await runStep({ step }, (helpers) => helpers.integrations.machines.probe('host'))
  await probe({ step }, ({ integrations: { machines } }) => machines.destroy('host'))
  await probe({ step }, ({ integrations: { machines } }) => machines.start('host'))
  const later = [1].map(() => integrations)
  return integrations.time.now()
})
`,
    )

    const project = newProject()
    expect(readIntegrations({ domainRoot: root, project })).toEqual([
      {
        key: 'machines',
        id: 'example.machine-lifecycle',
        name: 'MachineLifecycle',
        file: 'integrations/machines.ts',
        line: 4,
        doc: 'The machines a Host runs on.',
        operations: [
          // a decision chosen per input: every decision it returns
          { name: 'destroy', replay: ['safe', 'unsafe'], line: 11 },
          { name: 'probe', replay: ['safe'], line: 10 },
          { name: 'start', replay: ['keyed'], line: 7 },
        ],
      },
      {
        key: 'time',
        id: 'example.clock',
        name: 'clock',
        file: 'integrations/index.ts',
        line: 4,
        operations: [{ name: 'now', replay: ['safe'], line: 6 }],
      },
    ])

    const links = buildHandlerLinks({
      ir,
      domainRoot: root,
      project,
      integrations: readIntegrations({ domainRoot: root, project }),
    })
    expect(links).toEqual([
      expect.objectContaining({
        method: 'rename',
        // through destructuring, a Step's own clients, a helper's renamed parameter, an
        // object handed on, and a callback a helper calls back with the context; a key
        // the runtime does not declare is no Integration
        integrations: ['machines.destroy', 'machines.probe', 'machines.start', 'time.now'],
      }),
      expect.objectContaining({
        method: 'createIssue',
        // through a helper's frozen return: the Step's clients a runner hands its callback;
        // and each callback a helper's own function closes over, read once per callback
        integrations: ['machines.destroy', 'machines.probe', 'machines.start', 'time.now'],
        // what the reading cannot follow is said, not guessed
        integrationGaps: [
          {
            file: 'functions/create.ts',
            line: 6,
            reason: 'reads the Integrations by a computed name',
          },
          {
            file: 'functions/create.ts',
            line: 7,
            reason: 'hands the machines Integration to `schedule`, which the reading cannot follow',
          },
          {
            file: 'functions/create.ts',
            line: 11,
            reason: 'returns the Integrations to a caller the reading does not follow',
          },
        ],
      }),
    ])
    expect(links[0]).not.toHaveProperty('integrationGaps')
  })

  test('indexes Class, Property, Method, Edge endpoint, and Function declarations', () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-schema-spans-'))
    roots.push(root)
    const schemaDir = join(root, 'domain/model')
    mkdirSync(schemaDir, { recursive: true })
    writeFileSync(
      join(schemaDir, 'members.ts'),
      `
        export const Issue = nodeClass({
          properties: { title: property(z.string()) },
          methods: { rename },
        })
        export const assigned_to = edgeClass.directed({
          source: { as: 'issue', accepts: [Issue] },
          target: { as: 'owner', accepts: [Issue] },
          properties: { note: property(z.string()) },
        })
        /** Close one issue. */
        export const closeIssue = func({ input, output })
      `,
    )
    writeFileSync(
      join(schemaDir, 'index.ts'),
      `
        import { Issue, assigned_to, closeIssue } from './members.js'
        export const Schema = defineSchema('issues.example', { name: 'Test Domain',
          classes: { Issue, assigned_to },
          functions: { closeIssue },
        })
      `,
    )
    const spans = buildSourceSpans({ ir, domainRoot: root, schemaDir })
    for (const key of [
      'class.Issue.property.title',
      'class.Issue.method.rename',
      'edge.assigned_to.endpoint.issue',
      'edge.assigned_to.endpoint.owner',
      'edge.assigned_to.property.note',
      'function.closeIssue',
    ])
      expect(spans[key]?.file).toBe('domain/model/members.ts')
    expect(spans['function.closeIssue']?.doc).toBe('Close one issue.')
  })
})
