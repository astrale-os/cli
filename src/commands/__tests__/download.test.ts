import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { captureProcess, ExitError } from './fixtures/process'

const io = captureProcess()

const KEY = 'sextant.so:class.TrialBalance.property.document'
const CSV = 'account,debit\n401,12\n'
const digestOf = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`

let props: Record<string, unknown>
let chunks: string[]

const getOrThrowMock = mock(async (_target: unknown) => ({
  id: 'tb-1',
  class: 'sextant.so:class.TrialBalance',
  props,
}))
const downloadMock = mock(async (_location: unknown) => ({
  mediaType: 'text/csv;charset=utf-8',
  length: CSV.length,
  body: (async function* () {
    for (const chunk of chunks) yield new TextEncoder().encode(chunk)
  })(),
}))
const expandSelfInPathMock = mock(async (path: string, _context: unknown) => ({
  path,
  meta: undefined,
}))
const commandContext = {
  graph: { getOrThrow: getOrThrowMock },
  session: { content: { download: downloadMock } },
}
let runError: unknown
const runKernelCommandMock = mock(
  async (run: {
    opts: Record<string, unknown>
    credential?: unknown
    fn: (context: typeof commandContext) => Promise<unknown>
    format?: (result: unknown, opts: Record<string, unknown>, machine: boolean) => unknown
  }) => {
    try {
      const result = await run.fn(commandContext)
      await run.format?.(result, run.opts, true)
    } catch (error) {
      runError = error
    }
  },
)

mock.module('../../connection', () => ({
  expandSelfInPath: expandSelfInPathMock,
  runKernelCommand: runKernelCommandMock,
  withSelfHint: async (action: () => Promise<unknown>) => action(),
}))

beforeEach(() => {
  props = {
    'sextant.so:class.TrialBalance.property.sourceFileName': 'balance.csv',
    [KEY]: { digest: digestOf(CSV), mediaType: 'text/csv;charset=utf-8', size: CSV.length },
  }
  chunks = ['account,debit\n', '401,12\n']
  runError = undefined
  for (const fn of [getOrThrowMock, downloadMock, expandSelfInPathMock, runKernelCommandMock]) {
    fn.mockClear()
  }
})

const target = () => join(mkdtempSync(join(tmpdir(), 'astrale-download-')), 'balance.csv')

describe('download command', () => {
  test('streams the file a property names to -o, verified, and describes it', async () => {
    const { downloadCommand } = await import('../download')
    const file = target()

    await downloadCommand('tb-1', 'document', { output: file, json: true })

    expect(runError).toBeUndefined()
    expect(readFileSync(file, 'utf8')).toBe(CSV)
    expect(existsSync(`${file}.part`)).toBe(false)
    expect(JSON.parse(io.stdout)).toEqual({
      node: '@tb-1',
      property: KEY,
      mediaType: 'text/csv;charset=utf-8',
      size: CSV.length,
      digest: digestOf(CSV),
      file,
    })
    expect(String(getOrThrowMock.mock.calls[0]![0])).toBe('@tb-1')
    expect(downloadMock.mock.calls[0]![0]).toEqual({ node: 'tb-1', property: KEY })
    expect(runKernelCommandMock.mock.calls[0]![0].credential).toEqual({ principal: 'caller' })
  })

  test('writes the bytes to stdout with -o -', async () => {
    const { downloadCommand } = await import('../download')

    await downloadCommand('@tb-1', KEY, { output: '-' })

    expect(runError).toBeUndefined()
    expect(io.stdout).toBe(CSV)
  })

  test('keeps no file when the bytes are not the file the node holds', async () => {
    const { downloadCommand } = await import('../download')
    chunks = ['account,credit\n', '401,12\n']
    const file = target()

    await downloadCommand('tb-1', 'document', { output: file })

    expect((runError as { code?: string }).code).toBe('FILE_INTEGRITY')
    expect(existsSync(file)).toBe(false)
    expect(existsSync(`${file}.part`)).toBe(false)
  })

  test('names the files a node holds when the property holds none', async () => {
    const { downloadCommand } = await import('../download')

    await downloadCommand('tb-1', 'sourceFileName', { output: target() })

    expect(runError).toMatchObject({
      code: 'FILE_NOT_FOUND',
      message: '@tb-1 holds no file in sourceFileName that you can read.',
      hint: `Files it holds: ${KEY}`,
    })
    expect(downloadMock).not.toHaveBeenCalled()
  })

  test('refuses a JSON description on the stdout the bytes use', async () => {
    const { downloadCommand } = await import('../download')

    await expect(downloadCommand('tb-1', 'document', { output: '-', json: true })).rejects.toThrow(
      ExitError,
    )
    expect(io.failure()).toMatchObject({ error: 'OUTPUT_CONFLICT' })
    expect(runKernelCommandMock).not.toHaveBeenCalled()
  })

  test('refuses a callable Path', async () => {
    const { downloadCommand } = await import('../download')

    await expect(
      downloadCommand('@tb-1::sextant.so:class.TrialBalance.method.delete', 'document', {
        output: target(),
        json: true,
      }),
    ).rejects.toThrow(ExitError)
    expect(io.failure()).toMatchObject({ error: 'NOT_A_NODE' })
  })
})
