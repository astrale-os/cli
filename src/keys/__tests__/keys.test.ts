import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { decodeJwt, decodeProtectedHeader } from 'jose'
import { access, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { IdentityKeyMissingError } from '../../errors'
import {
  generateEd25519Jwk,
  importKeypair,
  keypairPaths,
  listIdentityKeys,
  persistKeypair,
  readKeypair,
  removeKeypair,
  signAs,
} from '../index'

describe('DESIGN — per-identity keys', () => {
  let tmp = ''

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'astrale-keys-test-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  /** @evidence TEST-CLI-KEYS-LEGACY-FILENAMES */
  test('keypairPaths routes manager to legacy filenames', () => {
    const p = keypairPaths('manager', tmp)
    expect(p.privatePath.endsWith('manager.private.jwk')).toBe(true)
    expect(p.publicPath.endsWith('manager.public.jwk')).toBe(true)
  })

  test('keypairPaths routes others to <name>.*.jwk', () => {
    const p = keypairPaths('alice', tmp)
    expect(p.privatePath.endsWith('alice.private.jwk')).toBe(true)
    expect(p.publicPath.endsWith('alice.public.jwk')).toBe(true)
  })

  /** @evidence TEST-CLI-KEYS-PATH-CONFINED */
  test('keypairPaths rejects subjects that escape the selected key directory', () => {
    expect(() => keypairPaths('../alice', tmp)).toThrow(/cannot name a key file/)
    expect(() => keypairPaths('/alice', tmp)).toThrow(/cannot name a key file/)
    expect(() => keypairPaths('', tmp)).toThrow(/cannot name a key file/)
  })

  /** @evidence TEST-CLI-KEYS-PRIVATE-MODE */
  test('persistKeypair writes both files with kid and private mode', async () => {
    const result = await persistKeypair('alice', { keysDir: tmp })
    expect(result.kid).toMatch(/^alice-key-/)
    const { privatePath, publicPath } = keypairPaths('alice', tmp)
    await access(privatePath)
    await access(publicPath)
    expect((await stat(privatePath)).mode & 0o777).toBe(0o600)
    expect((await stat(publicPath)).mode & 0o777).toBe(0o600)
  })

  test('signAs(alice) works when alice has her own key', async () => {
    await persistKeypair('alice', { keysDir: tmp })
    const jwt = await signAs('alice', tmp)
    expect(jwt.split('.').length).toBe(3)
    const claims = decodeJwt(jwt)
    expect(claims.iat).toBeUndefined()
    expect(claims.exp).toBeNumber()
    expect((claims.exp as number) * 1_000).toBeGreaterThan(Date.now() + 299_000)
  })

  /** @evidence TEST-CLI-KEYS-DISTINGUISHES-KERNEL-ROOT-GRANT */
  test('signAs resolves self-issued Kernel root grants and preserves external self grants', async () => {
    await persistKeypair('manager-principal', { keysDir: tmp })
    await persistKeypair('alice', { keysDir: tmp })
    const kernel = 'https://kernel.example/kernel/host'

    const root = decodeJwt(
      await signAs('manager-principal', tmp, {
        issuer: kernel,
        audience: kernel,
      }),
    )
    expect(root).toMatchObject({
      iss: kernel,
      sub: 'manager-principal',
      aud: kernel,
      grant: { v: 1, expr: { kind: 'identity', id: 'manager-principal' } },
    })

    const external = decodeJwt(
      await signAs('alice', tmp, {
        issuer: 'https://identity.example',
        audience: kernel,
      }),
    )
    expect(external).toMatchObject({
      iss: 'https://identity.example',
      sub: 'alice',
      aud: kernel,
      grant: { v: 1, expr: { kind: 'identity', self: true } },
    })
  })

  test('signAs(alice) uses the key file algorithm for EdDSA identities', async () => {
    const { privateJwk, publicJwk } = await generateEd25519Jwk('alice-ed25519')
    const { privatePath, publicPath } = keypairPaths('alice', tmp)
    await writeFile(privatePath, JSON.stringify(privateJwk, null, 2))
    await writeFile(publicPath, JSON.stringify(publicJwk, null, 2))

    const jwt = await signAs('alice', tmp)

    expect(decodeProtectedHeader(jwt).alg).toBe('EdDSA')
  })

  /** @evidence TEST-CLI-KEYS-PAIR-ADMISSION */
  test('import and read prove one matching supported keypair before publication', async () => {
    const alice = await persistKeypair('alice', { keysDir: join(tmp, 'alice-source') })
    const bob = await persistKeypair('bob', { keysDir: join(tmp, 'bob-source') })
    const importedDir = join(tmp, 'imported')

    await expect(
      importKeypair(
        'alice',
        { privateJwk: alice.privateJwk, publicJwk: { ...bob.publicJwk, kid: alice.kid } },
        importedDir,
      ),
    ).rejects.toThrow(/do not form a valid matching pair/)
    await expect(access(keypairPaths('alice', importedDir).privatePath)).rejects.toThrow()

    const imported = await importKeypair(
      'alice',
      { privateJwk: alice.privateJwk, publicJwk: alice.publicJwk },
      importedDir,
    )
    expect(imported.kid).toBe(alice.kid)
    expect((await readKeypair('alice', importedDir)).publicJwk).toEqual(alice.publicJwk)

    await expect(
      importKeypair(
        'unsafe-public',
        { privateJwk: alice.privateJwk, publicJwk: alice.privateJwk },
        importedDir,
      ),
    ).rejects.toThrow(/must not contain private key material/)
  })

  /** @evidence TEST-CLI-KEYS-NO-MANAGER-FALLBACK */
  test('signAs(alice) never falls back to the manager key', async () => {
    await persistKeypair('manager', { keysDir: tmp })
    await expect(signAs('alice', tmp)).rejects.toThrow(IdentityKeyMissingError)
  })

  test('signAs errors when no keys at all', async () => {
    await expect(signAs('manager', tmp)).rejects.toThrow(IdentityKeyMissingError)
  })

  test('removeKeypair is idempotent', async () => {
    await persistKeypair('alice', { keysDir: tmp })
    await removeKeypair('alice', tmp)
    await removeKeypair('alice', tmp)
    const { privatePath } = keypairPaths('alice', tmp)
    await expect(access(privatePath)).rejects.toThrow()
  })

  test('listIdentityKeys returns names with private keys', async () => {
    await persistKeypair('manager', { keysDir: tmp })
    await persistKeypair('alice', { keysDir: tmp })
    await persistKeypair('bob', { keysDir: tmp })
    const names = await listIdentityKeys(tmp)
    expect(names.sort()).toEqual(['alice', 'bob', 'manager'])
  })
})
