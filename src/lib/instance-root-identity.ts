import type { JWK } from 'jose'

import { calculateJwkThumbprint } from 'jose'

import type { OwnedInstanceInfo, RootIdentityRecipient } from '../admin/instance'
import type { AdminConnectionOptions } from '../connection'
import type { Identity, IdentityExport, RootIdentityRecipientContext } from '../identity'

import { AstraleError, IssuerUnreachableError } from '../errors'
import {
  createRootIdentityRecipient,
  decodeRootIdentityTransfer,
  importIdentity,
  readIdentities,
} from '../identity'
import { ExchangeCredentialCache, SESSION_ROUTE_STORE } from '../state'
import { retrieveOwnedInstanceRootIdentity } from './admin-instance'
import { upsertManagedBookmark } from './instance'
import { checkIssuerReachability } from './meta'

export type RootIdentityVerification = 'live-jwks' | 'host-sealed'

export interface ImportedInstanceRootIdentity {
  readonly instance: OwnedInstanceInfo
  readonly name: string
  readonly identity: Identity
  readonly replaced: boolean
  readonly verification: RootIdentityVerification
  readonly bookmarkError?: unknown
}

export interface ImportInstanceRootIdentityOptions {
  readonly bookmark?: boolean
}

interface Retrieval {
  readonly instance: OwnedInstanceInfo
  readonly transfer: Awaited<ReturnType<typeof retrieveOwnedInstanceRootIdentity>>['transfer']
  readonly ownerIdentity?: string
}

interface Dependencies {
  readonly createRecipient: () => Promise<RootIdentityRecipientContext>
  readonly retrieve: (
    options: AdminConnectionOptions,
    identifier: string,
    recipient: RootIdentityRecipient,
  ) => Promise<Retrieval>
  readonly decode: typeof decodeRootIdentityTransfer
  readonly readIdentities: typeof readIdentities
  readonly importIdentity: typeof importIdentity
  readonly checkIssuer: typeof checkIssuerReachability
  readonly thumbprint: (key: JWK) => Promise<string>
  readonly bookmark: typeof upsertManagedBookmark
  readonly clearCaches: () => Promise<void>
}

const defaults: Dependencies = {
  createRecipient: createRootIdentityRecipient,
  retrieve: retrieveOwnedInstanceRootIdentity,
  decode: decodeRootIdentityTransfer,
  readIdentities,
  importIdentity,
  checkIssuer: checkIssuerReachability,
  thumbprint: (key) => calculateJwkThumbprint(key, 'sha256'),
  bookmark: upsertManagedBookmark,
  clearCaches: async () => {
    await new ExchangeCredentialCache().clear()
    SESSION_ROUTE_STORE.clear()
  },
}

/** Retrieve, authenticate, and install the canonical local root identity. */
export async function importInstanceRootIdentity(
  connection: AdminConnectionOptions,
  identifier: string,
  options: ImportInstanceRootIdentityOptions = {},
  dependencies: Partial<Dependencies> = {},
): Promise<ImportedInstanceRootIdentity> {
  const deps = { ...defaults, ...dependencies }
  const recipient = await deps.createRecipient()
  const retrieved = await deps.retrieve(connection, identifier, recipient.recipient)
  const issuer = retrieved.instance.issuer
  if (issuer === undefined) {
    throw new AstraleError(
      'INSTANCE_ROOT_IDENTITY_UNAVAILABLE',
      'Admin Instance is missing its root issuer.',
    )
  }

  const scope = Object.freeze({
    instance: retrieved.instance.id,
    issuer,
    requestId: retrieved.transfer.requestId,
    recipientThumbprint: recipient.recipient.kid,
    subject: retrieved.transfer.subject,
  })
  const envelope = await deps.decode(retrieved.transfer, recipient, scope)
  const verification = await verifyPublishedIdentity(retrieved.instance, envelope, deps)

  const name = `${retrieved.instance.slug}-root`
  const store = await deps.readIdentities()
  const replaced = store.identities[name] !== undefined
  const identity = await deps.importIdentity(envelope, { name, issuer, replace: true })
  await deps.clearCaches()

  let bookmarkError: unknown
  if (options.bookmark !== false) {
    try {
      await deps.bookmark({
        key: retrieved.instance.slug,
        slug: retrieved.instance.slug,
        url: retrieved.instance.url,
        ...(retrieved.instance.organizationId
          ? { organizationId: retrieved.instance.organizationId }
          : {}),
        ...(retrieved.ownerIdentity ? { defaultIdentity: retrieved.ownerIdentity } : {}),
        activateWhenEmpty: false,
      })
    } catch (error) {
      bookmarkError = error
    }
  }

  return Object.freeze({
    instance: retrieved.instance,
    name,
    identity,
    replaced,
    verification,
    ...(bookmarkError === undefined ? {} : { bookmarkError }),
  })
}

async function verifyPublishedIdentity(
  instance: OwnedInstanceInfo,
  envelope: IdentityExport,
  dependencies: Pick<Dependencies, 'checkIssuer' | 'thumbprint'>,
): Promise<RootIdentityVerification> {
  if (instance.state !== 'ready' || instance.issuer === undefined) return 'host-sealed'
  let keys: JWK[]
  try {
    keys = (await dependencies.checkIssuer(instance.url, instance.issuer)).keys
  } catch (error) {
    if (error instanceof IssuerUnreachableError) return 'host-sealed'
    throw error
  }
  const subjects = await Promise.all(
    keys.map((key) => dependencies.thumbprint(key).catch(() => undefined)),
  )
  if (!subjects.includes(envelope.subject)) {
    throw new AstraleError(
      'INVALID_ROOT_IDENTITY_TRANSFER',
      'The live Instance JWKS does not publish the retrieved root identity.',
    )
  }
  return 'live-jwks'
}
