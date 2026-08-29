import type { ClientSession } from '@astrale-os/sdk/client/session'
import type { Node } from '@astrale-os/sdk/graph/node'

import { ClassKey } from '@astrale-os/sdk/graph/class'
import { Path } from '@astrale-os/sdk/graph/path'
import { Query } from '@astrale-os/sdk/query'

import { randomOperationId } from '../../lib/idempotency'
import { AdminContract, callAdminMethod } from '../contract'
import { readAllNodes, type AdminGraphQueryApi } from '../graph'
import {
  AdminInstanceNotFoundError,
  findOwnedInstance,
  type DomainInstallReceipt,
  type InvitationInfo,
  type InstanceInfo,
  type InstanceLifecycleInfo,
  type InstanceState,
  type OwnedInstanceInfo,
} from './model'

export interface AdminInstanceContext {
  readonly session: ClientSession
  readonly graph: AdminGraphQueryApi
}

export interface AdminInstanceApi {
  list(): Promise<OwnedInstanceInfo[]>
  listLifecycle(options?: Readonly<{ includeRetired?: boolean }>): Promise<InstanceLifecycleInfo[]>
  create(slug: string): Promise<InstanceInfo>
  status(identifier: string): Promise<InstanceInfo>
  delete(identifier: string): Promise<InstanceInfo>
  installDomain(identifier: string, domain: string): Promise<DomainInstallReceipt>
  invite(identifier: string, email: string, expiresInDays?: number): Promise<InvitationInfo>
  statusInvitation(invitation: string): Promise<InvitationInfo>
  reconcileInvitation(invitation: string): Promise<InvitationInfo>
}

export interface AdminInstanceDependencies {
  readonly operationId?: (
    kind: 'create' | 'status' | 'delete' | 'install-domain' | 'invite' | 'reconcile-invitation',
  ) => string
}

const PAGE_SIZE = 256
const MAXIMUM_INSTANCES = 10_000
const MAXIMUM_PAGES = Math.ceil(MAXIMUM_INSTANCES / PAGE_SIZE) + 1

/**
 * Connect the public Instance journey through stable Admin call paths. Routine
 * operations perform no schema discovery. No Host lifecycle method is present.
 */
