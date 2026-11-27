import { afterEach, expect, test } from 'bun:test'

import type { CapturedProcess } from '../../process'
import type { IslandRequest } from './island'

import { createCompatibilityJudge } from './judge'
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

const SHELL = 'shell.astrale.ai'
const BUILT = revision('shell-built')
const NEWER = revision('shell-newer')
const EDITED = revision('shell-edited')
const ADMIN = revision('admin')

const unsatisfied = {
  subject: { key: 'class.Member.properties.email', kind: 'property' },
  facet: 'structure',
  requirement: 'property',
  state: 'missing',
  required: { value: { type: 'string' } },
  differences: [],
  differencesOmitted: 0,
  usages: [{ origin: 'admin.astrale.ai', relation: 'reads' }],
}

function bundleDocument(args: string[]): CapturedProcess {
  const [origin, version] = args[2]!.split('@')
  return answered(
    JSON.stringify({
      format: 'astrale.registry-bundle',
      version: 1,
      publication: { origin, version },
      bundle: { digest: `sha256:${'d'.repeat(64)}` },
    }),
  )
}

/** Compatible unless the target is the newer revision, which drops a property Admin reads. */
function island(request: IslandRequest) {
  if (request.op !== 'compare') throw new Error('compare expected')
  return {
    ok: true,
    op: 'compare',
    results: request.targets.map((target) => ({
      id: target.id,
      ok: true,
      compatible: target.revision !== NEWER,
      equivalent: target.revision === BUILT,
      unsatisfied: target.revision === NEWER ? [unsatisfied] : [],
      evidence: { structure: 'sha256:structure', meaning: 'sha256:meaning' },
    })),
  }
}

function setup(
  options: {
    bundleFile?: (args: string[]) => CapturedProcess
    island?: (request: IslandRequest) => unknown
    shellCopy?: boolean
  } = {},
) {
  const admin = project({ id: 'admin' })
  const shell = project({ id: 'shell' })
  const fake = fakeContext({
    domains: options.shellCopy === false ? [admin] : [admin, shell],
    bundles: {
      admin: admittedBundle('admin', 'admin.astrale.ai', ADMIN, {
        shell: { origin: SHELL, revision: BUILT },
      }),
      shell: admittedBundle('shell', SHELL, EDITED),
    },
    cli: (args) =>
      args[0] === 'domain'
        ? answered(
            indexStdout(SHELL, [
              publication('0.2.0', NEWER),
              publication('0.1.1', BUILT),
              publication('0.1.0', BUILT, { yanked: true }),
            ]),
          )
        : (options.bundleFile ?? bundleDocument)(args),
    island: options.island ?? island,
  })
  const judge = createCompatibilityJudge(fake.context, createRegistryReader(fake.context))
  return { admin, shell, judge, recorded: fake.recorded }
}

test('a matrix judges every revision once, in one island run, and every carrier shares its verdict', async () => {
  const { admin, judge, recorded } = setup()
  const matrix = await judge.matrix(admin)
  expect(recorded.island).toHaveLength(1)
  const [request] = recorded.island
  if (request?.op !== 'compare') throw new Error('compare expected')
  expect(request.projectRoot).toBe(admin.root)
  expect(request.targets.map((target) => [target.revision, Object.keys(target.source)[0]])).toEqual(
    [
      [NEWER, 'bundleFile'],
      [BUILT, 'bundleFile'],
      [EDITED, 'document'],
    ],
  )
  // One bundle per revision, from its highest carrier.
  expect(
    recorded.cli.filter((args) => args[0] === '__domain-registry').map((args) => args[2]),
  ).toEqual([`${SHELL}@0.2.0`, `${SHELL}@0.1.1`])

  expect(matrix).toMatchObject({ domainId: 'admin', origin: 'admin.astrale.ai', revision: ADMIN })
  const [dependency] = matrix.dependencies
  expect(dependency).toMatchObject({ origin: SHELL, builtAgainst: BUILT })
  if (dependency?.publications.status !== 'ok') throw new Error('publications unread')
  const verdicts = dependency.publications.value.map(({ version, yanked, verdict }) => {
    if (verdict.status !== 'ok') throw new Error(verdict.message)
    return [
      version,
      yanked,
      verdict.value.compatible,
      verdict.value.sameRevisionAs,
      verdict.value.unsatisfied.length,
    ]
  })
  expect(verdicts).toEqual([
    ['0.2.0', false, false, [], 1],
    ['0.1.1', false, true, ['0.1.0'], 0],
    ['0.1.0', true, true, ['0.1.1'], 0],
  ])
  expect(dependency.local).toMatchObject({
    domainId: 'shell',
    verdict: {
      status: 'ok',
      value: {
        target: { kind: 'local', origin: SHELL, domainId: 'shell', revision: EDITED },
        dependent: { domainId: 'admin', origin: 'admin.astrale.ai', revision: ADMIN },
        compatible: true,
        scope: { capabilities: 'not-judged', held: false },
        judgedBy: { sdk: '0.6.0-beta.62' },
      },
    },
  })
})

