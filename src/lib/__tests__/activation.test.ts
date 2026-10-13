import { describe, expect, mock, test } from 'bun:test'

import {
  activateInstance,
  activateLoggedInAccount,
  activateOwner,
  requestAccountActivation,
} from '../admin/activation'

const request = (endpoint: string, proof: string) => ({
  endpoint,
  instanceOrigin: 'https://child.example',
  credential: mock(async () => proof),
})
const registering = (endpoint: string, proof: string, registered = true) => ({
  ...request(endpoint, proof),
  registered: mock(async (_credential: string, _signal: AbortSignal) => registered),
})
const answering = (...responses: Response[]) => {
  const fetch = mock<typeof globalThis.fetch>()
  for (const response of responses) fetch.mockResolvedValueOnce(response)
  return { fetch, sleep: mock(async (_ms: number) => undefined) }
}

test('an activation posts only its target, with the primary proof as bearer, never a cookie', async () => {
  const account = registering('https://admin.example/v1/account-activation', 'primary-admin-proof')
  const transport = answering(Response.json({ status: 'ready' }))
  expect(await requestAccountActivation(account, transport)).toBe('ready')
  expect(transport.fetch.mock.calls).toEqual([
    [
      account.endpoint,
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: expect.objectContaining({ authorization: 'Bearer primary-admin-proof' }),
        body: JSON.stringify({ instanceOrigin: account.instanceOrigin }),
      }),
    ],
  ])
})

describe('account activation at login', () => {
  const account = (registered = true) =>
    registering('https://admin.example/v1/account-activation', 'proof', registered)
  const refusal = (status: number, code: string, headers: Record<string, string> = {}) =>
    Response.json({ code, retryable: status === 503 }, { status, headers })

  test('never retries a refusal, an unavailable Admin, a transport failure or a malformed receipt', async () => {
    for (const [response, outcome] of [
      [refusal(401, 'ACCOUNT_ACTIVATION_REJECTED'), 'rejected'],
      [refusal(403, 'ACCOUNT_ACTIVATION_DENIED'), 'denied'],
      [refusal(503, 'ACCOUNT_ACTIVATION_UNAVAILABLE'), 'unavailable'],
      [new Response('invalid JSON'), 'unavailable'],
      [Response.json({ status: 'ready', user: 'unexpected' }), 'unavailable'],
    ] as const) {
      const transport = answering(response)
      expect(await requestAccountActivation(account(), transport)).toBe(outcome)
      expect(transport.fetch).toHaveBeenCalledTimes(1)
    }
    const failed = answering()
    failed.fetch.mockRejectedValue(new Error('private transport detail'))
    expect(await requestAccountActivation(account(), failed)).toBe('unavailable')
  })

  test("asks Admin's Kernel whether it knows the account once Admin has nothing to complete", async () => {
    const known = account()
    expect(
      await requestAccountActivation(known, answering(Response.json({ status: 'ready' }))),
    ).toBe('ready')
    expect(known.registered).toHaveBeenCalledWith('proof', expect.any(AbortSignal))

    const unknown = account(false)
    expect(
      await requestAccountActivation(unknown, answering(Response.json({ status: 'ready' }))),
    ).toBe('unregistered')

    const refused = account()
    expect(
      await requestAccountActivation(refused, answering(refusal(403, 'ACCOUNT_ACTIVATION_DENIED'))),
    ).toBe('denied')
    expect(refused.registered).not.toHaveBeenCalled()
  })

  test("retries a registration in progress after Admin's bounded delay, then reports pending", async () => {
    const pending = (retryAfter?: string) =>
      refusal(503, 'ACCOUNT_ACTIVATION_PENDING', retryAfter ? { 'retry-after': retryAfter } : {})
    const recovering = answering(pending('2'), pending('60'), Response.json({ status: 'ready' }))
    expect(await requestAccountActivation(account(), recovering)).toBe('ready')
    expect(recovering.sleep.mock.calls).toEqual([[2_000], [5_000]])

    const stuck = answering(pending(), pending(), pending())
    expect(await requestAccountActivation(account(), stuck)).toBe('pending')
    expect(stuck.fetch).toHaveBeenCalledTimes(3)
  })

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

describe('owner activation of a created Instance', () => {
  const owner = (whoami = mock(async () => 'owner')) => ({
    ...request('https://admin.example/v1/owner-activation', 'primary-child-proof'),
    whoami,
  })
  const activate = (input: ReturnType<typeof owner>, response: Response | Error) => {
    const fetch = mock<typeof globalThis.fetch>()
    if (response instanceof Error) fetch.mockRejectedValue(response)
    else fetch.mockResolvedValue(response)
    return { fetch, done: activateOwner(input, { fetch }) }
  }

  test('finalizes the exact target, then verifies its human owner with the same proof', async () => {
    const input = owner()
    const run = activate(input, Response.json({ status: 'completed', user: 'owner' }))
    expect(await run.done).toEqual({ status: 'completed', user: 'owner' })
    expect(input.whoami).toHaveBeenCalledWith('primary-child-proof', expect.any(AbortSignal))
  })

  test.each([
    ['a refused proof', new Response(null, { status: 401 }), 'OWNER_ACTIVATION_REJECTED'],
    ['an invalid receipt', new Response('invalid JSON'), 'OWNER_ACTIVATION_PROTOCOL_INVALID'],
    [
      'a receipt carrying a credential',
      Response.json({ status: 'completed', user: 'owner', credential: 'unexpected' }),
      'OWNER_ACTIVATION_PROTOCOL_INVALID',
    ],
    ['an unknown outcome', new Error('private transport detail'), 'OWNER_ACTIVATION_UNAVAILABLE'],
  ] as const)('trusts no owner after %s, sent once', async (_name, response, code) => {
    const input = owner()
    const run = activate(input, response)
    await expect(run.done).rejects.toMatchObject({ code })
    expect(run.fetch).toHaveBeenCalledTimes(1)
    expect(input.whoami).not.toHaveBeenCalled()
  })

  test('refuses a receipt for another owner, or an explicit Admin credential for a human', async () => {
    const other = activate(
      owner(mock(async () => 'other')),
      Response.json({ status: 'completed', user: 'owner' }),
    )
    await expect(other.done).rejects.toMatchObject({ code: 'OWNER_ACTIVATION_IDENTITY_MISMATCH' })
    await expect(
      activateInstance(
        { id: 'instance', slug: 'child', url: 'https://child.example/api', state: 'ready' },
        { creds: 'admin-bearer' },
      ),
    ).rejects.toMatchObject({ code: 'OWNER_ACTIVATION_IDENTITY_REQUIRED' })
  })
})
