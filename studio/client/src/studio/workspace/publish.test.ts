import type {
  ChangeReport,
  PublishEvent,
  PublishRefusal,
  PublishReport,
  PublishRequest,
  Remote,
} from '@shared/contracts/versions'

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  IDLE_PUBLISH,
  NO_CHOICE,
  type PublishAction,
  type PublishState,
  type PublishStream,
  confirmGate,
  isRunning,
  publishReducer,
  refusalAdvice,
  requestOf,
  resultSentences,
  runPublish,
  takeLook,
  usePublishRuns,
} from './publish'
import { ADMIN_LOCAL, ISSUES_LOCAL, failure, ok, report } from './test-fixtures'

/** A machine driven by actions, remembering every state it passed through. */
function machine(start: PublishState = IDLE_PUBLISH) {
  let state = start
  const phases: string[] = [state.phase]
  const dispatch = (action: PublishAction) => {
    const next = publishReducer(state, action)
    if (next !== state) phases.push(next.phase)
    state = next
  }
  return {
    dispatch,
    phases,
    current: () => state,
    get state() {
      return state
    },
  }
}

const LOOKED = report({ look: 'look-7' })
const REQUEST: PublishRequest = { environment: 'development', look: 'look-7', allowDirty: true }

const PUBLISHED: PublishReport = {
  origin: 'issues.astrale.ai',
  environment: 'development',
  publication: { version: '0.8.8', status: 'created' },
  deployment: 'created',
  url: 'https://issues.example.test',
  releaseDigest: 'sha256:release',
  buildDigest: 'sha256:build',
  commit: null,
}

const STARTED: PublishEvent = {
  type: 'started',
  domainId: 'issues',
  environment: 'development',
  look: 'look-7',
  command: ['astrale-domain', 'publish', '--env', 'development', '--json', '--allow-dirty'],
}

/** A Publish stream that plays `events`, then answers `outcome`. */
function fakeStream(
  events: PublishEvent[],
  outcome?: Awaited<ReturnType<PublishStream>> | Error,
): PublishStream & { calls: Array<{ domainId: string; request: PublishRequest }> } {
  const calls: Array<{ domainId: string; request: PublishRequest }> = []
  const stream = (async (domainId, request, onEvent) => {
    calls.push({ domainId, request })
    for (const event of events) {
      await Promise.resolve()
      onEvent(event)
    }
    if (outcome instanceof Error) throw outcome
    const result = events.findLast((event) => event.type === 'result')
    return outcome ?? { result: result as Extract<PublishEvent, { type: 'result' }> }
  }) as PublishStream & { calls: typeof calls }
  stream.calls = calls
  return stream
}

async function lookedMachine() {
  const run = machine()
  await takeLook(async () => ok(LOOKED), run.dispatch)
  return run
}

describe('a fresh look', () => {
  test('a report puts the machine in review', async () => {
    const run = await lookedMachine()
    expect(run.phases).toEqual(['idle', 'looking', 'review'])
    expect(run.state).toEqual({ phase: 'review', report: LOOKED })
  })

  test('a remote failure is a failed look, with its own status', async () => {
    const run = machine()
    await takeLook(
      async () => failure('signed-out', 'No default identity.', 'NO_IDENTITY'),
      run.dispatch,
    )
    expect(run.state).toMatchObject({
      phase: 'look-failed',
      failure: { status: 'signed-out', message: 'No default identity.', code: 'NO_IDENTITY' },
    })
  })

  test('a look that throws fails too; nothing is left looking', async () => {
    const run = machine()
    await takeLook(async () => {
      throw new Error('Failed to fetch')
    }, run.dispatch)
    expect(run.state).toEqual({
      phase: 'look-failed',
      failure: { status: 'failed', message: 'Failed to fetch' },
    })
  })

  test('a look never interrupts a running Publish', () => {
    const running: PublishState = { phase: 'running', report: LOOKED, request: REQUEST, lines: [] }
    expect(publishReducer(running, { type: 'look' })).toBe(running)
    expect(publishReducer(running, { type: 'reset' })).toBe(running)
    expect(isRunning(running)).toBe(true)
  })

  test('a late answer to an older look is ignored', () => {
    const review: PublishState = { phase: 'review', report: LOOKED }
    expect(publishReducer(review, { type: 'looked', answer: ok(report({ look: 'old' })) })).toBe(
      review,
    )
  })
})

