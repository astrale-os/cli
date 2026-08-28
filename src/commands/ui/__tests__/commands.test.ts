import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { fixtureFetch } from '../../../ui/search/__tests__/fixture'
import addCommand from '../add'
import searchCommand from '../search'

class ExitError extends Error {}

let stdout = ''
let stderr = ''
let home = ''
let originalArgv: string[]
let originalExit: typeof process.exit
let originalFetch: typeof globalThis.fetch
let originalStdout: typeof process.stdout.write
let originalStderr: typeof process.stderr.write
let originalHome: string | undefined

beforeEach(() => {
  stdout = ''
  stderr = ''
  home = mkdtempSync(path.join(tmpdir(), 'astrale-ui-command-'))
  originalHome = process.env.ASTRALE_HOME
  process.env.ASTRALE_HOME = home
  originalArgv = process.argv
  originalExit = process.exit
  originalFetch = globalThis.fetch
  originalStdout = process.stdout.write
  originalStderr = process.stderr.write
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk)
    return true
  }) as typeof process.stderr.write
  process.exit = (() => {
    throw new ExitError()
  }) as typeof process.exit
  globalThis.fetch = fixtureFetch()
})

afterEach(() => {
  process.argv = originalArgv
  process.exit = originalExit
  globalThis.fetch = originalFetch
  process.stdout.write = originalStdout
  process.stderr.write = originalStderr
  if (originalHome === undefined) delete process.env.ASTRALE_HOME
  else process.env.ASTRALE_HOME = originalHome
  rmSync(home, { recursive: true, force: true })
})

describe('UI command machine contracts', () => {
  test('search emits one parseable response with exact demo code', async () => {
    const action = searchCommand.action as (
      query: string,
      options: { json?: boolean; limit?: string; offset?: string },
    ) => Promise<void>
    await action('payment table export', { json: true, limit: '5', offset: '0' })

    expect(stderr).toBe('')
    const response = JSON.parse(stdout)
    expect(response).toMatchObject({
      query: 'payment table export',
      limit: 5,
      offset: 0,
      results: [
        {
          address: 'block/data-table/data-table-12',
          command: 'astrale ui add block/data-table/data-table-12',
          code: { language: 'tsx' },
        },
      ],
    })
    expect(response.results[0].code.source).toContain('Export payments')
  })

  test('search keeps exact candidate code in interactive output', async () => {
    const action = searchCommand.action as (
      query: string,
      options: { json?: boolean; limit?: string; offset?: string },
    ) => Promise<void>
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
    try {
      await action('payment table export', { limit: '5', offset: '0' })
    } finally {
      if (descriptor) Object.defineProperty(process.stdout, 'isTTY', descriptor)
      else delete (process.stdout as { isTTY?: boolean }).isTTY
    }
    expect(stderr).toBe('')
    expect(stdout).toContain('block/data-table/data-table-12')
    expect(stdout).toContain('astrale ui add block/data-table/data-table-12')
    expect(stdout).toContain('Export payments')
  })

  test('add rejects missing items without prompting in machine mode', async () => {
    process.argv = ['node', 'astrale', '--no-prompt', 'ui', 'add']
    const add = addCommand.action as (items: string[], options: { json?: boolean }) => Promise<void>
    await expect(add([], { json: true })).rejects.toBeInstanceOf(ExitError)
    expect(JSON.parse(stderr)).toMatchObject({ error: 'UI_ITEM_NOT_FOUND' })
    expect(stdout).toBe('')
  })

  test('search failures retain a stable code without leaking transport secrets', async () => {
    globalThis.fetch = (async () => {
      throw new Error('Authorization: Bearer npm_super_secret_value_that_must_not_escape')
    }) as unknown as typeof fetch
    const action = searchCommand.action as (
      query: string,
      options: { json?: boolean; limit?: string; offset?: string },
    ) => Promise<void>
    await expect(
      action('line basic', { json: true, limit: '5', offset: '0' }),
    ).rejects.toBeInstanceOf(ExitError)
    expect(JSON.parse(stderr)).toEqual({
      error: 'UI_SEARCH_UNAVAILABLE',
      message: 'The current public Astrale UI beta does not provide usable search artifacts.',
      hint: 'Retry after the Astrale UI beta release is available.',
    })
    expect(stderr).not.toContain('super_secret')
  })
})
