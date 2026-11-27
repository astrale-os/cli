import { afterEach, expect, test } from 'bun:test'
import { join } from 'node:path'

import type { RegistryIndex, Remote } from '../../../shared/contracts/versions'
import type { CapturedProcess } from '../../process'

import { createChangeJudge, decodeDiffReport, judgementKey, LOOK_TTL_MS } from './changes'
import { createRegistryReader } from './registry'
import {
  admittedBundle,
  answered,
  disposeProjects,
  fakeContext,
  indexStdout,
  project,
  publication,
  registryError,
  revision,
} from './test-fixtures'

afterEach(disposeProjects)

const ORIGIN = 'issues.astrale.ai'
const LOCAL = revision('local')
const PUBLISHED = revision('published')

const diffReport = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'astrale.diff-report',
    version: 1,
    origin: ORIGIN,
    declared: '1.1.0',
    published: false,
    registry: 'read',
    baseline: '1.0.0',
    level: 'minor',
    effective: 'minor',
    minimum: '1.1.0',
    accepted: true,
    changes: [
      { subject: 'class.Issue.properties.due', facet: 'structure', state: 'added', bump: 'minor' },
      {
        subject: 'class.Issue.properties.title',
        facet: 'structure',
        state: 'missing',
        bump: 'major',
      },
      { subject: 'schema', facet: 'schema', state: 'changed', bump: 'patch' },
      { subject: 'build', facet: 'build', state: 'changed', bump: 'patch', detail: 'code only' },
    ],
    ...extra,
  })

function setup(options: {
  index?: () => CapturedProcess
  run?: (command: string[]) => CapturedProcess | Promise<CapturedProcess>
  tooling?: boolean
  sdk?: string | null
  bundle?: boolean
}) {
  const handle = project({
    id: 'issues',
    version: '1.1.0',
    tooling: options.tooling,
    sdk: options.sdk,
  })
  const bundles = {
    issues: options.bundle === false ? null : admittedBundle('issues', ORIGIN, LOCAL),
  }
  let now = Date.parse('2026-11-26T12:00:00.000Z')
  const fake = fakeContext({
    domains: [handle],
    bundles,
    now: () => now,
    cli: options.index ?? (() => answered(indexStdout(ORIGIN, [publication('1.0.0', PUBLISHED)]))),
    run: options.run ?? (() => answered(diffReport(), '\x1b[33m!\x1b[0m icon is 30 KiB\n')),
  })
  const registry = createRegistryReader(fake.context)
  return {
    handle,
    bundles,
    recorded: fake.recorded,
    judge: createChangeJudge(fake.context, registry),
    advance: (ms: number) => {
      now += ms
    },
  }
}

test("a report relays the platform's judgement, gives each level its reason and is a look", async () => {
  const { handle, recorded, judge } = setup({})
  const answer = await judge.report(handle)
  if (answer.status !== 'ok') throw new Error(answer.message)
  const report = answer.value
  expect(recorded.run.map(({ command, options }) => [command, options.cwd])).toEqual([
    [[join(handle.root, 'node_modules', '.bin', 'astrale-domain'), 'diff', '--json'], handle.root],
  ])
  expect(report).toMatchObject({
    origin: ORIGIN,
    declared: '1.1.0',
    baseline: '1.0.0',
    level: 'minor',
    accepted: true,
    revision: LOCAL,
    notes: ['icon is 30 KiB'],
  })
  expect(report.changes.map((change) => change.reason)).toEqual([
    'addition',
    'unsatisfied-requirement',
    'equivalent-schema',
    'code-only',
  ])
  expect(report.changes[3]?.detail).toBe('code only')
  expect(judge.look(report.look)).toMatchObject({
    domainId: 'issues',
    declared: '1.1.0',
    revision: LOCAL,
    accepted: true,
    published: false,
  })
})

test('a judgement is kept by its inputs: asking again is a new look, not a new run', async () => {
  const { handle, recorded, judge } = setup({})
  const [first, joined] = await Promise.all([judge.report(handle), judge.report(handle)])
  expect(joined).toBe(first)
  expect(recorded.run).toHaveLength(1)
  const again = await judge.report(handle, { fresh: true })
  expect(recorded.run).toHaveLength(1)
  expect(recorded.cli).toHaveLength(2)
  if (first.status !== 'ok' || again.status !== 'ok') throw new Error('no report')
  expect(again.value.look).not.toBe(first.value.look)
  expect({ ...again.value, look: '' }).toEqual({ ...first.value, look: '' })
  judge.forget('issues')
  expect(judge.look(again.value.look)).toBeUndefined()
  await judge.report(handle)
  expect(recorded.run).toHaveLength(2)
})