describe('the Publish over a faked stream', () => {
  test('success: started, progress, then the report', async () => {
    const run = await lookedMachine()
    const stream = fakeStream([
      STARTED,
      { type: 'progress', tone: 'step', line: '› building issues.astrale.ai' },
      { type: 'progress', tone: 'warning', line: '! no commit recorded' },
      { type: 'result', ok: true, report: PUBLISHED, unrelayedLines: 3 },
    ])
    await runPublish(stream, 'issues', REQUEST, run.dispatch, run.current)
    expect(stream.calls).toEqual([{ domainId: 'issues', request: REQUEST }])
    expect(run.phases).toEqual([
      'idle',
      'looking',
      'review',
      'starting',
      'running',
      'running',
      'running',
      'published',
    ])
    expect(run.state).toMatchObject({
      phase: 'published',
      result: PUBLISHED,
      unrelayedLines: 3,
      started: STARTED,
      lines: [
        { tone: 'step', line: '› building issues.astrale.ai' },
        { tone: 'warning', line: '! no commit recorded' },
      ],
    })
  })

  test('a failed result: the platform ran and refused', async () => {
    const run = await lookedMachine()
    await runPublish(
      fakeStream([
        STARTED,
        { type: 'progress', tone: 'refusal', line: '✗ version 0.8.8 is below 0.9.1' },
        {
          type: 'result',
          ok: false,
          message: 'version 0.8.8 is below 0.9.1',
          exitCode: 2,
          unrelayedLines: 0,
        },
      ]),
      'issues',
      REQUEST,
      run.dispatch,
      run.current,
    )
    expect(run.state).toMatchObject({
      phase: 'failed',
      message: 'version 0.8.8 is below 0.9.1',
      exitCode: 2,
      lines: [{ tone: 'refusal', line: '✗ version 0.8.8 is below 0.9.1' }],
    })
  })

  test('a result the stream returns without relaying it still settles the run', async () => {
    const run = await lookedMachine()
    await runPublish(
      fakeStream([STARTED], {
        result: { type: 'result', ok: true, report: PUBLISHED, unrelayedLines: 0 },
      }),
      'issues',
      REQUEST,
      run.dispatch,
      run.current,
    )
    expect(run.state.phase).toBe('published')
  })

  test('a broken stream: whether the platform finished is not known', async () => {
    const run = await lookedMachine()
    await runPublish(
      fakeStream(
        [STARTED, { type: 'progress', tone: 'step', line: '› deploying' }],
        new Error('network error'),
      ),
      'issues',
      REQUEST,
      run.dispatch,
      run.current,
    )
    expect(run.state).toMatchObject({
      phase: 'error',
      message: 'network error',
      lines: [{ tone: 'step', line: '› deploying' }],
    })
  })

  test('a stream that breaks after its result keeps the result', async () => {
    const run = await lookedMachine()
    await runPublish(
      fakeStream(
        [STARTED, { type: 'result', ok: true, report: PUBLISHED, unrelayedLines: 0 }],
        new Error('closed'),
      ),
      'issues',
      REQUEST,
      run.dispatch,
      run.current,
    )
    expect(run.state.phase).toBe('published')
  })

  test('a refusal the Studio server does not explain is an error, not a refusal', async () => {
    const run = await lookedMachine()
    await runPublish(
      fakeStream([], {
        refused: { error: 'teapot', message: 'short and stout' } as unknown as PublishRefusal,
      }),
      'issues',
      REQUEST,
      run.dispatch,
      run.current,
    )
    expect(run.state).toMatchObject({ phase: 'error' })
    expect((run.state as { message: string }).message).toContain('does not explain')
  })

  test('nothing starts outside review or a refusal', async () => {
    const run = machine()
    const stream = fakeStream([STARTED])
    await runPublish(stream, 'issues', REQUEST, run.dispatch, run.current)
    expect(run.phases).toEqual(['idle'])
    expect(stream.calls).toEqual([])
  })

  test('a second confirmation while the first is starting sends nothing', async () => {
    const run = await lookedMachine()
    const stream = fakeStream([
      STARTED,
      { type: 'result', ok: true, report: PUBLISHED, unrelayedLines: 0 },
    ])
    await Promise.all([
      runPublish(stream, 'issues', REQUEST, run.dispatch, run.current),
      runPublish(stream, 'issues', REQUEST, run.dispatch, run.current),
    ])
    expect(stream.calls).toHaveLength(1)
    expect(run.state.phase).toBe('published')
  })
})

