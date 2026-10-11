import type { Server } from 'node:http'

import { once } from 'node:events'

import type { ViewServeConfig } from '../view/session'

import { startViewServer } from '../view/server'

type Route = ViewServeConfig['session']['view']['route']

/** What the loopback host page sends on every host-only route. */
export const HOST = { 'x-astrale-view-host': '1' }

/**
 * One compact credential the Kernel could have minted. `credential.inspect` admits three non-empty
 * base64url segments and never verifies a signature, so an unsigned envelope is enough to exercise
 * the expiration the server reads.
 */
export function mintedCredential(subject: string, expiresAtSeconds = 4_102_444_800): string {
  const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return [
    segment({ alg: 'ES256', typ: 'JWT' }),
    segment({
      iss: 'https://kernel.test',
      aud: 'https://kernel.test',
      sub: subject,
      exp: expiresAtSeconds,
    }),
    'signature',
  ].join('.')
}

/** A View session config on `https://kernel.test` for `example.test`'s board View. */
export function viewConfig(
  nonce: string,
  overrides: Partial<Omit<ViewServeConfig, 'session'>> & {
    readonly handshake?: Route['handshake']
    readonly issuer?: string
    readonly identity?: string
  } = {},
): ViewServeConfig {
  const { handshake = 'shell', issuer = 'https://kernel.test', identity, ...rest } = overrides
  return {
    session: {
      id: `v-${nonce}`,
      pid: 0,
      // Let the OS isolate each server from connections pooled by earlier tests.
      port: 0,
      nonce,
      pageUrl: '',
      view: {
        target: '/:example.test' as ViewServeConfig['session']['view']['target'],
        route: {
          key: 'example.test:view.board',
          declaration: { target: { kind: 'domain' } },
          href: 'https://example.test/ui/board',
          handshake,
          issuer: issuer as Route['issuer'],
          release: `sha256:${'a'.repeat(64)}`,
          revision: `sha256:${'b'.repeat(64)}` as Route['revision'],
        },
      },
      ...(identity === undefined ? {} : { identity }),
      createdAt: '2026-08-20T00:00:00.000Z',
    },
    kernel: { instance: 'managed', as: 'dispatcher' },
    proxy: { kernelUrl: 'https://kernel.test', issuer: 'https://kernel.test', direct: true },
    externalOrigins: [],
    idleMs: 600_000,
    ...rest,
  }
}

/** Start a View server, run `body` against its session base URL, then close it. */
export async function serving<Value>(
  config: ViewServeConfig,
  dependencies: Partial<NonNullable<Parameters<typeof startViewServer>[1]>>,
  body: (session: string, server: Server) => Promise<Value>,
): Promise<Value> {
  const server = startViewServer(config, {
    connect: async () => {
      throw new Error('This View session opens no Kernel connection')
    },
    ...dependencies,
  })
  await once(server, 'listening')
  try {
    return await body(`${address(server)}/s/${config.session.nonce}`, server)
  } finally {
    server.closeAllConnections()
    server.close()
  }
}

export function address(server: Server): string {
  const value = server.address()
  if (value === null || typeof value === 'string') throw new Error('Missing HTTP address')
  return `http://127.0.0.1:${value.port}`
}
