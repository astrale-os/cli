/**
 * Regression guard: `astrale studio` must not outlive the server it supervises.
 *
 * The studio server exits by itself when a workspace holds no domain — it prints
 * the reason and returns non-zero. The CLI used to keep probing its port for the
 * full 180s indexing budget regardless, so the terminal stayed hostage for three
 * minutes after the failure was already on screen.
 */
import { expect, test } from 'bun:test'

import { awaitStudioReadiness, waitForHttp } from '../studio'

/** A port nothing listens on: every probe attempt fails, so the loop keeps retrying. */
const DEAD_URL = 'http://127.0.0.1:1/'

test('a server that exits ends the wait instead of holding the probe budget', async () => {
  let probed: Promise<boolean> | undefined
  const started = Date.now()

  const readiness = await awaitStudioReadiness((abort) => {
    probed = waitForHttp(DEAD_URL, 180_000, abort)
    return probed
  }, Promise.resolve(1))

  expect(readiness).toBe('exited')
  expect(Date.now() - started).toBeLessThan(10_000)
  // The polling loop must actually stop, not merely lose the race: a pending
  // retry timer keeps the event loop alive and the terminal blocked. If this
  // regresses, awaiting the probe hangs until the test times out.
  expect(await probed).toBe(false)
})

test('an aborted probe stops polling and reports that it never came up', async () => {
  const abort = new AbortController()
  const probe = waitForHttp(DEAD_URL, 180_000, abort.signal)
  abort.abort()
  expect(await probe).toBe(false)
})

test('a server that answers is reported ready', async () => {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('ok') })
  try {
    const readiness = await awaitStudioReadiness(
      (abort) => waitForHttp(`http://127.0.0.1:${server.port}/`, 10_000, abort),
      // A studio the user never stops: readiness must come from the probe alone.
      new Promise<number>(() => {}),
    )
    expect(readiness).toBe('ready')
  } finally {
    server.stop(true)
  }
})

test('a probe that exhausts its budget while the server lives reports a timeout', async () => {
  const readiness = await awaitStudioReadiness(
    (abort) => waitForHttp(DEAD_URL, 1, abort),
    new Promise<number>(() => {}),
  )
  expect(readiness).toBe('timeout')
})