describe('every PublishRefusal', () => {
  const refusals: Array<[PublishRefusal['error'], string]> = [
    ['publish-disabled', 'none'],
    ['look-missing', 'look-again'],
    ['look-stale', 'look-again'],
    ['look-refused', 'look-again'],
    ['environment-unknown', 'choose-environment'],
    ['publish-running', 'try-again'],
    ['tooling-missing', 'try-again'],
    ['invalid-request', 'look-again'],
  ]
  for (const [error, action] of refusals) {
    test(`${error}: refused before anything ran, with a sentence and the act that fixes it`, async () => {
      const run = await lookedMachine()
      const refusal: PublishRefusal = { error, message: `the server said ${error}` }
      await runPublish(
        fakeStream([], { refused: refusal }),
        'issues',
        REQUEST,
        run.dispatch,
        run.current,
      )
      expect(run.phases.slice(-2)).toEqual(['starting', 'refused'])
      expect(run.state).toEqual({ phase: 'refused', report: LOOKED, request: REQUEST, refusal })
      const advice = refusalAdvice(refusal)
      expect(advice.action).toBe(action as typeof advice.action)
      expect(advice.headline).toMatch(/\.$/)
      expect(advice.remedy).toMatch(/\.$/)
    })
  }

  test('choosing another Environment goes back to the same look', () => {
    const refused: PublishState = {
      phase: 'refused',
      report: LOOKED,
      request: REQUEST,
      refusal: { error: 'environment-unknown', message: 'no staging' },
    }
    expect(publishReducer(refused, { type: 'revise' })).toEqual({ phase: 'review', report: LOOKED })
  })

  test('trying again starts from the refusal', async () => {
    const run = machine({
      phase: 'refused',
      report: LOOKED,
      request: REQUEST,
      refusal: { error: 'publish-running', message: 'busy' },
    })
    await runPublish(
      fakeStream([STARTED, { type: 'result', ok: true, report: PUBLISHED, unrelayedLines: 0 }]),
      'issues',
      REQUEST,
      run.dispatch,
      run.current,
    )
    expect(run.state.phase).toBe('published')
  })
})

