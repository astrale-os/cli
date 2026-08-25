import { expect, test } from 'bun:test'

import { HarnessTokenBroker, HarnessTokenError } from './token'

function jwt(audience: string, expiresAtMs = Date.now() + 3_600_000): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ aud: audience, exp: Math.floor(expiresAtMs / 1000) }),
  ).toString('base64url')
  return `${header}.${payload}.signature`
}

test('resolves static and audience-bound host-relayed gateway tokens', async () => {
  const broker = new HarnessTokenBroker()
  expect(
    await broker.acquireGatewayToken(
      {
        enabled: true,
        baseUrl: 'https://gateway.example',
        auth: { mode: 'token', token: ' x ' },
      },
      'https://gateway.example',
    ),
  ).toBe('x')

  const audience = 'https://host.example'
  const token = jwt(audience)
  expect(broker.setHostToken(audience, token)).toBe(true)
  expect(broker.setHostToken(audience, jwt('https://other.example'))).toBe(false)
  expect(
    await broker.acquireGatewayToken(
      { enabled: true, baseUrl: audience, auth: { mode: 'host' } },
      audience,
    ),
  ).toBe(token)
})

test('reports a missing host relay as the concrete typed failure', async () => {
  expect.assertions(2)
  const broker = new HarnessTokenBroker()
  try {
    await broker.acquireGatewayToken(
      {
        enabled: true,
        baseUrl: 'https://missing.example',
        auth: { mode: 'host' },
      },
      'https://missing.example',
    )
  } catch (error) {
    expect(error).toBeInstanceOf(HarnessTokenError)
    expect((error as HarnessTokenError).kind).toBe('host-token-needed')
  }
})

test('mints with the exact audience and instance, caches, and coalesces concurrent callers', async () => {
  const calls: { args: string[]; timeoutMs?: number }[] = []
  const audience = 'https://gateway.example'
  const token = jwt(audience)
  const broker = new HarnessTokenBroker({
    capture: async (_bin, args, _cwd, options) => {
      calls.push({ args, timeoutMs: options?.timeoutMs })
      await Promise.resolve()
      return { code: 0, stdout: `${token}\n`, stderr: '' }
    },
  })
  const config = {
    enabled: true,
    baseUrl: audience,
    auth: { mode: 'mint' as const, instance: 'prod' },
  }

  expect(
    await Promise.all([
      broker.acquireGatewayToken(config, audience),
      broker.acquireGatewayToken(config, audience),
    ]),
  ).toEqual([token, token])
  expect(await broker.acquireGatewayToken(config, audience)).toBe(token)
  expect(calls).toEqual([
    {
      args: ['token', '--audience', audience, '--ttl', '240', '--raw', '-i', 'prod'],
      timeoutMs: 12_000,
    },
  ])
})

test('isolates mint caches by audience and instance', async () => {
  let calls = 0
  const broker = new HarnessTokenBroker({
    capture: async (_bin, args) => {
      calls++
      const audience = args[args.indexOf('--audience') + 1]
      return { code: 0, stdout: jwt(audience), stderr: '' }
    },
  })

  for (const [audience, instance] of [
    ['https://one.example', 'a'],
    ['https://one.example', 'b'],
    ['https://two.example', 'a'],
  ] as const)
    await broker.acquireGatewayToken(
      { enabled: true, baseUrl: audience, auth: { mode: 'mint', instance } },
      audience,
    )

  expect(calls).toBe(3)
})

test('turns failed, blank, or wrong-audience mint output into a typed failure', async () => {
  expect.assertions(6)
  for (const result of [
    { code: 7, stdout: '', stderr: 'not signed in' },
    { code: 0, stdout: ' ', stderr: '' },
    { code: 0, stdout: jwt('https://other.example'), stderr: '' },
  ]) {
    const broker = new HarnessTokenBroker({ capture: async () => result })
    try {
      await broker.acquireGatewayToken(
        {
          enabled: true,
          baseUrl: 'https://gateway.example',
          auth: { mode: 'mint' },
        },
        'https://gateway.example',
      )
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessTokenError)
      expect((error as HarnessTokenError).kind).toBe('mint-failed')
    }
  }
})
