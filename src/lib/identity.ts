import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

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
  // `local` = machine-only, `remote` = mirrored via astrale cloud (§2.7).
  mode: RegistryModeSchema.optional(),
  /** JWK thumbprint of the identity keypair. Optional for legacy entries. */
  kid: z.string().optional(),
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
      manager: { subject: 'manager', createdAt: new Date().toISOString(), mode: 'local' },
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
  opts: { subject?: string; mode?: RegistryMode; skipKeygen?: boolean } = {},
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
    mode: opts.mode ?? 'local',
    kid,
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
  await removeKeypair(entry.subject)
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
