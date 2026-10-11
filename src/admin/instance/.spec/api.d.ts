import type { ClientSession } from '@astrale-os/sdk/client/session'

import type { AstraleError } from '../../../errors'
import type { AdminGraphQueryApi } from '../../graph'

export type InstanceState = 'provisioning' | 'ready' | 'deleting' | 'failed' | 'deleted'

export interface InstanceInfo {
  readonly fleetId?: string
  readonly id: string
  readonly slug: string
  readonly operationId?: string
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
  readonly instance: InstanceInfo
  readonly transfer: RootIdentityTransfer
}

export type InvitationState =
  | 'pending'
  | 'accepted'
  | 'registering'
  | 'registered'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'failed'

export interface InvitationInfo {
  readonly id: string
  readonly email: string
  readonly state: InvitationState
  readonly access: 'member'
  readonly instance: string
  readonly invitedBy?: string
  readonly claimedBy?: string
  /** Shell User reserved on the Instance for this invitation; the accepting account registers onto it. */
  readonly user?: string
  readonly createdAt: string
  readonly expiresAt?: string
  readonly acceptedAt?: string
}

export interface AdminInstanceContext {
  readonly fleet?: string
  readonly session: ClientSession
  readonly graph: AdminGraphQueryApi
}

export interface AdminInstanceApi {
  require(identifier: string): Promise<InstanceInfo>
  list(options?: Readonly<{ includeRetired?: boolean }>): Promise<InstanceInfo[]>
  create(slug: string, requestedOperationId?: string): Promise<InstanceInfo>
  status(identifier: string): Promise<InstanceInfo>
  delete(identifier: string): Promise<InstanceInfo>
  invite(identifier: string, email: string, expiresInDays?: number): Promise<InvitationInfo>
  retrieveRootIdentity(
    identifier: string,
    recipient: RootIdentityRecipient,
  ): Promise<RetrievedRootIdentity>
  statusInvitation(invitation: string): Promise<InvitationInfo>
  reconcileInvitation(invitation: string): Promise<InvitationInfo>
}

export class AdminInstanceNotFoundError extends AstraleError {
  constructor(identifier: string)
  readonly identifier: string
}

/** Each request carries a fresh operation id; Admin retains it to replay a lost reply. */
export function connectAdminInstances(context: AdminInstanceContext): Promise<AdminInstanceApi>
export function findOwnedInstance(
  instances: readonly InstanceInfo[],
  identifier: string,
): InstanceInfo | undefined
export function formatInstanceState(info: InstanceInfo): string
