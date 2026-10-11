/**
 * Regression guard: `astrale studio` must not outlive the server it supervises. The studio server
 * exits by itself when a workspace holds no domain; the CLI used to keep probing its port for the
 * full 180s indexing budget regardless, holding the terminal after the failure was on screen.
 */
import { expect, test } from 'bun:test'

import { awaitStudioReadiness, waitForHttp } from '../studio'

/** A port nothing listens on: every probe attempt fails, so the loop keeps retrying. */
const DEAD_URL = 'http://127.0.0.1:1/'
/** A studio the user never stops: readiness must come from the probe alone. */
const running = new Promise<number>(() => {})

test('a server that exits, or an aborted probe, ends the wait instead of holding its budget', async () => {
  let probed: Promise<boolean> | undefined
  const started = Date.now()
  const readiness = await awaitStudioReadiness((abort) => {
    probed = waitForHttp(DEAD_URL, 180_000, abort)
    return probed
  }, Promise.resolve(1))
  expect(readiness).toBe('exited')
  expect(Date.now() - started).toBeLessThan(10_000)
  // The polling loop must actually stop, not merely lose the race: a pending retry timer keeps
  // the event loop alive. If this regresses, awaiting the probe hangs until the test times out.
  expect(await probed).toBe(false)

  const abort = new AbortController()
  const probe = waitForHttp(DEAD_URL, 180_000, abort.signal)
  abort.abort()
  expect(await probe).toBe(false)
})

test('a server is ready once its endpoint answers a successful status, else times out', async () => {
  let probes = 0
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: () => new Response(null, { status: ++probes === 1 ? 503 : 204 }),
  })
  try {
    const url = `http://127.0.0.1:${server.port}/`
    expect(await awaitStudioReadiness((abort) => waitForHttp(url, 10_000, abort), running)).toBe(
      'ready',
    )
    expect(probes).toBe(2)
  } finally {
    server.stop(true)
  }
  expect(await awaitStudioReadiness((abort) => waitForHttp(DEAD_URL, 1, abort), running)).toBe(
    'timeout',
  )
})
