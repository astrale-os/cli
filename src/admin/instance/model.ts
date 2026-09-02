/** CLI-stable projection of one caller-visible Admin Instance. */
export type InstanceState = 'provisioning' | 'ready' | 'deleting' | 'failed' | 'deleted'

export interface InstanceInfo {
  readonly id: string
  readonly slug: string
  readonly url: string
  readonly issuer?: string
  readonly hostId?: string
  readonly region?: string
  readonly state: InstanceState
  readonly phase?: string
  readonly error?: string | null
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly organizationId?: string
}

/** An Instance returned through the caller-scoped Admin graph inventory. */
export interface OwnedInstanceInfo extends InstanceInfo {
  readonly state: InstanceState
}

export interface DomainInstallReceipt {
  readonly domain: string
  readonly instance: string
  readonly origin: string
  readonly ok: boolean
  readonly installedRevision?: string
  readonly error?: string
}

export interface RootIdentityRecipient {
  readonly kty: 'EC'
  readonly crv: 'P-256'
  readonly x: string
  readonly y: string
  readonly kid: string
}

export interface RootIdentityTransfer {
  readonly format: 'astrale.instance-root-transfer'
  readonly version: 1
  readonly requestId: string
  readonly instance: string
  readonly issuer: string
  readonly subject: string
  readonly recipientThumbprint: string
  readonly jwe: string
}

export interface RetrievedRootIdentity {
  readonly instance: OwnedInstanceInfo
  readonly transfer: RootIdentityTransfer
}

export type InvitationState = 'pending' | 'accepted' | 'revoked' | 'expired'

export interface InvitationInfo {
  readonly id: string
  readonly email: string
  readonly state: InvitationState
  readonly access: 'member'
  readonly instance: string
  readonly invitedBy?: string
  readonly claimedBy?: string
  readonly createdAt: string
  readonly expiresAt?: string
  readonly acceptedAt?: string
}

export class AdminInstanceNotFoundError extends AstraleError {
  constructor(readonly identifier: string) {
    super(
      'INSTANCE_NOT_FOUND',
      `No owned Admin Instance matches ${JSON.stringify(identifier)}.`,
      'Run `astrale instance list` to see your instances.',
    )
  }
}

/** Match an owner-scoped Instance by slug, canonical Node Path, or bare Node id. */
export function findOwnedInstance(
  instances: readonly OwnedInstanceInfo[],
  identifier: string,
): OwnedInstanceInfo | undefined {
  return instances.find(
    (instance) =>
      instance.slug === identifier ||
      instance.id === identifier ||
      (instance.id.startsWith('@') && instance.id.slice(1) === identifier),
  )
}

/** Human-readable non-ready lifecycle state for one Instance. */
export function formatInstanceState(info: InstanceInfo): string {
  return info.state === 'ready' ? '' : `${info.state}${info.phase ? ` (${info.phase})` : ''}`
}
import { AstraleError } from '../../errors'
