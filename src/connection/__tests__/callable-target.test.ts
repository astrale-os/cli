import type { DomainInfo } from '@astrale-os/sdk/client/schema'
import type { ClientSession } from '@astrale-os/sdk/client/session'

import { issuer } from '@astrale-os/sdk/auth'
import { Path } from '@astrale-os/sdk/graph/path'
import { describe, expect, test } from 'bun:test'

import type { AstraleConfig } from '../../lib/config'
import type { ConnectionContext, ConnectionFactory } from '../session'

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
