import { describe, expect, test } from 'bun:test'
import { once } from 'node:events'

import type { ViewServeConfig } from '../view/session'

import { findFreePort } from '../port'
import { startViewServer } from '../view/server'

const digest = (character: string) => `sha256:${character.repeat(64)}` as const
const target = (value: string) => value as ViewServeConfig['session']['view']['target']
const issuer = (value: string) => value as ViewServeConfig['session']['view']['route']['issuer']
const revision = (character: string) =>
  digest(character) as ViewServeConfig['session']['view']['route']['revision']

describe('view session server credentials', () => {
  /** @evidence TEST-CLI-PLAIN-VIEW-RECEIVES-NO-CREDENTIAL */
  test('refuses to mint a token for a handshake-none View', async () => {
    const nonce = 'plain-view'
    const port = await findFreePort(48_000, 200)
    if (port === null) throw new Error('test port window exhausted')
    const config = {
      session: {
        id: 'v-plain',
        pid: 0,
        port,
        nonce,
        pageUrl: `http://127.0.0.1:${port}/`,
        view: {
          target: target('/:example.test'),
          route: {
            key: 'example.test:view.public',
            declaration: { target: { kind: 'domain' } },
            href: 'https://example.test/ui/public',
            handshake: 'none',
            issuer: issuer('https://example.test'),
            etag: digest('a'),
            revision: revision('b'),
          },
        },
        createdAt: '2026-08-20T00:00:00.000Z',
      },
      kernel: { creds: 'must-not-be-used' },
      proxy: {
        kernelUrl: 'https://kernel.test',
        issuer: 'https://kernel.test',
        direct: true,
      },
      idleMs: 60_000,
    } satisfies ViewServeConfig
    const server = startViewServer(config)
    await once(server, 'listening')

    try {
      const response = await fetch(`http://127.0.0.1:${port}/s/${nonce}/token`, {
        method: 'POST',
      })

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        error: 'plain views have no Astrale credential privilege',
      })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})
