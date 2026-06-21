import type { StudioEvent } from '@shared/types'

import { useEffect, useRef } from 'react'

/**
 * Subscribe to the studio's server-sent event stream.
 *
 * The socket is tied to MOUNT (empty deps + a handler ref), NOT to `onEvent`'s
 * identity — otherwise any render that changes the callback reference would close
 * and reopen the EventSource, and since SSE has no replay, live agent frames
 * emitted during that gap would be lost. EventSource only auto-reconnects from a
 * transient CONNECTING drop; a CLOSED socket (backend/harness restart) never
 * retries, so we reconnect it ourselves with backoff. On every (re)connect the
 * server sends a `hello` frame the consumer can use to resync missed state.
 */
export function useEventStream(onEvent: (e: StudioEvent) => void) {
  const cb = useRef(onEvent)
  useEffect(() => {
    cb.current = onEvent
  })

  useEffect(() => {
    let es: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    let backoff = 1000

    const open = () => {
      es = new EventSource('/api/events')
      es.onmessage = (msg) => {
        backoff = 1000
        try {
          cb.current(JSON.parse(msg.data) as StudioEvent)
        } catch {
          /* ignore malformed frames */
        }
      }
      es.onerror = () => {
        // CONNECTING → the browser is already retrying; leave it. CLOSED → dead
        // (non-2xx / gone endpoint), reconnect ourselves with capped backoff.
        if (es && es.readyState === EventSource.CLOSED && !stopped) {
          es.close()
          timer = setTimeout(open, backoff)
          backoff = Math.min(backoff * 2, 15000)
        }
      }
    }

    open()
    return () => {
      stopped = true
      clearTimeout(timer)
      es?.close()
    }
  }, [])
}
