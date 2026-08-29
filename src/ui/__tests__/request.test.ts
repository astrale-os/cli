import { describe, expect, test } from 'bun:test'

import { UiError } from '../model'
import { browserInvocation, createUiRequestDraft, requestUi } from '../request'

describe('UI request draft', () => {
  test('normalizes only line endings and outer whitespace into the canonical form URL', () => {
    const draft = createUiRequestDraft('  Async\r\ncombobox  ')
    expect(draft.query).toBe('Async\ncombobox')
    const url = new URL(draft.submissionUrl)
    expect(url.origin + url.pathname).toBe('https://github.com/astrale-os/ui/issues/new')
    expect(url.searchParams.get('template')).toBe('ui-request.yml')
    expect(url.searchParams.get('need')).toBe('Async\ncombobox')
  })

  test('admits exact Unicode boundaries and rejects empty or oversized intent', () => {
    expect(createUiRequestDraft('🪐'.repeat(512)).query).toHaveLength(1024)
    for (const value of ['', '   ', '🪐'.repeat(513)]) {
      let failure: unknown
      try {
        createUiRequestDraft(value)
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(UiError)
      expect((failure as UiError).code).toBe('UI_REQUEST_QUERY_INVALID')
    }
  })

  test('uses argument-safe browser launchers without routing URLs through a shell', () => {
    const url = 'https://github.com/astrale-os/ui/issues/new?template=ui-request.yml&need=a%26b'
    expect(browserInvocation(url, 'darwin')).toEqual(['open', [url]])
    expect(browserInvocation(url, 'linux')).toEqual(['xdg-open', [url]])
    expect(browserInvocation(url, 'win32')).toEqual([
      'rundll32.exe',
      ['url.dll,FileProtocolHandler', url],
    ])
  })

  test('passes the exact draft URL to the selected browser launcher', async () => {
    let invocation: { file: string; args: readonly string[] } | undefined
    const draft = await requestUi('loading data table', {
      open: true,
      launcher: async (file, args) => {
        invocation = { file, args }
        return { code: 0 }
      },
    })
    expect(invocation?.args).toContain(draft.submissionUrl)
  })

  test('has no browser side effect in machine mode', async () => {
    let launches = 0
    const draft = await requestUi('loading data table', {
      open: false,
      launcher: async () => {
        launches += 1
        return { code: 0 }
      },
    })
    expect(launches).toBe(0)
    expect(draft.submissionUrl).toContain('need=loading+data+table')
  })

  test('retains the usable draft URL when the browser launcher fails', async () => {
    let invocation: { file: string; args: readonly string[] } | undefined
    const draft = await requestUi('loading data table', {
      open: true,
      launcher: async (file, args) => {
        invocation = { file, args }
        throw new Error('browser unavailable')
      },
    })
    expect(invocation).toBeDefined()
    expect(invocation?.args).toContain(draft.submissionUrl)
    expect(draft.submissionUrl).toStartWith('https://github.com/astrale-os/ui/issues/new?')
  })
})
