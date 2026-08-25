import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import addCommand from '../add'
import viewCommand from '../view'

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
  test('view emits exactly one parseable JSON value', async () => {
    const action = viewCommand.action as (
      items: string[],
      options: { json?: boolean },
    ) => Promise<void>
    await action(['pattern/chart/line/basic'], { json: true })

    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toEqual([item])
  })

  test('view and add reject missing items without prompting in machine mode', async () => {
    process.argv = ['node', 'astrale', '--ci', 'ui', 'view']
    const view = viewCommand.action as (
      items: string[],
      options: { json?: boolean },
    ) => Promise<void>
    await expect(view([], { json: true })).rejects.toBeInstanceOf(ExitError)
    expect(JSON.parse(stderr)).toMatchObject({ error: 'UI_ITEM_NOT_FOUND' })
    expect(stdout).toBe('')

    stderr = ''
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
    const action = viewCommand.action as (
      items: string[],
      options: { json?: boolean },
    ) => Promise<void>
    await expect(action(['pattern/chart/line/basic'], { json: true })).rejects.toBeInstanceOf(
      ExitError,
    )
    expect(JSON.parse(stderr)).toEqual({
      error: 'UI_REGISTRY_UNAVAILABLE',
      message: 'Unable to reach npm UI release.',
    })
    expect(stderr).not.toContain('super_secret')
  })
})

function mockFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/@astrale-os/ui/latest')) return Response.json({ version: '0.3.0-beta.0' })
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
      return Response.json({ items: [item] })
    }
    if (url.endsWith('/registry.json')) {
      return Response.json({ include: ['registry/patterns/chart/registry.json'] })
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}
