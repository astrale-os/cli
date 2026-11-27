import { afterEach, expect, test } from 'bun:test'

import type { CapturedProcess } from '../../process'
import type { IslandRequest } from './island'

import { DIFFERENCES_LIMIT, judgementOf, OBSERVED_VALUE_LIMIT } from './island'
import { createPublishedViewer } from './published'
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

const SHELL = 'shell.astrale.ai'
const PUBLISHED = revision('shell-0.1.0')
const BUNDLE_DIGEST = `sha256:${'d'.repeat(64)}`

function setup(
  options: {
    yanked?: () => boolean
    island?: (request: IslandRequest) => unknown
    ownCopy?: boolean
  } = {},
) {
  const issues = project({ id: 'issues', sdk: '0.6.0-beta.62' })
  const newer = project({ id: 'kernel-qa', sdk: '0.6.0-beta.71' })
  const shell = project({ id: 'shell', sdk: '0.6.0-beta.60' })
  const fake = fakeContext({
    domains: options.ownCopy === false ? [issues, newer] : [issues, newer, shell],
    bundles: {
      issues: admittedBundle('issues', 'issues.astrale.ai', revision('issues')),
      'kernel-qa': admittedBundle('kernel-qa', 'kernel-qa.astrale.test', revision('qa')),
      shell: admittedBundle('shell', SHELL, revision('shell-edited')),
    },
    cli: (args): CapturedProcess =>
      args[0] === 'domain'
        ? answered(
            indexStdout(SHELL, [
              publication('0.1.0', PUBLISHED, { yanked: options.yanked?.() ?? false }),
            ]),
          )
        : answered(
            JSON.stringify({
              format: 'astrale.registry-bundle',
              version: 1,
              publication: { origin: SHELL, version: '0.1.0' },
              bundle: { digest: BUNDLE_DIGEST },
            }),
          ),
    island:
      options.island ??
      ((request) =>
        request.op === 'project'
          ? {
              ok: true,
              op: 'project',
              ir: { domain: SHELL, classes: [] },
              root: { format: 'astrale.dsl', version: 'v1', origin: SHELL, dependencies: {} },
              closure: [],
              revision: request.revision,
            }
          : { ok: false, error: { message: 'project expected' } }),
  })
  const viewer = createPublishedViewer(fake.context, createRegistryReader(fake.context))
  return { viewer, shell, newer, recorded: fake.recorded }
}

test('a published version opens as a read-only Schema bundle, decoded by its own Domain when present', async () => {
  const { viewer, shell, recorded } = setup()
  const answer = await viewer.open(SHELL, '0.1.0')
  if (answer.status !== 'ok') throw new Error(answer.message)
  expect(answer.value).toMatchObject({
    domainId: '@registry:shell.astrale.ai@0.1.0',
    schemaMode: 'canonical-admitted',
    schemaRevision: PUBLISHED,
    ir: { domain: SHELL },
    schemaRoot: { origin: SHELL },
    schemaClosure: [],
    overlay: { handlerLinks: [], definitions: [], integrations: [], sourceSpans: {} },
    error: null,
    publication: {
      origin: SHELL,
      version: '0.1.0',
      schemaRevision: PUBLISHED,
      bundleDigest: BUNDLE_DIGEST,
      yanked: false,
      decodedBy: { sdk: '0.6.0-beta.60', domainId: 'shell' },
    },
  })
  const [request] = recorded.island
  expect(request).toMatchObject({
    op: 'project',
    projectRoot: shell.root,
    origin: SHELL,
    revision: PUBLISHED,
  })
  const bundleArgs = recorded.cli.find((args) => args[0] === '__domain-registry')!
  expect(request?.op === 'project' && request.bundleFile).toBe(bundleArgs[4]!)
})

test('without its own Domain, the workspace SDK that is newest decodes it', async () => {
  const { viewer, newer } = setup({ ownCopy: false })
  const answer = await viewer.open(SHELL, '0.1.0')
  expect(answer).toMatchObject({
    status: 'ok',
    value: { publication: { decodedBy: { sdk: '0.6.0-beta.71', domainId: 'kernel-qa' } } },
  })
  expect(answer.status === 'ok' && answer.value.publication.decodedBy.domainId).toBe(newer.id)
})

