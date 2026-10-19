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
  type Registration,
} from '../state/index'

/** The version export writes. Import also admits V1, which carries no Kernel registrations. */
const IDENTITY_EXPORT_VERSION = 2 as const
const JwkSchema = z.record(z.string(), z.unknown())
const RegistrationSchema = z
  .object({ iss: z.string().min(1), sub: z.string().min(1), registeredAt: z.string().min(1) })
  .strict()
const KeyIdentityFields = {
  subject: z.string().min(1),
  mode: z.enum(['local', 'remote']).optional(),
  kid: z.string().min(1).optional(),
  issuer: z.string().url().optional(),
  privateJwk: JwkSchema,
  publicJwk: JwkSchema,
}
/** A key identity without its registrations: earlier exports and Host bootstrap roots. */
const IdentityExportV1Schema = z.object({ version: z.literal(1), ...KeyIdentityFields }).strict()
/** A key identity with every Kernel registration it holds, keyed by that Kernel's issuer. */
const IdentityExportV2Schema = z
  .object({
    version: z.literal(IDENTITY_EXPORT_VERSION),
    ...KeyIdentityFields,
    registrations: z.record(z.string().min(1), RegistrationSchema),
  })
  .strict()
const IdentityExportSchema = z.discriminatedUnion('version', [
  IdentityExportV1Schema,
  IdentityExportV2Schema,
])

export interface IdentityFileOptions {
  readonly state?: IdentityStoreOptions
  readonly keysDir?: string
}

/** The admitted envelope: V2, or a V1 envelope read as V2 with no registrations. */
export interface IdentityExport {
  readonly version: 2
  readonly subject: string
  readonly mode: IdentityMode
  readonly kid?: string
  readonly issuer?: string
  /** The `(iss, sub)` each Kernel registered for this key, keyed by that Kernel's issuer. */
  readonly registrations: Readonly<Record<string, Registration>>
  readonly privateJwk: JWK
  readonly publicJwk: JWK
}

export interface IdentityImportOptions extends IdentityFileOptions {
  readonly name?: string
  readonly issuer?: string
  /** Automatic recovery may replace only the same exact issuer claim. */
  readonly replace?: boolean | 'same-issuer'
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

  let decoded: z.infer<typeof IdentityExportSchema>
  try {
    decoded = IdentityExportSchema.parse(input)
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
    registrations: decoded.version === 1 ? {} : decoded.registrations,
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
  const identity = Object.hasOwn(store.identities, name) ? store.identities[name] : undefined
  if (!identity)
    throw new Error(`Identity "${name}" not found. Run: astrale identity create ${name}`)
  if (identity.source === 'idp') {
    throw new Error(`Identity "${name}" is IdP-backed and has no transferable local keypair`)
  }
  const pair = await readKeypair(identity.subject, options.keysDir)
  const envelope: IdentityExport = {
    version: IDENTITY_EXPORT_VERSION,
    subject: identity.subject,
    mode: identity.mode ?? 'local',
    kid: identity.kid ?? pair.kid,
    issuer: identity.issuer,
    registrations: identity.registrations ?? {},
    privateJwk: pair.privateJwk,
    publicJwk: pair.publicJwk,
  }
  // Export writes only what import admits, so a written export always restores this identity.
  if (!IdentityExportV2Schema.safeParse(envelope).success) {
    throw invalidExport(`Identity "${name}" has registry metadata that an export cannot carry.`)
  }
  return envelope
}

export async function importIdentity(
  envelope: IdentityExport,
  options: IdentityImportOptions = {},
): Promise<Identity> {
  const name = options.name ?? envelope.subject
  validateName(name, 'Identity')
  if (options.issuer !== undefined) validateUrl(options.issuer)

  const imported = await updateIdentityStore(async (store) => {
    const existing = Object.hasOwn(store.identities, name) ? store.identities[name] : undefined
    if (existing && !options.replace) throw new Error(`Identity "${name}" already exists`)
    const issuer = options.issuer ?? envelope.issuer
    if (
      existing &&
      options.replace === 'same-issuer' &&
      (existing.issuer === undefined || issuer === undefined || existing.issuer !== issuer)
    ) {
      throw new AstraleError(
        'IDENTITY_ISSUER_CONFLICT',
        `Identity "${name}" belongs to another Kernel issuer. Its identity and keys were preserved.`,
        'Choose explicitly which root identity to recover with `astrale instance root import <instance>`.',
      )
    }
    if (existing && existing.source === 'idp') {
      throw new Error(`Identity "${name}" already exists and is IdP-backed`)
    }

    const pair = await importKeypair(envelope.subject, envelope, options.keysDir)
    const identity: Identity = {
      subject: envelope.subject,
      createdAt: existing?.createdAt ?? (options.state?.now?.() ?? new Date()).toISOString(),
      source: 'key',
      mode: envelope.mode,
      kid: envelope.kid ?? pair.kid,
      issuer,
      registrations:
        Object.keys(envelope.registrations).length === 0
          ? undefined
          : { ...envelope.registrations },
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

async function removeKeypairIfUnreferenced(
  subject: string,
  options: IdentityFileOptions,
): Promise<void> {
  await updateIdentityStore(async (store) => {
    const referenced = Object.values(store.identities).some(
      (identity) => identity.source !== 'idp' && identity.subject === subject,
    )
    if (!referenced) await removeKeypair(subject, options.keysDir)
    return { next: store, value: undefined }
  }, options.state)
}

function invalidExport(message: string): AstraleError {
  return new AstraleError('INVALID_IDENTITY_EXPORT', message)
}
