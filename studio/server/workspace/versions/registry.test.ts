import { afterEach, expect, test } from 'bun:test'

import { AdminContract } from '../../../../src/admin/contract'
import { isOrigin, isVersion } from '../../../shared/contracts/versions'
import { createRegistryReader, decodeRegistryIndex, INDEX_TTL_MS } from './registry'
import {
  answered,
  disposeProjects,
  fakeContext,
  indexStdout,
  publication,
  registryError,
  revision,
} from './test-fixtures'

afterEach(disposeProjects)

const ORIGIN = 'issues.astrale.ai'

test('an index is read through the CLI in machine mode, shared while it stands, then read again', async () => {
  let now = 0
  const { context, recorded } = fakeContext({
    domains: [],
    now: () => now,
    cli: () => answered(indexStdout(ORIGIN, [publication('0.9.1', revision('a'))])),
  })
  const registry = createRegistryReader(context)
  const [first, second] = await Promise.all([registry.index(ORIGIN), registry.index(ORIGIN)])
  expect(first).toEqual(second)
  expect(first.status).toBe('ok')
  expect(recorded.cli).toEqual([['domain', 'versions', ORIGIN, '--json', '--no-prompt']])
  now = INDEX_TTL_MS - 1
  await registry.index(ORIGIN)
  expect(recorded.cli).toHaveLength(1)
  await registry.index(ORIGIN, { fresh: true })
  expect(recorded.cli).toHaveLength(2)
  registry.forget(ORIGIN)
  await registry.index(ORIGIN)
  expect(recorded.cli).toHaveLength(3)
  // a refresh forgets every origin's index
  registry.forget()
  await registry.index(ORIGIN)
  expect(recorded.cli).toHaveLength(4)
})

test('fresh reads of one origin join the read in flight; one after a Publish asks again', async () => {
  const pending: ((answer: ReturnType<typeof answered>) => void)[] = []
  const { context, recorded } = fakeContext({
    domains: [],
    cli: () => new Promise((resolve) => pending.push(resolve)),
  })
  const registry = createRegistryReader(context)
  const reads = [
    registry.index(ORIGIN),
    registry.index(ORIGIN, { fresh: true }),
    registry.index(ORIGIN, { fresh: true }),
  ]
  // another origin is read on its own
  const other = registry.index('kernel.astrale.ai', { fresh: true })
  await Bun.sleep(0)
  expect(recorded.cli.map((args) => args[2])).toEqual([ORIGIN, 'kernel.astrale.ai'])

  // a Publish forgets the origin: the read after it does not join the one before it
  registry.forget(ORIGIN)
  const after = registry.index(ORIGIN, { fresh: true })
  await Bun.sleep(0)
  expect(recorded.cli).toHaveLength(3)
  for (const resolve of pending.splice(0))
    resolve(answered(indexStdout(ORIGIN, [publication('0.9.1', revision('a'))])))
  const [first, ...joined] = await Promise.all(reads)
  for (const answer of joined) expect(answer).toBe(first)
  await Promise.all([other, after])

  // once answered, a fresh read asks the registry again
  const again = registry.index(ORIGIN, { fresh: true })
  await Bun.sleep(0)
  expect(recorded.cli).toHaveLength(4)
  pending.shift()!(answered(indexStdout(ORIGIN, [])))
  await again
})

test("a read the registry did not answer is retried; the registry's refusal stands like a list", async () => {
  const answers = [
    answered('', '{"error":"IDP_SESSION_MISSING","message":"Not signed in."}', 1),
    registryError('REGISTRY_DOMAIN_NOT_FOUND', 'Absent.', { origin: 'kernel.astrale.ai' }),
  ]
  const { context, recorded } = fakeContext({ domains: [], cli: () => answers.shift()! })
  const registry = createRegistryReader(context)
  expect(await registry.index('kernel.astrale.ai')).toMatchObject({
    status: 'signed-out',
    code: 'IDP_SESSION_MISSING',
  })
  expect(await registry.index('kernel.astrale.ai')).toMatchObject({
    status: 'not-found',
    code: 'REGISTRY_DOMAIN_NOT_FOUND',
    message: 'Absent.',
  })
  expect(await registry.index('kernel.astrale.ai')).toMatchObject({ status: 'not-found' })
  expect(recorded.cli).toHaveLength(2)
})

test('an index is decoded whole or not at all, and never for another origin', async () => {
  const good = JSON.parse(indexStdout(ORIGIN, [publication('1.0.0', revision('a'))]))
  expect(decodeRegistryIndex(good)?.publications[0]?.version).toBe('1.0.0')
  const broken = structuredClone(good)
  broken.publications.push({ version: '0.9.0' })
  expect(decodeRegistryIndex(broken)).toBeUndefined()
  const { context } = fakeContext({
    domains: [],
    cli: () => answered(indexStdout('other.test', [])),
  })
  expect(await createRegistryReader(context).index(ORIGIN)).toMatchObject({ status: 'failed' })
})

