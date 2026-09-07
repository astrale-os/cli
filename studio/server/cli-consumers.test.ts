import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { StaleReport, StudioSchemaBundle, ViewInfo } from '../shared/types'

import {
  studioActiveInstanceName,
  type StudioViewTargetQuery,
  type StudioViewTargetQueryResult,
} from '../../src/lib/view/studio-runtime'
import { STUDIO_CLI_DESCRIPTOR_ENV } from './cli'
import { listInstances, setActiveInstance } from './instances/active'
import { clearViewPreparations, rememberViewPreparation } from './views/preparation'
import { readRememberedTarget } from './views/selection-repository'
import { launchViewSession } from './views/session'
import { listViewTargets } from './views/target'
import { getUpdates } from './workspace/updates'

interface FakeResponse {
  stdout?: unknown
  stderr?: unknown
  exitCode?: number
}

interface FakeCall {
  args: string[]
  cwd: string
}

const priorDescriptor = process.env[STUDIO_CLI_DESCRIPTOR_ENV]
const roots: string[] = []

afterEach(() => {
  clearViewPreparations()
  if (priorDescriptor === undefined) delete process.env[STUDIO_CLI_DESCRIPTOR_ENV]
  else process.env[STUDIO_CLI_DESCRIPTOR_ENV] = priorDescriptor
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

function exactArgs(args: string[]): string {
  return JSON.stringify(args)
}

function installFakeCli(responses: Array<{ args: string[]; responses: FakeResponse[] }>): {
  root: string
  calls: () => FakeCall[]
} {
  const root = mkdtempSync(join(tmpdir(), 'studio-cli-consumer-'))
  roots.push(root)
  const scenarioFile = join(root, 'scenario.json')
  const callsFile = join(root, 'calls.ndjson')
  const entry = join(root, 'fake-cli.ts')
  const scenario = Object.fromEntries(
    responses.map((rule) => [exactArgs(rule.args), rule.responses]),
  )
  writeFileSync(scenarioFile, JSON.stringify(scenario))
  writeFileSync(
    entry,
    `import { appendFileSync, existsSync, readFileSync } from 'node:fs'

const scenarioFile = ${JSON.stringify(scenarioFile)}
const callsFile = ${JSON.stringify(callsFile)}
const args = process.argv.slice(2)
const prior = existsSync(callsFile)
  ? readFileSync(callsFile, 'utf8').split('\\n').filter(Boolean).map((line) => JSON.parse(line))
  : []
const matchingCalls = prior.filter((call) => JSON.stringify(call.args) === JSON.stringify(args)).length
appendFileSync(callsFile, JSON.stringify({ args, cwd: process.cwd() }) + '\\n')
const scenario = JSON.parse(readFileSync(scenarioFile, 'utf8'))
const responses = scenario[JSON.stringify(args)]
const response = Array.isArray(responses) ? responses[matchingCalls] : undefined
if (!response) {
  process.stderr.write(JSON.stringify({ message: 'Unexpected fake CLI call', args }))
  process.exit(91)
}
const render = (value) => typeof value === 'string' ? value : JSON.stringify(value)
if (response.stdout !== undefined) process.stdout.write(render(response.stdout))
if (response.stderr !== undefined) process.stderr.write(render(response.stderr))
process.exit(response.exitCode ?? 0)
`,
  )
  process.env[STUDIO_CLI_DESCRIPTOR_ENV] = JSON.stringify({
    version: 1,
    executable: process.execPath,
    args: [realpathSync(entry)],
  })
  return {
    root,
    calls: () =>
      existsSync(callsFile)
        ? readFileSync(callsFile, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as FakeCall)
        : [],
  }
}

const bookmarkedArgs = ['instance', 'list', '--bookmarked', '--json']
const managedArgs = ['instance', 'list', '--admin-only', '--json']

describe('instance CLI orchestration', () => {
  test('merges bookmarked and managed instances from the exact CLI', async () => {
    const fake = installFakeCli([
      {
        args: bookmarkedArgs,
        responses: [
          {
            stdout: {
              active: 'staging',
              bookmarks: [
                { name: 'local', url: 'http://127.0.0.1:7200' },
                { name: 'staging', url: 'https://staging.example', active: true },
              ],
            },
          },
        ],
      },
      {
        args: managedArgs,
        responses: [
          {
            stdout: {
              instances: [
                { slug: 'staging', url: 'https://duplicate.example' },
                { slug: 'production', url: 'https://production.example' },
              ],
            },
          },
        ],
      },
    ])

    expect(await listInstances()).toEqual({
      active: 'staging',
      instances: [
        {
          name: 'local',
          url: 'http://127.0.0.1:7200',
          active: false,
          kind: 'bookmark',
        },
        {
          name: 'staging',
          url: 'https://staging.example',
          active: true,
          kind: 'bookmark',
        },
        {
          name: 'production',
          url: 'https://production.example',
          active: false,
          kind: 'managed',
        },
      ],
    })
    // The two list reads are issued together, so only the SET of invocations is
    // fixed — asserting their order would assert that they are still sequential.
    expect(
      fake
        .calls()
        .map((call) => call.args.join(' '))
        .sort(),
    ).toEqual([bookmarkedArgs, managedArgs].map((args) => args.join(' ')).sort())
  })

  test('uses the exact non-interactive instance switch flags and re-reads CLI-owned state', async () => {
    const useArgs = ['instance', 'use', 'staging', '--adopt-default', '--skip-jwks-check']
    const fake = installFakeCli([
      { args: useArgs, responses: [{ stdout: 'Now using staging.\n' }] },
    ])

    expect(
      await setActiveInstance('staging', { activeInstanceName: async () => 'staging' }),
    ).toEqual({
      ok: true,
      active: 'staging',
      output: 'Now using staging.',
    })
    expect(fake.calls().map((call) => call.args)).toEqual([useArgs])
  })

  test('reads active state in-process and invalidates the long-lived memo first', async () => {
    let resets = 0
    expect(
      await studioActiveInstanceName({
        resetInstancesMemo: () => {
          resets++
        },
        getActive: async () => ({ name: 'local' }) as never,
      }),
    ).toBe('local')
    expect(
      await studioActiveInstanceName({
        resetInstancesMemo: () => {
          resets++
        },
        getActive: async () => {
          throw new Error('unavailable')
        },
      }),
    ).toBeNull()
    expect(resets).toBe(2)
  })
})

describe('workspace update CLI orchestration', () => {
  test('accepts stale exit 10 and checks updates in the domain root', async () => {
    const checkArgs = ['update', '--check', '--json']
    const fake = installFakeCli([
      {
        args: checkArgs,
        responses: [
          {
            stdout: {
              stale: true,
              cli: {
                stale: true,
                managed: true,
                current: '0.7.0',
                latest: '0.8.0',
                channel: 'latest',
              },
              skills: { status: 'update-available' },
              sdk: {
                stale: true,
                inProject: true,
                outdated: [{ pkg: '@astrale-os/sdk', current: '0.5.0', latest: '0.6.0' }],
              },
            },
            exitCode: 10,
          },
        ],
      },
    ])
    const domainRoot = realpathSync(fake.root)

    expect(await getUpdates(domainRoot)).toEqual({
      stale: true,
      cli: {
        stale: true,
        managed: true,
        current: '0.7.0',
        latest: '0.8.0',
        channel: 'latest',
      },
      skills: { status: 'update-available' },
      sdk: {
        stale: true,
        inProject: true,
        outdated: [{ pkg: '@astrale-os/sdk', current: '0.5.0', latest: '0.6.0' }],
      },
    })
    expect(fake.calls()).toEqual([{ args: checkArgs, cwd: domainRoot }])
  })

  test('accepts an older CLI report without a skills axis during binary replacement', async () => {
    const checkArgs = ['update', '--check', '--json']
    const fake = installFakeCli([
      {
        args: checkArgs,
        responses: [
          {
            stdout: {
              stale: false,
              cli: { stale: false, managed: true },
              sdk: { stale: false, inProject: false, outdated: [] },
            },
          },
        ],
      },
    ])

    expect(await getUpdates(fake.root)).toEqual({
      stale: false,
      cli: { stale: false, managed: true },
      skills: { status: 'current' },
      sdk: { stale: false, inProject: false, outdated: [] },
    })
  })

  test('hides the badge when check output is malformed or fails', async () => {
    const checkArgs = ['update', '--check', '--json']
    const fake = installFakeCli([
      {
        args: checkArgs,
        responses: [
          { stdout: { stale: true, cli: {}, sdk: {} }, exitCode: 10 },
          {
            stdout: {
              stale: true,
              cli: { stale: true, managed: true },
              skills: { status: 'current' },
              sdk: {
                stale: true,
                inProject: true,
                outdated: [{ pkg: '@astrale-os/sdk', current: '0.5.0', latest: '0.6.0' }],
              },
            },
            stderr: 'Registry offline.',
            exitCode: 7,
          },
        ],
      },
    ])
    const expected: StaleReport = {
      stale: false,
      cli: { stale: false, managed: true },
      skills: { status: 'current' },
      sdk: { stale: false, inProject: false, outdated: [] },
    }

    expect(await getUpdates(fake.root)).toEqual(expected)
    expect(await getUpdates(fake.root)).toEqual(expected)
    const domainRoot = realpathSync(fake.root)
    expect(fake.calls()).toEqual([
      { args: checkArgs, cwd: domainRoot },
      { args: checkArgs, cwd: domainRoot },
    ])
  })
})

const view = {
  slug: 'issue-detail',
  kind: 'unknown',
  viewFor: 'Issue',
} satisfies ViewInfo

const bundle = {
  ir: {
    views: {
      'issue-detail': {
        name: 'issue-detail',
        target: {
          kind: 'definition',
          definitions: [{ origin: 'issues.example.dev', kind: 'class', name: 'Issue' }],
        },
      },
    },
  },
} as unknown as StudioSchemaBundle

const queryArgs = [
  'query',
  '--class',
  '/:issues.example.dev:class.Issue',
  '--limit',
  '201',
  '--json',
  '-i',
  'staging',
]

const targetQuery = {
  graph: {
    nodes: [
      {
        id: 'issue-1',
        props: {
          'kernel.astrale.ai:interface.Named.property.name': 'First issue',
        },
      },
    ],
  },
}

describe('View CLI orchestration', () => {
  test('queries exact target coordinates once and preserves malformed/nonzero failures', async () => {
    const calls: Array<{
      instance: string
      queries: readonly StudioViewTargetQuery[]
      timeoutMs: number
    }> = []
    const responses: Array<Omit<StudioViewTargetQueryResult, 'definition'>> = [
      { ok: true, value: targetQuery, detail: '' },
      { ok: true, value: { graph: { nodes: 'invalid' } }, detail: '' },
      { ok: false, value: null, detail: 'Instance is offline.' },
    ]
    const query = async (
      instance: string,
      queries: readonly StudioViewTargetQuery[],
      timeoutMs: number,
    ): Promise<StudioViewTargetQueryResult[]> => {
      calls.push({ instance, queries, timeoutMs })
      const response = responses.shift()!
      return queries.map(({ definition }) => ({ definition, ...response }))
    }

    expect(
      await listViewTargets('/workspace', 'issues.example.dev', view, bundle, 'staging', 2000, {
        query,
      }),
    ).toEqual({
      status: 'available',
      items: [
        {
          id: 'issue-1',
          ref: '@issue-1',
          className: 'Issue',
          classOrigin: 'issues.example.dev',
          label: 'First issue',
        },
      ],
      selected: null,
      stale: null,
      truncated: false,
    })
    expect(
      await listViewTargets('/workspace', 'issues.example.dev', view, bundle, 'staging', 2000, {
        query,
      }),
    ).toMatchObject({ status: 'unavailable', items: [] })
    expect(
      await listViewTargets('/workspace', 'issues.example.dev', view, bundle, 'staging', 2000, {
        query,
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'Instance is offline.' })
    expect(calls).toEqual([
      { instance: 'staging', queries: [{ definition: queryArgs[2], limit: 201 }], timeoutMs: 2000 },
      { instance: 'staging', queries: [{ definition: queryArgs[2], limit: 201 }], timeoutMs: 2000 },
      { instance: 'staging', queries: [{ definition: queryArgs[2], limit: 201 }], timeoutMs: 2000 },
    ])
  })

  test('launches against the selected target, trusts route.href, and remembers the target', async () => {
    const fake = installFakeCli([])
    const preparation = rememberViewPreparation({
      root: fake.root,
      origin: 'issues.example.dev',
      slug: view.slug,
      instance: 'staging',
      targetRequired: true,
      targets: {
        status: 'available',
        items: [
          {
            id: 'issue-1',
            ref: '@issue-1',
            className: 'Issue',
            classOrigin: 'issues.example.dev',
            label: 'First issue',
          },
        ],
        selected: null,
        stale: null,
        truncated: false,
      },
    })
    const opened: unknown[] = []

    expect(
      await launchViewSession(
        fake.root,
        'issues.example.dev',
        view,
        bundle,
        { preparationId: preparation.id, targetId: 'issue-1' },
        2000,
        {
          activeInstance: async () => 'staging',
          serveRuntime: () => ({ file: '/cli/astrale', args: [] }),
          identityNames: async () => ['alice', 'bob'],
          open: async (input) => {
            opened.push(input)
            return {
              id: 'v-a1b2',
              pageUrl: 'http://127.0.0.1:4419/s/nonce/',
              view: { route: { href: 'https://shell.example.dev/views/issue-1' } },
            } as never
          },
        },
      ),
    ).toEqual({
      status: 'ready',
      sessionId: 'v-a1b2',
      pageUrl: 'http://127.0.0.1:4419/s/nonce/',
      viewUrl: 'https://shell.example.dev/views/issue-1',
      target: {
        id: 'issue-1',
        ref: '@issue-1',
        className: 'Issue',
        classOrigin: 'issues.example.dev',
        label: 'First issue',
      },
    })
    expect(readRememberedTarget(fake.root, 'staging', 'issue-detail')).toEqual({
      id: 'issue-1',
      className: 'Issue',
      classOrigin: 'issues.example.dev',
      label: 'First issue',
    })
    expect(opened).toEqual([
      {
        viewPath: '/:issues.example.dev:view.issue-detail',
        targetRef: '@issue-1',
        instance: 'staging',
        allowIdentity: ['alice', 'bob'],
        timeoutMs: 20_000,
        serveRuntime: { file: '/cli/astrale', args: [] },
      },
    ])
    expect(fake.calls()).toEqual([])
  })

  test('does not expose a malformed session or a failed direct runtime launch', async () => {
    const standalone = { slug: 'dashboard', kind: 'unknown' } satisfies ViewInfo
    const fake = installFakeCli([])
    const preparation = rememberViewPreparation({
      root: fake.root,
      origin: 'issues.example.dev',
      slug: standalone.slug,
      instance: 'staging',
      targetRequired: false,
      targets: {
        status: 'available',
        items: [],
        selected: null,
        stale: null,
        truncated: false,
      },
    })

    const malformed = await launchViewSession(
      fake.root,
      'issues.example.dev',
      standalone,
      null,
      { preparationId: preparation.id },
      2000,
      {
        activeInstance: async () => 'staging',
        serveRuntime: () => ({ file: '/cli/astrale', args: [] }),
        open: async () => ({ id: 'v-no-route', pageUrl: 'http://127.0.0.1/', view: {} }) as never,
      },
    )
    expect(malformed.status).toBe('unavailable')
    if (malformed.status !== 'unavailable')
      throw new Error('expected the malformed session to fail')
    expect(malformed.reason).toContain('invalid session')
    expect(
      await launchViewSession(
        fake.root,
        'issues.example.dev',
        standalone,
        null,
        { preparationId: preparation.id },
        2000,
        {
          activeInstance: async () => 'staging',
          serveRuntime: () => ({ file: '/cli/astrale', args: [] }),
          open: async () => {
            throw new Error('Permission denied.')
          },
        },
      ),
    ).toEqual({ status: 'unavailable', reason: 'Permission denied.' })
    expect(fake.calls()).toEqual([])
  })
})
