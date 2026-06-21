/**
 * sse.ts — a tiny server-sent-events hub. One-directional server→client; the
 * studio is read-only so the client never pushes here (it uses POST).
 */
import type { StudioEvent } from '../shared/types'

const encoder = new TextEncoder()
const clients = new Map<number, ReadableStreamDefaultController<Uint8Array>>()
let nextId = 1

export function sseResponse(domains: string[]): Response {
  let id = 0
  let keepalive: ReturnType<typeof setInterval> | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      id = nextId++
      clients.set(id, controller)
      controller.enqueue(encoder.encode(frame({ type: 'hello', domains })))
      // keepalive comment every 20s — long agent turns can go minutes between
      // events; without this the connection is idle and gets dropped.
      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          clearInterval(keepalive)
          clients.delete(id)
        }
      }, 20_000)
    },
    cancel() {
      clearInterval(keepalive)
      clients.delete(id)
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  })
}

export function broadcast(event: StudioEvent): void {
  const payload = encoder.encode(frame(event))
  for (const [id, c] of clients) {
    try {
      c.enqueue(payload)
    } catch {
      clients.delete(id)
    }
  }
}

function frame(event: StudioEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}
