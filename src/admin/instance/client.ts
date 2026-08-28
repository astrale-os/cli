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
  type InstanceInfo,
  type InstanceState,
  type OwnedInstanceInfo,
} from './model'

export interface AdminInstanceContext {
  readonly session: ClientSession
  readonly graph: AdminGraphQueryApi
}

export interface AdminInstanceApi {
  list(): Promise<OwnedInstanceInfo[]>
  create(slug: string): Promise<InstanceInfo>
  status(identifier: string): Promise<InstanceInfo>
  delete(identifier: string): Promise<InstanceInfo>
  installDomain(identifier: string, domain: string): Promise<DomainInstallReceipt>
}

export interface AdminInstanceDependencies {
  readonly operationId?: (kind: 'create' | 'status' | 'delete' | 'install-domain') => string
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
  })
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

function defaultOperationId(kind: 'create' | 'status' | 'delete' | 'install-domain'): string {
  return randomOperationId('cli', 'instance', kind)
}
