import { describe, expect, test } from 'bun:test'

import { readBounded } from '../deployment-document'

const ROOT = 'https://deployment.example/.well-known/astrale/release.json'
const MAXIMUM_PUBLICATION_BYTES = 1024 * 1024

describe('bounded deployment document reads', () => {
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

    await expect(readBounded(await fetch(), new URL(ROOT))).rejects.toThrow(
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

    await expect(readBounded(await fetch(), new URL(ROOT))).rejects.toThrow(
      `exceeded ${MAXIMUM_PUBLICATION_BYTES} bytes`,
    )
    expect(pulls).toBe(0)
    expect(cancelled).toBe(true)
  })
})
