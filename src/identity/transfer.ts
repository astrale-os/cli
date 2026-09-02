import { compactDecrypt, CompactEncrypt, type JWK } from 'jose'
import { z } from 'zod'

import { AstraleError } from '../errors'
import { acceptKeypair, importKeypair, readKeypair, removeKeypair } from '../keys/index'
import { validateName, validateUrl } from '../lib/validation'
import {
  atomicWrite,
  readIdentityStore,
  updateIdentityStore,
  type Identity,
  type IdentityMode,
  type IdentityStoreOptions,
} from '../state/index'

const IDENTITY_EXPORT_VERSION = 1 as const
const JwkSchema = z.record(z.string(), z.unknown())
const IdentityExportFields = {
  subject: z.string().min(1),
  mode: z.enum(['local', 'remote']).optional(),
  kid: z.string().min(1).optional(),
  issuer: z.string().url().optional(),
  privateJwk: JwkSchema,
  publicJwk: JwkSchema,
}
const LegacyIdentityExportSchema = z.object(IdentityExportFields).strict()
const IdentityExportV1Schema = z
  .object({ version: z.literal(IDENTITY_EXPORT_VERSION), ...IdentityExportFields })
  .strict()

export interface IdentityFileOptions {
  readonly state?: IdentityStoreOptions
  readonly keysDir?: string
}

export interface IdentityExport {
  readonly version: 1
  readonly subject: string
  readonly mode: IdentityMode
  readonly kid?: string
  readonly issuer?: string
  readonly privateJwk: JWK
  readonly publicJwk: JWK
}

export interface IdentityImportOptions extends IdentityFileOptions {
  readonly name?: string
  readonly issuer?: string
  readonly replace?: boolean
}

export function isEncryptedIdentityExport(raw: string): boolean {
  const content = raw.trim()
  return !content.startsWith('{') && content.split('.').length === 5
}

export async function decodeIdentityExport(
  raw: string,
  passphrase?: string,
): Promise<IdentityExport> {
  let json = raw
  if (isEncryptedIdentityExport(raw)) {
    if (passphrase === undefined) {
      throw invalidExport('This encrypted identity export requires a passphrase.')
    }
    try {
      const { plaintext } = await compactDecrypt(raw.trim(), new TextEncoder().encode(passphrase), {
        keyManagementAlgorithms: ['PBES2-HS256+A128KW'],
        contentEncryptionAlgorithms: ['A256GCM'],
      })
      json = new TextDecoder().decode(plaintext)
    } catch {
      throw invalidExport('Could not decrypt the identity export.')
    }
  }

  let input: unknown
  try {
    input = JSON.parse(json)
  } catch {
    throw invalidExport('The identity export is not valid JSON.')
  }

  let decoded: z.infer<typeof LegacyIdentityExportSchema>
  try {
    decoded = hasVersion(input)
      ? IdentityExportV1Schema.parse(input)
      : LegacyIdentityExportSchema.parse(input)
  } catch {
    throw invalidExport('The identity export has an invalid or unsupported shape.')
  }

  const pair = await acceptKeypair({
    privateJwk: decoded.privateJwk,
    publicJwk: decoded.publicJwk,
  })
  if (decoded.kid && pair.kid && decoded.kid !== pair.kid) {
    throw invalidExport('The envelope key ID differs from its JWK key ID.')
  }

  return {
    version: IDENTITY_EXPORT_VERSION,
    subject: decoded.subject,
    mode: decoded.mode ?? 'local',
    kid: decoded.kid ?? pair.kid,
    issuer: decoded.issuer,
    privateJwk: pair.privateJwk,
    publicJwk: pair.publicJwk,
  }
}

export async function encodeIdentityExport(
  envelope: IdentityExport,
  passphrase?: string,
): Promise<string> {
  const plaintext = JSON.stringify(envelope, null, 2)
  if (passphrase === undefined) return plaintext
  return new CompactEncrypt(new TextEncoder().encode(plaintext))
    .setProtectedHeader({ alg: 'PBES2-HS256+A128KW', enc: 'A256GCM' })
    .encrypt(new TextEncoder().encode(passphrase))
}

export async function exportIdentity(
  name: string,
  options: IdentityFileOptions = {},
): Promise<IdentityExport> {
  const store = await readIdentityStore(options.state)
  const identity = store.identities[name]
  if (!identity)
    throw new Error(`Identity "${name}" not found. Run: astrale identity create ${name}`)
  if ((identity.source ?? 'key') !== 'key') {
    throw new Error(`Identity "${name}" is IdP-backed and has no transferable local keypair`)
  }
  const pair = await readKeypair(identity.subject, options.keysDir)
  return {
    version: IDENTITY_EXPORT_VERSION,
    subject: identity.subject,
    mode: identity.mode ?? 'local',
    kid: identity.kid ?? pair.kid,
    issuer: identity.issuer,
    privateJwk: pair.privateJwk,
    publicJwk: pair.publicJwk,
  }
}

export async function importIdentity(
  envelope: IdentityExport,
  options: IdentityImportOptions = {},
): Promise<Identity> {
  const name = options.name ?? envelope.subject
  validateName(name, 'Identity')
  if (options.issuer !== undefined) validateUrl(options.issuer)

  const imported = await updateIdentityStore(async (store) => {
    const existing = store.identities[name]
    if (existing && !options.replace) throw new Error(`Identity "${name}" already exists`)
    if (existing && (existing.source ?? 'key') !== 'key') {
      throw new Error(`Identity "${name}" already exists and is IdP-backed`)
    }

    const pair = await importKeypair(envelope.subject, envelope, options.keysDir)
    const identity: Identity = {
      subject: envelope.subject,
      createdAt: existing?.createdAt ?? (options.state?.now?.() ?? new Date()).toISOString(),
      source: 'key',
      mode: envelope.mode,
      kid: envelope.kid ?? pair.kid,
      issuer: options.issuer ?? envelope.issuer,
    }
    return {
      next: { ...store, identities: { ...store.identities, [name]: identity } },
      value: { identity, previousSubject: existing?.subject },
    }
  }, options.state)

  if (
    imported.previousSubject !== undefined &&
    imported.previousSubject !== imported.identity.subject
  ) {
    await removeKeypairIfUnreferenced(imported.previousSubject, options)
  }
  return imported.identity
}

export async function writeIdentityExport(path: string, content: string): Promise<void> {
  await atomicWrite(path, content)
}

function hasVersion(input: unknown): input is { readonly version: unknown } {
  return typeof input === 'object' && input !== null && Object.hasOwn(input, 'version')
}

async function removeKeypairIfUnreferenced(
  subject: string,
  options: IdentityFileOptions,
): Promise<void> {
  await updateIdentityStore(async (store) => {
    const referenced = Object.values(store.identities).some(
      (identity) => (identity.source ?? 'key') === 'key' && identity.subject === subject,
    )
    if (!referenced) await removeKeypair(subject, options.keysDir)
    return { next: store, value: undefined }
  }, options.state)
}

function invalidExport(message: string): AstraleError {
  return new AstraleError('INVALID_IDENTITY_EXPORT', message)
}
