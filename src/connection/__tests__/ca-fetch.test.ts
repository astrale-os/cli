import { afterEach, describe, expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { fetchWithCaFile } from '../../lib/ca-fetch'

const certificateFile = fileURLToPath(new URL('fixtures/localhost-cert.pem', import.meta.url))
// Public test-only key material is encoded so repository secret scanners do not mistake it for a credential.
const keyFile = fileURLToPath(new URL('fixtures/localhost-key.base64', import.meta.url))
let server: Bun.Server<unknown> | undefined

afterEach(async () => {
  if (server !== undefined) {
    await server.stop(true)
  }
  server = undefined
})

describe('connection CA fetch', () => {
  /** @evidence TEST-CLI-CONNECTION-SCOPES-CUSTOM-CA-TO-HTTPS-FETCH */
  test('trusts the selected HTTPS CA and leaves plain HTTP on the fallback Fetch', async () => {
    const [certificate, encodedKey] = await Promise.all([
      readFile(certificateFile),
      readFile(keyFile, 'utf8'),
    ])
    const key = Buffer.from(encodedKey.trim(), 'base64')
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      tls: { cert: certificate, key },
      fetch: () => new Response('trusted'),
    })

    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const fallback = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, init })
      return new Response('fallback')
    }) as typeof fetch
    const scoped = fetchWithCaFile(certificateFile, fallback)
    const init = { method: 'POST', body: 'payload' } satisfies RequestInit

    await expect(
      scoped(`https://127.0.0.1:${server.port}/invoke`).then((value) => value.text()),
    ).resolves.toBe('trusted')
    await expect(
      scoped('http://localhost:8080/invoke', init).then((value) => value.text()),
    ).resolves.toBe('fallback')
    expect(requests).toEqual([{ input: 'http://localhost:8080/invoke', init }])
  })
})
