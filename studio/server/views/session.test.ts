import { describe, expect, test } from 'bun:test'

import type { ViewInfo } from '../../shared/types'

import { conciseCliFailure, launchViewSession, readyViewSession } from './session'

describe('view session runtime', () => {
  test('opens the canonical ViewPath from the exact prepared instance', async () => {
    const view = { slug: 'dashboard', kind: 'unknown' } satisfies ViewInfo
    const opened: unknown[] = []
    const result = await launchViewSession(
      '/workspace',
      'issues.astrale.ai',
      view,
      null,
      { preparationId: 'prepared' },
      2000,
      {
        activeInstance: async () => 'local',
        identityNames: async () => ['alice', 'bob'],
        serveRuntime: () => ({ file: '/cli/astrale', args: [] }),
        readPreparation: () => ({
          id: 'prepared',
          root: '/workspace',
          origin: 'issues.astrale.ai',
          slug: 'dashboard',
          instance: 'local',
          targetRequired: false,
          targets: {
            status: 'available',
            items: [],
            selected: null,
            stale: null,
            truncated: false,
          },
          expiresAt: Date.now() + 60_000,
        }),
        open: async (input) => {
          opened.push(input)
          return {
            id: 'v-a1b2',
            pid: 123,
            port: 4419,
            nonce: 'nonce',
            pageUrl: 'http://127.0.0.1:4419/s/nonce/',
            view: {
              target: '/:issues.astrale.ai',
              handshake: 'none',
              route: {
                href: 'https://issues.example/ui/dashboard',
                key: 'issues.astrale.ai:view.dashboard',
              },
            },
            createdAt: '2026-09-03T00:00:00.000Z',
          } as never
        },
      },
    )

    expect(opened).toEqual([
      {
        viewPath: '/:issues.astrale.ai:view.dashboard',
        instance: 'local',
        timeoutMs: 20_000,
        allowIdentity: ['alice', 'bob'],
        serveRuntime: { file: '/cli/astrale', args: [] },
      },
    ])
    expect(result).toMatchObject({
      status: 'ready',
      sessionId: 'v-a1b2',
      target: null,
    })
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