test('no argument that is not an origin or a version ever reaches the CLI', async () => {
  expect(isOrigin('issues.astrale.ai')).toBe(true)
  expect(isOrigin('--instance=evil')).toBe(false)
  expect(isOrigin('a b')).toBe(false)
  expect(isVersion('0.1.0-beta.63')).toBe(true)
  expect(isVersion('v1.0.0')).toBe(false)
  expect(isVersion('1.0.0+build')).toBe(false)
  const { context, recorded } = fakeContext({ domains: [] })
  const registry = createRegistryReader(context)
  expect((await registry.index('--help')).status).toBe('failed')
  expect((await registry.bundleFile(ORIGIN, '--output=/etc/passwd')).status).toBe('failed')
  expect(recorded.cli).toEqual([])
})

test('a Publication bundle is fetched once into scratch, and only a verified document is accepted', async () => {
  const { context, recorded } = fakeContext({
    domains: [],
    cli: (args) =>
      answered(
        JSON.stringify({
          format: 'astrale.registry-bundle',
          version: 1,
          publication: { origin: ORIGIN, version: args[2]!.split('@')[1] },
          bundle: { digest: `sha256:${'c'.repeat(64)}`, mediaType: 'application/json', size: 3 },
        }),
      ),
  })
  const registry = createRegistryReader(context)
  const first = await registry.bundleFile(ORIGIN, '0.9.1')
  const again = await registry.bundleFile(ORIGIN, '0.9.1')
  expect(first).toEqual(again)
  expect(first.status === 'ok' && first.value.digest).toBe(`sha256:${'c'.repeat(64)}`)
  expect(recorded.cli).toHaveLength(1)
  const [args] = recorded.cli
  expect(args!.slice(0, 4)).toEqual(['__domain-registry', 'bundle', `${ORIGIN}@0.9.1`, '--output'])
  expect(args!.slice(5)).toEqual(['--json', '--no-prompt'])
  expect(first.status === 'ok' && first.value.file).toBe(args![4]!)
})

test('the registry Domains are the caller-run Query of Admin Domain Nodes, page by page', async () => {
  const keys = AdminContract.properties.domain
  const node = (origin: string, name: string) => ({
    id: origin,
    class: 'admin.astrale.ai:class.Domain',
    props: {
      [keys.origin]: origin,
      [keys.name]: name,
      [keys.createdAt]: '2026-10-11T23:56:42.011Z',
    },
  })
  const pages = [
    {
      kind: 'graph',
      graph: { nodes: [node('shell.astrale.ai', 'Shell')], edges: [] },
      page: { next: 'c1' },
    },
    { kind: 'graph', graph: { nodes: [node('admin.astrale.ai', 'Admin')], edges: [] } },
  ]
  const { context, recorded } = fakeContext({
    domains: [],
    cli: (args) =>
      args[0] === 'status'
        ? answered(JSON.stringify({ admin: { name: 'admin', url: 'https://admin.example.test' } }))
        : answered(JSON.stringify(pages.shift())),
  })
  const listing = await createRegistryReader(context).domains()
  expect(listing).toMatchObject({
    status: 'ok',
    value: {
      source: 'admin-graph-query',
      admin: 'admin',
      complete: true,
      domains: [
        { origin: 'admin.astrale.ai', name: 'Admin' },
        { origin: 'shell.astrale.ai', name: 'Shell', createdAt: '2026-10-11T23:56:42.011Z' },
      ],
    },
  })
  expect(recorded.cli[1]).toEqual([
    'query',
    '--instance',
    'admin',
    '--class',
    '/:admin.astrale.ai:class.Domain',
    '--limit',
    '256',
    '--json',
    '--no-prompt',
  ])
  expect(recorded.cli[2]).toContain('--cursor')
  expect(recorded.cli[2]![recorded.cli[2]!.indexOf('--cursor') + 1]).toBe('c1')
})

test('a listing stopped by the page bound says it is incomplete', async () => {
  const { context } = fakeContext({
    domains: [],
    cli: (args) =>
      args[0] === 'status'
        ? answered(JSON.stringify({ admin: { name: 'admin' } }))
        : answered(
            JSON.stringify({
              kind: 'graph',
              graph: { nodes: [], edges: [] },
              page: { next: 'more' },
            }),
          ),
  })
  const listing = await createRegistryReader(context).domains()
  expect(listing.status === 'ok' && listing.value.complete).toBe(false)
})
