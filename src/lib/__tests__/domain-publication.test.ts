import { publication } from '@astrale-os/kernel-protocol'
import { defineDomain } from '@astrale-os/sdk'
import { issuer } from '@astrale-os/sdk/auth'
import { createDeployment } from '@astrale-os/sdk/deployment'
import { defineSchema } from '@astrale-os/sdk/schema/v1'
import { describe, expect, test } from 'bun:test'

import { fetchDomainPublication } from '../domain-publication'

const ROOT = 'https://publication-reader.example.dev'
const PUBLICATION_URL = `${ROOT}/.well-known/astrale/domain.json`
const MAXIMUM_PUBLICATION_BYTES = 1024 * 1024
const schema = defineSchema('publication-reader.example.dev', {})
const definition = defineDomain({
  schema,
  handlers: { functions: {}, classes: {}, interfaces: {} },
})
const deployed = createDeployment({
  definition,
  issuer: issuer.accept(ROOT),
  bundleHref: `${ROOT}/domain.bundle.json`,
  bindings: { callables: [] },
}).publication

describe('Domain Publication reader', () => {
  test('fetches only the canonical path with redirects disabled', async () => {
    const requests: Array<{ readonly url: string; readonly redirect?: RequestRedirect }> = []
    const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push({ url: String(input), redirect: init?.redirect })
      return Response.json(deployed)
    }

    await expect(fetchDomainPublication(`${ROOT}/`, undefined, fetch)).resolves.toEqual(deployed)
    expect(requests).toEqual([{ url: PUBLICATION_URL, redirect: 'error' }])
  })

  test('propagates redirect rejection instead of accepting another target', async () => {
    const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      expect(init?.redirect).toBe('error')
      throw new TypeError('redirect rejected')
    }

    await expect(fetchDomainPublication(ROOT, undefined, fetch)).rejects.toThrow(
      'redirect rejected',
    )
  })

  test('stops at one MiB and cancels an over-limit response stream', async () => {
    let pulls = 0
    let cancelled = false
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1
          if (pulls === 1) {
            controller.enqueue(new Uint8Array(MAXIMUM_PUBLICATION_BYTES))
            return
          }
          if (pulls === 2) {
            controller.enqueue(Uint8Array.of(0))
            return
          }
          controller.error(new Error('reader consumed beyond its byte limit'))
        },
        cancel() {
          cancelled = true
        },
      },
      { highWaterMark: 0 },
    )
    const fetch = async (): Promise<Response> => new Response(body)

    await expect(fetchDomainPublication(ROOT, undefined, fetch)).rejects.toThrow(
      `exceeded ${MAXIMUM_PUBLICATION_BYTES} bytes`,
    )
    expect(pulls).toBe(2)
    expect(cancelled).toBe(true)
  })

  test('rejects an oversized Content-Length before pulling and cancels the body', async () => {
    let pulls = 0
    let cancelled = false
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulls += 1
        },
        cancel() {
          cancelled = true
        },
      },
      { highWaterMark: 0 },
    )
    const fetch = async (): Promise<Response> =>
      new Response(body, {
        headers: { 'content-length': String(MAXIMUM_PUBLICATION_BYTES + 1) },
      })

    await expect(fetchDomainPublication(ROOT, undefined, fetch)).rejects.toThrow(
      `exceeded ${MAXIMUM_PUBLICATION_BYTES} bytes`,
    )
    expect(pulls).toBe(0)
    expect(cancelled).toBe(true)
  })

  test.each([
    ['invalid UTF-8', Uint8Array.of(0xc3, 0x28), TypeError],
    ['invalid JSON', new TextEncoder().encode('{'), SyntaxError],
    ['invalid Publication', new TextEncoder().encode('{}'), publication.PublicationError],
  ] as const)('rejects %s before returning a Publication', async (_label, bytes, Cause) => {
    const fetch = async (): Promise<Response> => new Response(bytes)
    const error = await rejection(fetchDomainPublication(ROOT, undefined, fetch))

    expect(error.message).toBe(`GET ${PUBLICATION_URL} returned an invalid Domain Publication`)
    expect(error.cause).toBeInstanceOf(Cause)
  })

  test.each([
    `${ROOT}/nested`,
    `${ROOT}?deployment=current`,
    `${ROOT}#fragment`,
    'https://user:secret@publication-reader.example.dev',
    'ftp://publication-reader.example.dev',
  ])('rejects a non-origin deployment URL before fetch: %s', async (input) => {
    let called = false
    const fetch = async (): Promise<Response> => {
      called = true
      return Response.json(deployed)
    }

    await expect(fetchDomainPublication(input, undefined, fetch)).rejects.toBeInstanceOf(TypeError)
    expect(called).toBe(false)
  })
})

async function rejection(input: Promise<unknown>): Promise<Error> {
  try {
    await input
  } catch (cause) {
    if (cause instanceof Error) return cause
    throw new Error('Expected an Error rejection.', { cause })
  }
  throw new Error('Expected the promise to reject.')
}
