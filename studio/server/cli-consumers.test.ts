import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { StaleReport } from '../shared/contracts/runtime'

import { STUDIO_CLI_DESCRIPTOR_ENV } from './cli'
import { listInstances, setActiveInstance } from './instances/active'
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
const checkArgs = ['update', '--check', '--json']

test('instances merge bookmarked and managed lists, and a switch is non-interactive', async () => {
  const useArgs = ['instance', 'use', 'staging', '--adopt-default', '--skip-jwks-check']
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
    { args: useArgs, responses: [{ stdout: 'Now using staging.\n' }] },
  ])

  expect(await listInstances()).toEqual({
    active: 'staging',
    instances: [
      { name: 'local', url: 'http://127.0.0.1:7200', active: false, kind: 'bookmark' },
      { name: 'staging', url: 'https://staging.example', active: true, kind: 'bookmark' },
      { name: 'production', url: 'https://production.example', active: false, kind: 'managed' },
    ],
  })
  expect(await setActiveInstance('staging')).toMatchObject({
    ok: true,
    output: 'Now using staging.',
  })
  // the two list reads are issued together: only the SET of the first two calls is fixed
  const calls = fake.calls().map((call) => call.args.join(' '))
  expect(calls.slice(0, 2).sort()).toEqual(
    [bookmarkedArgs, managedArgs].map((a) => a.join(' ')).sort(),
  )
  expect(calls[2]).toBe(useArgs.join(' '))
})

test('updates are checked in the domain root; stale exit 10 counts, anything malformed hides the badge', async () => {
  const report: StaleReport = {
    stale: true,
    cli: { stale: true, managed: true, current: '0.7.0', latest: '0.8.0', channel: 'latest' },
    skills: { status: 'update-available' },
    sdk: {
      stale: true,
      inProject: true,
      outdated: [{ pkg: '@astrale-os/sdk', current: '0.5.0', latest: '0.6.0' }],
    },
  }
  const fake = installFakeCli([
    {
      args: checkArgs,
      responses: [
        { stdout: report, exitCode: 10 },
        { stdout: { stale: true, cli: {}, sdk: {} }, exitCode: 10 },
        { stdout: report, stderr: 'Registry offline.', exitCode: 7 },
      ],
    },
  ])
  const domainRoot = realpathSync(fake.root)
  const hidden: StaleReport = {
    stale: false,
    cli: { stale: false, managed: true },
    skills: { status: 'current' },
    sdk: { stale: false, inProject: false, outdated: [] },
  }

  expect(await getUpdates(domainRoot)).toEqual(report)
  expect(await getUpdates(domainRoot)).toEqual(hidden)
  expect(await getUpdates(domainRoot)).toEqual(hidden)
  expect(fake.calls()).toEqual(Array(3).fill({ args: checkArgs, cwd: domainRoot }))
})
