/**
 * Regression test for `registerProcessGuards`.
 *
 * Invariants under test:
 *  - The helper is idempotent — repeated calls register handlers exactly once
 *    so test fixtures cannot accidentally stack listeners.
 *  - When invoked with an unhandled rejection, the registered handler does
 *    NOT call `process.exit` (log-not-exit).
 *  - Same for an uncaught exception.
 *
 * Why: host-mode runs the manager as a single detached bun process with NO
 * supervisor (cf [[ project_manager_crash_async_isolation_rca ]]). A stray
 * async rejection reaching the process default handler would kill the manager
 * — taking every mounted instance down. We trade "definitely dead" for
 * "logged and alive".
 *
 * Note: we invoke the registered listener directly (not via the runtime's
 * event emission) because bun:test installs its own absorbing handler that
 * would mark a real emission as a test failure and obscure the assertion.
 */
import { afterEach, describe, expect, test } from 'bun:test'

import { registerProcessGuards } from '../manager-state'

describe('registerProcessGuards', () => {
  const cleanup: Array<() => void> = []
  afterEach(() => {
    while (cleanup.length) cleanup.pop()!()
  })

  test('is idempotent — repeated calls register handlers exactly once per process', () => {
    const beforeUnhandled = process.listenerCount('unhandledRejection')
    const beforeUncaught = process.listenerCount('uncaughtException')
    registerProcessGuards()
    registerProcessGuards()
    registerProcessGuards()
    const afterUnhandled = process.listenerCount('unhandledRejection')
    const afterUncaught = process.listenerCount('uncaughtException')
    // First call in the process registers +1 each; subsequent calls are no-ops.
    // Across multiple tests in the same process the flag stays set → delta is 0.
    expect(afterUnhandled - beforeUnhandled).toBeLessThanOrEqual(1)
    expect(afterUncaught - beforeUncaught).toBeLessThanOrEqual(1)
    // After at least one call, at least one of each handler must exist.
    expect(afterUnhandled).toBeGreaterThanOrEqual(1)
    expect(afterUncaught).toBeGreaterThanOrEqual(1)
  })

  test('the unhandledRejection handler does NOT call process.exit when invoked', () => {
    registerProcessGuards()
    const handlers = process.listeners('unhandledRejection')
    expect(handlers.length).toBeGreaterThanOrEqual(1)

    let exitCalled = false
    const origExit = process.exit
    process.exit = ((_code?: number) => {
      exitCalled = true
      return undefined as never
    }) as typeof process.exit
    cleanup.push(() => {
      process.exit = origExit
    })

    // The most recently registered listener is ours (subsequent
    // registerProcessGuards calls are no-ops thanks to the flag).
    const myHandler = handlers[handlers.length - 1]!
    // `unhandledRejection` listener signature: (reason, promise).
    myHandler(new Error('test-unhandled'), Promise.resolve())

    expect(exitCalled).toBe(false)
  })

  test('the uncaughtException handler does NOT call process.exit when invoked', () => {
    registerProcessGuards()
    const handlers = process.listeners('uncaughtException')
    expect(handlers.length).toBeGreaterThanOrEqual(1)

    let exitCalled = false
    const origExit = process.exit
    process.exit = ((_code?: number) => {
      exitCalled = true
      return undefined as never
    }) as typeof process.exit
    cleanup.push(() => {
      process.exit = origExit
    })

    const myHandler = handlers[handlers.length - 1]!
    // `uncaughtException` listener signature: (err, origin?).
    myHandler(new Error('test-uncaught'), 'uncaughtException')

    expect(exitCalled).toBe(false)
  })
})
