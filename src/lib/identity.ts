import { persistKeypair, removeKeypair } from '../keys/index'
import {
  readIdentityStore,
  updateIdentityStore,
  type Identity,
  type IdentityStore,
  type Registration,
} from '../state/index'
import { deleteIdpSession } from './idp'
import { validateName, type RegistryMode } from './validation'

export type { Identity, IdentityStore, Registration } from '../state/index'

export async function readIdentities(): Promise<IdentityStore> {
  return readIdentityStore()
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
  return updateIdentityStore(async (store) => {
    if (store.identities[name]) {
      throw new Error(`Identity "${name}" already exists`)
    }
    const subject = opts.subject ?? name
    const generated = opts.skipKeygen ? undefined : await persistKeypair(subject)
    const identity: Identity = {
      subject,
      createdAt: new Date().toISOString(),
      source: 'key',
      mode: opts.mode ?? 'local',
      kid: opts.kid ?? generated?.kid,
      issuer: opts.issuer,
    }
    return {
      next: { ...store, identities: { ...store.identities, [name]: identity } },
      value: identity,
    }
  })
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
  return updateIdentityStore((store) => {
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
    return {
      next: { ...store, identities: { ...store.identities, [name]: identity } },
      value: identity,
    }
  })
}

export async function deleteIdentity(name: string): Promise<void> {
  await updateIdentityStore(async (store) => {
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
    const { [name]: _, ...identities } = store.identities
    return { next: { ...store, identities }, value: undefined }
  })
}

export async function setDefault(name: string): Promise<void> {
  await updateIdentityStore((store) => {
    if (!store.identities[name]) {
      throw new Error(`Identity "${name}" not found`)
    }
    return { next: { ...store, default: name }, value: undefined }
  })
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
  return updateIdentityStore((store) => {
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
    return {
      next: {
        default: opts.use === false ? store.default : name,
        identities: { ...store.identities, [name]: identity },
      },
      value: identity,
    }
  })
}

/** Record (or replace) the kernel-derived (iss, sub) pair for an identity on a target instance. */
export async function setRegistration(
  name: string,
  instanceSlug: string,
  registration: Registration,
): Promise<void> {
  await updateIdentityStore((store) => {
    const entry = store.identities[name]
    if (!entry) throw new Error(`Identity "${name}" not found`)
    const identity: Identity = {
      ...entry,
      registrations: { ...entry.registrations, [instanceSlug]: registration },
    }
    return {
      next: { ...store, identities: { ...store.identities, [name]: identity } },
      value: undefined,
    }
  })
}

/** Migrate an identity to a new registry mode (local ↔ remote, §2.7). */
export async function setIdentityMode(name: string, mode: RegistryMode): Promise<void> {
  await updateIdentityStore((store) => {
    const entry = store.identities[name]
    if (!entry) throw new Error(`Identity "${name}" not found`)
    const identity: Identity = { ...entry, mode }
    return {
      next: { ...store, identities: { ...store.identities, [name]: identity } },
      value: undefined,
    }
  })
}
