import { AstraleError, IdentityExistsError, IdentityNotFoundError } from '../errors'
import { persistKeypair, removeKeypair } from '../keys/index'
import { deleteIdpSession } from '../lib/idp/provider'
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

/** The identity `store` holds under `name`; an Object.prototype member name is an ordinary name. */
export function findIdentity(store: IdentityStore, name: string): Identity | undefined {
  return Object.hasOwn(store.identities, name) ? store.identities[name] : undefined
}

/** The identity `store` holds under `name`, or the one refusal every command gives an unknown name. */
export function identityIn(store: IdentityStore, name: string): Identity {
  const identity = findIdentity(store, name)
  if (!identity) throw new IdentityNotFoundError(name)
  return identity
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
    if (findIdentity(store, name)) throw new IdentityExistsError(name)

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
    const hasDefault = store.default !== '' && findIdentity(store, store.default) !== undefined
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
    const entry = identityIn(store, name)
    if (store.default === name) {
      throw new AstraleError(
        'IDENTITY_IS_DEFAULT',
        `Cannot delete the default identity "${name}".`,
        'Switch default first with: astrale identity use <other>',
      )
    }
    if (entry.source === 'idp') await deleteIdpSession(name)
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
      candidateName !== name && candidate.source !== 'idp' && candidate.subject === subject,
  )
}

export async function setDefault(name: string): Promise<void> {
  await updateIdentityStore((store) => {
    identityIn(store, name)
    return { next: { ...store, default: name }, value: undefined }
  })
}

export async function getDefault(): Promise<Identity & { readonly name: string }> {
  const store = await readIdentities()
  const identity = store.default === '' ? undefined : findIdentity(store, store.default)
  if (!identity) {
    throw new AstraleError('NO_IDENTITY', 'No default identity.', 'Run: astrale identity list')
  }
  return { ...identity, name: store.default }
}

export async function getIdentity(name: string): Promise<Identity> {
  return identityIn(await readIdentities(), name)
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
    const existing = findIdentity(store, name)
    if (existing && existing.source !== 'idp')
      throw new IdentityExistsError(name, { source: 'key' })
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
  kernelIssuer: string,
  registration: Registration,
): Promise<void> {
  await updateIdentityStore((store) => {
    const entry = identityIn(store, name)
    const identity: Identity = {
      ...entry,
      registrations: { ...entry.registrations, [kernelIssuer]: registration },
    }
    return {
      next: { ...store, identities: { ...store.identities, [name]: identity } },
      value: undefined,
    }
  })
}

export async function setIdentityMode(name: string, mode: IdentityMode): Promise<void> {
  await updateIdentityStore((store) => {
    const entry = identityIn(store, name)
    const identity: Identity = { ...entry, mode }
    return {
      next: { ...store, identities: { ...store.identities, [name]: identity } },
      value: undefined,
    }
  })
}
