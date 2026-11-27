import { afterEach, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

import type { PublishEvent } from '../../../shared/contracts/versions'
import type { CapturedProcess, ChildOptions } from '../../process'

import { createChangeJudge, LOOK_TTL_MS } from './changes'
import { defaultVersionsContext, publishSwitchOf } from './context'
import { createPublisher, decodePublishReport } from './publish'
import { createRegistryReader } from './registry'
import {
  admittedBundle,
  answered,
  disposeProjects,
  fakeContext,
  indexStdout,
  project,
  publication,
  revision,
} from './test-fixtures'

afterEach(disposeProjects)

const ORIGIN = 'issues.astrale.ai'
const LOCAL = revision('local')
const ENVIRONMENTS =
  '{ development: { deployment: cloudflare() }, production: { deployment: cloudflare() } }'

const diffReport = (accepted = true, origin = ORIGIN, declared = '1.1.0') =>
  JSON.stringify({
    format: 'astrale.diff-report',
    version: 1,
    origin,
    declared,
    published: false,
    registry: 'read',
    level: 'minor',
    accepted,
    changes: [],
  })

const publishReport = JSON.stringify({
  format: 'astrale.publish-report',
  version: 1,
  origin: ORIGIN,
  environment: 'production',
  publication: { version: '1.1.0', status: 'created' },
  deployment: 'created',
  url: 'https://issues-1-1-0.example.test',
  releaseDigest: `sha256:${'e'.repeat(64)}`,
  buildDigest: `sha256:${'f'.repeat(64)}`,
  commit: { sha: 'a'.repeat(40), dirty: false },
})

type Publish = (
  command: string[],
  options: ChildOptions,
) => CapturedProcess | Promise<CapturedProcess>

function setup(
  options: {
    environments?: string
    accepted?: boolean
    publish?: Publish
    publishing?: boolean
  } = {},
) {
  const issues = project({
    id: 'issues',
    version: '1.1.0',
    environments: 'environments' in options ? options.environments : ENVIRONMENTS,
  })
  const shell = project({ id: 'shell', environments: ENVIRONMENTS })
  const bundles = {
    issues: admittedBundle('issues', ORIGIN, LOCAL),
    shell: admittedBundle('shell', 'shell.astrale.ai', revision('shell')),
  }
  let now = Date.parse('2026-11-26T12:00:00.000Z')
  const fake = fakeContext({
    domains: [issues, shell],
    bundles,
    now: () => now,
    publishing: options.publishing,
    cli: (args) => answered(indexStdout(args[2]!, [publication('1.0.0', revision('published'))])),
    run: (command, runOptions) => {
      if (command[1] === 'diff' && runOptions.cwd === shell.root) {
        return answered(diffReport(true, 'shell.astrale.ai', '1.0.0'))
      }
      if (command[1] === 'diff') return answered(diffReport(options.accepted ?? true))
      if (!options.publish) throw new Error('publish was not expected to run')
      return options.publish(command, runOptions)
    },
  })
  const registry = createRegistryReader(fake.context)
  const changes = createChangeJudge(fake.context, registry)
  const publisher = createPublisher(fake.context, registry, changes)
  async function look(handle = issues): Promise<string> {
    const report = await changes.report(handle)
    if (report.status !== 'ok') throw new Error(report.message)
    return report.value.look
  }
  return {
    issues,
    shell,
    bundles,
    changes,
    publisher,
    look,
    recorded: fake.recorded,
    advance: (ms: number) => {
      now += ms
    },
    publishes: () => fake.recorded.run.filter(({ command }) => command[1] === 'publish'),
  }
}

async function eventsOf(stream: ReadableStream<Uint8Array>): Promise<PublishEvent[]> {
  const text = await new Response(stream).text()
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PublishEvent)
}

test('a Studio started with publishing off refuses a Publish every other guard would start', async () => {
  const { publisher, issues, look, publishes } = setup({ publishing: false })
  expect(
    await publisher.start(issues, { environment: 'production', look: await look() }),
  ).toMatchObject({ ok: false, status: 409, refusal: { error: 'publish-disabled' } })
  expect(publishes()).toEqual([])
})

