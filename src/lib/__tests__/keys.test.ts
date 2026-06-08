import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { CompactEncrypt, compactDecrypt, decodeProtectedHeader } from 'jose'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { IdentityKeyMissingError } from '../../errors'
import {
  generateEd25519Jwk,
  keypairPaths,
  listIdentityKeys,
  persistKeypair,
  removeKeypair,
  signAs,
} from '../keys'

describe('DESIGN — per-identity keys', () => {
  let tmp = ''
  const savedStrict = process.env.ASTRALE_STRICT_IDENTITIES

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'astrale-keys-test-'))
    delete process.env.ASTRALE_STRICT_IDENTITIES
  })

  afterEach(async () => {
    if (savedStrict) process.env.ASTRALE_STRICT_IDENTITIES = savedStrict
    else delete process.env.ASTRALE_STRICT_IDENTITIES
    await rm(tmp, { recursive: true, force: true })
  })

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

  test('persistKeypair writes both files with kid', async () => {
    const result = await persistKeypair('alice', { keysDir: tmp })
    expect(result.kid).toMatch(/^alice-key-/)
    const { privatePath, publicPath } = keypairPaths('alice', tmp)
    await access(privatePath)
    await access(publicPath)
  })

  test('signAs(alice) works when alice has her own key', async () => {
    await persistKeypair('alice', { keysDir: tmp })
    const jwt = await signAs('alice', tmp)
    expect(jwt.split('.').length).toBe(3)
  })

  test('signAs(alice) uses the key file algorithm for EdDSA identities', async () => {
    const { privateJwk, publicJwk } = await generateEd25519Jwk('alice-ed25519')
    const { privatePath, publicPath } = keypairPaths('alice', tmp)
    await writeFile(privatePath, JSON.stringify(privateJwk, null, 2))
    await writeFile(publicPath, JSON.stringify(publicJwk, null, 2))

    const jwt = await signAs('alice', tmp)

    expect(decodeProtectedHeader(jwt).alg).toBe('EdDSA')
  })

  test('signAs(alice) falls back to manager key with warning', async () => {
    await persistKeypair('manager', { keysDir: tmp })
    const jwt = await signAs('alice', tmp)
    expect(jwt.split('.').length).toBe(3)
  })

  test('signAs(alice) errors when strict mode and no alice key', async () => {
    await persistKeypair('manager', { keysDir: tmp })
    process.env.ASTRALE_STRICT_IDENTITIES = '1'
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

  test('encrypted export envelope round-trip (JWE PBES2)', async () => {
    await persistKeypair('alice', { keysDir: tmp })
    const plain = JSON.stringify({ subject: 'alice', secret: 'x' })
    const passphrase = 'correct-horse-battery'
    const enc = await new CompactEncrypt(new TextEncoder().encode(plain))
      .setProtectedHeader({ alg: 'PBES2-HS256+A128KW', enc: 'A256GCM' })
      .encrypt(new TextEncoder().encode(passphrase))

    expect(enc.split('.').length).toBe(5)

    const { plaintext } = await compactDecrypt(enc, new TextEncoder().encode(passphrase), {
      keyManagementAlgorithms: ['PBES2-HS256+A128KW'],
    })
    expect(new TextDecoder().decode(plaintext)).toBe(plain)
  })

  test('encrypted export fails with wrong passphrase', async () => {
    const plain = JSON.stringify({ subject: 'alice' })
    const enc = await new CompactEncrypt(new TextEncoder().encode(plain))
      .setProtectedHeader({ alg: 'PBES2-HS256+A128KW', enc: 'A256GCM' })
      .encrypt(new TextEncoder().encode('correct'))

    await expect(
      compactDecrypt(enc, new TextEncoder().encode('wrong'), {
        keyManagementAlgorithms: ['PBES2-HS256+A128KW'],
      }),
    ).rejects.toThrow()
  })
})
