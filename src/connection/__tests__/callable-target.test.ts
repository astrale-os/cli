import type { DomainInfo } from '@astrale-os/sdk/client/schema'
import type { ClientSession } from '@astrale-os/sdk/client/session'

import { issuer } from '@astrale-os/sdk/auth'
import { Path } from '@astrale-os/sdk/graph/path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { AstraleConfig } from '../../lib/config'
import type { ConnectionContext, ConnectionFactory } from '../session'

import { DomainIssuerCache } from '../../state/domain-issuers'
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
        session: {
          schema: {
            async inspect(origin: string) {
              inspected.push(origin)
              if (failure) throw failure
              return {
                origin,
                publication: { identity: { issuer: publishedIssuer } },
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

describe('callable credential ownership', () => {
  test.each(paths)('selects the executable Domain from %s', async (path) => {
    expect(callableOrigin(Path.parse(path))).toBe('services.example')
    const fixture = harness()
    await withResolvedClientSession(
      target,
      { as: 'alice' },
      config,
      async (context) => {
        expect(context.target.domainIssuer).toBe(serviceIssuer)
        expect(context.target.kernelIssuer).toBe(kernel)
        expect(context.target.caFile).toBe('/trust.pem')
        expect(fixture.closed).toEqual([0])
      },
      fixture.open,
      { principal: 'callable', path: Path.parse(path) },
    )
    expect(fixture.inspected).toEqual(['services.example'])
    expect(fixture.opened.map((entry) => entry.credential)).toEqual([
      { principal: 'caller' },
      { principal: 'domain' },
    ])
    expect(fixture.closed).toEqual([0, 1])
  })

  test('retains the caller for a locally hosted Domain', async () => {
    const fixture = harness(kernel)
    await withResolvedClientSession(
      target,
      {},
      config,
      async (context) => {
        expect(context.target.domainIssuer).toBeUndefined()
      },
      fixture.open,
      { principal: 'callable', path: Path.parse(paths[0]!) },
    )
    expect(fixture.opened[1]?.credential).toEqual({ principal: 'caller' })
  })

  test('does not exchange explicit credentials, anonymous calls, or Kernel calls', async () => {
    for (const [options, path] of [
      [{ creds: 'explicit' }, paths[1]!],
      [{ anonymous: true }, paths[0]!],
      [{ as: 'root' }, '/:kernel.astrale.ai:class.Identity:whoami'],
    ] as const) {
      const fixture = harness()
      await withResolvedClientSession(
        target,
        options,
        config,
        async () => undefined,
        fixture.open,
        { principal: 'callable', path: Path.parse(path) },
      )
      expect(fixture.inspected).toEqual([])
      expect(fixture.opened).toHaveLength(1)
      expect(fixture.opened[0]?.credential).toEqual({ principal: 'caller' })
    }
  })

  test('closes failed discovery without invoking or falling back to Shell', async () => {
    const failure = new Error('installation unavailable')
    const fixture = harness(serviceIssuer, failure)
    let invoked = false
    await expect(
      withResolvedClientSession(
        target,
        {},
        config,
        async () => {
          invoked = true
        },
        fixture.open,
        { principal: 'callable', path: Path.parse(paths[1]!) },
      ),
    ).rejects.toBe(failure)
    expect(invoked).toBe(false)
    expect(fixture.opened).toHaveLength(1)
    expect(fixture.closed).toEqual([0])
  })
})

describe('remembered callable Domain issuer', () => {
  let directory: string
  let cache: DomainIssuerCache
  const path = Path.parse(paths[0]!)
  const intent = { principal: 'callable', path } as const

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'astrale-callable-issuer-'))
    cache = new DomainIssuerCache(join(directory, 'session', 'domain-issuers.json'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  /** @evidence TEST-CLI-CALLABLE-ISSUER-READ-ONCE */
  test('reads the installation once, then exchanges without opening a discovery Session', async () => {
    const cold = harness()
    await withResolvedClientSession(
      target,
      {},
      config,
      async () => undefined,
      cold.open,
      intent,
      cache,
    )
    expect(cold.inspected).toEqual(['services.example'])
    expect(await cache.get(kernel, 'services.example')).toBe(serviceIssuer)

    const warm = harness()
    await withResolvedClientSession(
      target,
      {},
      config,
      async (context) => {
        expect(context.target.domainIssuer).toBe(serviceIssuer)
        expect(context.target.caFile).toBe('/trust.pem')
      },
      warm.open,
      intent,
      cache,
    )
    expect(warm.inspected).toEqual([])
    expect(warm.opened.map((entry) => entry.credential)).toEqual([{ principal: 'domain' }])
  })

  test('remembers a Kernel-hosted Domain as retaining the caller', async () => {
    await withResolvedClientSession(
      target,
      {},
      config,
      async () => undefined,
      harness(kernel).open,
      intent,
      cache,
    )
    const warm = harness()
    await withResolvedClientSession(
      target,
      {},
      config,
      async (context) => {
        expect(context.target.domainIssuer).toBeUndefined()
      },
      warm.open,
      intent,
      cache,
    )
    expect(warm.inspected).toEqual([])
    expect(warm.opened.map((entry) => entry.credential)).toEqual([{ principal: 'caller' }])
  })

  /** @evidence TEST-CLI-CALLABLE-ISSUER-FORGOTTEN-ON-FAILURE */
  test('forgets a remembered issuer after a failed command so the next one re-reads it', async () => {
    await cache.set(kernel, 'services.example', 'https://stale.example')
    const failure = new Error('credential rejected')
    const stale = harness()
    await expect(
      withResolvedClientSession(
        target,
        {},
        config,
        async () => {
          throw failure
        },
        stale.open,
        intent,
        cache,
      ),
    ).rejects.toBe(failure)
    expect(stale.inspected).toEqual([])
    expect(await cache.get(kernel, 'services.example')).toBeUndefined()

    const healed = harness()
    await withResolvedClientSession(
      target,
      {},
      config,
      async () => undefined,
      healed.open,
      intent,
      cache,
    )
    expect(healed.inspected).toEqual(['services.example'])
    expect(await cache.get(kernel, 'services.example')).toBe(serviceIssuer)
  })

  test('keeps a freshly read issuer when the command itself fails', async () => {
    const failure = new Error('input rejected')
    await expect(
      withResolvedClientSession(
        target,
        {},
        config,
        async () => {
          throw failure
        },
        harness().open,
        intent,
        cache,
      ),
    ).rejects.toBe(failure)
    expect(await cache.get(kernel, 'services.example')).toBe(serviceIssuer)
  })

  test('falls back to the installation when the remembered state cannot be used', async () => {
    const file = join(directory, 'session', 'domain-issuers.json')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, 'not json')
    const fixture = harness()
    await withResolvedClientSession(
      target,
      {},
      config,
      async () => undefined,
      fixture.open,
      intent,
      cache,
    )
    expect(fixture.inspected).toEqual(['services.example'])
    expect(fixture.opened.at(-1)?.credential).toEqual({ principal: 'domain' })
  })
})
