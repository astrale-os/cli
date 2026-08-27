import { AstraleError } from '../errors'
import { persistKeypair, removeKeypair } from '../keys/index'
import { deleteIdpSession } from '../lib/idp'
import { validateName } from '../lib/validation'
import {
  readIdentityStore,
  updateIdentityStore,
  type Identity,
  type IdentityMode,
  type IdentityStore,
  type Registration,
  ExchangeCredentialCache,
  SESSION_ROUTE_STORE,
} from '../state/index'

export type { Identity, IdentityStore, Registration } from '../state/index'

export async function readIdentities(): Promise<IdentityStore> {
  return readIdentityStore()
}

export async function createIdentity(
  name: string,
  options: {
    readonly subject?: string
    readonly mode?: IdentityMode
    readonly issuer?: string
    readonly kid?: string
  } = {},
): Promise<Identity> {
  validateName(name, 'Identity')
  return updateIdentityStore(async (store) => {
    if (store.identities[name]) throw new Error(`Identity "${name}" already exists`)

    const subject = options.subject ?? name
    const generated = await persistKeypair(subject, { kid: options.kid })
    const identity: Identity = {
      subject,
      createdAt: new Date().toISOString(),
      source: 'key',
      mode: options.mode ?? 'local',
      kid: generated.kid,
      issuer: options.issuer,
    }
    const hasDefault = store.default !== '' && store.identities[store.default] !== undefined
    return {
      next: {
        default: hasDefault ? store.default : name,
        identities: { ...store.identities, [name]: identity },
      },
      value: identity,
    }
  })
}

export async function deleteIdentity(name: string): Promise<void> {
  await updateIdentityStore(async (store) => {
    const entry = store.identities[name]
    if (!entry) throw new Error(`Identity "${name}" not found`)
    if (store.default === name) {
      throw new Error(
        `Cannot delete the default identity "${name}". Switch default first with: astrale identity use <other>`,
      )
    }
    if ((entry.source ?? 'key') === 'idp') await deleteIdpSession(name)
    else if (!hasAnotherKeyIdentity(store, name, entry.subject)) await removeKeypair(entry.subject)

    const { [name]: _, ...identities } = store.identities
    return { next: { ...store, identities }, value: undefined }
  })
  await new ExchangeCredentialCache().clear()
  SESSION_ROUTE_STORE.clear()
}

function hasAnotherKeyIdentity(store: IdentityStore, name: string, subject: string): boolean {
  return Object.entries(store.identities).some(
    ([candidateName, candidate]) =>
      candidateName !== name &&
      (candidate.source ?? 'key') === 'key' &&
      candidate.subject === subject,
  )
}

export async function setDefault(name: string): Promise<void> {
  await updateIdentityStore((store) => {
    if (!store.identities[name]) throw new Error(`Identity "${name}" not found`)
    return { next: { ...store, default: name }, value: undefined }
  })
}

export async function getDefault(): Promise<Identity & { readonly name: string }> {
  const store = await readIdentities()
  if (store.default === '' || store.identities[store.default] === undefined) {
    throw new AstraleError(
      'NO_IDENTITY',
      'No default identity.',
      'Run: astrale identity create <name>',
    )
  }
  const identity = store.identities[store.default]!
  return { ...identity, name: store.default }
}

export async function getIdentity(name: string): Promise<Identity> {
  const store = await readIdentities()
  const identity = store.identities[name]
  if (!identity) {
    throw new AstraleError(
      'NO_IDENTITY',
      `Identity "${name}" not found.`,
      `Run: astrale identity create ${name}`,
    )
  }
  return identity
}

export async function upsertIdpIdentity(
  name: string,
  options: {
    readonly subject: string
    readonly idp: string
    readonly issuer: string
    readonly audience?: string
    readonly claims?: Readonly<Record<string, unknown>>
    readonly use?: boolean
  },
): Promise<Identity> {
  validateName(name, 'Identity')
  validateName(options.idp, 'IdP')
  return updateIdentityStore((store) => {
    const existing = store.identities[name]
    if (existing && (existing.source ?? 'key') !== 'idp') {
      throw new Error(`Identity "${name}" already exists and is key-backed`)
    }
    const identity: Identity = {
      subject: options.subject,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      source: 'idp',
      mode: 'remote',
      idp: options.idp,
      issuer: options.issuer,
      audience: options.audience,
      claims: options.claims,
      registrations: existing?.registrations,
    }
    return {
      next: {
        default: options.use === false ? store.default : name,
        identities: { ...store.identities, [name]: identity },
      },
      value: identity,
    }
  })
}

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

export async function setIdentityMode(name: string, mode: IdentityMode): Promise<void> {
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