test('an opened version is kept by its release; only its yank is read again', async () => {
  let yanked = false
  const { viewer, recorded } = setup({ yanked: () => yanked })
  await viewer.open(SHELL, '0.1.0')
  yanked = true
  const again = await viewer.open(SHELL, '0.1.0', { fresh: true })
  expect(again.status === 'ok' && again.value.publication.yanked).toBe(true)
  expect(recorded.island).toHaveLength(1)
  expect(recorded.cli.filter((args) => args[0] === '__domain-registry')).toHaveLength(1)
})

test('a reader who asks again while a version is opened joins that opening', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  const { viewer, recorded } = setup({
    island: async (request) => {
      await held
      if (request.op !== 'project') throw new Error('opening a version only projects it')
      return {
        ok: true,
        op: 'project',
        ir: { domain: SHELL, classes: [] },
        root: { format: 'astrale.dsl', version: 'v1', origin: SHELL, dependencies: {} },
        closure: [],
        revision: request.revision,
      }
    },
  })
  const first = viewer.open(SHELL, '0.1.0')
  // past its limit, a page asks again: the projection still running answers both
  while (recorded.island.length === 0) await Bun.sleep(1)
  const second = viewer.open(SHELL, '0.1.0', { fresh: true })
  release()
  expect((await first).status).toBe('ok')
  expect((await second).status).toBe('ok')
  expect(recorded.island).toHaveLength(1)
})

test('an unknown version is not found and an unadmitted bundle is not opened', async () => {
  const absent = setup()
  expect(await absent.viewer.open(SHELL, '0.2.0')).toMatchObject({
    status: 'not-found',
    message: `${SHELL} has no Publication 0.2.0 this caller may read.`,
  })
  expect(absent.recorded.island).toEqual([])

  const wrong = setup({
    island: () => ({
      ok: false,
      error: { message: 'The bundle holds kernel.astrale.ai, not shell.astrale.ai.' },
    }),
  })
  expect(await wrong.viewer.open(SHELL, '0.1.0')).toMatchObject({
    status: 'failed',
    message: `${SHELL} 0.1.0 could not be opened: The bundle holds kernel.astrale.ai, not shell.astrale.ai.`,
  })
  const other = setup({
    island: () => ({
      ok: true,
      op: 'project',
      ir: {},
      root: {},
      closure: [],
      revision: revision('other'),
    }),
  })
  expect((await other.viewer.open(SHELL, '0.1.0')).status).toBe('failed')
})

test('an unsatisfied assessment carries required against provided, bounded, with its usages', () => {
  const large = 'x'.repeat(OBSERVED_VALUE_LIMIT + 1)
  const judgement = judgementOf({
    entries: [
      {
        subject: { key: 'class.Member', kind: 'class' },
        usages: [
          {
            source: { origin: 'admin.astrale.ai', revision: 'r' },
            relation: 'extends',
            key: 'class.Admin',
          },
        ],
      },
    ],
    structure: {
      compatible: false,
      assessments: [
        {
          subject: { key: 'class.Other', kind: 'class' },
          observation: { state: 'equal' },
          satisfied: true,
        },
        {
          subject: { key: 'class.Member', kind: 'class' },
          observation: {
            facet: 'structure',
            state: 'changed',
            before: { properties: ['email'] },
            after: large,
            differences: Array.from({ length: DIFFERENCES_LIMIT + 2 }, (_, index) => ({
              path: `/properties/${index}`,
              before: index,
            })),
          },
          requirement: { kind: 'class.properties' },
          satisfied: false,
        },
      ],
    },
    meaning: { equivalent: false },
    evidence: { structure: { fingerprint: 'sha256:s' }, meaning: { fingerprint: 'sha256:m' } },
  })
  expect(judgement.compatible).toBe(false)
  expect(judgement.evidence).toEqual({ structure: 'sha256:s', meaning: 'sha256:m' })
  expect(judgement.unsatisfied).toHaveLength(1)
  const [assessment] = judgement.unsatisfied
  expect(assessment).toMatchObject({
    subject: { key: 'class.Member', kind: 'class' },
    facet: 'structure',
    requirement: 'class.properties',
    state: 'changed',
    required: { value: { properties: ['email'] } },
    provided: { elided: true, bytes: OBSERVED_VALUE_LIMIT + 3 },
    differencesOmitted: 2,
    usages: [{ origin: 'admin.astrale.ai', key: 'class.Admin', relation: 'extends' }],
  })
  expect(assessment?.differences).toHaveLength(DIFFERENCES_LIMIT)
  expect(assessment?.differences[1]).toEqual({ path: '/properties/1', required: { value: 1 } })
})
