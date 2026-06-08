import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

import { deleteIdpSession } from './idp'
import { persistKeypair, removeKeypair } from './keys'
import { log } from './log'
import { IDENTITIES_PATH } from './paths'
import { RegistryModeSchema, validateName, type RegistryMode } from './validation'

export const RegistrationSchema = z.object({
  iss: z.string(),
  sub: z.string(),
  registeredAt: z.string(),
})

export const IdentitySchema = z.object({
  subject: z.string(),
  createdAt: z.string(),
  /** `key` identities sign local JWTs; `idp` identities reuse OAuth/OIDC access tokens. */
  source: z.enum(['key', 'idp']).optional(),
  // `local` = machine-only, `remote` = mirrored via astrale cloud (§2.7).
  mode: RegistryModeSchema.optional(),
  /** JWK thumbprint of the identity keypair. Optional for legacy entries. */
  kid: z.string().optional(),
  /** IdP registry name for source=idp identities. */
  idp: z.string().optional(),
  /** OIDC issuer for source=idp identities. */
  issuer: z.string().url().optional(),
  /** Optional preferred audience used during IdP login/refresh flows. */
  audience: z.string().optional(),
  /** Non-secret claims snapshot from the last successful IdP login. */
  claims: z.record(z.string(), z.unknown()).optional(),
  /**
   * Cache of `(iss, sub)` pairs returned by `Identity::registerIdentity`,
   * keyed by instance slug. Populated by `astrale identity register`; consulted
   * by `resolveCredential` so `--as <name> -i <instance>` signs JWTs the kernel
   * accepts.
   */
  registrations: z.record(z.string(), RegistrationSchema).optional(),
})

export type Registration = z.infer<typeof RegistrationSchema>

export const IdentityStoreSchema = z.object({
  default: z.string(),
  identities: z.record(z.string(), IdentitySchema),
})

export type Identity = z.infer<typeof IdentitySchema>
export type IdentityStore = z.infer<typeof IdentityStoreSchema>

function seed(): IdentityStore {
  return {
    default: 'manager',
    identities: {
      manager: {
        subject: 'manager',
        createdAt: new Date().toISOString(),
        source: 'key',
        mode: 'local',
      },
    },
  }
}

export async function readIdentities(): Promise<IdentityStore> {
  try {
    const raw = await readFile(IDENTITIES_PATH, 'utf-8')
    return IdentityStoreSchema.parse(JSON.parse(raw))
  } catch (e) {
    if (e instanceof z.ZodError) {
      log.warn(`Invalid identities at ${IDENTITIES_PATH} — using defaults`)
    } else if ((e as { code?: string }).code !== 'ENOENT') {
      // Present-but-unreadable file (malformed JSON → SyntaxError, or a
      // non-missing-file read error). ENOENT is the legitimate first-run
      // case and stays silent; anything else would otherwise be discarded
      // and could be overwritten by a later writeIdentities.
      log.warn(`Could not read identities at ${IDENTITIES_PATH} — using defaults`)
    }
    return seed()
  }
}

export async function writeIdentities(store: IdentityStore): Promise<void> {
  await mkdir(dirname(IDENTITIES_PATH), { recursive: true })
  await writeFile(IDENTITIES_PATH, JSON.stringify(store, null, 2) + '\n')
}

export async function createIdentity(
  name: string,
  opts: {
    subject?: string
    mode?: RegistryMode
    issuer?: string
    kid?: string
    skipKeygen?: boolean
  } = {},
): Promise<Identity> {
  validateName(name, 'Identity')
  const store = await readIdentities()
  if (store.identities[name]) {
    throw new Error(`Identity "${name}" already exists`)
  }
  const subject = opts.subject ?? name
  let kid: string | undefined
  if (!opts.skipKeygen) {
    const result = await persistKeypair(subject)
    kid = result.kid
  }
  const identity: Identity = {
    subject,
    createdAt: new Date().toISOString(),
    source: 'key',
    mode: opts.mode ?? 'local',
    kid: opts.kid ?? kid,
    issuer: opts.issuer,
  }
  store.identities[name] = identity
  await writeIdentities(store)
  return identity
}