describe('the confirmation gate', () => {
  const clean = { ...ISSUES_LOCAL, git: { commit: '1f8e2c52aa', dirty: false } }

  test('ready only once an Environment is chosen and the version typed', () => {
    expect(confirmGate(LOOKED, clean, { kind: 'ahead', latest: '0.8.7' }, NO_CHOICE)).toEqual({
      ready: false,
      missing: ['Choose an Environment.', 'Type 0.8.8 to confirm.'],
      needsAllowDirty: false,
    })
    const gate = confirmGate(LOOKED, clean, undefined, {
      environment: 'production',
      typed: ' 0.8.8 ',
      allowDirty: false,
    })
    expect(gate).toEqual({ ready: true, missing: [], needsAllowDirty: false })
    expect(
      requestOf(LOOKED, { environment: 'production', typed: '0.8.8', allowDirty: false }, gate),
    ).toEqual({
      environment: 'production',
      look: 'look-7',
    })
  })

  test('no commit, or uncommitted changes, must be acknowledged', () => {
    const typed = { environment: 'development', typed: '0.8.8', allowDirty: false }
    expect(confirmGate(LOOKED, ISSUES_LOCAL, undefined, typed).missing).toEqual([
      'Acknowledge that no commit will be recorded.',
    ])
    expect(
      confirmGate(
        LOOKED,
        { ...ISSUES_LOCAL, git: { commit: 'abc', dirty: true } },
        undefined,
        typed,
      ).missing,
    ).toEqual(['Acknowledge that uncommitted changes will be published.'])
    const gate = confirmGate(LOOKED, ISSUES_LOCAL, undefined, { ...typed, allowDirty: true })
    expect(gate.ready).toBe(true)
    expect(requestOf(LOOKED, { ...typed, allowDirty: true }, gate)).toEqual({
      environment: 'development',
      look: 'look-7',
      allowDirty: true,
    })
  })

  test('a refused version, a taken version and no Environment block it, each with its fix', () => {
    const refused = report({ look: 'look-8', accepted: false, baseline: '0.9.1', next: '0.10.0' })
    const gate = confirmGate(
      refused,
      { ...ADMIN_LOCAL, declared: '0.8.8' },
      { kind: 'version-taken', latest: '0.9.1' },
      {
        typed: '0.8.8',
        allowDirty: true,
      },
    )
    expect(gate.ready).toBe(false)
    expect(gate.missing).toEqual([
      '0.8.8 does not reach the bump the changes require: declare 0.10.0 in package.json, then take a fresh look.',
      '0.8.8 is already published under another Schema revision: raise the version in package.json, then take a fresh look.',
      'The Project declares no Environment: declare one in astrale.config.ts.',
    ])
  })

  test('a published version is informational: it does not block', () => {
    const published = report({ published: true, accepted: false })
    expect(
      confirmGate(published, ISSUES_LOCAL, undefined, {
        environment: 'development',
        typed: '0.8.8',
        allowDirty: true,
      }).ready,
    ).toBe(true)
  })
})

describe('the final report in sentences', () => {
  test('created, reused, unchanged', () => {
    expect(resultSentences(PUBLISHED)).toEqual([
      'Published issues.astrale.ai 0.8.8 to development.',
      'A new deployment serves it at https://issues.example.test.',
      'No commit was recorded.',
    ])
    expect(
      resultSentences({
        ...PUBLISHED,
        publication: { version: '0.8.8', status: 'unchanged' },
        deployment: 'reused',
        commit: { sha: '1f8e2c52aa', dirty: true },
      }),
    ).toEqual([
      'issues.astrale.ai 0.8.8 was already published with this release: nothing new was tagged.',
      'The existing deployment at https://issues.example.test was reused.',
      'Recorded commit 1f8e2c5, with uncommitted changes.',
    ])
  })
})

describe('one run per Domain', () => {
  beforeEach(() => usePublishRuns.setState({ runs: {}, choices: {} }))

  test('a new look starts the choice over, except the Environment', () => {
    const store = usePublishRuns.getState()
    store.choose('issues', { environment: 'production', typed: '0.8.8', allowDirty: true })
    store.dispatch('issues', { type: 'look' })
    expect(usePublishRuns.getState().choices.issues).toEqual({
      ...NO_CHOICE,
      environment: 'production',
    })
    expect(usePublishRuns.getState().runs.issues).toEqual({ phase: 'looking' })
  })

  test('runs of two Domains never mix', () => {
    const store = usePublishRuns.getState()
    store.dispatch('issues', { type: 'look' })
    store.dispatch('issues', { type: 'looked', answer: ok(LOOKED) as Remote<ChangeReport> })
    store.dispatch('admin', { type: 'look' })
    expect(usePublishRuns.getState().runs.issues?.phase).toBe('review')
    expect(usePublishRuns.getState().runs.admin?.phase).toBe('looking')
  })
})
