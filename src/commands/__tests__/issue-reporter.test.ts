import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCli } from './fixtures/process'

const cliRoot = join(import.meta.dir, '../../..')
const ADMIN_KERNEL = 'https://admin.configured.test/api'
const ADMIN_ISSUER = 'https://admin-domain.configured.test'
const ISSUES_ISSUER = 'https://issues.admin.test'
const EDIT = '@issue-1::issues.astrale.ai:class.Issue.method.edit'
const roots: string[] = []
let template: string

beforeAll(async () => {
  template = await temporaryRoot('astrale-issue-reporter-template-')
  const created = await runCli(template, ['identity', 'create', 'alice', '--json'])
  expect(created.exitCode, created.stderr).toBe(0)
})

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('reporter commands against a fake Admin kernel', () => {
  test('list reads the reports as the reporter acting for itself, never through the Admin Domain', async () => {
    const { exitCode, stdout, stderr, events } = await runIssue(['list', '--as', 'alice', '--json'])

    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      issues: [
        {
          id: 'issue-1',
          reference: 'ASTRALE-1',
          title: 'Reported title',
          description: 'Details',
          status: 'open',
          priority: 0,
          archived: false,
          comments: [],
        },
      ],
    })
    // No exchange at the Admin Domain: its authority holds no Issue, so it must not bound the read.
    expect(sorted(events)).toEqual(
      sorted([
        { kind: 'whoami', as: 'self' },
        { kind: 'query', select: 'nodes', as: 'self' },
        { kind: 'query', select: 'edges', as: 'self' },
      ]),
    )
  })

  test('edit finds the report as the reporter, then calls the Method with its declaring Domain credential', async () => {
    const { exitCode, stdout, stderr, events } = await runIssue([
      'edit',
      'astrale-1',
      '--title',
      'Clearer title',
      '--as',
      'alice',
      '--json',
    ])

    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      id: 'issue-1',
      reference: 'ASTRALE-1',
      title: 'Clearer title',
    })
    const reads = events.filter((event) => event.kind === 'query')
    expect(reads).toHaveLength(2)
    expect(reads.every((event) => event.as === 'self')).toBe(true)
    // As `astrale call --admin` does: the Admin kernel's installation names the issuer.
    expect(events.filter((event) => event.kind !== 'query' && event.as !== 'self')).toEqual([
      { kind: 'inspect', origin: 'issues.astrale.ai' },
      { kind: 'exchange', issuer: ISSUES_ISSUER },
      { kind: 'whoami', as: 'issues-domain' },
      { kind: 'call', target: EDIT, input: { title: 'Clearer title' }, as: 'issues-domain' },
    ])
    expect(events.some((event) => event.issuer === ADMIN_ISSUER)).toBe(false)
  })
})

async function runIssue(args: readonly string[]) {
  const root = await adminHome()
  const observed = join(root, 'observed.ndjson')
  await writeFile(observed, '')
  const child = Bun.spawn(
    ['bun', join(import.meta.dir, 'fixtures/issue-reporter.ts'), 'issue', ...args],
    {
      cwd: cliRoot,
      env: {
        ...process.env,
        ASTRALE_HOME: root,
        NO_UPDATE_NOTIFIER: '1',
        ISSUE_REPORTER_OBSERVED: observed,
        ISSUE_REPORTER_ADMIN_ISSUER: ADMIN_ISSUER,
        ISSUE_REPORTER_ISSUES_ISSUER: ISSUES_ISSUER,
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  const events = (await readFile(observed, 'utf8'))
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  return { exitCode, stdout, stderr, events }
}

function sorted(events: readonly Record<string, unknown>[]) {
  return events.map((event) => JSON.stringify(event)).sort()
}

/** An isolated CLI home holding identity alice and a configured Admin target with its Domain issuer. */
async function adminHome(): Promise<string> {
  const root = await temporaryRoot('astrale-issue-reporter-')
  await cp(template, root, { recursive: true })
  await writeFile(
    join(root, 'config.json'),
    JSON.stringify({
      // An issuer alice can sign as without a registration: the fake Kernel verifies no credential.
      issuer: 'https://cli.test',
      admin: {
        name: 'admin',
        url: ADMIN_KERNEL,
        kernelIssuer: ADMIN_KERNEL,
        domainIssuer: ADMIN_ISSUER,
      },
    }),
  )
  return root
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}
