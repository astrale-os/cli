import type { DomainInfo } from '@astrale-os/sdk/client/schema'
import type { ClientSession } from '@astrale-os/sdk/client/session'

import { issuer } from '@astrale-os/sdk/auth'
import { Path } from '@astrale-os/sdk/graph/path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AstraleConfig } from '../../lib/config'
import type { ConnectionContext, ConnectionFactory } from '../session'

import { InstallationCache } from '../../state/installations'
import { callableOrigin } from '../callable-target'
import { withResolvedClientSession } from '../session'

const kernel = issuer.accept('https://child.example/api')
const serviceIssuer = issuer.accept('https://services.beta.example')
const target = {
  url: kernel,
  kernelIssuer: kernel,
  domainIssuer: issuer.accept('https://shell.example'),
  slug: 'child',
  caFile: '/trust.pem',
}
const config = {} as AstraleConfig
const paths = [
  '/:services.example:class.Worker:deploy',
  '@worker::services.example:class.Worker.method.logs',
  '/:consumer.example:core.worker::services.example:class.Worker.method.logs',
  '/:services.example:function.inspect',
]

function harness(publishedIssuer = serviceIssuer, failure?: Error) {
  const opened: Array<{ target: unknown; credential: unknown }> = []
  const closed: number[] = []
  const inspected: string[] = []
  const open: ConnectionFactory = (selected, _timeout, _options, _config, credential) => {
    const index = opened.length
    opened.push({ target: selected, credential })
    return {
      context: {
        target: selected,
        graph: {},
        auth: {},
        session: {
          auth: {},
          schema: {
            async inspect(origin: string) {
              inspected.push(origin)
              if (failure) throw failure
              return {
                origin,
                release: { identity: { issuer: publishedIssuer } },
              } as DomainInfo
            },
          },
        } as unknown as ClientSession,
      } as ConnectionContext,
      close() {
        closed.push(index)
      },
    }
  }
  return { open, opened, closed, inspected }
}

type Run = Readonly<{
  options?: Parameters<typeof withResolvedClientSession>[1]
  path?: string
  cache?: InstallationCache
}>

/** One command through the connection lifecycle with a callable intent. */
function run(
  fixture: ReturnType<typeof harness>,
  action: (context: ConnectionContext) => Promise<unknown> = async () => undefined,
  { options = {}, path = paths[0]!, cache }: Run = {},
) {
  const intent = { principal: 'callable', path: Path.parse(path) } as const
  return withResolvedClientSession(target, options, config, action, fixture.open, intent, cache)
}

describe('callable credential ownership', () => {
  test.each(paths)('selects the executable Domain from %s', async (path) => {
    expect(callableOrigin(Path.parse(path))).toBe('services.example')
    const fixture = harness()
    await run(
      fixture,
      async (context) => {
        expect(context.target).toMatchObject({
          domainIssuer: serviceIssuer,
          kernelIssuer: kernel,
          caFile: '/trust.pem',
        })
        expect(fixture.closed).toEqual([0])
      },
      { options: { as: 'alice' }, path },
    )
    expect(fixture.inspected).toEqual(['services.example'])
    expect(fixture.opened.map((entry) => entry.credential)).toEqual([
      { principal: 'caller' },
      { principal: 'domain' },
    ])
    expect(fixture.closed).toEqual([0, 1])
  })

  test('does not exchange explicit credentials, anonymous calls, or Kernel calls', async () => {
    for (const [options, path] of [
      [{ creds: 'explicit' }, paths[1]!],
      [{ anonymous: true }, paths[0]!],
      [{ as: 'root' }, '/:kernel.astrale.ai:class.Identity:whoami'],
    ] as const) {
      const fixture = harness()
      await run(fixture, undefined, { options, path })
      expect(fixture.inspected).toEqual([])
      expect(fixture.opened.map((entry) => entry.credential)).toEqual([{ principal: 'caller' }])
    }
  })

  test('closes failed discovery without invoking or falling back to Shell', async () => {
    const failure = new Error('installation unavailable')
    const fixture = harness(serviceIssuer, failure)
    let invoked = false
    const invoke = async () => void (invoked = true)
    await expect(run(fixture, invoke, { path: paths[1]! })).rejects.toBe(failure)
    expect(invoked).toBe(false)
    expect(fixture.opened).toHaveLength(1)
    expect(fixture.closed).toEqual([0])
  })
})

describe('remembered callable Domain issuer', () => {
  let directory: string
  let cache: InstallationCache

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'astrale-callable-issuer-'))
    cache = new InstallationCache(join(directory, 'session', 'installations.json'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  /** @evidence TEST-CLI-CALLABLE-ISSUER-READ-ONCE */
  test('reads the installation once, then exchanges without opening a discovery Session', async () => {
    const cold = harness()
    await run(cold, undefined, { cache })
    expect(cold.inspected).toEqual(['services.example'])
    expect(await cache.get(kernel, 'services.example')).toEqual({ issuer: serviceIssuer })

    const warm = harness()
    await run(
      warm,
      async (context) => {
        expect(context.target).toMatchObject({ domainIssuer: serviceIssuer, caFile: '/trust.pem' })
      },
      { cache },
    )
    expect(warm.inspected).toEqual([])
    expect(warm.opened.map((entry) => entry.credential)).toEqual([{ principal: 'domain' }])
  })

  test('retains, and remembers, the caller for a Kernel-hosted Domain', async () => {
    const hosted = async (context: ConnectionContext) => {
      expect(context.target.domainIssuer).toBeUndefined()
    }
    const cold = harness(kernel)
    await run(cold, hosted, { cache })
    expect(cold.opened[1]?.credential).toEqual({ principal: 'caller' })
    const warm = harness()
    await run(warm, hosted, { cache })
    expect(warm.inspected).toEqual([])
    expect(warm.opened.map((entry) => entry.credential)).toEqual([{ principal: 'caller' }])
  })

  /** @evidence TEST-CLI-CALLABLE-ISSUER-FORGOTTEN-ON-FAILURE */
  test('forgets a remembered issuer after a failed command so the next one re-reads it', async () => {
    await cache.set(kernel, 'services.example', { issuer: 'https://stale.example' })
    const failure = new Error('credential rejected')
    const stale = harness()
    const fail = async () => {
      throw failure
    }
    await expect(run(stale, fail, { cache })).rejects.toBe(failure)
    expect(stale.inspected).toEqual([])
    expect(await cache.get(kernel, 'services.example')).toBeUndefined()

    const healed = harness()
    await run(healed, undefined, { cache })
    expect(healed.inspected).toEqual(['services.example'])
    expect(await cache.get(kernel, 'services.example')).toEqual({ issuer: serviceIssuer })
  })
})
