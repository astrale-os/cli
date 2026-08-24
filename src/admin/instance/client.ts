import type { ClientSession } from '@astrale-os/sdk/client/session'
import type { Node } from '@astrale-os/sdk/graph/node'
import type { ResolvedClass } from '@astrale-os/sdk/schema'

import { Path } from '@astrale-os/sdk/graph/path'
import { Query } from '@astrale-os/sdk/query'

import {
  bindAdmin,
  invokeAdminMethod,
  requireAdminBinding,
  requireAdminClass,
  requireAdminCore,
  requireAdminProperty,
  type AdminBinding,
} from '../binding'
import { readAllNodes, type AdminGraphApi } from '../graph'
import {
  AdminHostNotFoundError,
  AdminInstanceNotFoundError,
  findOwnedInstance,
  type DomainInstallReceipt,
  type InstanceInfo,
  type InstanceState,
  type OwnedInstanceInfo,
} from './model'

const PAGE_SIZE = 256
const MAXIMUM_INSTANCES = 10_000
const MAXIMUM_PAGES = Math.ceil(MAXIMUM_INSTANCES / PAGE_SIZE) + 1

export interface AdminInstanceContext {
  readonly session: ClientSession
  readonly graph: AdminGraphApi
}

export interface AdminInstanceApi {
  list(): Promise<OwnedInstanceInfo[]>
  create(slug: string, hostId?: string): Promise<InstanceInfo>
  status(identifier: string): Promise<InstanceInfo>
  delete(identifier: string): Promise<InstanceInfo>
  installDomain(identifier: string, domain: string): Promise<DomainInstallReceipt>
}

export interface AdminInstanceDependencies {
  readonly bind?: (session: ClientSession) => Promise<AdminBinding>
  readonly operationId?: (kind: 'create' | 'status' | 'delete' | 'install-domain') => string
}

/**
 * Bind one discovered Admin root revision and expose only the public Instance
 * product journey. No Host lifecycle method is present on this capability.
 */
export async function connectAdminInstances(
  context: AdminInstanceContext,
  dependencies: AdminInstanceDependencies = {},
): Promise<AdminInstanceApi> {
  const binding = requireAdminBinding(await (dependencies.bind ?? bindAdmin)(context.session))

  const Instance = requireAdminClass(binding, 'Instance', 'node')
  const Host = requireAdminClass(binding, 'Host', 'node')
  const Fleet = requireAdminClass(binding, 'Fleet', 'node')
  const fleetReservesAdminHost = requireAdminClass(binding, 'fleet_reserves_admin_host', 'edge')
  const fleet = requireAdminCore(binding, 'fleet')

  const operationId = dependencies.operationId ?? defaultOperationId

  const list = async (): Promise<OwnedInstanceInfo[]> => {
    const result: unknown = await invokeAdminMethod(
      context.session,
      binding,
      Fleet,
      'listInstances',
      fleet,
      {},
    )
    if (!Array.isArray(result)) throw new TypeError('Admin Instance inventory is invalid.')
    return result.map((value) => instanceFromSummary(value) as OwnedInstanceInfo)
  }

  const requireInstance = async (identifier: string): Promise<OwnedInstanceInfo> => {
    const found = findOwnedInstance(await list(), identifier)
    if (found === undefined) throw new AdminInstanceNotFoundError(identifier)
    return found
  }

  const invokeInstance = async (
    method: 'status' | 'delete',
    identifier: string,
  ): Promise<InstanceInfo> => {
    const instance = await requireInstance(identifier)
    const output = await invokeAdminMethod(
      context.session,
      binding,
      Instance,
      method,
      Path.parse(instance.id),
      { operationId: operationId(method) },
    )
    return instanceFromSummary(output)
  }

  return Object.freeze({
    list,
    async create(slug: string, hostId?: string) {
      const input = Object.freeze({
        operationId: operationId('create'),
        slug,
      })
      if (hostId !== undefined) {
        const selected = await hostInventory(context.graph, Host, fleetReservesAdminHost, fleet)
        const host = selected.hosts.find(
          (item) => item.id === hostId && item.state === 'ready' && item.path !== selected.reserved,
        )
        if (host === undefined) throw new AdminHostNotFoundError(hostId)
        return instanceFromSummary(
          await invokeAdminMethod(
            context.session,
            binding,
            Host,
            'createInstance',
            Path.parse(host.path),
            input,
          ),
        )
      }

      // Default placement belongs to Admin. Avoid a redundant Host graph read:
      // it requires broader graph authority than this Fleet operation and can
      // deny an otherwise authorized caller before the server selects a Host.
      return instanceFromSummary(
        await invokeAdminMethod(context.session, binding, Fleet, 'createInstance', fleet, input),
      )
    },
    status: (identifier: string) => invokeInstance('status', identifier),
    delete: (identifier: string) => invokeInstance('delete', identifier),
    async installDomain(identifier: string, domain: string): Promise<DomainInstallReceipt> {
      const instance = await requireInstance(identifier)
      const output = await invokeAdminMethod(
        context.session,
        binding,
        Instance,
        'installDomain',
        Path.parse(instance.id),
        {
          operationId: operationId('install-domain'),
          domain: Path.parse(domain).raw,
        },
      )
      return domainInstallReceipt(output)
    },
  })
}

