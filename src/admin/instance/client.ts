import type { DomainBinding } from '@astrale-os/kernel-client/domain'
import type { ClientSession } from '@astrale-os/kernel-client/session'
import type { Node } from '@astrale-os/sdk/graph/node'

import { bindDomain } from '@astrale-os/kernel-client/domain'
import { Path } from '@astrale-os/sdk/graph/path'
import { Query } from '@astrale-os/sdk/query'

import { readAllNodes, type AdminGraphApi } from '../graph'
import {
  AdminInstanceNotFoundError,
  findOwnedInstance,
  type DomainInstallReceipt,
  type InstanceInfo,
  type InstanceState,
  type OwnedInstanceInfo,
} from './model'

const ADMIN_ORIGIN = 'admin.astrale.ai'
const PAGE_SIZE = 256
const MAXIMUM_INSTANCES = 10_000
const MAXIMUM_PAGES = Math.ceil(MAXIMUM_INSTANCES / PAGE_SIZE) + 1

const InstanceRef = Object.freeze({
  origin: ADMIN_ORIGIN,
  kind: 'class' as const,
  name: 'Instance',
})
const HostRef = Object.freeze({ origin: ADMIN_ORIGIN, kind: 'class' as const, name: 'Host' })
const instanceRunsOnHost = Object.freeze({
  origin: ADMIN_ORIGIN,
  kind: 'class' as const,
  name: 'instance_runs_on_host',
})
const fleetReservesAdminHost = Object.freeze({
  origin: ADMIN_ORIGIN,
  kind: 'class' as const,
  name: 'fleet_reserves_admin_host',
})

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
  readonly bind?: (session: ClientSession) => Promise<DomainBinding>
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
  const binding = await (dependencies.bind ?? bindDomain)(context.session)
  if (binding.$.publication.origin !== ADMIN_ORIGIN || binding.$.origin !== ADMIN_ORIGIN) {
    throw new TypeError('Configured Admin target does not serve the Admin Domain.')
  }

  const Instance = binding.$.class('Instance')
  const Host = binding.$.class('Host')
  const Fleet = binding.$.class('Fleet')
  const fleet = binding.$.core.nodes.fleet?.path
  if (fleet === undefined) throw new TypeError('Admin Domain has no singleton Fleet receiver.')

  const operationId = dependencies.operationId ?? defaultOperationId

  const list = async (): Promise<OwnedInstanceInfo[]> => {
    const nodes = await readAllNodes(
      context.graph,
      Query.from({ kind: 'node', definitions: [InstanceRef] }).select({
        kind: 'nodes',
        projection: { kind: 'value' },
      }),
      {
        label: 'Admin Instance inventory',
        maximum: MAXIMUM_INSTANCES,
        maximumPages: MAXIMUM_PAGES,
      },
    )
    return Promise.all(
      nodes.map(async (node) => {
        const base = instanceFromNode(Instance, node)
        const host = await context.graph.neighbors(Path.id(node.id), instanceRunsOnHost, {
          direction: 'outgoing',
          page: { size: 2 },
        })
        if (host.nodes.length > 1) {
          throw new TypeError(`Admin Instance ${base.id} has more than one Host relation.`)
        }
        const related = host.first
        return related === null
          ? base
          : Object.freeze({
              ...base,
              hostId: Path.id(related.id).raw,
              ...optionalStringProperty(Host, related, 'region'),
            })
      }),
    )
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
    const output = await binding.$.invoke(
      Instance.$.method(method) as never,
      Path.parse(instance.id),
      { operationId: operationId(method) } as never,
    )
    return instanceFromSummary(output)
  }

  return Object.freeze({
    list,
    async create(slug: string, hostId?: string) {
      const input = Object.freeze({ operationId: operationId('create'), slug })
      if (hostId !== undefined) {
        const inventory = await hostInventory(context.graph, binding, Host, fleet)
        const selected = inventory.hosts.find((host) => hostMatches(host, hostId))
        if (selected === undefined || selected.path === inventory.reserved) {
          throw new AdminInstanceNotFoundError(hostId)
        }
        return instanceFromSummary(
          await binding.$.invoke(
            Host.$.method('createInstance') as never,
            Path.parse(selected.path),
            input as never,
          ),
        )
      }

      // Preserve the existing interactive multi-Host picker without accepting a
      // doomed operation first. Graph read policy exposes only caller-usable
      // Hosts; the reserved Admin Host is excluded explicitly.
      const inventory = await hostInventory(context.graph, binding, Host, fleet)
      const eligible = inventory.hosts.filter(
        (host) => host.state === 'ready' && host.path !== inventory.reserved,
      )
      if (eligible.length > 1) throw hostSelectionRequired(eligible.map((host) => host.id))

      return instanceFromSummary(
        await binding.$.invoke(Fleet.$.method('createInstance') as never, fleet, input as never),
      )
    },
    status: (identifier: string) => invokeInstance('status', identifier),
    delete: (identifier: string) => invokeInstance('delete', identifier),
    async installDomain(identifier: string, domain: string): Promise<DomainInstallReceipt> {
      const instance = await requireInstance(identifier)
      const output = await binding.$.invoke(
        Instance.$.method('installDomain') as never,
        Path.parse(instance.id),
        {
          operationId: operationId('install-domain'),
          domain: Path.parse(domain).raw,
        } as never,
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
  binding: DomainBinding,
  Host: ReturnType<DomainBinding['$']['class']>,
  fleet: Path,
): Promise<{ readonly hosts: readonly HostInventoryItem[]; readonly reserved?: string }> {
  const [nodes, reservedPage] = await Promise.all([
    readAllNodes(
      graph,
      Query.from({ kind: 'node', definitions: [HostRef] }).select({
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

function hostMatches(host: HostInventoryItem, identifier: string): boolean {
  return host.id === identifier || host.nodeId === identifier || host.path === identifier
}

function hostSelectionRequired(ids: readonly string[]): Error {
  return new Error(
    `alphaCreate could not choose a host: ${ids.length} ready hosts are assigned (${[...ids].sort().join(', ')}). ` +
      'Specify host_id once multi-host placement is enabled.',
  )
}

type DynamicDefinition = ReturnType<DomainBinding['$']['class']>

function instanceFromNode(definition: DynamicDefinition, node: Node): OwnedInstanceInfo {
  return Object.freeze({
    id: Path.id(node.id).raw,
    slug: requiredStringProperty(definition, node, 'slug'),
    url: optionalStringValue(node.props[definition.$.property('url').key]) ?? '',
    state: instanceState(node.props[definition.$.property('state').key]),
    ...optionalStringProperty(definition, node, 'phase'),
    ...optionalFailureProperty(definition, node),
    ...optionalStringProperty(definition, node, 'createdAt'),
  })
}

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
    node.props[definition.$.property(name).key],
    `Admin ${definition.name}.${name}`,
  )
}

function optionalStringProperty(
  definition: DynamicDefinition,
  node: Node,
  name: string,
): Readonly<Record<string, string>> {
  const value = optionalStringValue(node.props[definition.$.property(name).key])
  return value === undefined ? {} : { [name]: value }
}

function optionalFailureProperty(
  definition: DynamicDefinition,
  node: Node,
): Readonly<{ error?: string }> {
  const value = node.props[definition.$.property('failure').key]
  if (value === undefined) return {}
  const failure = record(value, 'Admin Instance failure')
  return { error: requiredString(failure.message, 'Admin Instance failure message') }
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
