import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
    await expect(
      decodeIdentityExport(
        JSON.stringify({
          version: 2,
          subject: 'alice',
          mode: 'local',
          privateJwk: {},
          publicJwk: {},
        }),
      ),
    ).rejects.toThrow(/invalid or unsupported shape/)

    const alice = await envelope('alice', 'a')
    const bob = await envelope('bob', 'b')
    const forged = {
      ...alice,
      publicJwk: { ...bob.publicJwk, kid: alice.kid },
    } as IdentityExport
    const mismatch = await importIdentity(forged, {
      state: { path: statePath, now },
      keysDir,
    }).catch((error) => error)
    expect(mismatch).toBeInstanceOf(Error)
    expect((mismatch as Error).message).toMatch(/do not form a valid matching pair/)
    expect((mismatch as Error).message).not.toContain(String(alice.privateJwk.d))

    await expect(access(statePath)).rejects.toThrow()
    await expect(access(keypairPaths('alice', keysDir).privatePath)).rejects.toThrow()
  })

  /** @evidence TEST-CLI-IDENTITY-TRANSFER-ROUNDTRIP */
  test('converges legacy, V1, and encrypted representations on one envelope', async () => {
    const current = await envelope('alice', 'roundtrip')
    const { version: _, ...legacy } = current
    expect(await decodeIdentityExport(JSON.stringify(legacy))).toEqual(current)

    const plaintext = await encodeIdentityExport(current)
    expect(isEncryptedIdentityExport(plaintext)).toBe(false)
    expect(await decodeIdentityExport(plaintext)).toEqual(current)

    const encrypted = await encodeIdentityExport(current, 'correct-horse-battery')
    expect(isEncryptedIdentityExport(encrypted)).toBe(true)
    expect(await decodeIdentityExport(encrypted, 'correct-horse-battery')).toEqual(current)
    await expect(decodeIdentityExport(encrypted, 'wrong')).rejects.toThrow(/Could not decrypt/)
  })

  /** @evidence TEST-CLI-IDENTITY-TRANSFER-SCHEMA */
  test('keeps the portable V1 JSON Schema aligned with the admitted Host envelope', async () => {
    const schemaPath = fileURLToPath(
      new URL('../.spec/schemas/identity-export-v1.schema.json', import.meta.url),
    )
    const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as {
      readonly $id: string
      readonly additionalProperties: boolean
      readonly required: readonly string[]
      readonly properties: Readonly<Record<string, unknown>>
    }
    const hostEnvelope = await envelope('manager-principal', 'host-bootstrap')

    expect(schema.$id).toBe('https://schemas.astrale.ai/cli/identity-export/1')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(['version', 'subject', 'privateJwk', 'publicJwk'])
    expect(Object.keys(schema.properties).sort()).toEqual(
      ['issuer', 'kid', 'mode', 'privateJwk', 'publicJwk', 'subject', 'version'].sort(),
    )
    await expect(decodeIdentityExport(JSON.stringify(hostEnvelope))).resolves.toEqual(hostEnvelope)
  })

  /** @evidence TEST-CLI-IDENTITY-IMPORT-ORDERED */
  test('checks conflicts before key replacement and publishes registry after keys', async () => {
    const first = await envelope('alice', 'first')
    const imported = await importIdentity(first, {
      name: 'operator',
      state: { path: statePath, now },
      keysDir,
    })
    expect(imported.subject).toBe('alice')
    expect((await readKeypair('alice', keysDir)).kid).toBe(first.kid)
    expect((await readIdentityStore({ path: statePath })).identities.operator).toEqual(imported)

    const privatePath = keypairPaths('alice', keysDir).privatePath
    const originalPrivate = await readFile(privatePath, 'utf-8')
    const replacement = await envelope('alice', 'replacement')
    await expect(
      importIdentity(replacement, {
        name: 'operator',
        state: { path: statePath, now },
        keysDir,
      }),
    ).rejects.toThrow('already exists')
    expect(await readFile(privatePath, 'utf-8')).toBe(originalPrivate)

    await updateIdentityStore(
      (store) => ({
        next: {
          ...store,
          identities: {
            ...store.identities,
            remote: {
              subject: 'remote-user',
              createdAt: now().toISOString(),
              source: 'idp',
              mode: 'remote',
              idp: 'workos',
              issuer: 'https://idp.example',
            },
          },
        },
        value: undefined,
      }),
      { path: statePath, now },
    )
    await expect(
      importIdentity(await envelope('remote-user', 'remote'), {
        name: 'remote',
        replace: true,
        state: { path: statePath, now },
        keysDir,
      }),
    ).rejects.toThrow(/IdP-backed/)
    await expect(access(keypairPaths('remote-user', keysDir).privatePath)).rejects.toThrow()
  })

  /** @evidence TEST-CLI-IDENTITY-EXPORT-PRIVATE */
  test('exports a proven pair through one atomic mode-0600 file', async () => {
    await importIdentity(await envelope('alice', 'export'), {
      state: { path: statePath, now },
      keysDir,
    })
    const exported = await exportIdentity('alice', {
      state: { path: statePath, now },
      keysDir,
    })
    const path = join(root, 'alice.identity.json')
    await writeIdentityExport(path, await encodeIdentityExport(exported))

    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await decodeIdentityExport(await readFile(path, 'utf-8'))).toEqual(exported)
    expect((await readdir(root)).some((entry) => entry.endsWith('.tmp'))).toBe(false)
  })
})
