import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import addCommand from '../add'
import listCommand from '../list'

class ExitError extends Error {}

const commit = 'a'.repeat(40)
const item = {
  name: 'pattern-chart-line-basic',
  type: 'registry:block',
  title: 'Line chart',
  description: 'A controlled chart.',
  dependencies: ['@astrale-os/ui@^0.3.0-beta.0'],
  files: [
    {
      path: 'registry/patterns/chart/line-basic.tsx',
      type: 'registry:component',
      target: 'components/astrale/pattern/chart/line-basic.tsx',
    },
  ],
  meta: { canonicalAddress: 'pattern/chart/line/basic' },
}

let stdout = ''
let stderr = ''
let originalArgv: string[]
let originalExit: typeof process.exit
let originalFetch: typeof globalThis.fetch
let originalStdout: typeof process.stdout.write
let originalStderr: typeof process.stderr.write

beforeEach(() => {
  stdout = ''
  stderr = ''
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
  globalThis.fetch = mockFetch()
})

afterEach(() => {
  process.argv = originalArgv
  process.exit = originalExit
  globalThis.fetch = originalFetch
  process.stdout.write = originalStdout
  process.stderr.write = originalStderr
})

describe('UI command machine contracts', () => {
  test('list emits exactly one parseable JSON value', async () => {
    const action = listCommand.action as (
      query: string | undefined,
      options: { json?: boolean; limit?: string },
    ) => Promise<void>
    await action('line-basic', { json: true, limit: '100' })

    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toEqual([item])
  })

  test('list forwards an explicit release without consulting the beta channel', async () => {
    const seen: string[] = []
    globalThis.fetch = mockFetch(seen)
    const action = listCommand.action as (
      query: string | undefined,
      options: { json?: boolean; limit?: string; version?: string },
    ) => Promise<void>

    await action('line-basic', { json: true, limit: '100', version: '0.3.0-beta.1' })

    expect(JSON.parse(stdout)).toEqual([item])
    expect(seen.some((url) => url.endsWith('/@astrale-os/ui/beta'))).toBe(false)
    expect(seen.some((url) => url.includes('/git/ref/tags/v0.3.0-beta.1'))).toBe(true)
  })

  test('add rejects missing items without prompting in machine mode', async () => {
    process.argv = ['node', 'astrale', '--no-prompt', 'ui', 'add']
    const add = addCommand.action as (items: string[], options: { json?: boolean }) => Promise<void>
    await expect(add([], { json: true })).rejects.toBeInstanceOf(ExitError)
    expect(JSON.parse(stderr)).toMatchObject({ error: 'UI_ITEM_NOT_FOUND' })
    expect(stdout).toBe('')
  })

  test('registry failures retain a stable code without leaking transport secrets', async () => {
    globalThis.fetch = (async () => {
      throw new Error('Authorization: Bearer npm_super_secret_value_that_must_not_escape')
    }) as unknown as typeof fetch
    const action = listCommand.action as (
      query: string | undefined,
      options: { json?: boolean; limit?: string },
    ) => Promise<void>
    await expect(action('line-basic', { json: true, limit: '100' })).rejects.toBeInstanceOf(
      ExitError,
    )
    expect(JSON.parse(stderr)).toEqual({
      error: 'UI_REGISTRY_UNAVAILABLE',
      message: 'Unable to reach npm UI release.',
    })
    expect(stderr).not.toContain('super_secret')
  })
})

function mockFetch(seen: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    seen.push(url)
    if (url.endsWith('/@astrale-os/ui/beta')) return Response.json({ version: '0.3.0-beta.1' })
    if (url.includes('/git/ref/tags/')) {
      return Response.json({ object: { type: 'commit', sha: commit, url: '' } })
    }
    if (url.endsWith('/tooling/compatibility.json')) {
      return Response.json({
        version: 1,
        shadcn: '4.18.0',
        base: 'base',
        style: 'nova',
        baseUi: '1.7.0',
        react: '^18.3.1 || ^19.0.0',
        tailwind: '^4.3.3',
        presets: ['astrale', 'compact', 'expressive'],
      })
    }
    if (url.endsWith('/registry/patterns/chart/registry.json')) {
      return Response.json({
        items: [
          {
            ...item,
            files: item.files.map((file) => ({ ...file, path: 'line-basic.tsx' })),
          },
        ],
      })
    }
    if (url.endsWith('/registry.json')) {
      return Response.json({ include: ['registry/patterns/chart/registry.json'] })
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}