export async function connectAdminInstances(
  context: AdminInstanceContext,
  dependencies: AdminInstanceDependencies = {},
): Promise<AdminInstanceApi> {
  const operationId = dependencies.operationId ?? defaultOperationId

  const list = async (): Promise<OwnedInstanceInfo[]> => {
    const Instance = AdminContract.classes.Instance
    const property = AdminContract.properties.instance
    const instances = Query.from({ nodes: [Instance] }).filter({
      class: { equals: Instance },
    })
    const nodes = await readAllNodes(
      context.graph,
      instances.select({
        kind: 'nodes',
        binding: instances.node,
        projection: { kind: 'value' },
        order: { property: property.state, direction: 'desc', unranked: 'last' },
      }),
      {
        label: 'Admin Instance inventory',
        maximum: MAXIMUM_INSTANCES,
        maximumPages: MAXIMUM_PAGES,
        orderedBoundary: (node) => instanceFromNode(node).state === 'deleted',
      },
    )
    return nodes.map(instanceFromNode)
  }

  const requireInstance = async (identifier: string): Promise<OwnedInstanceInfo> => {
    const direct = directNodePath(identifier)
    const found =
      direct === undefined
        ? findOwnedInstance(await list(), identifier)
        : await readExactInstance(context.graph, direct)
    if (found === undefined) throw new AdminInstanceNotFoundError(identifier)
    return found
  }

  const invokeInstance = async (
    method: 'status' | 'delete',
    identifier: string,
  ): Promise<InstanceInfo> => {
    const instance = await requireInstance(identifier)
    const output = await callAdminMethod(context.session, Path.parse(instance.id), method, {
      operationId: operationId(method),
    })
    return instanceFromSummary(output)
  }

  return Object.freeze({
    list,
    async listLifecycle(options: Readonly<{ includeRetired?: boolean }> = {}) {
      return instanceLifecycleInventory(
        await callAdminMethod(
          context.session,
          AdminContract.fleet,
          'listInstanceLifecycle',
          options.includeRetired === undefined ? {} : { includeRetired: options.includeRetired },
        ),
      )
    },
    async create(slug: string) {
      const input = Object.freeze({
        operationId: operationId('create'),
        slug,
      })
      return instanceFromSummary(
        await callAdminMethod(context.session, AdminContract.fleet, 'createInstance', input),
      )
    },
    status: (identifier: string) => invokeInstance('status', identifier),
    delete: (identifier: string) => invokeInstance('delete', identifier),
    async installDomain(identifier: string, domain: string): Promise<DomainInstallReceipt> {
      const instance = await requireInstance(identifier)
      const output = await callAdminMethod(
        context.session,
        Path.parse(instance.id),
        'installDomain',
        {
          operationId: operationId('install-domain'),
          domain: Path.parse(domain).raw,
        },
      )
      return domainInstallReceipt(output)
    },
    async invite(identifier: string, email: string, expiresInDays?: number) {
      const instance = await requireInstance(identifier)
      const invitation = memberInstanceInvitationFromSummary(
        await callAdminMethod(context.session, Path.parse(instance.id), 'inviteUser', {
          operationId: operationId('invite'),
          email,
          ...(expiresInDays === undefined ? {} : { expiresInDays }),
        }),
        'Admin Instance invitation does not match its requested scope.',
      )
      if (
        invitation.instance !== instance.id ||
        invitation.email.toLowerCase() !== email.toLowerCase()
      ) {
        throw new TypeError('Admin Instance invitation does not match its requested scope.')
      }
      return invitation
    },
    async statusInvitation(invitation: string) {
      const receiver = invitationReceiver(invitation)
      return instanceInvitationFromSummary(
        await callAdminMethod(context.session, receiver, 'status', {}),
        receiver,
        'status',
      )
    },
    async reconcileInvitation(invitation: string) {
      const receiver = invitationReceiver(invitation)
      return instanceInvitationFromSummary(
        await callAdminMethod(context.session, receiver, 'reconcile', {
          operationId: operationId('reconcile-invitation'),
        }),
        receiver,
        'reconciliation',
      )
    },
  })
}

function invitationReceiver(invitation: string): ReturnType<typeof Path.parse> {
  const receiver = directNodePath(invitation)
  if (receiver === undefined) throw new TypeError('Admin Invitation id is invalid.')
  return receiver
}

function instanceInvitationFromSummary(
  input: unknown,
  receiver: ReturnType<typeof Path.parse>,
  operation: 'status' | 'reconciliation',
): InvitationInfo {
  const invitation = memberInstanceInvitationFromSummary(
    input,
    `Admin Invitation ${operation} does not match its requested scope.`,
  )
  if (invitation.id !== receiver.raw) {
    throw new TypeError(`Admin Invitation ${operation} does not match its requested scope.`)
  }
  return invitation
}

async function readExactInstance(
  graph: AdminGraphQueryApi,
  instance: ReturnType<typeof Path.parse>,
): Promise<OwnedInstanceInfo | undefined> {
  const Instance = AdminContract.classes.Instance
  const selected = Query.from({ nodes: [instance] }).filter({ class: { equals: Instance } })
  const nodes = await readAllNodes(
    graph,
    selected.select({ kind: 'nodes', binding: selected.node, projection: { kind: 'value' } }),
    { label: 'Admin Instance lookup', maximum: 1, maximumPages: 1 },
  )
  if (nodes.length > 1) throw new TypeError('Admin Instance lookup returned more than one Node.')
  return nodes[0] === undefined ? undefined : instanceFromNode(nodes[0])
}