export async function upsertKeyIdentity(
  name: string,
  opts: {
    subject: string
    mode?: RegistryMode
    issuer?: string
    kid?: string
  },
): Promise<Identity> {
  validateName(name, 'Identity')
  const store = await readIdentities()
  const existing = store.identities[name]
  if (existing && (existing.source ?? 'key') !== 'key') {
    throw new Error(`Identity "${name}" already exists and is IdP-backed`)
  }
  const identity: Identity = {
    subject: opts.subject,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    source: 'key',
    mode: opts.mode ?? existing?.mode ?? 'local',
    kid: opts.kid,
    issuer: opts.issuer,
  }
  store.identities[name] = identity
  await writeIdentities(store)
  return identity
}

export async function deleteIdentity(name: string): Promise<void> {
  const store = await readIdentities()
  const entry = store.identities[name]
  if (!entry) {
    throw new Error(`Identity "${name}" not found`)
  }
  if (store.default === name) {
    throw new Error(
      `Cannot delete the default identity "${name}". Switch default first with: astrale identity use <other>`,
    )
  }
  if ((entry.source ?? 'key') === 'idp') {
    await deleteIdpSession(name)
  } else {
    await removeKeypair(entry.subject)
  }
  delete store.identities[name]
  await writeIdentities(store)
}

export async function setDefault(name: string): Promise<void> {
  const store = await readIdentities()
  if (!store.identities[name]) {
    throw new Error(`Identity "${name}" not found`)
  }
  store.default = name
  await writeIdentities(store)
}

export async function getDefault(): Promise<Identity & { name: string }> {
  const store = await readIdentities()
  const identity = store.identities[store.default]
  if (!identity) {
    throw new Error(
      `Default identity "${store.default}" not found. Run: astrale identity create ${store.default}`,
    )
  }
  return { ...identity, name: store.default }
}

export async function getIdentity(name: string): Promise<Identity> {
  const store = await readIdentities()
  const identity = store.identities[name]
  if (!identity) {
    throw new Error(`Identity "${name}" not found. Run: astrale identity create ${name}`)
  }
  return identity
}

export async function upsertIdpIdentity(
  name: string,
  opts: {
    subject: string
    idp: string
    issuer: string
    audience?: string
    claims?: Record<string, unknown>
    use?: boolean
  },
): Promise<Identity> {
  validateName(name, 'Identity')
  validateName(opts.idp, 'IdP')
  const store = await readIdentities()
  const existing = store.identities[name]
  if (existing && (existing.source ?? 'key') !== 'idp') {
    throw new Error(`Identity "${name}" already exists and is key-backed`)
  }
  const identity: Identity = {
    subject: opts.subject,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    source: 'idp',
    mode: 'remote',
    idp: opts.idp,
    issuer: opts.issuer,
    audience: opts.audience,
    claims: opts.claims,
    registrations: existing?.registrations,
  }
  store.identities[name] = identity
  if (opts.use !== false) store.default = name
  await writeIdentities(store)
  return identity
}

/** Record (or replace) the kernel-derived (iss, sub) pair for an identity on a target instance. */
export async function setRegistration(
  name: string,
  instanceSlug: string,
  registration: Registration,
): Promise<void> {
  const store = await readIdentities()
  const entry = store.identities[name]
  if (!entry) throw new Error(`Identity "${name}" not found`)
  entry.registrations = { ...entry.registrations, [instanceSlug]: registration }
  await writeIdentities(store)
}

/** Migrate an identity to a new registry mode (local ↔ remote, §2.7). */
export async function setIdentityMode(name: string, mode: RegistryMode): Promise<void> {
  const store = await readIdentities()
  const entry = store.identities[name]
  if (!entry) throw new Error(`Identity "${name}" not found`)
  entry.mode = mode
  await writeIdentities(store)
}
