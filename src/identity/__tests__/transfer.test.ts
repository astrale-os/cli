import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { keypairPaths, persistKeypair, readKeypair } from '../../keys/index'
import { readIdentityStore, updateIdentityStore } from '../../state/index'
import {
  decodeIdentityExport,
  encodeIdentityExport,
  exportIdentity,
  importIdentity,
  isEncryptedIdentityExport,
  writeIdentityExport,
  type IdentityExport,
} from '../index'

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
    const newer = { version: 2, subject: 'alice', mode: 'local', privateJwk: {}, publicJwk: {} }
    await expect(decodeIdentityExport(JSON.stringify(newer))).rejects.toThrow(
      /invalid or unsupported shape/,
    )

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
  test('roundtrips V1 plaintext and encrypted representations, and refuses unversioned exports', async () => {
    const current = await envelope('alice', 'roundtrip')
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
