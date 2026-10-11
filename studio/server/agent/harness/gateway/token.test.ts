import { expect, test } from 'bun:test'

import type { HarnessGatewayConfig } from '../../../../shared/types'

import { HarnessTokenBroker, HarnessTokenError } from './token'

function jwt(audience: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode({ aud: audience, exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`
}

const acquire = (
  broker: HarnessTokenBroker,
  auth: HarnessGatewayConfig['auth'],
  audience = 'https://gateway.example',
) => broker.acquireGatewayToken({ enabled: true, baseUrl: audience, auth }, audience)

async function failure(pending: Promise<unknown>): Promise<string> {
  const error = await pending.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  expect(error).toBeInstanceOf(HarnessTokenError)
  return (error as HarnessTokenError).kind
}

test('a static token is trimmed; host mode fails closed, with nothing to relay one', async () => {
  const broker = new HarnessTokenBroker()
  expect(await acquire(broker, { mode: 'token', token: ' x ' })).toBe('x')
  expect(await failure(acquire(broker, { mode: 'host' }))).toBe('host-token-needed')
})

test('mints once per audience and instance, coalescing concurrent callers', async () => {
  const calls: { args: string[]; timeoutMs?: number }[] = []
  const broker = new HarnessTokenBroker({
    capture: async (_bin, args, _cwd, options) => {
      calls.push({ args, timeoutMs: options?.timeoutMs })
      await Promise.resolve()
      return { code: 0, stdout: `${jwt(args[args.indexOf('--audience') + 1]!)}\n`, stderr: '' }
    },
  })
  const audience = 'https://gateway.example'
  const [first, second] = await Promise.all([
    acquire(broker, { mode: 'mint', instance: 'prod' }),
    acquire(broker, { mode: 'mint', instance: 'prod' }),
  ])
  expect(second).toBe(first!)
  expect(await acquire(broker, { mode: 'mint', instance: 'prod' })).toBe(first!)
  expect(calls).toEqual([
    {
      args: ['token', '--audience', audience, '--ttl', '240', '--raw', '-i', 'prod'],
      timeoutMs: 12_000,
    },
  ])

  await acquire(broker, { mode: 'mint', instance: 'staging' })
  await acquire(broker, { mode: 'mint', instance: 'prod' }, 'https://two.example')
  expect(calls).toHaveLength(3)
})

test('turns failed, blank, or wrong-audience mint output into a typed failure', async () => {
  for (const result of [
    { code: 7, stdout: '', stderr: 'not signed in' },
    { code: 0, stdout: ' ', stderr: '' },
    { code: 0, stdout: jwt('https://other.example'), stderr: '' },
  ]) {
    const broker = new HarnessTokenBroker({ capture: async () => result })
    expect(await failure(acquire(broker, { mode: 'mint' }))).toBe('mint-failed')
  }
})