test('a verdict is kept by the judging SDK and both revisions; concurrent asks share one run', async () => {
  const { admin, judge, recorded } = setup()
  const [first, second] = await Promise.all([judge.matrix(admin), judge.matrix(admin)])
  expect(second).toEqual(first)
  expect(recorded.island).toHaveLength(1)
  const single = await judge.verdict(admin, { origin: SHELL, version: '0.1.0' })
  expect(single).toMatchObject({
    status: 'ok',
    value: {
      target: { kind: 'publication', version: '0.1.0', revision: BUILT },
      sameRevisionAs: ['0.1.1'],
    },
  })
  expect(await judge.verdict(admin, { origin: SHELL, local: true })).toMatchObject({
    status: 'ok',
    value: { target: { kind: 'local', revision: EDITED } },
  })
  expect(recorded.island).toHaveLength(1)
})

test('what is not a dependency, a version or a workspace copy is not found', async () => {
  const { admin, judge, recorded } = setup({ shellCopy: false })
  expect(
    await judge.verdict(admin, { origin: 'issues.astrale.ai', version: '1.0.0' }),
  ).toMatchObject({
    status: 'not-found',
    message: 'admin.astrale.ai does not depend on issues.astrale.ai.',
  })
  expect(await judge.verdict(admin, { origin: SHELL, version: '9.9.9' })).toMatchObject({
    status: 'not-found',
  })
  expect(await judge.verdict(admin, { origin: SHELL, local: true })).toMatchObject({
    status: 'not-found',
    message: `The workspace holds no ${SHELL}.`,
  })
  expect((await judge.matrix(admin)).dependencies[0]?.local).toBeNull()
  expect(recorded.island).toHaveLength(1)
})

test("a bundle that cannot be fetched fails only its revision's verdicts, with the CLI's status", async () => {
  const { admin, judge, recorded } = setup({
    bundleFile: (args) =>
      args[2] === `${SHELL}@0.2.0`
        ? registryError('REGISTRY_FORBIDDEN', 'Not readable.')
        : bundleDocument(args),
  })
  const matrix = await judge.matrix(admin)
  const publications = matrix.dependencies[0]?.publications
  if (publications?.status !== 'ok') throw new Error('publications unread')
  expect(publications.value.map(({ verdict }) => verdict.status)).toEqual(['refused', 'ok', 'ok'])
  const [request] = recorded.island
  expect(request?.op === 'compare' && request.targets.map((target) => target.revision)).toEqual([
    BUILT,
    EDITED,
  ])
  // A failure is not kept: the next ask fetches again.
  await judge.verdict(admin, { origin: SHELL, version: '0.2.0' })
  expect(recorded.cli.filter((args) => args[2] === `${SHELL}@0.2.0`)).toHaveLength(2)
})

test('an island that fails answers every waiting verdict, and nothing of it is kept', async () => {
  let fail = true
  const { admin, judge, recorded } = setup({
    island: (request) => {
      if (fail) throw new Error('extractor exited 1')
      return island(request)
    },
  })
  const matrix = await judge.matrix(admin)
  const publications = matrix.dependencies[0]?.publications
  if (publications?.status !== 'ok') throw new Error('publications unread')
  expect(publications.value.map(({ verdict }) => verdict)).toEqual(
    Array(3).fill(
      expect.objectContaining({
        status: 'failed',
        message: 'The compatibility island failed: extractor exited 1',
      }),
    ),
  )
  fail = false
  const again = await judge.matrix(admin)
  expect(again.dependencies[0]?.local?.verdict.status).toBe('ok')
  expect(recorded.island).toHaveLength(2)
})

test('a Domain without an admitted Schema is not judged', async () => {
  const admin = project({ id: 'admin' })
  const { context, recorded } = fakeContext({
    domains: [admin],
    bundles: {
      admin: {
        ...admittedBundle('admin', 'admin.astrale.ai', ADMIN),
        schemaMode: 'canonical-preview',
      },
    },
  })
  const judge = createCompatibilityJudge(context, createRegistryReader(context))
  expect(await judge.matrix(admin)).toMatchObject({
    revision: null,
    dependencies: [],
    error: expect.any(String),
  })
  expect(await judge.verdict(admin, { origin: SHELL, version: '0.1.0' })).toMatchObject({
    status: 'failed',
  })
  expect([...recorded.cli, ...recorded.island]).toEqual([])
})
