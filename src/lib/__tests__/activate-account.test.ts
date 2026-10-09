import { describe, expect, mock, test } from 'bun:test'

import { activateLoggedInAccount, requestAccountActivation } from '../activate-account'

const input = () => ({
  endpoint: 'https://admin.example/v1/account-activation',
  instanceOrigin: 'https://admin.eu.example',
  credential: mock(async () => 'primary-admin-proof'),
})
const refusal = (status: number, code: string, headers: Record<string, string> = {}) =>
  Response.json({ code, retryable: status === 503 }, { status, headers })
const dependencies = (...responses: Response[]) => {
  const fetch = mock<typeof globalThis.fetch>()
  for (const response of responses) fetch.mockResolvedValueOnce(response)
  return { fetch, sleep: mock(async (_ms: number) => undefined) }
}

describe('account activation transport', () => {
  test('posts only the target, with the primary proof as bearer, and reports ready', async () => {
    const request = input()
    const transport = dependencies(Response.json({ status: 'ready' }))
    expect(await requestAccountActivation(request, transport)).toBe('ready')
    expect(transport.fetch).toHaveBeenCalledTimes(1)
    const [url, options] = transport.fetch.mock.calls[0]!
    expect(url).toBe(request.endpoint)
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { authorization: 'Bearer primary-admin-proof' },
      body: JSON.stringify({ instanceOrigin: request.instanceOrigin }),
    })
  })

  test('never retries a refused login or a refused admission', async () => {
    for (const [response, outcome] of [
      [refusal(401, 'ACCOUNT_ACTIVATION_REJECTED'), 'rejected'],
      [refusal(403, 'ACCOUNT_ACTIVATION_DENIED'), 'denied'],
    ] as const) {
      const transport = dependencies(response)
      expect(await requestAccountActivation(input(), transport)).toBe(outcome)
      expect(transport.fetch).toHaveBeenCalledTimes(1)
    }
  })

  test("retries a registration still in progress after Admin's bounded delay", async () => {
    const transport = dependencies(
      refusal(503, 'ACCOUNT_ACTIVATION_PENDING', { 'retry-after': '2' }),
      refusal(503, 'ACCOUNT_ACTIVATION_PENDING', { 'retry-after': '60' }),
      Response.json({ status: 'ready' }),
    )
    expect(await requestAccountActivation(input(), transport)).toBe('ready')
    expect(transport.sleep.mock.calls).toEqual([[2_000], [5_000]])
  })

  test('reports pending after the last attempt and never retries an unavailable Admin', async () => {
    const pending = dependencies(
      ...Array.from({ length: 3 }, () => refusal(503, 'ACCOUNT_ACTIVATION_PENDING')),
    )
    expect(await requestAccountActivation(input(), pending)).toBe('pending')
    expect(pending.fetch).toHaveBeenCalledTimes(3)
    const unavailable = dependencies(refusal(503, 'ACCOUNT_ACTIVATION_UNAVAILABLE'))
    expect(await requestAccountActivation(input(), unavailable)).toBe('unavailable')
    expect(unavailable.fetch).toHaveBeenCalledTimes(1)
  })

  test('treats transport failures and malformed receipts as unavailable', async () => {
    const failed = { fetch: mock<typeof globalThis.fetch>(), sleep: mock(async () => undefined) }
    failed.fetch.mockRejectedValue(new Error('private transport detail'))
    expect(await requestAccountActivation(input(), failed)).toBe('unavailable')
    for (const response of [
      new Response('invalid JSON'),
      Response.json({ status: 'ready', user: 'unexpected' }),
    ])
      expect(await requestAccountActivation(input(), dependencies(response))).toBe('unavailable')
  })
})

describe('login activation scope', () => {
  test('reaches Admin only after a human login through the built-in WorkOS IdP', async () => {
    const fetch = mock<typeof globalThis.fetch>()
    const original = globalThis.fetch
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch
    try {
      expect(await activateLoggedInAccount({ identityName: 'alice', idpName: 'test' })).toBe(
        undefined,
      )
      expect(
        await activateLoggedInAccount({
          identityName: 'alice',
          idpName: 'workos',
          clientCredentials: true,
        }),
      ).toBe(undefined)
    } finally {
      globalThis.fetch = original
    }
    expect(fetch).not.toHaveBeenCalled()
  })
})