test('the Publish switch is on or off, unset is on, and nothing else starts a Studio', async () => {
  expect(publishSwitchOf(undefined)).toEqual({ publishing: true })
  expect(publishSwitchOf('on')).toEqual({ publishing: true })
  expect(publishSwitchOf('off')).toEqual({ publishing: false })
  for (const value of ['OFF', 'Off', '0', 'false', 'no', '', ' off', 'ON'])
    expect(publishSwitchOf(value)).toEqual({
      problem: `ASTRALE_STUDIO_PUBLISH is ${JSON.stringify(value)}, and it is either on or off (unset is on): the Studio does not start on another value.`,
    })

  const previous = process.env.ASTRALE_STUDIO_PUBLISH
  try {
    // were the value changed after the start, a value that is not `on` publishes nothing
    process.env.ASTRALE_STUDIO_PUBLISH = 'OFF'
    expect(defaultVersionsContext.publishing()).toBe(false)
    process.env.ASTRALE_STUDIO_PUBLISH = 'off'
    expect(defaultVersionsContext.publishing()).toBe(false)
    delete process.env.ASTRALE_STUDIO_PUBLISH
    expect(defaultVersionsContext.publishing()).toBe(true)
  } finally {
    if (previous === undefined) delete process.env.ASTRALE_STUDIO_PUBLISH
    else process.env.ASTRALE_STUDIO_PUBLISH = previous
  }

  // and the server refuses to start on one, saying so, before it reads any workspace
  const start = Bun.spawn([process.execPath, join(import.meta.dir, '..', '..', 'index.ts')], {
    env: { ...process.env, ASTRALE_STUDIO_PUBLISH: 'OFF', PORT: '0' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, said] = await Promise.all([start.exited, new Response(start.stderr).text()])
  expect(code).toBe(1)
  expect(said).toContain('ASTRALE_STUDIO_PUBLISH is "OFF", and it is either on or off')
})

test('a malformed request is refused before anything is read', async () => {
  const { publisher, issues, publishes } = setup()
  for (const request of [
    {},
    { environment: '--force', look: 'x' },
    { environment: 'production' },
    { environment: 'production', look: 'x', allowDirty: 'yes' },
    'production',
  ]) {
    expect(await publisher.start(issues, request)).toMatchObject({
      ok: false,
      status: 400,
      refusal: { error: 'invalid-request' },
    })
  }
  expect(publishes()).toEqual([])
})

test('Publish starts only from a fresh, accepted look of these very sources', async () => {
  const fixture = setup()
  const { publisher, issues, shell } = fixture
  const refusal = async (request: object) => {
    const started = await publisher.start(issues, request)
    return started.ok ? 'started' : [started.status, started.refusal.error]
  }
  expect(await refusal({ environment: 'production', look: 'never-taken' })).toEqual([
    409,
    'look-missing',
  ])
  expect(await refusal({ environment: 'production', look: await fixture.look(shell) })).toEqual([
    409,
    'look-missing',
  ])

  const old = await fixture.look()
  fixture.advance(LOOK_TTL_MS)
  expect(await refusal({ environment: 'production', look: old })).toEqual([409, 'look-stale'])

  const before = await fixture.look()
  fixture.bundles.issues = admittedBundle('issues', ORIGIN, revision('edited'))
  expect(await refusal({ environment: 'production', look: before })).toEqual([409, 'look-stale'])
  fixture.bundles.issues = admittedBundle('issues', ORIGIN, LOCAL)

  expect(await refusal({ environment: 'staging', look: await fixture.look() })).toEqual([
    409,
    'environment-unknown',
  ])
  expect(fixture.publishes()).toEqual([])
})

test('a look the platform refused, an undeclared Environment or missing tooling starts nothing', async () => {
  const refused = setup({ accepted: false })
  const refusedLook = await refused.look()
  expect(
    await refused.publisher.start(refused.issues, { environment: 'production', look: refusedLook }),
  ).toMatchObject({
    status: 409,
    refusal: { error: 'look-refused', message: expect.stringContaining('raise the version') },
  })

  const bare = setup({ environments: undefined })
  expect(
    await bare.publisher.start(bare.issues, { environment: 'production', look: await bare.look() }),
  ).toMatchObject({
    status: 409,
    refusal: { error: 'environment-unknown', message: 'The Project declares no Environments.' },
  })

  const untooled = setup()
  const look = await untooled.look()
  rmSync(join(untooled.issues.root, 'node_modules', '.bin', 'astrale-domain'))
  expect(
    await untooled.publisher.start(untooled.issues, { environment: 'production', look }),
  ).toMatchObject({
    status: 409,
    refusal: { error: 'tooling-missing' },
  })
  // A refused start leaves its look standing.
  expect(untooled.changes.look(look)).toBeDefined()
  expect([...refused.publishes(), ...bare.publishes(), ...untooled.publishes()]).toEqual([])
})

test('Publish streams the platform marks as they come and ends with its report', async () => {
  const fixture = setup({
    publish: (_command, options) => {
      options.onStderr?.(
        '\x1b[2m›\x1b[0m building issues.astrale.ai\nwrangler noise\n\x1b[33m!\x1b[0m icon',
      )
      options.onStderr?.(' is large\n\x1b[2m›\x1b[0m verified\n')
      return answered(publishReport)
    },
  })
  const look = await fixture.look()
  const started = await fixture.publisher.start(fixture.issues, {
    environment: 'production',
    look,
    allowDirty: true,
  })
  if (!started.ok) throw new Error(started.refusal.message)
  const events = await eventsOf(started.events)
  const bin = join(fixture.issues.root, 'node_modules', '.bin', 'astrale-domain')
  expect(events).toEqual([
    {
      type: 'started',
      domainId: 'issues',
      environment: 'production',
      look,
      command: [bin, 'publish', 'production', '--json', '--allow-dirty'],
    },
    { type: 'progress', tone: 'step', line: 'building issues.astrale.ai' },
    { type: 'progress', tone: 'warning', line: 'icon is large' },
    { type: 'progress', tone: 'step', line: 'verified' },
    {
      type: 'result',
      ok: true,
      report: decodePublishReport(JSON.parse(publishReport))!,
      unrelayedLines: 1,
    },
  ])
  expect(fixture.publishes().map(({ options }) => options.cwd)).toEqual([fixture.issues.root])
  // The look is spent, and what Publish changed is read again.
  expect(fixture.changes.look(look)).toBeUndefined()
  const reads = fixture.recorded.cli.length
  await fixture.look()
  expect(fixture.recorded.cli.length).toBe(reads + 1)
  expect(fixture.recorded.run.filter(({ command }) => command[1] === 'diff')).toHaveLength(2)
  expect(fixture.publisher.running()).toEqual([])
})

test("a failed Publish ends with the platform's refusal, continuation lines included", async () => {
  const fixture = setup({
    publish: (_command, options) => {
      options.onStderr?.('\x1b[31m✗\x1b[0m Publication refused:\n  1.1.0 names another release.\n')
      return answered('', '', 1)
    },
  })
  const started = await fixture.publisher.start(fixture.issues, {
    environment: 'production',
    look: await fixture.look(),
  })
  if (!started.ok) throw new Error(started.refusal.message)
  const events = await eventsOf(started.events)
  expect(events.at(-1)).toEqual({
    type: 'result',
    ok: false,
    message: 'Publication refused:\n  1.1.0 names another release.',
    exitCode: 1,
    unrelayedLines: 0,
  })
  expect(events[0]?.type === 'started' && events[0].command.includes('--allow-dirty')).toBe(false)
})

test('one Publish per Domain at a time, never cancelled by a closed stream', async () => {
  let finish!: (run: CapturedProcess) => void
  const fixture = setup({ publish: () => new Promise((resolve) => (finish = resolve)) })
  const started = await fixture.publisher.start(fixture.issues, {
    environment: 'production',
    look: await fixture.look(),
  })
  if (!started.ok) throw new Error(started.refusal.message)
  expect(fixture.publisher.running()).toEqual(['issues'])
  expect(
    await fixture.publisher.start(fixture.issues, {
      environment: 'production',
      look: await fixture.look(),
    }),
  ).toMatchObject({ status: 409, refusal: { error: 'publish-running' } })

  await started.events.cancel()
  expect(fixture.publisher.running()).toEqual(['issues'])
  finish(answered(publishReport))
  await Bun.sleep(0)
  expect(fixture.publisher.running()).toEqual([])
  expect(fixture.publishes()).toHaveLength(1)
})

test('a publish report is decoded whole or not at all', () => {
  const report = JSON.parse(publishReport)
  expect(decodePublishReport(report)?.commit).toEqual({ sha: 'a'.repeat(40), dirty: false })
  expect(decodePublishReport({ ...report, commit: null })?.commit).toBeNull()
  expect(decodePublishReport({ ...report, commit: undefined })).toBeUndefined()
  expect(decodePublishReport({ ...report, deployment: 'maybe' })).toBeUndefined()
  expect(decodePublishReport({ ...report, publication: { version: '1.1.0' } })).toBeUndefined()
})
