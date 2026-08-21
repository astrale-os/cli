import { describe, expect, test } from 'bun:test'

import { conciseCliFailure, readyViewSession, viewSessionArgs } from './session'

describe('view session command', () => {
  test('opens the installed ViewPath without rejected placement overrides', () => {
    const args = viewSessionArgs('issues.astrale.ai', 'issue-detail', 'staging', '@issue-1')
    expect(args).toEqual([
      'view',
      '/:issues.astrale.ai:view.issue-detail',
      '--target',
      '@issue-1',
      '--no-open',
      '--json',
      '-i',
      'staging',
    ])
    expect(args).not.toContain('--view-url')
    expect(args).not.toContain('--handshake')
  })

  test('omits --target for a standalone view', () => {
    expect(viewSessionArgs('issues.astrale.ai', 'dashboard', 'local')).toEqual([
      'view',
      '/:issues.astrale.ai:view.dashboard',
      '--no-open',
      '--json',
      '-i',
      'local',
    ])
  })

  test('reads the verified placement URL from the current CLI session route', () => {
    expect(
      readyViewSession(
        {
          session: {
            id: 'v-a1b2',
            pageUrl: 'http://127.0.0.1:4419/s/nonce/',
            view: { route: { href: 'https://issues.example/ui/issue' } },
          },
        },
        null,
      ),
    ).toEqual({
      status: 'ready',
      sessionId: 'v-a1b2',
      pageUrl: 'http://127.0.0.1:4419/s/nonce/',
      viewUrl: 'https://issues.example/ui/issue',
      target: null,
    })
    expect(
      readyViewSession(
        {
          session: {
            id: 'v-old',
            pageUrl: 'http://127.0.0.1:4419/s/old/',
            view: { url: 'https://legacy.invalid/view' },
          },
        } as never,
        null,
      ),
    ).toBeNull()
  })
})

test('reduces CLI stack output to the actionable kernel failure', () => {
  expect(
    conciseCliFailure(
      `275 | invalid\nPermissionDeniedError: Permission denied: READ on /:issues.astrale.ai:view.issue\n details: {}\n at mapServerError (errors.ts:280:61)`,
    ),
  ).toBe('PermissionDeniedError: Permission denied: READ on /:issues.astrale.ai:view.issue')
})
