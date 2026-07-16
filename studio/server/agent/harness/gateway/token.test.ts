import { expect, test } from 'bun:test'

import { acquireGatewayToken, HarnessTokenError, setHostToken } from './token'

function jwt(audience: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 600 }),
  ).toString('base64url')
  return `${header}.${payload}.signature`
}

test('resolves static and host-relayed gateway tokens', async () => {
  expect(
    await acquireGatewayToken(
      { enabled: true, baseUrl: 'https://gateway.example', auth: { mode: 'token', token: 'x' } },
      'https://gateway.example',
    ),
  ).toBe('x')

  const audience = `https://host-${crypto.randomUUID()}.example`
  const token = jwt(audience)
  expect(setHostToken(audience, token)).toBe(true)
  expect(
    await acquireGatewayToken(
      { enabled: true, baseUrl: audience, auth: { mode: 'host' } },
      audience,
    ),
  ).toBe(token)
})

test('reports a missing host relay as a typed failure', async () => {
  const audience = `https://missing-${crypto.randomUUID()}.example`
  await expect(
    acquireGatewayToken({ enabled: true, baseUrl: audience, auth: { mode: 'host' } }, audience),
  ).rejects.toBeInstanceOf(HarnessTokenError)
})
