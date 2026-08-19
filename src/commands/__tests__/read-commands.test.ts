import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

type GraphContext = {
  graph: {
    query: typeof queryMock
    getOrThrow: typeof getOrThrowMock
    mutate: typeof mutateMock
  }
}

type RunOpts = {
  opts: Record<string, unknown>
  fn: (context: GraphContext) => Promise<unknown>
  format?: (
    result: unknown,
    opts: Record<string, unknown>,
    machine: boolean,
  ) => void | Promise<void>
}

class ExitError extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super(`process.exit(${String(code)})`)
  }
}

let stdout = ''
let errors: string[] = []
let originalStdoutWrite: typeof process.stdout.write
let originalConsoleError: typeof console.error
let originalExit: typeof process.exit
let queryCalls: Array<{ ast: unknown; options: unknown }> = []
let getTargets: string[] = []
let mutations: unknown[] = []
let queryResult: unknown
let getResult: unknown
let mutationResult: unknown

const queryMock = mock(async (ast: unknown, options?: unknown) => {
  queryCalls.push({ ast, options })
  return queryResult
})
const getOrThrowMock = mock(async (target: { readonly raw?: string; toString(): string }) => {
  getTargets.push(target.raw ?? target.toString())
  return getResult
})
const mutateMock = mock(async (mutation: unknown) => {
  mutations.push(mutation)
  return mutationResult
})
const expandSelfInPathMock = mock(async (path: string) => {
  if (path === '@self') {
    return {
      path: '@expanded-self',
      meta: { original: '@self', expanded: '@expanded-self', selfId: 'expanded-self' },
    }
  }
  return { path, meta: undefined }
})
const withSelfHintMock = mock(async (action: () => Promise<unknown>) => action())
const runKernelCommandMock = mock(async (run: RunOpts) => {
  const result = await run.fn({
    graph: { query: queryMock, getOrThrow: getOrThrowMock, mutate: mutateMock },
  })
  await run.format?.(result, run.opts, true)
})

mock.module('../../connection', () => ({
  expandSelfInPath: expandSelfInPathMock,
  runKernelCommand: runKernelCommandMock,
  withSelfHint: withSelfHintMock,
}))

beforeEach(() => {
  stdout = ''
  errors = []
  queryCalls = []
  getTargets = []
  mutations = []
  queryResult = {
    result: {
      kind: 'graph',
      graph: { nodes: [], edges: [] },
      selection: { kind: 'node', ids: [] },
    },
    page: {},
  }
  getResult = undefined
  mutationResult = { createdNodes: {} }
  queryMock.mockClear()
  getOrThrowMock.mockClear()
  mutateMock.mockClear()
  expandSelfInPathMock.mockClear()
  withSelfHintMock.mockClear()
  runKernelCommandMock.mockClear()

  originalStdoutWrite = process.stdout.write
  originalConsoleError = console.error
  originalExit = process.exit
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    return true
  }) as typeof process.stdout.write
  console.error = ((...values: unknown[]) => {
    errors.push(values.map(String).join(' '))
  }) as typeof console.error
  process.exit = ((code?: string | number | null) => {
    throw new ExitError(code)
  }) as typeof process.exit
})

afterEach(() => {
  process.stdout.write = originalStdoutWrite
  console.error = originalConsoleError
  process.exit = originalExit
})

describe('query command', () => {
  /** @evidence TEST-CLI-QUERY-DISPATCHES-CANONICAL-V6 */
  test('dispatches the supported source/edge subset as Query V6 with its cursor', async () => {
    const { queryCommand } = await import('../query')

    await queryCommand(['/:notes.example.dev:class.Note'], {
      json: true,
      edge: '/:notes.example.dev:class.references',
      direction: 'incoming',
      limit: '25',
      cursor: 'next-page',
    })

    expect(JSON.parse(JSON.stringify(queryCalls))).toEqual([
      {
        ast: {
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
        options: { page: { size: 25, after: 'next-page' } },
      },
    ])
  })

  test('authors a Definition source through the same canonical Query V6 call', async () => {
    const { queryCommand } = await import('../query')

    await queryCommand([], {
      json: true,
      definition: '/:issues.astrale.ai:class.Issue',
      limit: '20',
    })

    expect(JSON.parse(JSON.stringify(queryCalls))).toEqual([
      {
        ast: {
          format: 'astrale.graph.query',
          version: 'v6',
          source: {
            kind: 'node',
            terms: [
              {
                kind: 'definition',
                definition: { origin: 'issues.astrale.ai', kind: 'class', name: 'Issue' },
              },
            ],
            binding: 'n0',
          },
          steps: [],
          select: { kind: 'graph', binding: 'n0' },
        },
        options: { page: { size: 20 } },
      },
    ])
  })

  /** @evidence TEST-CLI-QUERY-REJECTS-V1-BEFORE-CONNECTION */
  test('rejects a legacy AST before opening the command connection', async () => {
    const { queryCommand } = await import('../query')

    await expect(
      queryCommand([], { json: true, ast: '{"version":1,"from":["/"]}' }),
    ).rejects.toEqual(new ExitError(1))

    expect(runKernelCommandMock).not.toHaveBeenCalled()
    expect(errors.join('\n')).toContain('expected "astrale.graph.query" at /format')
  })
})

describe('get command', () => {
  /** @evidence TEST-CLI-GET-RETURNS-CANONICAL-NODE */
  test('point-reads the target and does not synthesize Path or backend fields', async () => {
    const { getCommand } = await import('../get')
    getResult = {
      id: 'note-1',
      class: '/:notes.example.dev:class.Note',
      props: { 'notes.example.dev:class.Note.property.title': 'Hello' },
    }

    await getCommand('/:notes.example.dev:class.Note', { json: true })

    expect(getTargets).toEqual(['/:notes.example.dev:class.Note'])
    expect(JSON.parse(stdout)).toEqual(getResult)
    expect(stdout).not.toContain('__labels')
    expect(stdout).not.toContain('classId')
  })
})

describe('mutate command', () => {
  /** @evidence TEST-CLI-MUTATE-DISPATCHES-CANONICAL-V3 */
  test('admits authoring input and dispatches one canonical Mutation V3 document', async () => {
    const { mutateCommand } = await import('../mutate')
    mutationResult = { createdNodes: { note: 'note-1' } }

    await mutateCommand({
      json: true,
      data: JSON.stringify({
        preconditions: [],
        operations: [
          {
            op: 'node.create',
            as: 'note',
            class: '/:notes.example.dev:class.Note',
            props: {},
          },
        ],
      }),
    })

    expect(JSON.parse(JSON.stringify(mutations))).toEqual([
      {
        format: 'astrale.graph.mutation',
        version: 'v3',
        preconditions: [],
        operations: [
          {
            op: 'node.create',
            as: 'note',
            class: '/:notes.example.dev:class.Note',
            props: {},
          },
        ],
      },
    ])
    expect(JSON.parse(stdout)).toEqual({ createdNodes: { note: 'note-1' } })
  })
})
