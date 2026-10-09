import { test, expect } from 'bun:test'
import { once } from 'node:events'

import type { ViewServeConfig } from '../../lib/view/session'

import { startViewServer } from '../../lib/view/server'
import { waitForPageState } from '../view'

test.each(['refreshing', 'degraded', 'expired'])(
  'opening observes recoverable %s without treating the mounted page as failed',
  async (state) => {
    const config: ViewServeConfig = {
      session: {
        id: 'page-state-fixture',
        nonce: 'page-state-fixture',
        pid: 0,
        port: 0,
        pageUrl: '',
        createdAt: '2026-10-06T00:00:00.000Z',
        view: {
          target: '/:fixture.example' as ViewServeConfig['session']['view']['target'],
          route: {
            key: 'fixture.example:view.application',
            declaration: { target: { kind: 'domain' } },
            href: 'https://view.example/',
            handshake: 'none',
            issuer:
              'https://fixture.example' as ViewServeConfig['session']['view']['route']['issuer'],
            release: `sha256:${'a'.repeat(64)}`,
            revision:
              `sha256:${'b'.repeat(64)}` as ViewServeConfig['session']['view']['route']['revision'],
          },
        },
      },
      kernel: {},
      proxy: {
        kernelUrl: 'https://kernel.example',
        issuer: 'https://kernel.example',
        direct: true,
      },
      externalOrigins: [],
      idleMs: 600_000,
    }
    const server = startViewServer(config)
    await once(server, 'listening')
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('Missing HTTP address')
      const pageUrl = `http://127.0.0.1:${address.port}/s/page-state-fixture/`
      const response = await fetch(`${pageUrl}status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state, page: 'viewer' }),
      })
      expect(response.status).toBe(200)
      const result = await waitForPageState({ ...config.session, pageUrl })
      expect(result.state).toBe(state)
      expect(result.state).not.toBe('failed')
      expect(server.listening).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  },
)
