import type { GraphApi } from '@astrale-os/sdk/client'
import type { ClientSession } from '@astrale-os/sdk/client/session'

export type InstanceState = 'provisioning' | 'ready' | 'deleting' | 'failed' | 'deleted'

export interface InstanceInfo {
  readonly id: string
  readonly slug: string
  readonly url: string
  readonly hostId?: string
  readonly region?: string
  readonly state: InstanceState
  readonly phase?: string
  readonly error?: string | null
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly organizationId?: string
}

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

export interface AdminInstanceContext {
  readonly session: ClientSession
  readonly graph: Pick<GraphApi, 'query'>
}

export interface AdminInstanceApi {
  list(): Promise<OwnedInstanceInfo[]>
  create(slug: string): Promise<InstanceInfo>
  status(identifier: string): Promise<InstanceInfo>
  delete(identifier: string): Promise<InstanceInfo>
  installDomain(identifier: string, domain: string): Promise<DomainInstallReceipt>
  invite(identifier: string, email: string, expiresInDays?: number): Promise<InvitationInfo>
  statusInvitation(invitation: string): Promise<InvitationInfo>
  reconcileInvitation(invitation: string): Promise<InvitationInfo>
}

export class AdminInstanceNotFoundError extends Error {
  constructor(identifier: string)
  readonly name: 'NotFoundError'
  readonly identifier: string
}

export interface AdminInstanceDependencies {
  readonly operationId?: (
    kind: 'create' | 'status' | 'delete' | 'install-domain' | 'invite' | 'reconcile-invitation',
  ) => string
}

export function connectAdminInstances(
  context: AdminInstanceContext,
  dependencies?: AdminInstanceDependencies,
): Promise<AdminInstanceApi>
export function findOwnedInstance(
  instances: readonly OwnedInstanceInfo[],
  identifier: string,
): OwnedInstanceInfo | undefined
export function formatInstanceState(info: InstanceInfo): string