test('a judgement is not kept when build digests decide it or its inputs are not all known', async () => {
  const same = setup({ index: () => answered(indexStdout(ORIGIN, [publication('1.0.0', LOCAL)])) })
  await same.judge.report(same.handle)
  await same.judge.report(same.handle)
  expect(same.recorded.run).toHaveLength(2)

  const index: Remote<RegistryIndex> = {
    status: 'ok',
    value: { origin: ORIGIN, publications: [] },
    readAt: '',
  }
  expect(judgementKey(null, '1.1.0', LOCAL, index)).toBeUndefined()
  expect(
    judgementKey('0.6.0', '1.1.0', LOCAL, { status: 'offline', message: '', readAt: '' }),
  ).toBeUndefined()
  expect(
    judgementKey('0.6.0', '1.1.0', LOCAL, { status: 'not-found', message: '', readAt: '' }),
  ).toBeString()
  expect(judgementKey('0.6.0', '1.1.0', LOCAL, index)).not.toBe(
    judgementKey('0.6.1', '1.1.0', LOCAL, index),
  )
})

test("a registry failure the platform names keeps the CLI's code and status", async () => {
  const { handle, judge } = setup({
    index: () => registryError('IDP_SESSION_MISSING', 'Not signed in.'),
    run: () =>
      answered(
        '',
        '\x1b[2m›\x1b[0m reading\n\x1b[31m✗\x1b[0m Domain registry: IDP_SESSION_MISSING: Not signed in.\n',
        1,
      ),
  })
  expect(await judge.report(handle)).toMatchObject({
    status: 'signed-out',
    code: 'IDP_SESSION_MISSING',
    message: 'Not signed in.',
  })
  const refused = setup({
    run: () =>
      answered(
        '',
        '\x1b[31m✗\x1b[0m Project definition may contain only domain, environments, entrypoints, and tests.\n',
        1,
      ),
  })
  expect(await refused.judge.report(refused.handle)).toMatchObject({
    status: 'failed',
    message: 'Project definition may contain only domain, environments, entrypoints, and tests.',
  })
  const silent = setup({ run: () => answered('', 'Segmentation fault\n', 139) })
  expect(await silent.judge.report(silent.handle)).toMatchObject({
    status: 'failed',
    message: 'astrale-domain diff answered no report (exit 139).',
  })
})

test('a report taken while the sources moved, or for other sources, is refused', async () => {
  const moving = setup({
    run: () => {
      // The Schema is edited while the platform judges it.
      moving.bundles.issues = admittedBundle('issues', ORIGIN, revision('edited'))
      return answered(diffReport())
    },
  })
  expect(await moving.judge.report(moving.handle)).toMatchObject({
    status: 'failed',
    message: expect.stringContaining('changed'),
  })

  const other = setup({ run: () => answered(diffReport({ declared: '1.2.0' })) })
  expect(await other.judge.report(other.handle)).toMatchObject({
    status: 'failed',
    message: expect.stringContaining('not issues.astrale.ai 1.1.0'),
  })
})

test('nothing runs without an admitted revision or the installed platform tooling', async () => {
  const unread = setup({ bundle: false })
  expect(await unread.judge.report(unread.handle)).toMatchObject({
    status: 'failed',
    message: 'The Domain is no longer in the workspace.',
  })
  const bare = setup({ tooling: false })
  expect(await bare.judge.report(bare.handle)).toMatchObject({
    status: 'failed',
    message: expect.stringContaining('astrale-domain is not installed'),
  })
  expect([...unread.recorded.run, ...bare.recorded.run]).toEqual([])
})

test('a look lapses, and a report is decoded whole or not at all', async () => {
  const { handle, judge, advance } = setup({})
  const first = await judge.report(handle)
  if (first.status !== 'ok') throw new Error(first.message)
  advance(LOOK_TTL_MS)
  await judge.report(handle)
  expect(judge.look(first.value.look)).toBeUndefined()

  expect(decodeDiffReport(JSON.parse(diffReport()))?.changes).toHaveLength(4)
  expect(decodeDiffReport(JSON.parse(diffReport({ level: 'huge' })))).toBeUndefined()
  expect(decodeDiffReport(JSON.parse(diffReport({ changes: [{ subject: 'x' }] })))).toBeUndefined()
  expect(decodeDiffReport(JSON.parse(diffReport({ registry: 'maybe' })))).toBeUndefined()
})
