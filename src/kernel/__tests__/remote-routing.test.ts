import type { FnMap } from '@astrale-os/kernel-client'
import type { ClientSession } from '@astrale-os/kernel-client/session'

import { describe, expect, test } from 'bun:test'

import { mintDelegationPath } from '../remote-routing'

function unsignedJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url').replace(/=+$/, '')
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`
}

/** A ClientSession stub that records call paths and returns a canned whoami node. */
function stubClient(whoamiNode: unknown): {
  client: ClientSession<FnMap>
  calls: Array<{ path: string }>
} {
  const calls: Array<{ path: string }> = []
  const client = {
    call: async (path: string) => {
      calls.push({ path })
      return whoamiNode
    },
  } as unknown as ClientSession<FnMap>
  return { client, calls }
}

describe('mintDelegationPath — caller self-anchor resolution', () => {
  test('resolves an IdP identity to its NODE id via whoami (not the JWT sub)', async () => {
    // A WorkOS subject is the upstream user id, NOT the kernel node id — `@<sub>`
    // would 404. whoami returns the caller's own identity node; its id is the anchor.
    const { client, calls } = stubClient({ id: 'ef280077-6039-4a1a-9d06-403718d8e112' })
    const credential = unsignedJwt({ sub: 'user_01KC9MW1M6S5J6V9ERSRJ8RDYF' })

    expect(await mintDelegationPath(client, credential)).toBe(
      '@ef280077-6039-4a1a-9d06-403718d8e112::mintDelegationCredential',
    )
    expect(calls).toEqual([{ path: '/:kernel.astrale.ai:interface.Identity:whoami' }])
  })

  test('legacy system subject maps to the __system__ graph node WITHOUT a whoami call', async () => {
    const { client, calls } = stubClient({ id: 'unused' })
    expect(await mintDelegationPath(client, unsignedJwt({ sub: 'system' }))).toBe(
      '@__system__::mintDelegationCredential',
    )
    expect(calls).toEqual([])
  })

  test('opaque non-JWT credential falls back to __system__ (no whoami)', async () => {
    const { client, calls } = stubClient({ id: 'unused' })
    expect(await mintDelegationPath(client, 'not-a-jwt')).toBe(
      '@__system__::mintDelegationCredential',
    )
    expect(calls).toEqual([])
  })

  test('throws when whoami returns no id (cannot address the caller)', async () => {
    const { client } = stubClient({ notAnId: true })
    await expect(mintDelegationPath(client, unsignedJwt({ sub: 'abc' }))).rejects.toThrow(
      /could not resolve the caller identity/i,
    )
  })
})

// `lookupRemoteBinding` (the proactive `<path>::get` resolver) was removed: the
// kernel now carries the worker's `iss` on the redirect and the ClientSession
// follows it reactively, minting via `mintRemoteCredential` (the cache mint
// wired in `kernel/client.ts`). The slug→iss audience derivation it tested now
// lives in the kernel resolver (`runtime/__tests__/resolver-remote.test.ts`).
