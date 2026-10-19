import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { keypairPaths, persistKeypair, readKeypair } from '../../keys/index'
import { readIdentityStore, updateIdentityStore, type Registration } from '../../state/index'
import {
  decodeIdentityExport,
  encodeIdentityExport,
  exportIdentity,
  importIdentity,
  isEncryptedIdentityExport,
  writeIdentityExport,
  type IdentityExport,
} from '../index'

const KERNEL = 'https://admin.example/api'
const AT: Registration = {
  iss: `${KERNEL}/iss/thumbprint`,
  sub: 'self',
  registeredAt: '2026-10-19T10:00:00.000Z',
}

describe('identity transfer', () => {
  let root = ''
  let statePath = ''
  let keysDir = ''
  const now = () => new Date('2026-08-11T12:00:00.000Z')

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'astrale-identity-transfer-'))
    statePath = join(root, 'identities.json')
    keysDir = join(root, 'keys')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  /** Import options over this test's registry and keys. */
  const into = (options: { name?: string; replace?: true | 'same-issuer' } = {}) => ({
    ...options,
    state: { path: statePath, now },
    keysDir,
  })
  const absent = (subject: string) => access(keypairPaths(subject, keysDir).privatePath)
  const store = async () => (await readIdentityStore({ path: statePath })).identities
  /** Record registrations on an identity of this test's registry, as `identity register` does. */
  const register = (name: string, registrations: Record<string, Registration>) =>
    updateIdentityStore(
      (current) => ({
        next: {
          ...current,
          identities: {
            ...current.identities,
            [name]: { ...current.identities[name]!, registrations },
          },
        },
        value: undefined,
      }),
      { path: statePath, now },
    )

  async function envelope(subject: string, suffix: string): Promise<IdentityExport> {
    const pair = await persistKeypair(subject, {
      keysDir: join(root, `source-${suffix}`),
      kid: `${subject}-${suffix}`,
    })
    return decodeIdentityExport(
      JSON.stringify({
        version: 1,
        subject,
        mode: 'local',
        kid: pair.kid,
        issuer: 'https://identity.example',
        privateJwk: pair.privateJwk,
        publicJwk: pair.publicJwk,
      }),
    )
  }

  /** @evidence TEST-CLI-IDENTITY-TRANSFER-REJECTS */
  test('rejects malformed, newer, and mismatched content before durable mutation', async () => {
    await expect(decodeIdentityExport('{')).rejects.toThrow(/not valid JSON/)
    const newer = { version: 3, subject: 'alice', mode: 'local', privateJwk: {}, publicJwk: {} }
    await expect(decodeIdentityExport(JSON.stringify(newer))).rejects.toThrow(
      /invalid or unsupported shape/,
    )
    const registered = { ...(await envelope('carol', 'shape')), registrations: { [KERNEL]: AT } }
    const { registrations: _, ...unregistered } = registered
    const v1WithRegistrations = { ...registered, version: 1 }
    const { sub: _sub, ...incomplete } = AT
    for (const shape of [
      unregistered,
      v1WithRegistrations,
      { ...registered, registrations: { [KERNEL]: incomplete } },
      { ...registered, registrations: { [KERNEL]: { ...AT, sub: '' } } },
      { ...registered, registrations: { [KERNEL]: { ...AT, node: 'extra' } } },
      { ...registered, registrations: { '': AT } },
    ]) {
      await expect(decodeIdentityExport(JSON.stringify(shape))).rejects.toThrow(
        /invalid or unsupported shape/,
      )
    }

    const alice = await envelope('alice', 'a')
    const bob = await envelope('bob', 'b')
    const forged = { ...alice, publicJwk: { ...bob.publicJwk, kid: alice.kid } } as IdentityExport
    const mismatch = (await importIdentity(forged, into()).catch((error) => error)) as Error
    expect(mismatch.message).toMatch(/do not form a valid matching pair/)
    expect(mismatch.message).not.toContain(String(alice.privateJwk.d))

    await expect(access(statePath)).rejects.toThrow()
    await expect(absent('alice')).rejects.toThrow()
  })

  /** @evidence TEST-CLI-IDENTITY-TRANSFER-ROUNDTRIP */
  test('roundtrips V2 plaintext and encrypted representations, reads V1, and refuses unversioned exports', async () => {
    const current = await envelope('alice', 'roundtrip')
    expect(current).toMatchObject({ version: 2, registrations: {} })
    const { version: _, ...unversioned } = current
    await expect(decodeIdentityExport(JSON.stringify(unversioned))).rejects.toThrow(
      /invalid or unsupported shape/,
    )

    const { alg: _privateAlg, ...privateJwk } = current.privateJwk
    const { alg: _publicAlg, ...publicJwk } = current.publicJwk
    const withoutAlg = { ...current, privateJwk, publicJwk }
    expect(await decodeIdentityExport(JSON.stringify(withoutAlg))).toEqual(withoutAlg)

    const plaintext = await encodeIdentityExport(current)
    expect(isEncryptedIdentityExport(plaintext)).toBe(false)
    expect(await decodeIdentityExport(plaintext)).toEqual(current)

    const encrypted = await encodeIdentityExport(current, 'correct-horse-battery')
    expect(isEncryptedIdentityExport(encrypted)).toBe(true)
    expect(await decodeIdentityExport(encrypted, 'correct-horse-battery')).toEqual(current)
    await expect(decodeIdentityExport(encrypted, 'wrong')).rejects.toThrow(/Could not decrypt/)
  })

  /** @evidence TEST-CLI-IDENTITY-IMPORT-ORDERED */
  test('checks conflicts before key replacement and publishes registry after keys', async () => {
    const first = await envelope('alice', 'first')
    const imported = await importIdentity(first, into({ name: 'operator' }))
    expect(imported.subject).toBe('alice')
    expect((await readKeypair('alice', keysDir)).kid).toBe(first.kid)
    expect((await store()).operator).toEqual(imported)

    const privatePath = keypairPaths('alice', keysDir).privatePath
    const originalPrivate = await readFile(privatePath, 'utf-8')
    const replacement = await envelope('alice', 'replacement')
    await expect(importIdentity(replacement, into({ name: 'operator' }))).rejects.toThrow(
      'already exists',
    )
    expect(await readFile(privatePath, 'utf-8')).toBe(originalPrivate)

    const nextSubject = await envelope('replacement-subject', 'replacement-subject')
    await importIdentity(nextSubject, into({ name: 'operator', replace: true }))
    await expect(access(privatePath)).rejects.toThrow()
    expect((await readKeypair('replacement-subject', keysDir)).kid).toBe(nextSubject.kid)

    const remote = {
      subject: 'remote-user',
      createdAt: now().toISOString(),
      source: 'idp',
      mode: 'remote',
      idp: 'workos',
      issuer: 'https://idp.example',
    } as const
    await updateIdentityStore(
      (current) => ({
        next: { ...current, identities: { ...current.identities, remote } },
        value: undefined,
      }),
      { path: statePath, now },
    )
    await expect(
      importIdentity(
        await envelope('remote-user', 'remote'),
        into({ name: 'remote', replace: true }),
      ),
    ).rejects.toThrow(/IdP-backed/)
    await expect(absent('remote-user')).rejects.toThrow()
  })

  test.each(['https://other.example/api', undefined])(
    'same-issuer recovery preserves the registry and key when the existing issuer differs or is unknown (%s)',
    async (issuer) => {
      const original = await envelope('original-root', 'old-issuer')
      await importIdentity({ ...original, issuer }, into({ name: 'prod-root' }))
      const registryBefore = await readFile(statePath, 'utf8')
      const originalPath = keypairPaths(original.subject, keysDir).privatePath
      const keyBefore = await readFile(originalPath, 'utf8')
      await expect(
        importIdentity(
          await envelope('new-root', 'new-issuer'),
          into({ name: 'prod-root', replace: 'same-issuer' }),
        ),
      ).rejects.toMatchObject({ code: 'IDENTITY_ISSUER_CONFLICT' })
      expect(await readFile(statePath, 'utf8')).toBe(registryBefore)
      expect(await readFile(originalPath, 'utf8')).toBe(keyBefore)
      await expect(absent('new-root')).rejects.toThrow()
    },
  )

  test('same-issuer recovery replaces the same owner key but treats trailing-slash claims as distinct', async () => {
    const original = await envelope('original-root', 'same-issuer')
    const replacement = await envelope('new-root', 'same-issuer')
    const issuer = 'https://identity.example/api'
    await importIdentity({ ...original, issuer }, into({ name: 'prod-root' }))
    for (const other of [`${issuer}/`, 'https://identity.example/a/../api', undefined]) {
      await expect(
        importIdentity(
          { ...replacement, issuer: other },
          into({ name: 'prod-root', replace: 'same-issuer' }),
        ),
      ).rejects.toMatchObject({ code: 'IDENTITY_ISSUER_CONFLICT' })
      expect((await readKeypair(original.subject, keysDir)).kid).toBe(original.kid)
    }
    await importIdentity(
      { ...replacement, issuer },
      into({ name: 'prod-root', replace: 'same-issuer' }),
    )
    expect((await store())['prod-root'].subject).toBe('new-root')
    expect((await readKeypair('new-root', keysDir)).kid).toBe(replacement.kid)
    await expect(absent(original.subject)).rejects.toThrow()
  })

  test('same-issuer admission uses the state committed under the identity lock', async () => {
    const original = await envelope('original-root', 'concurrent')
    const replacement = await envelope('new-root', 'concurrent')
    await importIdentity(original, into({ name: 'prod-root' }))
    let pending: Promise<unknown> | undefined
    await updateIdentityStore(
      (current) => {
        pending = importIdentity(replacement, into({ name: 'prod-root', replace: 'same-issuer' }))
        const moved = { ...current.identities['prod-root']!, issuer: 'https://other.example/api' }
        return {
          next: { ...current, identities: { ...current.identities, 'prod-root': moved } },
          value: undefined,
        }
      },
      { path: statePath, now },
    )
    await expect(pending).rejects.toMatchObject({ code: 'IDENTITY_ISSUER_CONFLICT' })
    expect((await readKeypair(original.subject, keysDir)).kid).toBe(original.kid)
    await expect(absent(replacement.subject)).rejects.toThrow()
  })

  /** @evidence TEST-CLI-IDENTITY-TRANSFER-REGISTRATIONS */
  test('carries every Kernel registration through plaintext and encrypted exports, and restores it exactly', async () => {
    const registrations = {
      [KERNEL]: AT,
      'https://other.example/api': {
        iss: 'https://other.example/api/iss/thumbprint',
        sub: 'self',
        registeredAt: '2026-10-19T11:00:00.000Z',
      },
    }
    await importIdentity(await envelope('alice', 'registered'), into({ name: 'ci' }))
    await register('ci', registrations)
    const source = (await store()).ci!

    const exported = await exportIdentity('ci', into())
    expect(exported.registrations).toEqual(registrations)
    const plaintext = await encodeIdentityExport(exported)
    expect(JSON.parse(plaintext)).toMatchObject({ version: 2, registrations })
    const encrypted = await encodeIdentityExport(exported, 'correct-horse-battery')

    for (const [suffix, content, passphrase] of [
      ['plaintext', plaintext, undefined],
      ['encrypted', encrypted, 'correct-horse-battery'],
    ] as const) {
      const target = join(root, `target-${suffix}`)
      const imported = await importIdentity(await decodeIdentityExport(content, passphrase), {
        name: 'ci',
        state: { path: join(target, 'identities.json'), now },
        keysDir: join(target, 'keys'),
      })
      expect(imported).toEqual({ ...source, createdAt: now().toISOString() })
      const restored = await readIdentityStore({ path: join(target, 'identities.json') })
      expect(restored.identities.ci?.registrations).toEqual(registrations)
    }

    // A V1 envelope carries no registrations, so its import records none.
    const { registrations: _, ...v1 } = exported
    const imported = await importIdentity(
      await decodeIdentityExport(JSON.stringify({ ...v1, version: 1 })),
      into({ name: 'from-v1' }),
    )
    expect(imported.registrations).toBeUndefined()
    expect(Object.hasOwn((await store())['from-v1']!, 'registrations')).toBe(false)

    // Export writes only what import admits.
    await register('ci', { [KERNEL]: { ...AT, sub: '' } })
    await expect(exportIdentity('ci', into())).rejects.toMatchObject({
      code: 'INVALID_IDENTITY_EXPORT',
    })
  })

  /** @evidence TEST-CLI-IDENTITY-EXPORT-PRIVATE */
  test('exports a proven pair through one atomic mode-0600 file', async () => {
    await importIdentity(await envelope('alice', 'export'), into())
    const exported = await exportIdentity('alice', into())
    const path = join(root, 'alice.identity.json')
    await writeIdentityExport(path, await encodeIdentityExport(exported))

    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await decodeIdentityExport(await readFile(path, 'utf-8'))).toEqual(exported)
    expect((await readdir(root)).some((entry) => entry.endsWith('.tmp'))).toBe(false)
  })
})