interface HostInventoryItem {
  readonly id: string
  readonly nodeId: string
  readonly path: string
  readonly state: string
}

async function hostInventory(
  graph: AdminGraphApi,
  Host: ResolvedClass<'node'>,
  fleetReservesAdminHost: ResolvedClass<'edge'>,
  fleet: Path,
): Promise<{ readonly hosts: readonly HostInventoryItem[]; readonly reserved?: string }> {
  const [nodes, reservedPage] = await Promise.all([
    readAllNodes(
      graph,
      Query.from({ nodes: [Host] }).select({
        kind: 'nodes',
        projection: { kind: 'value' },
      }),
      {
        label: 'Admin Host inventory',
        maximum: MAXIMUM_INSTANCES,
        maximumPages: MAXIMUM_PAGES,
      },
    ),
    graph.neighbors(fleet, fleetReservesAdminHost, {
      direction: 'outgoing',
      page: { size: 1 },
    }),
  ])
  const reserved = reservedPage.first === null ? undefined : Path.id(reservedPage.first.id).raw
  return Object.freeze({
    hosts: Object.freeze(
      nodes.map((node) =>
        Object.freeze({
          id: requiredStringProperty(Host, node, 'id'),
          nodeId: String(node.id),
          path: Path.id(node.id).raw,
          state: requiredStringProperty(Host, node, 'state'),
        }),
      ),
    ),
    ...(reserved === undefined ? {} : { reserved }),
  })
}

type DynamicDefinition = ResolvedClass<'node'>

function instanceFromSummary(input: unknown): InstanceInfo {
  const value = record(input, 'Admin Instance summary')
  const failure = value.failure === undefined ? undefined : record(value.failure, 'Admin failure')
  return Object.freeze({
    id: requiredString(value.id, 'Admin Instance id'),
    slug: requiredString(value.slug, 'Admin Instance slug'),
    url: optionalStringValue(value.url) ?? '',
    state: instanceState(value.state),
    ...(value.hostId === undefined
      ? {}
      : { hostId: requiredString(value.hostId, 'Admin Host id') }),
    ...(value.region === undefined ? {} : { region: requiredString(value.region, 'Admin region') }),
    ...(value.phase === undefined
      ? {}
      : { phase: requiredString(value.phase, 'Admin Instance phase') }),
    ...(failure === undefined
      ? {}
      : { error: requiredString(failure.message, 'Admin failure message') }),
    ...(value.createdAt === undefined
      ? {}
      : { createdAt: requiredString(value.createdAt, 'Admin Instance creation time') }),
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
    domain: requiredString(value.domain, 'Admin Domain reference'),
    instance: requiredString(value.instance, 'Admin Instance reference'),
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

function requiredStringProperty(definition: DynamicDefinition, node: Node, name: string): string {
  return requiredString(
    node.props[requireAdminProperty(definition, name).key],
    `Admin ${definition.ref.name}.${name}`,
  )
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
  return `cli.instance.${kind}:${globalThis.crypto.randomUUID()}`
}
