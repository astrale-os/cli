import type { Fetch, RequestOptions, Transport, TransportResult } from '@astrale-os/sdk/client'

import { issuer } from '@astrale-os/sdk/auth'
import { ResponseError, retryAfterOf, TransportError } from '@astrale-os/sdk/client'
import { ClientSession } from '@astrale-os/sdk/client/session'
import { Path } from '@astrale-os/sdk/graph/path'
import { describe, expect, test } from 'bun:test'

import { type ResendClock, resendingRefusals } from '../resend'
import { createClientSessionOptions } from '../session'

const KERNEL = issuer.accept('https://kernel.example')
const INVOCATION = Object.freeze({ source: KERNEL, id: 'call-1' })
const CALL = Object.freeze({
  target: Path.parse('/:kernel.astrale.ai:function.whoami').raw,
  input: {},
})
const ANSWER = { kind: 'value', value: 'answered', invocation: INVOCATION } as TransportResult

/** The Host's refusal of an Instance it has not opened yet (kernel `host/kernel/routing/refusal.ts`). */
function hostRefusal(retryAfterMs: number): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: 5001,
        message: 'Instance is unavailable; retry later.',
        data: { code: 'SERVER_DRAINING', details: { retryAfterMs } },
      },
      requestId: null,
      invocation: { source: KERNEL, id: crypto.randomUUID() },
    }),
    {
      status: 503,
      headers: {
        'cache-control': 'no-store',
        'retry-after': '1',
        'content-type': 'application/vnd.astrale+json',
      },
    },
  )
}

function draining(retryAfterMs: number): ResponseError {
  return new ResponseError(5001, 'Instance is unavailable; retry later.', INVOCATION, {
    code: 'SERVER_DRAINING',
    details: { retryAfterMs },
  })
}

/** A clock that only moves when the transport answers or the resend waits. */
function fakeClock(): ResendClock & { advance(ms: number): void; readonly slept: number[] } {
  let now = 0
  const slept: number[] = []
  return {
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms)
      now += ms
    },
    advance: (ms) => void (now += ms),
    slept,
  }
}

/** A transport that answers `answers` in order, each after a `roundTripMs` round trip. */
function scripted(
  clock: ReturnType<typeof fakeClock>,
  answers: readonly unknown[],
  roundTripMs = 5,
) {
  const sent: (RequestOptions | undefined)[] = []
  const transport: Transport = {
    dispatch: async (_input, options) => {
      sent.push(options)
      clock.advance(roundTripMs)
      const answer = answers[Math.min(sent.length, answers.length) - 1]
      if (answer instanceof Error) throw answer
      return answer as TransportResult
    },
  }
  return { transport, sent }
}

describe('refusal resends', () => {
  /** @evidence TEST-CLI-CONNECTION-RESENDS-REFUSAL-AFTER-ITS-DELAY */
  test('a CLI Session resends a draining refusal after its delay and returns the answer', async () => {
    const sent: number[] = []
    const fetch: Fetch = async (_input, init) => {
      sent.push(performance.now())
      if (sent.length <= 2) return hostRefusal(60)
      const { requestId } = JSON.parse(String(init?.body)) as { requestId: number }
      return new Response(
        JSON.stringify({ requestId, invocation: INVOCATION, result: 'answered' }),
        {
          headers: { 'cache-control': 'no-store', 'content-type': 'application/vnd.astrale+json' },
        },
      )
    }
    const session = new ClientSession(
      createClientSessionOptions(
        { url: `${KERNEL}/invoke`, kernelIssuer: KERNEL },
        fetch,
        undefined,
        5_000,
        {
          read: () => undefined,
          write: () => undefined,
        },
      ),
    )
    try {
      const started = performance.now()
      expect(await session.call(CALL)).toBe('answered')
      expect(performance.now() - started).toBeGreaterThanOrEqual(120)
      expect(sent).toHaveLength(3)
      expect(sent[1]! - sent[0]!).toBeGreaterThanOrEqual(60)
      expect(sent[2]! - sent[1]!).toBeGreaterThanOrEqual(60)
    } finally {
      session.close()
    }
  })

  /** @evidence TEST-CLI-CONNECTION-SURFACES-REFUSAL-BEFORE-DEADLINE */
  test('surfaces the last refusal unchanged once the next attempt could not end in time', async () => {
    const clock = fakeClock()
    const refusals = [draining(1_000), draining(1_000), draining(1_000), draining(1_000)]
    const { transport, sent } = scripted(clock, refusals)
    const pending = resendingRefusals(transport, 30_000, clock).dispatch(CALL as never, {
      timeoutMs: 3_500,
    })
    await expect(pending).rejects.toBe(refusals[3]!)
    // Sent at 0, 1005, 2010 and 3015; refused at 3020, when 1000 ms more and one round trip end
    // past the 3500 ms deadline.
    expect(clock.now()).toBe(3_020)
    expect(clock.slept).toEqual([1_000, 1_000, 1_000])
    expect(sent.map((options) => options?.timeoutMs)).toEqual([3_500, 2_495, 1_490, 485])
    expect(retryAfterOf(refusals[3])).toBe(1_000)
  })

  /** @evidence TEST-CLI-CONNECTION-NEVER-RESENDS-UNSETTLED-OUTCOMES */
  test('never resends a failure whose outcome is unknown, nor a refusal without a delay', async () => {
    for (const failure of [
      new ResponseError(5000, 'Internal error.', INVOCATION),
      new ResponseError(5002, 'Outcome unknown.', INVOCATION),
      new ResponseError(5001, 'Backend unavailable.', INVOCATION),
      TransportError.invocation('lost', { phase: 'receive', delivery: 'unknown' }),
    ]) {
      const clock = fakeClock()
      const { transport, sent } = scripted(clock, [failure, ANSWER])
      await expect(
        resendingRefusals(transport, 30_000, clock).dispatch(CALL as never),
      ).rejects.toBe(failure)
      expect(sent).toHaveLength(1)
      expect(clock.slept).toEqual([])
    }
  })

  /** @evidence TEST-CLI-CONNECTION-BOUNDS-REFUSAL-RESENDS */
  test('bounds resends to one per second of the timeout and stops on cancellation', async () => {
    const clock = fakeClock()
    const zero = draining(0)
    const { transport, sent } = scripted(clock, [zero], 0)
    await expect(resendingRefusals(transport, 3_000, clock).dispatch(CALL as never)).rejects.toBe(
      zero,
    )
    expect(sent).toHaveLength(4)

    const cancelled = new AbortController()
    const waiting = fakeClock()
    const refusal = draining(1_000)
    const once = scripted(waiting, [refusal, ANSWER])
    const sleeping: ResendClock = {
      now: waiting.now,
      sleep: async (ms, signal) => {
        cancelled.abort()
        expect(signal?.aborted).toBe(true)
        await waiting.sleep(ms)
      },
    }
    await expect(
      resendingRefusals(once.transport, 30_000, sleeping).dispatch(CALL as never, {
        signal: cancelled.signal,
      }),
    ).rejects.toBe(refusal)
    expect(once.sent).toHaveLength(1)
  })
})
