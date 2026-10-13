import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCli } from './fixtures/process'

const cliRoot = join(import.meta.dir, '../../..')
const ADMIN_KERNEL = 'https://admin.configured.test/api'
const ADMIN_ISSUER = 'https://admin-domain.configured.test'
const TEAM_KERNEL = 'https://team.bookmarked.test/api'
const TEAM_ISSUER = 'https://team-domain.bookmarked.test'
const ISSUE = 'issues.astrale.ai:class.Issue'
const MUTATION = JSON.stringify({
  preconditions: [],
  operations: [{ op: 'node.create', as: 'issue', class: ISSUE, props: {} }],
})
const roots: string[] = []
let template: string

beforeAll(async () => {
  template = await temporaryRoot('astrale-graph-acts-for-itself-template-')
  const created = await runCli(template, ['identity', 'create', 'alice', '--json'])
  expect(created.exitCode, created.stderr).toBe(0)
  await writeFile(
    join(template, 'config.json'),
    JSON.stringify({
      admin: {
        name: 'admin',
        url: ADMIN_KERNEL,
        kernelIssuer: ADMIN_KERNEL,
        domainIssuer: ADMIN_ISSUER,
      },
    }),
  )
  const bookmarked = await runCli(template, [
    'instance',
    'bookmark',
    'team',
    '--url',
    TEAM_KERNEL,
    '--domain-issuer',
    TEAM_ISSUER,
    '--skip-probe',
  ])
  expect(bookmarked.exitCode, bookmarked.stderr).toBe(0)
})

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('graph commands on a target that names a Domain issuer', () => {
  /** @evidence TEST-CLI-GRAPH-COMMAND-ACTS-FOR-ITSELF */
  test.each([
    ['the configured Admin', 'admin'],
    ['a bookmark with an explicit Domain issuer', 'team'],
  ])('query, get and mutate on %s act as the user, never through its Domain', async (_, name) => {
    const query = await runGraph(['query', '--class', `/:${ISSUE}`, '-i', name, '--as', 'alice'])
    expect(query.exitCode, query.stderr).toBe(0)
    // Through the Domain the Kernel bounds the read by the Domain's authority, which holds no Issue.
    expect(JSON.parse(query.stdout).graph.nodes).toEqual([
      expect.objectContaining({ id: 'issue-1', class: ISSUE }),
    ])

    const get = await runGraph(['get', '@issue-1', '-i', name, '--as', 'alice'])
    expect(get.exitCode, get.stderr).toBe(0)
    expect(JSON.parse(get.stdout)).toMatchObject({ id: 'issue-1', class: ISSUE })

    const mutate = await runGraph(['mutate', '--data', MUTATION, '-i', name, '--as', 'alice'])
    expect(mutate.exitCode, mutate.stderr).toBe(0)
    expect(JSON.parse(mutate.stdout)).toEqual({ createdNodes: { issue: 'issue-2' } })

    expect([...query.events, ...get.events, ...mutate.events]).toEqual([
      { kind: 'call', target: '/:kernel.astrale.ai:function.query', as: 'self' },
      { kind: 'call', target: '/:kernel.astrale.ai:function.query', as: 'self' },
      { kind: 'call', target: '/:kernel.astrale.ai:function.mutate', as: 'self' },
    ])
  })
})

async function runGraph(args: readonly string[]) {
  const root = await temporaryRoot('astrale-graph-acts-for-itself-')
  await cp(template, root, { recursive: true })
  const observed = join(root, 'observed.ndjson')
  await writeFile(observed, '')
  const child = Bun.spawn(
    ['bun', join(import.meta.dir, 'fixtures/graph-kernel.ts'), ...args, '--json'],
    {
      cwd: cliRoot,
      env: {
        ...process.env,
        ASTRALE_HOME: root,
        NO_UPDATE_NOTIFIER: '1',
        GRAPH_KERNEL_OBSERVED: observed,
        GRAPH_KERNEL_DOMAIN_ISSUERS: JSON.stringify([ADMIN_ISSUER, TEAM_ISSUER]),
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

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}
