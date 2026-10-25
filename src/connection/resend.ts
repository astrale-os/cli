import type {
  Fetch,
  RequestOptions,
  Transport,
  TransportRequest,
  TransportResult,
} from '@astrale-os/sdk/client'
import type { ClientSessionOptions } from '@astrale-os/sdk/client/session'

import { Client, HttpTransport, retryAfterOf } from '@astrale-os/sdk/client'

/**
 * The pause the Kernel's refusals ask for (`Retry-After: 1`). An invocation is resent at most once
 * per such pause of its timeout, so the bound never shortens a wait the Kernel paces, and a
 * refusal that keeps asking for no pause cannot turn into a flood.
 */
const RESEND_PACE_MS = 1_000

/** Time as the resending Transport reads and waits it. */
export interface ResendClock {
  readonly now: () => number
  /** Resolve after `ms`, or as soon as `signal` aborts. */
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
}

const SYSTEM_CLOCK: ResendClock = Object.freeze({
  now: () => Date.now(),
  sleep: (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      signal?.addEventListener('abort', done, { once: true })
    }),
})

/**
 * A Transport that sends an invocation again when the Kernel refused it before admitting any work:
 * a Protocol retry reason (`SERVER_DRAINING`, `CAPACITY_EXHAUSTED`, `INSTANCE_MAINTENANCE`), whose
 * advertised delay `retryAfterOf` returns. It waits that delay, then resends the same request with
 * what is left of its timeout. It stops when the next attempt could not end before the request's
 * deadline, judging by the attempt just refused, when the request is cancelled, or when the resends
 * reach their bound; the last refusal then surfaces unchanged. Every other failure surfaces at once:
 * a transport failure whose outcome is unknown, OUTCOME_UNKNOWN, and every refusal without a retry
 * delay.
 */
export function resendingRefusals(
  transport: Transport,
  timeoutMs: number,
  clock: ResendClock = SYSTEM_CLOCK,
): Transport {
  return Object.freeze({
    async dispatch(input: TransportRequest, options?: RequestOptions): Promise<TransportResult> {
      const budgetMs = options?.timeoutMs ?? timeoutMs
      const deadline = clock.now() + budgetMs
      const resends = Math.ceil(budgetMs / RESEND_PACE_MS)
      const cancelled = () => options?.signal?.aborted === true
      let sending = options
      for (let resent = 0; ; resent += 1) {
        const sent = clock.now()
        try {
          return await transport.dispatch(input, sending)
        } catch (refusal) {
          const delayMs = retryAfterOf(refusal)
          const refused = clock.now()
          if (
            delayMs === undefined ||
            resent >= resends ||
            cancelled() ||
            refused + delayMs + (refused - sent) >= deadline
          ) {
            throw refusal
          }
          await clock.sleep(delayMs, options?.signal)
          const remainingMs = deadline - clock.now()
          if (cancelled() || remainingMs <= 0) throw refusal
          sending = { ...options, timeoutMs: remainingMs }
        }
      }
    },
    ...(transport.close === undefined ? {} : { close: () => transport.close?.() }),
  })
}

/**
 * The Client a CLI Session pools for each envelope target: HTTP, as every CLI Session sends its
 * envelopes, through {@link resendingRefusals}. Streaming and binary calls keep the Session's own
 * HTTP Client, so they are never resent.
 */
export function resendingClients(
  fetch: Fetch,
  timeoutMs: number,
  clock: ResendClock = SYSTEM_CLOCK,
): NonNullable<ClientSessionOptions['client']> {
  return (target) => {
    if (target.transport !== 'http') {
      throw new TypeError('A CLI Session sends its envelopes over HTTP only.')
    }
    return new Client({
      transport: resendingRefusals(
        new HttpTransport({ url: target.url, fetch, timeoutMs }),
        timeoutMs,
        clock,
      ),
    })
  }
}
