import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { decodeJwt, decodeProtectedHeader, exportJWK, generateKeyPair } from 'jose'
import { access, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { IdentityKeyMissingError } from '../../errors'
import { inferAlg } from '../algorithm'
import {
  importKeypair,
  keypairPaths,
  persistKeypair,
  readKeypair,
  removeKeypair,
  signAs,
} from '../index'

const ISSUER = { issuer: 'https://identity.example' }

describe('per-identity keys', () => {
  let tmp = ''

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'astrale-keys-test-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  /** @evidence TEST-CLI-KEYS-SUBJECT-FILENAMES */
  /** @evidence TEST-CLI-KEYS-PATH-CONFINED */
  test('names every subject <subject>.*.jwk inside the selected key directory only', () => {
    for (const subject of ['manager', 'alice']) {
      expect(keypairPaths(subject, tmp)).toEqual({
        privatePath: join(tmp, `${subject}.private.jwk`),
        publicPath: join(tmp, `${subject}.public.jwk`),
      })
    }
    for (const subject of ['../alice', '/alice', '']) {
      expect(() => keypairPaths(subject, tmp)).toThrow(/cannot name a key file/)
    }
  })

  /** @evidence TEST-CLI-KEYS-PRIVATE-MODE */
  test('persists both files with a kid and private mode, then signs a bounded credential', async () => {
    const result = await persistKeypair('alice', { keysDir: tmp })
    expect(result.kid).toMatch(/^alice-key-/)
    for (const path of Object.values(keypairPaths('alice', tmp))) {
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    }
    const before = Math.floor(Date.now() / 1000)
    const claims = decodeJwt(await signAs('alice', tmp, ISSUER))
    expect(claims.iat).toBeUndefined()
    expect(claims.exp).toBeGreaterThanOrEqual(before + 3_600)
    expect(claims.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1_000) + 3_600)
    await expect(signAs('alice', tmp, { issuer: '' })).rejects.toThrow('requires its issuer')

    await removeKeypair('alice', tmp)
    await removeKeypair('alice', tmp)
    await expect(access(keypairPaths('alice', tmp).privatePath)).rejects.toThrow()
  })

  /** @evidence TEST-CLI-KEYS-NO-MANAGER-FALLBACK */
  test('a subject without its own key never signs with the manager key', async () => {
    await expect(signAs('manager', tmp, ISSUER)).rejects.toThrow(IdentityKeyMissingError)
    await persistKeypair('manager', { keysDir: tmp })
    await expect(signAs('alice', tmp, ISSUER)).rejects.toThrow(IdentityKeyMissingError)
  })

  /** @evidence TEST-CLI-KEYS-DISTINGUISHES-KERNEL-ROOT-GRANT */
  test('signAs resolves self-issued Kernel root grants and preserves external self grants', async () => {
    await persistKeypair('manager-principal', { keysDir: tmp })
    await persistKeypair('alice', { keysDir: tmp })
    const kernel = 'https://kernel.example/kernel/host'

    const root = decodeJwt(
      await signAs('manager-principal', tmp, { issuer: kernel, audience: kernel }),
    )
    expect(root).toMatchObject({
      iss: kernel,
      sub: 'manager-principal',
      aud: kernel,
      grant: { v: 1, expr: { kind: 'identity', id: 'manager-principal' } },
    })

    const external = decodeJwt(await signAs('alice', tmp, { ...ISSUER, audience: kernel }))
    expect(external).toMatchObject({
      iss: ISSUER.issuer,
      sub: 'alice',
      aud: kernel,
      grant: { v: 1, expr: { kind: 'identity', self: true } },
    })
  })

  /** @evidence TEST-CLI-KEYS-INFERS-JWK-ALGORITHM */
  test('signs with the algorithm the JWK names, or its key type and curve when alg is absent', async () => {
    const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true })
    const { privatePath, publicPath } = keypairPaths('alice', tmp)
    await writeFile(privatePath, JSON.stringify(await exportJWK(pair.privateKey)))
    await writeFile(publicPath, JSON.stringify(await exportJWK(pair.publicKey)))
    expect(decodeProtectedHeader(await signAs('alice', tmp, ISSUER)).alg).toBe('EdDSA')

    expect(inferAlg({ alg: 'ES256', kty: 'OKP', crv: 'Ed25519' })).toBe('ES256')
    expect(inferAlg({ alg: '', kty: 'EC', crv: 'P-256' })).toBe('ES256')
    for (const jwk of [{}, { kty: 'EC' }, { kty: 'EC', crv: 'P-384' }]) {
      expect(() => inferAlg(jwk, '/path/to/broken.jwk')).toThrow(/\/path\/to\/broken\.jwk/)
    }
    expect(() => inferAlg({ alg: 'HS256', kty: 'oct' })).toThrow(/unsupported signing algorithm/)
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
})