function directNodePath(input: string): ReturnType<typeof Path.parse> | undefined {
  try {
    const parsed = Path.parse(input)
    return parsed.ast.anchor.kind === 'id' && parsed.ast.steps.length === 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

function instanceFromNode(node: Node): OwnedInstanceInfo {
  const Instance = AdminContract.classes.Instance
  if (node.class !== ClassKey.of(Instance)) {
    throw new TypeError('Admin Instance inventory returned a non-Instance Node.')
  }
  const property = AdminContract.properties.instance
  return instanceFromSummary({
    id: Path.id(node.id).raw,
    slug: node.props[property.slug],
    url: node.props[property.url],
    organizationId: node.props[property.organizationId],
    state: node.props[property.state],
    phase: node.props[property.phase],
    failure: node.props[property.failure],
    createdAt: node.props[property.createdAt],
    updatedAt: node.props[property.updatedAt],
  }) as OwnedInstanceInfo
}

function instanceFromSummary(input: unknown): InstanceInfo {
  const value = record(input, 'Admin Instance summary')
  const failure = value.failure === undefined ? undefined : record(value.failure, 'Admin failure')
  return Object.freeze({
    id: requiredNodePath(value.id, 'Admin Instance id'),
    slug: requiredString(value.slug, 'Admin Instance slug'),
    url: optionalStringValue(value.url) ?? '',
    ...(value.hostId === undefined
      ? {}
      : { hostId: requiredNodePath(value.hostId, 'Admin Host id') }),
    ...(value.region === undefined
      ? {}
      : { region: requiredString(value.region, 'Admin Host region') }),
    state: instanceState(value.state),
    ...(value.phase === undefined
      ? {}
      : { phase: requiredString(value.phase, 'Admin Instance phase') }),
    ...(failure === undefined
      ? {}
      : { error: requiredString(failure.message, 'Admin failure message') }),
    ...(value.createdAt === undefined
      ? {}
      : { createdAt: requiredString(value.createdAt, 'Admin Instance creation time') }),
    ...(value.updatedAt === undefined
      ? {}
      : { updatedAt: requiredString(value.updatedAt, 'Admin Instance update time') }),
    ...(value.organizationId === undefined
      ? {}
      : { organizationId: requiredString(value.organizationId, 'Admin organization id') }),
  })
}

function instanceLifecycleInventory(input: unknown): InstanceLifecycleInfo[] {
  if (!Array.isArray(input)) throw new TypeError('Admin Instance lifecycle inventory is invalid.')
  if (input.length > MAXIMUM_INSTANCES) {
    throw new TypeError('Admin Instance lifecycle inventory exceeds its bound.')
  }
  return input.map((entry) => instanceLifecycleEntry(entry))
}

function instanceLifecycleEntry(input: unknown): InstanceLifecycleInfo {
  const value = record(input, 'Admin Instance lifecycle')
  const state = instanceState(value.state)
  const lifecycle = value.lifecycle
  if (lifecycle !== 'active' && lifecycle !== 'retired') {
    throw new TypeError('Admin Instance lifecycle classification is invalid.')
  }
  if ((state === 'deleted') !== (lifecycle === 'retired')) {
    throw new TypeError('Admin Instance lifecycle state is inconsistent.')
  }
  const issuer = optionalStringValue(value.issuer)
  if (issuer !== undefined) {
    let parsed: URL
    try {
      parsed = new URL(issuer)
    } catch {
      throw new TypeError('Admin Instance lifecycle issuer is invalid.')
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new TypeError('Admin Instance lifecycle issuer is invalid.')
    }
  }
  return Object.freeze({
    slug: requiredString(value.slug, 'Admin Instance lifecycle slug'),
    state,
    lifecycle,
    ...(issuer === undefined ? {} : { issuer }),
    updatedAt: requiredString(value.updatedAt, 'Admin Instance lifecycle update time'),
  })
}

function domainInstallReceipt(input: unknown): DomainInstallReceipt {
  const value = record(input, 'Admin Domain install receipt')
  const failure = value.failure === undefined ? undefined : record(value.failure, 'Admin failure')
  if (typeof value.ok !== 'boolean') throw new TypeError('Admin Domain install outcome is invalid.')
  return Object.freeze({
    domain: requiredNodePath(value.domain, 'Admin Domain reference'),
    instance: requiredNodePath(value.instance, 'Admin Instance reference'),
    origin: requiredString(value.origin, 'Installed Domain origin'),
    ok: value.ok,
    ...(value.installedRevision === undefined
      ? {}
      : {
          installedRevision: requiredString(value.installedRevision, 'Installed Domain revision'),
        }),
    ...(failure === undefined
      ? {}
      : { error: requiredString(failure.message, 'Admin Domain install failure') }),
  })
}

interface InvitationSummary {
  readonly id: string
  readonly email: string
  readonly state: InvitationInfo['state']
  readonly access: 'administrator' | 'member'
  readonly instance?: string
  readonly invitedBy?: string
  readonly claimedBy?: string
  readonly createdAt: string
  readonly expiresAt?: string
  readonly acceptedAt?: string
}

function invitationFromSummary(input: unknown): InvitationSummary {
  const value = record(input, 'Admin Invitation summary')
  const state = value.state
  if (state !== 'pending' && state !== 'accepted' && state !== 'revoked' && state !== 'expired') {
    throw new TypeError('Admin Invitation state is invalid.')
  }
  const access = value.access
  if (access !== 'administrator' && access !== 'member') {
    throw new TypeError('Admin Invitation access is invalid.')
  }
  return Object.freeze({
    id: requiredNodePath(value.id, 'Admin Invitation id'),
    email: requiredString(value.email, 'Admin Invitation email'),
    state,
    access,
    ...(value.instance === undefined
      ? {}
      : { instance: requiredNodePath(value.instance, 'Admin Invitation Instance') }),
    ...(value.invitedBy === undefined
      ? {}
      : { invitedBy: requiredNodePath(value.invitedBy, 'Admin Invitation sender') }),
    ...(value.claimedBy === undefined
      ? {}
      : { claimedBy: requiredNodePath(value.claimedBy, 'Admin Invitation claimant') }),
    createdAt: requiredString(value.createdAt, 'Admin Invitation creation time'),
    ...(value.expiresAt === undefined
      ? {}
      : { expiresAt: requiredString(value.expiresAt, 'Admin Invitation expiry time') }),
    ...(value.acceptedAt === undefined
      ? {}
      : { acceptedAt: requiredString(value.acceptedAt, 'Admin Invitation acceptance time') }),
  })
}

function memberInstanceInvitationFromSummary(input: unknown, scopeError: string): InvitationInfo {
  const invitation = invitationFromSummary(input)
  if (invitation.instance === undefined || invitation.access !== 'member') {
    throw new TypeError(scopeError)
  }
  return Object.freeze({ ...invitation, access: 'member', instance: invitation.instance })
}

function instanceState(input: unknown): InstanceState {
  if (
    input === 'provisioning' ||
    input === 'ready' ||
    input === 'deleting' ||
    input === 'failed' ||
    input === 'deleted'
  ) {
    return input
  }
  throw new TypeError('Admin Instance state is invalid.')
}

function requiredString(input: unknown, label: string): string {
  if (typeof input !== 'string' || input.length === 0) throw new TypeError(`${label} is invalid.`)
  return input
}

function requiredNodePath(input: unknown, label: string): string {
  const value = requiredString(input, label)
  try {
    return Path.parse(value).raw
  } catch {
    throw new TypeError(`${label} is invalid.`)
  }
}

function optionalStringValue(input: unknown): string | undefined {
  if (input === undefined) return undefined
  return requiredString(input, 'Admin string value')
}

function record(input: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError(`${label} is invalid.`)
  }
  return input as Readonly<Record<string, unknown>>
}

function defaultOperationId(
  kind: 'create' | 'status' | 'delete' | 'install-domain' | 'invite' | 'reconcile-invitation',
): string {
  return randomOperationId('cli', 'instance', kind)
}
