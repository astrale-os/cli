import type { FnMap } from '@astrale-os/kernel-client'
import type { ClientSession } from '@astrale-os/kernel-client/session'

import { K } from '@astrale-os/kernel-core'
import { describe, expect, test } from 'bun:test'

import { lookupRemoteBinding, mintDelegationPath } from '../remote-routing'

/** A ClientSession stub whose `<path>::get` returns a node with the given props. */
function nodeStubClient(props: Record<string, unknown>): ClientSession<FnMap> {
  return {
    call: async (path: string) => (path.endsWith('::get') ? { props } : null),
  } as unknown as ClientSession<FnMap>
}

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

describe('lookupRemoteBinding — audience derivation', () => {
  const PATH = '/crm.astrale.ai/class.NoteOps/createNote'

  test('audience = the node iss (its identity), decoupled from the path slug', async () => {
    // The node is addressed under `crm.astrale.ai` but its identity (iss) is a
    // different serving URL — the audience must be the iss, not the slug.
    // `Function` is a homonym (class + interface); its props are reached via `K.$.i('Function')`.
    const client = nodeStubClient({
      [K.$.i('Function').binding.key]: JSON.stringify({ remoteUrl: 'https://worker.example' }),
      [K.Identity.iss.key]: 'https://crm.test.com',
    })
    const binding = await lookupRemoteBinding(client, PATH, 'cred')
    expect(binding?.audience).toBe('https://crm.test.com')
    expect(binding?.remoteUrl).toBe('https://worker.example')
  })

  test('throws when a remote-bound node carries no iss identity', async () => {
    const client = nodeStubClient({
      [K.$.i('Function').binding.key]: JSON.stringify({ remoteUrl: 'https://worker.example' }),
    })
    await expect(lookupRemoteBinding(client, PATH, 'cred')).rejects.toThrow(/no iss identity/i)
  })

  test('returns null when the node has no remote binding', async () => {
    const client = nodeStubClient({ [K.Identity.iss.key]: 'https://crm.test.com' })
    expect(await lookupRemoteBinding(client, PATH, 'cred')).toBeNull()
  })
})
