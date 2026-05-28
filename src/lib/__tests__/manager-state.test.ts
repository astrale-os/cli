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

  test('registers exactly one named guard per event, regardless of call count', () => {
    // Structural assertion: filter listeners by their function name so the
    // test distinguishes a real idempotent guard (exactly one named handler)
    // from a buggy no-op (zero named handlers) and from a buggy stacking
    // (more than one). Relies on Function.name preserved at runtime —
    // source-mode only. The CLI runs from source via bun; if we ever bundle
    // with a minifier we'd need to keep named function expressions.
    registerProcessGuards()
    registerProcessGuards()
    registerProcessGuards()
    const rejGuards = process
      .listeners('unhandledRejection')
      .filter((h) => h.name === 'astraleManagerGuardRejection')
    const excGuards = process
      .listeners('uncaughtException')
      .filter((h) => h.name === 'astraleManagerGuardException')
    expect(rejGuards).toHaveLength(1)
    expect(excGuards).toHaveLength(1)
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
