import { describe, expect, mock, test } from 'bun:test'

import { activateInstance, activateOwner } from '../activate-instance'

const input = () => ({
  endpoint: 'https://admin.example/v1/owner-activation',
  instanceOrigin: 'https://child.example',
  credential: mock(async () => 'primary-child-proof'),
  whoami: mock(async () => 'owner'),
})

describe('owner activation transport', () => {
  test('finalizes the exact target then verifies its human owner, without a credential in JSON', async () => {
    const request = input()
    const fetch = mock<typeof globalThis.fetch>().mockResolvedValueOnce(
      Response.json({ status: 'completed', user: 'owner' }),
    )
    expect(await activateOwner(request, { fetch })).toEqual({
      status: 'completed',
      user: 'owner',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    for (const [url, options] of fetch.mock.calls) {
      expect(url).toBe(request.endpoint)
      expect(options).toMatchObject({
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: { authorization: 'Bearer primary-child-proof' },
        body: JSON.stringify({ instanceOrigin: request.instanceOrigin }),
      })
    }
    expect(request.whoami).toHaveBeenCalledWith('primary-child-proof', expect.any(AbortSignal))
  })

  test('never verifies or retries a refused proof', async () => {
    const request = input()
    const fetch = mock<typeof globalThis.fetch>().mockResolvedValue(
      new Response(null, { status: 401 }),
    )
    await expect(activateOwner(request, { fetch })).rejects.toMatchObject({
      code: 'OWNER_ACTIVATION_REJECTED',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(request.whoami).not.toHaveBeenCalled()
  })

  test('rejects oversized or malformed successful receipts without trusting an owner', async () => {
    for (const response of [
      new Response('x'.repeat(4097)),
      Response.json({ status: 'completed', user: 'owner', credential: 'unexpected' }),
    ]) {
      const request = input()
      await expect(
        activateOwner(request, {
          fetch: mock<typeof globalThis.fetch>().mockResolvedValue(response),
        }),
      ).rejects.toMatchObject({ code: 'OWNER_ACTIVATION_PROTOCOL_INVALID' })
      expect(request.whoami).not.toHaveBeenCalled()
    }
  })

  test('waits for the serialized credential refresh before starting activation', async () => {
    const order: string[] = []
    const request = {
      ...input(),
      credential: async () => {
        order.push('credential')
        return 'fresh-primary'
      },
    }
    await expect(
      activateOwner(request, {
        fetch: async (_url, options) => {
          order.push('activation')
          expect(options?.signal?.aborted).toBe(false)
          return Response.json({ status: 'completed', user: 'owner' })
        },
      }),
    ).resolves.toEqual({ status: 'completed', user: 'owner' })
    expect(order).toEqual(['credential', 'activation'])
  })

  test('rejects a successful receipt for a different authenticated owner', async () => {
    await expect(
      activateOwner(
        { ...input(), whoami: async () => 'other' },
        {
          fetch: mock<typeof globalThis.fetch>().mockResolvedValue(
            Response.json({ status: 'completed', user: 'owner' }),
          ),
        },
      ),
    ).rejects.toMatchObject({ code: 'OWNER_ACTIVATION_IDENTITY_MISMATCH' })
  })

  test('returns an unknown activation outcome after one request, without an opaque retry', async () => {
    const request = input()
    const fetch = mock<typeof globalThis.fetch>().mockRejectedValue(
      new Error('private transport detail'),
    )
    await expect(activateOwner(request, { fetch })).rejects.toMatchObject({
      code: 'OWNER_ACTIVATION_UNAVAILABLE',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(request.whoami).not.toHaveBeenCalled()
  })

  test('leaves an unavailable activation for the next explicit create invocation', async () => {
    const request = input()
    const fetch = mock<typeof globalThis.fetch>().mockResolvedValue(
      new Response(null, { status: 503 }),
    )
    await expect(activateOwner(request, { fetch })).rejects.toMatchObject({
      code: 'OWNER_ACTIVATION_UNAVAILABLE',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(request.whoami).not.toHaveBeenCalled()
  })

  test('does not substitute a local human for an explicit Admin credential', async () => {
    await expect(
      activateInstance(
        { id: 'instance', slug: 'child', url: 'https://child.example/api', state: 'ready' },
        { creds: 'admin-bearer' },
      ),
    ).rejects.toMatchObject({ code: 'OWNER_ACTIVATION_IDENTITY_REQUIRED' })
  })
})
