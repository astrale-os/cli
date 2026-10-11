import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { captureProcess, ExitError } from './fixtures/process'

const io = captureProcess()
let queryResult: unknown
let selfFailure: unknown

const queryMock = mock(async (_ast: unknown, _options?: unknown) => queryResult)
const getOrThrowMock = mock(async (target: { readonly raw?: string; toString(): string }) => ({
  id: 'note-1',
  class: 'notes.example.dev:class.Note',
  props: { 'notes.example.dev:class.Note.property.title': 'Hello' },
  target: target.raw ?? target.toString(),
}))
const mutateMock = mock(async (_mutation: unknown) => ({ createdNodes: { note: 'note-1' } }))
const expandSelfInPathMock = mock(async (path: string, _context: unknown) => {
  if (selfFailure !== undefined) throw selfFailure
  if (path !== '@self') return { path, meta: undefined }
  const meta = { original: path, expanded: '@expanded-self', selfId: 'expanded-self' }
  return { path: meta.expanded, meta }
})
const commandContext = {
  graph: { query: queryMock, getOrThrow: getOrThrowMock, mutate: mutateMock },
}
const runKernelCommandMock = mock(
  async (run: {
    opts: Record<string, unknown>
    fn: (context: typeof commandContext) => Promise<unknown>
    format?: (result: unknown, opts: Record<string, unknown>, machine: boolean) => unknown
  }) => {
    const result = await run.fn(commandContext)
    await run.format?.(result, run.opts, true)
  },
)

mock.module('../../connection', () => ({
  expandSelfInPath: expandSelfInPathMock,
  runKernelCommand: runKernelCommandMock,
  withSelfHint: async (action: () => Promise<unknown>) => action(),
}))

beforeEach(() => {
  queryResult = { result: { kind: 'graph', graph: { nodes: [], edges: [] } }, page: {} }
  selfFailure = undefined
  for (const fn of [queryMock, getOrThrowMock, mutateMock]) fn.mockClear()
  expandSelfInPathMock.mockClear()
  runKernelCommandMock.mockClear()
})

const plain = (value: unknown) => JSON.parse(JSON.stringify(value))

describe('query command', () => {
  /** @evidence TEST-CLI-QUERY-DISPATCHES-CANONICAL-V6 */
  test('dispatches a path/edge or Class source as Query V6 with its cursor', async () => {
    const { queryCommand } = await import('../query')

    await queryCommand(['/:notes.example.dev:class.Note'], {
      json: true,
      edge: '/:notes.example.dev:class.references',
      direction: 'incoming',
      limit: '25',
      cursor: 'next-page',
    })
    await queryCommand([], { json: true, class: '/:issues.astrale.ai:class.Issue', limit: '20' })

    expect(plain(queryMock.mock.calls)).toEqual([
      [
        {
          format: 'astrale.graph.query',
          version: 'v6',
          source: {
            kind: 'node',
            terms: [{ kind: 'path', path: '/:notes.example.dev:class.Note' }],
            binding: 'n0',
          },
          steps: [
            {
              op: 'expand',
              from: 'n0',
              via: [{ origin: 'notes.example.dev', kind: 'class', name: 'references' }],
              direction: 'incoming',
              bindings: { edge: 'e0', node: 'n1' },
            },
          ],
          select: { kind: 'graph', binding: 'n1' },
        },
        { page: { size: 25, after: 'next-page' } },
      ],
      [
        {
          format: 'astrale.graph.query',
          version: 'v6',
          source: {
            kind: 'node',
            terms: [
              {
                kind: 'class',
                class: { origin: 'issues.astrale.ai', kind: 'class', name: 'Issue' },
              },
            ],
            binding: 'n0',
          },
          steps: [],
          select: { kind: 'graph', binding: 'n0' },
        },
        { page: { size: 20 } },
      ],
    ])
  })

  test('keeps the opaque continuation in machine output without wrapping the graph', async () => {
    const { queryCommand } = await import('../query')
    const result = { kind: 'graph', graph: { nodes: [], edges: [] } }
    queryResult = { result, page: { next: 'opaque-next-page' } }

    await queryCommand([], { json: true, class: '/:issues.astrale.ai:class.Issue', limit: '1' })

    expect(JSON.parse(io.stdout)).toEqual({ ...result, page: { next: 'opaque-next-page' } })
  })

  test('resolves @self inside the command session and never relabels a transport failure', async () => {
    const { queryCommand } = await import('../query')
    const { getCommand } = await import('../get')
    await queryCommand(['@self'], { json: true, limit: '2' })
    io.stdout = ''
    await getCommand('@self', { json: true })
    expect(expandSelfInPathMock.mock.calls.map(([, context]) => context)).toEqual([
      commandContext,
      commandContext,
    ])
    expect(JSON.parse(io.stdout)).toMatchObject({ target: '@expanded-self' })

    const aggregate = new AggregateError([], '')
    selfFailure = aggregate
    await expect(queryCommand(['@self'], { json: true, limit: '2' })).rejects.toBe(aggregate)
    expect(io.stderr).not.toContain('INVALID_INPUT')
  })

  /** @evidence TEST-CLI-QUERY-REJECTS-V1-BEFORE-CONNECTION */
  test('rejects a legacy AST before opening the command connection', async () => {
    const { queryCommand } = await import('../query')

    await expect(
      queryCommand([], { json: true, ast: '{"version":1,"from":["/"]}' }),
    ).rejects.toEqual(new ExitError(1))

    expect(runKernelCommandMock).not.toHaveBeenCalled()
    expect(io.failure()).toMatchObject({
      error: 'INVALID_INPUT',
      message: 'Invalid input: expected "astrale.graph.query" at /format.',
    })
  })
})

describe('get and mutate commands', () => {
  /** @evidence TEST-CLI-GET-RETURNS-CANONICAL-NODE */
  test('get point-reads the target and does not synthesize Path or backend fields', async () => {
    const { getCommand } = await import('../get')

    await getCommand('/:notes.example.dev:class.Note', { json: true })

    const node = JSON.parse(io.stdout)
    expect(node).toMatchObject({ id: 'note-1', target: '/:notes.example.dev:class.Note' })
    expect(Object.keys(node).sort()).toEqual(['class', 'id', 'props', 'target'])
  })

  /** @evidence TEST-CLI-MUTATE-DISPATCHES-CANONICAL-V3 */
  test('mutate admits authoring input and dispatches one canonical Mutation V3 document', async () => {
    const { mutateCommand } = await import('../mutate')
    const operation = {
      op: 'node.create',
      as: 'note',
      class: 'notes.example.dev:class.Note',
      props: {},
    }

    await mutateCommand({
      json: true,
      data: JSON.stringify({ preconditions: [], operations: [operation] }),
    })

    expect(plain(mutateMock.mock.calls)).toEqual([
      [
        {
          format: 'astrale.graph.mutation',
          version: 'v3',
          preconditions: [],
          operations: [operation],
        },
      ],
    ])
    expect(JSON.parse(io.stdout)).toEqual({ createdNodes: { note: 'note-1' } })
  })
})
