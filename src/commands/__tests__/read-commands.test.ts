import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

type Wire = { nodes: unknown[]; edges: unknown[]; roots: string[]; next?: Record<string, unknown> }
type RunOpts = {
  opts: Record<string, unknown>
  fn: (ctx: { client: { call: typeof clientCallMock } }) => Promise<unknown>
  format?: (result: unknown, opts: Record<string, unknown>, isRaw: boolean) => void | Promise<void>
}

class ExitError extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super('process.exit(' + String(code) + ')')
  }
}

const emptyWire = (): Wire => ({ nodes: [], edges: [], roots: [] })

let stdout = ''
let errors: string[] = []
let originalStdoutWrite: typeof process.stdout.write
let originalConsoleError: typeof console.error
let originalExit: typeof process.exit
let queryAsts: unknown[] = []
let getPaths: string[] = []
let queryResult: { wire: Wire } = { wire: emptyWire() }
let getResult: unknown = null
let clientCallResult: unknown = { rows: [] }

const clientCallMock = mock(async () => clientCallResult)
const queryMock = mock(async (ast: unknown) => {
  queryAsts.push(ast)
  return queryResult
})
const getMock = mock(async (path: string) => {
  getPaths.push(path)
  return getResult
})
const bindGraphMock = mock(() => ({ query: queryMock, get: getMock }))
const expandSelfInPathMock = mock(async (path: string) => {
  if (path === '@self') {
    return {
      path: '@expanded-self',
      meta: { original: '@self', expanded: '@expanded-self', selfId: 'expanded-self' },
    }
  }
  return { path, meta: undefined }
})
const withSelfHintMock = mock(async (fn: () => Promise<unknown>) => fn())
const runKernelCommandMock = mock(async (run: RunOpts) => {
  const result = await run.fn({ client: { call: clientCallMock } })
  if (run.format) await run.format(result, run.opts, true)
})

mock.module('../../kernel', () => ({
  bindGraph: bindGraphMock,
  expandSelfInPath: expandSelfInPathMock,
  runKernelCommand: runKernelCommandMock,
  withSelfHint: withSelfHintMock,
}))

beforeEach(() => {
  stdout = ''
  errors = []
  queryAsts = []
  getPaths = []
  queryResult = { wire: emptyWire() }
  getResult = null
  clientCallResult = { rows: [] }
  clientCallMock.mockClear()
  queryMock.mockClear()
  getMock.mockClear()
  bindGraphMock.mockClear()
  expandSelfInPathMock.mockClear()
  withSelfHintMock.mockClear()
  runKernelCommandMock.mockClear()

  originalStdoutWrite = process.stdout.write.bind(process.stdout)
  originalConsoleError = console.error
  originalExit = process.exit
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    return true
  }) as typeof process.stdout.write
  console.error = ((...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
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
  test('lowers roots and selectors to the expected QueryASTInput', async () => {
    const { queryCommand } = await import('../query')

    await queryCommand(['/root', '@self'], {
      json: true,
      depth: '2',
      children:
        '{"classes":["/:kernel.astrale.ai:class.Folder"],"limit":50,"cursor":"child-cursor","order":{"by":"id","dir":"asc"}}',
      edges:
        '[{"as":"perm","classes":["/:kernel.astrale.ai:class.has_perm"],"direction":"out","limit":10,"cursor":"edge-cursor","order":{"by":"id","dir":"desc"}},{"direction":"both"}]',
    })

    expect(queryAsts).toEqual([
      {
        version: 1,
        from: ['/root', '@expanded-self'],
        steps: [
          {
            expand: {
              edge: 'has_parent',
              dir: 'in',
              depth: 2,
              filter: { class: ['/:kernel.astrale.ai:class.Folder'] },
              page: { limit: 50, cursor: 'child-cursor' },
              order: { by: 'id', dir: 'asc' },
            },
          },
          {
            expand: {
              edge: ['/:kernel.astrale.ai:class.has_perm'],
              dir: 'out',
              as: 'perm',
              page: { limit: 10, cursor: 'edge-cursor' },
              order: { by: 'id', dir: 'desc' },
            },
          },
          { expand: { dir: 'both', as: 'e1' } },
        ],
      },
    ])
    expect(expandSelfInPathMock.mock.calls.map((call) => call[0])).toEqual(['/root', '@self'])
    expect(withSelfHintMock).toHaveBeenCalledTimes(1)
  })

  test('rejects an invalid children selector before dispatch', async () => {
    const { queryCommand } = await import('../query')

    await expect(queryCommand(['/'], { json: true, children: '{"bogus":true}' })).rejects.toEqual(
      new ExitError(1),
    )

    expect(errors.join('\n')).toContain('--children invalid selector')
    expect(queryMock).not.toHaveBeenCalled()
  })

  test('rejects mixing --ast with positional roots', async () => {
    const { queryCommand } = await import('../query')

    await expect(
      queryCommand(['/'], { json: true, ast: '{"version":1,"from":["/"]}' }),
    ).rejects.toEqual(new ExitError(1))

    expect(errors.join('\n')).toContain(
      '--ast cannot be used with positional roots or --depth/--children/--edges',
    )
    expect(queryMock).not.toHaveBeenCalled()
  })
})

describe('get command', () => {
  test('dispatches a point read and prints the flat wire projection', async () => {
    const { getCommand } = await import('../get')
    const row = {
      id: 'n1',
      class: '/:demo:class.Widget',
      path: '/demo/widget',
      props: { name: 'Widget' },
      __labels: ['Node', 'Widget'],
      classId: 'class-1',
    }
    getResult = row

    await getCommand('/demo/widget', { json: true })

    expect(getPaths).toEqual(['/demo/widget'])
    expect(JSON.parse(stdout)).toEqual({
      id: 'n1',
      class: '/:demo:class.Widget',
      path: '/demo/widget',
      props: { name: 'Widget' },
    })
  })

  test('errors with exit 1 when no node resolves', async () => {
    const { getCommand } = await import('../get')
    getResult = null

    await expect(getCommand('/missing', { json: true })).rejects.toEqual(new ExitError(1))

    expect(getPaths).toEqual(['/missing'])
    expect(errors.join('\n')).toContain('node "/missing" not found or not visible')
  })
})
